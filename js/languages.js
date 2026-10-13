// Lectures are in English; speechCode is the dialect the speech recognizer listens for.
export const SOURCE_LANGUAGE = { code: 'en', speechCode: 'en-US', english: 'English' };

// Languages Chrome's built-in Translator can produce from English.
export const TARGET_LANGUAGES = [
  { code: 'zh', english: 'Chinese (Simplified)', native: '简体中文' },
  { code: 'zh-Hant', english: 'Chinese (Traditional)', native: '繁體中文' },
  { code: 'es', english: 'Spanish', native: 'Español' },
  { code: 'fr', english: 'French', native: 'Français' },
  { code: 'de', english: 'German', native: 'Deutsch' },
  { code: 'ja', english: 'Japanese', native: '日本語' },
  { code: 'ko', english: 'Korean', native: '한국어' },
  { code: 'pt', english: 'Portuguese', native: 'Português' },
  { code: 'ru', english: 'Russian', native: 'Русский' },
  { code: 'it', english: 'Italian', native: 'Italiano' },
  { code: 'ar', english: 'Arabic', native: 'العربية' },
  { code: 'hi', english: 'Hindi', native: 'हिन्दी' },
  { code: 'bn', english: 'Bengali', native: 'বাংলা' },
  { code: 'vi', english: 'Vietnamese', native: 'Tiếng Việt' },
  { code: 'th', english: 'Thai', native: 'ไทย' },
  { code: 'tr', english: 'Turkish', native: 'Türkçe' },
  { code: 'nl', english: 'Dutch', native: 'Nederlands' },
  { code: 'pl', english: 'Polish', native: 'Polski' },
];

export const DEFAULT_TARGET_LANGUAGE = 'zh';

export function findTargetLanguage(code) {
  return TARGET_LANGUAGES.find((language) => language.code === code);
}
