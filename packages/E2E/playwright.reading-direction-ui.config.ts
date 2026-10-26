import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * The reading direction - a Persian page laid out right to left, every
 * other language left to right - in real Chromium, with no backend:
 * ReadingDirection/Fixture/server.js bundles the production components with
 * the app's esbuild config and draws them with Tailwind's runtime and the
 * reading-direction config every index.ejs loads after it. What jsdom
 * cannot show is checked here: where a margin, a knob, a dot, a stuck
 * column, a chevron and a dialog's words actually land, left to right and
 * right to left, light and dark.
 */
const port: string = process.env["READING_DIRECTION_FIXTURE_PORT"] || "4583";

export default defineConfig({
  testDir: "./ReadingDirection",
  testMatch: "ReadingDirection.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/reading-direction/test-results",
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
    command: "node ReadingDirection/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
