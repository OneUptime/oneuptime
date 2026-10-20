/* Offline fixture server for the Create a dashboard and Create a workflow dialogs. No app/API server needed. */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { createConfig } = require("../../../Common/UI/esbuild-config.js");
const esbuild = require("../../../Common/node_modules/esbuild");
const repository = path.resolve(__dirname, "../../../..");
const output = path.join(
  repository,
  "output/playwright/dashboard-templates-ui/fixture",
);
const port = Number(process.env.DASHBOARD_TEMPLATES_FIXTURE_PORT || 4397);
const config = createConfig({
  serviceName: "dashboard-templates-fixture",
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
// The Dashboard's locales, which the page fetches for ?lang=.
const locales = path.join(
  repository,
  "packages/App/FeatureSet/Dashboard/src/Locales",
);
const LOCALE_PATH = /^\/locales\/([a-zA-Z]{2}(?:-[a-zA-Z]{2})?)\.json$/;
// The Dashboard's own font, so rows and chips are measured as they are drawn.
const font = path.join(
  repository,
  "packages/Common/Server/Static/Vendor/fonts/InterVariable.woff2",
);
/*
 * ?theme=dark draws the dialogs as the Dashboard does in dark mode: the class
 * on <html> that Theme.css reads. Every frontend's index.ejs sets Inter on
 * every element (`* { font-family: Inter, ... }`), and so does this page.
 */
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Create a dashboard preview</title><script>window.process={env:{HOST:"localhost",HTTP_PROTOCOL:"http",BILLING_ENABLED:"false",VERSION:"1.0.0"}};window.global=window;window.process.env.NODE_ENV="development";if(new URLSearchParams(window.location.search).get("theme")==="dark"){document.documentElement.classList.add("dark");}</script><script src="/tailwind.js"></script><script>tailwind.config={darkMode:"class",theme:{extend:{fontFamily:{display:["Inter","sans-serif"],body:["Inter","sans-serif"]}}}};</script><style>@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:block;src:url('/fonts/InterVariable.woff2') format('woff2');}body{margin:0;background:var(--ou-background-primary,#f8fafc)}*{box-sizing:border-box;font-family:Inter,ui-sans-serif,system-ui,sans-serif}</style></head><body><div id="root"></div><script type="module" src="/dist/Fixture.js"></script></body></html>`;
async function main() {
  fs.mkdirSync(output, { recursive: true });
  await esbuild.build(config);
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
    const locale = LOCALE_PATH.exec(url.pathname);
    if (locale) {
      const file = path.join(locales, `${locale[1]}.json`);
      if (!fs.existsSync(file)) {
        response.writeHead(404).end();
        return;
      }
      response.setHeader("Content-Type", "application/json");
      fs.createReadStream(file).pipe(response);
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
    if (url.pathname !== "/") {
      // The dialogs need no API; anything else they ask for is a 404.
      response.writeHead(404).end();
      return;
    }
    response.setHeader("Content-Type", "text/html");
    response.end(html);
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(
      `Create a dashboard fixture ready at http://127.0.0.1:${port}/?page=create-dashboard`,
    );
  });
  process.on("SIGTERM", () => server.close());
  process.on("SIGINT", () => server.close());
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
