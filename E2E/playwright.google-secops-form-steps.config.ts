import { defineConfig, devices } from "@playwright/test";
import path from "path";

const VIEWPORT: { width: number; height: number } = {
  width: 1920,
  height: 1200,
};

export default defineConfig({
  testDir: "./GoogleSecOpsFormSteps",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../output/playwright/google-secops-form-steps/test-results",
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: VIEWPORT },
    },
  ],
  use: {
    baseURL: "http://127.0.0.1:4216",
    viewport: VIEWPORT,
    timezoneId: "UTC",
    locale: "en-GB",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node GoogleSecOpsFormSteps/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: "http://127.0.0.1:4216",
    timeout: 300000,
    reuseExistingServer: false,
  },
});
