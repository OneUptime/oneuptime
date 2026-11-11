import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * Sending a test page (#6811) - "Test your pages" in User Settings and
 * "Test this policy" on a policy's escalation rules - in real Chromium,
 * with no backend: TestPage/Fixture/server.js bundles the production card,
 * button, dialog and result with the app's esbuild config, Tailwind, theme
 * and font, over an in-memory project whose requests it records. What
 * jsdom cannot show is checked here: the preview before anything is sent,
 * what a send asks for, each message of the result as it goes out with
 * where to fix one, a 390px phone, dark mode and German.
 */
const port: string =
  process.env["TEST_PAGE_FIXTURE_PORT"] || "4293";

export default defineConfig({
  testDir: "./TestPage",
  testMatch: ["TestPage.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/test-page-ui/test-results",
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
    command: "node TestPage/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
