import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * A resource's Overview drawn with ResourceOverview - a service's, a
 * database's and a queue's - in real Chromium, with no backend:
 * ResourceOverviews/Fixture/server.js bundles the production layouts, side
 * menus and Overviews with the app's esbuild config, Tailwind, theme and
 * font, over in-memory records whose every read it records. What jsdom
 * cannot show is checked here (#5298's UI review): the Details card's ID
 * line and its rows wrapping where they read, the labels card on a phone
 * only, the description under the name, and the hero's controls at the
 * row's end - at a phone's, a tablet's and a laptop's width, light and
 * dark, in German and right to left.
 */
const port: string = process.env["RESOURCE_OVERVIEWS_FIXTURE_PORT"] || "4643";

export default defineConfig({
  testDir: "./ResourceOverviews",
  testMatch: ["ResourceOverviews.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/resource-overviews-ui/test-results",
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
    command: "node ResourceOverviews/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
