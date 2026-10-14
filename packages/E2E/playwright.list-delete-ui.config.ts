import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * Delete on the real Status Pages list - each row's ⋯ menu and Bulk Actions -
 * in real Chromium, with no backend: ListDelete/Fixture/server.js bundles the
 * production page with the app's esbuild config, Tailwind, theme and font,
 * over an in-memory list whose deletes it records (and, on request, refuses).
 * What jsdom cannot show is checked here: the menus opening where they do,
 * the dialogs fitting a phone, the tooltip on a locked Delete, dark mode.
 */
const port: string = process.env["LIST_DELETE_FIXTURE_PORT"] || "4296";

export default defineConfig({
  testDir: "./ListDelete",
  testMatch: "ListDelete.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/list-delete-ui/test-results",
  // A project's `use` wins over the top-level one, so the viewport goes here.
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
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
    command: "node ListDelete/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
