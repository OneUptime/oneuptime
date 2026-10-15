/*
 * Offline fixture server for the real Network Overview's first-run path
 * (Pages/Network/Layout + Pages/NetworkDevice/Overview). No app/API server.
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { createConfig } = require("../../../Common/UI/esbuild-config.js");
const esbuild = require("../../../Common/node_modules/esbuild");
const repository = path.resolve(__dirname, "../../../..");
const output = path.join(
  repository,
  "output/playwright/network-first-run-ui/fixture",
);
const port = Number(process.env.NETWORK_FIRST_RUN_FIXTURE_PORT || 4284);
const config = createConfig({
  serviceName: "network-first-run-fixture",
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
 * The same tailwind.config production sets in
 * App/FeatureSet/Dashboard/views/index.ejs, so class-based dark mode and the
 * Inter font families resolve the way they do in the real dashboard.
 */
const tailwindConfig = `tailwind.config={darkMode:"class",theme:{extend:{fontFamily:{display:["Inter","sans-serif"],body:["Inter","sans-serif"]}}}};`;
/*
 * Inter, as production serves it: index.ejs declares the font and gives
 * EVERY element Inter with a universal `*` rule. Without them the page is
 * drawn in the browser's fallback font, whose medium weight reads as
 * regular, and the screenshots judge a page production never serves.
 */
const inter = path.join(
  repository,
  "packages/Common/Server/Static/Vendor/fonts/InterVariable.woff2",
);
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

const fontRules = `@font-face{font-family:"Inter";font-style:normal;font-weight:100 900;font-display:swap;src:url("/fonts/InterVariable.woff2") format("woff2");}${universalRule[0]}`;
/*
 * HOST is a made-up domain. Nothing is ever fetched from it: the data
 * boundary is stubbed in the page and the spec aborts any request that
 * leaves this server. It is what the run command names as the server.
 *
 * ?plan= (free | growth) runs the page as OneUptime Cloud does: billing on,
 * with the plans the Cloud configures (SUBSCRIPTION_PLAN_* in env.js, in its
 * order: Free, Growth, Scale, Enterprise). Fixture.js puts the project on the
 * plan named. Without it the page is a self-hosted server's: billing off.
 */
const plans = `{SUBSCRIPTION_PLAN_BASIC:"Free,price_free_monthly,price_free_yearly,0,0,1,0",SUBSCRIPTION_PLAN_GROWTH:"Growth,price_growth_monthly,price_growth_yearly,0,0,2,14",SUBSCRIPTION_PLAN_SCALE:"Scale,price_scale_monthly,price_scale_yearly,0,0,3,0",SUBSCRIPTION_PLAN_ENTERPRISE:"Enterprise,price_enterprise_monthly,price_enterprise_yearly,-1,-1,4,14"}`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Network first run preview</title><script>(function(){var query=new URLSearchParams(location.search);var isCloud=Boolean(query.get("plan"));var env={HOST:"oneuptime.acme-networks.example",HTTP_PROTOCOL:"https",BILLING_ENABLED:isCloud?"true":"false",VERSION:"1.0.0",NODE_ENV:"development"};if(isCloud){Object.assign(env,${plans})}window.process={env:env};window.global=window;if(query.get("theme")==="dark"){document.documentElement.classList.add("dark")}})();</script><script src="/tailwind.js"></script><script>${tailwindConfig}</script><style>${fontRules}body{margin:0;background:#f9fafb}*{box-sizing:border-box}</style><link rel="stylesheet" href="/theme.css"></head><body><div id="root"></div><script type="module" src="/dist/Fixture.js"></script></body></html>`;

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
    if (url.pathname === "/theme.css") {
      response.setHeader("Content-Type", "text/css");
      fs.createReadStream(theme).pipe(response);
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
    if (url.pathname === "/favicon.ico") {
      response.writeHead(204).end();
      return;
    }
    response.setHeader("Content-Type", "text/html");
    response.end(html);
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(
      `Network first-run fixture ready at http://127.0.0.1:${port}/dashboard/10000000-0000-4000-8000-000000000001/network-devices/overview`,
    );
  });
  process.on("SIGTERM", () => server.close());
  process.on("SIGINT", () => server.close());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
