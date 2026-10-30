import { defineConfig, devices } from "@playwright/test";
import path from "path";

// The fixture server reads the same variable, so two runs can sit side by side.
const port: string = process.env["DATA_SECURITY_FIXTURE_PORT"] || "4255";

export default defineConfig({
  testDir: "./DataSecurity",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 120000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/data-security-ui/test-results",
  projects: [
    {
      name: "chromium",
      /*
       * The viewport lives on the project: a project's `use` wins over the
       * top-level one, so devices["Desktop Chrome"] would otherwise reset it
       * to 1280x720. Each test sets its own width.
       */
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 1000 },
      },
    },
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    locale: "en-US",
    timezoneId: "UTC",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node DataSecurity/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: !process.env["CI"],
  },
});
