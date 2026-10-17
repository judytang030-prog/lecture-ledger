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

function comparableWord(word) {
  return word.toLowerCase().replace(/[^a-z0-9']/g, '');
}

// Endings of the online videos Whisper learned from, which it "hears" in music.
const INVENTED_SENTENCES = /^(thanks|thank you)( so much| very much)? for watching|^please subscribe|^subtitles by/;

// On music or silence, Whisper sometimes "hallucinates": it invents a sentence,
// often repeating it over and over with timestamps running past the end of the
// audio it was given. Drops segments that start after audioEndSeconds, video
// endings like "Thanks for watching!", and sentences that repeat the sentence
// just before them.
export function removeHallucinations(segments, audioEndSeconds) {
  const kept = [];
  let previousSentence = '';
  for (const segment of segments) {
    if (segment.startSeconds >= audioEndSeconds) continue;
    const sentences = segment.text.trim().match(/[^.?!]+[.?!]*/g) ?? [];
    const fresh = sentences.filter((sentence) => {
      const comparable = sentence.split(/\s+/).map(comparableWord).filter(Boolean).join(' ');
      if (!comparable) return true;
      if (INVENTED_SENTENCES.test(comparable)) return false;
      const isRepeat = comparable === previousSentence;
      previousSentence = comparable;
      return !isRepeat;
    });
    if (fresh.length === 0) continue;
    kept.push({
      ...segment,
      text: fresh.length === sentences.length ? segment.text : ` ${fresh.map((sentence) => sentence.trim()).join(' ')}`,
      endSeconds: Math.min(segment.endSeconds, audioEndSeconds),
    });
  }
  return kept;
}

// Adds the segments of a newly transcribed chunk of live audio after the ones
// before it, repairing the seam: Whisper hears each chunk on its own, so it may
// hear a word at the end of one chunk and again at the start of the next,
// leave half a word ("the base-" + "case"), or end a sentence that the next
// chunk continues in lowercase ("is a technique." + "where a function…").
// Returns a new list; the last earlier segment may be changed.
export function appendChunkSegments(segments, chunkSegments) {
  const incoming = chunkSegments.map((segment) => ({ ...segment, text: segment.text.trim() })).filter((segment) => segment.text);
  if (segments.length === 0 || incoming.length === 0) return [...segments, ...incoming];
  const last = { ...segments.at(-1), text: segments.at(-1).text.trim().replace(/-$/, '') };
  const first = incoming[0];

  const lastWords = last.text.split(/\s+/);
  const firstWords = first.text.split(/\s+/);
  // A new sentence that starts with the word the last one ended with ("…on
  // recursion. Recursion is…") is a real repetition, not one word heard twice.
  const startsNewSentence = /[.?!]$/.test(last.text) && /^[A-Z]/.test(first.text);
  for (let count = startsNewSentence ? 0 : Math.min(4, lastWords.length, firstWords.length); count >= 1; count--) {
    const end = lastWords.slice(-count).map(comparableWord).join(' ');
    const start = firstWords.slice(0, count).map(comparableWord).join(' ');
    if (end === start) {
      firstWords.splice(0, count);
      break;
    }
  }
  first.text = firstWords.join(' ');
  if (/^[a-z]/.test(first.text) && last.text.endsWith('.')) last.text = last.text.slice(0, -1);

  return [...segments.slice(0, -1), last, ...(first.text ? incoming : incoming.slice(1))];
}
