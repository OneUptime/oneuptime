import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * A Docker and a Podman host's pages (block 39, part 5), in real Chromium,
 * with no backend: ContainerHostPages/Fixture/server.js bundles the
 * production host layout and side menu, the Overview, the Containers list
 * and a container's page with the app's esbuild config, Tailwind, theme and
 * font, over in-memory records whose every read it records. What jsdom
 * cannot show is checked here: the Needs attention card and the lists laid
 * out at a phone's, a tablet's and a laptop's width, nothing cut and no
 * sideways scroll, dark, German and Persian right to left.
 */
const port: string = process.env["CONTAINER_HOST_PAGES_FIXTURE_PORT"] || "4691";

export default defineConfig({
  testDir: "./ContainerHostPages",
  testMatch: ["ContainerHostPages.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/container-host-pages-ui/test-results",
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
    command: "node ContainerHostPages/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
