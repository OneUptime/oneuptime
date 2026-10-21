import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * Project Settings -> AI -> External MCP Servers - the MCP servers outside
 * OneUptime whose tools OneUptime AI may use - and a server's own page, in
 * real Chromium, with no backend: ExternalMcpServers/Fixture/server.js
 * bundles the production pages with the app's esbuild config, Tailwind,
 * theme and font, over in-memory servers whose creates, edits, switches,
 * deletes and tests it records. What jsdom cannot show is checked here: the
 * create dialog's steps and cards clicked through, the Test dialog that
 * opens once a server is added, a failed test and Test again, the status
 * pill's reason on hover, Test locked for whoever may not change a server,
 * the switch that asks before it turns a server off, a phone, dark mode
 * and German.
 */
const port: string = process.env["EXTERNAL_MCP_SERVERS_FIXTURE_PORT"] || "4397";

export default defineConfig({
  testDir: "./ExternalMcpServers",
  testMatch: ["ExternalMcpServers.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/external-mcp-servers-ui/test-results",
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
    command: "node ExternalMcpServers/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
