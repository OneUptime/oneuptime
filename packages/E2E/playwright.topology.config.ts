import { defineConfig } from "@playwright/test";
import path from "path";

export default defineConfig({
  testDir: "./Topology",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 120000,
  expect: { timeout: 30000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../output/playwright/topology/test-results",
  use: {
    baseURL: "http://127.0.0.1:4199",
    browserName: "chromium",
    viewport: { width: 1440, height: 1050 },
    timezoneId: "UTC",
    locale: "en-GB",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node Topology/server.js",
    cwd: path.resolve(__dirname),
    url: "http://127.0.0.1:4199",
    timeout: 300000,
    reuseExistingServer: !process.env["CI"],
  },
});
