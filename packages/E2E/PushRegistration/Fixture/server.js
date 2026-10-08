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
 * The browser's push service is stood in for here too (PushServiceStandIn.js,
 * in the page and appended to the worker): one subscription per browser,
 * shared by the page and the worker, that a test can replace or drop the way
 * a push service does.
 *
 * The route the service worker reports a replaced subscription to
 * (/api/user-push/subscription-change) answers only a signed-in session, as
 * every authenticated route does: the access token cookie, which lives for
 * minutes, and /identity/refresh-token, which takes the refresh token cookie,
 * rotates both and sets them again - or, without a valid one, clears them
 * and answers 401, as the real route does. The worker's requests carry the
 * cookies the browser holds for the Dashboard, or they do not get through.
 *
 * Test hooks:
 *   GET  /__fixture/state                  what was registered and sent
 *   POST /__fixture/reset                  back to one registered phone
 *   POST /__fixture/sw-revision            serve a new version of the service worker
 *   POST /__fixture/sign-in                set the session cookies
 *   POST /__fixture/push-service/replace   the push service replaces this browser's subscription
 *   POST /__fixture/push-service/drop      the push service drops it
 *   POST /__fixture/push-service/gone      a send to it came back 410: its devices stop being verified
 */
const fs = require("fs");
const crypto = require("crypto");
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

// The Dashboard's session cookies (Common/Types/CookieName.ts).
const ACCESS_TOKEN_COOKIE = "user-token";
const REFRESH_TOKEN_COOKIE = "user-refresh-token";

const pushServiceStandIn = fs.readFileSync(
  path.join(__dirname, "PushServiceStandIn.js"),
  "utf8",
);

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

// The <script> after "PWA Service Worker Registration" in index.ejs, as is.
function readIndexServiceWorkerScript() {
  const source = fs.readFileSync(
    path.join(dashboard, "views/index.ejs"),
    "utf8",
  );
  const marker = source.indexOf("<!-- PWA Service Worker Registration -->");
  if (marker === -1) {
    throw new Error("index.ejs has no PWA Service Worker Registration script");
  }
  const start = source.indexOf("<script>", marker) + "<script>".length;
  const end = source.indexOf("</script>", start);
  return source.slice(start, end);
}

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Push registration</title><script>window.process={env:{HOST:"127.0.0.1:${port}",HTTP_PROTOCOL:"http",BILLING_ENABLED:"false",VERSION:"1.0.0",NODE_ENV:"development",VAPID_PUBLIC_KEY:"${VAPID_PUBLIC_KEY}"}};window.global=window;</script><script src="/tailwind.js"></script><style>body{margin:0;background:#f8fafc;font-family:Inter,ui-sans-serif,system-ui,sans-serif}*{box-sizing:border-box}</style></head><body><div id="root"></div><script type="module" src="/dist/Fixture.js"></script><script>${readIndexServiceWorkerScript()}</script></body></html>`;

let state;
let serviceWorkerRevision = 0;

// The session the access and refresh token cookies have to match, or null: signed out.
let session;

// The one push subscription this browser has, as the push service holds it, or null.
let browserSubscription;
let subscriptionsIssued;

function reset() {
  state = {
    devices: [
      {
        id: PHONE_DEVICE_ID,
        deviceName: "iPhone 14 Pro Max",
        deviceToken: "ExponentPushToken[fixture-phone]",
        isVerified: true,
        createdAt: "2026-09-10T12:33:00.000Z",
      },
    ],
    registrations: [],
    testNotifications: [],
    // What reached /api/user-push/subscription-change, and the answer.
    subscriptionChanges: [],
    // What reached /identity/refresh-token, and the answer.
    sessionRefreshes: [],
    // Each subscription the push service issued: to whom, for which server key.
    subscribes: [],
  };
  session = null;
  browserSubscription = null;
  subscriptionsIssued = 0;
}

/*
 * The first subscription is the one the suite has always registered; each
 * one after it - a replacement - has an endpoint and keys of its own.
 */
function issueSubscription(applicationServerKey) {
  subscriptionsIssued++;

  const suffix = subscriptionsIssued === 1 ? "" : `-${subscriptionsIssued}`;

  browserSubscription = {
    endpoint: `https://fcm.googleapis.com/fcm/send/fixture-browser${suffix}`,
    keys: {
      p256dh: `BFixtureP256dhKey${suffix}`,
      auth: `FixtureAuthSecret${suffix}`,
    },
    applicationServerKey: applicationServerKey,
  };

  return browserSubscription;
}

// What Register Device and the worker send: PushSubscription.toJSON(), stringified.
function toDeviceToken(subscription) {
  return JSON.stringify({
    endpoint: subscription.endpoint,
    expirationTime: null,
    keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
  });
}

function subscribe(body) {
  const key = Array.isArray(body.applicationServerKey)
    ? body.applicationServerKey
    : [];

  if (key.length === 0) {
    return [
      400,
      {
        name: "InvalidAccessError",
        message: "The provided applicationServerKey is not valid.",
      },
    ];
  }

  if (browserSubscription) {
    // As a browser does: one subscription per registration, for one key.
    if (browserSubscription.applicationServerKey.join() !== key.join()) {
      return [
        400,
        {
          name: "InvalidStateError",
          message:
            "A subscription with a different applicationServerKey already exists.",
        },
      ];
    }

    return [200, browserSubscription];
  }

  state.subscribes.push({
    subscriber: body.subscriber,
    applicationServerKey: key,
  });

  return [200, issueSubscription(key)];
}

function readCookies(request) {
  const cookies = {};

  for (const part of (request.headers.cookie || "").split(";")) {
    const separator = part.indexOf("=");

    if (separator > 0) {
      cookies[part.slice(0, separator).trim()] = decodeURIComponent(
        part.slice(separator + 1).trim(),
      );
    }
  }

  return cookies;
}

// As CookieUtil sets them: the whole site, SameSite lax, out of the page's reach.
function sessionCookies(values) {
  return Object.keys(values).map((name) => {
    return values[name] === null
      ? `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
      : `${name}=${encodeURIComponent(values[name])}; Path=/; HttpOnly; SameSite=Lax`;
  });
}

function signIn(response) {
  session = {
    accessToken: crypto.randomUUID(),
    refreshToken: crypto.randomUUID(),
  };

  response.setHeader(
    "Set-Cookie",
    sessionCookies({
      [ACCESS_TOKEN_COOKIE]: session.accessToken,
      [REFRESH_TOKEN_COOKIE]: session.refreshToken,
    }),
  );
}

function refreshSession(request, response) {
  const refreshToken = readCookies(request)[REFRESH_TOKEN_COOKIE];

  if (!session || !refreshToken || refreshToken !== session.refreshToken) {
    state.sessionRefreshes.push({ status: 401 });
    response.setHeader(
      "Set-Cookie",
      sessionCookies({
        [ACCESS_TOKEN_COOKIE]: null,
        [REFRESH_TOKEN_COOKIE]: null,
      }),
    );

    return [401, { message: "Session expired. Please login again." }];
  }

  state.sessionRefreshes.push({ status: 200 });
  signIn(response);

  return [200, {}];
}

function isSignedIn(request) {
  const accessToken = readCookies(request)[ACCESS_TOKEN_COOKIE];

  return Boolean(session && accessToken && accessToken === session.accessToken);
}

/*
 * POST /user-push/subscription-change, as UserPushAPI answers it for the one
 * person and project here: the devices registered with the old subscription
 * carry the new one, or stop being verified when there is none; a device
 * registered again with the new one keeps it, and the old one is retired.
 */
function changeSubscription(request, body) {
  const answer = (status, json) => {
    state.subscriptionChanges.push({ status: status, body: body });
    return [status, json];
  };

  if (!isSignedIn(request)) {
    return answer(401, {
      message: "AccessToken is invalid or expired. Please refresh your token.",
    });
  }

  if (!body.oldDeviceToken || typeof body.oldDeviceToken !== "string") {
    return answer(400, { message: "oldDeviceToken is required" });
  }

  if (body.newDeviceToken === undefined) {
    return answer(400, { message: "newDeviceToken is required" });
  }

  const devices = state.devices.filter((device) => {
    return device.deviceToken === body.oldDeviceToken;
  });

  if (body.newDeviceToken === null) {
    for (const device of devices) {
      device.isVerified = false;
    }

    return answer(200, { success: true, devicesUpdated: devices.length });
  }

  const isRegisteredAgain = state.devices.some((device) => {
    return device.deviceToken === body.newDeviceToken;
  });

  let renewed = 0;

  for (const device of devices) {
    if (isRegisteredAgain) {
      device.isVerified = false;
      continue;
    }

    device.deviceToken = body.newDeviceToken;
    device.isVerified = true;
    renewed++;
  }

  return answer(200, { success: true, devicesUpdated: renewed });
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
      {
        success: true,
        deviceId: existing.id,
        alreadyRegistered: true,
        isVerified: existing.isVerified,
      },
    ];
  }

  const id = `30000000-0000-4000-8000-${String(state.devices.length).padStart(12, "0")}`;

  state.devices.push({
    id: id,
    deviceName: body.deviceName,
    deviceToken: body.deviceToken,
    isVerified: true,
    createdAt: new Date().toISOString(),
  });

  return [
    200,
    { success: true, deviceId: id, alreadyRegistered: false, isVerified: true },
  ];
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
      sendJson(response, 200, {
        ...state,
        browserSubscription: browserSubscription
          ? toDeviceToken(browserSubscription)
          : null,
      });
      return;
    }

    if (url.pathname === "/__fixture/sign-in" && request.method === "POST") {
      signIn(response);
      sendJson(response, 200, { ok: true });
      return;
    }

    if (url.pathname === "/__fixture/push-service/subscription") {
      sendJson(response, 200, browserSubscription);
      return;
    }

    if (
      url.pathname === "/__fixture/push-service/subscribe" &&
      request.method === "POST"
    ) {
      const [status, body] = subscribe(
        JSON.parse((await readBody(request)) || "{}"),
      );
      sendJson(response, status, body);
      return;
    }

    if (
      url.pathname === "/__fixture/push-service/unsubscribe" &&
      request.method === "POST"
    ) {
      browserSubscription = null;
      sendJson(response, 200, { ok: true });
      return;
    }

    // The push service gives this browser a new subscription in place of the one it had.
    if (
      url.pathname === "/__fixture/push-service/replace" &&
      request.method === "POST"
    ) {
      const oldSubscription = browserSubscription;
      const newSubscription = issueSubscription(
        oldSubscription.applicationServerKey,
      );
      sendJson(response, 200, {
        oldSubscription: oldSubscription,
        newSubscription: newSubscription,
      });
      return;
    }

    // The push service drops it: expired, or notifications blocked.
    if (
      url.pathname === "/__fixture/push-service/drop" &&
      request.method === "POST"
    ) {
      const oldSubscription = browserSubscription;
      browserSubscription = null;
      sendJson(response, 200, { oldSubscription: oldSubscription });
      return;
    }

    /*
     * A page to this browser came back 410 while the browser still holds the
     * subscription: the server stops sending to its devices
     * (UserPushService.markWebPushSubscriptionAsGone).
     */
    if (
      url.pathname === "/__fixture/push-service/gone" &&
      request.method === "POST"
    ) {
      const deviceToken = toDeviceToken(browserSubscription);

      for (const device of state.devices) {
        if (device.deviceToken === deviceToken) {
          device.isVerified = false;
        }
      }

      sendJson(response, 200, { ok: true });
      return;
    }

    if (
      url.pathname === "/identity/refresh-token" &&
      request.method === "POST"
    ) {
      const [status, body] = refreshSession(request, response);
      sendJson(response, status, body);
      return;
    }

    if (
      url.pathname === "/api/user-push/subscription-change" &&
      request.method === "POST"
    ) {
      const [status, body] = changeSubscription(
        request,
        JSON.parse((await readBody(request)) || "{}"),
      );
      sendJson(response, status, body);
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
       * The generated worker, byte for byte, with the push service stand-in
       * after it, until a test asks for a new version; a browser treats any
       * change as one.
       */
      response.setHeader("Content-Type", "application/javascript");
      response.end(
        fs.readFileSync(serviceWorkerFile, "utf8") +
          `\n${pushServiceStandIn}\n` +
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
