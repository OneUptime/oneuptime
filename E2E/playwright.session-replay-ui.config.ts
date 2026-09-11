import { defineConfig, devices } from "@playwright/test";
import path from "path";

export default defineConfig({
  testDir: "./SessionReplay",
  testMatch: "BrowserFixture.spec.ts",
  timeout: 60000,
  expect: { timeout: 10000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  outputDir: "../output/playwright/session-replay-ui/test-results",
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1600, height: 1100 },
    baseURL: "http://127.0.0.1:4212",
    actionTimeout: 15000,
    navigationTimeout: 30000,
    timezoneId: "UTC",
    locale: "en-GB",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node SessionReplay/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: "http://127.0.0.1:4212",
    reuseExistingServer: false,
    timeout: 300000,
  },
});
