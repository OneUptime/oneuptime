import { defineConfig, devices } from "@playwright/test";

/*
 * The helpers the focused suites share (SuiteHelpers/), each held to its job
 * on pages the spec writes itself: no fixture server, nothing bundled, a few
 * seconds in each browser. The suites lean on them in Chromium and Firefox,
 * so both run here.
 */
export default defineConfig({
  testDir: "./SuiteHelpers",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/suite-helpers-ui/test-results",
  use: {
    locale: "en-US",
    timezoneId: "UTC",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
  ],
});
