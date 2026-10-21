import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * The color field in real Chromium and Firefox, and at a phone's width, with
 * no backend: ColorPicker/Fixture/server.js bundles the field inside the
 * real Modal and BasicForm (the Create Label dialog), a custom field's
 * options, and a page, with the app's esbuild config, Tailwind, theme and
 * font. jsdom lays nothing out, so what this suite checks - the fine picker
 * opening inside the dialog body above its buttons, a row's popover staying
 * inside the dialog and the window, a real drag on the saturation square,
 * the dark theme's surfaces, the swatches wrapping on a phone - cannot be
 * checked anywhere else.
 */
const port: string = process.env["COLOR_PICKER_FIXTURE_PORT"] || "4262";

export default defineConfig({
  testDir: "./ColorPicker",
  testMatch: "ColorPicker.spec.ts",
  timeout: 60000,
  expect: { timeout: 10000 },
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "../../output/playwright/color-picker-ui/test-results",
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
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      /*
       * A small phone's width: narrower than the swatches' one line. A
       * desktop browser at that width, not a phone's emulation, whose zoom
       * on a focused small input moves what a click lands on.
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
    command: "node ColorPicker/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120000,
  },
});
