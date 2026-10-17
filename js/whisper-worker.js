// Runs Whisper (speech recognition), and a speaker model that tells voices apart,
// off the main thread so the page stays responsive.
//
// Transcribing. Message in: { task: 'transcribe', audio: Float32Array (16 kHz mono), device?: 'webgpu' | 'wasm' }
// Warming up. Message in: { task: 'warm-up', audio, onlyIfDownloaded }: loads Whisper
// and runs it once on the given (silent) audio, so the first real chunk isn't
// held up. With onlyIfDownloaded, does nothing unless the model is already in
// the browser's cache. Message out: { type: 'done', isWarm }.
//
// Messages out: { type: 'loading', fraction } while the model downloads (first time only),
//               { type: 'starting', device } while the model loads onto the GPU or CPU,
//               { type: 'progress', doneSeconds, totalSeconds } while transcribing,
//               { type: 'partial', segments, doneSeconds, totalSeconds } after each minute of audio,
//               { type: 'done', segments: [{ text, startSeconds, endSeconds }], device },
//               { type: 'error', message }
//
// Speakers. Message in: { task: 'speakers', audio, spans: [{ startSeconds, endSeconds }] }
// Messages out: { type: 'loading', fraction }, { type: 'starting', device },
//               { type: 'speaker-progress', done, total },
//               { type: 'done', embeddings: [Float32Array | null], device } (null: too short to tell)
import { AutoModel, AutoProcessor, pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1';
import { removeHallucinations } from './complete-transcript.js';

const MODEL = 'onnx-community/whisper-base.en';
const SAMPLE_RATE = 16000;
// Audio is handed to Whisper a minute at a time, so progress is reported often.
const WINDOW_SECONDS = 60;
// Whisper hears at most 30 seconds at once.
const WHISPER_SECONDS = 30;

// Even fast speech needs fewer than 10 tokens a second, timestamps included.
// The limit stops a hallucination loop early, so it can't hold up the
// transcript for many seconds.
function maxTokensFor(seconds) {
  return Math.ceil(Math.min(seconds, WHISPER_SECONDS) * 10) + 24;
}

// Fast on the GPU when available; otherwise a smaller model on the CPU.
const CONFIGURATIONS = [
  { device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' } },
  { device: 'wasm', dtype: 'q8' },
];

let transcriberPromise = null;

// Once every file is loaded, the model still has to be set up on the device,
// which can take a while, so that is reported as 'starting'.
function reportDownloadProgress(device) {
  const bytesByFile = new Map();
  let lastPercent = -1;
  return (event) => {
    if (event.status !== 'progress' || !event.total) return;
    bytesByFile.set(event.file, { loaded: event.loaded, total: event.total });
    let loaded = 0;
    let total = 0;
    for (const file of bytesByFile.values()) {
      loaded += file.loaded;
      total += file.total;
    }
    const percent = Math.floor((loaded / total) * 100);
    if (percent === lastPercent) return;
    lastPercent = percent;
    self.postMessage(percent === 100 ? { type: 'starting', device } : { type: 'loading', fraction: loaded / total });
  };
}

async function loadTranscriber(onlyDevice) {
  let lastError = null;
  for (const configuration of CONFIGURATIONS) {
    if (onlyDevice && configuration.device !== onlyDevice) continue;
    if (configuration.device === 'webgpu' && !('gpu' in navigator)) continue;
    try {
      self.postMessage({ type: 'starting', device: configuration.device });
      const transcriber = await pipeline('automatic-speech-recognition', MODEL, {
        ...configuration,
        progress_callback: reportDownloadProgress(configuration.device),
      });
      return { transcriber, device: configuration.device };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('no way to run Whisper in this browser');
}

async function transcribe(audio, onlyDevice) {
  transcriberPromise ??= loadTranscriber(onlyDevice).catch((error) => {
    transcriberPromise = null;
    throw error;
  });
  const { transcriber, device } = await transcriberPromise;

  const totalSeconds = audio.length / SAMPLE_RATE;
  const segments = [];
  self.postMessage({ type: 'progress', doneSeconds: 0, totalSeconds });
  for (let windowStart = 0; windowStart < totalSeconds; windowStart += WINDOW_SECONDS) {
    const windowEnd = Math.min(windowStart + WINDOW_SECONDS, totalSeconds);
    const windowAudio = audio.subarray(Math.floor(windowStart * SAMPLE_RATE), Math.floor(windowEnd * SAMPLE_RATE));
    const output = await transcriber(windowAudio, {
      return_timestamps: true,
      chunk_length_s: WHISPER_SECONDS,
      stride_length_s: 5,
      max_new_tokens: maxTokensFor(windowEnd - windowStart),
    });
    const timedSegments = (output.chunks ?? []).map((chunk) => {
      const [start, end] = chunk.timestamp;
      return {
        text: chunk.text,
        startSeconds: windowStart + (start ?? 0),
        endSeconds: windowStart + (end ?? windowEnd - windowStart),
      };
    });
    const windowSegments = removeHallucinations(timedSegments, windowEnd);
    segments.push(...windowSegments);
    self.postMessage({ type: 'partial', segments: windowSegments, doneSeconds: windowEnd, totalSeconds });
  }
  return { segments, device };
}

// Whether this browser already downloaded Whisper (transformers.js keeps it in
// the Cache Storage named 'transformers-cache').
async function isModelDownloaded() {
  if (!self.caches || !(await caches.has('transformers-cache'))) return false;
  const cache = await caches.open('transformers-cache');
  const files = (await cache.keys()).map((request) => request.url);
  return files.some((url) => url.includes(MODEL) && url.includes('decoder_model_merged'));
}

async function warmUp(audio, onlyIfDownloaded) {
  if (onlyIfDownloaded && !(await isModelDownloaded())) return false;
  await transcribe(audio);
  return true;
}

// ---------- Speakers ----------

// Produces a "voice fingerprint" for a stretch of speech; stretches by the same
// person have similar fingerprints. WeSpeaker (26 MB) took about 15 ms per line
// on the GPU, about 40 times faster than WavLM, which was tried first.
const SPEAKER_MODEL = 'onnx-community/wespeaker-voxceleb-resnet34-LM';
const SPEAKER_CONFIGURATIONS = [
  { device: 'webgpu', dtype: 'fp32' },
  { device: 'wasm', dtype: 'fp32' },
];
// Shorter stretches don't carry enough of a voice to tell; longer ones are
// trimmed to their middle, which is enough.
const MIN_SPEAKER_SECONDS = 0.4;
const MAX_SPEAKER_SECONDS = 4;

let speakerModelPromise = null;

async function loadSpeakerModel() {
  const processor = await AutoProcessor.from_pretrained(SPEAKER_MODEL);
  let lastError = null;
  for (const configuration of SPEAKER_CONFIGURATIONS) {
    if (configuration.device === 'webgpu' && !('gpu' in navigator)) continue;
    try {
      self.postMessage({ type: 'starting', device: configuration.device });
      const model = await AutoModel.from_pretrained(SPEAKER_MODEL, {
        ...configuration,
        progress_callback: reportDownloadProgress(configuration.device),
      });
      return { processor, model, device: configuration.device };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('no way to run the speaker model in this browser');
}

function speechClip(audio, { startSeconds, endSeconds }) {
  const duration = endSeconds - startSeconds;
  if (duration < MIN_SPEAKER_SECONDS) return null;
  const middle = (startSeconds + endSeconds) / 2;
  const half = Math.min(duration, MAX_SPEAKER_SECONDS) / 2;
  return audio.subarray(Math.floor((middle - half) * SAMPLE_RATE), Math.floor((middle + half) * SAMPLE_RATE));
}

async function embedSpeakers(audio, spans) {
  speakerModelPromise ??= loadSpeakerModel().catch((error) => {
    speakerModelPromise = null;
    throw error;
  });
  const { processor, model, device } = await speakerModelPromise;
  const embeddings = [];
  for (const [index, span] of spans.entries()) {
    const clip = speechClip(audio, span);
    if (clip) {
      const { last_hidden_state: fingerprint } = await model(await processor(clip));
      embeddings.push(new Float32Array(fingerprint.data));
    } else {
      embeddings.push(null);
    }
    self.postMessage({ type: 'speaker-progress', done: index + 1, total: spans.length });
  }
  return { embeddings, device };
}

self.addEventListener('message', async (event) => {
  try {
    if (event.data.task === 'warm-up') {
      const isWarm = await warmUp(event.data.audio, event.data.onlyIfDownloaded);
      self.postMessage({ type: 'done', isWarm });
      return;
    }
    if (event.data.task === 'speakers') {
      const { embeddings, device } = await embedSpeakers(event.data.audio, event.data.spans);
      self.postMessage({ type: 'done', embeddings, device });
      return;
    }
    const { segments, device } = await transcribe(event.data.audio, event.data.device);
    self.postMessage({ type: 'done', segments, device });
  } catch (error) {
    self.postMessage({ type: 'error', message: error?.message ?? String(error) });
  }
});
