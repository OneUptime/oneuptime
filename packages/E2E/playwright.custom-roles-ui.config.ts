import { defineConfig, devices } from "@playwright/test";
import path from "path";

/*
 * Custom roles on the real Teams pages - Teams > Settings > Roles, a role's
 * own page, a team's Permissions page and Create Team - in real Chromium,
 * with no backend: CustomRoles/Fixture/server.js bundles the production
 * pages with the app's esbuild config, Tailwind, theme and font, over an
 * in-memory project whose writes it records and answers as the services do.
 * What jsdom cannot show is checked here: the dialogs and pickers as they
 * are drawn, long names wrapping inside their cards, a phone's width, dark
 * mode. AddRoleDialog.spec.ts holds the Add a Role dialog itself - its role
 * picker under the keyboard, on a phone, dark and in German.
 * ApiKeyCustomRoles.spec.ts holds custom roles on API keys: a key's page,
 * Create API Key and the keys a role is given to, at 1280 and 390 pixels.
 */
const port: string = process.env["CUSTOM_ROLES_FIXTURE_PORT"] || "4313";

export default defineConfig({
  testDir: "./CustomRoles",
  testMatch: [
    "CustomRoles.spec.ts",
    "AddRoleDialog.spec.ts",
    "ApiKeyCustomRoles.spec.ts",
  ],
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/custom-roles-ui/test-results",
  // A project's `use` wins over the top-level one, so the viewport goes here.
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    timezoneId: "UTC",
    locale: "en-US",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node CustomRoles/Fixture/server.js",
    cwd: path.resolve(__dirname),
    url: `http://127.0.0.1:${port}`,
    timeout: 300000,
    reuseExistingServer: false,
  },
});
