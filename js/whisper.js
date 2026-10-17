// Turns a recorded audio Blob into timed transcript segments using Whisper, and
// tells speakers apart, both in a background worker (js/whisper-worker.js).
const SAMPLE_RATE = 16000;

let worker = null;
// Recordings are transcribed one at a time, in the order they were made.
let queue = Promise.resolve();

export function isWhisperSupported() {
  return Boolean(window.Worker && window.AudioContext);
}

export class UnreadableAudioError extends Error {}

// Whisper expects 16 kHz mono audio; the browser resamples while decoding.
async function decodeToMono16k(audioBlob) {
  const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
  try {
    let audioBuffer;
    try {
      audioBuffer = await audioContext.decodeAudioData(await audioBlob.arrayBuffer());
    } catch {
      throw new UnreadableAudioError("the browser can't read the audio in this file");
    }
    // A copy, because the worker takes ownership of the data it is sent.
    return new Float32Array(audioBuffer.getChannelData(0));
  } finally {
    audioContext.close();
  }
}

// If the worker sends nothing for this long, it is stuck (for example, loading
// the model onto a busy GPU), so it is stopped.
const SILENCE_LIMIT_MS = 120000;
// On the CPU a minute of audio can take a few minutes, so allow more time there.
const CPU_SILENCE_LIMIT_MS = 300000;

class WhisperStuckError extends Error {}

// Sends one task to the worker (handing over the audio) and resolves with its 'done' message.
function runInWorker(message, onProgress) {
  worker ??= new Worker(new URL('./whisper-worker.js', import.meta.url), { type: 'module' });
  const activeWorker = worker;
  return new Promise((resolve, reject) => {
    let silenceTimer;
    let silenceLimitMs = SILENCE_LIMIT_MS;
    const finish = () => {
      clearTimeout(silenceTimer);
      activeWorker.removeEventListener('message', handleMessage);
      activeWorker.removeEventListener('error', handleError);
    };
    const stopStuckWorker = () => {
      finish();
      activeWorker.terminate();
      worker = null;
      reject(new WhisperStuckError('Whisper stopped responding'));
    };
    const restartSilenceTimer = () => {
      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(stopStuckWorker, silenceLimitMs);
    };
    const handleMessage = (event) => {
      const message = event.data;
      if (message.type === 'done') {
        finish();
        resolve(message);
      } else if (message.type === 'error') {
        finish();
        reject(new Error(message.message));
      } else {
        if (message.type === 'starting' && message.device === 'wasm') silenceLimitMs = CPU_SILENCE_LIMIT_MS;
        restartSilenceTimer();
        onProgress(message);
      }
    };
    const handleError = (event) => {
      finish();
      worker = null; // A crashed worker is replaced on the next request.
      reject(new Error(event.message || 'Whisper could not start'));
    };
    activeWorker.addEventListener('message', handleMessage);
    activeWorker.addEventListener('error', handleError);
    restartSilenceTimer();
    activeWorker.postMessage(message, [message.audio.buffer]);
  });
}

// Transcribes 16 kHz mono audio. Resolves to { segments: [{ text, startSeconds,
// endSeconds }], device }. onProgress receives { type: 'loading', fraction },
// { type: 'starting', device }, { type: 'progress', doneSeconds, totalSeconds },
// { type: 'partial', segments, doneSeconds, totalSeconds } (the newest minute's
// segments), or { type: 'retrying' }, after which partial results start over.
// If Whisper gets stuck on the GPU, it is tried once more on the CPU.
export function transcribeAudio(audio, onProgress = () => {}) {
  const job = queue.then(async () => {
    // The worker takes over the data it is sent, so it always gets a copy.
    const transcribe = (device) => runInWorker({ task: 'transcribe', audio: audio.slice(), device }, onProgress);
    try {
      return await transcribe();
    } catch (error) {
      if (!(error instanceof WhisperStuckError)) throw error;
      onProgress({ type: 'retrying' });
      return transcribe('wasm');
    }
  });
  queue = job.catch(() => {});
  return job;
}

// Loads Whisper and runs it once on a second of silence, so the first chunk of
// a recording is transcribed without waiting seconds for the model to start.
// With onlyIfDownloaded, nothing is downloaded: it only warms up a model the
// browser already has. Resolves to whether Whisper is now warm.
// onProgress receives the same 'loading' and 'starting' messages as transcribeAudio.
export function warmUpWhisper({ onlyIfDownloaded = false, onProgress = () => {} } = {}) {
  const job = queue.then(() =>
    runInWorker({ task: 'warm-up', audio: new Float32Array(SAMPLE_RATE), onlyIfDownloaded }, onProgress),
  );
  queue = job.catch(() => {});
  return job.then((message) => message.isWarm);
}

// Like transcribeAudio, for a recorded or uploaded file. Also resolves with
// audio, the decoded recording, for embedSpeakers().
export async function transcribeRecording(audioBlob, onProgress) {
  const audio = await decodeToMono16k(audioBlob);
  return { ...(await transcribeAudio(audio, onProgress)), audio };
}

// Resolves to { embeddings: [Float32Array | null], device }: a voice
// fingerprint for each span of the audio (null when too short to tell).
// onProgress receives { type: 'loading', fraction }, { type: 'starting', device },
// or { type: 'speaker-progress', done, total }.
export function embedSpeakers(audio, spans, onProgress) {
  const job = queue.then(() => runInWorker({ task: 'speakers', audio: audio.slice(), spans }, onProgress));
  queue = job.catch(() => {});
  return job;
}
