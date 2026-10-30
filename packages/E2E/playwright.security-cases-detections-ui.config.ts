import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * The Security Operations fixture's five shorter specs - a case's tasks,
 * evidence and response targets (CaseWork.spec.ts), a case's Connected
 * Signals, entity risk, detection rule exceptions and Run on Past Events,
 * and watchlists - on its own server and data, as a suite of its own. The
 * long one, SecurityOperations.spec.ts, runs as test-security-operations-ui,
 * which leaves these out: the two run in different App Test groups, so the
 * pair no longer adds up to more than one group's run step can hold.
 */
const port: string = process.env["SECURITY_OPERATIONS_FIXTURE_PORT"] || "4234";

export default defineConfig({
  testDir: "./SecurityOperations",
  testMatch: [
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
  outputDir:
    "../../output/playwright/security-cases-detections-ui/test-results",
  projects: [
    {
      name: "chromium",
      // A project's `use` wins over the top-level one, so the viewport goes here.
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
