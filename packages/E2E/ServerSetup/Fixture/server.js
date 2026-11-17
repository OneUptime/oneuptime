/*
 * Offline fixture server for Server setup (#7027): the Admin Dashboard's
 * Server setup page and its Settings > Emails and Settings > Call and SMS,
 * and the Dashboard's "This server is not finished" card, each bundled from
 * this branch with the app's esbuild config, in the Community Edition, and
 * drawn with the Tailwind runtime, its reading-direction config, Theme.css
 * and the product's font. Only the data boundary is replaced
 * (Fixture/Checklist.js): the server's answers, in memory. No app or API
 * server, no database, no sign-in, nothing from the network.
 *
 *   /admin/...       the Admin Dashboard's pages (Fixture/Admin.js)
 *   /dashboard/...   the Dashboard's card (Fixture/Card.js)
 *
 * ?theme=dark draws a page as its frontend does in dark mode: the class on
 * <html> that Theme.css and Tailwind's dark: variants read.
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { createConfig } = require("../../../Common/UI/esbuild-config.js");
const {
  resolveEnterpriseBuild,
} = require("../../../Common/UI/esbuild-enterprise.js");
const {
  dashboardLocalesPlugin,
} = require("../../SuiteHelpers/FixtureLocalesBuild.js");
const esbuild = require("../../../Common/node_modules/esbuild");

const repository = path.resolve(__dirname, "../../../..");
const output = path.join(
  repository,
  "output/playwright/server-setup-ui/fixture",
);
const port = Number(process.env.SERVER_SETUP_FIXTURE_PORT || 4726);

/*
 * The Community Edition always: Server setup is the self-hosted server's,
 * and a run must draw the same pages on every machine.
 */
function build(name, frontend, entry, pluginSpecifier, internalSpecifier) {
  const frontendDir = path.join(
    repository,
    "packages/App/FeatureSet",
    frontend,
  );
  const enterprise = resolveEnterpriseBuild({
    frontendDir,
    pluginSpecifier,
    eeSubdir: frontend,
    internalSpecifier,
    env: { ...process.env, ONEUPTIME_EDITION: "community" },
  });
  const config = createConfig({
    serviceName: `server-setup-fixture-${name}`,
    publicPath: `/dist/${name}/`,
    entryPoint: path.join(__dirname, entry),
    outdir: path.join(output, name),
    additionalAlias: {
      ...enterprise.alias,
      // One copy of Common for the pages and the fixture.
      Common: path.join(repository, "packages/Common"),
      /*
       * The Admin Dashboard's own i18n detects the reader's language with
       * this package. CI installs the Dashboard's packages for the offline
       * suites, not the Admin Dashboard's, and both name the same one.
       */
      "i18next-browser-languagedetector": path.join(
        repository,
        "packages/App/FeatureSet/Dashboard/node_modules/i18next-browser-languagedetector",
      ),
      react: path.join(repository, "packages/Common/node_modules/react"),
      "react-dom": path.join(
        repository,
        "packages/Common/node_modules/react-dom",
      ),
    },
    // The Dashboard's locales as its own build ships them (#8366).
    additionalPlugins: name === "dashboard" ? [dashboardLocalesPlugin()] : [],
  });
  config.target = "es2022";
  config.loader[".js"] = "jsx";
  config.sourcemap = false;
  config.minify = false;
  config.logLevel = "warning";
  config.nodePaths = [path.join(repository, "packages/Common/node_modules")];
  return config;
}

const tailwind = path.join(
  repository,
  "packages/Common/Server/Static/Vendor/tailwind/tailwind-3.4.5.js",
);
// What every index.ejs loads right after the runtime.
const readingDirection = path.join(
  repository,
  "packages/Common/UI/Styles/TailwindReadingDirection.js",
);
// The product's own font, so every page is drawn as production draws it.
const font = path.join(
  repository,
  "packages/Common/Server/Static/Vendor/fonts/InterVariable.woff2",
);

/*
 * What the page is told before its bundle runs: a self-hosted server, with
 * billing off, and the theme the query string asks for. HOST is a made-up
 * domain: nothing is ever fetched from it.
 */
const BOOT = `(function () {
  var dark = new URLSearchParams(window.location.search).get("theme") === "dark";
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  try { window.localStorage.setItem("oneuptime-dashboard-theme", dark ? "dark" : "light"); } catch (e) {}
  window.process = { env: { HOST: "oneuptime.acme-commerce.example", HTTP_PROTOCOL: "http", BILLING_ENABLED: "false", IS_ENTERPRISE_EDITION: "false", VERSION: "16.0.0", NODE_ENV: "development" } };
  window.global = window;
})();`;

/*
 * The head the frontends' views/index.ejs write: the Tailwind runtime and
 * the reading-direction config after it, class-based dark mode, Inter as
 * @font-face and the `*` rule that draws every element in it.
 */
function html(bundle, entry, title) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><script>${BOOT}</script><script src="/tailwind.js"></script><script src="/tailwind-reading-direction.js"></script><script>tailwind.config={darkMode:"class",theme:{extend:{fontFamily:{display:["Inter","sans-serif"],body:["Inter","sans-serif"]}}}};</script><style>@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:block;src:url('/fonts/InterVariable.woff2') format('woff2');}html,body{margin:0;background-color:#f9fafb}html.dark,html.dark body{background-color:#0f172a}*{box-sizing:border-box;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}</style></head><body class="h-full bg-gray-50"><div id="root"></div><script type="module" src="/dist/${bundle}/${entry}.js"></script></body></html>`;
}

function serveFile(response, file, contentType) {
  response.setHeader("Content-Type", contentType);
  fs.createReadStream(file).pipe(response);
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  await Promise.all([
    esbuild.build(
      build(
        "admin",
        "AdminDashboard",
        "Admin.js",
        "@oneuptime/ee-admin-dashboard",
        "@oneuptime/admin-dashboard",
      ),
    ),
    esbuild.build(
      build(
        "dashboard",
        "Dashboard",
        "Card.js",
        "@oneuptime/ee-dashboard",
        "@oneuptime/dashboard",
      ),
    ),
  ]);

  const server = http.createServer((request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader(
      "Content-Security-Policy",
      "connect-src 'self'; font-src 'self' data:;",
    );
    if (url.pathname === "/ready.json") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ready: true }));
      return;
    }
    if (url.pathname === "/tailwind.js") {
      serveFile(response, tailwind, "application/javascript");
      return;
    }
    if (url.pathname === "/tailwind-reading-direction.js") {
      serveFile(response, readingDirection, "application/javascript");
      return;
    }
    if (url.pathname === "/fonts/InterVariable.woff2") {
      serveFile(response, font, "font/woff2");
      return;
    }
    if (url.pathname.startsWith("/dist/")) {
      const file = path.resolve(output, url.pathname.slice(6));
      if (!file.startsWith(output + path.sep) || !fs.existsSync(file)) {
        response.writeHead(404).end();
        return;
      }
      serveFile(
        response,
        file,
        file.endsWith(".css") ? "text/css" : "application/javascript",
      );
      return;
    }
    if (url.pathname === "/favicon.ico") {
      response.writeHead(204).end();
      return;
    }
    response.setHeader("Content-Type", "text/html");
    response.end(
      url.pathname.startsWith("/dashboard")
        ? html("dashboard", "Card", "Server setup: Dashboard")
        : html("admin", "Admin", "Server setup: Admin Dashboard"),
    );
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(
      `Server setup fixture ready at http://127.0.0.1:${port}/admin/setup`,
    );
  });
  process.on("SIGTERM", () => server.close());
  process.on("SIGINT", () => server.close());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
