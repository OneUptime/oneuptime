import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * On-Call > Schedules filtered by its owners ("I can't filter by Owner/team
 * on /on-call-duty/schedules"), in real Chromium, with no backend:
 * OwnerFilters/Fixture/server.js bundles the production page in the On-Call
 * side menu with the app's esbuild config, Tailwind, theme and font, over an
 * in-memory project whose list reads answer the Owner chip as the server
 * does. What jsdom cannot show is checked here: the Owner and Labels chips
 * over the list, picking a team or a person and the rows that stay, a team
 * never standing for its members, the chip's four operators, the Owners
 * column, what each list read sends, the chips kept across a reload, a
 * 390px phone, dark mode and German.
 */
const port: string = process.env["OWNER_FILTERS_FIXTURE_PORT"] || "4459";

export default defineConfig({
  testDir: "./OwnerFilters",
  testMatch: ["OwnerFilters.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/owner-filters-ui/test-results",
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
    command: "node OwnerFilters/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
