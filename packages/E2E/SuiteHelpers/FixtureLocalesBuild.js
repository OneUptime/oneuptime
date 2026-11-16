/*
 * The Dashboard's locales, built for an offline fixture as the Dashboard's
 * own build ships them (#8366).
 *
 * A fixture that imported a locale file whole bundled 6 to 9 MB of JSON for
 * each language, and every page load of every test parsed all of them,
 * whatever language the page was drawn in. NavigationSearch's bundle was 31
 * MB, 20 MB of it English, German and Arabic; with the suites' tracing on, a
 * test took three times as long as with it off, and on a loaded machine
 * tests ran past their timeout without failing an assertion (#7338).
 *
 * The Dashboard builds its locales with createRuntimeLocalesPlugin
 * (App/FeatureSet/Dashboard/esbuild.config.js): English, the fallback, in
 * the entry chunk without the keys that map to themselves, and each other
 * language a chunk of its own without the strings the English fallback
 * shows anyway. A fixture's server.js hands this plugin to createConfig, and
 * its page loads only its own language (FixtureLocales.js), so a fixture's
 * bundle no longer grows with every string the Dashboard adds.
 *
 * Node only: the fixture's page imports FixtureLocales.js, never this file.
 */
const path = require("path");
const {
  createRuntimeLocalesPlugin,
} = require("../../Common/UI/esbuild-locales.js");

const DASHBOARD_DIRECTORY = path.resolve(
  __dirname,
  "../../App/FeatureSet/Dashboard",
);

// The options the Dashboard's own build passes (esbuild.config.js).
const DASHBOARD_LOCALES_OPTIONS = Object.freeze({
  localesDirectory: path.join(DASHBOARD_DIRECTORY, "src", "Locales"),
  fallbackLanguage: "en",
  sameAsEnglishFile: path.join(
    DASHBOARD_DIRECTORY,
    "i18n",
    "SameAsEnglish.json",
  ),
  progressDirectory: path.join(DASHBOARD_DIRECTORY, "i18n", "Progress"),
});

/*
 * The plugin for createConfig's additionalPlugins: every Dashboard locale
 * the fixture imports, statically (en.json) or with import() (the others),
 * is bundled as the Dashboard bundles it.
 */
function dashboardLocalesPlugin() {
  return createRuntimeLocalesPlugin({ ...DASHBOARD_LOCALES_OPTIONS });
}

module.exports = {
  DASHBOARD_LOCALES_OPTIONS,
  dashboardLocalesPlugin,
};
