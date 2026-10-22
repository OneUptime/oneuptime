import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * An on-call policy's acknowledgement timeout (issue #5123) - page again
 * when an acknowledged incident or alert is not resolved in time - on the
 * policy's Escalation Rules page, in real Chromium, with no backend:
 * AcknowledgementTimeout/Fixture/server.js bundles the production page with
 * the app's esbuild config, Tailwind, theme and font, over an in-memory
 * policy whose saves it records. What jsdom cannot show is checked here:
 * the setting folded away under More settings until somebody opens it, the
 * dialog's two answers and its minutes box, what a save sends, a 390px
 * phone, dark mode and German.
 */
const port: string =
  process.env["ACKNOWLEDGEMENT_TIMEOUT_FIXTURE_PORT"] || "4241";

export default defineConfig({
  testDir: "./AcknowledgementTimeout",
  testMatch: ["AcknowledgementTimeout.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/acknowledgement-timeout-ui/test-results",
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
    command: "node AcknowledgementTimeout/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
