// Turns Whisper's short timed segments into transcript lines. Pure functions
// (no page access), so tests/complete-transcript.test.js can check them.

// Lines end at the end of a sentence, or once they get this long.
const MAX_WORDS_PER_LINE = 40;

// Whisper labels silence and sounds instead of speech, e.g. "[BLANK_AUDIO]",
// "(music)" or "♪".
function isNonSpeech(text) {
  return /^[[(♪*].*[\])♪*]$/.test(text) || /^[♪\s]*$/.test(text);
}

// Whisper's segments often end mid-sentence and start the next sentence partway
// through, so each segment is cut at its sentence ends. Each piece gets a share
// of the segment's time in proportion to its length.
function splitAtSentenceEnds(segment) {
  const text = segment.text.trim();
  const pieces = text.match(/[^.?!]+[.?!]+["')\]]?|[^.?!]+$/g) ?? [text];
  const duration = segment.endSeconds - segment.startSeconds;
  let offset = 0;
  return pieces.map((piece) => {
    const startSeconds = segment.startSeconds + (duration * offset) / text.length;
    offset += piece.length;
    const endSeconds = segment.startSeconds + (duration * offset) / text.length;
    return { text: piece.trim(), startSeconds, endSeconds };
  });
}

// segments: [{ text, startSeconds, endSeconds }]
// Returns: [{ text, startSeconds, endSeconds }], one per line.
export function segmentsToLines(segments) {
  const lines = [];
  let current = null;

  const pieces = segments
    .filter((segment) => segment.text.trim() && !isNonSpeech(segment.text.trim()))
    .flatMap(splitAtSentenceEnds);
  for (const segment of pieces) {
    const text = segment.text;
    if (!text) continue;
    if (current) {
      current.text += ` ${text}`;
      current.endSeconds = segment.endSeconds;
    } else {
      current = { text, startSeconds: segment.startSeconds, endSeconds: segment.endSeconds };
    }
    const endsSentence = /[.?!]["')\]]?$/.test(text);
    if (endsSentence || current.text.split(/\s+/).length >= MAX_WORDS_PER_LINE) {
      lines.push(current);
      current = null;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// Which new line (by index) should carry a flag set on the live line that ended
// at flaggedSeconds: the line being spoken then, or the next one after it.
export function lineIndexAt(lines, flaggedSeconds) {
  const index = lines.findIndex((line) => line.endSeconds >= flaggedSeconds);
  return index === -1 ? lines.length - 1 : index;
}
