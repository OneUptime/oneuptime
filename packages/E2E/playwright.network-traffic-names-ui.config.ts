import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * Names instead of bare addresses on Network > Traffic (issue #5340) in a
 * real browser, with no backend: NetworkTrafficNames/Fixture/server.js
 * bundles the actual Network layout, Traffic page and Address Names page
 * with the app's esbuild config, Tailwind, theme and font. What only a
 * browser can show is checked here: names over addresses in the top lists
 * and both views of the conversations, long names cut short with the whole
 * name under the pointer, the address card a page narrowed to one address
 * opens with, "find" by a name, naming an address and changing a name in
 * its one place, Network > Settings > Address Names - at a laptop's and a phone's width,
 * in the dark theme, in German and in Persian (addresses left to right).
 *
 * The fixture server's port. Another checkout's run on the default port is
 * reused outside CI, so a second run picks a port of its own:
 * NETWORK_TRAFFIC_NAMES_FIXTURE_PORT=4647 CI=1 npm run test-network-traffic-names-ui.
 */
const port: string =
  process.env["NETWORK_TRAFFIC_NAMES_FIXTURE_PORT"] || "4547";

export default defineConfig({
  testDir: "./NetworkTrafficNames",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 120000,
  expect: { timeout: 20000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/network-traffic-names-ui/test-results",
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
    command: "node NetworkTrafficNames/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: !process.env["CI"],
  },
});
