import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * The fixture server's port: STATUS_PAGE_SEARCH_FIXTURE_PORT, as server.js
 * reads it, so a second checkout's run on the same machine picks a port of
 * its own: STATUS_PAGE_SEARCH_FIXTURE_PORT=4720 npm run
 * test-status-page-search-ui.
 */
const port: string = process.env["STATUS_PAGE_SEARCH_FIXTURE_PORT"] || "4200";

export default defineConfig({
  testDir: "./StatusPageSearch",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/status-page-search/test-results",
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
    command: "node StatusPageSearch/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
