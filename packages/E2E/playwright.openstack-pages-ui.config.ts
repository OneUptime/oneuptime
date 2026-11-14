import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * An OpenStack cloud's pages in real Chromium, with no backend:
 * OpenStackPages/Fixture/server.js bundles the production cloud layout, side menu and
 * pages with the app's esbuild config, Tailwind, theme and font, over rows that are
 * either made up in the shape real clouds report or what real clouds' exporters
 * answered, read through the real snapshot scan. Every read is recorded. What jsdom
 * cannot show is checked here: what needs attention first and its way to each part's
 * page, the region kept in the address, a laptop's, a tablet's and a phone's width,
 * dark mode, German, Persian and Arabic.
 */
const port: string = process.env["OPENSTACK_PAGES_FIXTURE_PORT"] || "4662";

/*
 * App Test runs this suite in thirds, one per Dashboard Offline UI group: the group's matrix
 * sets OPENSTACK_PAGES_SHARD to "1/3", "2/3" or "3/3". It grew past a group's 22 minutes as the
 * product's pages joined it, and past two groups' when 586 tests took about 25 minutes a half
 * (2026-11-10). Its tests are independent, each opening its own page, so it is split by test
 * rather than by file (fullyParallel). Each third is one worker as before. Unset, the whole
 * suite runs, in file order, as it always has.
 */
const SHARD_PATTERN: RegExp = /^(\d+)\/(\d+)$/;
const shardMatch: RegExpExecArray | null = SHARD_PATTERN.exec(
  process.env["OPENSTACK_PAGES_SHARD"] || "",
);
const shard: { current: number; total: number } | null = shardMatch
  ? { current: Number(shardMatch[1]), total: Number(shardMatch[2]) }
  : null;

export default defineConfig({
  testDir: "./OpenStackPages",
  testMatch: ["*.spec.ts"],
  shard: shard,
  fullyParallel: shard !== null,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/openstack-pages-ui/test-results",
  // A project's `use` wins over the top-level one, so the viewport goes here.
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
      },
    },
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    timezoneId: "Europe/London",
    locale: "en-GB",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node OpenStackPages/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
