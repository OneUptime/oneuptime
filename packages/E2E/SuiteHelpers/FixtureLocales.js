/*
 * The page's language, loaded as the Dashboard loads it (#8366).
 *
 * A fixture used to import every language it could draw a page in
 * (`import DE from ".../Locales/de.json"`), 6 to 9 MB of JSON each, so every
 * page load of every test parsed all of them, whatever language the page was
 * in. The Dashboard bundles English, its fallback, and loads one other
 * language, the reader's, as a chunk of its own (src/Utils/I18nLocaleLoader).
 * A fixture does the same: English is imported statically, and every other
 * language has a loader, an `import()` of a string literal, that only a page
 * drawn in that language calls:
 *
 *   const LOCALE_LOADERS = {
 *     de: () => import("../../../App/FeatureSet/Dashboard/src/Locales/de.json"),
 *   };
 *
 *   await i18next.use(initReactI18next).init({
 *     lng: language,
 *     fallbackLng: "en",
 *     resources: await localeResources({ language, english: EN, loaders: LOCALE_LOADERS }),
 *   });
 *
 * Keep each specifier a literal: esbuild makes a chunk of each file it can
 * read there, and Tests/Ops/E2EFixtureDateLanguage reads the locales a
 * fixture loads from its imports, these included. The fixture's server.js
 * builds them as the Dashboard does (FixtureLocalesBuild.js).
 *
 * CommonJS with no imports, so the page bundles it and Tests/Ops reads it.
 */

// What a loader's import() gives: the module, the locale its default export.
function localeOf(loaded) {
  if (loaded && typeof loaded === "object" && "default" in loaded) {
    return loaded.default;
  }

  return loaded;
}

function hasLoader(loaders, language) {
  return (
    typeof language === "string" &&
    Boolean(loaders) &&
    Object.prototype.hasOwnProperty.call(loaders, language) &&
    typeof loaders[language] === "function"
  );
}

/*
 * i18next's resources for a page drawn in `language`: English (`english`,
 * or none, when the keys are the English) and, for another language the
 * fixture draws, that language alone, from its loader. A language with no
 * loader (English, or one the fixture does not draw) loads nothing more.
 */
async function localeResources(options) {
  const { language, english, loaders } = options || {};
  const resources = { en: { translation: english || {} } };

  if (language !== "en" && hasLoader(loaders, language)) {
    resources[language] = {
      translation: localeOf(await loaders[language]()),
    };
  }

  return resources;
}

/*
 * For a page that changes its language while it is open: loads the
 * language's words, once, into `i18n`, then switches to it.
 */
async function changeToLanguage(i18n, language, loaders) {
  if (
    language !== "en" &&
    hasLoader(loaders, language) &&
    !i18n.hasResourceBundle(language, "translation")
  ) {
    i18n.addResourceBundle(
      language,
      "translation",
      localeOf(await loaders[language]()),
    );
  }

  await i18n.changeLanguage(language);
}

module.exports = {
  localeResources,
  changeToLanguage,
};
