import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * The shared buttons, dialogs and cards - Button and its styles, MoreMenu's
 * own trigger, Modal's first focus, the Duplicate, Reset and Delete cards
 * and their dialogs, CollapsibleSection and SideMenuSection, the pills, the
 * stat tiles, the multi-selects' chips and the team avatars - in real
 * Chromium, with no backend: SharedUi/Fixture/server.js bundles the
 * production components with the app's esbuild config, Tailwind, theme and
 * font. What jsdom cannot show is checked here: borders, hovers, the
 * disabled look, where the focus lands once a form draws, a phone's width,
 * a side menu beside the cards, dark mode and four languages.
 */
const port: string = process.env["SHARED_UI_FIXTURE_PORT"] || "4329";

export default defineConfig({
  testDir: "./SharedUi",
  testMatch: "SharedUi.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/shared-ui/test-results",
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
    locale: "en-US",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node SharedUi/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
