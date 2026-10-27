/*
 * Offline fixture server for the shared buttons, dialogs and cards:
 * the production components and a few real Dashboard cards, bundled with
 * the app's esbuild config and drawn with the Dashboard's Tailwind, theme
 * and font. No app/API server needed.
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { createConfig } = require("../../../Common/UI/esbuild-config.js");
const esbuild = require("../../../Common/node_modules/esbuild");
const repository = path.resolve(__dirname, "../../../..");
/*
 * SHARED_UI_FIXTURE_OUTPUT lets a second copy (a "before" build of
 * master's components, say) build somewhere else: every server.js
 * otherwise builds into the one folder the suite is served from.
 */
const output =
  process.env.SHARED_UI_FIXTURE_OUTPUT ||
  path.join(repository, "output/playwright/shared-ui/fixture");
const port = Number(process.env.SHARED_UI_FIXTURE_PORT || 4329);
const config = createConfig({
  serviceName: "shared-ui-fixture",
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
/*
 * What every index.ejs loads right after the runtime: left and right follow
 * the page's reading direction, so a Persian page (dir="rtl") is laid out as
 * production lays it out.
 */
const readingDirection = path.join(
  repository,
  "packages/Common/UI/Styles/TailwindReadingDirection.js",
);
// The Dashboard's own font, so the cards are measured as they are drawn.
const font = path.join(
  repository,
  "packages/Common/Server/Static/Vendor/fonts/InterVariable.woff2",
);
/*
 * The head the Dashboard's views/index.ejs writes: Inter as @font-face, the
 * `*` rule that draws every element in it, and the same tailwind.config
 * (class-based dark mode). ?theme=dark adds the class on <html> that
 * Theme.css reads, as the Dashboard does in dark mode.
 *
 * HOST is a made-up domain. Nothing is ever fetched from it: the data
 * boundary is stubbed in the page and the spec aborts any request that
 * leaves this server.
 */
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shared UI preview</title><script>window.process={env:{HOST:"oneuptime.acme-commerce.example",HTTP_PROTOCOL:"https",BILLING_ENABLED:"false",VERSION:"1.0.0",NODE_ENV:"development"}};window.global=window;if(new URLSearchParams(window.location.search).get("theme")==="dark"){document.documentElement.classList.add("dark");}</script><script src="/tailwind.js"></script><script src="/tailwind-reading-direction.js"></script><script>tailwind.config={darkMode:"class",theme:{extend:{fontFamily:{display:["Inter","sans-serif"],body:["Inter","sans-serif"]}}}};</script><style>@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:block;src:url('/fonts/InterVariable.woff2') format('woff2');}html,body{margin:0;background-color:#f9fafb}html.dark,html.dark body{background-color:#0f172a}*{box-sizing:border-box;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}</style></head><body class="h-full bg-gray-50"><div id="root"></div><script type="module" src="/dist/Fixture.js"></script></body></html>`;

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
    response.end(html);
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(
      `Shared UI fixture ready at http://127.0.0.1:${port}/dashboard/10000000-0000-4000-8000-000000000001/shared-ui`,
    );
  });
  process.on("SIGTERM", () => server.close());
  process.on("SIGINT", () => server.close());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
