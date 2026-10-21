import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * The real workflow builder canvas in a browser: adding a step leaves its
 * settings closed, and the step is selected, in view and focused. jsdom has
 * no layout, no focus-visible and no react-flow measuring, so these live
 * here. Offline: the fixture bundles the canvas and needs no server. The
 * "Create a workflow" dialog is tested here too (CreateWorkflowDialog.spec.ts),
 * on the fixture's ?page=create-workflow.
 *
 * WORKFLOW_BUILDER_FIXTURE_PORT moves the fixture off 4237, so a second
 * checkout on the same machine can run the suite at the same time.
 */
const port: number = Number(
  process.env["WORKFLOW_BUILDER_FIXTURE_PORT"] || 4237,
);

export default defineConfig({
  testDir: "./WorkflowBuilder",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: "list",
  outputDir: "../../output/playwright/workflow-builder-ui/test-results",
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
        viewport: { width: 1280, height: 1100 },
      },
    },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "node WorkflowBuilder/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    env: { WORKFLOW_BUILDER_FIXTURE_PORT: String(port) },
    timeout: 300000,
    reuseExistingServer: false,
  },
});
