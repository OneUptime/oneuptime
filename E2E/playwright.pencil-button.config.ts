import { defineConfig, devices } from "@playwright/test";
import path from "path";

export default defineConfig({
  testDir: "./PencilButton",
  testMatch: "BrowserFixture.spec.ts",
  timeout: 60000,
  expect: { timeout: 10000 },
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "../output/playwright/pencil-button/test-results",
  use: {
    baseURL: "http://127.0.0.1:4208",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 1100 },
      },
    },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "node PencilButton/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: "http://127.0.0.1:4208",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
