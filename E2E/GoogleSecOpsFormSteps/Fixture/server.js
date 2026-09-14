/* Offline fixture server for the production Google SecOps Connections page. */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { createConfig } = require("../../../Common/UI/esbuild-config.js");
const esbuild = require("../../../Common/node_modules/esbuild");

const repository = path.resolve(__dirname, "../../..");
const output = path.join(
  repository,
  "output/playwright/google-secops-form-steps/fixture",
);
const port = Number(process.env.GOOGLE_SECOPS_FORM_STEPS_FIXTURE_PORT || 4216);
const config = createConfig({
  serviceName: "google-secops-form-steps-fixture",
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
const monaco = path.join(
  repository,
  "Common/node_modules/monaco-editor/min/vs",
);
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Google SecOps form steps preview</title><script>window.process={env:{HOST:"localhost",HTTP_PROTOCOL:"http",BILLING_ENABLED:"false",VERSION:"1.0.0"}};window.global=window;window.process.env.NODE_ENV="development";</script><script src="/tailwind.js"></script><style>body{margin:0;background:#f8fafc;font-family:Inter,ui-sans-serif,system-ui,sans-serif}*{box-sizing:border-box}</style></head><body><div id="root"></div><script type="module" src="/dist/Fixture.js"></script></body></html>`;

function sendFile(response, root, relativePath) {
  const file = path.resolve(root, relativePath);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) {
    response.writeHead(404).end();
    return;
  }
  const contentTypes = {
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json",
    ".ttf": "font/ttf",
  };
  response.setHeader(
    "Content-Type",
    contentTypes[path.extname(file)] || "application/octet-stream",
  );
  fs.createReadStream(file).pipe(response);
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  await esbuild.build(config);
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader(
      "Content-Security-Policy",
      "connect-src 'self'; font-src 'self' data:; worker-src 'self' blob:;",
    );
    if (url.pathname === "/tailwind.js") {
      response.setHeader("Content-Type", "application/javascript");
      fs.createReadStream(tailwind).pipe(response);
      return;
    }
    if (url.pathname.startsWith("/dist/")) {
      sendFile(response, output, url.pathname.slice(6));
      return;
    }
    const monacoPrefix = "/assets/monaco/vs/";
    if (url.pathname.startsWith(monacoPrefix)) {
      sendFile(response, monaco, url.pathname.slice(monacoPrefix.length));
      return;
    }
    response.setHeader("Content-Type", "text/html");
    response.end(html);
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(
      `Google SecOps form fixture ready at http://127.0.0.1:${port}/dashboard/${PROJECT_ID}/security-events/connections`,
    );
  });
  process.on("SIGTERM", () => server.close());
  process.on("SIGINT", () => server.close());
}

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
