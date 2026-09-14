import { defineConfig, devices } from "@playwright/test";
import path from "path";

export default defineConfig({
  testDir: "./LabelRules",
  testMatch: "BrowserFixture.spec.ts",
  timeout: 90000,
  expect: { timeout: 15000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  outputDir:
    "../output/playwright/label-rule-import-export/fixture-test-results",
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1600, height: 1100 },
    baseURL: "http://127.0.0.1:4207",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node LabelRules/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: "http://127.0.0.1:4207",
    reuseExistingServer: !process.env["CI"],
    timeout: 300000,
  },
});
