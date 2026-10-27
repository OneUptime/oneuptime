/*
 * Offline fixture server for dashboard playlists (issue #5235), with no
 * app, database or Docker stack:
 *
 *   /dashboard/<project>/dashboards/playlists[/<id>[/play]]
 *       the Playlists list, a playlist's page and the player - the real
 *       Dashboards routes (AppFixture.js), drawn with the Dashboard's
 *       Tailwind, theme and font
 *
 * Bundled with the app's esbuild config. ?theme=dark draws them in the
 * Dashboard's dark theme.
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { createConfig } = require("../../../Common/UI/esbuild-config.js");
const esbuild = require("../../../Common/node_modules/esbuild");

const repository = path.resolve(__dirname, "../../../..");
const common = path.join(repository, "packages/Common");
const dashboard = path.join(repository, "packages/App/FeatureSet/Dashboard");
const output =
  process.env.DASHBOARD_PLAYLISTS_FIXTURE_OUTPUT ||
  path.join(repository, "output/playwright/dashboard-playlists-ui/fixture");
const port = Number(process.env.DASHBOARD_PLAYLISTS_FIXTURE_PORT || 4535);

const tailwind = path.join(
  common,
  "Server/Static/Vendor/tailwind/tailwind-3.4.5.js",
);
/*
 * What every index.ejs loads right after the runtime: left and right follow
 * the page's reading direction, so a Persian page (dir="rtl") is laid out as
 * production lays it out.
 */
const readingDirection = path.join(
  common,
  "UI/Styles/TailwindReadingDirection.js",
);
const inter = path.join(
  common,
  "Server/Static/Vendor/fonts/InterVariable.woff2",
);

const config = createConfig({
  serviceName: "dashboard-playlists-app-fixture",
  publicPath: "/app/",
  entryPoint: path.join(__dirname, "AppFixture.js"),
  outdir: path.join(output, "app"),
  additionalAlias: {
    Common: common,
    react: path.join(common, "node_modules/react"),
    "react-dom": path.join(common, "node_modules/react-dom"),
  },
});
config.target = "es2022";
config.loader[".js"] = "jsx";
config.sourcemap = false;
config.minify = false;
config.logLevel = "warning";
config.nodePaths = [
  path.join(common, "node_modules"),
  path.join(dashboard, "node_modules"),
];

/*
 * The head the Dashboard's views/index.ejs writes: Inter as @font-face, the
 * `*` rule that draws every element in it, and the same tailwind.config
 * (class-based dark mode). ?theme=dark adds the class on <html> that
 * Theme.css reads, as the Dashboard does in dark mode.
 */
const appHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dashboard playlists preview</title><script>var q=new URLSearchParams(window.location.search);window.process={env:{HOST:"oneuptime.acme-commerce.example",HTTP_PROTOCOL:"https",BILLING_ENABLED:"false",VERSION:"1.0.0",NODE_ENV:"development"}};window.global=window;if(q.get("theme")==="dark"){document.documentElement.classList.add("dark");}</script><script src="/tailwind.js"></script><script src="/tailwind-reading-direction.js"></script><script>tailwind.config={darkMode:"class",theme:{extend:{fontFamily:{display:["Inter","sans-serif"],body:["Inter","sans-serif"]}}}};</script><style>@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:block;src:url('/fonts/InterVariable.woff2') format('woff2');}html,body{margin:0;background-color:#f9fafb}html.dark,html.dark body{background-color:#0f172a}*{box-sizing:border-box;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}</style></head><body class="h-full bg-gray-50"><div id="root"></div><script type="module" src="/app/AppFixture.js"></script></body></html>`;

const send = (response, file, type) => {
  response.setHeader("Content-Type", type);
  fs.createReadStream(file).pipe(response);
};

// A file of the bundle, or null when the path leaves its folder.
const bundleFile = (relative) => {
  const folder = path.join(output, "app");
  const file = path.resolve(folder, relative);

  if (!file.startsWith(folder + path.sep) || !fs.existsSync(file)) {
    return null;
  }

  return file;
};

async function main() {
  fs.mkdirSync(output, { recursive: true });
  await esbuild.build(config);

  if (process.argv.includes("--build-only")) {
    return;
  }

  const server = http.createServer((request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    response.setHeader("Cache-Control", "no-store");

    if (url.pathname === "/ready") {
      response.end("ready");
      return;
    }

    if (url.pathname === "/tailwind.js") {
      send(response, tailwind, "application/javascript");
      return;
    }

    if (url.pathname === "/tailwind-reading-direction.js") {
      send(response, readingDirection, "application/javascript");
      return;
    }

    if (url.pathname === "/fonts/InterVariable.woff2") {
      send(response, inter, "font/woff2");
      return;
    }

    if (url.pathname.startsWith("/app/")) {
      const file = bundleFile(url.pathname.slice("/app/".length));

      if (!file) {
        response.writeHead(404).end();
        return;
      }

      send(
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

    // Nothing the pages ask an API for over HTTP: the fixture answers it in the page.
    if (url.pathname.startsWith("/api/")) {
      response.writeHead(404).end();
      return;
    }

    response.setHeader("Content-Type", "text/html");
    response.end(appHtml);
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(
      `Dashboard playlists fixture ready at http://127.0.0.1:${port}/dashboard/10000000-0000-4000-8000-0000000000e1/dashboards/playlists`,
    );
  });
  process.on("SIGTERM", () => {
    return server.close();
  });
  process.on("SIGINT", () => {
    return server.close();
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
