import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * Code - the repositories first, a repository's page where AI is asked, and
 * a task's conversation - in real Chromium, with no backend:
 * Code/Fixture/server.js bundles the production route group (its layouts,
 * side menus and breadcrumbs) over an in-memory Code server whose AI takes
 * each new turn through Queued, Running and Done as the page polls. What
 * jsdom cannot show is checked here: asking with context through the real
 * dialogs and pickers, a task's conversation filling in as the AI works,
 * replying and stopping, the old Tasks and Code Repositories addresses
 * forwarding, a phone (no sideways scroll, the composer within reach),
 * dark mode and German.
 */
const port: string = process.env["CODE_FIXTURE_PORT"] || "4366";

export default defineConfig({
  testDir: "./Code",
  testMatch: ["Code.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/code-ui/test-results",
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
    command: "node Code/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
