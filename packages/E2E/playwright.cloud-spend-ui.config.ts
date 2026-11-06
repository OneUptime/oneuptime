import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * Cloud's Overview and its Spend pages in real Chromium, with no backend:
 * CloudSpend/Fixture/server.js bundles the production Cloud route group
 * (its layout, side menus, trail, Overview, Costs, Savings, Budgets and an
 * account's Costs) with the app's esbuild config, Tailwind, theme and font,
 * over five accounts whose costs are made up day by day and worked out as
 * the server works them out. What jsdom cannot show is checked here: the
 * pages agreeing with each other, the daily chart's bars, the breakdown by
 * service, Region, account and resource, a budget made and turned off, the
 * reads that fail and Refresh, and every page at a laptop's and a phone's
 * width, dark, German and Persian.
 *
 * CLOUD_SPEND_FIXTURE_PORT moves the fixture off 4741, so a second checkout
 * can run the suite beside this one.
 */
const port: string = process.env["CLOUD_SPEND_FIXTURE_PORT"] || "4741";

export default defineConfig({
  testDir: "./CloudSpend",
  testMatch: ["CloudSpend.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/cloud-spend-ui/test-results",
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
    command: "node CloudSpend/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: !process.env["CI"],
    env: { CLOUD_SPEND_FIXTURE_PORT: port },
  },
});
