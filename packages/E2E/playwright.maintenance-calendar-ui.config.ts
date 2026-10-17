import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * Scheduled maintenance calendars in a real browser, with no backend:
 * MaintenanceCalendar/server.js bundles the actual pages with the apps'
 * esbuild config, Tailwind, theme and font, and answers their API calls
 * from an in-page store.
 *
 *   MaintenanceCalendar.spec.ts  the Dashboard's Scheduled Maintenance >
 *                                Events: List | Calendar, the month and week
 *                                grids, Schedule maintenance on a day, and
 *                                the Subscribe to calendar dialog;
 *   StatusPageCalendar.spec.ts   a status page's Scheduled Events: Subscribe
 *                                to calendar, and Add to calendar on an
 *                                event's page.
 *
 * The browser's clock is fixed at 2026-10-15 10:20 UTC (a Thursday) in
 * every test, so the grids open on October 2026 with the 15th as today.
 */
const port: string = process.env["MAINTENANCE_CALENDAR_FIXTURE_PORT"] || "4341";

export default defineConfig({
  testDir: "./MaintenanceCalendar",
  testMatch: ["MaintenanceCalendar.spec.ts", "StatusPageCalendar.spec.ts"],
  timeout: 90000,
  expect: { timeout: 15000 },
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "../../output/playwright/maintenance-calendar-ui/test-results",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    timezoneId: "UTC",
    locale: "en-GB",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
      },
    },
  ],
  webServer: {
    command: "node MaintenanceCalendar/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env["CI"],
    timeout: 300000,
  },
});
