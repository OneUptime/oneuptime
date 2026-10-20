import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * Create a dashboard (Dashboards > Create Dashboard) in a real browser,
 * beside the Create a workflow dialog it was made to work like: both are
 * drawn with the shared template picker. Offline: the fixture bundles the
 * real dialogs with the app's esbuild config, Tailwind, theme and font, and
 * needs no server - what they would create is read from the page. jsdom has
 * no layout, no real focus and no theme, so these live here: the keyboard,
 * the layout at a laptop's width and a phone's (390px), the dark theme,
 * German, the two dialogs measured side by side, and every template
 * creating the dashboard it names. Screenshots of both dialogs, light and
 * dark, at both widths, land in output/playwright/dashboard-templates-ui/.
 *
 * DASHBOARD_TEMPLATES_FIXTURE_PORT moves the fixture off 4397, so a second
 * checkout on the same machine can run the suite at the same time.
 */
const port: number = Number(
  process.env["DASHBOARD_TEMPLATES_FIXTURE_PORT"] || 4397,
);

export default defineConfig({
  testDir: "./DashboardTemplates",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: "list",
  outputDir: "../../output/playwright/dashboard-templates-ui/test-results",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    timezoneId: "UTC",
    locale: "en-GB",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
      },
    },
    {
      // A phone's width, in Chromium: the browser every group installs.
      name: "phone",
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 390, height: 844 },
      },
    },
  ],
  webServer: {
    command: "node DashboardTemplates/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    env: { DASHBOARD_TEMPLATES_FIXTURE_PORT: String(port) },
    timeout: 300000,
    reuseExistingServer: false,
  },
});
