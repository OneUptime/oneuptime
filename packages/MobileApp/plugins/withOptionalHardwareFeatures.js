/*
 * Lets the app install on devices without the hardware its libraries hint at.
 *
 * @react-native-community/netinfo asks for ACCESS_WIFI_STATE, to tell Wi-Fi
 * from cellular. Google Play reads that permission as a requirement for
 * android.hardware.wifi, and hides the app from every device without Wi-Fi
 * hardware: Play Console's pre-review check flagged it on 1.7.0 as
 * "Required hardware feature declarations are restricting your app's
 * availability" (phones, tablets, desktops and Android XR). The app pages
 * people over any network, so Wi-Fi is declared optional; netinfo still
 * reports a Wi-Fi connection where there is one.
 */

const { withAndroidManifest } = require("expo/config-plugins");

/* Hardware the app uses when it is there and does without when it is not. */
const OPTIONAL_HARDWARE_FEATURES = ["android.hardware.wifi"];

const NAME_ATTRIBUTE = "android:name";
const REQUIRED_ATTRIBUTE = "android:required";

/*
 * Declares each optional feature as not required, keeping every other
 * declaration as it was and never listing a feature twice. Returns the
 * manifest it was given, as Expo's mods expect.
 */
function withOptionalFeatureDeclarations(androidManifest) {
  const manifest = androidManifest.manifest;
  const features = Array.isArray(manifest["uses-feature"])
    ? manifest["uses-feature"]
    : [];

  for (const name of OPTIONAL_HARDWARE_FEATURES) {
    const existing = features.find((feature) => {
      return feature && feature.$ && feature.$[NAME_ATTRIBUTE] === name;
    });
    if (existing) {
      existing.$[REQUIRED_ATTRIBUTE] = "false";
    } else {
      features.push({
        $: { [NAME_ATTRIBUTE]: name, [REQUIRED_ATTRIBUTE]: "false" },
      });
    }
  }

  manifest["uses-feature"] = features;
  return androidManifest;
}

function withOptionalHardwareFeatures(config) {
  return withAndroidManifest(config, (modConfig) => {
    modConfig.modResults = withOptionalFeatureDeclarations(
      modConfig.modResults,
    );
    return modConfig;
  });
}

module.exports = withOptionalHardwareFeatures;
module.exports.OPTIONAL_HARDWARE_FEATURES = OPTIONAL_HARDWARE_FEATURES;
module.exports.withOptionalFeatureDeclarations =
  withOptionalFeatureDeclarations;
