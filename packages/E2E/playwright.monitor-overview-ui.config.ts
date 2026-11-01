import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * The fixture server's port. Another checkout's run on the default port is
 * reused outside CI, so a second run picks a port of its own:
 * MONITOR_OVERVIEW_FIXTURE_PORT=4720 CI=1 npm run test-monitor-overview-ui.
 */
const port: string = process.env["MONITOR_OVERVIEW_FIXTURE_PORT"] || "4223";

/*
 * App Test runs this suite in halves, one per Dashboard Offline UI group:
 * the group's matrix sets MONITOR_OVERVIEW_SHARD to "1/2" or "2/2". At 248
 * tests it took 13.8 minutes of its group's 28 on 14.0.100's first gate run
 * and 18.6 on the second, whose runner was about a third slower, and the
 * group ran out of time. Its tests are independent - each opens its page
 * in a beforeEach - so it is split by test rather than by file
 * (fullyParallel): by file, MonitorOverview.spec.ts and CreateMonitor.spec.ts
 * (125 of the 211 written) would weigh one half down. Each half is one worker
 * as before. Unset, the whole suite runs, in file order, as it always has.
 */
const SHARD_PATTERN: RegExp = /^(\d+)\/(\d+)$/;
const shardMatch: RegExpExecArray | null = SHARD_PATTERN.exec(
  process.env["MONITOR_OVERVIEW_SHARD"] || "",
);
const shard: { current: number; total: number } | null = shardMatch
  ? { current: Number(shardMatch[1]), total: Number(shardMatch[2]) }
  : null;

export default defineConfig({
  testDir: "./MonitorOverview",
  testMatch: "*.spec.ts",
  shard: shard,
  // By test when halved, as Event Overview and Model Tables are.
  fullyParallel: shard !== null,
  workers: 1,
  timeout: 120000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/monitor-overview-ui/test-results",
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
    command: "node MonitorOverview/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: !process.env["CI"],
  },
});
