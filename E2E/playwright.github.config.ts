import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./Tests/Dashboard",
  testMatch: "GitHubIntegration.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 240000,
  expect: { timeout: 15000 },
  reporter: [["list"]],
  outputDir: "../output/playwright/github/test-results",
  use: {
    browserName: "chromium",
    viewport: { width: 1440, height: 1080 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
