export interface DocsLanguage {
  code: string;
  nativeName: string;
  englishName: string;
}

export const DEFAULT_DOCS_LANGUAGE: string = "en";

export const SUPPORTED_DOCS_LANGUAGES: Array<DocsLanguage> = [
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
  { code: "zh", nativeName: "中文", englishName: "Chinese" },
  { code: "hi", nativeName: "हिन्दी", englishName: "Hindi" },
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
