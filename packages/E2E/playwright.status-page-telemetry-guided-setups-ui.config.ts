import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * The status page and telemetry guided setups, looked at (#7143): "Publish a
 * status page" and "Send logs, metrics and traces, then get alerted" walked
 * step by step in real Chromium over the journeys' fixture
 * (Journeys/Fixture/server.js: the whole Dashboard from this branch, a
 * project kept in memory), at 1280 and 390 pixels, light and dark, in German
 * and Persian, as a new project and as a busy one (?seed=busy): every step
 * and the summary, the project's status pages offered first (#7517), a busy
 * list searched, narrowed by a label and given a monitor group (#7147), the
 * ways in from Status Pages and Logs (#7142), the monitor the website setup
 * hands in, and a Project Viewer. Each must fit the window; their pictures
 * are written to output/playwright/status-page-telemetry-guided-setups-ui
 * (StatusPageTelemetryGuidedSetups/README.md). And a status page's
 * Resources screen, whose grids are measured at real widths, in English and
 * Arabic, light and dark (?seed=status-page-grid, #7239, #7430:
 * StatusPageResourcesGrid.spec.ts). The fixture runs on a port of its own,
 * so the journeys' suites may run beside it.
 */
const port: string =
  process.env["STATUS_PAGE_TELEMETRY_GUIDED_SETUPS_FIXTURE_PORT"] || "4866";

export default defineConfig({
  testDir: "./StatusPageTelemetryGuidedSetups",
  testMatch: [
    "StatusPageTelemetryGuidedSetups.spec.ts",
    "StatusPageResourcesGrid.spec.ts",
  ],
  fullyParallel: false,
  workers: 1,
  timeout: 180000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir:
    "../../output/playwright/status-page-telemetry-guided-setups-ui/test-results",
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
    env: {
      JOURNEYS_FIXTURE_PORT: port,
      // Built apart from the journeys' bundles, which may be building beside it.
      JOURNEYS_FIXTURE_OUTPUT:
        "output/playwright/status-page-telemetry-guided-setups-ui/fixture",
    },
    timeout: 300000,
    reuseExistingServer: false,
  },
});
