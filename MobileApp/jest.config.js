/*
 * jest-expo's preset is what makes React Native's ESM-only packages loadable
 * and provides the module mocks Expo's own native modules need. `node` is the
 * project name the preset uses for plain (non-platform-specific) test runs.
 */
module.exports = {
  preset: "jest-expo",
  setupFilesAfterEnv: ["<rootDir>/src/__tests__/setup.ts"],
  testMatch: ["<rootDir>/src/**/*.test.ts", "<rootDir>/src/**/*.test.tsx"],
  /*
   * The shared setup file lives under __tests__ so it sits with the tests it
   * serves; without this it would be collected as a (empty) test suite and
   * fail the run.
   */
  testPathIgnorePatterns: ["<rootDir>/node_modules/", "<rootDir>/src/__tests__/setup.ts"],
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.test.{ts,tsx}",
    "!src/__tests__/**",
  ],
  clearMocks: true,
  /*
   * React Native component renders pull in font and native-module shims on
   * first use, which can take well over Jest's 5s default on a cold cache -
   * long enough to fail a screen test that is doing nothing wrong.
   */
  testTimeout: 30000,
};
