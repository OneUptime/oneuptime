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
 * dark mode, German and Persian.
 */
const port: string = process.env["OPENSTACK_PAGES_FIXTURE_PORT"] || "4662";

export default defineConfig({
  testDir: "./OpenStackPages",
  testMatch: ["*.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  /*
   * Its own folder when set, for the same reason as the fixture's port and bundle: a run
   * empties this when it starts, under the feet of any other run using it.
   */
  outputDir:
    process.env["OPENSTACK_PAGES_RESULTS"] ||
    "../../output/playwright/openstack-pages-ui/test-results",
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
