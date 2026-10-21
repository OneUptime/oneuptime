import { defineConfig, devices } from "@playwright/test";
import path from "path";

// NAVIGATION_SEARCH_PORT lets a second checkout run the suite beside this one.
const port: number = Number(process.env["NAVIGATION_SEARCH_PORT"]) || 4242;

export default defineConfig({
  testDir: "./NavigationSearch",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  expect: { timeout: 10000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/navigation-search/test-results",
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 5"] } },
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    locale: "en-GB",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node NavigationSearch/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
