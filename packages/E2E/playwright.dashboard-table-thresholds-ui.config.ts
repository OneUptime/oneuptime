import { defineConfig, devices } from "@playwright/test";
import path from "path";

export default defineConfig({
  testDir: "./DashboardTableThresholds",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 120000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir:
    "../../output/playwright/dashboard-table-thresholds-ui/test-results",
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
      },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 5"], viewport: { width: 390, height: 844 } },
    },
  ],
  use: {
    baseURL: "http://127.0.0.1:4452",
    timezoneId: "UTC",
    locale: "en-US",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node DashboardTableThresholds/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: "http://127.0.0.1:4452/ready",
    timeout: 300000,
    reuseExistingServer: false,
  },
});
