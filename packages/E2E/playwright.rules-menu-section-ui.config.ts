import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * The Rules section of a status page's and an SLO's side menus - folded by
 * default, holding Monitor Rules (and an SLO's Burn Rate Rules) - in real
 * Chromium, with no backend: RulesMenuSection/Fixture/server.js bundles the
 * production view layouts (header, breadcrumbs, side menu) with the app's
 * esbuild config, Tailwind, theme and font, around stand-in pages. What
 * jsdom cannot show is checked here: a folded section out of sight and out
 * of the keyboard's way, opened by click and by keyboard, opening by itself
 * on its own pages and staying open while the pages change, the phone menu,
 * German and dark mode. SideMenuNavigation.spec.ts measures the shared menu
 * itself: the current entry, long titles in French, German and Persian, and
 * the lit entry kept in sight in a menu taller than the window, with the
 * list fading out at an edge that hides entries. SideMenuWordBreaks.spec.ts
 * measures where its words break, in Firefox too: Firefox hyphenates
 * whatever word ends a line where Chrome moves it whole to the next.
 */
const port: string = process.env["RULES_MENU_SECTION_FIXTURE_PORT"] || "4385";

export default defineConfig({
  testDir: "./RulesMenuSection",
  testMatch: [
    "RulesMenuSection.spec.ts",
    "SideMenuNavigation.spec.ts",
    "SideMenuWordBreaks.spec.ts",
  ],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/rules-menu-section-ui/test-results",
  // A project's `use` wins over the top-level one, so the viewport goes here.
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
      },
    },
    // Where words break differs by browser: that spec runs in Firefox too.
    {
      name: "firefox",
      testMatch: "SideMenuWordBreaks.spec.ts",
      use: {
        ...devices["Desktop Firefox"],
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
    command: "node RulesMenuSection/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
