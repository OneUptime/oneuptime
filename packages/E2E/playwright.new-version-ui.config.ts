import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * A new version of OneUptime deployed under an open tab, in real Chromium,
 * with no backend: NewVersion/Fixture/server.js builds a small app made of
 * the real new-version pieces twice - build A and build B - with Common's
 * own build() and serves one, and the spec "deploys" the other mid-session:
 * the notice, the next page opened loading the new version in full, a page
 * whose code is gone updating into the same address and scroll, unsaved
 * changes holding it all back, offline, a server restarting, a part gone
 * for good, and one widget's code gone - at a laptop's and a phone's
 * width, light and dark, in German and in Persian (right to left).
 */
const port: string = process.env["NEW_VERSION_FIXTURE_PORT"] || "4618";

export default defineConfig({
  testDir: "./NewVersion",
  testMatch: "NewVersion.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/new-version-ui/test-results",
  // A project's `use` wins over the top-level one, so the viewport goes here.
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
      },
    },
    {
      name: "phone",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    timezoneId: "UTC",
    locale: "en-US",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node NewVersion/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}/dashboard/home`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
