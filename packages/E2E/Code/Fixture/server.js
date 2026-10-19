/* Offline fixture server for Code's real pages. No app/API server needed. */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { createConfig } = require("../../../Common/UI/esbuild-config.js");
const esbuild = require("../../../Common/node_modules/esbuild");
const repository = path.resolve(__dirname, "../../../..");
const output = path.join(repository, "output/playwright/code-ui/fixture");
const port = Number(process.env.CODE_FIXTURE_PORT || 4366);
const config = createConfig({
  serviceName: "code-fixture",
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
// The Dashboard's own font, so cards, chips and the conversation are measured as they are drawn.
const font = path.join(
  repository,
  "packages/Common/Server/Static/Vendor/fonts/InterVariable.woff2",
);
/*
 * Read before the bundle runs, as the Dashboard reads its own environment:
 * ?theme=dark adds the class Theme.css and Tailwind's dark: variants read;
 * ?github=unconfigured leaves the GitHub App's name out (a server with no
 * GitHub App); ?plan=free turns billing on, so the plan gate can answer.
 */
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Code preview</title><script>(function(){var q=new URLSearchParams(window.location.search);window.process={env:{HOST:"localhost",HTTP_PROTOCOL:"http",BILLING_ENABLED:q.get("plan")?"true":"false",SUBSCRIPTION_PLAN_BASIC:"Free,price_basic_monthly,price_basic_yearly,0,0,1,0",SUBSCRIPTION_PLAN_GROWTH:"Growth,price_growth_monthly,price_growth_yearly,22,20,2,14",SUBSCRIPTION_PLAN_SCALE:"Scale,price_scale_monthly,price_scale_yearly,99,84,3,14",SUBSCRIPTION_PLAN_ENTERPRISE:"Enterprise,price_enterprise_monthly,price_enterprise_yearly,-1,-1,4,14",VERSION:"1.0.0",GITHUB_APP_NAME:q.get("github")==="unconfigured"?"":"oneuptime-app"}};window.global=window;window.process.env.NODE_ENV="development";if(q.get("theme")==="dark"){document.documentElement.classList.add("dark");}})();</script><script src="/tailwind.js"></script><script>tailwind.config={darkMode:"class",theme:{extend:{fontFamily:{display:["Inter","sans-serif"],body:["Inter","sans-serif"]}}}};</script><style>@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:block;src:url('/fonts/InterVariable.woff2') format('woff2');}body{margin:0;background:var(--ou-background-primary,#f8fafc)}*{box-sizing:border-box;font-family:Inter,ui-sans-serif,system-ui,sans-serif}</style></head><body><div id="root"></div><script type="module" src="/dist/Fixture.js"></script></body></html>`;
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
    response.end(html);
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(
      `Code fixture ready at http://127.0.0.1:${port}/dashboard/10000000-0000-4000-8000-0000000000c1/code`,
    );
  });
  process.on("SIGTERM", () => server.close());
  process.on("SIGINT", () => server.close());
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
