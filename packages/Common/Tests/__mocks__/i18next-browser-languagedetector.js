"use strict";

/*
 * The real detector is only installed in the frontend feature sets. Tests that
 * render status page components import Utils/i18n, which registers this plugin,
 * so a minimal stand-in that always resolves to English is enough.
 */
class LanguageDetector {
  init() {}

  detect() {
    return "en";
  }

  cacheUserLanguage() {}
}

LanguageDetector.type = "languageDetector";

module.exports = LanguageDetector;
module.exports.default = LanguageDetector;
