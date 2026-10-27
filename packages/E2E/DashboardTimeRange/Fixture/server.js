/*
 * Offline fixture server for a dashboard's time range and auto-refresh
 * (issue #5080), on both of its surfaces, with no app, database or Docker
 * stack:
 *
 *   /dashboard/<project>/dashboards/<id>   the dashboard inside OneUptime:
 *       the real view layout and Dashboard page (AppFixture.js), drawn with
 *       the Dashboard's Tailwind, theme and font
 *   /public-dashboard/<id>                 the public dashboard: its own
 *       index.ejs, rendered as its servers render it, and its own app
 *       (Public/Index.js), the public API answered in the page
 *
 * Both are bundled with the app's esbuild config. Which dashboard a page
 * shows is its id (Boards.js). ?theme=dark draws the dashboard inside
 * OneUptime in its dark theme.
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { createConfig } = require("../../../Common/UI/esbuild-config.js");
const esbuild = require("../../../Common/node_modules/esbuild");
const ejs = require("../../../Common/node_modules/ejs");

const repository = path.resolve(__dirname, "../../../..");
const common = path.join(repository, "packages/Common");
const publicDashboard = path.join(
  repository,
  "packages/App/FeatureSet/PublicDashboard",
);
const dashboard = path.join(repository, "packages/App/FeatureSet/Dashboard");
const output =
  process.env.DASHBOARD_TIME_RANGE_FIXTURE_OUTPUT ||
  path.join(repository, "output/playwright/dashboard-time-range-ui/fixture");
const port = Number(process.env.DASHBOARD_TIME_RANGE_FIXTURE_PORT || 4371);

const template = path.join(publicDashboard, "views/index.ejs");
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

const configFor = (data) => {
  const config = createConfig({
    serviceName: data.serviceName,
    publicPath: data.publicPath,
    entryPoint: data.entryPoint,
    outdir: data.outdir,
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
    path.join(publicDashboard, "node_modules"),
    path.join(dashboard, "node_modules"),
  ];
  return config;
};

// The dashboard inside OneUptime.
const appConfig = configFor({
  serviceName: "dashboard-time-range-app-fixture",
  publicPath: "/app/",
  entryPoint: path.join(__dirname, "AppFixture.js"),
  outdir: path.join(output, "app"),
});

// The public dashboard: Index.js, which the template's own script loads.
const publicConfig = configFor({
  serviceName: "dashboard-time-range-public-fixture",
  publicPath: "/public-dashboard/dist/",
  entryPoint: path.join(__dirname, "Public", "Index.js"),
  outdir: path.join(output, "public"),
});

/*
 * The head the Dashboard's views/index.ejs writes: Inter as @font-face, the
 * `*` rule that draws every element in it, and the same tailwind.config
 * (class-based dark mode). ?theme=dark adds the class on <html> that
 * Theme.css reads, as the Dashboard does in dark mode.
 */
const appHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dashboard time range preview</title><script>var q=new URLSearchParams(window.location.search);window.process={env:{HOST:"oneuptime.acme-commerce.example",HTTP_PROTOCOL:"https",BILLING_ENABLED:"false",VERSION:"1.0.0",NODE_ENV:"development"}};window.global=window;if(q.get("theme")==="dark"){document.documentElement.classList.add("dark");}</script><script src="/tailwind.js"></script><script src="/tailwind-reading-direction.js"></script><script>tailwind.config={darkMode:"class",theme:{extend:{fontFamily:{display:["Inter","sans-serif"],body:["Inter","sans-serif"]}}}};</script><style>@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:block;src:url('/fonts/InterVariable.woff2') format('woff2');}html,body{margin:0;background-color:#f9fafb}html.dark,html.dark body{background-color:#0f172a}*{box-sizing:border-box;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}</style></head><body class="h-full bg-gray-50"><div id="root"></div><script type="module" src="/app/AppFixture.js"></script></body></html>`;

/*
 * What the public dashboard's page server would put in env.js. HOST is this
 * server, so the app's API (/public-dashboard-api) is asked here - and
 * answered in the page, by PublicFixture.js.
 */
const environment = {
  HOST: `127.0.0.1:${port}`,
  HTTP_PROTOCOL: "http",
  BILLING_ENABLED: "false",
  IS_ENTERPRISE_EDITION: "false",
  VERSION: "1.0.0",
  NODE_ENV: "development",
};

let themeModule = null;

const loadNodeModule = async (entry, name) => {
  const file = path.join(output, `${name}.cjs`);
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: file,
    logLevel: "warning",
  });
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(file);
};

// The public page, as its servers render index.ejs for a Light dashboard.
const renderPublic = () => {
  return ejs.render(
    fs.readFileSync(template, "utf8"),
    {
      title: "Dashboard",
      description: "Requests, latency and errors across the fleet",
      dashboardTheme: themeModule.getDashboardThemeHead(
        themeModule.parseDashboardTheme("Light"),
      ),
    },
    { filename: template },
  );
};

const send = (response, file, type) => {
  response.setHeader("Content-Type", type);
  fs.createReadStream(file).pipe(response);
};

// A file of a bundle, or null when the path leaves its folder.
const bundleFile = (folder, relative) => {
  const file = path.resolve(output, folder, relative);

  if (
    !file.startsWith(path.join(output, folder) + path.sep) ||
    !fs.existsSync(file)
  ) {
    return null;
  }

  return file;
};

async function main() {
  fs.mkdirSync(output, { recursive: true });
  themeModule = await loadNodeModule(
    path.join(common, "Types/Dashboard/DashboardTheme.ts"),
    "theme-module",
  );
  await Promise.all([esbuild.build(appConfig), esbuild.build(publicConfig)]);

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
      const file = bundleFile("app", url.pathname.slice("/app/".length));

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

    if (url.pathname === "/public-dashboard/env.js") {
      response.setHeader("Content-Type", "application/javascript");
      response.end(`window.process = { env: ${JSON.stringify(environment)} };`);
      return;
    }

    if (url.pathname === "/public-dashboard/assets/js/tailwind-3.4.5.js") {
      send(response, tailwind, "application/javascript");
      return;
    }

    if (url.pathname === "/public-dashboard/assets/fonts/InterVariable.woff2") {
      send(response, inter, "font/woff2");
      return;
    }

    if (url.pathname.startsWith("/public-dashboard/dist/")) {
      const file = bundleFile(
        "public",
        url.pathname.slice("/public-dashboard/dist/".length),
      );

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

    /*
     * Nothing the pages ask an API for over HTTP: the fixtures answer it in
     * the page, and record anything they do not know.
     */
    if (
      url.pathname.startsWith("/public-dashboard-api/") ||
      url.pathname.startsWith("/public-dashboard/assets/") ||
      url.pathname.startsWith("/api/")
    ) {
      response.writeHead(404).end();
      return;
    }

    response.setHeader("Content-Type", "text/html");

    if (url.pathname.startsWith("/public-dashboard/")) {
      response.end(renderPublic());
      return;
    }

    response.end(appHtml);
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(
      `Dashboard time range fixture ready at http://127.0.0.1:${port}/dashboard/10000000-0000-4000-8000-0000000000d1/dashboards/db000000-0000-4000-8000-000000000001`,
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
