/*
 * Offline fixture server for asking people (#6832, #7362): the questions
 * OneUptime asks in the Dashboard (Fixture/Questions.js) and Admin
 * Dashboard > Feedback (Fixture/AdminFeedback.js), each bundled from this
 * branch with the app's esbuild config and drawn with the Tailwind runtime,
 * its reading-direction config, Theme.css and the product's font. Only the
 * data boundary is replaced. No app or API server, no database, no sign-in,
 * nothing from the network.
 *
 *   /dashboard/<project>/setup   the Dashboard's questions (?view=)
 *   /admin/feedback              the Admin Dashboard's Feedback page
 *
 * ?cloud=1 is OneUptime Cloud (billing on); every other page is a
 * self-hosted server's. ?theme=dark draws the dark theme.
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
  "output/playwright/feedback-questions-ui/fixture",
);
const port = Number(process.env.FEEDBACK_QUESTIONS_FIXTURE_PORT || 4799);

const sharedAliases = {
  Common: path.join(repository, "packages/Common"),
  react: path.join(repository, "packages/Common/node_modules/react"),
  "react-dom": path.join(repository, "packages/Common/node_modules/react-dom"),
};

function finish(config) {
  config.target = "es2022";
  config.loader[".js"] = "jsx";
  config.sourcemap = false;
  config.minify = false;
  config.logLevel = "warning";
  return config;
}

// The Dashboard's questions, with its locales as its own build ships them.
function dashboardBuild() {
  const config = createConfig({
    serviceName: "feedback-questions-fixture",
    publicPath: "/dist/dashboard/",
    entryPoint: path.join(__dirname, "Questions.js"),
    outdir: path.join(output, "dashboard"),
    additionalAlias: sharedAliases,
    additionalPlugins: [dashboardLocalesPlugin()],
  });
  config.nodePaths = [
    path.join(repository, "packages/Common/node_modules"),
    path.join(repository, "packages/App/node_modules"),
  ];
  return finish(config);
}

/*
 * The Admin Dashboard's Feedback page, in the Community Edition always: the
 * page a self-hosted server shows, the same on every machine.
 */
function adminBuild() {
  const enterprise = resolveEnterpriseBuild({
    frontendDir: path.join(
      repository,
      "packages/App/FeatureSet/AdminDashboard",
    ),
    pluginSpecifier: "@oneuptime/ee-admin-dashboard",
    eeSubdir: "AdminDashboard",
    internalSpecifier: "@oneuptime/admin-dashboard",
    env: { ...process.env, ONEUPTIME_EDITION: "community" },
  });
  const config = createConfig({
    serviceName: "admin-feedback-fixture",
    publicPath: "/dist/admin/",
    entryPoint: path.join(__dirname, "AdminFeedback.js"),
    outdir: path.join(output, "admin"),
    additionalAlias: {
      ...enterprise.alias,
      ...sharedAliases,
      /*
       * The Admin Dashboard's own i18n detects the reader's language with
       * this package. CI installs the Dashboard's packages for the offline
       * suites, not the Admin Dashboard's, and both name the same one.
       */
      "i18next-browser-languagedetector": path.join(
        repository,
        "packages/App/FeatureSet/Dashboard/node_modules/i18next-browser-languagedetector",
      ),
    },
  });
  config.nodePaths = [path.join(repository, "packages/Common/node_modules")];
  return finish(config);
}

const tailwind = path.join(
  repository,
  "packages/Common/Server/Static/Vendor/tailwind/tailwind-3.4.5.js",
);
const readingDirection = path.join(
  repository,
  "packages/Common/UI/Styles/TailwindReadingDirection.js",
);
const theme = path.join(repository, "packages/Common/UI/Styles/Theme.css");
const font = path.join(
  repository,
  "packages/Common/Server/Static/Vendor/fonts/InterVariable.woff2",
);

/*
 * What a page is told before its bundle runs. HOST is a made-up domain:
 * nothing is ever fetched from it. The version is APP_VERSION, as env.js
 * serves it.
 */
function bootFor(search) {
  const params = new URLSearchParams(search);
  const environment = {
    HOST: "oneuptime.acme-commerce.example",
    HTTP_PROTOCOL: "https",
    BILLING_ENABLED: params.get("cloud") === "1" ? "true" : "false",
    IS_ENTERPRISE_EDITION: "false",
    APP_VERSION: "16.0.0",
    VERSION: "16.0.0",
    NODE_ENV: "development",
  };

  return `(function () {
  var dark = new URLSearchParams(window.location.search).get("theme") === "dark";
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  try { window.localStorage.setItem("oneuptime-dashboard-theme", dark ? "dark" : "light"); } catch (e) {}
  window.process = { env: ${JSON.stringify(environment)} };
  window.global = window;
})();`;
}

const tailwindConfig = `tailwind.config={darkMode:"class",theme:{extend:{fontFamily:{display:["Inter","sans-serif"],body:["Inter","sans-serif"]}}}};`;

function htmlFor(url) {
  const isAdmin = url.pathname.startsWith("/admin");
  const bundle = isAdmin
    ? "/dist/admin/AdminFeedback.js"
    : "/dist/dashboard/Questions.js";
  // The Dashboard's Theme.css comes from src/Index.tsx; the Admin bundle imports it.
  const themeLink = isAdmin ? "" : '<link rel="stylesheet" href="/theme.css">';

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Asking people preview</title><script>${bootFor(url.search)}</script><script src="/tailwind.js"></script><script src="/tailwind-reading-direction.js"></script><script>${tailwindConfig}</script><style>@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:block;src:url('/fonts/InterVariable.woff2') format('woff2');}html,body{margin:0;background-color:#f9fafb}html.dark,html.dark body{background-color:#0f172a}*{box-sizing:border-box;font-family:Inter,ui-sans-serif,system-ui,sans-serif}</style>${themeLink}</head><body class="h-full bg-gray-50"><div id="root"></div><script type="module" src="${bundle}"></script></body></html>`;
}

function serveFile(response, file, contentType) {
  response.setHeader("Content-Type", contentType);
  fs.createReadStream(file).pipe(response);
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  await Promise.all([
    esbuild.build(dashboardBuild()),
    esbuild.build(adminBuild()),
  ]);

  if (process.argv.includes("--build-only")) {
    return;
  }

  const server = http.createServer((request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader(
      "Content-Security-Policy",
      "connect-src 'self'; font-src 'self' data:;",
    );
    if (url.pathname === "/tailwind.js") {
      serveFile(response, tailwind, "application/javascript");
      return;
    }
    if (url.pathname === "/tailwind-reading-direction.js") {
      serveFile(response, readingDirection, "application/javascript");
      return;
    }
    if (url.pathname === "/theme.css") {
      serveFile(response, theme, "text/css");
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
    response.end(htmlFor(url));
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(
      `Asking people fixture ready at http://127.0.0.1:${port}/dashboard/10000000-0000-4000-8000-000000007362/setup and /admin/feedback`,
    );
  });
  process.on("SIGTERM", () => server.close());
  process.on("SIGINT", () => server.close());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
