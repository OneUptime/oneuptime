import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * Products switched off on the server in real Chromium, with no backend
 * (#6815, #7480): ServerProducts/Fixture/server.js bundles Admin Dashboard >
 * Settings > Products and the Dashboard's pages for a switched-off product
 * with the app's esbuild config, Tailwind, theme and font, over the
 * server's answers kept in the page. What jsdom cannot show is checked
 * here: the admin page on a fresh server, after the Monitoring and status
 * pages preset, with ingestion stopped and with the switch per product
 * open; the page a switched-off product's address opens, for a member and
 * for a master admin, and for Logs while ingestion is stopped; and Project
 * Settings > Products with products off - at a laptop's and a phone's
 * width, light and dark, in German and Persian, and never a page that
 * scrolls sideways.
 *
 * The fixture server's port. Another checkout's run on the default port is
 * reused outside CI, so a second run picks a port of its own:
 * SERVER_PRODUCTS_FIXTURE_PORT=4915 CI=1 npm run test-server-products-ui.
 */
const port: string = process.env["SERVER_PRODUCTS_FIXTURE_PORT"] || "4815";

export default defineConfig({
  testDir: "./ServerProducts",
  testMatch: ["ServerProducts.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 180000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/server-products-ui/test-results",
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
    timezoneId: "UTC",
    locale: "en-GB",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node ServerProducts/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}/ready.json`,
    timeout: 300000,
    reuseExistingServer: !process.env["CI"],
  },
});
