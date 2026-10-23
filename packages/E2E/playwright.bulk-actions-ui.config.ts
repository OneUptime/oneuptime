import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * The shared bulk actions the table audit built, in real Chromium, with no
 * backend: BulkActions/Fixture/server.js bundles the production pages - the
 * Workflows and Monitors lists, a status page's Email Subscribers and the
 * Admin Dashboard's Enterprise Licenses - with the app's esbuild config,
 * Tailwind, theme and font, over in-memory records whose updates and
 * deletes it records (and, on request, refuses). What jsdom cannot show is
 * checked here: the menus opening where they do, the dialogs fitting a
 * phone, the tooltip on a locked action, dark mode.
 *
 * The Enterprise Licenses specs need ee/ and are skipped without it.
 */
const port: string = process.env["BULK_ACTIONS_FIXTURE_PORT"] || "4458";

export default defineConfig({
  testDir: "./BulkActions",
  testMatch: ["BulkActions.spec.ts", "EnterpriseLicenses.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/bulk-actions-ui/test-results",
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
    timezoneId: "UTC",
    locale: "en-US",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node BulkActions/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
