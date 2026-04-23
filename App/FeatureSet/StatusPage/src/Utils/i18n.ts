import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import {
  DEFAULT_STATUS_PAGE_LANGUAGE,
  StatusPageLanguage,
  SUPPORTED_STATUS_PAGE_LANGUAGES,
  SUPPORTED_STATUS_PAGE_LANGUAGE_CODES,
} from "Common/Types/StatusPage/StatusPageLanguage";

import en from "../Locales/en.json";
import de from "../Locales/de.json";
import fr from "../Locales/fr.json";
import es from "../Locales/es.json";
import it from "../Locales/it.json";
import pt from "../Locales/pt.json";
import nl from "../Locales/nl.json";
import da from "../Locales/da.json";
import no from "../Locales/no.json";
import sv from "../Locales/sv.json";
import ja from "../Locales/ja.json";
import ko from "../Locales/ko.json";
import zh from "../Locales/zh.json";

export type SupportedLanguage = StatusPageLanguage;

export const SUPPORTED_LANGUAGES: Array<SupportedLanguage> =
  SUPPORTED_STATUS_PAGE_LANGUAGES;

export const DEFAULT_LANGUAGE: string = DEFAULT_STATUS_PAGE_LANGUAGE;
export const LANGUAGE_STORAGE_KEY: string = "statusPageLang";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      de: { translation: de },
      fr: { translation: fr },
      es: { translation: es },
      it: { translation: it },
      pt: { translation: pt },
      nl: { translation: nl },
      da: { translation: da },
      no: { translation: no },
      sv: { translation: sv },
      ja: { translation: ja },
      ko: { translation: ko },
      zh: { translation: zh },
    },
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: SUPPORTED_STATUS_PAGE_LANGUAGE_CODES,
    load: "languageOnly",
    nonExplicitSupportedLngs: true,
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ["localStorage", "navigator", "htmlTag"],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ["localStorage"],
    },
  });

export const applyStatusPageLanguageSettings: (settings: {
  defaultLanguage?: string | null | undefined;
  enabledLanguages?: Array<string> | null | undefined;
}) => void = (settings: {
  defaultLanguage?: string | null | undefined;
  enabledLanguages?: Array<string> | null | undefined;
}): void => {
  const allowed: Array<string> =
    settings.enabledLanguages && settings.enabledLanguages.length > 0
      ? settings.enabledLanguages.filter((code: string) => {
          return SUPPORTED_STATUS_PAGE_LANGUAGE_CODES.includes(code);
        })
      : SUPPORTED_STATUS_PAGE_LANGUAGE_CODES;

  const configuredDefault: string =
    settings.defaultLanguage &&
    SUPPORTED_STATUS_PAGE_LANGUAGE_CODES.includes(settings.defaultLanguage)
      ? settings.defaultLanguage
      : DEFAULT_LANGUAGE;

  const userStoredChoice: string | null =
    typeof window !== "undefined" && window.localStorage
      ? window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
      : null;

  const current: string = i18n.resolvedLanguage || i18n.language || "";

  // If the user has no stored choice, honor the status page's default.
  if (!userStoredChoice && current !== configuredDefault) {
    i18n.changeLanguage(configuredDefault);
    return;
  }

  // If the current resolved language isn't in the allowed list, fall back.
  if (current && !allowed.includes(current)) {
    const fallback: string = allowed.includes(configuredDefault)
      ? configuredDefault
      : allowed[0] ?? DEFAULT_LANGUAGE;
    i18n.changeLanguage(fallback);
  }
};

export default i18n;
