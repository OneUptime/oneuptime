import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * OpenShift in the Kubernetes product (issue #5477), in real Chromium, with
 * no backend: OpenShiftPages/Fixture/server.js bundles the production cluster
 * layout, side menu, Overview and the Route, Service and DeploymentConfig
 * pages with the app's esbuild config, Tailwind, theme and font, over
 * in-memory inventory rows whose every read it records. What jsdom cannot
 * show is checked here: the menu growing only on a cluster that has these
 * objects, same-named objects in two namespaces staying apart, a Route linked
 * to its Service and back, a DeploymentConfig's pods found through their
 * label, at a laptop's and a phone's width, light and dark, and in German.
 */
const port: string = process.env["OPENSHIFT_PAGES_FIXTURE_PORT"] || "4611";

export default defineConfig({
  testDir: "./OpenShiftPages",
  testMatch: ["OpenShiftPages.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/openshift-pages-ui/test-results",
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
    command: "node OpenShiftPages/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
