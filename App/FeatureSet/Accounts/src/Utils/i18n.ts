import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import {
  AccountsLanguage,
  DEFAULT_ACCOUNTS_LANGUAGE,
  SUPPORTED_ACCOUNTS_LANGUAGES,
  SUPPORTED_ACCOUNTS_LANGUAGE_CODES,
} from "Common/Types/Accounts/AccountsLanguage";

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

export type SupportedLanguage = AccountsLanguage;

export const SUPPORTED_LANGUAGES: Array<SupportedLanguage> =
  SUPPORTED_ACCOUNTS_LANGUAGES;

export const DEFAULT_LANGUAGE: string = DEFAULT_ACCOUNTS_LANGUAGE;
export const LANGUAGE_STORAGE_KEY: string = "oneuptimeLang";

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
    if (SUPPORTED_ACCOUNTS_LANGUAGE_CODES.includes(langPart)) {
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
    supportedLngs: SUPPORTED_ACCOUNTS_LANGUAGE_CODES,
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

export default i18n;
