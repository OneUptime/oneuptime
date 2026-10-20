import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * AI / LLM > Connect in a real browser, with no backend:
 * LlmConnect/server.js bundles the actual Dashboard pages - Connect and
 * Usage - with the app's esbuild config, Tailwind, theme and font. What
 * only a browser can show is checked here: the checklist ticking itself,
 * the three ways in, a connection made from its tile with its test, the
 * privacy of a company AI tool, the list's status and actions, Usage's
 * provider accounts, and all of it at desktop and phone width, in the dark
 * theme and in Japanese.
 */
const port: string = process.env["LLM_CONNECT_FIXTURE_PORT"] || "4393";

export default defineConfig({
  testDir: "./LlmConnect",
  testMatch: ["LlmConnect.spec.ts", "LlmProviderUsage.spec.ts"],
  timeout: 90000,
  expect: { timeout: 15000 },
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "../../output/playwright/llm-connect-ui/test-results",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    timezoneId: "UTC",
    locale: "en-GB",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
      },
    },
    {
      name: "phone",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      },
    },
  ],
  webServer: {
    command: "node LlmConnect/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env["CI"],
    timeout: 300000,
  },
});
