import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import { toDetectedLanguage } from "Common/Types/ReaderLanguage";
import {
  getProductNamePostProcess,
  productNamePostProcessor,
} from "Common/UI/Utils/ProductNameTranslation";
import { followLanguageForDates } from "Common/UI/Utils/DateDisplayLanguage";
import { followLanguageForPage } from "Common/UI/Utils/PageLanguage";

import {
  DEFAULT_STATUS_PAGE_LANGUAGE,
  STATUS_PAGE_LANGUAGE_STORAGE_KEY,
  STATUS_PAGE_LANGUAGE_USER_CHOICE_KEY,
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
import fa from "../Locales/fa.json";

export type SupportedLanguage = StatusPageLanguage;

export const SUPPORTED_LANGUAGES: Array<SupportedLanguage> =
  SUPPORTED_STATUS_PAGE_LANGUAGES;

export const DEFAULT_LANGUAGE: string = DEFAULT_STATUS_PAGE_LANGUAGE;
export const LANGUAGE_STORAGE_KEY: string = STATUS_PAGE_LANGUAGE_STORAGE_KEY;
export const LANGUAGE_USER_CHOICE_KEY: string =
  STATUS_PAGE_LANGUAGE_USER_CHOICE_KEY;

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
 * A browser's language tag as the language this frontend shows: Chinese
 * in every form onto Simplified or Traditional Chinese, Norwegian Bokmal
 * and Nynorsk (nb, nn) onto Norwegian, a regional variant onto its
 * language (es-ES is es), else the tag as it came
 * (Common/Types/ReaderLanguage, shared with the server and the public
 * dashboards).
 */
const convertDetectedLanguage: (lng: string) => string = (
  lng: string,
): string => {
  if (!lng) {
    return lng;
  }

  return toDetectedLanguage(lng, SUPPORTED_STATUS_PAGE_LANGUAGE_CODES);
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .use(productNamePostProcessor)
  .init({
    // The installation's own name in every sentence, when it has one.
    postProcess: getProductNamePostProcess(),
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
      fa: { translation: fa },
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
 * Keep the document's <html lang> and <html dir> on the active language, so
 * screen readers apply its pronunciation rules (WCAG 3.1.1 Language of Page)
 * and a Persian page reads right to left. The server template renders the
 * page's configured default; this follows the reader's own choice, on the
 * first load and on every switch.
 */
followLanguageForPage(i18n);

// Dates, times and durations in the reader's language too.
followLanguageForDates(i18n);

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
