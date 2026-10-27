import i18n from "i18next";
import { initReactI18next } from "react-i18next";

/*
 * THE WORDS A PAGE'S VISITOR READS, IN THE BROWSER'S LANGUAGE.
 *
 * A public dashboard's visitor picks no language: there is no menu to pick
 * one from, and nothing remembers one. What the page has words for in their
 * language - a locale file of its own, as every frontend has - it says in
 * the first language of theirs it speaks, as the browser lists them
 * (navigator.languages), and everything else in English.
 *
 * Unlike a frontend whose every screen is translated, the page itself does
 * not follow: <html lang> and <html dir> stay as the server drew them, and
 * dates keep their English. A screen that speaks the visitor's language
 * says so itself (PageScreenCard's lang and dir), so a Persian one reads
 * right to left on a page laid out left to right.
 */

/*
 * The supported language a browser's language tag stands for, or "" when
 * none: the Chinese tags onto Simplified and Traditional Chinese as every
 * frontend maps them (zh-TW, zh-HK, zh-MO and Hant are Traditional), the
 * code itself when it is supported, else its language part ("de-AT" is
 * "de").
 */
export const toSupportedLanguage: (
  code: string | null | undefined,
  supportedLanguages: ReadonlyArray<string>,
) => string = (
  code: string | null | undefined,
  supportedLanguages: ReadonlyArray<string>,
): string => {
  if (!code || typeof code !== "string") {
    return "";
  }

  const lower: string = code.toLowerCase();

  if (
    lower === "zh-tw" ||
    lower === "zh-hk" ||
    lower === "zh-mo" ||
    lower === "zh-hant" ||
    lower.startsWith("zh-hant-")
  ) {
    return supportedLanguages.includes("zh-TW") ? "zh-TW" : "";
  }

  if (lower === "zh" || lower.startsWith("zh-") || lower.startsWith("zh_")) {
    return supportedLanguages.includes("zh-CN") ? "zh-CN" : "";
  }

  if (supportedLanguages.includes(code)) {
    return code;
  }

  const base: string = lower.split(/[-_]/)[0] || "";

  return supportedLanguages.includes(base) ? base : "";
};

// The first of the browser's languages that is supported, else English.
export const getVisitorLanguage: (
  browserLanguages: ReadonlyArray<string>,
  supportedLanguages: ReadonlyArray<string>,
) => string = (
  browserLanguages: ReadonlyArray<string>,
  supportedLanguages: ReadonlyArray<string>,
): string => {
  for (const browserLanguage of browserLanguages) {
    const supported: string = toSupportedLanguage(
      browserLanguage,
      supportedLanguages,
    );

    if (supported) {
      return supported;
    }
  }

  return "en";
};

export const getBrowserLanguages: () => ReadonlyArray<string> =
  (): ReadonlyArray<string> => {
    if (typeof navigator === "undefined") {
      return [];
    }

    if (Array.isArray(navigator.languages) && navigator.languages.length > 0) {
      return navigator.languages;
    }

    return navigator.language ? [navigator.language] : [];
  };

export type VisitorLocales = Record<string, Record<string, string>>;

/*
 * Sets up the frontend's translation from its locale files, in the
 * visitor's language. Called once, before the first render.
 */
export const startVisitorTranslation: (locales: VisitorLocales) => string = (
  locales: VisitorLocales,
): string => {
  const supportedLanguages: Array<string> = Object.keys(locales);

  const language: string = getVisitorLanguage(
    getBrowserLanguages(),
    supportedLanguages,
  );

  const resources: Record<string, { translation: Record<string, string> }> =
    {};

  for (const code of supportedLanguages) {
    resources[code] = { translation: locales[code] || {} };
  }

  void i18n.use(initReactI18next).init({
    lng: language,
    fallbackLng: "en",
    supportedLngs: supportedLanguages,
    resources: resources,
    keySeparator: false,
    nsSeparator: false,
    interpolation: {
      escapeValue: false,
    },
  });

  return language;
};
