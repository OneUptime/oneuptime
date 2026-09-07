import { defineConfig } from "@playwright/test";
import path from "path";

export default defineConfig({
  testDir: "./OperationsOverview",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../output/playwright/operations-overview/test-results",
  use: {
    baseURL: "http://127.0.0.1:4201",
    browserName: "chromium",
    viewport: { width: 1440, height: 1100 },
    timezoneId: "UTC",
    locale: "en-GB",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node OperationsOverview/server.js",
    cwd: path.resolve(__dirname),
    url: "http://127.0.0.1:4201",
    timeout: 300000,
    reuseExistingServer: false,
  },
});
