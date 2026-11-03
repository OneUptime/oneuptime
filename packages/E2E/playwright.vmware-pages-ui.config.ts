import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * A vCenter's pages in real Chromium, with no backend:
 * VMwarePages/Fixture/server.js bundles the production vCenter layout, side
 * menu, Overview, lists, the pages of an ESXi host, a VM, a datastore and a
 * cluster, and Recommendations with the app's esbuild config, Tailwind,
 * theme and font, over in-memory records whose every read it records. What
 * jsdom cannot show is checked here: what needs attention first and its way
 * to each part's page or list, each host's state (Not responding, off or in
 * standby) and its VMs Disconnected, the lists keeping to their cards, each
 * part's tiles, cards and alerts, "Turn on N alerts" opening Recommendations
 * with those alerts selected, a laptop's and a phone's width, dark mode,
 * German and Persian.
 */
const port: string = process.env["VMWARE_PAGES_FIXTURE_PORT"] || "4703";

export default defineConfig({
  testDir: "./VMwarePages",
  testMatch: ["VMwarePages.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/vmware-pages-ui/test-results",
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
    command: "node VMwarePages/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
