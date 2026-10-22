import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * The Runbooks side menu after AI Access went - the Runners entry in the
 * menu's first section, no AI Access anywhere, the old addresses opening
 * the Runners - in real Chromium, with no backend:
 * RunbooksMenu/Fixture/server.js bundles the production Runbooks and
 * Settings route groups with the app's esbuild config, Tailwind, theme and
 * font, over a project with nothing in it yet. What jsdom cannot show is
 * checked here: the sections and entries as drawn at 1280 and 390 pixels,
 * the redirects in the browser's history, the keyboard's way through the
 * menu, German and dark mode.
 */
const port: string = process.env["RUNBOOKS_MENU_FIXTURE_PORT"] || "4388";

export default defineConfig({
  testDir: "./RunbooksMenu",
  testMatch: ["RunbooksMenu.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/runbooks-menu-ui/test-results",
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
    command: "node RunbooksMenu/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
