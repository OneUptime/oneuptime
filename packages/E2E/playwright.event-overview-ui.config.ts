import { defineConfig, devices } from "@playwright/test";
import path from "path";

export default defineConfig({
  testDir: "./EventOverview",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 120000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/event-overview-ui/test-results",
  projects: [
    {
      name: "chromium",
      /*
       * The viewport lives on the project: a project's `use` wins over the
       * top-level one, so devices["Desktop Chrome"] would otherwise reset it
       * to 1280x720.
       */
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
  ],
  use: {
    baseURL: "http://127.0.0.1:4222",
    locale: "en-US",
    timezoneId: "UTC",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node EventOverview/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: "http://127.0.0.1:4222",
    timeout: 300000,
    reuseExistingServer: !process.env["CI"],
  },
});
