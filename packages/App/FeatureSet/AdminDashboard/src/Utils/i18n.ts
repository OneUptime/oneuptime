import i18n, { BackendModule, ReadCallback, ResourceKey } from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import { toDetectedLanguage } from "Common/Types/ReaderLanguage";
import { withNoBreakSpacesInLocale } from "Common/Types/NoBreakSpaces";
import { followLanguageForDates } from "Common/UI/Utils/DateDisplayLanguage";
import { followLanguageForPage } from "Common/UI/Utils/PageLanguage";
import {
  CODE_READS_AS_WRITTEN_POST_PROCESSOR,
  codeReadsAsWrittenPostProcessor,
  leaveIsolatesOutOfCopiedText,
  whenCodeCanBeSetApart,
} from "Common/UI/Utils/CodeReadsAsWritten";

import {
  AdminDashboardLanguage,
  DEFAULT_ADMIN_DASHBOARD_LANGUAGE,
  SUPPORTED_ADMIN_DASHBOARD_LANGUAGES,
  SUPPORTED_ADMIN_DASHBOARD_LANGUAGE_CODES,
} from "Common/Types/AdminDashboard/AdminDashboardLanguage";
import { DASHBOARD_LANGUAGE_STORAGE_KEY } from "Common/Types/Dashboard/DashboardLanguage";

import { loadLocaleResource, LocaleResource } from "./I18nLocaleLoader";

/*
 * English is the ONLY locale bundled statically: it is the fallback
 * language, so it must be there, synchronously, from the very first render.
 * Every other language is a chunk of its own, fetched on demand by the lazy
 * backend below (I18nLocaleLoader), so a page load downloads the reader's
 * language alone, not all eighteen: they were about 4.2 MB of the entry
 * chunk (#8146).
 *
 * What this import bundles is not the whole file: the build drops the keys
 * that map to themselves ("Save": "Save"), since every lookup passes the
 * English as its default or is the English itself, and the plural "_one"
 * forms, which translatePlural is handed by the code; it keeps the nested
 * keys (Common/UI/esbuild-locales.js). The lazy chunks likewise ship without
 * the strings English reads the same, which is why English must stay both
 * the fallback and in this bundle - and why each chunk carries the "_one"
 * forms its language reads, since this bundle does not.
 * Common/Tests/App/AdminDashboard/AdminRuntimeLocales proves every lookup
 * reads the same from the shipped copies as from the files.
 */
import en from "../Locales/en.json";

export type SupportedLanguage = AdminDashboardLanguage;

export const SUPPORTED_LANGUAGES: Array<SupportedLanguage> =
  SUPPORTED_ADMIN_DASHBOARD_LANGUAGES;

export const DEFAULT_LANGUAGE: string = DEFAULT_ADMIN_DASHBOARD_LANGUAGE;
export const LANGUAGE_STORAGE_KEY: string = DASHBOARD_LANGUAGE_STORAGE_KEY;

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

  return toDetectedLanguage(lng, SUPPORTED_ADMIN_DASHBOARD_LANGUAGE_CODES);
};

/*
 * i18next backend that resolves a language other than English to its lazily
 * loaded chunk (I18nLocaleLoader). With `partialBundledLanguages: true`
 * below, i18next only calls it for a language missing from the static
 * `resources` - never for English. A chunk that cannot be fetched is
 * reported back to i18next (which retries, then gives up and serves the
 * English fallback) rather than thrown, so a flaky network never takes the
 * page down.
 */
const lazyLocaleBackend: BackendModule = {
  type: "backend",
  init: (): void => {
    // Nothing to configure: the locale loader keeps no state.
  },
  read: (
    language: string,
    _namespace: string,
    callback: ReadCallback,
  ): void => {
    /*
     * An Arabic or Persian locale arrives with the rules that set the code
     * in its sentences apart, which no other language loads
     * (Common/UI/Utils/CodeReadsAsWritten).
     */
    Promise.all([loadLocaleResource(language), whenCodeCanBeSetApart(language)])
      .then(([resource]: [LocaleResource, void]): void => {
        /*
         * Its words as the language sets a line: each number with its
         * unit, and French's marks with their words (Common/Types/
         * NoBreakSpaces).
         */
        callback(
          null,
          withNoBreakSpacesInLocale({
            locale: resource,
            language,
            english: en,
          }) as ResourceKey,
        );
      })
      .catch((error: unknown): void => {
        callback(error as Error, null);
      });
  },
};

/*
 * Initialization is asynchronous now that every language but English is
 * fetched on demand: Index.tsx waits for this promise before the first
 * render, so a reader whose language is (say) Persian never sees a frame of
 * English first. For English - already in memory - it settles in a
 * microtask. It always settles: if a chunk cannot be fetched, i18next
 * exhausts its retries and initialization still completes, in English.
 */
export const i18nReady: Promise<void> = i18n
  .use(LanguageDetector)
  .use(lazyLocaleBackend)
  .use(initReactI18next)
  .use(codeReadsAsWrittenPostProcessor)
  .init({
    /*
     * Code in an Arabic or Persian sentence drawn as it is written. Not
     * the installation's own name: the license this dashboard manages
     * names its licensor (ProductNameTranslation).
     */
    postProcess: [CODE_READS_AS_WRITTEN_POST_PROCESSOR],
    resources: {
      en: { translation: en },
    },
    partialBundledLanguages: true,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: SUPPORTED_ADMIN_DASHBOARD_LANGUAGE_CODES,
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
    // Resolve with void: callers only care about readiness, not `t`.
  });

// Dates, times and durations in the reader's language too.
followLanguageForDates(i18n);

/*
 * <html lang> and <html dir> follow the reader's language: a screen reader
 * reads the page in it, and a Persian or Arabic page reads right to left.
 */
followLanguageForPage(i18n);

// Code copied from a sentence pastes without the marks that set it apart.
leaveIsolatesOutOfCopiedText();

export default i18n;
