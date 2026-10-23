import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * The Owners field of Declare Incident and Create Alert - the declarer's
 * team one click away under More fields, and the owner rules that will run
 * said on the review step - in real Chromium, with no backend:
 * OwnersOnCreate/Fixture/server.js bundles the production pages with the
 * app's esbuild config, Tailwind, theme and font, over an in-memory project
 * whose owner rule preview answers as the server would. What jsdom cannot
 * show is checked here: the field folded until More fields opens, "Your
 * teams" and Add all, the review's Owners row and its rules, what the
 * preview is asked and what a create sends, a 390px phone, dark mode and
 * German.
 */
const port: string = process.env["OWNERS_ON_CREATE_FIXTURE_PORT"] || "4253";

export default defineConfig({
  testDir: "./OwnersOnCreate",
  testMatch: ["OwnersOnCreate.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/owners-on-create-ui/test-results",
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
    command: "node OwnersOnCreate/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
