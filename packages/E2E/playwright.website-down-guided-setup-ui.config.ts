import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * The guided website setup, looked at (#7056): "Know when my website or
 * API is down" walked step by step in real Chromium over the journeys'
 * fixture (Journeys/Fixture/server.js: the whole Dashboard from this
 * branch, a project made a minute ago, in memory), at 1280 and 390 pixels,
 * light and dark, in German and Persian: every step and the summary, a run
 * left and opened again, the test page nobody acknowledged ("I did not get
 * it"), a server that cannot send email, and a teammate's monitor for the
 * address. Each must fit the window; their pictures are written to
 * output/playwright/website-down-guided-setup-ui
 * (WebsiteDownGuidedSetup/README.md). The fixture runs on a port of its own,
 * so the journeys' suites may run beside it.
 */
const port: string =
  process.env["WEBSITE_DOWN_GUIDED_SETUP_FIXTURE_PORT"] || "4853";

export default defineConfig({
  testDir: "./WebsiteDownGuidedSetup",
  testMatch: ["WebsiteDownGuidedSetup.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 180000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir:
    "../../output/playwright/website-down-guided-setup-ui/test-results",
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
        "output/playwright/website-down-guided-setup-ui/fixture",
    },
    timeout: 300000,
    reuseExistingServer: false,
  },
});
