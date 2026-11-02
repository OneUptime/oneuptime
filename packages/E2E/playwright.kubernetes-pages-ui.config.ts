import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * A Kubernetes cluster's pages in real Chromium, with no backend:
 * KubernetesPages/Fixture/server.js bundles the production cluster layout,
 * side menu, Overview, lists, the pages of a pod, a workload and a node,
 * and Recommendations with the app's esbuild config, Tailwind, theme and
 * font, over in-memory records whose every read it records. What jsdom
 * cannot show is checked here: what needs attention first and its way to
 * each part's page, in its namespace; each part's hero, its Needs
 * attention, what is open on it, its alerts and its Pods tab; the lists'
 * statuses; a laptop's and a phone's width, dark mode, German and Persian.
 */
const port: string = process.env["KUBERNETES_PAGES_FIXTURE_PORT"] || "4671";

export default defineConfig({
  testDir: "./KubernetesPages",
  testMatch: ["KubernetesPages.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/kubernetes-pages-ui/test-results",
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
    command: "node KubernetesPages/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
