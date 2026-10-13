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

// Chrome sometimes confirms a sentence with its last few words missing, even
// though they were shown live a moment earlier. If the confirmed text ends partway
// through the live text, and the missing words did not just move into the next
// result (followingText), add them back.
export function recoverDroppedWords(liveText, confirmedText, followingText = '') {
  const liveWords = normalizedWords(liveText);
  const confirmedWords = normalizedWords(confirmedText);
  if (confirmedWords.length === 0 || confirmedWords.length >= liveWords.length) return confirmedText;

  // Find where the confirmed text ends inside the live text, by its last one or two words.
  const anchor = confirmedWords.slice(-2);
  let anchorEnd = -1;
  for (let i = liveWords.length - anchor.length; i >= 0; i--) {
    if (anchor.every((word, offset) => liveWords[i + offset] === word)) {
      anchorEnd = i + anchor.length;
      break;
    }
  }
  if (anchorEnd < 0 || anchorEnd >= liveWords.length) return confirmedText;

  const droppedWords = liveWords.slice(anchorEnd);
  const followingWords = normalizedWords(followingText);
  const movedToNextResult = droppedWords.every((word, i) => followingWords[i] === word);
  if (movedToNextResult) return confirmedText;

  const originalLiveWords = liveText.trim().split(/\s+/);
  const droppedText = originalLiveWords.slice(originalLiveWords.length - droppedWords.length).join(' ');
  return `${confirmedText} ${droppedText}`;
}

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

  function fail(message) {
    wantsToListen = false;
    clearTimeout(slowStartTimer);
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
    savedResultIndexes = new Set();
    longestLiveTextByIndex = [];
    clearTimeout(slowStartTimer);
    if (!hasStarted) {
      hasStarted = true;
      onListening();
    }
  };

  // Lets the page show whether the recognizer hears anything, which separates
  // "the mic picks up nothing" from "it hears sound but can't make out words".
  recognition.onsoundstart = () => onHearingChange('sound');
  recognition.onspeechstart = () => onHearingChange('speech');
  recognition.onsoundend = () => onHearingChange('silence');
  recognition.onspeechend = () => onDebugEvent('speech ended');
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
      onDebugEvent(
        savedText === text ? `confirmed #${i}: ${text}` : `confirmed #${i} (restored dropped words): ${savedText}`,
      );
      if (savedText) onFinal(savedText);
    }

    unconfirmedText = unconfirmedParts.join(' ');
    onInterim(unconfirmedText);
  }

  recognition.onresult = (event) => {
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
