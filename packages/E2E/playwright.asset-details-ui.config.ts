import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * An asset's details in a real browser, with no backend:
 * AssetDetails/server.js bundles the actual Asset Details card of an
 * Inventory item and Inventory card of a network device with the app's
 * esbuild config, Tailwind and theme (issue #5185). What only a browser can
 * show is checked here: where each detail came from and when, under its
 * value or said once below the details, a saved value's disagreement in
 * amber, every line wrapping inside the card at a phone's width, and the
 * cards in the dark theme, in Japanese and in German.
 */
const port: string = process.env["ASSET_DETAILS_FIXTURE_PORT"] || "4531";

export default defineConfig({
  testDir: "./AssetDetails",
  testMatch: "AssetDetails.spec.ts",
  timeout: 90000,
  expect: { timeout: 15000 },
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "../../output/playwright/asset-details-ui/test-results",
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
    command: "node AssetDetails/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env["CI"],
    timeout: 300000,
  },
});
