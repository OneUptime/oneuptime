import { defineConfig, devices } from "@playwright/test";
import path from "path";

// The fixture server reads the same variable, so two runs can sit side by side.
const port: string = process.env["SECURITY_OPERATIONS_FIXTURE_PORT"] || "4234";

export default defineConfig({
  testDir: "./SecurityOperations",
  testMatch: "*.spec.ts",
  /*
   * Hunts run as a suite of their own (playwright.security-hunts-ui.config.ts),
   * and so do the five shorter specs below
   * (playwright.security-cases-detections-ui.config.ts). A new spec here runs
   * with this suite until it is listed in one of those.
   */
  testIgnore: [
    "Hunts.spec.ts",
    "CaseWork.spec.ts",
    "ConnectedSignals.spec.ts",
    "EntityRisk.spec.ts",
    "RuleExceptions.spec.ts",
    "Watchlists.spec.ts",
  ],
  fullyParallel: false,
  workers: 1,
  timeout: 120000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/security-operations-ui/test-results",
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
    baseURL: `http://127.0.0.1:${port}`,
    locale: "en-US",
    timezoneId: "UTC",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node SecurityOperations/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: !process.env["CI"],
  },
});
