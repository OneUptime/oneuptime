import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./Discord",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90000,
  globalTimeout: 20 * 60 * 1000,
  expect: { timeout: 10000 },
  reporter: [["list"], ["html", { open: "never" }], ["json"]],
  outputDir:
    process.env["DISCORD_E2E_OUTPUT"] ||
    "../../output/playwright/discord/test-results",
  use: {
    baseURL: `http://${process.env["HOST"] || "oneuptime.test:7849"}`,
    trace: "on",
    screenshot: "on",
    locale: "en-US",
    timezoneId: "UTC",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
