// Runs Whisper (speech recognition) off the main thread so the page stays responsive.
// Messages in:  { audio: Float32Array (16 kHz mono), device?: 'webgpu' | 'wasm' }
// Messages out: { type: 'loading', fraction } while the model downloads (first time only),
//               { type: 'starting', device } while the model loads onto the GPU or CPU,
//               { type: 'progress', doneSeconds, totalSeconds } while transcribing,
//               { type: 'done', segments: [{ text, startSeconds, endSeconds }], device },
//               { type: 'error', message }
import { pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1';

const MODEL = 'onnx-community/whisper-base.en';
const SAMPLE_RATE = 16000;
// Audio is handed to Whisper a minute at a time, so progress is reported often.
const WINDOW_SECONDS = 60;

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
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    for (const chunk of output.chunks ?? []) {
      const [start, end] = chunk.timestamp;
      segments.push({
        text: chunk.text,
        startSeconds: windowStart + (start ?? 0),
        endSeconds: windowStart + (end ?? windowEnd - windowStart),
      });
    }
    self.postMessage({ type: 'progress', doneSeconds: windowEnd, totalSeconds });
  }
  return { segments, device };
}

self.addEventListener('message', async (event) => {
  try {
    const { segments, device } = await transcribe(event.data.audio, event.data.device);
    self.postMessage({ type: 'done', segments, device });
  } catch (error) {
    self.postMessage({ type: 'error', message: error?.message ?? String(error) });
  }
});
