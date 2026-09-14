/* Offline fixture server for the actual Incoming Call Policies page. No app/API server needed. */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { createConfig } = require("../../../Common/UI/esbuild-config.js");
const esbuild = require("../../../Common/node_modules/esbuild");
const repository = path.resolve(__dirname, "../../..");
const output = path.join(
  repository,
  "output/playwright/incoming-call-policies/fixture",
);
const port = Number(process.env.INCOMING_CALL_POLICIES_FIXTURE_PORT || 4214);
const config = createConfig({
  serviceName: "incoming-call-policies-fixture",
  publicPath: "/dist/",
  entryPoint: path.join(__dirname, "Fixture.js"),
  outdir: output,
  additionalAlias: {
    Common: path.join(repository, "Common"),
    react: path.join(repository, "Common/node_modules/react"),
    "react-dom": path.join(repository, "Common/node_modules/react-dom"),
  },
});
config.target = "es2022";
config.loader[".js"] = "jsx";
config.sourcemap = false;
config.minify = false;
config.logLevel = "warning";
const tailwind = path.join(
  repository,
  "Common/Server/Static/Vendor/tailwind/tailwind-3.4.5.js",
);
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Incoming call policies preview</title><script>window.process={env:{HOST:"localhost",HTTP_PROTOCOL:"http",BILLING_ENABLED:"false",VERSION:"1.0.0"}};window.global=window;window.process.env.NODE_ENV="development";</script><script src="/tailwind.js"></script><style>body{margin:0;background:#f8fafc;font-family:Inter,ui-sans-serif,system-ui,sans-serif}*{box-sizing:border-box}</style></head><body><div id="root"></div><script type="module" src="/dist/Fixture.js"></script></body></html>`;
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
      `Incoming call policies fixture ready at http://127.0.0.1:${port}/dashboard/10000000-0000-4000-8000-000000000001/on-call-duty/incoming-call-policies`,
    );
  });
  process.on("SIGTERM", () => server.close());
  process.on("SIGINT", () => server.close());
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
