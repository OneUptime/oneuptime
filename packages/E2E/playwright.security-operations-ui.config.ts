import { defineConfig, devices } from "@playwright/test";
import path from "path";

// The fixture server reads the same variable, so two runs can sit side by side.
const port: string = process.env["SECURITY_OPERATIONS_FIXTURE_PORT"] || "4234";

/*
 * App Test runs this suite in halves, one per Dashboard Offline UI group: the
 * group's matrix sets SECURITY_OPERATIONS_SHARD to "1/2" or "2/2". Alone it
 * took 19 to 22 minutes on App Test's runners, and a group runs two suites at
 * a time, each about a quarter slower beside the other: whole, it would pass a
 * group's 22 minutes by itself (2026-11-17). Its tests are independent - each
 * opens its own page, whose API the bundled fixture answers in the page - so
 * it is split by test rather than by file (fullyParallel), each half one
 * worker as before. Unset, the whole suite runs, in file order, as it always
 * has.
 */
const SHARD_PATTERN: RegExp = /^(\d+)\/(\d+)$/;
const shardMatch: RegExpExecArray | null = SHARD_PATTERN.exec(
  process.env["SECURITY_OPERATIONS_SHARD"] || "",
);
const shard: { current: number; total: number } | null = shardMatch
  ? { current: Number(shardMatch[1]), total: Number(shardMatch[2]) }
  : null;

export default defineConfig({
  testDir: "./SecurityOperations",
  testMatch: "*.spec.ts",
  /*
   * Hunts run as a suite of their own (playwright.security-hunts-ui.config.ts),
   * and so do the six shorter specs below
   * (playwright.security-cases-detections-ui.config.ts). A new spec here runs
   * with this suite until it is listed in one of those.
   */
  testIgnore: [
    "Hunts.spec.ts",
    "CaseWork.spec.ts",
    "CaseSetup.spec.ts",
    "ConnectedSignals.spec.ts",
    "EntityRisk.spec.ts",
    "RuleExceptions.spec.ts",
    "Watchlists.spec.ts",
  ],
  fullyParallel: shard !== null,
  shard: shard,
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
