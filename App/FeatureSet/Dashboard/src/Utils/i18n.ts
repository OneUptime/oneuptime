import i18n, { BackendModule, ReadCallback, ResourceKey } from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import {
  DashboardLanguage,
  DEFAULT_DASHBOARD_LANGUAGE,
  SUPPORTED_DASHBOARD_LANGUAGES,
  SUPPORTED_DASHBOARD_LANGUAGE_CODES,
} from "Common/Types/Dashboard/DashboardLanguage";

import { loadLocaleResource, LocaleResource } from "./I18nLocaleLoader";

/*
 * English is the ONLY locale bundled statically: it is the fallback language,
 * so it must be available synchronously from the very first render. Every
 * other locale is code-split into its own chunk and fetched on demand by the
 * lazy backend below — keeping ~11MB of unused translations out of the entry
 * bundle.
 */
import en from "../Locales/en.json";

export type SupportedLanguage = DashboardLanguage;

export const SUPPORTED_LANGUAGES: Array<SupportedLanguage> =
  SUPPORTED_DASHBOARD_LANGUAGES;

export const DEFAULT_LANGUAGE: string = DEFAULT_DASHBOARD_LANGUAGE;
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
    if (SUPPORTED_DASHBOARD_LANGUAGE_CODES.includes(langPart)) {
      return langPart;
    }
  }
  return lng;
};

/*
 * i18next backend that resolves a non-English language to its lazily-loaded
 * chunk (see I18nLocaleLoader). With `partialBundledLanguages: true` below,
 * i18next only calls this for languages missing from the static `resources`
 * map — i.e. never for English. A failed chunk fetch is reported back to
 * i18next (which retries, then gives up and serves the English fallback)
 * rather than thrown, so a flaky network can never take the app down.
 */
const lazyLocaleBackend: BackendModule = {
  type: "backend",
  init: (): void => {
    // Nothing to configure — the locale loader is stateless.
  },
  read: (
    language: string,
    _namespace: string,
    callback: ReadCallback,
  ): void => {
    loadLocaleResource(language)
      .then((resource: LocaleResource): void => {
        callback(null, resource as ResourceKey);
      })
      .catch((error: unknown): void => {
        callback(error as Error, null);
      });
  },
};

/*
 * Initialization is asynchronous now that non-English locales are fetched on
 * demand: Index.tsx awaits this promise before the first render, so a user
 * whose detected language is (say) Japanese never sees raw translation keys.
 * For English — already in memory — this settles in a microtask. The promise
 * always settles: if a locale chunk cannot be fetched, i18next exhausts its
 * retries and initialization still completes with the English fallback.
 */
export const i18nReady: Promise<void> = i18n
  .use(LanguageDetector)
  .use(lazyLocaleBackend)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
    },
    partialBundledLanguages: true,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: SUPPORTED_DASHBOARD_LANGUAGE_CODES,
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
  })
  .then((): void => {
    // Resolve with void — callers only care about readiness, not `t`.
  });

export default i18n;
