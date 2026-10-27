import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * The sign-in pages in the person's theme (AccountsTheme/). The fixture's
 * port: 4346, or another one for a second copy running at the same time
 * (the server reads the same variable). Each test sets its own viewport
 * widths: a laptop's and a phone's.
 */
const port: string = process.env["ACCOUNTS_THEME_FIXTURE_PORT"] || "4346";

export default defineConfig({
  testDir: "./AccountsTheme",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/accounts-theme-ui/test-results",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    timezoneId: "UTC",
    locale: "en-GB",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node AccountsTheme/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}/release`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
