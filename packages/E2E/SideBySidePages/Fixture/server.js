/*
 * Serves the real public status page and the real public dashboard - each
 * its own index.ejs, rendered the way its server renders it, and its own app
 * (src/Index.tsx) - with only their APIs answered, in the page, from fixture
 * data (StatusPageMockApi.js, PublicDashboardMockApi.js). No app, database or
 * Docker stack.
 *
 * Both answer at their OneUptime addresses on one host, as they do on a
 * OneUptime installation with no custom domains: every status page at
 * /status-page/<id> and every dashboard at /public-dashboard/<id> (Pages.js).
 * That one host is what the suite is about: every tab open on it shares the
 * browser's storage for it.
 *
 * Inter and the production Tailwind are served where each index.ejs asks for
 * them, so what the browser lays out is what a visitor gets.
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { createConfig } = require("../../../Common/UI/esbuild-config.js");
const esbuild = require("../../../Common/node_modules/esbuild");
const ejs = require("../../../Common/node_modules/ejs");

const repository = path.resolve(__dirname, "../../../..");
const common = path.join(repository, "packages/Common");
const statusPage = path.join(repository, "packages/App/FeatureSet/StatusPage");
const publicDashboard = path.join(
  repository,
  "packages/App/FeatureSet/PublicDashboard",
);
const dashboard = path.join(repository, "packages/App/FeatureSet/Dashboard");
const output = path.join(
  repository,
  "output/playwright/side-by-side-pages-ui/fixture",
);
const port = Number(process.env.SIDE_BY_SIDE_PAGES_FIXTURE_PORT || 4471);

const tailwind = path.join(
  common,
  "Server/Static/Vendor/tailwind/tailwind-3.4.5.js",
);
const inter = path.join(
  common,
  "Server/Static/Vendor/fonts/InterVariable.woff2",
);

/*
 * The two apps, each served under its own prefix as on a real host: its
 * template, its bundle (the template's own <script src="/<prefix>/dist/
 * Index.js">), env.js and assets.
 */
const APPS = {
  "status-page": {
    template: path.join(statusPage, "views/index.ejs"),
    entryPoint: path.join(__dirname, "StatusPageIndex.js"),
    dist: path.join(output, "status-page-dist"),
    nodePaths: [
      path.join(common, "node_modules"),
      path.join(statusPage, "node_modules"),
    ],
  },
  "public-dashboard": {
    template: path.join(publicDashboard, "views/index.ejs"),
    entryPoint: path.join(__dirname, "PublicDashboardIndex.js"),
    dist: path.join(output, "public-dashboard-dist"),
    nodePaths: [
      path.join(common, "node_modules"),
      path.join(publicDashboard, "node_modules"),
      path.join(dashboard, "node_modules"),
    ],
  },
};

const buildConfig = (prefix, app) => {
  const config = createConfig({
    serviceName: `side-by-side-${prefix}-fixture`,
    publicPath: `/${prefix}/dist/`,
    entryPoint: app.entryPoint,
    outdir: app.dist,
    additionalAlias: {
      Common: common,
      react: path.join(common, "node_modules/react"),
      "react-dom": path.join(common, "node_modules/react-dom"),
      // English always: the page's language is not what is under test.
      "i18next-browser-languagedetector": path.join(
        common,
        "Tests/__mocks__/i18next-browser-languagedetector.js",
      ),
    },
  });
  // Index.js, where each template's <script> asks for it.
  config.entryPoints = { Index: app.entryPoint };
  config.target = "es2022";
  config.loader[".js"] = "jsx";
  config.sourcemap = false;
  config.minify = false;
  config.logLevel = "warning";
  config.nodePaths = app.nodePaths;
  return config;
};

/*
 * The real theme modules, for the head each page server hands its template,
 * and the fixture's pages, for each page's title and logo.
 */
let statusPageTheme = null;
let dashboardTheme = null;
let pages = null;

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

/*
 * What each page's server would put in env.js. HOST is this server, so each
 * app's API is asked here - and answered in the page, by its mock.
 */
const environment = {
  HOST: `127.0.0.1:${port}`,
  HTTP_PROTOCOL: "http",
  BILLING_ENABLED: "false",
  IS_ENTERPRISE_EDITION: "false",
  VERSION: "1.0.0",
  NODE_ENV: "development",
};

// The page an address names: /<prefix>/<id>/...
const idOf = (pathname, prefix) => {
  const rest = pathname.split(`/${prefix}/`)[1];

  return rest ? rest.split("/")[0] : "";
};

const renderStatusPage = (url) => {
  const page = pages.getStatusPage(idOf(url.pathname, "status-page"));

  return ejs.render(
    fs.readFileSync(APPS["status-page"].template, "utf8"),
    {
      title: page ? page.title : "Status Page",
      description: page ? `How ${pages.shortName(page)} is doing.` : "",
      faviconUrl: "/status-page/assets/images/favicon.png",
      lang: "en",
      rssFeedPath: "/rss",
      isSearchEngineIndexingEnabled: false,
      // What both page servers hand the template (Serve.ts).
      statusPageTheme: statusPageTheme.getStatusPageThemeHead(
        statusPageTheme.parseStatusPageTheme("Light"),
      ),
    },
    { filename: APPS["status-page"].template },
  );
};

const renderPublicDashboard = (url) => {
  const board = pages.getDashboard(idOf(url.pathname, "public-dashboard"));

  return ejs.render(
    fs.readFileSync(APPS["public-dashboard"].template, "utf8"),
    {
      title: board ? board.title : "Dashboard",
      description: "View dashboard metrics and insights.",
      // What both page servers hand the template (Serve.ts).
      dashboardTheme: dashboardTheme.getDashboardThemeHead(
        dashboardTheme.parseDashboardTheme("Light"),
      ),
    },
    { filename: APPS["public-dashboard"].template },
  );
};

const send = (response, file, type) => {
  response.setHeader("Content-Type", type);
  fs.createReadStream(file).pipe(response);
};

// A file of one app's bundle, or null when the path names none.
const distFile = (pathname, prefix) => {
  const app = APPS[prefix];
  const file = path.resolve(
    app.dist,
    pathname.slice(`/${prefix}/dist/`.length),
  );

  if (!file.startsWith(app.dist + path.sep) || !fs.existsSync(file)) {
    return null;
  }

  return file;
};

const serveAppFile = (pathname, response) => {
  for (const prefix of Object.keys(APPS)) {
    if (pathname === `/${prefix}/env.js`) {
      response.setHeader("Content-Type", "application/javascript");
      response.end(`window.process = { env: ${JSON.stringify(environment)} };`);
      return true;
    }

    if (pathname === `/${prefix}/assets/js/tailwind-3.4.5.js`) {
      send(response, tailwind, "application/javascript");
      return true;
    }

    if (pathname === `/${prefix}/assets/fonts/InterVariable.woff2`) {
      send(response, inter, "font/woff2");
      return true;
    }

    if (pathname.startsWith(`/${prefix}/dist/`)) {
      const file = distFile(pathname, prefix);

      if (!file) {
        response.writeHead(404).end();
        return true;
      }

      send(response, file, "application/javascript");
      return true;
    }
  }

  return false;
};

async function main() {
  fs.mkdirSync(output, { recursive: true });
  statusPageTheme = await loadNodeModule(
    path.join(common, "Types/StatusPage/StatusPageTheme.ts"),
    "status-page-theme-module",
  );
  dashboardTheme = await loadNodeModule(
    path.join(common, "Types/Dashboard/DashboardTheme.ts"),
    "dashboard-theme-module",
  );
  pages = await loadNodeModule(path.join(__dirname, "Pages.js"), "pages");

  await Promise.all(
    Object.keys(APPS).map((prefix) => {
      return esbuild.build(buildConfig(prefix, APPS[prefix]));
    }),
  );

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

    if (serveAppFile(url.pathname, response)) {
      return;
    }

    // A status page's logo, as its sign-in pages load it.
    if (url.pathname.startsWith("/status-page-api/logo/")) {
      const page = pages.getStatusPage(url.pathname.split("/")[3]);

      if (!page) {
        response.writeHead(404).end();
        return;
      }

      response.setHeader("Content-Type", "image/svg+xml");
      response.end(pages.logoSvg(page));
      return;
    }

    /*
     * Nothing else either app asks its API for over HTTP: the mocks answer
     * it in the page, and record anything they do not know.
     */
    if (
      url.pathname.startsWith("/status-page-api/") ||
      url.pathname.startsWith("/public-dashboard-api/") ||
      url.pathname.startsWith("/status-page/assets/") ||
      url.pathname.startsWith("/public-dashboard/assets/") ||
      url.pathname.startsWith("/api/")
    ) {
      response.writeHead(404).end();
      return;
    }

    if (url.pathname.startsWith("/status-page/")) {
      response.setHeader("Content-Type", "text/html");
      response.end(renderStatusPage(url));
      return;
    }

    if (url.pathname.startsWith("/public-dashboard/")) {
      response.setHeader("Content-Type", "text/html");
      response.end(renderPublicDashboard(url));
      return;
    }

    response.writeHead(404).end("Not part of the fixture");
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`Side by side pages fixture ready at http://127.0.0.1:${port}`);
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
