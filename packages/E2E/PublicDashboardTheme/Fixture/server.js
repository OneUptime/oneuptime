/*
 * Serves the real public dashboard - its own index.ejs, rendered the way its
 * servers render it, and its own app (src/Index.tsx) - with only the public
 * dashboard API answered from fixture data (Index.js, MockApi.js, Data.js).
 * No app, database or Docker stack.
 *
 * Which dashboard a page shows is its id (Scenarios.js, DASHBOARDS): its
 * theme, whether it asks for a password, and whether its link answers at
 * all. The id is in every address the app goes to - the password prompt and
 * back - so the server renders each page's <head> with the theme its real
 * servers would hand index.ejs (getDashboardThemeHead, from the real
 * module), and the in-page API answers alike. `seoTheme` in the query sends
 * the page in another theme, as a server whose /seo lookup failed would
 * (`none`: no theme at all).
 *
 * Inter and the production Tailwind are served where index.ejs asks for
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
const publicDashboard = path.join(
  repository,
  "packages/App/FeatureSet/PublicDashboard",
);
const dashboard = path.join(repository, "packages/App/FeatureSet/Dashboard");
const output = path.join(
  repository,
  "output/playwright/public-dashboard-theme-ui/fixture",
);
const port = Number(process.env.PUBLIC_DASHBOARD_THEME_FIXTURE_PORT || 4351);

const template = path.join(publicDashboard, "views/index.ejs");
const tailwind = path.join(
  common,
  "Server/Static/Vendor/tailwind/tailwind-3.4.5.js",
);
const inter = path.join(
  common,
  "Server/Static/Vendor/fonts/InterVariable.woff2",
);

/*
 * The page's bundle is Index.js, so the template's own
 * <script src="/public-dashboard/dist/Index.js"> loads it.
 */
const config = createConfig({
  serviceName: "public-dashboard-theme-fixture",
  publicPath: "/public-dashboard/dist/",
  entryPoint: path.join(__dirname, "Index.js"),
  outdir: path.join(output, "dist"),
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

/*
 * The real DashboardTheme module, for the head the servers hand the
 * template, and the fixture's dashboards, for which theme each one has.
 */
let themeModule = null;
let scenarios = null;

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
 * What the page's server would put in env.js. HOST is this server, so the
 * app's API (/public-dashboard-api) is asked here - and answered in the
 * page, by MockApi.js.
 */
const environment = {
  HOST: `127.0.0.1:${port}`,
  HTTP_PROTOCOL: "http",
  BILLING_ENABLED: "false",
  IS_ENTERPRISE_EDITION: "false",
  VERSION: "1.0.0",
  NODE_ENV: "development",
};

// The dashboard an address names: /public-dashboard/<id>/...
const dashboardIdOf = (pathname) => {
  const match = pathname.split("/public-dashboard/")[1];

  return match ? match.split("/")[0] : "";
};

const render = (url) => {
  const scenario = scenarios.getScenario(dashboardIdOf(url.pathname));
  const seoTheme = url.searchParams.get("seoTheme");
  const variables = {
    title: scenario && scenario.answers ? scenario.title : "Dashboard",
    description: "View dashboard metrics and insights.",
  };

  if (!scenario || !scenario.answers) {
    // No dashboard answers on this link: PublicPageNotFound.
    variables.isSearchEngineIndexingEnabled = false;
  }

  /*
   * What both page servers hand the template (Serve.ts, Frontend/Index.ts):
   * the dashboard's theme, or - for a page that knows none, Access Denied
   * included - the head that follows the visitor.
   */
  if (seoTheme !== "none") {
    const theme =
      seoTheme ||
      (scenario && scenario.answers && !scenario.isForbidden
        ? scenario.theme
        : null);

    variables.dashboardTheme = themeModule.getDashboardThemeHead(
      theme ? themeModule.parseDashboardTheme(theme) : null,
    );
  }

  return ejs.render(fs.readFileSync(template, "utf8"), variables, {
    filename: template,
  });
};

const send = (response, file, type) => {
  response.setHeader("Content-Type", type);
  fs.createReadStream(file).pipe(response);
};

async function main() {
  fs.mkdirSync(output, { recursive: true });
  themeModule = await loadNodeModule(
    path.join(common, "Types/Dashboard/DashboardTheme.ts"),
    "theme-module",
  );
  scenarios = await loadNodeModule(
    path.join(__dirname, "Scenarios.js"),
    "scenarios-module",
  );
  await esbuild.build(config);
  if (process.argv.includes("--build-only")) {
    return;
  }

  /*
   * A request the page makes before its script runs - Tailwind, the bundle
   * - can be held back by the spec (/hold and /release), to look at the
   * page as a visitor sees it before anything but the template has run.
   */
  let releaseHeld = null;
  let held = Promise.resolve();

  const server = http.createServer((request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    response.setHeader("Cache-Control", "no-store");

    if (url.pathname === "/hold") {
      held = new Promise((resolve) => {
        releaseHeld = resolve;
      });
      response.end("held");
      return;
    }

    if (url.pathname === "/release") {
      if (releaseHeld) {
        releaseHeld();
      }
      held = Promise.resolve();
      response.end("released");
      return;
    }

    if (url.pathname === "/public-dashboard/env.js") {
      response.setHeader("Content-Type", "application/javascript");
      response.end(`window.process = { env: ${JSON.stringify(environment)} };`);
      return;
    }

    if (url.pathname === "/public-dashboard/assets/js/tailwind-3.4.5.js") {
      void held.then(() => {
        send(response, tailwind, "application/javascript");
      });
      return;
    }

    if (url.pathname === "/public-dashboard/assets/fonts/InterVariable.woff2") {
      send(response, inter, "font/woff2");
      return;
    }

    if (url.pathname.startsWith("/public-dashboard/dist/")) {
      const file = path.resolve(
        output,
        "dist",
        url.pathname.slice("/public-dashboard/dist/".length),
      );
      if (
        !file.startsWith(path.join(output, "dist") + path.sep) ||
        !fs.existsSync(file)
      ) {
        response.writeHead(404).end();
        return;
      }
      void held.then(() => {
        send(response, file, "application/javascript");
      });
      return;
    }

    /*
     * Nothing the page asks the API for over HTTP: MockApi.js answers it
     * in the page, and records anything it does not know.
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
    response.end(render(url));
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(
      `Public dashboard theme fixture ready at http://127.0.0.1:${port}`,
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
