// Wraps Chrome's built-in Translator API, which translates on this computer
// for free once a language pack has been downloaded.
import { SOURCE_LANGUAGE } from './languages.js';
import { checkOnDeviceModel, createOnDeviceModel } from './on-device-ai.js';

export function isTranslationSupported() {
  return 'Translator' in self;
}

function languagePair(targetCode) {
  return { sourceLanguage: SOURCE_LANGUAGE.code, targetLanguage: targetCode };
}

// Resolves to 'available', 'downloadable', 'downloading', or 'unavailable'.
export function checkTranslationAvailability(targetCode) {
  return checkOnDeviceModel(Translator, languagePair(targetCode));
}

// Call this from a click or change handler: Chrome only starts a language-pack
// download in response to something the user did.
export function createTranslator(targetCode, onDownloadProgress) {
  return createOnDeviceModel(Translator, languagePair(targetCode), onDownloadProgress);
}

// Chrome's translator drops the end of long text without punctuation (and live
// speech has none), so long text is translated in pieces of at most this many words.
const MAX_WORDS_PER_PIECE = 18;
// Words that start a new clause: good places to split.
const CLAUSE_STARTERS = new Set(['and', 'but', 'so', 'because', 'which', 'that', 'when', 'where', 'while', 'if', 'then', 'or']);

// Splits text at sentence ends, then splits any long sentence into pieces of at
// most MAX_WORDS_PER_PIECE words, preferably just before a clause-starting word.
export function splitForTranslation(text) {
  const sentences = text.match(/[^.?!]+[.?!]*/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [];
  const pieces = [];
  for (const sentence of sentences) {
    let words = sentence.split(/\s+/);
    while (words.length > MAX_WORDS_PER_PIECE) {
      let splitAt = MAX_WORDS_PER_PIECE;
      for (let i = MAX_WORDS_PER_PIECE; i >= MAX_WORDS_PER_PIECE / 2; i--) {
        if (CLAUSE_STARTERS.has(words[i].toLowerCase())) {
          splitAt = i;
          break;
        }
      }
      pieces.push(words.slice(0, splitAt).join(' '));
      words = words.slice(splitAt);
    }
    pieces.push(words.join(' '));
  }
  return pieces;
}

// Languages written without spaces between sentences and clauses.
const JOINED_WITHOUT_SPACES = new Set(['zh', 'zh-Hant', 'ja']);

export async function translateInPieces(translator, text, targetCode) {
  const translatedPieces = [];
  for (const piece of splitForTranslation(text)) {
    translatedPieces.push((await translator.translate(piece)).trim());
  }
  return translatedPieces.join(JOINED_WITHOUT_SPACES.has(targetCode) ? '' : ' ');
}
