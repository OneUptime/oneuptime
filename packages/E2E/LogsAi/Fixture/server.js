/* Offline fixture server for Logs' real AI tab. No app/API server needed. */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { createConfig } = require("../../../Common/UI/esbuild-config.js");
const esbuild = require("../../../Common/node_modules/esbuild");
const repository = path.resolve(__dirname, "../../../..");
const output = path.join(repository, "output/playwright/logs-ai-ui/fixture");
const port = Number(process.env.LOGS_AI_FIXTURE_PORT || 4436);
const config = createConfig({
  serviceName: "logs-ai-fixture",
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
// The Dashboard's own font, so rows and chips are measured as they are drawn.
const font = path.join(
  repository,
  "packages/Common/Server/Static/Vendor/fonts/InterVariable.woff2",
);
/*
 * Read before the bundle runs, as the Dashboard reads its own environment:
 * ?theme=dark adds the class Theme.css and Tailwind's dark: variants read.
 */
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Logs AI preview</title><script>(function(){var q=new URLSearchParams(window.location.search);window.process={env:{HOST:"localhost",HTTP_PROTOCOL:"http",BILLING_ENABLED:"false",VERSION:"1.0.0"}};window.global=window;window.process.env.NODE_ENV="development";if(q.get("theme")==="dark"){document.documentElement.classList.add("dark");}})();</script><script src="/tailwind.js"></script><script>tailwind.config={darkMode:"class",theme:{extend:{fontFamily:{display:["Inter","sans-serif"],body:["Inter","sans-serif"]}}}};</script><style>@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:block;src:url('/fonts/InterVariable.woff2') format('woff2');}body{margin:0;background:var(--ou-background-primary,#f9fafb)}*{box-sizing:border-box;font-family:Inter,ui-sans-serif,system-ui,sans-serif}</style></head><body><div id="root"></div><script type="module" src="/dist/Fixture.js"></script></body></html>`;

async function main() {
  fs.mkdirSync(output, { recursive: true });

  if (process.argv.includes("--watch")) {
    const context = await esbuild.context(config);
    await context.watch();
  } else {
    await esbuild.build(config);
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
      `Logs AI fixture ready at http://127.0.0.1:${port}/dashboard/10000000-0000-4000-8000-000000000001/logs/ai/insights`,
    );
  });
  process.on("SIGTERM", () => server.close());
  process.on("SIGINT", () => server.close());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
