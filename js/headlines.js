// Wraps Chrome's built-in Summarizer API (on-device Gemini Nano), used to write
// a short title for each section. It needs a capable computer and a one-time
// model download; when it is missing, sections fall back to keyword titles.
import { checkOnDeviceModel, createOnDeviceModel } from './on-device-ai.js';

// The model works within a limited input size, so very long sections are trimmed.
const MAX_INPUT_CHARACTERS = 6000;

export function isHeadlineWriterSupported() {
  return 'Summarizer' in self;
}

const HEADLINE_OPTIONS = {
  type: 'headline',
  format: 'plain-text',
  length: 'short',
  expectedInputLanguages: ['en'],
  outputLanguage: 'en',
};

// Resolves to 'available', 'downloadable', 'downloading', or 'unavailable'.
export function checkHeadlineWriterAvailability() {
  return checkOnDeviceModel(Summarizer, HEADLINE_OPTIONS);
}

// Call from a click handler when possible: the model download needs a user action.
export function createHeadlineWriter(onDownloadProgress) {
  return createOnDeviceModel(
    Summarizer,
    {
      ...HEADLINE_OPTIONS,
      sharedContext:
        'Each input is one section of a university lecture, transcribed by speech recognition, so it may contain recognition errors.',
    },
    onDownloadProgress,
  );
}

// Loading the model into memory the first time can be slow, but not this slow.
const HEADLINE_TIMEOUT_MS = 60000;

export function writeHeadline(headlineWriter, text) {
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('writing the title took too long')), HEADLINE_TIMEOUT_MS);
  });
  return Promise.race([headlineWriter.summarize(text.slice(0, MAX_INPUT_CHARACTERS)), timeout]);
}
