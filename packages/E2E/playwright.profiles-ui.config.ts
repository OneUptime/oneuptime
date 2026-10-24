import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * The Profiler - its overview, a function's panel with Fix with AI, the
 * compare menu and a service's Profiles tab - in real Chromium, with no
 * backend: Profiles/Fixture/server.js bundles the production pages over a
 * small profile store that answers the Profiler's reads the way the server
 * does. What jsdom cannot show is checked here: the flame graphs and the
 * pickers for real, a phone (no sideways scroll, the panel as a sheet) and
 * dark mode.
 */
const port: string = process.env["PROFILES_FIXTURE_PORT"] || "4391";

export default defineConfig({
  testDir: "./Profiles",
  testMatch: ["Profiles.spec.ts", "ProfilesAi.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/profiles-ui/test-results",
  // A project's `use` wins over the top-level one, so the viewports go here.
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
      },
    },
    {
      name: "phone",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        hasTouch: true,
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
    command: "node Profiles/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
