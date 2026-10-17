// Cuts live audio into chunks for Whisper, at pauses in speech so no word is
// split. Pure logic apart from the chunker's own buffer, so
// tests/speech-chunks.test.js can check it.

export const CHUNK_RULES = {
  frameSeconds: 0.1, // loudness is measured per frame
  minSeconds: 2.5, // shorter chunks give Whisper too little context
  maxSeconds: 8, // longer ones keep the paper too far behind the speaker
  quietShare: 0.35, // a pause is two frames in a row quieter than this share of the usual loudness
  searchSeconds: 2.5, // with no pause by maxSeconds, cut at the quietest of these last seconds
};

// Below this loudness (root mean square) a chunk is treated as silence and not
// sent to Whisper, which otherwise sometimes invents words for silence.
export const SILENCE_LEVEL = 0.008;

export function loudness(samples) {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// levels: the loudness of each frame waiting to be sent. Returns how many frames
// to send as the next chunk, or 0 to keep waiting.
export function chunkFrameCount(levels, rules = CHUNK_RULES) {
  const minFrames = Math.round(rules.minSeconds / rules.frameSeconds);
  const maxFrames = Math.round(rules.maxSeconds / rules.frameSeconds);
  if (levels.length < minFrames) return 0;

  // A pause after the minimum length (0.2 s or more, so not just the gap of a
  // consonant inside a word): cut in it.
  const quiet = median(levels) * rules.quietShare;
  for (let i = minFrames - 1; i + 1 < levels.length; i++) {
    if (levels[i] <= quiet && levels[i + 1] <= quiet) return i + 1;
  }
  if (levels.length < maxFrames) return 0;

  // No pause: cut at the quietest recent frame, likely between words.
  const searchStart = levels.length - Math.round(rules.searchSeconds / rules.frameSeconds);
  let quietest = searchStart;
  for (let i = searchStart; i < levels.length; i++) {
    if (levels[i] < levels[quietest]) quietest = i;
  }
  return quietest + 1;
}

// Collects audio and calls onChunk({ audio, startSeconds, isSilent }) each time
// a chunk is ready; flush() sends whatever is left (at the end of recording).
export function createSpeechChunker({ sampleRate, onChunk, rules = CHUNK_RULES }) {
  const frameSamples = Math.round(sampleRate * rules.frameSeconds);
  let frames = [];
  let levels = [];
  let sentFrames = 0;
  let partial = new Float32Array(0);

  function send(frameCount) {
    const chosen = frames.slice(0, frameCount);
    const audio = new Float32Array(chosen.reduce((length, frame) => length + frame.length, 0));
    let offset = 0;
    for (const frame of chosen) {
      audio.set(frame, offset);
      offset += frame.length;
    }
    const isSilent = Math.max(...levels.slice(0, frameCount)) < SILENCE_LEVEL;
    onChunk({ audio, startSeconds: sentFrames * rules.frameSeconds, isSilent });
    frames = frames.slice(frameCount);
    levels = levels.slice(frameCount);
    sentFrames += frameCount;
  }

  return {
    push(samples) {
      const combined = new Float32Array(partial.length + samples.length);
      combined.set(partial);
      combined.set(samples, partial.length);
      let start = 0;
      while (combined.length - start >= frameSamples) {
        const frame = combined.slice(start, start + frameSamples);
        frames.push(frame);
        levels.push(loudness(frame));
        start += frameSamples;
        const count = chunkFrameCount(levels, rules);
        if (count > 0) send(count);
      }
      partial = combined.slice(start);
    },
    flush() {
      if (partial.length > 0) {
        frames.push(partial);
        levels.push(loudness(partial));
        partial = new Float32Array(0);
      }
      if (frames.length > 0) send(frames.length);
    },
  };
}
