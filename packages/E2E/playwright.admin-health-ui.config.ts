import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * Admin > OneUptime Health in real Chromium, with no backend (#7048):
 * AdminHealth/Fixture/server.js bundles the Admin Dashboard's Health landing
 * page with the app's esbuild config, Tailwind, theme and font, over the
 * server's answers kept in the page. What jsdom cannot show is checked here:
 * "What needs attention" as it is drawn - everything right, things to fix
 * and worth a look with their links, a read that failed with the reference
 * and where to look - on the Community Edition, at a laptop's and a phone's
 * width, light and dark, in German and Persian, and never a page that
 * scrolls sideways.
 */
const port: string = process.env["ADMIN_HEALTH_FIXTURE_PORT"] || "4727";

export default defineConfig({
  testDir: "./AdminHealth",
  testMatch: ["AdminHealth.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/admin-health-ui/test-results",
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
    timezoneId: "UTC",
    locale: "en-GB",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node AdminHealth/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}/ready.json`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
