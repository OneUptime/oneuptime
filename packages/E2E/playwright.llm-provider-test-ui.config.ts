import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * Test LLM Provider in a real browser, with no backend:
 * LlmProviderTest/server.js bundles the actual Dashboard pages - a
 * provider's own page and Project Settings > AI > LLM Providers - with the
 * app's esbuild config, Tailwind, theme and font. What only a browser can
 * show is checked here: who finds Test locked and what its tooltip says,
 * the request the dialog sends, the dialog while a test runs and after it,
 * Test again and Close, and the dialog at phone width, in the dark theme
 * and in Japanese.
 */
const port: string = process.env["LLM_PROVIDER_TEST_FIXTURE_PORT"] || "4264";

export default defineConfig({
  testDir: "./LlmProviderTest",
  // Test LLM Provider, and the form a provider is added with.
  testMatch: ["LlmProviderTest.spec.ts", "LlmProviderForm.spec.ts"],
  timeout: 90000,
  expect: { timeout: 15000 },
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "../../output/playwright/llm-provider-test-ui/test-results",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    timezoneId: "UTC",
    locale: "en-GB",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
      },
    },
  ],
  webServer: {
    command: "node LlmProviderTest/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env["CI"],
    timeout: 300000,
  },
});
