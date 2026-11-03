import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * The other ways to sign in, on the real sign-in pages (SignInOptions/), in
 * every language and from a 320 px phone to a laptop: each spec sets its own
 * viewport widths. The fixture's port: 4311, or another one for a second
 * copy running at the same time (the server reads the same variable).
 */
const port: string = process.env["SIGN_IN_OPTIONS_FIXTURE_PORT"] || "4311";

export default defineConfig({
  testDir: "./SignInOptions",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 120000,
  expect: { timeout: 10000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/sign-in-options-ui/test-results",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    timezoneId: "UTC",
    locale: "en-GB",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node SignInOptions/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
