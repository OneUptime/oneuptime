/*
 * Offline fixture server for File and Multiple files custom fields and a
 * public form's file questions, in a real browser, with no app or API
 * server, database or Docker stack:
 *
 *   /dashboard/...      an incident's Custom Fields page (Dashboard.js),
 *                       drawn as the Dashboard's views/index.ejs draws it:
 *                       the Tailwind runtime and its reading-direction
 *                       config, the class-based dark mode, Inter;
 *   /accounts/form/...  the public form page (Accounts.js: Accounts' own
 *                       app), in Accounts' own views/index.ejs, rendered
 *                       the way the App server renders it, with its env.js.
 *
 * Each is bundled with the app's esbuild config. ?theme=dark turns the
 * Dashboard's dark mode on before anything renders (a public form is light
 * whatever the theme).
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
  "output/playwright/custom-field-files-ui/fixture",
);
const port = Number(process.env["CUSTOM_FIELD_FILES_FIXTURE_PORT"] || 4652);

const alias = {
  Common: common,
  react: path.join(common, "node_modules/react"),
  "react-dom": path.join(common, "node_modules/react-dom"),
};

function bundle(entry, serviceName, publicPath, outdir, extraAlias) {
  const config = createConfig({
    serviceName: serviceName,
    publicPath: publicPath,
    entryPoint: path.join(__dirname, entry),
    outdir: outdir,
    additionalAlias: { ...alias, ...(extraAlias || {}) },
  });
  config.target = "es2022";
  config.loader[".js"] = "jsx";
  config.sourcemap = false;
  config.minify = false;
  config.logLevel = "warning";
  /*
   * Accounts' and the Dashboard's own packages are not installed for the
   * browser suites: what their pages import beyond Common (i18next,
   * react-router-dom ...) comes from Common's.
   */
  config.nodePaths = [path.join(common, "node_modules")];
  return config;
}

const dashboardOutput = path.join(output, "dashboard");
const accountsOutput = path.join(output, "accounts");

const dashboardConfig = bundle(
  "Dashboard.js",
  "custom-field-files-dashboard-fixture",
  "/dist/",
  dashboardOutput,
);

const accountsConfig = bundle(
  "Accounts.js",
  "custom-field-files-accounts-fixture",
  "/accounts/dist/",
  accountsOutput,
  {
    // The language the spec keeps in the page's storage (LanguageDetector.js).
    "i18next-browser-languagedetector": path.join(
      __dirname,
      "LanguageDetector.js",
    ),
  },
);

const tailwind = path.join(
  common,
  "Server/Static/Vendor/tailwind/tailwind-3.4.5.js",
);
// What every index.ejs loads right after the runtime.
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
const accountsTemplate = path.join(accounts, "views/index.ejs");

/*
 * The head the Dashboard's views/index.ejs writes: the Tailwind runtime and
 * the reading-direction config after it, class-based dark mode, Inter and
 * the `*` rule that draws every element in it. The page's language and
 * reading direction are set by the production helper (PageLanguage).
 *
 * HOST is a made-up domain: the download links the card draws point at it,
 * and the spec aborts any request that leaves this server.
 */
const dashboardHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Custom field files preview</title><script>window.process={env:{HOST:"oneuptime.acme-commerce.example",HTTP_PROTOCOL:"https",BILLING_ENABLED:"false",VERSION:"1.0.0",NODE_ENV:"development"}};window.global=window;if(new URLSearchParams(window.location.search).get("theme")==="dark"){document.documentElement.classList.add("dark");}</script><script src="/tailwind.js"></script><script src="/tailwind-reading-direction.js"></script><script>tailwind.config={darkMode:"class",theme:{extend:{fontFamily:{display:["Inter","sans-serif"],body:["Inter","sans-serif"]}}}};</script><style>@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:block;src:url('/fonts/InterVariable.woff2') format('woff2');}html,body{margin:0;background-color:#f9fafb}html.dark,html.dark body{background-color:#0f172a}*{box-sizing:border-box;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}</style></head><body class="h-full bg-gray-50"><div id="root"></div><script type="module" src="/dist/Dashboard.js"></script></body></html>`;

// What the App server puts in env.js for the sign-in and form pages.
const accountsEnvironment = {
  HOST: `127.0.0.1:${port}`,
  HTTP_PROTOCOL: "http",
  BILLING_ENABLED: "false",
  IS_ENTERPRISE_EDITION: "false",
  VERSION: "1.0.0",
  NODE_ENV: "development",
};

const renderAccounts = () => {
  return ejs.render(
    fs.readFileSync(accountsTemplate, "utf8"),
    // A self-hosted install: no Google tag, OneUptime's own name and icons.
    { enableGoogleTagManager: false },
    { filename: accountsTemplate },
  );
};

const send = (response, file, type) => {
  response.setHeader("Content-Type", type);
  fs.createReadStream(file).pipe(response);
};

const sendBuilt = (response, root, relative) => {
  const file = path.resolve(root, relative);

  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) {
    response.writeHead(404).end();
    return;
  }

  send(
    response,
    file,
    file.endsWith(".css") ? "text/css" : "application/javascript",
  );
};

async function main() {
  fs.mkdirSync(dashboardOutput, { recursive: true });
  fs.mkdirSync(accountsOutput, { recursive: true });
  await Promise.all([
    esbuild.build(dashboardConfig),
    esbuild.build(accountsConfig),
  ]);

  if (process.argv.includes("--build-only")) {
    return;
  }

  const server = http.createServer((request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    response.setHeader("Cache-Control", "no-store");

    if (
      url.pathname === "/tailwind.js" ||
      url.pathname === "/accounts/assets/js/tailwind-3.4.5.js"
    ) {
      send(response, tailwind, "application/javascript");
      return;
    }

    if (
      url.pathname === "/tailwind-reading-direction.js" ||
      url.pathname === "/accounts/assets/js/tailwind-reading-direction.js"
    ) {
      send(response, readingDirection, "application/javascript");
      return;
    }

    if (
      url.pathname === "/fonts/InterVariable.woff2" ||
      url.pathname === "/accounts/assets/fonts/InterVariable.woff2"
    ) {
      send(response, inter, "font/woff2");
      return;
    }

    if (url.pathname === "/accounts/env.js") {
      response.setHeader("Content-Type", "application/javascript");
      response.end(
        `window.process = { env: ${JSON.stringify(accountsEnvironment)} };`,
      );
      return;
    }

    // Every icon Accounts' template names is the one favicon.
    if (url.pathname.startsWith("/accounts/assets/img/")) {
      send(response, favicon, "image/png");
      return;
    }

    if (url.pathname.startsWith("/accounts/dist/")) {
      const relative = url.pathname.slice("/accounts/dist/".length);
      /*
       * Accounts' template loads its app as /accounts/dist/Index.js: here,
       * Accounts.js, the app with its requests answered.
       */
      sendBuilt(
        response,
        accountsOutput,
        relative === "Index.js" ? "Accounts.js" : relative,
      );
      return;
    }

    if (url.pathname.startsWith("/dist/")) {
      sendBuilt(response, dashboardOutput, url.pathname.slice("/dist/".length));
      return;
    }

    if (url.pathname === "/favicon.ico") {
      response.writeHead(204).end();
      return;
    }

    if (url.pathname.startsWith("/accounts")) {
      response.setHeader("Content-Type", "text/html");
      response.end(renderAccounts());
      return;
    }

    if (url.pathname.startsWith("/dashboard")) {
      response.setHeader("Content-Type", "text/html");
      response.end(dashboardHtml);
      return;
    }

    response.writeHead(404).end();
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(
      `Custom field files fixture ready at http://127.0.0.1:${port}/dashboard/ and http://127.0.0.1:${port}/accounts/form/70000000-0000-4000-8000-0000000000c1`,
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
