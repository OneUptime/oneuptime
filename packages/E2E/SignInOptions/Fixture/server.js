/*
 * Builds and serves the real sign-in pages - Accounts' sign-in, single
 * sign-on and sign-up pages, and a private status page's sign-in - with the
 * network stubbed (Fixture.js), the production Tailwind and the production
 * font. No app, database or Docker stack.
 *
 * Inter, as every frontend's index.ejs loads it: whether a label fits on one
 * line, and where it wraps, depends on the font's widths.
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { createConfig } = require("../../../Common/UI/esbuild-config.js");
const esbuild = require("../../../Common/node_modules/esbuild");

const repository = path.resolve(__dirname, "../../../..");
const common = path.join(repository, "packages/Common");
const output = path.join(
  repository,
  "output/playwright/sign-in-options-ui/fixture",
);
const port = Number(process.env.SIGN_IN_OPTIONS_FIXTURE_PORT || 4311);

const config = createConfig({
  serviceName: "sign-in-options-fixture",
  publicPath: "/dist/",
  entryPoint: path.join(__dirname, "Fixture.js"),
  outdir: output,
  additionalAlias: {
    Common: common,
    react: path.join(common, "node_modules/react"),
    "react-dom": path.join(common, "node_modules/react-dom"),
    /*
     * The pages' language comes from the query string (Fixture.js), never
     * from the browser: the stand-in Common's tests use.
     */
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
/*
 * Accounts' and the status page's own packages are not installed for the
 * browser suites: what their pages import beyond Common (use-async-effect,
 * i18next ...) comes from Common's.
 */
config.nodePaths = [path.join(common, "node_modules")];

const tailwind = path.join(
  common,
  "Server/Static/Vendor/tailwind/tailwind-3.4.5.js",
);
/*
 * What every index.ejs loads right after the runtime: left and right follow
 * the page's reading direction, so a Persian page (dir="rtl", set by the
 * frontend's i18n) is laid out as production lays it out.
 */
const readingDirection = path.join(
  common,
  "UI/Styles/TailwindReadingDirection.js",
);
const inter = path.join(
  common,
  "Server/Static/Vendor/fonts/InterVariable.woff2",
);

// What the page's server would put in env.js: Microsoft only where offered.
const environment = (search) => {
  const params = new URLSearchParams(search);
  const env = {
    HOST: "localhost",
    HTTP_PROTOCOL: "http",
    BILLING_ENABLED: "false",
    IS_ENTERPRISE_EDITION: "false",
    VERSION: "1.0.0",
    NODE_ENV: "development",
  };

  if (params.get("ms") === "1") {
    env.MICROSOFT_SIGN_IN_CLIENT_ID = "sign-in-options-fixture";
  }

  return env;
};

const html = (search) => {
  return `<!doctype html><html class="h-full" lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign-in options regression</title><script>window.process={env:${JSON.stringify(environment(search))}};window.global=window;</script><style>@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:block;src:url('/inter.woff2') format('woff2');}*{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;}</style><script src="/tailwind.js"></script><script src="/tailwind-reading-direction.js"></script><script>tailwind.config={theme:{extend:{colors:{primary:'#000000'}}}};</script></head><body class="h-full bg-gray-50"><div id="root"></div><script type="module" src="/dist/Fixture.js"></script></body></html>`;
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
    if (url.pathname === "/inter.woff2") {
      response.setHeader("Content-Type", "font/woff2");
      fs.createReadStream(inter).pipe(response);
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
    // The pages' own requests answer in Fixture.js; nothing else is served.
    if (
      url.pathname.startsWith("/api") ||
      url.pathname.startsWith("/identity")
    ) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader("Content-Type", "text/html");
    response.end(html(url.search));
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`Sign-in options fixture ready at http://127.0.0.1:${port}`);
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
