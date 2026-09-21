import { defineConfig, devices } from "@playwright/test";

/*
 * The LAPSED half of the enterprise suite: phase two of the
 * test-e2e-test-enterprise job, run against the SAME booted stack as
 * playwright.enterprise-licensed.config.ts after its licence has been forced
 * to lapse (the job backdates GlobalConfig.enterpriseEditionFirstSeenAt with
 * psql; see packages/E2E/README.md for the exact command).
 *
 * The settings match the licensed config, for the reasons documented there:
 * chromium only, one retry, and a 20-minute ceiling so a hang reports inside
 * the phase rather than spending the job's remaining budget. The only
 * difference is testDir, and that these specs wait for the licence state to
 * flip before they assert - the app notices a backdated first-seen date
 * without a restart, but only after its 60s licence-inputs cache turns over
 * (Enterprise/Helpers/StackGuard.ts polls for exactly that).
 */
export default defineConfig({
  testDir: "./Enterprise/Lapsed",
  testMatch: "**/*.spec.ts",
  timeout: 240 * 1000,
  globalTimeout: 20 * 60 * 1000,
  expect: {
    timeout: 15000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 1,
  forbidOnly: Boolean(process.env["CI"]),
  reporter: [["list"]],
  /*
   * Artifacts must land inside packages/E2E: in CI each phase is its own
   * `docker compose run --rm e2e` container, whose only durable paths are the
   * playwright-report/ and test-results/ bind mounts, and the job uploads
   * ./packages/E2E on failure. An outputDir above the package would be
   * discarded with the container, leaving a failed run with no trace to read.
   */
  outputDir: "./test-results/enterprise-lapsed",
  // A project's `use` wins over the top-level one, so the viewport goes here.
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
