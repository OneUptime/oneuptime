import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * Packet captures in a real browser, with no backend: PacketCapture/server.js
 * bundles the actual captures list, Start form, readiness notice and a
 * device's Traffic card with the app's esbuild config, Tailwind and theme.
 * What only a browser can show is checked here: the dropdowns and the fold
 * a person works through, the file the browser saves on Download, the list
 * re-reading itself while a capture runs, and the page at phone width and
 * in the dark theme.
 */
const port: string = process.env["PACKET_CAPTURE_FIXTURE_PORT"] || "4263";

export default defineConfig({
  testDir: "./PacketCapture",
  testMatch: "PacketCapture.spec.ts",
  timeout: 90000,
  expect: { timeout: 15000 },
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "../../output/playwright/packet-capture-ui/test-results",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    timezoneId: "UTC",
    locale: "en-GB",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    acceptDownloads: true,
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
    command: "node PacketCapture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env["CI"],
    timeout: 300000,
  },
});
