import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * The on-call calendar feed cards in a real browser, with no backend:
 * CalendarFeed/server.js bundles the actual Dashboard pages - User Settings
 * > Calendar Feed, a schedule's "Subscribe to this schedule" cards and
 * On-Call Duty > Calendar Feeds - with the app's esbuild config, Tailwind,
 * theme and font. What only a browser can show is checked here: where the
 * subscribe options and the status sit at laptop, wide and phone widths,
 * that nothing scrolls sideways, the footer on the card's edges, the menu,
 * the confirmations and the link field with a real clipboard, the dark
 * theme's colours, and German. UpcomingShifts.spec.ts does the same for
 * the Upcoming shifts card on the same page, with the browser's clock fixed:
 * back-to-back turns as one row, times in the reader's zone across a change
 * of the clocks, the fold, every state, phones and other languages.
 */
const port: string = process.env["CALENDAR_FEED_FIXTURE_PORT"] || "4294";

export default defineConfig({
  testDir: "./CalendarFeed",
  testMatch: ["CalendarFeed.spec.ts", "UpcomingShifts.spec.ts"],
  timeout: 90000,
  expect: { timeout: 15000 },
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "../../output/playwright/calendar-feed-ui/test-results",
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
    command: "node CalendarFeed/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env["CI"],
    timeout: 300000,
  },
});
