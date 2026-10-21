import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * The status timeline - a monitor's and an incident's - in real Chromium,
 * with no backend: StatusTimeline/Fixture/server.js bundles the production
 * pages with the app's esbuild config, Tailwind, theme and font, over
 * in-memory histories whose reads, creates and deletes it records. What
 * jsdom cannot show is checked here: the band laid out to scale, a blip of
 * seconds wide enough to see and click, dragging to zoom, the axis labels
 * not running into each other, a phone's width, the dark theme as drawn.
 *
 * The reader is in London, as the maintainer's screenshot was (BST), and
 * each test fixes the clock (page.clock) at that screenshot's "now".
 */
const port: string = process.env["STATUS_TIMELINE_FIXTURE_PORT"] || "4298";

export default defineConfig({
  testDir: "./StatusTimeline",
  testMatch: "StatusTimeline.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/status-timeline-ui/test-results",
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
    timezoneId: "Europe/London",
    locale: "en-US",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node StatusTimeline/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
