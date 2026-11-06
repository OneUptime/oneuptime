import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * The Databases product's pages in real Chromium, with no backend:
 * DatabasePages/Fixture/server.js bundles the production Databases layout
 * and side menu with the Databases list, and a database's own layout with
 * its Overview and Recommendations, with the app's esbuild config,
 * Tailwind, theme and font, over in-memory records whose every read it
 * records. What jsdom cannot show is checked here: which databases need
 * attention first and why, by the lines of each engine's recommended
 * alerts, each database's Status and how the table fits its card, a
 * database's own page - its health, what on it needs a look, its alerts and
 * "Turn on N alerts" opening Recommendations with those alerts selected -
 * at 1280, 1024, 768 and 390 pixels, dark mode, German and Persian.
 */
const port: string = process.env["DATABASE_PAGES_FIXTURE_PORT"] || "4694";

export default defineConfig({
  testDir: "./DatabasePages",
  testMatch: ["DatabasePages.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/database-pages-ui/test-results",
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
    command: "node DatabasePages/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
