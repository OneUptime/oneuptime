import { defineConfig, devices } from "@playwright/test";
import path from "path";

// The fixture's port: its server (Fixture/server.js) reads the same variable.
const port: string = process.env["DASHBOARD_TIME_RANGE_FIXTURE_PORT"] || "4371";

export default defineConfig({
  testDir: "./DashboardTimeRange",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 120000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/dashboard-time-range-ui/test-results",
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 5"], viewport: { width: 390, height: 844 } },
    },
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    timezoneId: "UTC",
    locale: "en-GB",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node DashboardTimeRange/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}/ready`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
