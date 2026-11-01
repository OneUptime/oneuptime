import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import {
  getVisitorLanguage,
  toSupportedLanguage,
} from "../../Types/ReaderLanguage";

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
 * Which supported language a browser's language tag stands for, and the
 * first of a browser's languages a page has words for: in
 * Common/Types/ReaderLanguage, which the server reads tags with too.
 */
export { getVisitorLanguage, toSupportedLanguage };

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

  const resources: Record<string, { translation: Record<string, string> }> = {};

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
