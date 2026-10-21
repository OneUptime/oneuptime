import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * An ESXi host's page inside its vCenter, in real Chromium, with no
 * backend: VMwareHostPage/Fixture/server.js bundles the production vCenter
 * layout, side menu, host page and Recommendations page with the app's
 * esbuild config, Tailwind, theme and font, over in-memory records whose
 * every read it records. What jsdom cannot show is checked here: the
 * Overview's tiles, charts, cards and tables at a laptop's and a phone's
 * width, the host's states, its Virtual Machines, Metrics and Logs tabs,
 * "Turn on N alerts" opening Recommendations with those alerts selected,
 * dark mode and German.
 */
const port: string = process.env["VMWARE_HOST_PAGE_FIXTURE_PORT"] || "4413";

export default defineConfig({
  testDir: "./VMwareHostPage",
  testMatch: ["VMwareHostPage.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/vmware-host-page-ui/test-results",
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
    command: "node VMwareHostPage/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
