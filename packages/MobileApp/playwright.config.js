const { defineConfig } = require("@playwright/test");

const FOLDABLES = /foldables\.spec\.js$/;

module.exports = defineConfig({
  testDir: "./tests/ui",
  timeout: 90000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 2,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:8096",
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
      testIgnore: FOLDABLES,
      use: { viewport: { width: 320, height: 740 } },
    },
    {
      name: "iphone-size",
      testIgnore: FOLDABLES,
      use: { viewport: { width: 390, height: 844 } },
    },
    {
      name: "android-size",
      testIgnore: FOLDABLES,
      use: { viewport: { width: 412, height: 915 } },
    },
    {
      name: "tablet",
      testIgnore: FOLDABLES,
      use: { viewport: { width: 768, height: 1024 } },
    },
    /*
     * Foldables, run once: each test sets its own windows - the cover and
     * inner screens, the iPhone Duo held open, a phone on its side - and
     * resizes them mid-test the way a fold does.
     */
    {
      name: "foldables",
      testMatch: FOLDABLES,
      use: { viewport: { width: 884, height: 1104 } },
    },
  ],
  webServer: {
    command: "node tests/ui/serve.js",
    url: "http://127.0.0.1:8096",
    reuseExistingServer: false,
  },
});
