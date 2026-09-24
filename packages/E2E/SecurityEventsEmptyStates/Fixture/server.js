/*
 * Offline fixture server for the Security Events and Security Events >
 * Connections pages with nothing in them. No app/API server needed.
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { createConfig } = require("../../../Common/UI/esbuild-config.js");
const esbuild = require("../../../Common/node_modules/esbuild");
const repository = path.resolve(__dirname, "../../../..");
const output = path.join(
  repository,
  "output/playwright/security-events-empty-states-ui/fixture",
);
const port = Number(process.env.SECURITY_EVENTS_EMPTY_STATES_FIXTURE_PORT || 4232);
const config = createConfig({
  serviceName: "security-events-empty-states-fixture",
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
// Production imports Theme.css from src/Index.tsx; serve the same file.
const theme = path.join(repository, "packages/Common/UI/Styles/Theme.css");
/*
 * The font production ships, at the path App/FeatureSet/Dashboard/views/index.ejs
 * loads it from. Every layout assertion in the spec measures text, so it has
 * to be measured in Inter: without this @font-face the page fell back to the
 * machine's sans-serif, which on the Linux CI runners is wider than Inter and
 * wrapped provider names the real dashboard shows on one line.
 */
const interFontPath = "/dashboard/assets/fonts/InterVariable.woff2";
const interFont = path.join(
  repository,
  "packages/App/FeatureSet/Dashboard/public/assets/fonts/InterVariable.woff2",
);
const fontFace = `@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:swap;src:url('${interFontPath}') format('woff2') tech('variations'),url('${interFontPath}') format('woff2-variations')}`;
/*
 * The same tailwind.config production sets in
 * App/FeatureSet/Dashboard/views/index.ejs, so class-based dark mode and the
 * Inter font families resolve the way they do in the real dashboard.
 */
const tailwindConfig = `tailwind.config={darkMode:"class",theme:{extend:{fontFamily:{display:["Inter","sans-serif"],body:["Inter","sans-serif"]}}}};`;
/*
 * HOST is a made-up domain so the docs links read the way they do on a real
 * install. Nothing is ever fetched from it: the data boundary is stubbed in
 * the page and the spec aborts any request that leaves this server.
 */
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Security Events empty states preview</title><script>window.process={env:{HOST:"oneuptime.acme-commerce.example",HTTP_PROTOCOL:"https",BILLING_ENABLED:"false",VERSION:"1.0.0",NODE_ENV:"development"}};window.global=window;if(new URLSearchParams(location.search).get("theme")==="dark"){document.documentElement.classList.add("dark")}</script><script src="/tailwind.js"></script><script>${tailwindConfig}</script><style>${fontFace}*{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}body{margin:0;background:#f9fafb}*{box-sizing:border-box}</style><link rel="stylesheet" href="/theme.css"></head><body><div id="root"></div><script type="module" src="/dist/Fixture.js"></script></body></html>`;

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
    if (url.pathname === interFontPath) {
      response.setHeader("Content-Type", "font/woff2");
      fs.createReadStream(interFont).pipe(response);
      return;
    }
    if (url.pathname === "/theme.css") {
      response.setHeader("Content-Type", "text/css");
      fs.createReadStream(theme).pipe(response);
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
      `Security Events empty states fixture ready at http://127.0.0.1:${port}/dashboard/10000000-0000-4000-8000-000000000001/security-events`,
    );
  });
  process.on("SIGTERM", () => server.close());
  process.on("SIGINT", () => server.close());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
