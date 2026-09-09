import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./LabelRules",
  testMatch: "ImportExport.spec.ts",
  timeout: 180000,
  expect: { timeout: 30000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "../output/playwright/label-rule-import-export/test-results",
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1600, height: 1100 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium" }],
});
