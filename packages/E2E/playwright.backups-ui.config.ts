import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * Admin Dashboard > Settings > Backups (the Enterprise Edition's backups of
 * PostgreSQL and ClickHouse) in real Chromium, with no backend:
 * Backups/Fixture/server.js bundles the production page, through the Admin
 * Dashboard's Enterprise plugin, with the app's esbuild config, Tailwind,
 * theme and font, over in-memory settings and runs whose writes it records.
 * What jsdom cannot show is checked here: the first run, setting backups
 * up and testing the destination, a backup running and one failed, a
 * restore running and its confirmation, at a laptop's and a phone's width,
 * light and dark - and the Community Edition's Settings without the page.
 */
const port: string = process.env["BACKUPS_FIXTURE_PORT"] || "4591";

export default defineConfig({
  testDir: "./Backups",
  testMatch: ["Backups.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/backups-ui/test-results",
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
    command: "node Backups/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}/edition.json`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
