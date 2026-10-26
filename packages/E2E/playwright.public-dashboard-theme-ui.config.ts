import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * The fixture's port: 4351, or another one for a second copy running at the
 * same time (the server reads the same variable).
 */
const port: string =
  process.env["PUBLIC_DASHBOARD_THEME_FIXTURE_PORT"] || "4351";

export default defineConfig({
  testDir: "./PublicDashboardTheme",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/public-dashboard-theme-ui/test-results",
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
    command: "node PublicDashboardTheme/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}/release`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
