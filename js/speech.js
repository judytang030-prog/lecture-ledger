// Wraps the browser's built-in speech recognition (Chrome, Edge, Safari).
// Unlike the prototype, every failure is reported through onError, and a slow
// start is reported through onSlowStart, so the Start button never silently does nothing.
const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;

const SLOW_START_MS = 4000;

// Chrome ends a session after a stretch of silence; we quietly restart instead of stopping.
const RECOVERABLE_ERRORS = new Set(['no-speech', 'aborted']);

const ERROR_MESSAGES = {
  'not-allowed':
    'Microphone access is blocked. Click the icon at the left of the address bar, allow the microphone, then press Start again.',
  'service-not-allowed':
    'This browser blocked speech recognition. In Safari, turn on Dictation in System Settings → Keyboard, then try again.',
  'audio-capture': 'No microphone was found. Plug one in or check your sound settings, then press Start again.',
  network: 'Speech recognition needs an internet connection. Check your Wi-Fi, then press Start again.',
  'language-not-supported': 'This browser cannot recognize English speech.',
};

export function isSpeechSupported() {
  return Boolean(SpeechRecognitionImpl);
}

function normalizedWords(text) {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}']/gu, ''))
    .filter(Boolean);
}

function findWords(haystack, needle, { fromEnd = false } = {}) {
  const positions = [];
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((word, offset) => haystack[i + offset] === word)) positions.push(i);
  }
  return fromEnd ? positions.at(-1) ?? -1 : positions[0] ?? -1;
}

// Chrome sometimes confirms a sentence with words missing at its start or end,
// even though they were shown live a moment earlier. The confirmed text is
// lined up with the longest live text by its first and last one or two words;
// live words before it are added back at the start, and live words after it
// at the end, unless those just moved into the next result (followingText).
export function recoverDroppedWords(liveText, confirmedText, followingText = '') {
  const liveWords = normalizedWords(liveText);
  const confirmedWords = normalizedWords(confirmedText);
  if (confirmedWords.length === 0 || confirmedWords.length >= liveWords.length) return confirmedText;
  const originalLiveWords = liveText.trim().split(/\s+/);
  let recovered = confirmedText;

  const startsAt = findWords(liveWords, confirmedWords.slice(0, 2));
  if (startsAt > 0) {
    recovered = `${originalLiveWords.slice(0, startsAt).join(' ')} ${recovered}`;
  }

  const endAnchor = confirmedWords.slice(-2);
  const endsAt = findWords(liveWords, endAnchor, { fromEnd: true });
  if (endsAt >= 0 && endsAt + endAnchor.length < liveWords.length) {
    const droppedEnd = liveWords.slice(endsAt + endAnchor.length);
    const followingWords = normalizedWords(followingText);
    const movedToNextResult = droppedEnd.every((word, i) => followingWords[i] === word);
    if (!movedToNextResult) {
      recovered = `${recovered} ${originalLiveWords.slice(originalLiveWords.length - droppedEnd.length).join(' ')}`;
    }
  }
  return recovered;
}

function shareOfWordsIn(words, otherText) {
  const otherWords = new Set(normalizedWords(otherText));
  return words.filter((word) => otherWords.has(word)).length / words.length;
}

// Chrome sometimes confirms something completely different from what it had
// shown live ("can you say what you want to say" became "try my best but their
// days"), dropping the live words. They count as lost when they barely appear
// in the confirmed text and weren't already saved in the lines just before
// (Chrome also moves words between results).
export function isLostLiveText(liveText, confirmedText, recentlySavedText) {
  const liveWords = normalizedWords(liveText);
  if (liveWords.length < 3) return false;
  return shareOfWordsIn(liveWords, confirmedText) < 0.3 && shareOfWordsIn(liveWords, recentlySavedText) < 0.7;
}

// A gap this long between results while speech is heard is noted in the log.
const GAP_MS = 3000;

// If speech is heard but Chrome gives no results for this long, it has stalled
// (seen for 30+ seconds at a time), so recognition is restarted.
const STALL_MS = 7000;

export function createLiveTranscriber({
  speechCode,
  onListening,
  onSlowStart,
  onHearingChange,
  onInterim,
  onFinal,
  onError,
  onStopped,
  onProcessingError,
  onDebugEvent = () => {},
}) {
  const recognition = new SpeechRecognitionImpl();
  recognition.lang = speechCode;
  recognition.continuous = true;
  recognition.interimResults = true;

  let wantsToListen = false;
  let hasStarted = false;
  let slowStartTimer = null;
  // Words heard but not yet confirmed. Chrome drops these when it ends a session
  // on its own, so we keep them and save them as a sentence instead.
  let unconfirmedText = '';
  // Per recognition session (Chrome numbers results from 0 each session): which
  // results were already saved, and the longest text each one showed live.
  let savedResultIndexes = new Set();
  let longestLiveTextByIndex = [];
  // The last few saved lines, to tell lost live words from words that moved.
  let recentlySaved = [];
  let lastResultAt = 0;
  // Whether this session has given any words yet, to log how long that took.
  let hasGivenWords = false;
  let isHearingSpeech = false;
  let stallCheck = null;

  function restartIfStalled() {
    if (!wantsToListen || !isHearingSpeech || performance.now() - lastResultAt < STALL_MS) return;
    onDebugEvent(`no results for ${STALL_MS / 1000} s while hearing speech: restarting recognition`);
    lastResultAt = performance.now();
    recognition.stop(); // onend saves anything unconfirmed and starts again
  }

  function fail(message) {
    wantsToListen = false;
    clearTimeout(slowStartTimer);
    clearInterval(stallCheck);
    onError(message);
  }

  function startRecognition() {
    try {
      recognition.start();
    } catch (error) {
      fail(`Couldn't start the microphone (${error.message}). Press Start to try again.`);
      onStopped(); // No onend follows a failed start, so report the stop here.
    }
  }

  recognition.onstart = () => {
    onDebugEvent('start');
    hasGivenWords = false;
    savedResultIndexes = new Set();
    longestLiveTextByIndex = [];
    lastResultAt = performance.now();
    clearTimeout(slowStartTimer);
    if (!hasStarted) {
      hasStarted = true;
      onListening();
    }
  };

  // Lets the page show whether the recognizer hears anything, which separates
  // "the mic picks up nothing" from "it hears sound but can't make out words".
  recognition.onsoundstart = () => onHearingChange('sound');
  recognition.onspeechstart = () => {
    onDebugEvent('hearing speech');
    isHearingSpeech = true;
    onHearingChange('speech');
  };
  recognition.onsoundend = () => onHearingChange('silence');
  recognition.onspeechend = () => {
    isHearingSpeech = false;
    onDebugEvent('speech ended');
  };
  recognition.onnomatch = () => onDebugEvent('no match (heard speech but could not recognize it)');

  // Looks at every result each time, not only the ones Chrome says changed, so a
  // result that is still unconfirmed while a newer one arrives is never skipped.
  // Chrome's result list is read by index (results[i], results.length), the
  // access it is guaranteed to support.
  function handleResults(results) {
    const textAt = (i) => (i < results.length ? results[i][0].transcript.trim() : '');
    const unconfirmedParts = [];

    for (let i = 0; i < results.length; i++) {
      const text = textAt(i);
      if (!results[i].isFinal) {
        if (text.length > (longestLiveTextByIndex[i] ?? '').length) longestLiveTextByIndex[i] = text;
        if (text) unconfirmedParts.push(text);
        continue;
      }
      if (savedResultIndexes.has(i)) continue;
      savedResultIndexes.add(i);
      const liveText = longestLiveTextByIndex[i] ?? '';
      const savedText = recoverDroppedWords(liveText, text, textAt(i + 1));
      // Each later result normally starts with a space; one that doesn't is the
      // rest of a word Chrome cut in two ("jour" + "ney").
      const keepsLostLiveText = isLostLiveText(liveText, savedText, recentlySaved.join(' '));
      if (keepsLostLiveText) {
        onDebugEvent(`  kept live text Chrome replaced: ${liveText}`);
        onFinal(liveText);
        recentlySaved = [...recentlySaved, liveText].slice(-3);
      }
      // After a kept line, the confirmed text starts fresh rather than finishing a word.
      const continuesPreviousWord = !keepsLostLiveText && i > 0 && /^[a-z]/.test(results[i][0].transcript);
      onDebugEvent(
        `confirmed #${i}${savedText === text ? '' : ' (restored dropped words)'}${continuesPreviousWord ? ' (continues the previous word)' : ''}: ${savedText}`,
      );
      if (normalizedWords(liveText).length > normalizedWords(savedText).length) {
        onDebugEvent(`  live text had been: ${liveText}`);
      }
      if (savedText) {
        onFinal(savedText, { continuesPreviousWord });
        recentlySaved = [...recentlySaved, savedText].slice(-3);
      }
    }

    unconfirmedText = unconfirmedParts.join(' ');
    onInterim(unconfirmedText);
  }

  recognition.onresult = (event) => {
    const gapMs = performance.now() - lastResultAt;
    if (hasGivenWords && gapMs >= GAP_MS) onDebugEvent(`words again after ${(gapMs / 1000).toFixed(1)} s without any`);
    lastResultAt = performance.now();
    if (!hasGivenWords) {
      hasGivenWords = true;
      onDebugEvent('first words');
    }
    try {
      handleResults(event.results);
    } catch (error) {
      // Never fail silently: a bug here would otherwise just look like "nothing recognized".
      onDebugEvent(`error while reading results: ${error.message}`);
      onProcessingError(`Something went wrong reading the speech results (${error.message}).`);
    }
  };

  recognition.onerror = (event) => {
    onDebugEvent(`error: ${event.error}`);
    if (RECOVERABLE_ERRORS.has(event.error)) return;
    fail(ERROR_MESSAGES[event.error] ?? `Speech recognition stopped (${event.error}). Press Start to try again.`);
  };

  recognition.onend = () => {
    onDebugEvent(`end${unconfirmedText ? ` (saving unconfirmed: ${unconfirmedText})` : ''}`);
    if (unconfirmedText) {
      onFinal(unconfirmedText);
      unconfirmedText = '';
      onInterim('');
    }
    if (wantsToListen) {
      startRecognition();
    } else {
      clearInterval(stallCheck);
      onStopped();
    }
  };

  return {
    start() {
      wantsToListen = true;
      hasStarted = false;
      slowStartTimer = setTimeout(() => {
        if (!hasStarted) onSlowStart();
      }, SLOW_START_MS);
      recentlySaved = [];
      isHearingSpeech = false;
      clearInterval(stallCheck);
      stallCheck = setInterval(restartIfStalled, 1000);
      startRecognition();
    },
    stop() {
      wantsToListen = false;
      clearTimeout(slowStartTimer);
      // Chrome confirms any words still in progress, then fires onend → onStopped.
      recognition.stop();
    },
  };
}
