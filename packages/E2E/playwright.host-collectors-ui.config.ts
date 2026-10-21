import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * Adding a host in one command and the collectors OneUptime manages, in real
 * Chromium with no backend: HostCollectors/Fixture/server.js bundles the
 * production Hosts list (Add Host), Collector Configs, a config's page and a
 * host's Collector page with the app's esbuild config, Tailwind, theme and
 * font, over in-memory records whose saves it records - a config's YAML
 * checked by the real HostCollectorConfigPolicy. What jsdom cannot show is
 * checked here: the command for each system with the project's key, the last
 * step seeing the host connect, a refused save keeping its dialog, Put back,
 * Change config's dropdown, a phone-width screen and dark mode.
 *
 * The fixture server's port. Another checkout's run on the default port is
 * reused outside CI, so a second run picks a port of its own:
 * HOST_COLLECTORS_FIXTURE_PORT=4871 CI=1 npm run test-host-collectors-ui.
 */
const port: string = process.env["HOST_COLLECTORS_FIXTURE_PORT"] || "4371";

export default defineConfig({
  testDir: "./HostCollectors",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 120000,
  expect: { timeout: 20000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/host-collectors-ui/test-results",
  projects: [
    {
      name: "chromium",
      // A project's `use` wins over the top-level one, so the viewport goes here.
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 1000 },
      },
    },
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    locale: "en-US",
    timezoneId: "UTC",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node HostCollectors/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: !process.env["CI"],
  },
});
