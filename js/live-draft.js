// The live row while Whisper writes the transcript: Chrome's instant
// recognition, typed as it is heard, starting where Whisper's lines on the
// paper end. Pure logic, so tests/live-draft.test.js can check it.

// Whisper writes small numbers as digits, Chrome often as words.
const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty',
];

function normalizedWord(word) {
  const normalized = word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
  return (/^\d+$/.test(normalized) && NUMBER_WORDS[Number(normalized)]) || normalized;
}

function wordsOf(text) {
  return text.split(/\s+/).filter(Boolean);
}

// How many of the paper's last words are looked for in the draft.
const TAIL_WORDS = 8;
// Chrome is a few seconds ahead of Whisper, so the end of the paper's new
// words is at most about this many words past them in the draft.
const AHEAD_WORDS = 40;
// Paper words still to be found are counted up to this many.
const MAX_UNFOUND_WORDS = 200;
const MATCH_SCORE = 2;
const MISS_PENALTY = 1;

// Finds where the paper's last words (tail) end in the draft (words), allowing
// a few words that Chrome and Whisper heard differently. newWords: how many
// words are new on the paper (the rest already left the draft). Returns how
// many draft words lead up to that point, or -1 when too few of them match
// (for example, Chrome missed those words).
export function findSpokenEnd(tail, words, newWords = tail.length) {
  // About three matching words are needed, or all of a shorter new line, which
  // is then only looked for at the very start of the draft.
  const neededMatches = Math.min(3, newWords);
  const searched = neededMatches < 3 ? newWords + 4 : newWords + AHEAD_WORDS;
  const tailWords = tail.map(normalizedWord);
  const draftWords = words.slice(0, searched).map(normalizedWord);
  // Local alignment (Smith–Waterman) that must end at the tail's last word.
  let previousRow = new Array(draftWords.length + 1).fill(0);
  for (const tailWord of tailWords) {
    const row = [0];
    for (let j = 1; j <= draftWords.length; j++) {
      const isMatch = tailWord !== '' && tailWord === draftWords[j - 1];
      row.push(
        Math.max(
          0,
          previousRow[j - 1] + (isMatch ? MATCH_SCORE : -MISS_PENALTY),
          previousRow[j] - MISS_PENALTY,
          row[j - 1] - MISS_PENALTY,
        ),
      );
    }
    previousRow = row;
  }
  // The earliest of the best ends wins.
  const needed = MATCH_SCORE * neededMatches - MISS_PENALTY;
  let bestEnd = -1;
  for (let j = 1; j <= draftWords.length; j++) {
    if (previousRow[j] >= needed && (bestEnd < 0 || previousRow[j] > previousRow[bestEnd])) bestEnd = j;
  }
  return bestEnd;
}

// Whether Chrome showed most of a line's words, perhaps worded a little
// differently. Only longer words count; short ones like "a" or "the" are in
// almost any draft.
function showsMostOf(lineWords, shownWords) {
  const meaningful = (word) => word.length >= 4;
  const lineContent = lineWords.map(normalizedWord).filter(meaningful);
  if (lineContent.length === 0) return false;
  const shown = new Set(shownWords.map(normalizedWord));
  return lineContent.filter((word) => shown.has(word)).length / lineContent.length >= 0.5;
}

// Whether the draft is just words already on the paper, as when Chrome is
// behind Whisper or stalled partway through a line: most draft words appear in
// the paper's recent words, in order, and at least one of them is a longer word
// (not just "and the").
function isMostlyWithin(paperWords, draftWords) {
  const paper = paperWords.map(normalizedWord);
  const draft = draftWords.map(normalizedWord).filter(Boolean);
  let position = 0;
  let matched = 0;
  let hasLongWord = false;
  for (const word of draft) {
    const found = paper.indexOf(word, position);
    if (found < 0) continue;
    position = found + 1;
    matched++;
    hasLongWord ||= word.length >= 4;
  }
  return hasLongWord && matched >= draft.length * 0.75;
}

// How many of the paper's last words are kept to recognize Chrome's late words.
const RECENT_PAPER_WORDS = 60;
// Chrome shows a word a moment after it is said, but Whisper's timestamps are
// approximate, so words count as on the paper by time only when Chrome showed
// them this long before the end of the paper's audio.
const TIME_MARGIN_MS = 500;

export function createLiveDraft() {
  // Chrome's words not yet on the paper, each with when Chrome first showed it
  // (seenAt, in ms): [{ text, seenAt }]. Unconfirmed words may still change.
  let confirmedWords = [];
  let unconfirmedWords = [];
  // The paper's recent words, and how many of them are still to be found in the draft.
  let paperWords = [];
  let unfoundCount = 0;
  // Words Chrome showed before this time are on the paper already.
  let coveredUntilMs = -Infinity;
  // The draft as shown: [{ text, seenAt }].
  let shown = [];

  function update() {
    while (confirmedWords.length > 0 && confirmedWords[0].seenAt <= coveredUntilMs) confirmedWords.shift();
    let words = [...confirmedWords, ...unconfirmedWords];
    // Unconfirmed words come again with every update from Chrome, so they are
    // skipped here each time rather than removed.
    let skipped = 0;
    while (skipped < words.length && words[skipped].seenAt <= coveredUntilMs) skipped++;
    words = words.slice(skipped);
    if (unfoundCount > 0) {
      const end = findSpokenEnd(
        paperWords.slice(-TAIL_WORDS),
        words.map((word) => word.text),
        unfoundCount,
      );
      if (end >= 0 && end <= confirmedWords.length) {
        confirmedWords = confirmedWords.slice(end);
        unfoundCount = 0;
      } else if (end > confirmedWords.length) {
        // It ends in words Chrome hasn't confirmed yet, which still change, so
        // it is looked for again next time.
        confirmedWords = [];
      }
      if (end >= 0) {
        words = words.slice(end);
      } else if (isMostlyWithin(paperWords, words.map((word) => word.text))) {
        // Chrome is behind the paper: its words are hidden until it passes the
        // paper's end.
        words = [];
      }
    }
    shown = words;
  }

  function shownWords() {
    return shown.map((word) => word.text);
  }

  return {
    get text() {
      return shownWords().join(' ');
    },
    // Chrome confirmed text at nowMs. The rest of a word Chrome cut in two
    // ("jour" + "ney") joins the last word.
    addConfirmed(text, nowMs, { continuesPreviousWord = false } = {}) {
      const words = wordsOf(text);
      const lastWord = confirmedWords.at(-1);
      if (continuesPreviousWord && lastWord && words.length > 0) lastWord.text += words.shift();
      // These words were unconfirmed until now, shown since then.
      const seenAt = (index) => unconfirmedWords[index]?.seenAt ?? nowMs;
      confirmedWords.push(...words.map((word, index) => ({ text: word, seenAt: seenAt(index) })));
      // Chrome reports what is still unconfirmed right after.
      unconfirmedWords = [];
      update();
    },
    setUnconfirmed(text, nowMs) {
      unconfirmedWords = wordsOf(text).map((word, index) => ({
        text: word,
        seenAt: unconfirmedWords[index]?.seenAt ?? nowMs,
      }));
      update();
    },
    // When the draft is the start of a line that is about to go onto the paper
    // (Chrome hasn't shown the rest yet), returns the rest of the line, so the
    // typewriter can finish typing it; otherwise null.
    restOfLine(text) {
      const draft = shownWords();
      if (draft.length === 0) return null;
      const lineWords = wordsOf(text);
      const tail = draft.slice(-TAIL_WORDS);
      const end = findSpokenEnd(tail, lineWords, tail.length);
      return end >= 0 && end < lineWords.length ? lineWords.slice(end).join(' ') : null;
    },
    // A line went onto the paper: its words leave the draft, as does every word
    // Chrome showed well before the line's end (endMs). Returns whether the
    // line was in the draft (false when Chrome missed it).
    addPaperLine(text, endMs) {
      const lineWords = wordsOf(text);
      paperWords = [...paperWords, ...lineWords].slice(-RECENT_PAPER_WORDS);
      unfoundCount = Math.min(unfoundCount + lineWords.length, MAX_UNFOUND_WORDS);
      coveredUntilMs = Math.max(coveredUntilMs, endMs - TIME_MARGIN_MS);
      const wasShown =
        findSpokenEnd(paperWords.slice(-TAIL_WORDS), shownWords(), lineWords.length) >= 0 ||
        showsMostOf(lineWords, shownWords());
      update();
      return wasShown;
    },
    clear() {
      confirmedWords = [];
      unconfirmedWords = [];
      paperWords = [];
      unfoundCount = 0;
      coveredUntilMs = -Infinity;
      shown = [];
    },
  };
}
