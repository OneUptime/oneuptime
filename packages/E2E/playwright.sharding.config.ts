import { defineConfig } from "@playwright/test";

/*
 * The tests of the e2e suite's sharding (Sharding/Sharding.spec.ts): plain
 * Node checks plus Playwright's own --list of the main config, so no browser
 * and no running stack. `npm run test-sharding`; the Compile workflow runs it
 * on every pull request.
 */
export default defineConfig({
  testDir: "./Sharding",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  // The --list runs load all of the main suite's spec files, several times.
  timeout: 10 * 60 * 1000,
  forbidOnly: Boolean(process.env["CI"]),
  retries: 0,
  reporter: "list",
  outputDir: "../../output/playwright/sharding/test-results",
});
