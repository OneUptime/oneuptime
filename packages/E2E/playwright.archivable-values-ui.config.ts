import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * Archiving the values records pick from (Common/Utils/ArchivableValues) on
 * the real Incident Severity and Incident State settings pages, and the
 * real Incident Templates page's Create form, in real Chromium, with no
 * backend: ArchivableValues/Fixture/server.js bundles the production pages
 * with the app's esbuild config, Tailwind, theme and font, over in-memory
 * values whose updates and deletes it records. What jsdom cannot show is
 * checked here: the row menu and the dialogs opening, the folded Archived
 * section, a locked Archive's reason on hover, the form's pickers, and the
 * pages at a laptop's and a phone's width, light and dark.
 */
const port: string = process.env["ARCHIVABLE_VALUES_FIXTURE_PORT"] || "4417";

export default defineConfig({
  testDir: "./ArchivableValues",
  testMatch: "ArchivableValues.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/archivable-values-ui/test-results",
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
    command: "node ArchivableValues/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
