import {
  checkHeadlineWriterAvailability,
  createHeadlineWriter,
  isHeadlineWriterSupported,
  writeHeadline,
} from './headlines.js';
import { DEFAULT_TARGET_LANGUAGE, SOURCE_LANGUAGE, TARGET_LANGUAGES, findTargetLanguage } from './languages.js';
import { appendChunkSegments, segmentsToLines } from './complete-transcript.js';
import { createLiveDraft } from './live-draft.js';
import { CAPTURE_SAMPLE_RATE, isAudioCaptureSupported, startAudioCapture } from './recorder.js';
import { cleanHeadline, findSectionStarts, keywordTitle } from './sections.js';
import { createSpeechChunker } from './speech-chunks.js';
import { groupSpeakers, speakerNames } from './speakers.js';
import { createLiveTranscriber, isSpeechSupported } from './speech.js';
import { createTranscript } from './transcript.js';
import {
  checkTranslationAvailability,
  createTranslator,
  isTranslationSupported,
  joinTranslatedPieces,
  splitForTranslation,
  translateInPieces,
} from './translation.js';
import { LINE_FEED_MS, createTypedText, createTypewriterMachine } from './typewriter.js';
import {
  UnreadableAudioError,
  embedSpeakers,
  isWhisperSupported,
  transcribeAudio,
  transcribeRecording,
  warmUpWhisper,
} from './whisper.js';

const LANGUAGE_STORAGE_KEY = 'lectureLedger.targetLanguage';
// How often the sentence still being spoken is re-translated.
const LIVE_TRANSLATION_INTERVAL_MS = 400;

const noticesEl = document.getElementById('notices');
const courseNameInput = document.getElementById('courseName');
const languageSelect = document.getElementById('targetLanguage');
const speakerCountSelect = document.getElementById('speakerCount');
const timerEl = document.getElementById('timer');
const recordBtn = document.getElementById('recordBtn');
const flagBtn = document.getElementById('flagBtn');
const sectionBtn = document.getElementById('sectionBtn');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const translationStatusEl = document.getElementById('translationStatus');
const completeStatusEl = document.getElementById('completeStatus');
const translationHeadEl = document.getElementById('translationHead');
const interimEl = document.getElementById('interim');
const interimOriginalEl = document.getElementById('interimOriginal');
const interimTranslationEl = document.getElementById('interimTranslation');
// The live sentence is typed onto the paper by the typewriter drawn below it.
// Each typebar strikes the character just typed, and the paper jolts slightly.
function lastTypedCharacterPoint() {
  const text = interimOriginalEl.firstChild;
  if (!text?.length) return null;
  const range = document.createRange();
  range.setStart(text, text.length - 1);
  range.setEnd(text, text.length);
  const rect = [...range.getClientRects()].at(-1);
  return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
}

const typewriter = createTypewriterMachine(document.getElementById('typewriterArt'), {
  getStrikePoint: lastTypedCharacterPoint,
  onImpact() {
    interimEl.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(1.5px)' }, { transform: 'translateY(0)' }], {
      duration: 90,
    });
  },
});
const liveOriginal = createTypedText(interimOriginalEl, {
  onCharacterTyped(character) {
    typewriter.strike(character);
  },
});
// The live translation has a settled part (finished clauses, never changed) and
// a lighter tail (the clause still being spoken), which is updated in place.
// It isn't typed: retyping a changing translation made it flicker.
const liveTranslationSettledEl = document.getElementById('liveTranslationSettled');
const liveTranslationTailEl = document.getElementById('liveTranslationTail');
const liveTranslation = {
  text: '',
  show(settled, tail, languageCode) {
    this.text = joinTranslatedPieces([settled, tail].filter(Boolean), languageCode);
    liveTranslationSettledEl.textContent = settled;
    liveTranslationTailEl.textContent = settled && tail ? this.text.slice(settled.length) : tail;
  },
  clear() {
    this.text = '';
    liveTranslationSettledEl.textContent = '';
    liveTranslationTailEl.textContent = '';
  },
};
const emptyStateEl = document.getElementById('emptyState');
const backToLiveBtn = document.getElementById('backToLiveBtn');
const exportBtn = document.getElementById('exportBtn');
const clearBtn = document.getElementById('clearBtn');
const organizeBtn = document.getElementById('organizeBtn');
const uploadBtn = document.getElementById('uploadBtn');
const uploadInput = document.getElementById('uploadInput');
const notesStatusEl = document.getElementById('notesStatus');
const printTitleEl = document.getElementById('printTitle');
const printDetailsEl = document.getElementById('printDetails');

const diagnosticsEl = document.getElementById('diagnostics');
const diagnosticsCountEl = document.getElementById('diagnosticsCount');
const debugLogEl = document.getElementById('debugLog');
const copyLogBtn = document.getElementById('copyLogBtn');
// Open the page with ?debug to see every speech-recognition event, for diagnosing lost speech.
const isDebugMode = new URLSearchParams(location.search).has('debug');

const speechSupported = isSpeechSupported();
const translationSupported = isTranslationSupported();
const completeTranscriptSupported = isAudioCaptureSupported() && isWhisperSupported();

// 'idle' → 'starting' (waiting for the mic) → 'listening' → back to 'idle'.
let recorderState = 'idle';
let elapsedBeforePauseMs = 0;
let listeningSinceMs = null;
let timerInterval = null;
// The first sentence of the current recording, so Stop organizes only what was just recorded.
let firstRowThisRecording = null;
// Where the current recording starts on the timer.
let recordingStartMs = 0;
// The current recording's Whisper session (see startLiveWhisper), or null when
// recording without Whisper.
let liveWhisper = null;
// Bumped by Clear, so a complete transcript that finishes afterwards is not added back.
let clearCount = 0;
// False when this browser or page can't use the microphone.
let canRecord = true;
let isUploading = false;

// One translator per target language, created on first use and then reused.
const translatorsByLanguage = new Map();
// The same translators once they are ready, for live translation, which must never wait.
const readyTranslators = new Map();
let headlineWriterPromise = null;
let isOrganizing = false;

// ---------- Timer ----------

function elapsedMs() {
  return elapsedBeforePauseMs + (listeningSinceMs === null ? 0 : Date.now() - listeningSinceMs);
}

function formatClock(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

// Shown like a mechanical counter: each digit in its own window.
function renderTimer() {
  const clock = formatClock(elapsedMs());
  if (timerEl.dataset.clock === clock) return;
  timerEl.dataset.clock = clock;
  timerEl.setAttribute('aria-label', `Time listened: ${clock}`);
  timerEl.replaceChildren(
    ...[...clock].map((character) => {
      const cell = document.createElement('span');
      cell.className = character === ':' ? 'counter-separator' : 'counter-digit';
      cell.textContent = character;
      cell.setAttribute('aria-hidden', 'true');
      return cell;
    }),
  );
}

// ---------- Status messages ----------

function setStatus(message, { live = false, error = false } = {}) {
  statusText.textContent = message;
  statusDot.classList.toggle('live', live);
  statusText.parentElement.classList.toggle('error', error);
}

function setTranslationStatus(message, { error = false } = {}) {
  translationStatusEl.textContent = message;
  translationStatusEl.classList.toggle('error', error);
}

function setCompleteStatus(message, { error = false } = {}) {
  completeStatusEl.textContent = message;
  completeStatusEl.classList.toggle('error', error);
}

function setNotesStatus(message, { error = false } = {}) {
  notesStatusEl.textContent = message;
  notesStatusEl.classList.toggle('error', error);
}

function addNotice(message) {
  const notice = document.createElement('p');
  notice.className = 'notice';
  notice.textContent = message;
  noticesEl.appendChild(notice);
}

// ---------- Target language ----------

function selectedLanguage() {
  return findTargetLanguage(languageSelect.value);
}

function loadSavedLanguage() {
  try {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (findTargetLanguage(saved)) return saved;
  } catch {
    // Storage can be blocked (e.g. private windows); the default is fine then.
  }
  return DEFAULT_TARGET_LANGUAGE;
}

function saveLanguage(code) {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, code);
  } catch {
    // Not remembering the choice is harmless.
  }
}

function populateLanguageSelect() {
  for (const language of TARGET_LANGUAGES) {
    const option = document.createElement('option');
    option.value = language.code;
    option.textContent = `${language.english} · ${language.native}`;
    languageSelect.appendChild(option);
  }
  languageSelect.value = loadSavedLanguage();
}

function renderTranslationHead() {
  translationHeadEl.textContent = `Translation · ${selectedLanguage().native}`;
}

// Shows whether the chosen language is ready before the user presses Start.
async function describeTranslationReadiness() {
  if (!translationSupported) return;
  const language = selectedLanguage();
  if (translatorsByLanguage.has(language.code)) return;
  try {
    const availability = await checkTranslationAvailability(language.code);
    if (language !== selectedLanguage()) return;
    const messages = {
      available: `${language.english} translation is ready.`,
      downloadable: `The ${language.english} language pack will download the first time you press Start.`,
      downloading: `The ${language.english} language pack is downloading…`,
      unavailable: `This browser can't translate English into ${language.english}.`,
    };
    setTranslationStatus(messages[availability] ?? '', { error: availability === 'unavailable' });
  } catch (error) {
    setTranslationStatus(
      `Couldn't check ${language.english} translation (${error.message}). Translation may not work in this browser; desktop Chrome is recommended.`,
      { error: true },
    );
  }
}

// Call from a click or change handler when possible: a language pack that still
// needs downloading can only start downloading in response to a user action.
function prepareTranslator(language) {
  if (!translatorsByLanguage.has(language.code)) {
    const isStillSelected = () => language === selectedLanguage();
    setTranslationStatus(`Preparing ${language.english} translation…`);
    const translatorPromise = createTranslator(language.code, (fractionLoaded) => {
      if (isStillSelected()) {
        setTranslationStatus(
          `Downloading the ${language.english} language pack… ${Math.round(fractionLoaded * 100)}%`,
        );
      }
    })
      .then((translator) => {
        readyTranslators.set(language.code, translator);
        if (isStillSelected()) setTranslationStatus(`${language.english} translation is ready.`);
        return translator;
      })
      .catch((error) => {
        translatorsByLanguage.delete(language.code);
        if (isStillSelected()) {
          setTranslationStatus(`Couldn't set up ${language.english} translation: ${error.message}`, {
            error: true,
          });
        }
        throw error;
      });
    translatorsByLanguage.set(language.code, translatorPromise);
  }
  return translatorsByLanguage.get(language.code);
}

async function translateText(text, languageCode) {
  if (!translationSupported) return '—';
  // If an earlier setup attempt failed (e.g. the language pack was still installing),
  // try again: once the pack is installed, no click is needed to create a translator.
  const translator = await prepareTranslator(findTargetLanguage(languageCode));
  return translateInPieces(translator, text, languageCode);
}

// ---------- Diagnostics ----------

let debugEventCount = 0;

function logDebugEvent(message) {
  if (!isDebugMode) return;
  debugEventCount++;
  diagnosticsCountEl.textContent = `${debugEventCount} event${debugEventCount === 1 ? '' : 's'}`;
  debugLogEl.textContent += `[${formatClock(elapsedMs())}] ${message}\n`;
  debugLogEl.scrollTop = debugLogEl.scrollHeight;
}

// Records the state of the on-device AI model used for section titles, since a
// multi-GB download running in the background may slow speech recognition.
async function logAiModelStatus() {
  if (!isHeadlineWriterSupported()) {
    logDebugEvent('section-title AI: not in this browser');
    return;
  }
  try {
    logDebugEvent(`section-title AI model: ${await checkHeadlineWriterAvailability()}`);
  } catch (error) {
    logDebugEvent(`section-title AI model: couldn't check (${error.message})`);
  }
}

async function copyDebugLog() {
  try {
    await navigator.clipboard.writeText(debugLogEl.textContent);
    copyLogBtn.textContent = 'Copied ✓';
  } catch {
    copyLogBtn.textContent = "Couldn't copy: select the text instead";
  }
  setTimeout(() => {
    copyLogBtn.textContent = 'Copy log';
  }, 2000);
}

// ---------- Live (in-progress) sentence ----------

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let isLiveTranslating = false;

// Keeps re-translating the sentence being spoken, at most every
// LIVE_TRANSLATION_INTERVAL_MS, until it stops changing.
// Translations of clauses, so finished ones never change once shown.
const liveClauseTranslations = new Map();

async function translateClause(translator, clause, languageCode) {
  const key = `${languageCode}|${clause}`;
  if (!liveClauseTranslations.has(key)) {
    liveClauseTranslations.set(key, (await translator.translate(clause)).trim());
  }
  return liveClauseTranslations.get(key);
}

// Translates the sentence being spoken clause by clause, at most every
// LIVE_TRANSLATION_INTERVAL_MS while it keeps changing. Finished clauses are
// translated once and stay put; only the clause still being spoken (the tail)
// is re-translated, so the beginning of the translation never rewords itself.
async function keepLiveSentenceTranslated() {
  if (isLiveTranslating) return;
  isLiveTranslating = true;
  try {
    while (liveOriginal.text) {
      const languageCode = selectedLanguage().code;
      const translator = readyTranslators.get(languageCode);
      if (!translator) break;
      const text = liveOriginal.text;
      const clauses = splitForTranslation(text);
      const settled = [];
      for (const clause of clauses.slice(0, -1)) settled.push(await translateClause(translator, clause, languageCode));
      const tail = clauses.length > 0 ? await translateClause(translator, clauses.at(-1), languageCode) : '';
      if (liveOriginal.text !== text) continue;
      liveTranslation.show(joinTranslatedPieces(settled, languageCode), tail, languageCode);
      await delay(LIVE_TRANSLATION_INTERVAL_MS);
      if (liveOriginal.text === text) break;
    }
  } catch {
    // Live translation is a preview; the confirmed sentence is translated again anyway.
  } finally {
    isLiveTranslating = false;
  }
}

// While recording, the live row stays visible even between sentences (showing
// "Listening…"), so the page never jumps as it would if the row collapsed.
function showLiveSentence(text) {
  liveOriginal.set(text);
  if (!text) {
    liveTranslation.clear();
    liveClauseTranslations.clear();
  }
  interimEl.hidden = !text && !isTypewriterActive();
  renderTranscriptState();
  if (text && translationSupported) keepLiveSentenceTranslated();
  keepLiveRowCentered();
}

// ---------- Following the live sentence ----------

// While recording, the live row is the end of the paper, where the typewriter
// types. It moves down the screen until it reaches the middle; after that, each
// finished sentence stays where it was typed and the whole sheet rolls up, like
// paper fed by a typewriter's platen, until the live row is back in the middle.
// The user can scroll away to read ("Back to live" brings the live row back).
let isFollowingLive = true;
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
// How long the paper takes to roll up by a line, as the platen turns.
const ROLL_MS = LINE_FEED_MS;
let rollFrameId = null;

function liveRowDistanceFromCenter() {
  const rect = interimEl.getBoundingClientRect();
  return rect.top + rect.height / 2 - window.innerHeight / 2;
}

// Starts and stops gently, like the platen's turn.
function easeInOut(progress) {
  return (1 - Math.cos(Math.PI * progress)) / 2;
}

// Where the page should be scrolled to: the live row in the middle of the
// screen, or as far as the page goes (the typewriter at the bottom of the
// screen, with the paper coming out of it).
function rollTargetY() {
  const bottomY = document.documentElement.scrollHeight - window.innerHeight;
  return Math.min(window.scrollY + liveRowDistanceFromCenter(), bottomY);
}

// Rolls the whole sheet up over ROLL_MS until the live row is back in place
// (see rollTargetY). Never rolls it back down.
function rollPaperToLiveRow() {
  if (!isFollowingLive || interimEl.hidden) return;
  if (prefersReducedMotion.matches) {
    window.scrollTo({ top: Math.max(window.scrollY, rollTargetY()), behavior: 'instant' });
    return;
  }
  cancelAnimationFrame(rollFrameId);
  const startY = window.scrollY;
  const startTime = performance.now();
  const step = (now) => {
    const progress = Math.min((now - startTime) / ROLL_MS, 1);
    // Measured every frame, in case the live row grows while the paper rolls.
    const targetY = Math.max(startY, rollTargetY());
    window.scrollTo({ top: startY + (targetY - startY) * easeInOut(progress), behavior: 'instant' });
    rollFrameId = progress < 1 && isFollowingLive ? requestAnimationFrame(step) : null;
  };
  rollFrameId = requestAnimationFrame(step);
}

// For gradual changes, like the live sentence growing by a line: small drifts
// are left alone, to avoid jitter.
function keepLiveRowCentered() {
  if (!isFollowingLive || interimEl.hidden || rollFrameId !== null) return;
  if (liveRowDistanceFromCenter() < window.innerHeight * 0.12) return;
  rollPaperToLiveRow();
}

function setFollowingLive(following) {
  isFollowingLive = following;
  backToLiveBtn.hidden = following || !isTypewriterActive();
}

function stopFollowingWhenUserScrollsUp(event) {
  if (!isTypewriterActive() || !isFollowingLive) return;
  const scrollsUp = event.type === 'wheel' ? event.deltaY < 0 : ['ArrowUp', 'PageUp', 'Home'].includes(event.key);
  if (scrollsUp || event.type === 'touchmove') setFollowingLive(false);
}

window.addEventListener('wheel', stopFollowingWhenUserScrollsUp, { passive: true });
window.addEventListener('touchmove', stopFollowingWhenUserScrollsUp, { passive: true });
window.addEventListener('keydown', stopFollowingWhenUserScrollsUp);
// Scrolling back to the live row by hand resumes following.
window.addEventListener(
  'scroll',
  () => {
    if (!isFollowingLive && !interimEl.hidden && Math.abs(liveRowDistanceFromCenter()) < window.innerHeight * 0.15) {
      setFollowingLive(true);
    }
  },
  { passive: true },
);
// The live row grows as words are typed.
new ResizeObserver(() => keepLiveRowCentered()).observe(interimEl);
// Lines above it grow when a sentence continues or a translation arrives; the
// sheet rolls up by that much (a roll already under way follows on its own).
new ResizeObserver(() => {
  if (isFollowingLive && !interimEl.hidden && rollFrameId === null && liveRowDistanceFromCenter() > 2) {
    rollPaperToLiveRow();
  }
}).observe(document.getElementById('rows'));

backToLiveBtn.addEventListener('click', () => {
  setFollowingLive(true);
  interimEl.scrollIntoView({ block: 'center', behavior: prefersReducedMotion.matches ? 'instant' : 'smooth' });
});

// ---------- Transcript ----------

function renderTranscriptState() {
  emptyStateEl.hidden = transcript.hasContent() || !interimEl.hidden;
  flagBtn.disabled = !transcript.hasLines();
  organizeBtn.disabled = isOrganizing || !transcript.hasLines();
}

const transcript = createTranscript({
  rowsEl: document.getElementById('rows'),
  outlineEl: document.getElementById('outline'),
  outlineListEl: document.getElementById('outlineList'),
  translateText,
  onChange: renderTranscriptState,
});

// ---------- Typing onto the paper ----------

// The typewriter is busy while recording, and while it types an uploaded recording.
let isTypingUpload = false;

function isTypewriterActive() {
  return recorderState !== 'idle' || isTypingUpload;
}

function renderTypewriterActive() {
  document.body.classList.toggle('is-typing', isTypewriterActive());
  setFollowingLive(true);
  renderUploadAvailability();
}

// Moves the live line onto the paper as a finished line, where it was typed:
// the platen turns and the sheet rolls up. Returns the new row.
function commitLiveLine(text, { timeLabel, elapsedMs: lineElapsedMs, targetLanguage }) {
  const provisionalTranslation = liveTranslation.text;
  liveOriginal.clear();
  liveTranslation.clear();
  typewriter.lineFeed();
  const row = transcript.addLine(text, { timeLabel, elapsedMs: lineElapsedMs, targetLanguage, provisionalTranslation });
  rollPaperToLiveRow();
  return row;
}

// ---------- Recording ----------

// Chrome sometimes confirms a tiny piece like "and then" on its own. Pieces
// shorter than this wait in the live row and join the next line instead of
// sitting alone on a line.
const MIN_WORDS_PER_LIVE_LINE = 4;
// { text, timeLabel } of a short piece waiting to join the next line, or null.
let heldPiece = null;
// The latest line of this recording, which the rest of a cut-off word joins.
let lastLiveRow = null;

function wordCount(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

function withHeldPiece(text) {
  return heldPiece ? [heldPiece.text, text].filter(Boolean).join(' ') : text;
}

function commitLiveSpeech(text) {
  const row = commitLiveLine(text, {
    timeLabel: heldPiece?.timeLabel ?? formatClock(elapsedMs()),
    elapsedMs: elapsedMs(),
    targetLanguage: selectedLanguage().code,
  });
  heldPiece = null;
  lastLiveRow = row;
  firstRowThisRecording ??= row;
}

// When recording ends, a waiting short piece still becomes a line, so nothing is lost.
function commitHeldPiece() {
  if (heldPiece) commitLiveSpeech(heldPiece.text);
}

function renderRecordButton() {
  const isActive = recorderState !== 'idle';
  recordBtn.textContent = isActive ? '■ Stop listening' : '● Start listening';
  recordBtn.classList.toggle('recording', isActive);
}

function enterIdle() {
  recorderState = 'idle';
  renderTypewriterActive();
  if (listeningSinceMs !== null) {
    elapsedBeforePauseMs = elapsedMs();
    listeningSinceMs = null;
  }
  clearInterval(timerInterval);
  renderTimer();
  renderRecordButton();
}

const transcriber = speechSupported
  ? createLiveTranscriber({
      speechCode: SOURCE_LANGUAGE.speechCode,
      onListening() {
        recorderState = 'listening';
        renderTypewriterActive();
        showLiveSentence('');
        listeningSinceMs = Date.now();
        timerInterval = setInterval(renderTimer, 250);
        setStatus('Listening…', { live: true });
      },
      onSlowStart() {
        setStatus(
          'Still waiting for the microphone. If no permission prompt appeared, click the icon at the left of the address bar and allow the microphone.',
        );
      },
      onHearingChange(hearing) {
        if (recorderState !== 'listening') return;
        const messages = {
          silence: 'Listening… (no sound yet)',
          sound: 'Listening… (hearing sound)',
          speech: 'Listening… (hearing speech)',
        };
        setStatus(messages[hearing], { live: true });
      },
      onInterim(text) {
        // While Whisper writes the transcript, Chrome's words are only the live row's draft.
        if (liveWhisper) {
          liveDraft.setUnconfirmed(text, performance.now());
          showDraft();
          return;
        }
        showLiveSentence(withHeldPiece(text));
      },
      onFinal(text, { continuesPreviousWord = false } = {}) {
        if (liveWhisper) {
          liveDraft.addConfirmed(text, performance.now(), { continuesPreviousWord });
          showDraft();
          return;
        }
        // The rest of a word Chrome cut in two joins the end of the text before it.
        if (continuesPreviousWord) {
          if (heldPiece) {
            heldPiece.text += text;
            if (wordCount(heldPiece.text) >= MIN_WORDS_PER_LIVE_LINE) commitLiveSpeech(heldPiece.text);
            else showLiveSentence(heldPiece.text);
            return;
          }
          if (lastLiveRow?.isConnected) {
            transcript.appendToLine(lastLiveRow, text);
            return;
          }
        }
        const combined = withHeldPiece(text);
        if (wordCount(combined) < MIN_WORDS_PER_LIVE_LINE) {
          heldPiece = { text: combined, timeLabel: heldPiece?.timeLabel ?? formatClock(elapsedMs()) };
          showLiveSentence(combined);
          return;
        }
        commitLiveSpeech(combined);
      },
      onError(message) {
        enterIdle();
        setStatus(message, { error: true });
      },
      onDebugEvent: logDebugEvent,
      onProcessingError(message) {
        setStatus(message, { live: true, error: true });
      },
      onStopped() {
        if (liveWhisper) {
          const session = liveWhisper;
          liveWhisper = null;
          finishLiveWhisper(session);
          return;
        }
        commitHeldPiece();
        showLiveSentence('');
        const firstRow = firstRowThisRecording;
        firstRowThisRecording = null;
        if (firstRow) organizeSections(transcript.linesFrom(firstRow));
      },
    })
  : null;

function startListening() {
  heldPiece = null;
  lastLiveRow = null;
  firstRowThisRecording = null;
  recordingStartMs = elapsedMs();
  liveWhisper = completeTranscriptSupported ? startLiveWhisper() : null;
  recorderState = 'starting';
  renderRecordButton();
  setStatus('Starting the microphone…');
  if (translationSupported) prepareTranslator(selectedLanguage()).catch(() => {});
  transcriber.start();
}

function stopListening() {
  transcriber.stop();
  enterIdle();
  setStatus('Paused. Press Start to keep going.');
}

// ---------- Complete transcript (Whisper) ----------

function describeWhisperProgress(progress) {
  if (progress.type === 'loading') {
    return `Complete transcript: loading Whisper speech recognition (downloads about 200 MB the first time)… ${Math.round(progress.fraction * 100)}%`;
  }
  if (progress.type === 'starting') {
    return progress.device === 'webgpu'
      ? 'Complete transcript: starting Whisper on the graphics chip (the first time can take a minute)…'
      : 'Complete transcript: starting Whisper on the processor (slower than the graphics chip)…';
  }
  if (progress.type === 'retrying') {
    return 'Complete transcript: Whisper got stuck on the graphics chip, so it is trying again on the processor (slower)…';
  }
  return `Complete transcript: transcribing ${formatClock(progress.doneSeconds * 1000)} of ${formatClock(progress.totalSeconds * 1000)}…`;
}

// ---------- Live transcript from Whisper ----------

// While recording, two recognizers listen. Chrome's is instant, so the
// typewriter types its words in the live row as they are said, but it loses
// whole stretches. Whisper's is complete but a few seconds behind: the
// microphone's audio is cut into chunks at pauses (js/speech-chunks.js), and
// each finished sentence Whisper writes rolls onto the paper, taking the same
// words out of the live row (js/live-draft.js).

const liveDraft = createLiveDraft();
// The session whose words are in the live row, also while it finishes after Stop.
let draftSession = null;
// A chunk can finish several sentences at once; they go onto the paper one by
// one, each after the paper has finished rolling up for the one before.
const LINE_SPACING_MS = ROLL_MS + 300;

// While Whisper loads (or once it is ready); null when it hasn't been asked to.
let whisperWarming = null;

// Gets Whisper loaded and run once before the first chunk needs it, which
// otherwise held up the first sentences by several seconds.
function warmUpWhisperEarly({ onlyIfDownloaded, onProgress }) {
  const startedAt = performance.now();
  whisperWarming = warmUpWhisper({ onlyIfDownloaded, onProgress })
    .then((isWarm) => {
      if (isWarm) logDebugEvent(`Whisper ready after ${((performance.now() - startedAt) / 1000).toFixed(1)} s`);
      else whisperWarming = null;
      return isWarm;
    })
    .catch((error) => {
      logDebugEvent(`Whisper couldn't start early: ${error.message}`);
      whisperWarming = null;
      return false;
    });
}

function startLiveWhisper() {
  const session = {
    startMs: recordingStartMs,
    clearCountAtStart: clearCount,
    audioFrames: [],
    // When the first audio arrived (performance.now()), the start of Whisper's timestamps.
    audioStartMs: null,
    segments: [],
    lines: [],
    // Lines on the paper so far.
    committed: 0,
    rows: [],
    spans: [],
    commitTimer: null,
    // A line Chrome missed, being typed in the live row before it rolls onto the paper.
    typingLine: null,
    ended: false,
    transcribed: Promise.resolve(),
    hasResult: false,
    allCommitted: null,
  };
  session.chunker = createSpeechChunker({
    sampleRate: CAPTURE_SAMPLE_RATE,
    onChunk: (chunk) => transcribeLiveChunk(session, chunk),
  });
  session.capturing = startAudioCapture({
    onAudio(samples) {
      session.audioStartMs ??= performance.now() - (samples.length / CAPTURE_SAMPLE_RATE) * 1000;
      session.audioFrames.push(samples);
      session.chunker.push(samples);
    },
  }).catch((error) => {
    logDebugEvent(`audio capture failed: ${error.message}`);
    setCompleteStatus(`Couldn't capture audio for Whisper (${error.message}). Using Chrome's live recognition only.`, {
      error: true,
    });
    if (liveWhisper === session) liveWhisper = null;
    releaseDraft(session);
    return null;
  });
  if (!whisperWarming) {
    warmUpWhisperEarly({
      onlyIfDownloaded: false,
      onProgress(progress) {
        if (!session.hasResult) setCompleteStatus(describeWhisperProgress(progress));
      },
    });
  }
  draftSession = session;
  liveDraft.clear();
  return session;
}

// Empties the live row, unless a newer recording already took it over.
function releaseDraft(session) {
  if (draftSession !== session) return;
  draftSession = null;
  liveDraft.clear();
  showLiveSentence('');
}

function isSessionCurrent(session) {
  return clearCount === session.clearCountAtStart;
}

function transcribeLiveChunk(session, chunk) {
  const endSeconds = chunk.startSeconds + chunk.audio.length / CAPTURE_SAMPLE_RATE;
  if (chunk.isSilent) {
    logDebugEvent(`audio ${chunk.startSeconds.toFixed(1)}–${endSeconds.toFixed(1)} s: silence, skipped`);
    return;
  }
  // Chunks are handled strictly in order, so the text grows in order.
  session.transcribed = session.transcribed.then(async () => {
    try {
      const { segments } = await transcribeAudio(chunk.audio, (progress) => {
        if (!session.hasResult && progress.type !== 'partial') setCompleteStatus(describeWhisperProgress(progress));
      });
      logDebugEvent(`Whisper, ${chunk.startSeconds.toFixed(1)}–${endSeconds.toFixed(1)} s: ${segments.map((segment) => segment.text.trim()).join(' ')}`);
      if (!isSessionCurrent(session)) return;
      if (!session.hasResult) {
        session.hasResult = true;
        setCompleteStatus('Whisper is writing the transcript, a few seconds behind the speaker.');
      }
      session.segments = appendChunkSegments(
        session.segments,
        segments.map((segment) => ({
          ...segment,
          startSeconds: segment.startSeconds + chunk.startSeconds,
          endSeconds: segment.endSeconds + chunk.startSeconds,
        })),
      );
      updateSessionLines(session);
    } catch (error) {
      logDebugEvent(`Whisper failed on ${chunk.startSeconds.toFixed(1)}–${endSeconds.toFixed(1)} s: ${error.message}`);
    }
  });
}

// The live row: a line the typewriter is finishing before it goes onto the
// paper (see typeBeforeRolling), or else Chrome's draft.
function showDraft() {
  showLiveSentence(draftSession?.typingLine?.text ?? liveDraft.text);
}

// Words that went onto the paper (text, ending at line's end) leave the live
// row. Returns false when they weren't in it, because Chrome missed them.
function takeOffDraft(session, text, line) {
  if (draftSession !== session || !text) return true;
  const wasShown = liveDraft.addPaperLine(text, session.audioStartMs + line.endSeconds * 1000);
  showDraft();
  return wasShown;
}

function updateSessionLines(session) {
  const lines = segmentsToLines(session.segments);
  // A new chunk can continue the sentence that went onto the paper last.
  const lastCommitted = session.committed - 1;
  const grownLine = lastCommitted >= 0 ? lines[lastCommitted] : null;
  if (grownLine && grownLine.text !== session.spans[lastCommitted].text) {
    const oldWordCount = session.spans[lastCommitted].text.split(/\s+/).length;
    transcript.setLineText(session.rows[lastCommitted], grownLine.text);
    session.spans[lastCommitted] = grownLine;
    takeOffDraft(session, grownLine.text.split(/\s+/).slice(oldWordCount).join(' '), grownLine);
  }
  session.lines = lines;
  commitFinishedLines(session);
}

// A sentence still being spoken goes onto the paper once it is this long, and
// keeps growing there, instead of keeping the paper far behind the speaker.
const MIN_WORDS_OF_UNFINISHED_LINE = 15;

// The last line may still be growing; it is ready for the paper once a
// sentence ends, it is long, a newer line starts, or the recording ends.
function isLineFinished(session, index) {
  const line = session.lines[index];
  const isLast = index === session.lines.length - 1;
  return (
    !isLast ||
    session.ended ||
    /[.?!]["')\]]?$/.test(line.text) ||
    line.text.split(/\s+/).length >= MIN_WORDS_OF_UNFINISHED_LINE
  );
}

function addSessionRow(session, line) {
  const row = transcript.addLine(line.text, {
    timeLabel: formatClock(session.startMs + line.startSeconds * 1000),
    elapsedMs: session.startMs + line.endSeconds * 1000,
    targetLanguage: selectedLanguage().code,
  });
  session.rows.push(row);
  session.spans.push(line);
  session.committed++;
  return row;
}

// Rolls the next finished line onto the paper, then the one after it a moment later.
function commitFinishedLines(session) {
  if (session.commitTimer || session.typingLine) return;
  if (session.committed >= session.lines.length || !isLineFinished(session, session.committed)) {
    if (session.ended && session.committed === session.lines.length) session.allCommitted?.();
    return;
  }
  const line = session.lines[session.committed];
  // Chrome shows words a moment after Whisper may have finished them: when the
  // live row has only the start of this line, the typewriter types the rest
  // after it, rather than erasing what is there.
  const restOfLine = draftSession === session ? liveDraft.restOfLine(line.text) : null;
  if (restOfLine) {
    logDebugEvent(`Chrome is behind, so the typewriter finishes the line: …${restOfLine}`);
    typeBeforeRolling(session, line, `${liveDraft.text} ${restOfLine}`);
    return;
  }
  // A line Chrome missed is typed first only while the live row is empty (Chrome
  // is quiet or hasn't started): typing it in front of Chrome's words meant
  // erasing and retyping the whole live row, which looked jumpy.
  if (takeOffDraft(session, line.text, line) || liveDraft.text) {
    rollOntoPaper(session, line);
  } else {
    logDebugEvent(`Chrome missed this line, so the typewriter types it: ${line.text}`);
    typeBeforeRolling(session, line, line.text, { isOffDraft: true });
  }
}

function rollOntoPaper(session, line) {
  addSessionRow(session, line);
  typewriter.lineFeed();
  rollPaperToLiveRow();
  session.commitTimer = setTimeout(() => {
    session.commitTimer = null;
    commitFinishedLines(session);
  }, LINE_SPACING_MS);
}

// The typewriter finishes a line in the live row (typedText: what the row
// shows once it is done) before it rolls onto the paper, like every other line:
// a line Chrome missed (while its recognition starts, or when it stalls), or
// one whose end Chrome hasn't shown yet. isOffDraft: its words already left
// Chrome's draft.
async function typeBeforeRolling(session, line, typedText, { isOffDraft = false } = {}) {
  const typingLine = { text: typedText };
  session.typingLine = typingLine;
  if (isOffDraft) showDraft();
  else takeOffDraft(session, line.text, line);
  // Typing normally finishes in well under a second; don't wait forever if animation stops.
  await Promise.race([liveOriginal.whenTyped(typedText.length), delay(1500 + typedText.length * 25)]);
  if (session.typingLine !== typingLine) return; // cleared, or the recording finished without it
  session.typingLine = null;
  showDraft();
  rollOntoPaper(session, line);
}

function joinAudio(frames) {
  const audio = new Float32Array(frames.reduce((length, frame) => length + frame.length, 0));
  let offset = 0;
  for (const frame of frames) {
    audio.set(frame, offset);
    offset += frame.length;
  }
  return audio;
}

// After Stop: Whisper transcribes the last chunk and its lines roll onto the
// paper; then speakers are told apart and the recording is split into sections.
async function finishLiveWhisper(session) {
  const capture = await session.capturing;
  capture?.stop();
  session.chunker.flush();
  setCompleteStatus('Whisper is finishing the last sentence…');
  await session.transcribed;
  if (!isSessionCurrent(session)) {
    releaseDraft(session);
    return;
  }
  session.ended = true;
  const allCommitted = new Promise((resolve) => {
    session.allCommitted = resolve;
  });
  updateSessionLines(session);
  await Promise.race([allCommitted, delay((LINE_SPACING_MS + 1500) * (session.lines.length - session.committed + 1))]);
  clearTimeout(session.commitTimer);
  session.commitTimer = null;
  session.typingLine = null;
  for (const line of session.lines.slice(session.committed)) addSessionRow(session, line);
  releaseDraft(session);
  if (session.rows.length === 0) {
    setCompleteStatus('Whisper heard no speech in this recording.', { error: !session.hasResult });
    return;
  }
  const summary = `Transcript ready: ${session.rows.length} sentence${session.rows.length === 1 ? '' : 's'} from Whisper.`;
  setCompleteStatus(summary);
  const speakerNames = await identifySpeakers(joinAudio(session.audioFrames), session.rows, session.spans, 'Transcript');
  if (!isSessionCurrent(session)) return;
  setCompleteStatus(describeSpeakersFound(summary, speakerNames));
  organizeSections(transcript.linesFrom(session.rows[0]).slice(0, session.rows.length));
}

// ---------- Speakers ----------

// Tells the speakers of the given rows apart by voice and labels them Speaker 1,
// Speaker 2, …. spans: each row's place in the audio ({ startSeconds,
// endSeconds }). Resolves to the names found, or null.
async function identifySpeakers(audio, rows, spans, sourceName) {
  if (rows.length === 0) return null;
  const clearCountAtStart = clearCount;
  setCompleteStatus(`${sourceName}: telling speakers apart…`);
  try {
    const { embeddings, device } = await embedSpeakers(
      audio,
      spans.map(({ startSeconds, endSeconds }) => ({ startSeconds, endSeconds })),
      (progress) => {
        if (progress.type === 'loading') {
          setCompleteStatus(
            `${sourceName}: downloading the speaker model (first time only, about 26 MB)… ${Math.round(progress.fraction * 100)}%`,
          );
        } else if (progress.type === 'speaker-progress') {
          setCompleteStatus(`${sourceName}: telling speakers apart… ${progress.done} of ${progress.total} sentences`);
        }
      },
    );
    if (clearCount !== clearCountAtStart) return null;
    const recording = { rows, embeddings };
    labeledRecordings.push(recording);
    const names = labelSpeakers(recording);
    logDebugEvent(`speakers (${device}): ${names.join(', ')}`);
    return names;
  } catch (error) {
    logDebugEvent(`telling speakers apart failed: ${error.message}`);
    return null;
  }
}

// Recordings whose voices have been fingerprinted, so changing "People speaking"
// can relabel them at once without processing the audio again.
let labeledRecordings = [];

function chosenSpeakerCount() {
  return speakerCountSelect.value === 'auto' ? null : Number(speakerCountSelect.value);
}

// Groups a recording's lines by voice and shows a tag for each speaker. Returns the names.
function labelSpeakers({ rows, embeddings }) {
  const round = (numbers) => numbers.map((number) => number.toFixed(2)).join(', ');
  const speakers = groupSpeakers(embeddings, {
    speakerCount: chosenSpeakerCount(),
    onDetails({ smallGroups, mergeSimilarities, closestUnmerged, clusterLineCounts, clusterSimilarities }) {
      logDebugEvent(
        `voices: ${embeddings.length} lines → ${smallGroups} small groups; merges at [${round(mergeSimilarities)}]` +
          `${closestUnmerged === null ? '' : `; stopped at ${closestUnmerged.toFixed(2)}`}; speakers have ${clusterLineCounts.join(' / ')} lines;` +
          ` speaker-to-speaker similarity [${round(clusterSimilarities)}]`,
      );
    },
  });
  const names = speakerNames(speakers);
  transcript.assignSpeakers(rows, speakers, names);
  return names;
}

speakerCountSelect.addEventListener('change', () => {
  labeledRecordings = labeledRecordings.filter(({ rows }) => rows.some((row) => row.isConnected));
  const allNames = labeledRecordings.map((recording) => labelSpeakers(recording));
  if (allNames.length > 0) setCompleteStatus(`Speakers relabeled: ${allNames.map((names) => names.join(', ')).join(' / ')}.`);
});

function describeSpeakersFound(summary, names) {
  if (!names) return `${summary} (Couldn't tell speakers apart.)`;
  if (names.length === 1) return `${summary} One speaker. Click the name to rename them.`;
  return `${summary} ${names.length} speakers. Click a name to rename them.`;
}

// ---------- Uploading a recording ----------

// While few lines are waiting, each is typed out; with more, they roll in
// directly so a long recording doesn't take longer to show than to transcribe.
const TYPE_LINES_WHEN_FEWER_THAN = 6;

function renderUploadAvailability() {
  uploadBtn.disabled = !completeTranscriptSupported || isUploading || recorderState !== 'idle';
  recordBtn.disabled = !canRecord || isUploading;
}

function describeUploadProgress(fileName, progress) {
  if (progress.type === 'partial' || progress.type === 'progress') {
    return `${fileName}: transcribing ${formatClock(progress.doneSeconds * 1000)} of ${formatClock(progress.totalSeconds * 1000)}…`;
  }
  return describeWhisperProgress(progress).replace('Complete transcript', fileName);
}

// Transcribes an audio or video file with Whisper and adds it after the
// current transcript, under a divider with the file's name. Lines appear as
// each minute of audio is done, typed by the typewriter; then the recording is
// organized into sections.
async function transcribeUploadedFile(file) {
  if (isUploading || recorderState !== 'idle') return;
  isUploading = true;
  renderUploadAvailability();
  const clearCountAtStart = clearCount;
  const wasCleared = () => clearCount !== clearCountAtStart;
  const targetLanguage = selectedLanguage().code;
  if (translationSupported) prepareTranslator(selectedLanguage()).catch(() => {});

  transcript.addDivider(file.name);
  setCompleteStatus(`${file.name}: reading the file…`);

  const segmentsSoFar = [];
  let linesQueued = 0;
  const lineQueue = [];
  const uploadRows = [];
  let typingDone = Promise.resolve();

  const toRowLine = (line) => ({
    text: line.text,
    timeLabel: formatClock(line.startSeconds * 1000),
    elapsedMs: line.endSeconds * 1000,
    targetLanguage,
    startSeconds: line.startSeconds,
    endSeconds: line.endSeconds,
  });
  // Where each added row is in the audio, for telling speakers apart.
  const uploadSpans = [];

  async function typeQueuedLines() {
    isTypingUpload = true;
    renderTypewriterActive();
    while (lineQueue.length > 0 && !wasCleared()) {
      const line = lineQueue.shift();
      const typeIt = lineQueue.length < TYPE_LINES_WHEN_FEWER_THAN && !document.hidden;
      if (typeIt) {
        showLiveSentence(line.text);
        // If animation frames stop (some browsers pause them), don't wait forever.
        await Promise.race([liveOriginal.whenTyped(), delay(1500 + line.text.length * 25)]);
        await delay(120);
      }
      if (wasCleared()) break;
      uploadRows.push(commitLiveLine(line.text, line));
      uploadSpans.push(line);
    }
    isTypingUpload = false;
    showLiveSentence('');
    renderTypewriterActive();
  }

  // Queues the lines that are certainly complete; the last line may still
  // continue in the next minute of audio, unless this is the end.
  function queueReadyLines({ isEnd }) {
    const lines = segmentsToLines(segmentsSoFar);
    const ready = lines.slice(linesQueued, isEnd ? lines.length : -1);
    if (ready.length === 0) return;
    linesQueued += ready.length;
    lineQueue.push(...ready.map(toRowLine));
    if (!isTypingUpload) typingDone = typeQueuedLines();
  }

  try {
    const { device, audio } = await transcribeRecording(file, (progress) => {
      if (wasCleared()) return;
      if (progress.type === 'retrying') {
        // Whisper starts over on the processor, so its partial lines are taken back.
        lineQueue.length = 0;
        segmentsSoFar.length = 0;
        linesQueued = 0;
        transcript.removeLines(uploadRows.splice(0));
        uploadSpans.length = 0;
      }
      if (progress.type === 'partial') {
        segmentsSoFar.push(...progress.segments);
        queueReadyLines({ isEnd: false });
      }
      setCompleteStatus(describeUploadProgress(file.name, progress));
    });
    if (wasCleared()) {
      setCompleteStatus('');
      return;
    }
    queueReadyLines({ isEnd: true });
    await typingDone;
    logDebugEvent(`Whisper (${device}) transcribed ${file.name}: ${uploadRows.length} lines`);
    if (uploadRows.length === 0) {
      setCompleteStatus(`${file.name}: Whisper heard no speech in this file.`, { error: true });
      return;
    }
    const summary = `${file.name}: done, ${uploadRows.length} sentence${uploadRows.length === 1 ? '' : 's'}.`;
    const speakerNames = await identifySpeakers(audio, uploadRows, uploadSpans, file.name);
    if (wasCleared()) return;
    setCompleteStatus(describeSpeakersFound(summary, speakerNames));
    organizeSections(transcript.linesFrom(uploadRows[0]).slice(0, uploadRows.length));
  } catch (error) {
    logDebugEvent(`Upload failed: ${error.message}`);
    setCompleteStatus(
      error instanceof UnreadableAudioError
        ? `${file.name}: ${error.message}. Try an .m4a, .mp3, .wav or .mp4 file.`
        : `${file.name}: couldn't transcribe it (${error.message}).`,
      { error: true },
    );
  } finally {
    isUploading = false;
    renderUploadAvailability();
  }
}

function isFileDrag(event) {
  return [...(event.dataTransfer?.types ?? [])].includes('Files');
}

uploadBtn.addEventListener('click', () => uploadInput.click());
uploadInput.addEventListener('change', () => {
  const [file] = uploadInput.files;
  uploadInput.value = ''; // so choosing the same file again still works
  if (file) transcribeUploadedFile(file);
});

// A file can also be dropped anywhere on the page.
window.addEventListener('dragover', (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  document.body.classList.toggle('is-dropping-file', !uploadBtn.disabled);
});
window.addEventListener('dragleave', (event) => {
  if (event.relatedTarget === null) document.body.classList.remove('is-dropping-file');
});
window.addEventListener('drop', (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  document.body.classList.remove('is-dropping-file');
  const [file] = event.dataTransfer.files;
  if (file && !uploadBtn.disabled) transcribeUploadedFile(file);
});

// ---------- Automatic sections ----------

function prepareHeadlineWriter() {
  if (!isHeadlineWriterSupported()) return null;
  headlineWriterPromise ??= createHeadlineWriter((fractionLoaded) => {
    setNotesStatus(
      `Downloading Chrome's on-device AI for section titles (one time only)… ${Math.round(fractionLoaded * 100)}%`,
    );
  }).catch((error) => {
    headlineWriterPromise = null;
    throw error;
  });
  return headlineWriterPromise;
}

// Translating a title must never hold up the headings appearing.
const TITLE_TRANSLATION_TIMEOUT_MS = 5000;

async function withTranslatedTitle(title, languageCode) {
  const translator = readyTranslators.get(languageCode);
  if (!translator) return title;
  try {
    const translatedTitle = await Promise.race([
      translator.translate(title),
      delay(TITLE_TRANSLATION_TIMEOUT_MS).then(() => title),
    ]);
    return translatedTitle && translatedTitle !== title ? `${title} · ${translatedTitle}` : title;
  } catch {
    return title; // An English-only title is fine.
  }
}

// Splits the lines into sections and names them right away with keywords, so
// there is never a wait; then, if Chrome's on-device AI is available, replaces
// those titles with AI-written ones (it may first need a one-time download).
async function organizeSections(lines) {
  const sectionStarts = findSectionStarts(lines);
  if (sectionStarts.length === 0) return;
  isOrganizing = true;
  renderTranscriptState();

  const languageCode = selectedLanguage().code;
  // Never put a heading directly under another one (for example, one the user named).
  const startsNeedingHeadings = sectionStarts.filter(
    (startIndex) => !lines[startIndex].row.previousElementSibling?.classList.contains('section'),
  );
  if (startsNeedingHeadings.length === 0) {
    isOrganizing = false;
    renderTranscriptState();
    return;
  }
  const sections = startsNeedingHeadings.map((startIndex) => ({
    heading: transcript.addPendingSectionBefore(lines[startIndex].row),
    text: lines
      .slice(startIndex, sectionStarts[sectionStarts.indexOf(startIndex) + 1] ?? lines.length)
      .map((line) => line.text)
      .join(' '),
  }));
  for (const { heading, text } of sections) {
    heading.setTitle(await withTranslatedTitle(keywordTitle(text), languageCode));
  }
  isOrganizing = false;
  renderTranscriptState();

  const count = sections.length;
  const summary = `Organized into ${count} section${count === 1 ? '' : 's'}. Click a heading to rename it.`;
  const writerPromise = prepareHeadlineWriter();
  if (!writerPromise) {
    setNotesStatus(`${summary} Titles are keywords: this browser has no built-in AI for writing titles.`);
    return;
  }

  setNotesStatus(`${summary} Writing better titles with Chrome's on-device AI…`);
  let headlineWriter;
  try {
    headlineWriter = await writerPromise;
  } catch (error) {
    setNotesStatus(
      error.name === 'NotAllowedError'
        ? `${summary} Titles are keywords. Click ✨ Auto-organize to download Chrome's on-device AI for better titles (one time only).`
        : `${summary} Titles are keywords: Chrome's on-device AI isn't available (${error.message}).`,
    );
    return;
  }
  // One at a time, so the on-device model isn't asked to do everything at once.
  for (const { heading, text } of sections) {
    try {
      const headline = cleanHeadline(await writeHeadline(headlineWriter, text));
      if (headline) heading.setTitle(await withTranslatedTitle(headline, languageCode));
    } catch {
      // Keep the keyword title for this section.
    }
  }
  setNotesStatus(`${summary} Titles were written by Chrome's on-device AI.`);
}

function reorganizeAll() {
  if (transcript.hasSections() && !confirm('Replace all section headings with automatically organized ones?')) return;
  // Start loading the AI for titles during this click: a first-time download needs one.
  prepareHeadlineWriter()?.catch(() => {});
  transcript.removeAllSections();
  organizeSections(transcript.linesFrom(null));
}

// ---------- Export ----------

function formatLongDate(date) {
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// Exports by printing: the print styles hide the controls, and Chrome's print
// window offers "Save as PDF". This keeps every script (Chinese, Arabic, …) intact.
function exportPdf() {
  if (!transcript.hasContent()) {
    setNotesStatus('Nothing to export yet. Record or add something first.', { error: true });
    return;
  }
  document.activeElement?.blur(); // Finish any edit in progress so it is included.

  const courseName = courseNameInput.value.trim() || 'Lecture notes';
  const today = formatLongDate(new Date());
  printTitleEl.textContent = courseName;
  printDetailsEl.textContent = `${today} · ${formatClock(elapsedMs())} recorded`;

  // The page title becomes the suggested PDF file name.
  const pageTitle = document.title;
  document.title = `${courseName} – ${today}`;
  setNotesStatus('In the print window, set Destination to "Save as PDF", then click Save.');
  window.print();
  document.title = pageTitle;
}

// ---------- Controls ----------

recordBtn.addEventListener('click', () => {
  if (recorderState === 'idle') {
    startListening();
  } else {
    stopListening();
  }
});

flagBtn.addEventListener('click', () => transcript.flagLastLine());

sectionBtn.addEventListener('click', () => transcript.addSection());

languageSelect.addEventListener('change', () => {
  saveLanguage(languageSelect.value);
  renderTranslationHead();
  if (!translationSupported) return;
  // While recording, get the new language ready now (this change counts as a user action).
  if (recorderState !== 'idle') {
    prepareTranslator(selectedLanguage()).catch(() => {});
  } else if (translatorsByLanguage.has(languageSelect.value)) {
    setTranslationStatus(`${selectedLanguage().english} translation is ready.`);
  } else {
    describeTranslationReadiness();
  }
});

exportBtn.addEventListener('click', exportPdf);

organizeBtn.addEventListener('click', reorganizeAll);

copyLogBtn.addEventListener('click', copyDebugLog);

clearBtn.addEventListener('click', () => {
  if (transcript.hasContent() && !confirm('Clear the whole transcript, including your edits?')) return;
  transcript.clear();
  clearCount++;
  if (liveWhisper) {
    Object.assign(liveWhisper, {
      clearCountAtStart: clearCount,
      segments: [],
      lines: [],
      committed: 0,
      rows: [],
      spans: [],
      typingLine: null,
    });
    liveDraft.clear();
    showLiveSentence('');
  }
  labeledRecordings = [];
  firstRowThisRecording = null;
  elapsedBeforePauseMs = 0;
  if (listeningSinceMs !== null) listeningSinceMs = Date.now();
  renderTimer();
  renderTranscriptState();
  setNotesStatus('');
});

// ---------- Start-up checks ----------

function checkBrowserSupport() {
  if (!window.isSecureContext) {
    addNotice(
      'The microphone only works when this page is opened from https:// or http://localhost, not as a file. See the README for how to run it.',
    );
    canRecord = false;
    setStatus('Microphone unavailable on this page.', { error: true });
    return;
  }
  if (!speechSupported) {
    addNotice('This browser has no live speech recognition. Open this page in Chrome on a computer.');
    canRecord = false;
    setStatus('Speech recognition unavailable in this browser.', { error: true });
  }
  if (!translationSupported) {
    addNotice(
      'Live translation needs Chrome on a computer (version 138 or newer). In this browser you will see the English transcript only.',
    );
  }
}

diagnosticsEl.hidden = !isDebugMode;
if (isDebugMode) logAiModelStatus();
renderTimer();
populateLanguageSelect();
renderTranslationHead();
renderTranscriptState();
checkBrowserSupport();
renderUploadAvailability();
describeTranslationReadiness();
// A model downloaded on an earlier visit is loaded now, so it is ready by the time Start is pressed.
if (completeTranscriptSupported) warmUpWhisperEarly({ onlyIfDownloaded: true });
