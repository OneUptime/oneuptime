/*
 * Offline fixture server for Admin Dashboard > Settings > Backups. No app
 * or API server needed: Fixture.js renders the production page over
 * in-memory backup settings and runs.
 *
 * The page ships in the Enterprise Edition. The Admin Dashboard reaches it
 * through its plugin specifier, and this server resolves that specifier the
 * way the Admin Dashboard's own build does (Common/UI/esbuild-enterprise.js),
 * twice:
 *
 *   /admin/settings/backups            the Enterprise Edition, when ee/ is
 *                                      checked out (the Community Edition
 *                                      otherwise);
 *   /community/admin/settings/backups  the Community Edition always, as
 *                                      ONEUPTIME_EDITION=community builds it.
 *
 * /edition.json says which edition the first one is, so the specs that need
 * the page skip where ee/ is not there.
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
const output = path.join(repository, "output/playwright/backups-ui/fixture");
const port = Number(process.env.BACKUPS_FIXTURE_PORT || 4591);
const frontendDir = path.join(
  repository,
  "packages/App/FeatureSet/AdminDashboard",
);

function build(edition) {
  const enterprise = resolveEnterpriseBuild({
    frontendDir,
    pluginSpecifier: "@oneuptime/ee-admin-dashboard",
    eeSubdir: "AdminDashboard",
    internalSpecifier: "@oneuptime/admin-dashboard",
    env:
      edition === "community"
        ? { ...process.env, ONEUPTIME_EDITION: "community" }
        : process.env,
  });
  const outdir = path.join(output, edition);
  const config = createConfig({
    serviceName: `backups-fixture-${edition}`,
    publicPath: `/dist/${edition}/`,
    entryPoint: path.join(__dirname, "Fixture.js"),
    outdir,
    additionalAlias: {
      ...enterprise.alias,
      // One copy of Common for the page, the Enterprise screens and the fixture.
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
  return { edition: enterprise.edition, outdir, config };
}

const tailwind = path.join(
  repository,
  "packages/Common/Server/Static/Vendor/tailwind/tailwind-3.4.5.js",
);
/*
 * What every index.ejs loads right after the runtime: left and right follow
 * the page's reading direction, so a Persian page (dir="rtl", set by the
 * frontend's i18n) is laid out as production lays it out.
 */
const readingDirection = path.join(
  repository,
  "packages/Common/UI/Styles/TailwindReadingDirection.js",
);
// The Admin Dashboard's own font, so the page is measured as it is drawn.
const font = path.join(
  repository,
  "packages/Common/Server/Static/Vendor/fonts/InterVariable.woff2",
);

/*
 * ?theme=dark draws the page as the Admin Dashboard does in dark mode: the
 * class on <html> that Theme.css and Tailwind's dark: variants read. The
 * Admin Dashboard runs on self-hosted installations, with billing off.
 */
function html(bundle) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Backups preview</title><script>window.process={env:{HOST:"localhost",HTTP_PROTOCOL:"http",BILLING_ENABLED:"false",VERSION:"14.0.88",NODE_ENV:"development"}};window.global=window;(function(){var dark=new URLSearchParams(window.location.search).get("theme")==="dark";document.documentElement.classList.toggle("dark",dark);document.documentElement.style.colorScheme=dark?"dark":"light";try{window.localStorage.setItem("oneuptime-dashboard-theme",dark?"dark":"light");}catch(e){}})();</script><script src="/tailwind.js"></script><script src="/tailwind-reading-direction.js"></script><script>tailwind.config={darkMode:"class",theme:{extend:{fontFamily:{display:["Inter","sans-serif"],body:["Inter","sans-serif"]}}}};</script><style>@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:block;src:url('/fonts/InterVariable.woff2') format('woff2');}html,body{margin:0;background:#f9fafb}html.dark,html.dark body{background:#0f172a}*{box-sizing:border-box;font-family:Inter,ui-sans-serif,system-ui,sans-serif}</style></head><body><div id="root"></div><script type="module" src="/dist/${bundle}/Fixture.js"></script></body></html>`;
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const builds = [build("auto"), build("community")];
  for (const one of builds) {
    await esbuild.build(one.config);
  }
  const edition = builds[0].edition;

  const server = http.createServer((request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader(
      "Content-Security-Policy",
      "connect-src 'self'; font-src 'self' data:;",
    );
    if (url.pathname === "/edition.json") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ edition }));
      return;
    }
    if (url.pathname === "/tailwind.js") {
      response.setHeader("Content-Type", "application/javascript");
      fs.createReadStream(tailwind).pipe(response);
      return;
    }
    if (url.pathname === "/tailwind-reading-direction.js") {
      response.setHeader("Content-Type", "application/javascript");
      fs.createReadStream(readingDirection).pipe(response);
      return;
    }
    if (url.pathname === "/fonts/InterVariable.woff2") {
      response.setHeader("Content-Type", "font/woff2");
      fs.createReadStream(font).pipe(response);
      return;
    }
    if (url.pathname.startsWith("/dist/")) {
      const file = path.resolve(output, url.pathname.slice(6));
      if (!file.startsWith(output + path.sep) || !fs.existsSync(file)) {
        response.writeHead(404).end();
        return;
      }
      response.setHeader(
        "Content-Type",
        file.endsWith(".css") ? "text/css" : "application/javascript",
      );
      fs.createReadStream(file).pipe(response);
      return;
    }
    response.setHeader("Content-Type", "text/html");
    response.end(
      html(url.pathname.startsWith("/community/") ? "community" : "auto"),
    );
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(
      `Backups fixture (${edition}) ready at http://127.0.0.1:${port}/admin/settings/backups`,
    );
  });
  process.on("SIGTERM", () => server.close());
  process.on("SIGINT", () => server.close());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
