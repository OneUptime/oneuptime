/*
 * Serves the real public status page - its own index.ejs, rendered the way
 * its server renders it, and its own app (src/Index.tsx) - with only the
 * status page API answered from fixture data (Index.js, Data.js). No app,
 * database or Docker stack.
 *
 * The page's theme is the query's `theme` (Light, Dark or System), which
 * both the template (the theme its HTML is sent in, before the first paint)
 * and the fixture's master page (the page's settings, which the app
 * applies) are given. `seoTheme` gives the template another one, as a
 * server whose /seo lookup failed would (`none`: no theme at all).
 *
 * The page's default language is the query's `lang` (English without
 * one): the template is sent in it, <html lang dir> as the servers write
 * them (getStatusPageLanguageHead), and the app shows it to a visitor who
 * never chose another - an Arabic page reads right to left from its first
 * paint.
 *
 * The page answers at its OneUptime address, /status-page/<id> (the
 * Dashboard's preview), and at / as if this host were its custom domain.
 *
 * Inter, Vazirmatn (its Arabic and Persian letters), the production
 * Tailwind and the reading-direction config index.ejs loads after it are
 * served where index.ejs asks for them, so what the browser lays out is
 * what a visitor gets.
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
const output = path.join(
  repository,
  "output/playwright/status-page-theme-ui/fixture",
);
const port = Number(process.env.STATUS_PAGE_THEME_FIXTURE_PORT || 4341);

const template = path.join(statusPage, "views/index.ejs");
const tailwind = path.join(
  common,
  "Server/Static/Vendor/tailwind/tailwind-3.4.5.js",
);
// Left and right utilities that follow the page's reading direction.
const readingDirection = path.join(
  common,
  "UI/Styles/TailwindReadingDirection.js",
);
const inter = path.join(
  common,
  "Server/Static/Vendor/fonts/InterVariable.woff2",
);
const arabicScriptFont = path.join(
  common,
  "Server/Static/Vendor/fonts/VazirmatnArabicVariable.woff2",
);
const logo = path.join(__dirname, "logo.svg");
const darkLogo = path.join(__dirname, "logo-dark.svg");

// The page's single sign-on provider, which its SSO page lists.
const ssoProviders = [
  {
    _id: "00000000-0000-4000-8000-000000000800",
    name: "Acme Okta",
    description: "Sign in with your Acme account.",
  },
];

/*
 * The page's bundle is Index.js, so the template's own
 * <script src="/status-page/dist/Index.js"> loads it.
 */
const config = createConfig({
  serviceName: "status-page-theme-fixture",
  publicPath: "/status-page/dist/",
  entryPoint: path.join(__dirname, "Index.js"),
  outdir: path.join(output, "dist"),
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
config.target = "es2022";
config.loader[".js"] = "jsx";
config.sourcemap = false;
config.minify = false;
config.logLevel = "warning";
config.nodePaths = [
  path.join(common, "node_modules"),
  path.join(statusPage, "node_modules"),
];

/*
 * The real StatusPageTheme and StatusPageLanguage modules, for the head and
 * the <html lang dir> the servers hand the template.
 */
let themeModule = null;
let languageModule = null;

const loadNodeModule = async (entry, name) => {
  const file = path.join(output, name);
  await esbuild.build({
    entryPoints: [path.join(common, entry)],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: file,
    logLevel: "warning",
  });
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(file);
};

const loadThemeModule = async () => {
  themeModule = await loadNodeModule(
    "Types/StatusPage/StatusPageTheme.ts",
    "theme-module.cjs",
  );
  languageModule = await loadNodeModule(
    "Types/StatusPage/StatusPageLanguage.ts",
    "language-module.cjs",
  );
};

/*
 * What the page's server would put in env.js. HOST is this server: the
 * sign-in pages load the page's logo from Common's STATUS_PAGE_API_URL.
 */
const environment = {
  HOST: `127.0.0.1:${port}`,
  HTTP_PROTOCOL: "http",
  BILLING_ENABLED: "false",
  IS_ENTERPRISE_EDITION: "false",
  VERSION: "1.0.0",
  NODE_ENV: "development",
};

const render = (search) => {
  const params = new URLSearchParams(search);
  const seoTheme = params.get("seoTheme") || params.get("theme") || "Light";
  // The page's default language and the way it reads (Serve.ts).
  const languageHead = languageModule.getStatusPageLanguageHead(
    params.get("lang"),
  );
  const variables = {
    title: "Acme Cloud Status",
    description: "How Acme Cloud is doing right now.",
    faviconUrl: "/status-page/assets/images/favicon.png",
    lang: languageHead.lang,
    dir: languageHead.dir,
    rssFeedPath: "/rss",
    isSearchEngineIndexingEnabled: false,
  };

  // What both page servers hand the template (Serve.ts, Frontend/Index.ts).
  if (seoTheme !== "none") {
    variables.statusPageTheme = themeModule.getStatusPageThemeHead(
      themeModule.parseStatusPageTheme(seoTheme),
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
  await loadThemeModule();
  await esbuild.build(config);
  if (process.argv.includes("--build-only")) {
    return;
  }

  /*
   * A request the page makes before its script runs - Tailwind, the bundle
   * - can be held back by the spec (`hold=1` and /release), to look at the
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

    if (url.pathname === "/status-page/env.js") {
      response.setHeader("Content-Type", "application/javascript");
      response.end(`window.process = { env: ${JSON.stringify(environment)} };`);
      return;
    }

    if (url.pathname === "/status-page/assets/js/tailwind-3.4.5.js") {
      void held.then(() => {
        send(response, tailwind, "application/javascript");
      });
      return;
    }

    if (
      url.pathname === "/status-page/assets/js/tailwind-reading-direction.js"
    ) {
      void held.then(() => {
        send(response, readingDirection, "application/javascript");
      });
      return;
    }

    if (url.pathname === "/status-page/assets/fonts/InterVariable.woff2") {
      send(response, inter, "font/woff2");
      return;
    }

    if (
      url.pathname === "/status-page/assets/fonts/VazirmatnArabicVariable.woff2"
    ) {
      send(response, arabicScriptFont, "font/woff2");
      return;
    }

    if (url.pathname.startsWith("/status-page/dist/")) {
      const file = path.resolve(
        output,
        "dist",
        url.pathname.slice("/status-page/dist/".length),
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

    // The page's logo, as the sign-in pages load it.
    if (url.pathname.startsWith("/status-page-api/logo/")) {
      send(response, logo, "image/svg+xml");
      return;
    }

    // Its logo for the dark theme (darkLogo=1), as the sign-in pages load it.
    if (url.pathname.startsWith("/status-page-api/dark-theme-logo/")) {
      send(response, darkLogo, "image/svg+xml");
      return;
    }

    /*
     * The SSO page's lists of providers, which its ModelList reads with
     * Common's own API client, over HTTP rather than through MockApi: one
     * SAML provider and no OpenID Connect one, each list a bare array, as
     * the API answers it.
     */
    if (url.pathname.startsWith("/status-page-api/sso/")) {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(ssoProviders));
      return;
    }

    if (url.pathname.startsWith("/status-page-api/oidc/")) {
      response.setHeader("Content-Type", "application/json");
      response.end("[]");
      return;
    }

    // Nothing else the page asks the status page API for over HTTP.
    if (
      url.pathname.startsWith("/status-page-api/") ||
      url.pathname.startsWith("/status-page/assets/")
    ) {
      response.writeHead(404).end();
      return;
    }

    response.setHeader("Content-Type", "text/html");
    response.end(render(url.search));
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`Status page theme fixture ready at http://127.0.0.1:${port}`);
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
