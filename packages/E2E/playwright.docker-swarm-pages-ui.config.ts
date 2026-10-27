import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * A Docker Swarm cluster's pages on a phone (follow-up of #5076), in real
 * Chromium, with no backend: DockerSwarmPages/Fixture/server.js bundles the
 * production cluster layout and side menu, its Overview, a task's page and
 * the Metrics tab with the app's esbuild config, Tailwind, theme and font,
 * over in-memory records whose every read it records. What jsdom cannot
 * show is checked here: the metrics list's rows stacked by their own width
 * (container queries), a 64-character Container ID breaking inside its
 * card, the Overview's name beside or above its refresh control, and the
 * agent version chip's sign and dialog - at a phone's, a tablet's and a
 * laptop's width, dark and German.
 */
const port: string = process.env["DOCKER_SWARM_PAGES_FIXTURE_PORT"] || "4637";

export default defineConfig({
  testDir: "./DockerSwarmPages",
  testMatch: ["DockerSwarmPages.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/docker-swarm-pages-ui/test-results",
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
    command: "node DockerSwarmPages/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
