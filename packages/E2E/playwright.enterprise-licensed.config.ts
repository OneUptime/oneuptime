import { defineConfig, devices } from "@playwright/test";

/*
 * The LICENSED half of the enterprise suite: phase one of the
 * test-e2e-test-enterprise job, run against a booted self-hosted ENTERPRISE
 * stack (enterprise image, BILLING_ENABLED=false) whose licence is still
 * usable - a fresh install inside its 14-day trial.
 *
 * Why these specs are a focused suite and not part of ./Tests: the default
 * suite runs in all three full-stack jobs, and the enterprise job must run
 * only these. It also runs every test twice (chromium and firefox) and is
 * already near the 90-minute ceiling its own config argues must be read as a
 * hang rather than raised, so adding stack-specific specs there would cost
 * every other job time for tests that cannot apply to it.
 *
 * Where this differs from playwright.config.ts, and why:
 *
 *   projects   chromium only. Almost every assertion here is an HTTP status
 *              and a message from the server, which no browser engine can
 *              change; the one browser spec checks that the Dashboard bundle
 *              carries the Enterprise screens, which is a build fact, not a
 *              rendering one. One browser halves the cost of the job.
 *   retries    1, not 2. At workers=1 each retry costs a full test timeout,
 *              and this job runs its suite twice (before and after the
 *              licence is forced to lapse). One retry still absorbs a
 *              transport flake.
 *   globalTimeout
 *              20 minutes against a suite that targets under 10, so a hang
 *              reports inside the phase instead of running the job's budget
 *              down. Both enterprise phases plus the lapse step have to fit
 *              in the job, so this ceiling is deliberately far below the
 *              default suite's 90 minutes.
 *   webServer  none. These specs need a full docker-compose stack, which the
 *              CI job boots; there is nothing playwright could start.
 *
 * Everything else is taken from playwright.config.ts on purpose: the 240s test
 * timeout, the unbounded actionTimeout (a submit button that sits disabled
 * while the backend works is a normal wait here) and the 120s navigation
 * ceiling (which must stay bounded, or one broken precondition sits on the
 * whole hook budget).
 */
export default defineConfig({
  testDir: "./Enterprise/Licensed",
  testMatch: "**/*.spec.ts",
  timeout: 240 * 1000,
  globalTimeout: 20 * 60 * 1000,
  expect: {
    /*
     * 15s rather than the default suite's 5s: every assertion here waits on a
     * real stack, and the UI spec's screens fetch their data before rendering.
     */
    timeout: 15000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 1,
  forbidOnly: Boolean(process.env["CI"]),
  reporter: [["list"]],
  outputDir: "../../output/playwright/enterprise-licensed/test-results",
  /*
   * The viewport belongs INSIDE the project: a project's `use` wins over the
   * top-level one, so a viewport declared only at the top level is replaced by
   * Desktop Chrome's 1280x720.
   */
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
  ],
  use: {
    actionTimeout: 0,
    navigationTimeout: 120 * 1000,
    timezoneId: "UTC",
    locale: "en-GB",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
