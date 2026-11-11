/*
 * Offline fixture server for the journey budgets (packages/E2E/Journeys):
 * the whole Dashboard - its own App, header, products menu, side menus and
 * every route - and the Admin Dashboard's Settings, each bundled from this
 * branch with the app's esbuild config, in the Community Edition, and drawn
 * with the Tailwind runtime, its reading-direction config, Theme.css and the
 * product's font. Only the data boundary is replaced (Fixture/Store.js): a
 * project made a minute ago, in memory. No app or API server, no database,
 * no sign-in, nothing from the network.
 *
 *   /dashboard/...   the Dashboard (Fixture/Dashboard.js)
 *   /admin/...       the Admin Dashboard (Fixture/Admin.js)
 *
 * ?billing=on draws the Dashboard as OneUptime Cloud draws it
 * (BILLING_ENABLED): the paging journey is a Cloud one.
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { createConfig } = require("../../../Common/UI/esbuild-config.js");
const {
  resolveEnterpriseBuild,
} = require("../../../Common/UI/esbuild-enterprise.js");
const esbuild = require("../../../Common/node_modules/esbuild");

const repository = path.resolve(__dirname, "../../../..");
const output = path.join(repository, "output/playwright/journeys-ui/fixture");
const port = Number(process.env.JOURNEYS_FIXTURE_PORT || 4831);

/*
 * The Community Edition always, whatever is checked out beside it: a budget
 * must count the same job on every machine, and the core jobs are the
 * Community Edition's.
 */
function build(name, frontend, pluginSpecifier, eeSubdir, internalSpecifier) {
  const frontendDir = path.join(repository, "packages/App/FeatureSet", frontend);
  const enterprise = resolveEnterpriseBuild({
    frontendDir,
    pluginSpecifier,
    eeSubdir,
    internalSpecifier,
    env: { ...process.env, ONEUPTIME_EDITION: "community" },
  });
  const config = createConfig({
    serviceName: `journeys-fixture-${name}`,
    publicPath: `/dist/${name}/`,
    entryPoint: path.join(__dirname, `${frontend === "Dashboard" ? "Dashboard" : "Admin"}.js`),
    outdir: path.join(output, name),
    additionalAlias: {
      ...enterprise.alias,
      // One copy of Common for the pages and the fixture.
      Common: path.join(repository, "packages/Common"),
      react: path.join(repository, "packages/Common/node_modules/react"),
      "react-dom": path.join(
        repository,
        "packages/Common/node_modules/react-dom",
      ),
    },
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
// Avatars load from /api/user/profile-picture/:userId: the blank picture.
const blankProfilePicture = path.join(
  repository,
  "packages/Common/UI/Images/users/blank-profile.svg",
);

/*
 * The head the Dashboard's views/index.ejs writes: the Tailwind runtime and
 * the reading-direction config after it, class-based dark mode, Inter as
 * @font-face and the `*` rule that draws every element in it. HOST is a
 * made-up domain: nothing is ever fetched from it, and the spec aborts any
 * request that leaves this server. The Admin Dashboard runs on self-hosted
 * installations, with billing off.
 */
function html(bundle, title) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><script>(function(){var query=new URLSearchParams(window.location.search);var billing=${bundle === "dashboard" ? 'query.get("billing")==="on"' : "false"};window.process={env:{HOST:"oneuptime.acme-commerce.example",HTTP_PROTOCOL:"https",BILLING_ENABLED:billing?"true":"false",IS_ENTERPRISE_EDITION:"false",VERSION:"14.0.108",NODE_ENV:"development"}};window.global=window;try{window.localStorage.setItem("oneuptime-dashboard-theme","light");}catch(e){}})();</script><script src="/tailwind.js"></script><script src="/tailwind-reading-direction.js"></script><script>tailwind.config={darkMode:"class",theme:{extend:{fontFamily:{display:["Inter","sans-serif"],body:["Inter","sans-serif"]}}}};</script><style>@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:block;src:url('/fonts/InterVariable.woff2') format('woff2');}html,body{margin:0;background-color:#f9fafb}*{box-sizing:border-box;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}</style></head><body class="h-full bg-gray-50"><div id="root"></div><script type="module" src="/dist/${bundle}/${bundle === "dashboard" ? "Dashboard" : "Admin"}.js"></script></body></html>`;
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
        "dashboard",
        "Dashboard",
        "@oneuptime/ee-dashboard",
        "Dashboard",
        "@oneuptime/dashboard",
      ),
    ),
    esbuild.build(
      build(
        "admin",
        "AdminDashboard",
        "@oneuptime/ee-admin-dashboard",
        "AdminDashboard",
        "@oneuptime/admin-dashboard",
      ),
    ),
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
    if (url.pathname.includes("/user/profile-picture/")) {
      serveFile(response, blankProfilePicture, "image/svg+xml");
      return;
    }
    if (url.pathname === "/favicon.ico") {
      response.writeHead(204).end();
      return;
    }
    response.setHeader("Content-Type", "text/html");
    response.end(
      url.pathname.startsWith("/admin")
        ? html("admin", "Journeys: Admin Dashboard")
        : html("dashboard", "Journeys: Dashboard"),
    );
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(
      `Journeys fixture ready at http://127.0.0.1:${port}/dashboard/10000000-0000-4000-8000-000000006831/home/`,
    );
  });
  process.on("SIGTERM", () => server.close());
  process.on("SIGINT", () => server.close());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
