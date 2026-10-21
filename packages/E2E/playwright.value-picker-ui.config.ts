import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * The workflow value picker in real Chromium and Firefox, with no backend:
 * ValuePicker/Fixture/server.js bundles the builder, its settings dialog and
 * the picker with the app's esbuild config, Tailwind and theme. jsdom has no
 * layout and edits a contenteditable its own way, so what this suite checks -
 * where a click or Home puts the caret around a chip, what Enter and
 * Backspace do to the DOM, the clipboard, focus moving into a portalled list
 * - cannot be checked anywhere else.
 */
const port: string = process.env["VALUE_PICKER_FIXTURE_PORT"] || "4251";

export default defineConfig({
  testDir: "./ValuePicker",
  testMatch: "ValuePicker.spec.ts",
  timeout: 60000,
  expect: { timeout: 10000 },
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "../../output/playwright/value-picker-ui/test-results",
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
    command: "node ValuePicker/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120000,
  },
});
