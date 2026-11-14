/* Offline fixture server for the actual topology components. No app/API server needed. */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { createConfig } = require("../../Common/UI/esbuild-config.js");
const esbuild = require("../../Common/node_modules/esbuild");
const repository = path.resolve(__dirname, "../../..");
const output = path.join(repository, "output/playwright/topology/fixture");
const port = Number(process.env.TOPOLOGY_FIXTURE_PORT || 4199);
const config = createConfig({
  serviceName: "topology-fixture",
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
const theme = path.join(repository, "packages/Common/UI/Styles/Theme.css");
/*
 * What every index.ejs loads right after the runtime: left and right follow
 * the page's reading direction, so an Arabic or Persian page (?lang=ar|fa,
 * dir="rtl") is laid out as production lays it out.
 */
const readingDirection = path.join(
  repository,
  "packages/Common/UI/Styles/TailwindReadingDirection.js",
);
/*
 * The Dashboard's own font, Inter (Arabic and Persian letters in Vazirmatn,
 * under the same name, as App/FeatureSet/Dashboard/views/index.ejs has it),
 * so a table's columns are measured as they are drawn: the Infrastructure
 * list's fit in a 608px pane is a matter of a few pixels (#7103), and the
 * machine's fallback sans-serif is wider than Inter.
 */
const interFont = path.join(
  repository,
  "packages/Common/Server/Static/Vendor/fonts/InterVariable.woff2",
);
const arabicScriptFont = path.join(
  repository,
  "packages/Common/Server/Static/Vendor/fonts/VazirmatnArabicVariable.woff2",
);
const fontFaces = `@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:block;src:url('/fonts/InterVariable.woff2') format('woff2');}@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:block;src:url('/fonts/VazirmatnArabicVariable.woff2') format('woff2');unicode-range:U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200D,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC;}`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Topology preview</title><script>if(new URLSearchParams(window.location.search).get("theme")==="dark"){document.documentElement.classList.add("dark");}window.process={env:{HOST:"localhost",HTTP_PROTOCOL:"http",BILLING_ENABLED:"false",VERSION:"1.0.0"}};window.global=window;window.process.env.NODE_ENV="development";</script><link rel="stylesheet" href="/theme.css"><script src="/tailwind.js"></script><script src="/tailwind-reading-direction.js"></script><style>${fontFaces}body{margin:0;background:var(--ou-background-primary,#f8fafc)}*{box-sizing:border-box;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}</style></head><body><div id="root"></div><script type="module" src="/dist/Fixture.js"></script></body></html>`;
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
    if (url.pathname === "/theme.css") {
      response.setHeader("Content-Type", "text/css");
      fs.createReadStream(theme).pipe(response);
      return;
    }
    if (url.pathname === "/tailwind-reading-direction.js") {
      response.setHeader("Content-Type", "application/javascript");
      fs.createReadStream(readingDirection).pipe(response);
      return;
    }
    if (url.pathname === "/fonts/InterVariable.woff2") {
      response.setHeader("Content-Type", "font/woff2");
      fs.createReadStream(interFont).pipe(response);
      return;
    }
    if (url.pathname === "/fonts/VazirmatnArabicVariable.woff2") {
      response.setHeader("Content-Type", "font/woff2");
      fs.createReadStream(arabicScriptFont).pipe(response);
      return;
    }
    if (url.pathname.startsWith("/dist/")) {
      const file = path.resolve(output, url.pathname.slice(6));
      if (!file.startsWith(output + path.sep) || !fs.existsSync(file)) {
        response.writeHead(404).end();
        return;
      }
      response.setHeader("Content-Type", "application/javascript");
      fs.createReadStream(file).pipe(response);
      return;
    }
    response.setHeader("Content-Type", "text/html");
    response.end(html);
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(
      `Topology fixture ready at http://127.0.0.1:${port}/dashboard/10000000-0000-4000-8000-000000000001/topology/overview?tab=Infrastructure`,
    );
  });
  process.on("SIGTERM", () => server.close());
  process.on("SIGINT", () => server.close());
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
