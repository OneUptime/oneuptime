import { defineConfig } from "@playwright/test";
import path from "path";

/*
 * Lighthouse on the marketing site, the docs and the API reference
 * (Lighthouse/): accessibility, best practices and SEO, on a phone and on a
 * laptop, against what Lighthouse/Baseline.json recorded. Both services run
 * from this checkout with no datastore, behind a proxy that routes their
 * paths as oneuptime.com does. Ports: LIGHTHOUSE_PORT (4800) for the proxy,
 * LIGHTHOUSE_HOME_PORT (4801) and LIGHTHOUSE_DOCS_PORT (4802) for the
 * services, or others for a second copy running at the same time.
 *
 * The services need their packages installed (Common, Home, App), the
 * stylesheets built as the images build them (npm run build:css in
 * packages/Home, npm run build-docs-css in packages/App) and the docs'
 * mermaid built (node packages/Common/Scripts/build-mermaid-browser.js):
 * Lighthouse/README.md.
 */
const port: string = process.env["LIGHTHOUSE_PORT"] || "4800";
const homePort: string = process.env["LIGHTHOUSE_HOME_PORT"] || "4801";
const docsPort: string = process.env["LIGHTHOUSE_DOCS_PORT"] || "4802";

// As the images run them: TypeScript transpiled, not type-checked.
const tsNode: string = "node -r ts-node/register/transpile-only";

/*
 * As oneuptime.com: its robots.txt lets crawlers in only there (any other
 * host is told to keep out, which would fail every page's is-crawlable),
 * and the canonical and hreflang links name it.
 */
const asOneUptimeCom: Record<string, string> = {
  HOST: "oneuptime.com",
  HTTP_PROTOCOL: "https",
};

export default defineConfig({
  testDir: "./Lighthouse",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  // A scan takes ten to twenty seconds; a slow runner gets room.
  timeout: 180000,
  expect: { timeout: 15000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "../../output/playwright/lighthouse/test-results",
  globalSetup: "./Lighthouse/GlobalSetup.ts",
  globalTeardown: "./Lighthouse/GlobalTeardown.ts",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
  },
  webServer: [
    {
      // The marketing site, with the fixture blog (Home/Scripts/CheckoutPaths.ts).
      command: `${tsNode} -r ./Scripts/CheckoutPaths.ts Index.ts`,
      cwd: path.resolve(__dirname, "../Home"),
      // Mounted after the status routes: up means every page is.
      url: `http://127.0.0.1:${homePort}/robots.txt`,
      env: {
        ...asOneUptimeCom,
        PORT: homePort,
        BLOG_ROOT: path.resolve(__dirname, "Lighthouse/Blog"),
      },
      timeout: 300000,
      reuseExistingServer: false,
    },
    {
      // The docs and the API reference (App/scripts/serve-docs-and-reference.ts).
      command: `${tsNode} -r ./scripts/checkout-paths.ts scripts/serve-docs-and-reference.ts`,
      cwd: path.resolve(__dirname, "../App"),
      // The reference is mounted last.
      url: `http://127.0.0.1:${docsPort}/reference/en/introduction`,
      env: { ...asOneUptimeCom, PORT: docsPort },
      timeout: 300000,
      reuseExistingServer: false,
    },
    {
      command: "node Lighthouse/Proxy.js",
      cwd: path.resolve(__dirname),
      url: `http://127.0.0.1:${port}/robots.txt`,
      env: {
        LIGHTHOUSE_PORT: port,
        LIGHTHOUSE_HOME_PORT: homePort,
        LIGHTHOUSE_DOCS_PORT: docsPort,
      },
      timeout: 300000,
      reuseExistingServer: false,
    },
  ],
});
