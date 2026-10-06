/*
 * The way a language's text runs, in the values the HTML `dir` attribute
 * takes. Required on every language so one added later has to say which.
 */
export type DocsLanguageDirection = "ltr" | "rtl";

export interface DocsLanguage {
  code: string;
  nativeName: string;
  englishName: string;
  direction: DocsLanguageDirection;
}

export const DEFAULT_DOCS_LANGUAGE: string = "en";

export const SUPPORTED_DOCS_LANGUAGES: Array<DocsLanguage> = [
  {
    code: "en",
    nativeName: "English",
    englishName: "English",
    direction: "ltr",
  },
  {
    code: "de",
    nativeName: "Deutsch",
    englishName: "German",
    direction: "ltr",
  },
  {
    code: "fr",
    nativeName: "Français",
    englishName: "French",
    direction: "ltr",
  },
  {
    code: "es",
    nativeName: "Español",
    englishName: "Spanish",
    direction: "ltr",
  },
  {
    code: "it",
    nativeName: "Italiano",
    englishName: "Italian",
    direction: "ltr",
  },
  {
    code: "pt",
    nativeName: "Português",
    englishName: "Portuguese",
    direction: "ltr",
  },
  {
    code: "nl",
    nativeName: "Nederlands",
    englishName: "Dutch",
    direction: "ltr",
  },
  { code: "da", nativeName: "Dansk", englishName: "Danish", direction: "ltr" },
  {
    code: "no",
    nativeName: "Norsk",
    englishName: "Norwegian",
    direction: "ltr",
  },
  {
    code: "sv",
    nativeName: "Svenska",
    englishName: "Swedish",
    direction: "ltr",
  },
  {
    code: "ru",
    nativeName: "Русский",
    englishName: "Russian",
    direction: "ltr",
  },
  {
    code: "ja",
    nativeName: "日本語",
    englishName: "Japanese",
    direction: "ltr",
  },
  { code: "ko", nativeName: "한국어", englishName: "Korean", direction: "ltr" },
  {
    code: "zh-CN",
    nativeName: "简体中文",
    englishName: "Chinese (Simplified)",
    direction: "ltr",
  },
  {
    code: "zh-TW",
    nativeName: "繁體中文",
    englishName: "Chinese (Traditional)",
    direction: "ltr",
  },
  { code: "hi", nativeName: "हिन्दी", englishName: "Hindi", direction: "ltr" },
  { code: "fa", nativeName: "فارسی", englishName: "Persian", direction: "rtl" },
];

export const SUPPORTED_DOCS_LANGUAGE_CODES: Array<string> =
  SUPPORTED_DOCS_LANGUAGES.map((language: DocsLanguage) => {
    return language.code;
  });

export const isSupportedDocsLanguage: (code: string) => boolean = (
  code: string,
): boolean => {
  return SUPPORTED_DOCS_LANGUAGE_CODES.includes(code);
};

/*
 * The direction to lay a page in this language out in. A code that is not a
 * docs language reads left to right, like the English it falls back to.
 */
export const getDocsLanguageDirection: (
  code: string,
) => DocsLanguageDirection = (code: string): DocsLanguageDirection => {
  const language: DocsLanguage | undefined = SUPPORTED_DOCS_LANGUAGES.find(
    (item: DocsLanguage) => {
      return item.code === code;
    },
  );
  return language ? language.direction : "ltr";
};
