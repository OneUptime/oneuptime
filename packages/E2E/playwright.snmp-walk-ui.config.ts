import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * A device's SNMP Walk page in a real browser, with no backend:
 * SnmpWalk/server.js bundles the actual SNMP Walk card with the app's
 * esbuild config, Tailwind and theme (issue #5184). What only a browser can
 * show is checked here: the results' aligned columns, the walk running and
 * landing without a reload, the row's portaled menu and the clipboard, the
 * rows stacking at a phone's width, and the page in the dark theme, in
 * Japanese and in German.
 */
const port: string = process.env["SNMP_WALK_FIXTURE_PORT"] || "4521";

export default defineConfig({
  testDir: "./SnmpWalk",
  testMatch: "SnmpWalk.spec.ts",
  timeout: 90000,
  expect: { timeout: 15000 },
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "../../output/playwright/snmp-walk-ui/test-results",
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
    command: "node SnmpWalk/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env["CI"],
    timeout: 300000,
  },
});
