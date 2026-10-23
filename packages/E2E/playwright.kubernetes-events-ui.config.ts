import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * Where a Kubernetes cluster's warning events show (issue #5179), in real
 * Chromium, with no backend: KubernetesEvents/Fixture/server.js bundles the
 * production cluster layout, side menu, Overview, Events page and the node,
 * HPA, Deployment and namespace pages with the app's esbuild config,
 * Tailwind, theme and font, over in-memory Event logs whose every read it
 * records. What jsdom cannot show is checked here: the warnings of the
 * customer's report on the Events page, its type buttons and pickers
 * filtering on the server and kept in the address, each detail page's
 * Events tab and the warning count on it, the Overview's Recent Warnings, a
 * busy cluster, at a laptop's and a phone's width, light and dark, and
 * German.
 */
const port: string = process.env["KUBERNETES_EVENTS_FIXTURE_PORT"] || "4517";

export default defineConfig({
  testDir: "./KubernetesEvents",
  testMatch: ["KubernetesEvents.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/kubernetes-events-ui/test-results",
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
    command: "node KubernetesEvents/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
