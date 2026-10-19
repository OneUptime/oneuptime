import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * A runbook's Triggers page - its schedule and its webhook - and how a run
 * says what started it, in real Chromium, with no backend:
 * RunbookTriggers/Fixture/server.js bundles the production pages with the
 * app's esbuild config, Tailwind, theme and font, over an in-memory runbook
 * whose saves, key reads and resets and webhook calls it records. What jsdom
 * cannot show is checked here: the schedule dialog's menus and day buttons
 * driven by mouse and keyboard, the URL masked and copied to the clipboard,
 * a phone-width screen, dark mode, German. RunbookSideMenu.spec.ts puts the
 * pages inside the runbook's real view layout (?menu=1) and checks its side
 * menu: Executions folded under Logs and Triggers under Settings, opened by a
 * click, the keyboard or a page inside them.
 */
const port: string = process.env["RUNBOOK_TRIGGERS_FIXTURE_PORT"] || "4327";

export default defineConfig({
  testDir: "./RunbookTriggers",
  testMatch: ["RunbookTriggers.spec.ts", "RunbookSideMenu.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/runbook-triggers-ui/test-results",
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
    command: "node RunbookTriggers/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
