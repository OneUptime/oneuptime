import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * The fixture server's port. Another checkout's run on the default port is
 * reused outside CI, so a second run picks a port of its own:
 * PRODUCT_ANALYTICS_SAVED_VIEWS_FIXTURE_PORT=4837 CI=1 npm run
 * test-product-analytics-saved-views-ui.
 */
const port: string =
  process.env["PRODUCT_ANALYTICS_SAVED_VIEWS_FIXTURE_PORT"] || "4836";

export default defineConfig({
  testDir: "./ProductAnalyticsSavedViews",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 120000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir:
    "../../output/playwright/product-analytics-saved-views-ui/test-results",
  projects: [
    {
      name: "desktop",
      /*
       * The viewport lives on the project: a project's `use` wins over the
       * top-level one, so devices["Desktop Chrome"] would otherwise reset it
       * to 1280x720.
       */
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
      },
    },
    {
      /*
       * A phone held upright, touched rather than clicked: the saved views
       * menu once opened off a 390px touch screen (#6699), which only a real
       * browser's layout shows.
       */
      name: "phone",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    locale: "en-US",
    timezoneId: "UTC",
    // A click or a fill that finds nothing fails in seconds, not at the test's limit.
    actionTimeout: 15000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node ProductAnalyticsSavedViews/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}/favicon.ico`,
    timeout: 300000,
    reuseExistingServer: !process.env["CI"],
  },
});
