import { defineConfig, devices } from "@playwright/test";
import path from "path";

// Wide enough for the burn rate rules table to render every column.
const WIDE_VIEWPORT: { width: number; height: number } = {
  width: 1920,
  height: 1200,
};

export default defineConfig({
  testDir: "./SloBurnRate",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../output/playwright/slo-burn-rate/test-results",
  /*
   * The viewport is set INSIDE the project, after the device spread: a
   * project's `use` wins over the top-level one, so a viewport declared only
   * at the top level is silently replaced by Desktop Chrome's 1280x720 and the
   * table's last columns fall off the right edge of every screenshot.
   */
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: WIDE_VIEWPORT },
    },
  ],
  use: {
    baseURL: "http://127.0.0.1:4213",
    viewport: WIDE_VIEWPORT,
    timezoneId: "UTC",
    locale: "en-GB",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node SloBurnRate/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: "http://127.0.0.1:4213",
    timeout: 300000,
    reuseExistingServer: !process.env["CI"],
  },
});
