import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * Tables (ModelTable -> BaseModelTable -> Table) in real Chromium, with no
 * backend: ModelTables/Fixture/server.js bundles real Dashboard list pages
 * and a gallery of every kind of column with the app's esbuild config,
 * Tailwind, theme and font. What jsdom cannot show is checked here: a header
 * row of one line, rows of 48px, a long value cut short inside its column,
 * a row's name using the room a table that fits has, the Actions column in
 * sight when the rows scroll sideways, a header that sticks while a long
 * page scrolls, a row that opens its record, the phone's cards and the dark
 * theme as drawn - and, in CardHeaders.spec.ts, where every card header
 * shape puts its description under its title, in RowActions.spec.ts,
 * what each row's ⋯ menu offers and does on the incidents, alerts, monitors
 * and runbooks lists, and in ColumnResize.spec.ts, a column's edge dragged,
 * double-clicked, keyed, reset, on a tablet and right to left.
 */
const port: string = process.env["MODEL_TABLES_FIXTURE_PORT"] || "4319";

export default defineConfig({
  testDir: "./ModelTables",
  testMatch: [
    "ModelTables.spec.ts",
    "CardHeaders.spec.ts",
    "RowActions.spec.ts",
    "ColumnResize.spec.ts",
  ],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/model-tables-ui/test-results",
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
    locale: "en-US",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node ModelTables/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}/dashboard/10000000-0000-4000-8000-000000000001/incidents`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
