// Shared helper for Chrome's built-in, on-device AI APIs (Translator, Summarizer).
// Creating one may first download a model, which reports progress; some browsers
// expose the API but never answer, so we give up after a stretch of silence.
const SILENCE_TIMEOUT_MS = 30000;

// Some Chromium-based browsers expose these APIs but never answer, so checks give up after a while.
const AVAILABILITY_TIMEOUT_MS = 8000;

// Resolves to 'available', 'downloadable', 'downloading', or 'unavailable'.
export function checkOnDeviceModel(api, options) {
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('the browser did not respond')), AVAILABILITY_TIMEOUT_MS);
  });
  return Promise.race([api.availability(options), timeout]);
}

// `api` is the API's global, e.g. Translator or Summarizer.
export function createOnDeviceModel(api, options, onDownloadProgress) {
  return new Promise((resolve, reject) => {
    let silenceTimer;
    const restartSilenceTimer = () => {
      clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => reject(new Error('the browser stopped responding')), SILENCE_TIMEOUT_MS);
    };
    restartSilenceTimer();

    api
      .create({
        ...options,
        monitor(monitor) {
          monitor.addEventListener('downloadprogress', (event) => {
            restartSilenceTimer();
            onDownloadProgress(event.loaded);
          });
        },
      })
      .then(resolve, reject)
      .finally(() => clearTimeout(silenceTimer));
  });
}
