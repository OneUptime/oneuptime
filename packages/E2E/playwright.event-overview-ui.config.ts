import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * The fixture server's port. Another checkout's run on the default port is
 * reused outside CI, so a second run picks a port of its own:
 * EVENT_OVERVIEW_FIXTURE_PORT=4719 CI=1 npm run test-event-overview-ui.
 */
const port: string = process.env["EVENT_OVERVIEW_FIXTURE_PORT"] || "4222";

/*
 * App Test runs this suite in thirds, one per Dashboard Offline UI group:
 * the group's matrix sets EVENT_OVERVIEW_SHARD to "1/3", "2/3" or "3/3"
 * (halves until 2026-11-17: a group runs two suites at a time, each about a
 * quarter slower beside the other, and a half took 20 to 23 minutes alone).
 * The suite is one spec file of independent tests - each opens its own
 * page - so it is split by test rather than by file (fullyParallel), each
 * third one worker as before. Unset, the whole suite runs, in file order,
 * as it always has.
 */
const SHARD_PATTERN: RegExp = /^(\d+)\/(\d+)$/;
const shardMatch: RegExpExecArray | null = SHARD_PATTERN.exec(
  process.env["EVENT_OVERVIEW_SHARD"] || "",
);
const shard: { current: number; total: number } | null = shardMatch
  ? { current: Number(shardMatch[1]), total: Number(shardMatch[2]) }
  : null;

export default defineConfig({
  testDir: "./EventOverview",
  testMatch: "*.spec.ts",
  fullyParallel: shard !== null,
  shard: shard,
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
    baseURL: `http://127.0.0.1:${port}`,
    locale: "en-US",
    timezoneId: "UTC",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node EventOverview/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: !process.env["CI"],
  },
});
