// Runs on the browser's audio thread: collects microphone samples and sends
// them to the page in blocks of FRAME_SAMPLES (0.1 s at 16 kHz).
const FRAME_SAMPLES = 1600;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Float32Array(FRAME_SAMPLES);
    this.filled = 0;
  }

  process(inputs) {
    const samples = inputs[0]?.[0];
    if (samples) {
      for (const sample of samples) {
        this.frame[this.filled++] = sample;
        if (this.filled === FRAME_SAMPLES) {
          this.port.postMessage(this.frame);
          this.frame = new Float32Array(FRAME_SAMPLES);
          this.filled = 0;
        }
      }
    }
    return true; // keep running until the page disconnects it
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);
