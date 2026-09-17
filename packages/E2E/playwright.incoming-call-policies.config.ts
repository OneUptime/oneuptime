import { defineConfig, devices } from "@playwright/test";
import path from "path";

// Wide enough for every column of the policies table, Owners included.
const VIEWPORT: { width: number; height: number } = {
  width: 1600,
  height: 1000,
};

export default defineConfig({
  testDir: "./IncomingCallPolicies",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../output/playwright/incoming-call-policies/test-results",
  // A project's `use` wins over the top-level one, so the viewport goes here.
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: VIEWPORT },
    },
  ],
  use: {
    baseURL: "http://127.0.0.1:4214",
    timezoneId: "UTC",
    locale: "en-GB",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node IncomingCallPolicies/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: "http://127.0.0.1:4214",
    timeout: 300000,
    reuseExistingServer: false,
  },
});
