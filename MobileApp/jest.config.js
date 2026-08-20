/*
 * The suite runs TWICE: once as iOS, once as Android.
 *
 * jest-expo's default preset hard-codes `platform: "ios"` in its Babel caller
 * (node_modules/jest-expo/jest-preset.js), and babel-preset-expo INLINES
 * `Platform.OS` from it. So under the plain preset every `Platform.OS` in the
 * app is the literal "ios" at test time - which means no amount of mocking can
 * exercise an Android code path, and an Android-only regression cannot fail
 * the build.
 *
 * That matters most for SSO. `WebBrowser.openAuthSessionAsync` is a native
 * ASWebAuthenticationSession on iOS and a JS AppState/Linking race on Android,
 * and the two return different result types for the same successful login.
 * Running both projects is what keeps that difference honest.
 *
 * jest-expo/ios and jest-expo/android are the presets Expo ships for exactly
 * this; `projects` runs them in parallel and labels each failure with its
 * platform.
 */

const path = require("path");

/*
 * Shared between the two platform projects. `preset` is resolved per project
 * below - everything else is identical, because a test that only holds on one
 * platform is a test that is lying about one of them.
 */
const sharedProjectConfig = {
  setupFilesAfterEnv: [path.join(__dirname, "src/__tests__/setup.ts")],
  testMatch: [
    "<rootDir>/src/**/*.test.ts",
    "<rootDir>/src/**/*.test.tsx",
  ],
  /*
   * The shared setup file lives under __tests__ so it sits with the tests it
   * serves; without this it would be collected as a (empty) test suite and
   * fail the run.
   */
  testPathIgnorePatterns: [
    "<rootDir>/node_modules/",
    "<rootDir>/src/__tests__/setup.ts",
  ],
  clearMocks: true,
};

module.exports = {
  projects: [
    {
      ...sharedProjectConfig,
      displayName: { name: "ios", color: "white" },
      preset: "jest-expo/ios",
      rootDir: __dirname,
    },
    {
      ...sharedProjectConfig,
      displayName: { name: "android", color: "blueBright" },
      preset: "jest-expo/android",
      rootDir: __dirname,
      testPathIgnorePatterns: [
        ...sharedProjectConfig.testPathIgnorePatterns,
        /*
         * iOS-only for a TEST-TOOLING reason, not a product one. React Native
         * renders <Switch> as the host component `RCTSwitch` on iOS and
         * `AndroidSwitch` on Android; both carry accessibilityRole "switch",
         * but @testing-library/react-native's role matcher only recognises the
         * iOS one, so getByRole("switch") finds nothing under the Android
         * preset. The Settings toggles themselves work on Android - only this
         * suite's query does not. Everything else, including all SSO tests,
         * runs on both platforms.
         */
        "<rootDir>/src/screens/SettingsScreenCriticalAlerts.test.tsx",
      ],
    },
  ],
  /*
   * React Native component renders pull in font and native-module shims on
   * first use, which can take well over Jest's 5s default on a cold cache -
   * long enough to fail a screen test that is doing nothing wrong. Jest only
   * honours this at the top level, not per project.
   */
  testTimeout: 30000,
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.test.{ts,tsx}",
    "!src/__tests__/**",
  ],
};
