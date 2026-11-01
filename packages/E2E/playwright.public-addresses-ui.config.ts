import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * Where visitors find a status page, a public dashboard or a form, in real
 * Chromium, with no backend: PublicAddresses/Fixture/server.js bundles a
 * status page's real Overview (its Status Page Link card), a dashboard's
 * real Sharing page and a form's real Share page (its Share Link card) with
 * the app's esbuild config, Tailwind, theme and font. What jsdom
 * cannot show is checked here: the rows as drawn at a laptop's and a phone's
 * width, a long address cut short inside its row with the whole of it on
 * hover, Copy link copying, DNS Setup opening its dialog, nothing running
 * off a phone's screen, and the dark theme as drawn.
 */
const port: string = process.env["PUBLIC_ADDRESSES_FIXTURE_PORT"] || "4381";

export default defineConfig({
  testDir: "./PublicAddresses",
  testMatch: "PublicAddresses.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/public-addresses-ui/test-results",
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
    command: "node PublicAddresses/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}/dashboard/10000000-0000-4000-8000-000000000001/status-pages/30000000-0000-4000-8000-000000000001`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
