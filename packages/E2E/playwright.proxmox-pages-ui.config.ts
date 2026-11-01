import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * A Proxmox VE cluster's pages in real Chromium, with no backend:
 * ProxmoxPages/Fixture/server.js bundles the production cluster layout, side
 * menu, Overview, lists, the pages of a node, a guest and a storage,
 * Recommendations and the setup guide with the app's esbuild config,
 * Tailwind, theme and font, over in-memory records whose every read it
 * records. What jsdom cannot show is checked here: what needs attention
 * first and its way to each part's page, each part's tiles, cards and
 * alerts, "Turn on N alerts" opening Recommendations with those alerts
 * selected, a laptop's and a phone's width, dark mode, German and Persian.
 */
const port: string = process.env["PROXMOX_PAGES_FIXTURE_PORT"] || "4661";

export default defineConfig({
  testDir: "./ProxmoxPages",
  testMatch: ["ProxmoxPages.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/proxmox-pages-ui/test-results",
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
    command: "node ProxmoxPages/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
