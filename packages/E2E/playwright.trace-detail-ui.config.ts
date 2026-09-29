import { defineConfig, devices } from "@playwright/test";
import path from "path";

export default defineConfig({
  testDir: "./TraceDetail",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 120000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/trace-detail-ui/test-results",
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
  ],
  use: {
    baseURL: "http://127.0.0.1:4231",
    locale: "en-GB",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node TraceDetail/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: "http://127.0.0.1:4231",
    timeout: 300000,
    reuseExistingServer: !process.env["CI"],
  },
});
