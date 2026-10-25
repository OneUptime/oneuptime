import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * The AI context (issue #5198) - what a project's team writes for OneUptime
 * AI about its own systems - in real Chromium, with no backend:
 * AiContext/Fixture/server.js bundles the production AI Features page and
 * a run's details with the app's esbuild config, Tailwind, theme and font,
 * over an in-memory project whose saves it records. What jsdom cannot show
 * is checked here: the card between Enable AI and More settings, its dialog
 * with the Markdown editor counted as it is written, the outline, the fold
 * of a long text, the run's line and the dialog its View opens, at a
 * laptop's and a phone's width, light and dark, German and Persian.
 */
const port: string = process.env["AI_CONTEXT_FIXTURE_PORT"] || "4541";

export default defineConfig({
  testDir: "./AiContext",
  testMatch: ["AiContext.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/ai-context-ui/test-results",
  // A project's `use` wins over the top-level one, so the viewport goes here.
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
      },
    },
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    timezoneId: "Europe/London",
    locale: "en-GB",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node AiContext/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
