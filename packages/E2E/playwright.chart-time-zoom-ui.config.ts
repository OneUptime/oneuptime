import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * A local override only, for a machine whose cached Chromium is not the
 * revision this Playwright expects. CI never sets it.
 */
const executablePath: string | undefined =
  process.env["CHART_TIME_ZOOM_CHROMIUM_PATH"] || undefined;

export default defineConfig({
  testDir: "./ChartTimeZoom",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 120000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/chart-time-zoom-ui/test-results",
  projects: [
    {
      name: "chromium",
      /*
       * The viewport lives on the project: a project's `use` wins over the
       * top-level one, so devices["Desktop Chrome"] would otherwise reset it
       * to 1280x720.
       */
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
  ],
  use: {
    baseURL: "http://127.0.0.1:4233",
    locale: "en-US",
    timezoneId: "UTC",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node ChartTimeZoom/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: "http://127.0.0.1:4233",
    timeout: 300000,
    reuseExistingServer: !process.env["CI"],
  },
});
