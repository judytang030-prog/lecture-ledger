// Captures the microphone as raw 16 kHz audio while recording, so Whisper can
// transcribe it a few seconds at a time (js/speech-chunks.js decides where to cut).
export const CAPTURE_SAMPLE_RATE = 16000;

export function isAudioCaptureSupported() {
  return Boolean(navigator.mediaDevices?.getUserMedia && window.AudioContext && window.AudioWorkletNode);
}

// Calls onAudio(Float32Array) with each 0.1 s of audio. Resolves to { stop() }.
export async function startAudioCapture({ onAudio }) {
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
  // The browser resamples the microphone to the context's rate, which is what Whisper expects.
  const context = new AudioContext({ sampleRate: CAPTURE_SAMPLE_RATE });
  await context.audioWorklet.addModule(new URL('./pcm-capture-worklet.js', import.meta.url));
  const source = context.createMediaStreamSource(stream);
  const capture = new AudioWorkletNode(context, 'pcm-capture');
  capture.port.onmessage = (event) => onAudio(event.data);
  // A silent output keeps the audio graph running without playing anything.
  const mute = context.createGain();
  mute.gain.value = 0;
  source.connect(capture).connect(mute).connect(context.destination);

  return {
    stop() {
      capture.port.onmessage = null;
      for (const track of stream.getTracks()) track.stop();
      context.close();
    },
  };
}
