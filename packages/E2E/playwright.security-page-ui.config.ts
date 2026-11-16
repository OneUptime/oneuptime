import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * User Profile > Security (#8796) in real Chromium, with no backend:
 * SecurityPage/Fixture/server.js bundles the Dashboard's Two-factor
 * authentication and Passkeys pages with the app's esbuild config and draws
 * them with the production Tailwind, reading-direction config, Theme.css and
 * font, in English, German, Arabic and Persian.
 */
const port: string = process.env["SECURITY_PAGE_FIXTURE_PORT"] || "4493";

export default defineConfig({
  testDir: "./SecurityPage",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/security-page-ui/test-results",
  // A project's `use` wins over the top-level one, so the viewport goes here.
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    timezoneId: "UTC",
    locale: "en-US",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node SecurityPage/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
