import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * A dropdown custom field's option editor in real Chromium, at a desktop
 * size and at a phone's width, with no backend (#4564):
 * CustomFieldOptions/Fixture/server.js bundles the production
 * DropdownOptionsInput inside the real Modal with the app's esbuild config,
 * Tailwind, theme and font. jsdom lays nothing out and moves nothing, so
 * what this suite checks - dragging an option by its grip with a mouse and
 * from the keyboard, inside a list that is itself dragged, the rename and
 * "No longer options" notes as they read, the dark theme's surfaces and a
 * phone's width - cannot be checked anywhere else.
 */
const port: string = process.env["CUSTOM_FIELD_OPTIONS_FIXTURE_PORT"] || "4276";

export default defineConfig({
  testDir: "./CustomFieldOptions",
  testMatch: "CustomFieldOptions.spec.ts",
  timeout: 60000,
  expect: { timeout: 10000 },
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "../../output/playwright/custom-field-options-ui/test-results",
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
      /*
       * A small phone's width: each option's color moves under its text. A
       * desktop browser at that width, not a phone's emulation, whose zoom on
       * a focused small input moves what a click lands on.
       */
      name: "mobile",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 360, height: 760 },
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: "node CustomFieldOptions/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120000,
  },
});
