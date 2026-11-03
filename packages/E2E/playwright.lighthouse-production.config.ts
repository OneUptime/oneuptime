import { defineConfig } from "@playwright/test";

/*
 * The nightly scan of oneuptime.com (Lighthouse/Production.scan.ts, issue
 * #5609): Lighthouse's four categories, performance among them, on the live
 * site's pages with every third party they load, three runs a page. It
 * tracks and never judges: the summary table and the reports are the
 * result, and a page fails only when it could not be scanned. The
 * "Lighthouse Production Scan" workflow runs it every night;
 * LIGHTHOUSE_ORIGIN points it at another installation.
 */
export default defineConfig({
  testDir: "./Lighthouse",
  testMatch: "Production.scan.ts",
  fullyParallel: false,
  workers: 1,
  // Three runs of a page over the internet, with room for a slow one.
  timeout: 600000,
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/lighthouse-production/test-results",
  globalSetup: "./Lighthouse/ProductionSetup.ts",
  globalTeardown: "./Lighthouse/ProductionTeardown.ts",
});
