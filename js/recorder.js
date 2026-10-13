// Records the microphone while Chrome transcribes live, so Whisper can make a
// complete transcript of the same audio after Stop.
export function isRecordingSupported() {
  return Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
}

export async function startAudioRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      // Echo cancellation filters out sound the computer itself plays, which
      // would erase a video playing on this computer.
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: true,
    },
  });
  const recorder = new MediaRecorder(stream);
  const audioParts = [];
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) audioParts.push(event.data);
  });
  // Collect data every second so a long lecture never sits in one huge buffer.
  recorder.start(1000);

  return {
    // Resolves to the whole recording as one audio Blob.
    stop() {
      return new Promise((resolve) => {
        recorder.addEventListener(
          'stop',
          () => {
            for (const track of stream.getTracks()) track.stop();
            resolve(new Blob(audioParts, { type: recorder.mimeType }));
          },
          { once: true },
        );
        recorder.stop();
      });
    },
  };
}
