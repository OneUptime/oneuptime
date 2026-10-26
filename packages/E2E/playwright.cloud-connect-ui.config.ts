import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * Cloud > Connect in a real browser, with no backend: CloudConnect/server.js
 * bundles the actual Dashboard page with the app's esbuild config,
 * Tailwind, theme and font. What only a browser can show is checked here:
 * the three clouds' tiles, a cloud connected from its tile - the command in
 * its own shell, one paste, a test with what it found and what it costs -
 * an AWS role or an access key, one account or its whole organization, the
 * list's status and actions, Cloud > Accounts with an account's Overview
 * and Resources, and all of it at desktop and phone width, in the dark
 * theme, in German and in Japanese.
 *
 * CLOUD_CONNECT_FIXTURE_PORT moves the fixture off 4399, so a second
 * checkout can run the suite beside this one.
 */
const port: string = process.env["CLOUD_CONNECT_FIXTURE_PORT"] || "4399";

export default defineConfig({
  testDir: "./CloudConnect",
  testMatch: ["CloudConnect.spec.ts"],
  timeout: 90000,
  expect: { timeout: 15000 },
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "../../output/playwright/cloud-connect-ui/test-results",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    timezoneId: "UTC",
    locale: "en-GB",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
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
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      },
    },
  ],
  webServer: {
    command: "node CloudConnect/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env["CI"],
    timeout: 300000,
    env: { CLOUD_CONNECT_FIXTURE_PORT: port },
  },
});
