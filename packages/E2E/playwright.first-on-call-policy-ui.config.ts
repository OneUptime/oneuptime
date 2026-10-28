import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * A project's first on-call policy, as a newcomer creates it: On-Call Duty >
 * Policies and its Create On-Call Policy dialog, in real Chromium, with no
 * backend: FirstOnCallPolicy/Fixture/server.js bundles the production page
 * with the app's esbuild config, Tailwind and its reading-direction config,
 * the theme and the font, over an in-memory project whose creates and counts
 * it records. What jsdom cannot show is checked here: the switch "Page this
 * policy for every new incident and alert" in its row of the dialog, what
 * Create sends, when the switch is not offered, a 390px phone, dark mode,
 * German and Persian, right to left.
 */
const port: string = process.env["FIRST_ON_CALL_POLICY_FIXTURE_PORT"] || "4729";

export default defineConfig({
  testDir: "./FirstOnCallPolicy",
  testMatch: ["FirstOnCallPolicy.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/first-on-call-policy-ui/test-results",
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
    command: "node FirstOnCallPolicy/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
