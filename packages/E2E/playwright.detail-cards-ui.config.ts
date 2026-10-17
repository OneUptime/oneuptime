import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * Detail cards (CardModelDetail -> ModelDetail -> Detail) in real Chromium,
 * with no backend: DetailCards/Fixture/server.js bundles real Dashboard
 * pages and a gallery of every kind of field with the app's esbuild config,
 * Tailwind, theme and font. What jsdom cannot show is checked here: the
 * fields of a row sharing their top in every column count and at every
 * width, the rules between rows running the whole width, long values
 * wrapping inside a phone's card, the dark theme as drawn.
 */
const port: string = process.env["DETAIL_CARDS_FIXTURE_PORT"] || "4316";

export default defineConfig({
  testDir: "./DetailCards",
  testMatch: "DetailCards.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/detail-cards-ui/test-results",
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
    locale: "en-US",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node DetailCards/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}/dashboard/10000000-0000-4000-8000-000000000001/user-settings/profile`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
