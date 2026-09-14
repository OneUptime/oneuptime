import { defineConfig, devices } from "@playwright/test";
import path from "path";

export default defineConfig({
  testDir: "./Alerts",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../output/playwright/alerts/test-results",
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
  use: {
    baseURL: "http://127.0.0.1:4211",
    viewport: { width: 1440, height: 1000 },
    timezoneId: "UTC",
    locale: "en-GB",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node Alerts/server.js",
    cwd: path.resolve(__dirname),
    url: "http://127.0.0.1:4211",
    timeout: 300000,
    reuseExistingServer: false,
  },
});
