/*
 * Offline fixture for Register Device (User Settings > Notification Methods >
 * Push Notifications). No app/API server, database or Docker.
 *
 * What the browser gets is the real thing wherever it decides the outcome:
 *   - the Push component from this branch, bundled with esbuild (Fixture.js);
 *   - the Dashboard's service worker, generated from sw.js.template by the
 *     same generator the build uses, at /dashboard/sw.js, with the assets it
 *     precaches served from the Dashboard's public folder;
 *   - the service worker script from views/index.ejs, copied in verbatim, so
 *     the page reloads (or does not) exactly as the Dashboard does.
 *
 * The API routes Register Device calls are answered here, and every request
 * body is recorded as the server received it - JSON, as it crossed the wire.
 * The register route refuses a project id that is not a string id with
 * "Project ID is invalid", as the real route did before it learned to read
 * the serialized ObjectID the Dashboard used to send.
 *
 * Test hooks:
 *   GET  /__fixture/state        what was registered and sent
 *   POST /__fixture/reset        back to one registered phone
 *   POST /__fixture/sw-revision  serve a new version of the service worker
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { createConfig } = require("../../../Common/UI/esbuild-config.js");
const esbuild = require("../../../Common/node_modules/esbuild");
const {
  generateServiceWorker,
} = require("../../../Common/Scripts/generate-service-worker.js");

const repository = path.resolve(__dirname, "../../../..");
const dashboard = path.join(repository, "packages/App/FeatureSet/Dashboard");
const dashboardPublic = path.join(dashboard, "public");
const output = path.join(
  repository,
  "output/playwright/push-registration-ui/fixture",
);
const port = Number(process.env.PUSH_REGISTRATION_FIXTURE_PORT || 4281);

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const PHONE_DEVICE_ID = "20000000-0000-4000-8000-000000000001";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A real P-256 public key, so the browser's own key handling is exercised.
const VAPID_PUBLIC_KEY =
  "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";

const config = createConfig({
  serviceName: "push-registration-fixture",
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

// The <script> after "PWA Service Worker" in index.ejs, as is.
function readIndexServiceWorkerScript() {
  const source = fs.readFileSync(
    path.join(dashboard, "views/index.ejs"),
    "utf8",
  );
  const marker = source.indexOf("<!-- PWA Service Worker -->");
  if (marker === -1) {
    throw new Error("index.ejs has no PWA Service Worker script");
  }
  const start = source.indexOf("<script>", marker) + "<script>".length;
  const end = source.indexOf("</script>", start);
  return source.slice(start, end);
}

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Push registration</title><script>window.process={env:{HOST:"127.0.0.1:${port}",HTTP_PROTOCOL:"http",BILLING_ENABLED:"false",VERSION:"1.0.0",NODE_ENV:"development",VAPID_PUBLIC_KEY:"${VAPID_PUBLIC_KEY}"}};window.global=window;</script><script src="/tailwind.js"></script><style>body{margin:0;background:#f8fafc;font-family:Inter,ui-sans-serif,system-ui,sans-serif}*{box-sizing:border-box}</style></head><body><div id="root"></div><script type="module" src="/dist/Fixture.js"></script><script>${readIndexServiceWorkerScript()}</script></body></html>`;

let state;
let serviceWorkerRevision = 0;

function reset() {
  state = {
    devices: [
      {
        id: PHONE_DEVICE_ID,
        deviceName: "iPhone 14 Pro Max",
        deviceToken: "ExponentPushToken[fixture-phone]",
        createdAt: "2026-09-10T12:33:00.000Z",
      },
    ],
    registrations: [],
    testNotifications: [],
  };
}

reset();

function sendJson(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      resolve(body);
    });
  });
}

function register(body) {
  state.registrations.push(body);

  if (typeof body.projectId !== "string" || !UUID.test(body.projectId)) {
    return [400, { message: "Project ID is invalid" }];
  }

  const existing = state.devices.find((device) => {
    return device.deviceToken === body.deviceToken;
  });

  if (existing) {
    return [
      200,
      { success: true, deviceId: existing.id, alreadyRegistered: true },
    ];
  }

  const id = `30000000-0000-4000-8000-${String(state.devices.length).padStart(12, "0")}`;

  state.devices.push({
    id: id,
    deviceName: body.deviceName,
    deviceToken: body.deviceToken,
    createdAt: new Date().toISOString(),
  });

  return [200, { success: true, deviceId: id, alreadyRegistered: false }];
}

function serveFile(response, file, contentType) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404).end();
    return;
  }
  response.setHeader("Content-Type", contentType);
  fs.createReadStream(file).pipe(response);
}

const CONTENT_TYPES = {
  ".css": "text/css",
  ".html": "text/html",
  ".ico": "image/x-icon",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

async function main() {
  fs.mkdirSync(output, { recursive: true });

  const serviceWorkerFile = path.join(output, "sw.js");
  generateServiceWorker(
    path.join(dashboard, "sw.js.template"),
    serviceWorkerFile,
    "Dashboard",
  );

  await esbuild.build(config);

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    response.setHeader("Cache-Control", "no-store");

    if (url.pathname === "/__fixture/state") {
      sendJson(response, 200, state);
      return;
    }

    if (url.pathname === "/__fixture/reset" && request.method === "POST") {
      reset();
      sendJson(response, 200, { ok: true });
      return;
    }

    if (
      url.pathname === "/__fixture/sw-revision" &&
      request.method === "POST"
    ) {
      serviceWorkerRevision++;
      sendJson(response, 200, { revision: serviceWorkerRevision });
      return;
    }

    if (
      url.pathname === "/api/user-push/register" &&
      request.method === "POST"
    ) {
      const [status, body] = register(
        JSON.parse((await readBody(request)) || "{}"),
      );
      sendJson(response, status, body);
      return;
    }

    const testNotification = url.pathname.match(
      /^\/api\/user-push\/([^/]+)\/test-notification$/,
    );

    if (testNotification && request.method === "POST") {
      state.testNotifications.push({
        deviceId: testNotification[1],
        body: JSON.parse((await readBody(request)) || "{}"),
      });
      sendJson(response, 200, {
        success: true,
        message: "Test notification sent successfully",
      });
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      sendJson(response, 404, { message: `No fixture for ${url.pathname}` });
      return;
    }

    if (url.pathname === "/tailwind.js") {
      serveFile(response, tailwind, "application/javascript");
      return;
    }

    if (url.pathname.startsWith("/dist/")) {
      const file = path.resolve(output, url.pathname.slice(6));
      if (!file.startsWith(output + path.sep)) {
        response.writeHead(404).end();
        return;
      }
      serveFile(
        response,
        file,
        CONTENT_TYPES[path.extname(file)] || "application/javascript",
      );
      return;
    }

    if (url.pathname === "/dashboard/sw.js") {
      /*
       * Byte for byte the generated worker until a test asks for a new
       * version; a browser treats any change as one.
       */
      response.setHeader("Content-Type", "application/javascript");
      response.end(
        fs.readFileSync(serviceWorkerFile, "utf8") +
          (serviceWorkerRevision
            ? `\n// Fixture revision ${serviceWorkerRevision}\n`
            : ""),
      );
      return;
    }

    // What the worker precaches when it installs.
    const publicFile = path.resolve(
      dashboardPublic,
      url.pathname.replace(/^\/dashboard\//, ""),
    );
    if (
      url.pathname.startsWith("/dashboard/") &&
      publicFile.startsWith(dashboardPublic + path.sep) &&
      path.extname(publicFile) &&
      fs.existsSync(publicFile)
    ) {
      serveFile(
        response,
        publicFile,
        CONTENT_TYPES[path.extname(publicFile)] || "application/octet-stream",
      );
      return;
    }

    response.setHeader("Content-Type", "text/html");
    response.end(html);
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(
      `Push registration fixture ready at http://127.0.0.1:${port}/dashboard/${PROJECT_ID}/user-settings/notification-methods`,
    );
  });
  process.on("SIGTERM", () => server.close());
  process.on("SIGINT", () => server.close());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
