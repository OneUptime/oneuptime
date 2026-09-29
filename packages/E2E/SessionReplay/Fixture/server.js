/* The production RUM layout, list and player; only their API data is synthetic. */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { createConfig } = require("../../../Common/UI/esbuild-config.js");
const esbuild = require("../../../Common/node_modules/esbuild");
const repository = path.resolve(__dirname, "../../../..");
const output = path.join(
  repository,
  "output/playwright/session-replay-ui/fixture",
);
const port = Number(process.env.SESSION_REPLAY_FIXTURE_PORT || 4212);
/*
 * The site the recording was made on, for ?assets=site (Fixture.js). It is
 * a second origin and - localhost against the page's 127.0.0.1 - a
 * different site, so the replay document, which is the Dashboard's origin,
 * fetches the recorded page's images, stylesheet and fonts cross-site, as
 * it does from a real recorded site. Bound to 127.0.0.1 like the page;
 * Chromium reaches localhost there.
 */
const assetPort = Number(process.env.SESSION_REPLAY_ASSET_PORT || 4213);
const assetOrigin = `http://localhost:${assetPort}`;
const config = createConfig({
  serviceName: "session-replay-fixture",
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
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Session replay UI regression fixture</title><script>window.process={env:{HOST:"localhost",HTTP_PROTOCOL:"http",BILLING_ENABLED:"false",VERSION:"1.0.0",NODE_ENV:"development"}};window.global=window;window.__sessionReplayAssetOrigin=${JSON.stringify(assetOrigin)};</script><script src="/tailwind.js"></script><style>body{margin:0;background:#f8fafc;font-family:Inter,ui-sans-serif,system-ui,sans-serif}*{box-sizing:border-box}</style></head><body><div id="root"></div><script type="module" src="/dist/Fixture.js"></script></body></html>`;
/*
 * The page's own policy. The replay iframe is about:blank, so it inherits
 * this policy on top of the one the stage puts in it: both are enforced.
 * font-src names the recorded site because otherwise it, and not the
 * replay's policy, would be what refuses the recorded page's web fonts -
 * and connect-src 'self' is why the connect probe below is on this origin:
 * only the replay's own connect-src 'none' refuses a fetch to it.
 */
const pageContentSecurityPolicy = `connect-src 'self'; font-src 'self' data: ${assetOrigin};`;

/* ---- The recorded site. ---- */

const svg = (width, height, fill) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${fill}"/></svg>`;
/* A real font, committed with the Dashboard, so FontFace can say "loaded". */
const fontBytes = fs.readFileSync(
  path.join(
    repository,
    "packages/App/FeatureSet/Dashboard/public/assets/fonts/CourierPrime-Regular.woff2",
  ),
);
const allowAnyOrigin = { "Access-Control-Allow-Origin": "*" };
/*
 * Everything the recorded site serves, under /replay-assets/<name>, and
 * nothing else: an unknown name is a 404, never the fixture's HTML, so an
 * address the recording means to fail fails the way it would on a real
 * site. Images are flat SVGs with an explicit size, so a spec tells one
 * that loaded by its natural size. site.css is the stylesheet the recorder
 * could not read (kept as a <link>): it hides the offline banner, as the
 * Power Pages sheet in #4119 does, colours the nav and declares one web
 * font served with CORS and one served without it. corp.svg is served to
 * its own site only. The media clip, the framed page and the beacon are
 * what the replay must never fetch; they exist, as they would on a real
 * site, so a request for one would succeed - the log is what shows that
 * none was made.
 */
const assets = new Map([
  ["logo.svg", { type: "image/svg+xml", body: () => svg(120, 32, "#1d4ed8") }],
  ["web.svg", { type: "image/svg+xml", body: () => svg(16, 16, "#111827") }],
  ["close.svg", { type: "image/svg+xml", body: () => svg(16, 16, "#374151") }],
  ["late.svg", { type: "image/svg+xml", body: () => svg(30, 30, "#16a34a") }],
  [
    "background.svg",
    { type: "image/svg+xml", body: () => svg(40, 40, "#f59e0b") },
  ],
  [
    "inline-style-bg.svg",
    { type: "image/svg+xml", body: () => svg(40, 40, "#0ea5e9") },
  ],
  [
    "corp.svg",
    {
      type: "image/svg+xml",
      body: () => svg(24, 24, "#7c2d12"),
      headers: { "Cross-Origin-Resource-Policy": "same-origin" },
    },
  ],
  [
    "held.svg",
    {
      type: "image/svg+xml",
      body: () => svg(120, 60, "#0f766e"),
      isHeld: true,
    },
  ],
  [
    "site.css",
    {
      type: "text/css",
      body: (run) => {
        const tag = encodeURIComponent(run);

        return (
          `@font-face{font-family:"FixtureCorsFont";src:url("font-cors.woff2?run=${tag}") format("woff2")}` +
          `@font-face{font-family:"FixturePortalFont";src:url("font-portal.woff2?run=${tag}") format("woff2")}` +
          ".offline-banner{display:none}" +
          "#fixture-asset-nav{color:rgb(1, 2, 3)}" +
          '.fixture-cors-font{font-family:"FixtureCorsFont",monospace}' +
          '.fixture-portal-font{font-family:"FixturePortalFont",monospace}'
        );
      },
    },
  ],
  [
    "font-cors.woff2",
    { type: "font/woff2", body: () => fontBytes, headers: allowAnyOrigin },
  ],
  ["font-portal.woff2", { type: "font/woff2", body: () => fontBytes }],
  [
    "font-inline.woff2",
    { type: "font/woff2", body: () => fontBytes, headers: allowAnyOrigin },
  ],
  ["clip.mp3", { type: "audio/mpeg", body: () => Buffer.alloc(64) }],
  [
    "frame.html",
    { type: "text/html", body: () => "<!doctype html><p>framed</p>" },
  ],
  [
    "beacon.gif",
    {
      type: "image/gif",
      body: () =>
        Buffer.from(
          "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
          "base64",
        ),
    },
  ],
]);
/*
 * Every request the recorded site received, and every connect probe, for
 * /__fixture/asset-log. An entry is written before its response goes out,
 * so an image that has loaded or failed in the page is already in here.
 * Specs tag their addresses with &run= and read back only their own.
 */
const assetLog = [];
function logRequest(request, url, origin, status) {
  assetLog.push({
    origin,
    path: url.pathname,
    query: url.search,
    run: url.searchParams.get("run"),
    from: url.searchParams.get("from"),
    referer: request.headers.referer ?? null,
    secFetchDest: request.headers["sec-fetch-dest"] ?? null,
    secFetchSite: request.headers["sec-fetch-site"] ?? null,
    status,
  });
}
/*
 * held.svg (?assets=site&hold=image) is answered only once a spec releases
 * its run (/__fixture/asset-release), so a frame can be captured while the
 * stage is still loading an image - with no timing involved.
 */
const heldAnswers = new Map();
const releasedRuns = new Set();
function answerHeld(answers) {
  for (const answer of answers) {
    answer();
  }
}
function serveRecordedSite(request, response) {
  const url = new URL(request.url, assetOrigin);
  const run = url.searchParams.get("run") ?? "";
  const name = url.pathname.startsWith("/replay-assets/")
    ? url.pathname.slice("/replay-assets/".length)
    : "";
  const asset = assets.get(name);
  response.setHeader("Cache-Control", "no-store");
  if (!asset) {
    logRequest(request, url, "asset", 404);
    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("Not found");
    return;
  }
  logRequest(request, url, "asset", 200);
  const answer = () => {
    if (response.destroyed || response.writableEnded) {
      return;
    }
    response.writeHead(200, {
      "Content-Type": asset.type,
      ...(asset.headers || {}),
    });
    response.end(asset.body(run));
  };
  if (!asset.isHeld || releasedRuns.has(run)) {
    answer();
    return;
  }
  if (!heldAnswers.has(run)) {
    heldAnswers.set(run, new Set());
  }
  heldAnswers.get(run).add(answer);
  /* A page that went away has nothing left to answer. */
  response.on("close", () => {
    heldAnswers.get(run)?.delete(answer);
  });
}

/* ---- The Dashboard's origin. ---- */

function serveFixtureEndpoint(request, response, url) {
  const run = url.searchParams.get("run");
  if (url.pathname === "/__fixture/connect-probe") {
    logRequest(request, url, "dashboard", 200);
    response.setHeader("Content-Type", "text/plain");
    response.end("ok");
    return;
  }
  const isLogRead = url.pathname === "/__fixture/asset-log";
  const isRelease = url.pathname === "/__fixture/asset-release";
  if (!isLogRead && !isRelease) {
    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("Not found");
    return;
  }
  if (run === null) {
    response.writeHead(400, { "Content-Type": "text/plain" });
    response.end(`${url.pathname} needs the run it is for: ?run=<token>`);
    return;
  }
  if (isLogRead) {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(assetLog.filter((entry) => entry.run === run)));
    return;
  }
  if (request.method !== "POST") {
    response.writeHead(405, { Allow: "POST" });
    response.end();
    return;
  }
  const answers = heldAnswers.get(run) ?? new Set();
  releasedRuns.add(run);
  heldAnswers.delete(run);
  answerHeld(answers);
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify({ released: answers.size }));
}
function serveFixture(request, response) {
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Security-Policy", pageContentSecurityPolicy);
  if (url.pathname.startsWith("/__fixture/")) {
    serveFixtureEndpoint(request, response, url);
    return;
  }
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
    response.setHeader("Content-Type", "application/javascript");
    fs.createReadStream(file).pipe(response);
    return;
  }
  response.setHeader("Content-Type", "text/html");
  response.end(html);
}
/* A port someone else holds is a failed start, said plainly. */
function listen(server, listenPort, onListening) {
  server.once("error", (error) => {
    console.error(
      error.code === "EADDRINUSE"
        ? `Port ${listenPort} is already in use; stop whatever holds it (an earlier fixture server?) and start again.`
        : error,
    );
    process.exit(1);
  });
  server.listen(listenPort, "127.0.0.1", onListening);
}
async function main() {
  fs.mkdirSync(output, { recursive: true });
  await esbuild.build(config);
  const assetServer = http.createServer(serveRecordedSite);
  const server = http.createServer(serveFixture);
  /* The recorded site first: once the page answers, the site does too. */
  listen(assetServer, assetPort, () => {
    listen(server, port, () =>
      console.log(
        `Session replay fixture ready on ${port} (recorded site ${assetOrigin})`,
      ),
    );
  });
  const close = () => {
    for (const answers of heldAnswers.values()) {
      answerHeld(answers);
    }
    heldAnswers.clear();
    server.close();
    assetServer.close();
  };
  process.on("SIGTERM", close);
  process.on("SIGINT", close);
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
