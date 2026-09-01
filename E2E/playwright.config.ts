import { defineConfig, devices } from "@playwright/test";

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: "./Tests",
  /* Maximum time one test can run for. */
  timeout: 240 * 1000,
  /*
   * Ceiling for the whole run. Without it a broken suite does not fail - it
   * hangs until GitHub kills the job at its 6 hour limit, which reports
   * "cancelled" and uploads nothing, so nobody learns what broke. That is not
   * hypothetical: the 12.0.29 release run and the master run after it both
   * died that way, six hours apart, having told us nothing.
   *
   * With workers=1 a single failing test costs timeout x (retries + 1), so a
   * few dozen failures cannot fit in six hours no matter how long we wait.
   * 90 minutes is roughly 2.5x a healthy run (~37 min), so a genuinely slow
   * but working suite still finishes, while a broken one reports inside the
   * hour with its artifacts intact.
   */
  globalTimeout: 90 * 60 * 1000,
  expect: {
    /**
     * Maximum time expect() should wait for the condition to be met.
     * For example in `await expect(locator).toHaveText();`
     */
    timeout: 5000,
  },
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: Boolean(process.env["CI"]),
  /*
   * Three retries meant four attempts per test, and at workers=1 that is up to
   * 16 minutes spent on one failing test before the run moves on. Two retries
   * keeps genuine flakes covered while cutting the worst case by a quarter.
   */
  retries: 2,
  /* Opt out of parallel tests on CI. */
  workers: 1,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: "html",
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Maximum time each action such as `click()` can take. Defaults to 0 (no limit). */
    actionTimeout: 0,
    /* Base URL to use in actions like `await page.goto('/')`. */
    // baseURL: 'http://localhost:3000',

    /*
     * Trace every retry, not every test. "on" traced all 372 tests and built a
     * ~1GB artifact each run - upload time and disk churn that buys nothing
     * for the tests that passed. Anything that fails is retried, so failures
     * still arrive with a full trace attached.
     */
    trace: "on-first-retry",
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },

    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    /* Test against mobile viewports. */
    /*
     * {
     *   name: 'Mobile Chrome',
     *   use: { ...devices['Pixel 5'] },
     * },
     * {
     *   name: 'Mobile Safari',
     *   use: { ...devices['iPhone 12'] },
     * },
     */

    /* Test against branded browsers. */
    /*
     * {
     *   name: 'Microsoft Edge',
     *   use: { channel: 'msedge' },
     * },
     * {
     *   name: 'Google Chrome',
     *   use: { channel: 'chrome' },
     * },
     */
  ],

  /* Folder for test artifacts such as screenshots, videos, traces, etc. */
  // outputDir: 'test-results/',

  /* Run your local dev server before starting the tests */
  /*
   * webServer: {
   *   command: 'npm run start',
   *   port: 3000,
   * },
   */
});
