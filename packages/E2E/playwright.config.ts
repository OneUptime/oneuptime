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
   *
   * That headroom has not been re-measured since the suite reached 618 tests:
   * the run that last hit this ceiling spent 87 of its 90 minutes inside
   * hanging beforeAll hooks and only ~2 of them running tests, so it says
   * nothing about how long the working suite takes. Read a trip of this
   * ceiling as a hang until the run's own timings say otherwise - raising it
   * only buys a slower red.
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
    /*
     * Actions stay bounded by the enclosing test timeout alone. A submit
     * button that sits disabled while the backend works is a normal wait here
     * - registerAndCreateProject allows project creation two minutes - so a
     * global ceiling on click()/fill() would fail tests that are only slow.
     */
    actionTimeout: 0,
    /*
     * Navigations, unlike actions, need a ceiling of their own. Playwright
     * Test pushes both of these settings onto every context made from the
     * `browser` fixture - including the browser.newPage() our beforeAll hooks
     * call - and reads 0 as "wait forever", so leaving this unset means a
     * page.goto() or waitForURL() can only end when the enclosing hook does.
     * That is how one broken precondition erased a whole run: signup stopped
     * accepting the password registerAndCreateProject typed, and the
     * waitForURL after it then sat on each spec's 300-600s beforeAll budget,
     * three times over at workers=1 with retries=2. Fifteen such hangs took
     * 87 of the 90 minutes below, and 467 of the 618 tests never ran.
     * Passkeys.spec.ts hit the identical failure in 31s rather than 300s
     * because it is the only spec that sets its own page default - this makes
     * that the rule. Two minutes because that is the budget the suite already
     * argues for out loud: 81 setDefaultNavigationTimeout calls across the
     * Home specs, every one of them 120000. Picking anything less would put
     * the default below what the suite's own slowest pages say they need. A
     * per-call timeout still overrides it either way.
     */
    navigationTimeout: 120 * 1000,
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
