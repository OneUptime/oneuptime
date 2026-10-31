import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * Every resource's Topology page - a vCenter, a Kubernetes cluster, a host,
 * Docker and Podman hosts, Swarm, Proxmox and Ceph clusters and a storage
 * array - and the master Topology that links into them, in real Chromium,
 * with no backend: ResourceTopology/Fixture/server.js bundles the production
 * product layouts, side menus, Topology pages and the master TopologyPage
 * with the app's esbuild config, Tailwind, theme and font, over a synthetic
 * estate. What jsdom cannot show is checked here: the drawing framed at a
 * readable zoom, a tree of cards with no part inside or over another, the
 * lines coloured by trouble, the arrow keys, a host's calls drawn left to
 * right, a picked pod's line to its node, a phone, dark mode, German and
 * Persian (mirrored).
 */
const port: string = process.env["RESOURCE_TOPOLOGY_FIXTURE_PORT"] || "4437";

export default defineConfig({
  testDir: "./ResourceTopology",
  testMatch: ["ResourceTopology.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/resource-topology-ui/test-results",
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
    command: "node ResourceTopology/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
