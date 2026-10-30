import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * File and Multiple files custom fields, and a public form's file
 * questions, in real Chromium with no backend: CustomFieldFiles/Fixture/
 * server.js bundles an incident's production Custom Fields page and the
 * public form page (Accounts' own app) with the app's esbuild config,
 * Tailwind and its reading-direction config, the theme and the font, over
 * an in-memory incident and form whose uploads, saves and submissions it
 * records. What jsdom cannot show is checked here: the card's files as
 * downloads laid out at 1280 and 390 pixels, choosing and dropping real
 * files, an upload's progress, Replace and Remove, a full field, refused
 * kinds and sizes, what a save and a submission send, dark mode, German
 * and Persian, right to left.
 */
const port: string = process.env["CUSTOM_FIELD_FILES_FIXTURE_PORT"] || "4652";

export default defineConfig({
  testDir: "./CustomFieldFiles",
  testMatch: ["CustomFieldFiles.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/custom-field-files-ui/test-results",
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
    command: "node CustomFieldFiles/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}/dashboard/`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
