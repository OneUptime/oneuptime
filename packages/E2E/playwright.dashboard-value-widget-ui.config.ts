import { defineConfig, devices } from "@playwright/test";
import path from "path";

// The fixture's port: its server (Fixture/server.js) reads the same variable.
const port: string =
  process.env["DASHBOARD_VALUE_WIDGET_FIXTURE_PORT"] || "4427";

export default defineConfig({
  testDir: "./DashboardValueWidget",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 120000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/dashboard-value-widget-ui/test-results",
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
    baseURL: `http://127.0.0.1:${port}`,
    timezoneId: "UTC",
    locale: "en-GB",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node DashboardValueWidget/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}/ready`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
