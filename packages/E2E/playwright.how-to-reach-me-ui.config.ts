import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * How to Reach Me's ladder (#6820, #7453), in real Chromium, with no
 * backend: HowToReachMe/Fixture/server.js bundles the production page, its
 * ladder, the grid of cards behind it and the project's default ladder card
 * with the app's esbuild config, Tailwind, theme and font, over in-memory
 * methods and rules whose saves it records. What jsdom cannot show is
 * checked here: the steps in the order they page, the cards that differ
 * named under them, tagged in the grid and named again before a ladder
 * replaces them, the inline add's phone form and code, and both views at a
 * laptop's and a phone's width, light and dark, in German and in Persian.
 */
const port: string = process.env["HOW_TO_REACH_ME_FIXTURE_PORT"] || "4738";

export default defineConfig({
  testDir: "./HowToReachMe",
  testMatch: "HowToReachMe.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/how-to-reach-me-ui/test-results",
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
    command: "node HowToReachMe/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
