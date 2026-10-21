import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * The production CodeEditor in real Chromium and Firefox, with no backend:
 * CodeEditor/Fixture/server.js bundles it with the app's esbuild config,
 * Tailwind and theme. jsdom has no layout, no execCommand and no undo stack,
 * so what this suite checks - the textarea's glyphs landing exactly on the
 * highlighted ones, the caret staying in view, native undo - cannot be
 * checked anywhere else.
 */
const port: string = process.env["CODE_EDITOR_FIXTURE_PORT"] || "4246";

export default defineConfig({
  testDir: "./CodeEditor",
  testMatch: "CodeEditor.spec.ts",
  timeout: 60000,
  expect: { timeout: 10000 },
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "../../output/playwright/code-editor-ui/test-results",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
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
    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
        viewport: { width: 1280, height: 900 },
      },
    },
  ],
  webServer: {
    command: "node CodeEditor/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120000,
  },
});
