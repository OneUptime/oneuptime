import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * Auto remediation rules - which new incidents (or alerts) OneUptime AI
 * fixes, and whether it asks first - on Incidents -> AI -> Settings and
 * Alerts -> AI -> Settings, in real Chromium, with no backend:
 * AutoRemediationRules/Fixture/server.js bundles the production pages with
 * the app's esbuild config, Tailwind, theme and font, over in-memory records
 * whose creates, updates and deletes it records. What jsdom cannot show is
 * checked here: the create dialog's Fix step with no "Fix With" choice, its
 * More fields fold opened by mouse, the runbooks OneUptime AI may run, the
 * Runner picker's choices, a rule saved before this change edited, a phone,
 * dark mode and German.
 */
const port: string =
  process.env["AUTO_REMEDIATION_RULES_FIXTURE_PORT"] || "4395";

export default defineConfig({
  testDir: "./AutoRemediationRules",
  /*
   * The investigation rules beside them on the same page (issue #5074): when
   * a rule investigates - right away, or only if still open after a wait.
   */
  testMatch: ["AutoRemediationRules.spec.ts", "InvestigationRules.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/auto-remediation-rules-ui/test-results",
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
    command: "node AutoRemediationRules/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
