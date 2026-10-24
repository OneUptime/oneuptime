import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * Network > Traffic with its Meraki side (issue #5140) in a real browser,
 * with no backend: MerakiTraffic/Fixture/server.js bundles the actual
 * Network layout and Traffic page with the app's esbuild config, Tailwind,
 * theme and font. What only a browser can show is checked here: Connect
 * Meraki from the page with no traffic, the first read filling it in by
 * itself, the organization's traffic, narrowing to a network, the Flows |
 * Meraki switch, a refused or revoked key and a large organization read in
 * part - at a laptop's and a phone's width, in the dark theme and in German.
 *
 * The fixture server's port. Another checkout's run on the default port is
 * reused outside CI, so a second run picks a port of its own:
 * MERAKI_TRAFFIC_FIXTURE_PORT=4614 CI=1 npm run test-meraki-traffic-ui.
 */
const port: string = process.env["MERAKI_TRAFFIC_FIXTURE_PORT"] || "4514";

export default defineConfig({
  testDir: "./MerakiTraffic",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 120000,
  expect: { timeout: 20000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/meraki-traffic-ui/test-results",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    locale: "en-GB",
    timezoneId: "UTC",
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
      name: "phone",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      },
    },
  ],
  webServer: {
    command: "node MerakiTraffic/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: !process.env["CI"],
  },
});
