import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./LabelRules",
  testMatch: "ImportExport.spec.ts",
  timeout: 180000,
  expect: { timeout: 30000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  /*
   * Inside packages/E2E, like the enterprise suites': in CI this suite runs in
   * a `docker compose run --rm e2e` container (test-release.yaml's
   * test-e2e-test-self-hosted), whose only durable paths are the
   * playwright-report/ and test-results/ bind mounts. An outputDir above the
   * package would be discarded with the container, and a failed run would
   * leave no trace to read.
   */
  outputDir: "./test-results/label-rule-transfer",
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1600, height: 1100 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium" }],
});
