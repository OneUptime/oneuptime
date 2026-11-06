import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * A cloud account's and a cloud resource's recommended monitors, and the
 * scheduled maintenance that holds a cloud resource, in real Chromium with
 * no backend: CloudRecommendations/Fixture/server.js bundles the production
 * Cloud account and cloud resource layouts with their Recommendations and
 * Scheduled Maintenance pages, with the app's esbuild config, Tailwind,
 * theme and font, over in-memory records whose every read and every monitor
 * made it records. What jsdom cannot show is checked here: the grouped list
 * laid out by its own width, the side menu's count after a run, the create
 * panel and its progress, and the pages at a laptop's and a phone's width,
 * dark, German and Persian.
 */
const port: string =
  process.env["CLOUD_RECOMMENDATIONS_FIXTURE_PORT"] || "4749";

export default defineConfig({
  testDir: "./CloudRecommendations",
  testMatch: ["CloudRecommendations.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/cloud-recommendations-ui/test-results",
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
    command: "node CloudRecommendations/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
