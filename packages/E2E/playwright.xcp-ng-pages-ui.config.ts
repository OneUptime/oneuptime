import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * An XCP-ng pool's pages in real Chromium, with no backend:
 * XcpNgPages/Fixture/server.js bundles the production pool layout, side
 * menu, Overview, lists, the pages of a host, a VM and a storage
 * repository, the Topology, Recommendations and the setup guide with the
 * app's esbuild config, Tailwind, theme and font, over in-memory records
 * whose every read it records. What jsdom cannot show is checked here: what
 * needs attention first and its way to each part's page, the tiles, the
 * busiest VMs and hosts, control domains hidden until shown, a laptop's
 * and a phone's width, dark mode, German and Persian.
 */
const port: string = process.env["XCP_NG_PAGES_FIXTURE_PORT"] || "4672";

export default defineConfig({
  testDir: "./XcpNgPages",
  testMatch: ["XcpNgPages.spec.ts", "XcpNgAiAgent.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/xcp-ng-pages-ui/test-results",
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
    command: "node XcpNgPages/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
