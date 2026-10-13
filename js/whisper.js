// Turns a recorded audio Blob into timed transcript segments using Whisper,
// which runs in a background worker (js/whisper-worker.js).
const SAMPLE_RATE = 16000;

let worker = null;
// Recordings are transcribed one at a time, in the order they were made.
let queue = Promise.resolve();

export function isWhisperSupported() {
  return Boolean(window.Worker && window.AudioContext);
}

// Whisper expects 16 kHz mono audio; the browser resamples while decoding.
async function decodeToMono16k(audioBlob) {
  const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
  try {
    const audioBuffer = await audioContext.decodeAudioData(await audioBlob.arrayBuffer());
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

function runInWorker(audio, onProgress, device) {
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
    activeWorker.postMessage({ audio, device }, [audio.buffer]);
  });
}

// Resolves to { segments: [{ text, startSeconds, endSeconds }], device }.
// onProgress receives { type: 'loading', fraction }, { type: 'starting', device },
// { type: 'progress', doneSeconds, totalSeconds }, or { type: 'retrying' }.
// If Whisper gets stuck on the GPU, it is tried once more on the CPU.
export function transcribeRecording(audioBlob, onProgress) {
  const job = queue.then(async () => {
    const audio = await decodeToMono16k(audioBlob);
    try {
      return await runInWorker(audio.slice(), onProgress);
    } catch (error) {
      if (!(error instanceof WhisperStuckError)) throw error;
      onProgress({ type: 'retrying' });
      return runInWorker(audio, onProgress, 'wasm');
    }
  });
  queue = job.catch(() => {});
  return job;
}
