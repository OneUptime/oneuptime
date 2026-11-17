import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * Server setup in real Chromium, with no backend (#7027):
 * ServerSetup/Fixture/server.js bundles the Admin Dashboard's Server setup,
 * Settings > Emails and Settings > Call and SMS, and the Dashboard's "This
 * server is not finished" card, with the app's esbuild config, Tailwind,
 * theme and font, over the server's answers kept in the page. What jsdom
 * cannot show is checked here: the groups and their rows as they are
 * drawn, the fix loud and the choices quiet, the test sends' accepted,
 * refused and not-set-up answers, the card's Hide, at a laptop's and a
 * phone's width, light and dark, in German and Persian, and never a page
 * that scrolls sideways.
 */
const port: string = process.env["SERVER_SETUP_FIXTURE_PORT"] || "4726";

export default defineConfig({
  testDir: "./ServerSetup",
  testMatch: ["ServerSetup.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/server-setup-ui/test-results",
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
    command: "node ServerSetup/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}/ready.json`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
