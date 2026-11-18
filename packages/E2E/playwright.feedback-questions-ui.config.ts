import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * The fixture server's port. Another checkout's run on the default port is
 * reused outside CI, so a second run picks a port of its own:
 * FEEDBACK_QUESTIONS_FIXTURE_PORT=4798 CI=1 npm run test-feedback-questions-ui.
 */
const port: string = process.env["FEEDBACK_QUESTIONS_FIXTURE_PORT"] || "4799";

export default defineConfig({
  testDir: "./FeedbackQuestions",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 120000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/feedback-questions-ui/test-results",
  projects: [
    {
      name: "chromium",
      /*
       * The viewport lives on the project: a project's `use` wins over the
       * top-level one, so devices["Desktop Chrome"] would otherwise reset it
       * to 1280x720.
       */
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
      },
    },
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    locale: "en-US",
    timezoneId: "UTC",
    // A click or a fill that finds nothing fails in seconds, not at the test's limit.
    actionTimeout: 15000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node FeedbackQuestions/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}/admin/feedback`,
    timeout: 300000,
    reuseExistingServer: !process.env["CI"],
  },
});
