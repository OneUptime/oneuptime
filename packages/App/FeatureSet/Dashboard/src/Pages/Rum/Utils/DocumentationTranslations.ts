import { SetupGuideTranslations } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The RUM setup guide in every language the Dashboard is read in (#6434,
 * #8341): each language's words for its markdown are in
 * DocumentationTranslations/<code>.ts, a chunk fetched only by a reader of
 * that language (SetupGuideCard). A change to the guide's English
 * (Components/Rum/RumSetupGuide.ts) changes every translation in the same
 * pull request: SetupGuideDocumentationInLocale holds each to the
 * English's pieces, code and links.
 */
export const RUM_DOCUMENTATION_TRANSLATIONS: SetupGuideTranslations = {
  de: () => {
    return import("../DocumentationTranslations/de");
  },
  fr: () => {
    return import("../DocumentationTranslations/fr");
  },
  es: () => {
    return import("../DocumentationTranslations/es");
  },
  it: () => {
    return import("../DocumentationTranslations/it");
  },
  pt: () => {
    return import("../DocumentationTranslations/pt");
  },
  nl: () => {
    return import("../DocumentationTranslations/nl");
  },
  da: () => {
    return import("../DocumentationTranslations/da");
  },
  no: () => {
    return import("../DocumentationTranslations/no");
  },
  sv: () => {
    return import("../DocumentationTranslations/sv");
  },
  ru: () => {
    return import("../DocumentationTranslations/ru");
  },
  ja: () => {
    return import("../DocumentationTranslations/ja");
  },
  ko: () => {
    return import("../DocumentationTranslations/ko");
  },
  "zh-CN": () => {
    return import("../DocumentationTranslations/zh-CN");
  },
  "zh-TW": () => {
    return import("../DocumentationTranslations/zh-TW");
  },
  hi: () => {
    return import("../DocumentationTranslations/hi");
  },
  fa: () => {
    return import("../DocumentationTranslations/fa");
  },
  ar: () => {
    return import("../DocumentationTranslations/ar");
  },
};
