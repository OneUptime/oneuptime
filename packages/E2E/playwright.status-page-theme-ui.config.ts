import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * The fixture's port: 4341, or another one for a second copy running at the
 * same time (the server reads the same variable).
 */
const port: string = process.env["STATUS_PAGE_THEME_FIXTURE_PORT"] || "4341";

export default defineConfig({
  testDir: "./StatusPageTheme",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/status-page-theme-ui/test-results",
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 5"] } },
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    timezoneId: "UTC",
    locale: "en-GB",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node StatusPageTheme/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}/release`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
