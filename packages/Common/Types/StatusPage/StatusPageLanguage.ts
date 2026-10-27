import { getReadingDirection, ReadingDirection } from "../ReadingDirection";

export interface StatusPageLanguage {
  code: string;
  nativeName: string;
  englishName: string;
}

export const DEFAULT_STATUS_PAGE_LANGUAGE: string = "en";

export const SUPPORTED_STATUS_PAGE_LANGUAGES: Array<StatusPageLanguage> = [
  { code: "en", nativeName: "English", englishName: "English" },
  { code: "de", nativeName: "Deutsch", englishName: "German" },
  { code: "fr", nativeName: "Français", englishName: "French" },
  { code: "es", nativeName: "Español", englishName: "Spanish" },
  { code: "it", nativeName: "Italiano", englishName: "Italian" },
  { code: "pt", nativeName: "Português", englishName: "Portuguese" },
  { code: "nl", nativeName: "Nederlands", englishName: "Dutch" },
  { code: "da", nativeName: "Dansk", englishName: "Danish" },
  { code: "no", nativeName: "Norsk", englishName: "Norwegian" },
  { code: "sv", nativeName: "Svenska", englishName: "Swedish" },
  { code: "ru", nativeName: "Русский", englishName: "Russian" },
  { code: "ja", nativeName: "日本語", englishName: "Japanese" },
  { code: "ko", nativeName: "한국어", englishName: "Korean" },
  {
    code: "zh-CN",
    nativeName: "简体中文",
    englishName: "Chinese (Simplified)",
  },
  {
    code: "zh-TW",
    nativeName: "繁體中文",
    englishName: "Chinese (Traditional)",
  },
  { code: "hi", nativeName: "हिन्दी", englishName: "Hindi" },
  { code: "fa", nativeName: "فارسی", englishName: "Persian" },
];

export const SUPPORTED_STATUS_PAGE_LANGUAGE_CODES: Array<string> =
  SUPPORTED_STATUS_PAGE_LANGUAGES.map((language: StatusPageLanguage) => {
    return language.code;
  });

export interface StatusPageLanguageHead {
  lang: string;
  dir: ReadingDirection;
}

/*
 * The language a status page's HTML is served in, before its app runs: the
 * page's default language when it is one a status page can show, English
 * otherwise - with the way it is read, so a page whose visitors read
 * Persian is laid out right to left from its first paint. A visitor's own
 * choice takes over once the app runs (Common/UI/Utils/PageLanguage).
 */
export const getStatusPageLanguageHead: (
  defaultLanguage: string | null | undefined,
) => StatusPageLanguageHead = (
  defaultLanguage: string | null | undefined,
): StatusPageLanguageHead => {
  const lang: string =
    defaultLanguage &&
    SUPPORTED_STATUS_PAGE_LANGUAGE_CODES.includes(defaultLanguage)
      ? defaultLanguage
      : DEFAULT_STATUS_PAGE_LANGUAGE;

  return { lang: lang, dir: getReadingDirection(lang) };
};
