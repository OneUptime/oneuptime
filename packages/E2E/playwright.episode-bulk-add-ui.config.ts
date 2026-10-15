import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * Adding several alerts or incidents to an episode at once - the Alerts and
 * Incidents lists' Bulk Actions "Add to Existing Episode" and "Add to New
 * Episode", and an episode's own "Add Alerts" / "Add Incidents" dialog - in
 * real Chromium, with no backend: EpisodeBulkAdd/Fixture/server.js bundles
 * the production pages with the app's esbuild config, Tailwind, theme and
 * font, over in-memory alerts, incidents and episodes whose adds it answers
 * as the server does (and, on request, refuses). What jsdom cannot show is
 * checked here: the bulk menu, the dialogs fitting a phone, the result's
 * link, dark mode.
 */
const port: string = process.env["EPISODE_BULK_ADD_FIXTURE_PORT"] || "4297";

export default defineConfig({
  testDir: "./EpisodeBulkAdd",
  testMatch: "EpisodeBulkAdd.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/episode-bulk-add-ui/test-results",
  // A project's `use` wins over the top-level one, so the viewport goes here.
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
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
    command: "node EpisodeBulkAdd/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
