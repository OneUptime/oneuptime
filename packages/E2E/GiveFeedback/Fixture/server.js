/*
 * Offline fixture server for Give Feedback (#6832, #8893): the real dialog,
 * opened from the real Help menu over a real Dashboard page. No app/API
 * server needed.
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { createConfig } = require("../../../Common/UI/esbuild-config.js");
const {
  dashboardLocalesPlugin,
} = require("../../SuiteHelpers/FixtureLocalesBuild.js");
const esbuild = require("../../../Common/node_modules/esbuild");
const repository = path.resolve(__dirname, "../../../..");
const output = path.join(
  repository,
  "output/playwright/give-feedback-ui/fixture",
);
const port = Number(process.env.GIVE_FEEDBACK_FIXTURE_PORT || 4797);
const config = createConfig({
  serviceName: "give-feedback-fixture",
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
  // The locales as the Dashboard's own build ships them (#8366).
  additionalPlugins: [dashboardLocalesPlugin()],
});
config.target = "es2022";
config.loader[".js"] = "jsx";
config.sourcemap = false;
config.minify = false;
config.logLevel = "warning";
config.nodePaths = [
  path.join(repository, "packages/Common/node_modules"),
  path.join(repository, "packages/App/node_modules"),
];
const tailwind = path.join(
  repository,
  "packages/Common/Server/Static/Vendor/tailwind/tailwind-3.4.5.js",
);
/*
 * What the dashboard's index.ejs loads right after the runtime: left and
 * right follow the page's reading direction, so the dialog in Persian
 * (dir="rtl", set by PageLanguage) is laid out as production lays it out.
 */
const readingDirection = path.join(
  repository,
  "packages/Common/UI/Styles/TailwindReadingDirection.js",
);
// Production imports Theme.css from src/Index.tsx; serve the same file.
const theme = path.join(repository, "packages/Common/UI/Styles/Theme.css");
// The Dashboard's own font, so the dialog is measured as it is drawn.
const font = path.join(
  repository,
  "packages/Common/Server/Static/Vendor/fonts/InterVariable.woff2",
);
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
 *
 * The version is APP_VERSION, as the Dashboard's env.js serves it since
 * #8893. VERSION is the "1.0.0" every page read until then: the dialog
 * must say the first.
 *
 * OneUptime Cloud (?goes=oneuptime_team) runs with billing on, as Cloud
 * does; every other answer is a self-hosted server's.
 */
const environmentFor = (search) => {
  const params = new URLSearchParams(search);

  return {
    HOST: "oneuptime.acme-commerce.example",
    HTTP_PROTOCOL: "https",
    BILLING_ENABLED: params.get("goes") === "oneuptime_team" ? "true" : "false",
    APP_VERSION: "14.3.0",
    VERSION: "1.0.0",
    NODE_ENV: "development",
  };
};

const htmlFor = (environment) => {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Give Feedback preview</title><script>window.process={env:${JSON.stringify(environment)}};window.global=window;(function(){var dark=new URLSearchParams(location.search).get("theme")==="dark";document.documentElement.classList.toggle("dark",dark);document.documentElement.style.colorScheme=dark?"dark":"light";})();</script><script src="/tailwind.js"></script><script src="/tailwind-reading-direction.js"></script><script>${tailwindConfig}</script><style>@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:block;src:url('/fonts/InterVariable.woff2') format('woff2');}html,body{margin:0;background:#f9fafb}*{box-sizing:border-box;font-family:Inter,ui-sans-serif,system-ui,sans-serif}</style><link rel="stylesheet" href="/theme.css"></head><body><div id="root"></div><script type="module" src="/dist/Fixture.js"></script></body></html>`;
};

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
    if (url.pathname === "/favicon.ico") {
      response.writeHead(204).end();
      return;
    }
    response.setHeader("Content-Type", "text/html");
    response.end(htmlFor(environmentFor(url.search)));
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(
      `Give Feedback fixture ready at http://127.0.0.1:${port}/dashboard/10000000-0000-4000-8000-000000000001/slos`,
    );
  });
  process.on("SIGTERM", () => server.close());
  process.on("SIGINT", () => server.close());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
