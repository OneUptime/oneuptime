import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * Diagrams in real Chromium and Firefox, with no backend: Diagrams/Fixture/
 * server.js bundles the Dashboard's MarkdownViewer with the frontends'
 * esbuild config, renders the docs' real <head> above docs diagrams, lifts
 * the blog's scripts out of its post template, and serves the mermaid build
 * the docs and the blog import. jsdom lays nothing out and mermaid measures
 * every label with the browser's layout, so a drawn diagram - and a $$...$$
 * label set by KaTeX - can only be checked here.
 */
const port: string = process.env["DIAGRAMS_FIXTURE_PORT"] || "4271";

export default defineConfig({
  testDir: "./Diagrams",
  testMatch: "Diagrams.spec.ts",
  timeout: 60000,
  expect: { timeout: 20000 },
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "../../output/playwright/diagrams-ui/test-results",
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
    command: "node Diagrams/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}/dashboard`,
    reuseExistingServer: false,
    timeout: 120000,
  },
});
