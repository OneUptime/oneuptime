/*
 * Offline fixture server for the real dashboard Home page
 * (Pages/Home/Layout + Home, and Routes/MovedHomeRoutes for the addresses of
 * Home's old lists). No app/API server needed.
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { createConfig } = require("../../../Common/UI/esbuild-config.js");
const esbuild = require("../../../Common/node_modules/esbuild");
const repository = path.resolve(__dirname, "../../../..");
const output = path.join(
  repository,
  "output/playwright/home-overview-ui/fixture",
);
const port = Number(process.env.HOME_OVERVIEW_FIXTURE_PORT || 4224);
const config = createConfig({
  serviceName: "home-overview-fixture",
  publicPath: "/dist/",
  entryPoint: path.join(__dirname, "Fixture.js"),
  outdir: output,
  additionalAlias: {
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
const tailwind = path.join(
  repository,
  "packages/Common/Server/Static/Vendor/tailwind/tailwind-3.4.5.js",
);
/*
 * What the dashboard's index.ejs loads right after the runtime: left and
 * right follow the page's reading direction, so Home in Persian (dir="rtl",
 * set by PageLanguage) is laid out as production lays it out.
 */
const readingDirection = path.join(
  repository,
  "packages/Common/UI/Styles/TailwindReadingDirection.js",
);
// Production imports Theme.css from src/Index.tsx; serve the same file.
const theme = path.join(repository, "packages/Common/UI/Styles/Theme.css");
/*
 * The same tailwind.config production sets in
 * App/FeatureSet/Dashboard/views/index.ejs, so class-based dark mode and the
 * Inter font families resolve the way they do in the real dashboard.
 */
const tailwindConfig = `tailwind.config={darkMode:"class",theme:{extend:{fontFamily:{display:["Inter","sans-serif"],body:["Inter","sans-serif"]}}}};`;
/*
 * HOST is a made-up domain. Nothing is ever fetched from it: the data
 * boundary is stubbed in the page and the spec aborts any request that
 * leaves this server.
 */
const ENVIRONMENT = {
  HOST: "oneuptime.acme-commerce.example",
  HTTP_PROTOCOL: "https",
  BILLING_ENABLED: "false",
  VERSION: "1.0.0",
  NODE_ENV: "development",
};
/*
 * ?recording=cloud: OneUptime Cloud with recording of its setup pages
 * switched on (#6834) - billing on, and the four settings, the recorder's
 * host being this server, so nothing ever leaves it. Every other scenario
 * is a server that records nobody, as every self-hosted one is.
 */
const CLOUD_RECORDING_ENVIRONMENT = {
  ...ENVIRONMENT,
  BILLING_ENABLED: "true",
  PUBLIC_DASHBOARD_SESSION_REPLAY_ENABLED: "true",
  PUBLIC_DASHBOARD_SESSION_REPLAY_TOKEN: "fixture-ingestion-key",
  PUBLIC_DASHBOARD_SESSION_REPLAY_APP_IDENTIFIER: "fixture-dashboard",
  PUBLIC_DASHBOARD_SESSION_REPLAY_HOST: `http://127.0.0.1:${port}`,
};
const htmlFor = (environment) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Home preview</title><script>window.process={env:${JSON.stringify(environment)}};window.global=window;if(new URLSearchParams(location.search).get("theme")==="dark"){document.documentElement.classList.add("dark")}</script><script src="/tailwind.js"></script><script src="/tailwind-reading-direction.js"></script><script>${tailwindConfig}</script><style>body{margin:0;background:#f9fafb;font-family:Inter,ui-sans-serif,system-ui,sans-serif}*{box-sizing:border-box}</style><link rel="stylesheet" href="/theme.css"></head><body><div id="root"></div><script type="module" src="/dist/Fixture.js"></script></body></html>`;

async function main() {
  fs.mkdirSync(output, { recursive: true });

  if (process.argv.includes("--watch")) {
    const context = await esbuild.context(config);
    await context.watch();
  } else {
    await esbuild.build(config);
  }

  if (process.argv.includes("--build-only")) {
    return;
  }

  const server = http.createServer((request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    /*
     * The recorder's loader, as OneUptime Cloud serves it, stood in for by
     * one line that says it was fetched (#6834): only ?recording=cloud with
     * consent ever asks for it.
     */
    if (url.pathname === "/telemetry/session-replay/v1/recorder.js") {
      response.setHeader("Content-Type", "application/javascript");
      response.end("window.__fixtureRecorderLoaderFetched = true;");
      return;
    }
    response.setHeader("Cache-Control", "no-store");
    response.setHeader(
      "Content-Security-Policy",
      "connect-src 'self'; font-src 'self' data:;",
    );
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
    if (url.pathname === "/theme.css") {
      response.setHeader("Content-Type", "text/css");
      fs.createReadStream(theme).pipe(response);
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
    if (url.pathname === "/favicon.ico") {
      response.writeHead(204).end();
      return;
    }
    response.setHeader("Content-Type", "text/html");
    response.end(
      htmlFor(
        url.searchParams.get("recording") === "cloud"
          ? CLOUD_RECORDING_ENVIRONMENT
          : ENVIRONMENT,
      ),
    );
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(
      `Home fixture ready at http://127.0.0.1:${port}/dashboard/10000000-0000-4000-8000-000000000001/home/`,
    );
  });
  process.on("SIGTERM", () => server.close());
  process.on("SIGINT", () => server.close());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
