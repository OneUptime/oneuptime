/*
 * Keeps the app - and everything on its screen - running through a fold.
 *
 * Android restarts an activity for every configuration change the activity
 * does not declare in android:configChanges, and for a React Native app a
 * restart draws the whole React tree again from nothing: the incident being
 * read, how far down it was scrolled, a half-written note and an open sheet
 * are all gone, and the responder lands back on Home.
 *
 * Expo's template already declares the changes a rotation or a resize makes
 * (orientation, screenSize, screenLayout, smallestScreenSize). It does not
 * declare `density`, and folding or unfolding changes the display density on
 * foldables whose two screens are not equally dense - Android's foldable
 * guidance names landscape foldables and trifolds, and a Galaxy Z Fold's
 * cover screen runs at a different density from its inner one. Without it,
 * unfolding one of those restarts the app.
 *
 * Declaring it is safe for React Native 0.86: on a configuration change
 * ReactHost re-reads the display metrics (DisplayMetricsHolder), and every
 * measure of the root view hands Fabric the current density
 * (ReactSurfaceImpl.updateLayoutSpecs), so the app re-lays itself out at the
 * new density in place.
 *
 * resizeableActivity is true by default since Android 7, and for apps that
 * target Android 16 the system ignores it on large screens anyway. It is
 * written out so that nothing - a template change, a plugin, a fork - can
 * quietly opt the app out of split screen and desktop windows.
 */

const { withAndroidManifest, AndroidConfig } = require("expo/config-plugins");

/* Every change Android may make while the app is on screen, handled in place. */
const FOLDABLE_CONFIG_CHANGES = [
  "keyboard",
  "keyboardHidden",
  "orientation",
  "screenLayout",
  "screenSize",
  "smallestScreenSize",
  "uiMode",
  "density",
];

const CONFIG_CHANGES_ATTRIBUTE = "android:configChanges";
const RESIZEABLE_ATTRIBUTE = "android:resizeableActivity";

function parseConfigChanges(value) {
  return String(value || "")
    .split("|")
    .map((change) => {
      return change.trim();
    })
    .filter(Boolean);
}

/*
 * Adds the foldable changes to the main activity, keeping whatever was there
 * first and in its order, and never listing one twice. Returns the manifest
 * it was given, as Expo's mods expect.
 */
function applyFoldableContinuity(androidManifest) {
  const mainActivity =
    AndroidConfig.Manifest.getMainActivityOrThrow(androidManifest);
  const attributes = mainActivity.$ || {};
  const existing = parseConfigChanges(attributes[CONFIG_CHANGES_ATTRIBUTE]);
  const merged = existing.concat(
    FOLDABLE_CONFIG_CHANGES.filter((change) => {
      return !existing.includes(change);
    }),
  );

  mainActivity.$ = {
    ...attributes,
    [CONFIG_CHANGES_ATTRIBUTE]: merged.join("|"),
    [RESIZEABLE_ATTRIBUTE]: "true",
  };

  return androidManifest;
}

function withFoldableContinuity(config) {
  return withAndroidManifest(config, (modConfig) => {
    modConfig.modResults = applyFoldableContinuity(modConfig.modResults);
    return modConfig;
  });
}

module.exports = withFoldableContinuity;
module.exports.FOLDABLE_CONFIG_CHANGES = FOLDABLE_CONFIG_CHANGES;
module.exports.applyFoldableContinuity = applyFoldableContinuity;
module.exports.parseConfigChanges = parseConfigChanges;
