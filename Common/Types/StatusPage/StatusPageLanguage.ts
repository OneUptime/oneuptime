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
  { code: "ja", nativeName: "日本語", englishName: "Japanese" },
  { code: "ko", nativeName: "한국어", englishName: "Korean" },
  { code: "zh", nativeName: "中文", englishName: "Chinese" },
];

export const SUPPORTED_STATUS_PAGE_LANGUAGE_CODES: Array<string> =
  SUPPORTED_STATUS_PAGE_LANGUAGES.map((language: StatusPageLanguage) => {
    return language.code;
  });
