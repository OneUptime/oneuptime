/*
 * Scheduled maintenance calendars in a real browser, with no backend:
 *
 *   - Fixture.js: the Dashboard's Scheduled Maintenance pages beside their
 *     side menu - All Events, the Maintenance Calendar with its filter
 *     chips, external calendars and Subscribe to calendar dialog, and
 *     Calendar Settings (any path but the two below);
 *   - StatusPageFixture.js: a status page's Scheduled Events list and an
 *     event's page, with Subscribe to calendar and Add to calendar
 *     (/status-page/<id>/scheduled-events... and /scheduled-events...).
 *
 * Both are bundled with the apps' esbuild config, Tailwind, theme and font,
 * and answer the API calls the pages make from an in-page store the specs
 * drive and read.
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { createConfig } = require("../../Common/UI/esbuild-config.js");
const esbuild = require("../../Common/node_modules/esbuild");

const repository = path.resolve(__dirname, "../../..");
const output = path.join(
  repository,
  "output/playwright/maintenance-calendar-ui/fixture",
);
const port = Number(process.env["MAINTENANCE_CALENDAR_FIXTURE_PORT"] || 4341);
const config = createConfig({
  serviceName: "maintenance-calendar-fixture",
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
config.entryPoints = [
  path.join(__dirname, "Fixture.js"),
  path.join(__dirname, "StatusPageFixture.js"),
];
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
 * What every index.ejs loads right after the runtime: left and right follow
 * the page's reading direction, so a Persian page (dir="rtl", set by the
 * frontend's i18n) is laid out as production lays it out.
 */
const readingDirection = path.join(
  repository,
  "packages/Common/UI/Styles/TailwindReadingDirection.js",
);
const font = path.join(
  repository,
  "packages/Common/Server/Static/Vendor/fonts/InterVariable.woff2",
);

const env = `{HOST:"localhost",HTTP_PROTOCOL:"http",BILLING_ENABLED:"false",VERSION:"1.0.0",NODE_ENV:"development"}`;

/*
 * The Dashboard's font as its index.ejs loads it: Inter on every element,
 * not only the body - a rule on `*` wins over inheritance, which is what a
 * page draws in.
 */
const page = (bundle) => {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Maintenance calendar fixture</title><script>window.process={env:${env}};window.global=window;</script><script src="/tailwind.js"></script><script src="/tailwind-reading-direction.js"></script><script>tailwind.config={darkMode:"class"};</script><style>@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:block;src:url('/fonts/InterVariable.woff2') format('woff2');}*{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;}body{margin:0}*{box-sizing:border-box}</style></head><body class="bg-gray-50"><div id="root"></div><script type="module" src="/dist/${bundle}.js"></script></body></html>`;
};

// A status page's addresses: its preview path, or its own domain's.
const isStatusPagePath = (pathname) => {
  return (
    pathname.startsWith("/status-page/") ||
    pathname.startsWith("/scheduled-events")
  );
};

async function main() {
  fs.mkdirSync(output, { recursive: true });
  await esbuild.build(config);
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    response.setHeader("Cache-Control", "no-store");
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
    response.setHeader("Content-Type", "text/html");
    response.end(
      page(isStatusPagePath(url.pathname) ? "StatusPageFixture" : "Fixture"),
    );
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(
      `Maintenance calendar fixture ready at http://127.0.0.1:${port}/`,
    );
  });
  process.on("SIGTERM", () => server.close());
  process.on("SIGINT", () => server.close());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
