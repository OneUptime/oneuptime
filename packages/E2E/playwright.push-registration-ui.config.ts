import { defineConfig, devices } from "@playwright/test";
import path from "path";

// PUSH_REGISTRATION_FIXTURE_PORT lets a second checkout run the suite beside this one.
const port: number =
  Number(process.env["PUSH_REGISTRATION_FIXTURE_PORT"]) || 4281;

export default defineConfig({
  testDir: "./PushRegistration",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/push-registration-ui/test-results",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    locale: "en-GB",
    timezoneId: "UTC",
    // The default, said here because this suite is about the service worker.
    serviceWorkers: "allow",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node PushRegistration/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
