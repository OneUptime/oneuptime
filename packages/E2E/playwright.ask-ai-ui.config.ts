import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * Ask AI on the main stage, in real Chromium: the dialog over the blurred
 * page from every way in, its start, an answer written step by step, its
 * sources and cards, an approval, the history, and the way back to an
 * answer still being written - at 1280, 768 and 390 pixels, light and
 * dark, in German and Persian, and with reduced motion.
 *
 * The fixture server's port. Another checkout's run on the default port is
 * reused outside CI, so a second run picks a port of its own:
 * ASK_AI_FIXTURE_PORT=4558 CI=1 npm run test-ask-ai-ui.
 */
const port: string = process.env["ASK_AI_FIXTURE_PORT"] || "4557";

export default defineConfig({
  testDir: "./AskAi",
  testMatch: "*.spec.ts",
  workers: 1,
  timeout: 120000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/ask-ai-ui/test-results",
  projects: [
    {
      name: "chromium",
      /*
       * The viewport lives on the project: a project's `use` wins over the
       * top-level one, so devices["Desktop Chrome"] would otherwise reset it
       * to 1280x720. A test that needs another width says so itself.
       */
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    locale: "en-US",
    timezoneId: "UTC",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node AskAi/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: !process.env["CI"],
  },
});
