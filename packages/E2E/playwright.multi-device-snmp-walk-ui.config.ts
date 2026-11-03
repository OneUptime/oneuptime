import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * The Network's SNMP Walk page - many devices walked at once - in a real
 * browser, with no backend: MultiDeviceSnmpWalk/server.js bundles the actual
 * card with the app's esbuild config, Tailwind and theme (issue #5548). What
 * only a browser can show is checked here: each device's answer landing
 * without a reload, the OIDs compared in aligned columns and opened on each
 * device's own value, Collect writing every device that answers, the CSV
 * download, the walk read back after a reload, and the page at a phone's
 * width, in the dark theme and in German.
 */
const port: string = process.env["MULTI_DEVICE_SNMP_WALK_FIXTURE_PORT"] || "4522";

export default defineConfig({
  testDir: "./MultiDeviceSnmpWalk",
  testMatch: "MultiDeviceSnmpWalk.spec.ts",
  timeout: 90000,
  expect: { timeout: 15000 },
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "../../output/playwright/multi-device-snmp-walk-ui/test-results",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    timezoneId: "UTC",
    locale: "en-GB",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
      },
    },
  ],
  webServer: {
    command: "node MultiDeviceSnmpWalk/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env["CI"],
    timeout: 300000,
  },
});
