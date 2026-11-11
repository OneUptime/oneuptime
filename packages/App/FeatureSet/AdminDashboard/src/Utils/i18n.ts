import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import { toDetectedLanguage } from "Common/Types/ReaderLanguage";
import { followLanguageForDates } from "Common/UI/Utils/DateDisplayLanguage";
import { followLanguageForPage } from "Common/UI/Utils/PageLanguage";
import { setCodeApartInSentence } from "Common/Types/CodeInSentence";
import {
  CODE_READS_AS_WRITTEN_POST_PROCESSOR,
  codeReadsAsWrittenPostProcessor,
  leaveIsolatesOutOfCopiedText,
  setCodeApartWith,
} from "Common/UI/Utils/CodeReadsAsWritten";

import {
  AdminDashboardLanguage,
  DEFAULT_ADMIN_DASHBOARD_LANGUAGE,
  SUPPORTED_ADMIN_DASHBOARD_LANGUAGES,
  SUPPORTED_ADMIN_DASHBOARD_LANGUAGE_CODES,
} from "Common/Types/AdminDashboard/AdminDashboardLanguage";
import { DASHBOARD_LANGUAGE_STORAGE_KEY } from "Common/Types/Dashboard/DashboardLanguage";

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
import ar from "../Locales/ar.json";

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
 * Every language's words are bundled above, so the rules that set the code
 * in the Arabic and Persian ones apart are bundled with them: there from
 * the first sentence (Common/UI/Utils/CodeReadsAsWritten).
 */
setCodeApartWith(setCodeApartInSentence);

i18n
  .use(LanguageDetector)
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
      ar: { translation: ar },
    },
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
