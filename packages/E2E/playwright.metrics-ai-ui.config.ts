import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * Metrics' AI tab - Insights, a finding's page with Fix with AI, Logs and
 * Settings - and its Insights tab's service cards (MetricsInsights.spec.ts)
 * in real Chromium, with no backend: MetricsAi/Fixture/server.js bundles
 * the production pages over a small store that answers their reads the way
 * the server does. What jsdom cannot show is checked here: the tab bar, the
 * side menu folded on a phone, rows of cards at every width, no sideways
 * scroll, and dark mode.
 */
const port: string = process.env["METRICS_AI_FIXTURE_PORT"] || "4463";

export default defineConfig({
  testDir: "./MetricsAi",
  testMatch: ["MetricsAi.spec.ts", "MetricsInsights.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/metrics-ai-ui/test-results",
  // A project's `use` wins over the top-level one, so the viewports go here.
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
      },
    },
    {
      name: "phone",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        hasTouch: true,
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
    command: "node MetricsAi/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
