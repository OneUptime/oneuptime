/*
 * Serves the real sign-in pages - Accounts' own index.ejs, rendered the way
 * the App server renders it, and Accounts' own app (src/Index.tsx) - with
 * only what the pages ask a server answered (MockApi.js, Data.js). No app,
 * database or Docker stack.
 *
 * The page's first script, Common/Server/Views/Partials/Theme.ejs, runs as it
 * runs in production, so what the browser draws before anything else loads
 * is the person's theme: what their browser kept under the theme key, or
 * their device's setting (the spec sets both).
 *
 * Inter and the production Tailwind are served where index.ejs asks for
 * them, so what the browser lays out is what a visitor gets.
 *
 * The server's /hold and /release hold Tailwind and the app's bundle back,
 * so a test can look at the page as the browser has it before anything but
 * the template has run.
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { createConfig } = require("../../../Common/UI/esbuild-config.js");
const esbuild = require("../../../Common/node_modules/esbuild");
const ejs = require("../../../Common/node_modules/ejs");

const repository = path.resolve(__dirname, "../../../..");
const common = path.join(repository, "packages/Common");
const accounts = path.join(repository, "packages/App/FeatureSet/Accounts");
const output = path.join(
  repository,
  "output/playwright/accounts-theme-ui/fixture",
);
const port = Number(process.env.ACCOUNTS_THEME_FIXTURE_PORT || 4346);

const template = path.join(accounts, "views/index.ejs");
const tailwind = path.join(
  common,
  "Server/Static/Vendor/tailwind/tailwind-3.4.5.js",
);
/*
 * What index.ejs loads right after the runtime: left and right follow the
 * page's reading direction, so a Persian page is laid out as production
 * lays it out.
 */
const readingDirection = path.join(
  common,
  "UI/Styles/TailwindReadingDirection.js",
);
const inter = path.join(
  common,
  "Server/Static/Vendor/fonts/InterVariable.woff2",
);
const favicon = path.join(
  accounts,
  "public/assets/img/favicons/favicon-32x32.png",
);

/*
 * The app's bundle is Index.js, so the template's own
 * <script type="module" src="/accounts/dist/Index.js"> loads it.
 */
const config = createConfig({
  serviceName: "accounts-theme-fixture",
  publicPath: "/accounts/dist/",
  entryPoint: path.join(__dirname, "Index.js"),
  outdir: path.join(output, "dist"),
  additionalAlias: {
    Common: common,
    react: path.join(common, "node_modules/react"),
    "react-dom": path.join(common, "node_modules/react-dom"),
    /*
     * The language the spec keeps in the page's storage, as the real
     * detector reads it first (LanguageDetector.js).
     */
    "i18next-browser-languagedetector": path.join(
      __dirname,
      "LanguageDetector.js",
    ),
  },
});
config.target = "es2022";
config.loader[".js"] = "jsx";
config.sourcemap = false;
config.minify = false;
config.logLevel = "warning";
/*
 * Accounts' own packages are not installed for the browser suites: what its
 * pages import beyond Common (use-async-effect, i18next ...) comes from
 * Common's.
 */
config.nodePaths = [path.join(common, "node_modules")];

// What the App server puts in env.js for the sign-in pages.
const environment = {
  HOST: `127.0.0.1:${port}`,
  HTTP_PROTOCOL: "http",
  BILLING_ENABLED: "false",
  IS_ENTERPRISE_EDITION: "false",
  VERSION: "1.0.0",
  NODE_ENV: "development",
};

const render = () => {
  return ejs.render(
    fs.readFileSync(template, "utf8"),
    // A self-hosted install: no Google tag, OneUptime's own name and icons.
    { enableGoogleTagManager: false },
    { filename: template },
  );
};

const send = (response, file, type) => {
  response.setHeader("Content-Type", type);
  fs.createReadStream(file).pipe(response);
};

async function main() {
  fs.mkdirSync(output, { recursive: true });
  await esbuild.build(config);
  if (process.argv.includes("--build-only")) {
    return;
  }

  /*
   * What the page loads after its template - Tailwind, the bundle - can be
   * held back by the spec (/hold, then /release), to look at the page as a
   * visitor sees it before anything but the template has run.
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

    if (url.pathname === "/accounts/env.js") {
      response.setHeader("Content-Type", "application/javascript");
      response.end(`window.process = { env: ${JSON.stringify(environment)} };`);
      return;
    }

    if (url.pathname === "/accounts/assets/js/tailwind-3.4.5.js") {
      void held.then(() => {
        send(response, tailwind, "application/javascript");
      });
      return;
    }

    if (url.pathname === "/accounts/assets/js/tailwind-reading-direction.js") {
      send(response, readingDirection, "application/javascript");
      return;
    }

    if (url.pathname === "/accounts/assets/fonts/InterVariable.woff2") {
      send(response, inter, "font/woff2");
      return;
    }

    // Every icon the template names is the one favicon: nothing here reads them.
    if (url.pathname.startsWith("/accounts/assets/img/")) {
      send(response, favicon, "image/png");
      return;
    }

    if (url.pathname.startsWith("/accounts/dist/")) {
      const file = path.resolve(
        output,
        "dist",
        url.pathname.slice("/accounts/dist/".length),
      );
      if (
        !file.startsWith(path.join(output, "dist") + path.sep) ||
        !fs.existsSync(file)
      ) {
        response.writeHead(404).end();
        return;
      }
      void held.then(() => {
        send(
          response,
          file,
          file.endsWith(".css") ? "text/css" : "application/javascript",
        );
      });
      return;
    }

    /*
     * The pages' own requests are answered in MockApi.js, before they leave
     * the browser; nothing else is served.
     */
    if (!url.pathname.startsWith("/accounts")) {
      response.writeHead(404).end();
      return;
    }

    response.setHeader("Content-Type", "text/html");
    response.end(render());
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`Accounts theme fixture ready at http://127.0.0.1:${port}`);
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
