// Rules for organizing a transcript into sections automatically.
// Pure functions (no page access), so tests/sections.test.html can check them.

export const SECTION_RULES = {
  minSectionMs: 60_000, // don't start a new section before this much lecture time
  maxSectionMs: 300_000, // past this, split at the longest pause found so far
  longPauseMs: 4_000, // a pause at least this long is a natural place to split
  minLinesPerSection: 2,
};

// Typical lecture pace, used to estimate how long a sentence took to say.
const WORDS_PER_SECOND = 2.5;

function wordCount(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

function speakingMs(line) {
  return (wordCount(line.text) / WORDS_PER_SECOND) * 1000;
}

// Each line's elapsedMs is when it was confirmed, i.e. when it ended. The pause
// before a line is the gap since the previous line minus the time spent saying it.
function pauseBeforeMs(lines, index) {
  return lines[index].elapsedMs - lines[index - 1].elapsedMs - speakingMs(lines[index]);
}

// Returns the indexes of the lines that start a section. Always starts with 0
// when there are lines.
export function findSectionStarts(lines, rules = SECTION_RULES) {
  if (lines.length === 0) return [];
  const starts = [0];
  let sectionStartIndex = 0;
  let sectionStartMs = lines[0].elapsedMs - speakingMs(lines[0]);
  let bestBreakIndex = -1;
  let bestPauseMs = -Infinity;

  const startSectionAt = (index) => {
    starts.push(index);
    sectionStartIndex = index;
    sectionStartMs = lines[index].elapsedMs - speakingMs(lines[index]);
    bestBreakIndex = -1;
    bestPauseMs = -Infinity;
  };

  for (let i = 1; i < lines.length; i++) {
    const linesSoFar = i - sectionStartIndex;
    const linesLeft = lines.length - i;
    const sectionLengthMs = lines[i - 1].elapsedMs - sectionStartMs;
    if (linesSoFar < rules.minLinesPerSection || linesLeft < rules.minLinesPerSection) continue;
    if (sectionLengthMs < rules.minSectionMs) continue;

    const pauseMs = pauseBeforeMs(lines, i);
    if (pauseMs >= rules.longPauseMs) {
      startSectionAt(i);
      continue;
    }
    if (pauseMs > bestPauseMs) {
      bestPauseMs = pauseMs;
      bestBreakIndex = i;
    }
    if (lines[i].elapsedMs - sectionStartMs >= rules.maxSectionMs) {
      const breakIndex = bestBreakIndex; // startSectionAt resets bestBreakIndex
      startSectionAt(breakIndex);
      i = breakIndex; // continue scanning right after the new section's first line
    }
  }
  return starts;
}

// Common words that make poor titles, including spoken-lecture filler.
const STOP_WORDS = new Set(
  `about above after again against also although always another anyone anything around because been before
  being below between both cannot could does doing down during each either else enough even ever every
  everyone everything example few first from further gonna gotta have having here hers herself himself
  however into itself just know kind kinda last later least like little look lots made make many maybe
  might more most much must myself need never next nothing okay once only other others ought ourselves
  over really right same says seen should since some something sort still such sure take than that thats
  their theirs them themselves then there these they thing things think this those though through thus
  together today very want wanna well were what when where whether which while whom whose will with
  within without would yeah years your yours yourself yourselves going actually basically pretty
  probably means mean said saying talk talking start started stuff guys come comes coming back good great
  essentially literally obviously honestly certainly definitely totally exactly simply clearly whatever
  them they're we're you're it's that's there's let's don't doesn't didn't isn't aren't wasn't can't won't
  i'm i've we've you've they've`.split(/\s+/),
);

// A fallback title: the most frequent meaningful words, most frequent first.
export function keywordTitle(text, maxWords = 3) {
  const counts = new Map();
  for (const rawWord of text.toLowerCase().match(/[a-z][a-z'-]*/g) ?? []) {
    const word = rawWord.replace(/'s$/, '');
    if (word.length < 4 || STOP_WORDS.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  // Map keeps first-appearance order, and sort is stable, so ties stay in that order.
  const keywords = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxWords)
    .map(([word]) => word);
  if (keywords.length === 0) return 'Untitled section';
  keywords[0] = keywords[0][0].toUpperCase() + keywords[0].slice(1);
  return keywords.join(' · ');
}

// The on-device model sometimes wraps its headline in quotes or ends it with a period.
export function cleanHeadline(headline) {
  return headline
    .trim()
    .replace(/^["'“”‘’*#\s]+|["'“”‘’*\s]+$/g, '')
    .replace(/\.$/, '');
}
