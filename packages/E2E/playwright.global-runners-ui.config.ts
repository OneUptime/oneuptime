import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * Global Runners - the Runners OneUptime runs for every project - on the
 * pages that show them, in real Chromium, with no backend:
 * GlobalRunners/Fixture/server.js bundles the production Runbooks -> Runners
 * page, a runbook's Steps page and the Secrets page with the app's esbuild
 * config, Tailwind, theme and font, over in-memory records whose saves it
 * records. What jsdom cannot show is checked here: the cards in the order a
 * person reads them, the Runner dropdown opened and picked by mouse and by
 * keyboard, the switch's confirmation, a phone-width screen, dark mode and
 * German.
 */
const port: string = process.env["GLOBAL_RUNNERS_FIXTURE_PORT"] || "4361";

export default defineConfig({
  testDir: "./GlobalRunners",
  testMatch: ["GlobalRunners.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/global-runners-ui/test-results",
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
    command: "node GlobalRunners/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
