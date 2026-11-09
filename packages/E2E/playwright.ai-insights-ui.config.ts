import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * AI Insights (Incidents and Alerts → AI → Insights) in real Chromium, with
 * no backend: AiInsights/Fixture/server.js bundles the production Incidents
 * and Alerts route groups (their layouts, side menus, trails and AI
 * Insights pages) with the app's esbuild config, Tailwind, theme and font,
 * over a month of incidents and alerts whose insights the server's own
 * builder works out. What jsdom cannot show is checked here: the Fixes
 * section's bar, legend, verification line and where fixes were approved
 * at a laptop's and a phone's width, light and dark, in German and in
 * Persian (right to left, its counts in Persian digits), a month with
 * nothing investigated, a reader who may not read fixes, Enable AI off, and
 * a read that fails.
 *
 * AI_INSIGHTS_FIXTURE_PORT moves the fixture off 4757, so a second checkout
 * can run the suite beside this one.
 */
const port: string = process.env["AI_INSIGHTS_FIXTURE_PORT"] || "4757";

export default defineConfig({
  testDir: "./AiInsights",
  testMatch: ["AiInsights.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/ai-insights-ui/test-results",
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
    command: "node AiInsights/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: !process.env["CI"],
    env: { AI_INSIGHTS_FIXTURE_PORT: port },
  },
});
