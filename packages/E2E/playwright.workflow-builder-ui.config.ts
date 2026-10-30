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

/*
 * App Test runs this suite in halves, one per Dashboard Offline UI group:
 * the group's matrix sets WORKFLOW_BUILDER_SHARD to "1/2" or "2/2" (alone,
 * the suite took 20.4 minutes of its group's 28 on 14.0.93's gate run, and
 * #5320 grew it after that). Playwright shards whole spec files of a
 * project, balanced by their number of tests: each project has the same
 * 243, so the first half is the laptop's and the second the phone's, each
 * one worker as before. Unset, the whole suite runs, in file order, as it
 * always has.
 */
const SHARD_PATTERN: RegExp = /^(\d+)\/(\d+)$/;
const shardMatch: RegExpExecArray | null = SHARD_PATTERN.exec(
  process.env["WORKFLOW_BUILDER_SHARD"] || "",
);
const shard: { current: number; total: number } | null = shardMatch
  ? { current: Number(shardMatch[1]), total: Number(shardMatch[2]) }
  : null;

export default defineConfig({
  testDir: "./WorkflowBuilder",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  shard: shard,
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
