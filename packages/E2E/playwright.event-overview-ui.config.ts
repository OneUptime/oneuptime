import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * The fixture server's port. Another checkout's run on the default port is
 * reused outside CI, so a second run picks a port of its own:
 * EVENT_OVERVIEW_FIXTURE_PORT=4719 CI=1 npm run test-event-overview-ui.
 */
const port: string = process.env["EVENT_OVERVIEW_FIXTURE_PORT"] || "4222";

/*
 * App Test runs this suite in halves, one per Dashboard Offline UI group:
 * the group's matrix sets EVENT_OVERVIEW_SHARD to "1/2" or "2/2". The suite
 * is one spec file of independent tests - each opens its own page - so it
 * is split by test rather than by file (fullyParallel), each half one
 * worker as before. Unset, the whole suite runs, in file order, as it
 * always has.
 */
const shardMatch: RegExpExecArray | null = /^(\d+)\/(\d+)$/.exec(
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
