import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * Postmortems across every incident - Incidents -> Postmortems, an
 * incident's Postmortem page and Incidents -> Settings -> Postmortem
 * Statuses - in real Chromium, with no backend: Postmortems/Fixture/server.js
 * bundles the production pages with the app's esbuild config, Tailwind,
 * theme and font, over in-memory records whose moves it records. What jsdom
 * cannot show is checked here: the tiles filtering the list they sit on, a
 * row's status moved from its pill and the counts following, the bulk move,
 * the card's buttons by whether anything is written, the list beside the
 * side menu at a laptop's width and on a phone, dark mode and German.
 */
const port: string = process.env["POSTMORTEMS_FIXTURE_PORT"] || "4447";

export default defineConfig({
  testDir: "./Postmortems",
  testMatch: ["Postmortems.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/postmortems-ui/test-results",
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
    command: "node Postmortems/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
