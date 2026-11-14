import { defineConfig, devices } from "@playwright/test";
import path from "path";
import {
  DOCS_SCREEN_FIXTURES,
  DocsScreenFixture,
} from "../App/FeatureSet/Docs/Screens/DocsScreenList";

/*
 * The docs' screenshots (#6823): every shot of
 * App/FeatureSet/Docs/Screens/DocsScreenList.ts, drawn in every docs
 * language from the offline fixtures, which this config starts on ports of
 * their own. Not a test suite: `npm run docs-screens` writes the pictures
 * whose page changed, `npm run docs-screens:check` (the job on main) only
 * says which did. DocsScreens/README.md has the rest.
 */
export default defineConfig({
  testDir: "./DocsScreens",
  testMatch: ["DocsScreens.spec.ts"],
  // A language per test, two at once: the machine draws the Dashboard twice.
  fullyParallel: true,
  workers: Number(process.env["DOCS_SCREENS_WORKERS"] || 2),
  timeout: 30 * 60 * 1000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/docs-screens/test-results",
  globalSetup: "./DocsScreens/DocsScreensStart.ts",
  globalTeardown: "./DocsScreens/DocsScreensFinish.ts",
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  use: {
    actionTimeout: 15000,
    // A run draws hundreds of pages: a trace of each would be gigabytes. A shot that fails says why in its result.
    trace: "off",
  },
  webServer: Object.values(DOCS_SCREEN_FIXTURES).map(
    (fixture: DocsScreenFixture) => {
      return {
        command: `node ${fixture.server}`,
        cwd: path.resolve(__dirname),
        url: `http://127.0.0.1:${fixture.port}`,
        env: { [fixture.portVariable]: String(fixture.port) },
        timeout: 300000,
        reuseExistingServer: !process.env["CI"],
      };
    },
  ),
});
