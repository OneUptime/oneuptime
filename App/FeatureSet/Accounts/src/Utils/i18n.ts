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

export default i18n;
