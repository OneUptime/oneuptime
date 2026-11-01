import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * App Platforms in real Chromium, with no backend: AppPlatforms/Fixture/
 * server.js bundles the production App Platforms route group (its layout,
 * side menus, Overview, All Environments, an environment's pages, its rules
 * and Archived) and Cloud's resource view with the app's esbuild config,
 * Tailwind, theme and font, over in-memory records whose every read it
 * records. What jsdom cannot show is checked here: the Overview's fleet
 * strip laid out by its own width, the trail and the lit side menu entry on
 * every page, the old Cloud addresses forwarding (and Back not bouncing),
 * and the pages at a laptop's and a phone's width, dark, German and Persian.
 */
const port: string = process.env["APP_PLATFORMS_FIXTURE_PORT"] || "4667";

export default defineConfig({
  testDir: "./AppPlatforms",
  testMatch: ["AppPlatforms.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/app-platforms-ui/test-results",
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
    command: "node AppPlatforms/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
