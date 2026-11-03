import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * The fixture's port: 4487, or another one for a second copy running at the
 * same time (the server reads the same variable).
 */
const port: string = process.env["PERMISSIONS_PER_TAB_FIXTURE_PORT"] || "4487";

export default defineConfig({
  testDir: "./PermissionsPerTab",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/permissions-per-tab-ui/test-results",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    timezoneId: "UTC",
    locale: "en-GB",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node PermissionsPerTab/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}/ready`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
