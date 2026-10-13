import {
  checkHeadlineWriterAvailability,
  createHeadlineWriter,
  isHeadlineWriterSupported,
  writeHeadline,
} from './headlines.js';
import { DEFAULT_TARGET_LANGUAGE, SOURCE_LANGUAGE, TARGET_LANGUAGES, findTargetLanguage } from './languages.js';
import { lineIndexAt, segmentsToLines } from './complete-transcript.js';
import { isRecordingSupported, startAudioRecording } from './recorder.js';
import { cleanHeadline, findSectionStarts, keywordTitle } from './sections.js';
import { createLiveTranscriber, isSpeechSupported } from './speech.js';
import { createTranscript } from './transcript.js';
import {
  checkTranslationAvailability,
  createTranslator,
  isTranslationSupported,
  translateInPieces,
} from './translation.js';
import { isWhisperSupported, transcribeRecording } from './whisper.js';

const LANGUAGE_STORAGE_KEY = 'lectureLedger.targetLanguage';
// How often the sentence still being spoken is re-translated.
const LIVE_TRANSLATION_INTERVAL_MS = 400;

const noticesEl = document.getElementById('notices');
const courseNameInput = document.getElementById('courseName');
const languageSelect = document.getElementById('targetLanguage');
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
const emptyStateEl = document.getElementById('emptyState');
const exportBtn = document.getElementById('exportBtn');
const clearBtn = document.getElementById('clearBtn');
const organizeBtn = document.getElementById('organizeBtn');
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
const completeTranscriptSupported = isRecordingSupported() && isWhisperSupported();

// 'idle' → 'starting' (waiting for the mic) → 'listening' → back to 'idle'.
let recorderState = 'idle';
let elapsedBeforePauseMs = 0;
let listeningSinceMs = null;
let timerInterval = null;
// The first sentence of the current recording, so Stop organizes only what was just recorded.
let firstRowThisRecording = null;
// The audio being recorded for Whisper (a promise of the recorder), and where it starts on the timer.
let audioRecordingPromise = null;
let recordingStartMs = 0;
// Bumped by Clear, so a complete transcript that finishes afterwards is not added back.
let clearCount = 0;

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

function renderTimer() {
  timerEl.textContent = formatClock(elapsedMs());
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
async function keepLiveSentenceTranslated() {
  if (isLiveTranslating) return;
  isLiveTranslating = true;
  let lastTranslatedText = '';
  try {
    while (interimOriginalEl.textContent && interimOriginalEl.textContent !== lastTranslatedText) {
      const languageCode = selectedLanguage().code;
      const translator = readyTranslators.get(languageCode);
      if (!translator) break;
      const text = interimOriginalEl.textContent;
      const translatedText = await translateInPieces(translator, text, languageCode);
      if (interimOriginalEl.textContent) interimTranslationEl.textContent = translatedText;
      lastTranslatedText = text;
      await delay(LIVE_TRANSLATION_INTERVAL_MS);
    }
  } catch {
    // Live translation is a preview; the confirmed sentence is translated again anyway.
  } finally {
    isLiveTranslating = false;
  }
}

function showLiveSentence(text) {
  interimOriginalEl.textContent = text;
  if (!text) interimTranslationEl.textContent = '';
  interimEl.hidden = !text;
  renderTranscriptState();
  if (text && translationSupported) keepLiveSentenceTranslated();
}

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

// ---------- Recording ----------

function renderRecordButton() {
  const isActive = recorderState !== 'idle';
  recordBtn.textContent = isActive ? '■ Stop listening' : '● Start listening';
  recordBtn.classList.toggle('recording', isActive);
}

function enterIdle() {
  recorderState = 'idle';
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
      onInterim: showLiveSentence,
      onFinal(text) {
        const provisionalTranslation = interimTranslationEl.textContent;
        interimTranslationEl.textContent = '';
        const row = transcript.addLine(text, {
          timeLabel: formatClock(elapsedMs()),
          elapsedMs: elapsedMs(),
          targetLanguage: selectedLanguage().code,
          provisionalTranslation,
        });
        firstRowThisRecording ??= row;
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
        showLiveSentence('');
        const firstRow = firstRowThisRecording;
        firstRowThisRecording = null;
        const liveLines = firstRow ? transcript.linesFrom(firstRow) : [];
        const recording = audioRecordingPromise;
        audioRecordingPromise = null;
        // Whisper runs first; the AI for titles loads only afterwards, so the two
        // models never compete for the graphics chip and memory.
        if (recording) {
          makeCompleteTranscript(recording, liveLines, recordingStartMs);
        } else if (liveLines.length > 0) {
          organizeSections(liveLines);
        }
      },
    })
  : null;

function startListening() {
  firstRowThisRecording = null;
  recordingStartMs = elapsedMs();
  if (completeTranscriptSupported) {
    audioRecordingPromise = startAudioRecording().catch((error) => {
      logDebugEvent(`audio recording failed: ${error.message}`);
      setCompleteStatus(
        `Couldn't record audio for the complete transcript (${error.message}). The live transcript still works.`,
        { error: true },
      );
      return null;
    });
  }
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

// After Stop: Whisper re-transcribes the whole recording, its lines replace the
// live ones (keeping flags), and then the recording is split into sections.
// If anything goes wrong, the live lines are kept and organized instead.
async function makeCompleteTranscript(recordingPromise, liveLines, startMs) {
  const keepLiveVersion = (message) => {
    if (message) setCompleteStatus(message, { error: true });
    if (liveLines.length > 0) organizeSections(liveLines);
  };
  const recording = await recordingPromise;
  if (!recording) {
    keepLiveVersion();
    return;
  }
  const clearCountAtStart = clearCount;
  setCompleteStatus('Complete transcript: getting ready…');
  try {
    const audioBlob = await recording.stop();
    logDebugEvent(`recorded ${Math.round(audioBlob.size / 1024)} KB of audio for Whisper`);
    const { segments, device } = await transcribeRecording(audioBlob, (progress) => {
      setCompleteStatus(describeWhisperProgress(progress));
    });
    logDebugEvent(`Whisper (${device}) returned ${segments.length} segments`);
    if (clearCount !== clearCountAtStart) {
      setCompleteStatus('');
      return;
    }

    const lines = segmentsToLines(segments);
    if (lines.length === 0) {
      keepLiveVersion('Complete transcript: Whisper heard no speech in this recording, so the live version was kept.');
      return;
    }
    const flaggedLineIndexes = new Set(
      liveLines
        .filter((line) => line.row.classList.contains('flagged'))
        .map((line) => lineIndexAt(lines, (line.elapsedMs - startMs) / 1000)),
    );
    const targetLanguage = selectedLanguage().code;
    const newRows = transcript.replaceLines(
      liveLines.map((line) => line.row),
      lines.map((line, index) => ({
        text: line.text,
        timeLabel: formatClock(startMs + line.startSeconds * 1000),
        elapsedMs: startMs + line.endSeconds * 1000,
        targetLanguage,
        flagged: flaggedLineIndexes.has(index),
      })),
    );
    setCompleteStatus(
      `Complete transcript ready: Whisper's ${lines.length} sentence${lines.length === 1 ? '' : 's'} replaced the live version.`,
    );
    organizeSections(transcript.linesFrom(newRows[0]).slice(0, newRows.length));
  } catch (error) {
    logDebugEvent(`Whisper failed: ${error.message}`);
    keepLiveVersion(`Couldn't make the complete transcript (${error.message}). The live version was kept.`);
  }
}

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
  const sections = sectionStarts.map((startIndex, n) => ({
    heading: transcript.addPendingSectionBefore(lines[startIndex].row),
    text: lines
      .slice(startIndex, sectionStarts[n + 1] ?? lines.length)
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
    recordBtn.disabled = true;
    setStatus('Microphone unavailable on this page.', { error: true });
    return;
  }
  if (!speechSupported) {
    addNotice('This browser has no live speech recognition. Open this page in Chrome on a computer.');
    recordBtn.disabled = true;
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
populateLanguageSelect();
renderTranslationHead();
renderTranscriptState();
checkBrowserSupport();
describeTranslationReadiness();
