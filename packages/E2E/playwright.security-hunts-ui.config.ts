import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * Hunts (Security Events > Events > Hunts, the Events toolbar's Hunts list
 * and Save as Hunt, a hunt's page, Add to Case and the events kept on a
 * case) on the Security Operations fixture - its own server and data, read
 * by SecurityOperations/Hunts.spec.ts - as a suite of its own. The rest of
 * the Security Operations specs run as test-security-operations-ui, which
 * leaves this one out: the two run in different App Test groups, so the
 * hunts' minutes go to a group with room instead of the Security
 * Operations group, the longest suite there.
 */
const port: string = process.env["SECURITY_OPERATIONS_FIXTURE_PORT"] || "4234";

export default defineConfig({
  testDir: "./SecurityOperations",
  testMatch: ["Hunts.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 120000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/security-hunts-ui/test-results",
  projects: [
    {
      name: "chromium",
      // A project's `use` wins over the top-level one, so the viewport goes here.
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    locale: "en-US",
    timezoneId: "UTC",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node SecurityOperations/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: !process.env["CI"],
  },
});
