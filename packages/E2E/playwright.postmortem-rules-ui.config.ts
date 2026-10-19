import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * Postmortem rules - which resolved incidents OneUptime AI drafts a
 * postmortem for, and the templates each draft follows - on Incidents -> AI
 * -> Settings, in real Chromium, with no backend:
 * PostmortemRules/Fixture/server.js bundles the production page with the
 * app's esbuild config, Tailwind, theme and font, over in-memory records
 * whose creates, updates and deletes it records. What jsdom cannot show is
 * checked here: the More settings fold opened by mouse, the create dialog's
 * Match and Draft steps with the template picker, a rule dragged by
 * keyboard, a phone-width screen, dark mode and German.
 */
const port: string = process.env["POSTMORTEM_RULES_FIXTURE_PORT"] || "4373";

export default defineConfig({
  testDir: "./PostmortemRules",
  testMatch: ["PostmortemRules.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/postmortem-rules-ui/test-results",
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
    command: "node PostmortemRules/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
