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
import ru from "../Locales/ru.json";
import ja from "../Locales/ja.json";
import ko from "../Locales/ko.json";
import zhCN from "../Locales/zh-CN.json";
import zhTW from "../Locales/zh-TW.json";
import hi from "../Locales/hi.json";

export type SupportedLanguage = StatusPageLanguage;

export const SUPPORTED_LANGUAGES: Array<SupportedLanguage> =
  SUPPORTED_STATUS_PAGE_LANGUAGES;

export const DEFAULT_LANGUAGE: string = DEFAULT_STATUS_PAGE_LANGUAGE;
export const LANGUAGE_STORAGE_KEY: string = "statusPageLang";
/*
 * Separate key tracks whether the user explicitly chose a language (vs.
 * the value being auto-detected from the browser). Without this we cannot
 * distinguish a stored auto-detection from a real user choice, so the
 * status page's configured default would be ignored after the first visit.
 */
export const LANGUAGE_USER_CHOICE_KEY: string = "statusPageLangUserChoice";

/*
 * Backward-compat: the language code "zh" was renamed to "zh-CN" when
 * Traditional Chinese ("zh-TW") was added. Rewrite any legacy stored value so
 * existing users keep their Simplified Chinese setting.
 */
if (
  typeof window !== "undefined" &&
  window.localStorage &&
  window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === "zh"
) {
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, "zh-CN");
}

/*
 * Browsers report Chinese in many forms (zh, zh-CN, zh-SG, zh-Hans-CN,
 * zh-TW, zh-HK, zh-MO, zh-Hant-HK, ...). Map them onto our two supported
 * variants so detection actually resolves to a loaded resource instead of
 * falling back to English. Also collapse regional variants of other
 * languages (e.g. "es-ES" -> "es") whose resources we ship under the bare
 * language code.
 */
const convertDetectedLanguage: (lng: string) => string = (
  lng: string,
): string => {
  if (!lng) {
    return lng;
  }
  const lower: string = lng.toLowerCase();
  if (
    lower === "zh-tw" ||
    lower === "zh-hk" ||
    lower === "zh-mo" ||
    lower === "zh-hant" ||
    lower.startsWith("zh-hant-")
  ) {
    return "zh-TW";
  }
  if (lower === "zh" || lower.startsWith("zh-") || lower.startsWith("zh_")) {
    return "zh-CN";
  }
  if (lng.includes("-") || lng.includes("_")) {
    const langPart: string = lng.split(/[-_]/)[0]!.toLowerCase();
    if (SUPPORTED_STATUS_PAGE_LANGUAGE_CODES.includes(langPart)) {
      return langPart;
    }
  }
  return lng;
};

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
      ru: { translation: ru },
      ja: { translation: ja },
      ko: { translation: ko },
      "zh-CN": { translation: zhCN },
      "zh-TW": { translation: zhTW },
      hi: { translation: hi },
    },
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: SUPPORTED_STATUS_PAGE_LANGUAGE_CODES,
    load: "currentOnly",
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ["localStorage", "navigator", "htmlTag"],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ["localStorage"],
      convertDetectedLanguage,
    },
  });

/*
 * Keep the document's <html lang> attribute in sync with the active language so
 * screen readers apply the correct pronunciation rules (WCAG 3.1.2 Language of
 * Parts). The server template renders lang="en"; we update it on initial load
 * and on every language switch.
 */
const syncDocumentLanguage: (lng: string | undefined) => void = (
  lng: string | undefined,
): void => {
  if (typeof window !== "undefined" && window.document && lng) {
    window.document.documentElement.lang = lng;
  }
};

i18n.on("languageChanged", (lng: string) => {
  syncDocumentLanguage(lng);
});

syncDocumentLanguage(
  i18n.resolvedLanguage || i18n.language || DEFAULT_LANGUAGE,
);

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

  const userExplicitlyChose: boolean =
    typeof window !== "undefined" && window.localStorage
      ? window.localStorage.getItem(LANGUAGE_USER_CHOICE_KEY) === "true"
      : false;

  const current: string = i18n.resolvedLanguage || i18n.language || "";

  /*
   * If the user has not explicitly chosen a language, honor the status
   * page's configured default (overriding any browser-detected value).
   */
  if (!userExplicitlyChose && current !== configuredDefault) {
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
