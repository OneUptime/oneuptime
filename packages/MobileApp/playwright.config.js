const { defineConfig } = require("@playwright/test");

const FOLDABLES = /foldables\.spec\.js$/;
const TABLETS = /tablets\.spec\.js$/;
// Suites that set their own windows, and so run once rather than at every size.
const RUN_ONCE = [FOLDABLES, TABLETS];

/*
 * The port the exported app is served on. 8096 unless MOBILE_UI_PORT says
 * otherwise, so two runs on one machine need not fight over it.
 */
const PORT = Number(process.env.MOBILE_UI_PORT || 8096);
const BASE_URL = `http://127.0.0.1:${PORT}`;

module.exports = defineConfig({
  testDir: "./tests/ui",
  timeout: 90000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 2,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    browserName: "chromium",
    locale: "en-GB",
    timezoneId: "Europe/London",
    screenshot: "only-on-failure",
    actionTimeout: 15000,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "small-phone",
      testIgnore: RUN_ONCE,
      use: { viewport: { width: 320, height: 740 } },
    },
    {
      name: "iphone-size",
      testIgnore: RUN_ONCE,
      use: { viewport: { width: 390, height: 844 } },
    },
    {
      name: "android-size",
      testIgnore: RUN_ONCE,
      use: { viewport: { width: 412, height: 915 } },
    },
    {
      name: "tablet",
      testIgnore: RUN_ONCE,
      use: { viewport: { width: 768, height: 1024 } },
    },
    /*
     * Foldables, run once: each test sets its own windows - the cover and
     * inner screens, the iPhone Duo held open, a phone on its side - and
     * resizes them mid-test the way a fold does, or has DevTools half close
     * them on a table or like a book (posture-foldables.spec.js).
     */
    {
      name: "foldables",
      testMatch: FOLDABLES,
      use: { viewport: { width: 884, height: 1104 } },
    },
    /*
     * A tablet on its side, run once: the rail, each list beside its detail
     * and Home in two columns - the wide-window half of the tablet gallery.
     */
    {
      name: "tablets",
      testMatch: TABLETS,
      use: { viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: "node tests/ui/serve.js",
    url: BASE_URL,
    reuseExistingServer: false,
  },
});
