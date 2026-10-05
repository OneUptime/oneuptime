/*
 * Renders the production color field (Common/UI/Components/Forms/Fields/
 * ColorPicker) in a real browser with the app's Tailwind runtime, Theme.css
 * and font: inside the real Modal and BasicForm, as the Create Label dialog
 * draws it, and as a custom field's options draw it. No database, no API.
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { createConfig } = require("../../../Common/UI/esbuild-config.js");
const esbuild = require("../../../Common/node_modules/esbuild");

const repository = path.resolve(__dirname, "../../../..");
const output = path.join(repository, "output/playwright/color-picker-ui/fixture");
const port = Number(process.env["COLOR_PICKER_FIXTURE_PORT"] || 4262);
const config = createConfig({
  serviceName: "color-picker-fixture",
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
const inter = path.join(
  repository,
  "packages/Common/Server/Static/Vendor/fonts/InterVariable.woff2",
);

/*
 * Every frontend's index.ejs gives every element Inter with a universal `*`
 * rule; the fixture carries the real rule, so it draws the page production
 * serves.
 */
const dashboardIndex = fs.readFileSync(
  path.join(repository, "packages/App/FeatureSet/Dashboard/views/index.ejs"),
  "utf8",
);
const universalRule = dashboardIndex.match(/^\s*\*\s*\{[^}]*\}/m);

if (!universalRule) {
  throw new Error(
    "Dashboard index.ejs no longer has its universal `*` font rule",
  );
}

/*
 * The theme class goes on <html> before anything renders, the way the
 * Dashboard's index.ejs does it, so the dark run never paints light first.
 */
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Color picker fixture</title><script>window.process={env:{HOST:"localhost",HTTP_PROTOCOL:"http",BILLING_ENABLED:"false",VERSION:"1.0.0",NODE_ENV:"development"}};window.global=window;if(new URLSearchParams(location.search).get("theme")==="dark"){document.documentElement.classList.add("dark");}</script><script src="/tailwind.js"></script><style>@font-face{font-family:"Inter";font-style:normal;font-weight:100 900;font-display:swap;src:url("/fonts/InterVariable.woff2") format("woff2");}${universalRule[0]}</style></head><body class="bg-gray-50"><div id="root"></div><script type="module" src="/dist/Fixture.js"></script></body></html>`;

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
    if (url.pathname === "/fonts/InterVariable.woff2") {
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
    response.setHeader("Content-Type", "text/html");
    response.end(html);
  });
  server.listen(port, "127.0.0.1");
  process.on("SIGTERM", () => server.close());
  process.on("SIGINT", () => server.close());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
