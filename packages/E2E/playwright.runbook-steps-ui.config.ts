import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * A runbook's Steps page and a run's execution page, in real Chromium, with
 * no backend: RunbookSteps/Fixture/server.js bundles the production pages
 * with the app's esbuild config, Tailwind, theme and font, over in-memory
 * records whose saves and step routes it records. What jsdom cannot show is
 * checked here: every step type's card and its More fields at a laptop's
 * and a phone's width, the approval switch and the header that says a step
 * needs approval, the method picker that shows an HTTP request's body, a
 * run that waits for approval before a step and goes on once approved,
 * dark mode and German.
 */
const port: string = process.env["RUNBOOK_STEPS_FIXTURE_PORT"] || "4389";

export default defineConfig({
  testDir: "./RunbookSteps",
  testMatch: ["RunbookSteps.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/runbook-steps-ui/test-results",
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
    command: "node RunbookSteps/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
