import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * The journey budgets (#6831): each core job a newcomer comes to do - a
 * website monitor, being told, being paged by phone, a status page, first
 * telemetry, an invited member's first hour, a self-hosted server's email -
 * done in real Chromium the way a person does it, with only what is on
 * screen, and counted: screens, dialogs, clicks, fields typed, products
 * crossed, keystrokes, defaults kept, choices offered and words on screen.
 * Journeys/Fixture/server.js serves the whole Dashboard and the Admin
 * Dashboard from this branch over a project made a minute ago, in memory:
 * no backend, no timing, no network. A run fails when a job's structural
 * counts move from Tests/Ops/JourneyBudgets.json, and writes the table of
 * every journey to output/playwright/journeys-ui/ (Journeys/README.md).
 */
const port: string = process.env["JOURNEYS_FIXTURE_PORT"] || "4831";

export default defineConfig({
  testDir: "./Journeys",
  testMatch: [
    "Journeys.spec.ts",
    "JourneyCounter.spec.ts",
    /*
     * The website-down (#7059) and status page (#7252) setups' runs, kept
     * and lost: not counted.
     */
    "GuidedSetupRun.spec.ts",
  ],
  fullyParallel: false,
  workers: 1,
  timeout: 180000,
  expect: { timeout: 15000 },
  retries: 0,
  // The second writes the table of every journey once all have run.
  reporter: [["list"], ["./Journeys/JourneyReport.ts"]],
  outputDir: "../../output/playwright/journeys-ui/test-results",
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
    // A step that cannot be done fails in seconds, saying which step it was.
    actionTimeout: 15000,
    baseURL: `http://127.0.0.1:${port}`,
    timezoneId: "Europe/London",
    locale: "en-GB",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node Journeys/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: !process.env["CI"],
  },
});
