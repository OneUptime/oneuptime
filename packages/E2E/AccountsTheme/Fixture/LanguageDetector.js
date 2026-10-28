/*
 * The sign-in pages' language, as the real detector finds it first: the one
 * their language switcher kept in the browser (Accounts' Utils/i18n.ts reads
 * localStorage before the browser's own languages). The spec keeps one there
 * before the page opens; without one, the page is in English, whatever the
 * browser running the suite is set to.
 */
const STORAGE_KEY = "oneuptimeLang";

class LanguageDetector {
  init() {}

  detect() {
    try {
      return window.localStorage.getItem(STORAGE_KEY) || "en";
    } catch {
      return "en";
    }
  }

  cacheUserLanguage(language) {
    try {
      window.localStorage.setItem(STORAGE_KEY, language);
    } catch {
      // A browser that keeps nothing: the page keeps its language until it closes.
    }
  }
}

LanguageDetector.type = "languageDetector";

module.exports = LanguageDetector;
module.exports.default = LanguageDetector;
