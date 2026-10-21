import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * Runbook variables and the steps that take a script, in real Chromium,
 * with no backend: RunbookVariables/Fixture/server.js bundles the production
 * Global Variables page, a runbook's own Variables page, its Steps page and
 * AI Access with the app's esbuild config, Tailwind, theme and font, over
 * in-memory records whose saves it records. What jsdom cannot show is
 * checked here: the two-step create dialog and Replace Value, the SSH and
 * kubectl steps with their folded More fields, the secret pickers opened by
 * mouse and by keyboard, a phone-width screen, dark mode and German.
 */
const port: string = process.env["RUNBOOK_VARIABLES_FIXTURE_PORT"] || "4383";

export default defineConfig({
  testDir: "./RunbookVariables",
  testMatch: ["RunbookVariables.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/runbook-variables-ui/test-results",
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
    permissions: ["clipboard-read", "clipboard-write"],
  },
  webServer: {
    command: "node RunbookVariables/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
