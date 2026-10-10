import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * The shared pagination footer every table, log and trace list pages with, in
 * real Chromium, with no backend: Pagination/Fixture/server.js bundles the
 * production component (and the Modal its jump dialog opens) with the app's
 * esbuild config, Tailwind, theme and font, over an in-memory list. jsdom
 * applies no media queries and moves no focus on its own, so what this suite
 * checks - the page list giving way to "Page 3 of 100" on a phone, the jump
 * dialog taking focus and handing it back, the keyboard walking the bar -
 * cannot be checked anywhere else.
 */
const port: string = process.env["PAGINATION_FIXTURE_PORT"] || "4291";

export default defineConfig({
  testDir: "./Pagination",
  testMatch: "Pagination.spec.ts",
  timeout: 60000,
  expect: { timeout: 10000 },
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "../../output/playwright/pagination-ui/test-results",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    // The summary prints counts with the reader's separators: "1,000".
    locale: "en-US",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
  webServer: {
    command: "node Pagination/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120000,
  },
});
