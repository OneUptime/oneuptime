/*
 * Offline fixture server for an OpenStack cloud's pages: the production cloud
 * layout and side menu with its Overview, lists and part pages, with the data
 * boundary stubbed. No app or API server.
 *
 * Two things this bundle does that other fixtures do not, so the pages are read
 * on what a real cloud says rather than on what someone remembers it saying:
 *
 *  - every exporter recording in Common/Tests/Fixtures/OpenStack goes in as the
 *    module "openstack-recordings", so a new recording needs no change here;
 *  - the real snapshot scan runs in the page (Fixture/Recordings.js). It only
 *    logs on a bad timestamp, and the server's logger pulls in OpenTelemetry's
 *    server packages, so it gets a quiet stand-in (Fixture/ScanLogger.js).
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { createConfig } = require("../../../Common/UI/esbuild-config.js");
const esbuild = require("../../../Common/node_modules/esbuild");
const repository = path.resolve(__dirname, "../../../..");
/*
 * Where the bundle goes. Its own folder when set, so two runs of this suite side by side
 * (each on its own OPENSTACK_PAGES_FIXTURE_PORT) never read each other's half-written one.
 */
const output =
  process.env.OPENSTACK_PAGES_FIXTURE_OUTPUT ||
  path.join(repository, "output/playwright/openstack-pages-ui/fixture");
const recordings = path.join(
  repository,
  "packages/Common/Tests/Fixtures/OpenStack",
);
const port = Number(process.env.OPENSTACK_PAGES_FIXTURE_PORT || 4662);

// { "gazpacho-ovs/compute-down": { "compute.prom": "...", ... }, ... }
function readRecordings() {
  const read = {};
  for (const release of fs.readdirSync(recordings)) {
    const releaseFolder = path.join(recordings, release);
    if (!fs.statSync(releaseFolder).isDirectory()) {
      continue;
    }
    for (const scene of fs.readdirSync(releaseFolder)) {
      const exporter = path.join(releaseFolder, scene, "exporter");
      if (!fs.existsSync(exporter) || !fs.statSync(exporter).isDirectory()) {
        continue;
      }
      const files = {};
      for (const file of fs.readdirSync(exporter).sort()) {
        if (file.endsWith(".prom")) {
          files[file] = fs.readFileSync(path.join(exporter, file), "utf8");
        }
      }
      if (Object.keys(files).length > 0) {
        read[`${release}/${scene}`] = files;
      }
    }
  }
  return read;
}

const recordingsPlugin = {
  name: "openstack-recordings",
  setup(build) {
    build.onResolve({ filter: /^openstack-recordings$/ }, (args) => {
      return { path: args.path, namespace: "openstack-recordings" };
    });
    build.onLoad(
      { filter: /.*/, namespace: "openstack-recordings" },
      () => {
        return {
          contents: JSON.stringify(readRecordings()),
          loader: "json",
        };
      },
    );
    build.onResolve({ filter: /^\.\.\/Logger$/ }, (args) => {
      return args.importer.endsWith("OpenStackSnapshotScan.ts")
        ? { path: path.join(__dirname, "ScanLogger.js") }
        : undefined;
    });
  },
};

const config = createConfig({
  serviceName: "openstack-pages-fixture",
  publicPath: "/dist/",
  entryPoint: path.join(__dirname, "Fixture.js"),
  outdir: output,
  additionalPlugins: [recordingsPlugin],
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
/*
 * The Dashboard's own packages are not installed for the browser suites: what its
 * pages import beyond Common (use-async-effect, ...) comes from Common's.
 */
config.nodePaths = [path.join(repository, "packages/Common/node_modules")];
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
 * EVERY element Inter with a universal `*` rule.
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
 * leaves this server. Billing is off, as on a self-hosted server.
 */
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenStack pages preview</title><script>(function(){var query=new URLSearchParams(location.search);window.process={env:{HOST:"oneuptime.acme-cloud.example",HTTP_PROTOCOL:"https",BILLING_ENABLED:"false",VERSION:"1.0.0",NODE_ENV:"development"}};window.global=window;if(query.get("theme")==="dark"){document.documentElement.classList.add("dark")}})();</script><script src="/tailwind.js"></script><script src="/tailwind-reading-direction.js"></script><script>${tailwindConfig}</script><style>${fontRules}body{margin:0;background:#f9fafb}*{box-sizing:border-box}</style><link rel="stylesheet" href="/theme.css"></head><body><div id="root"></div><script type="module" src="/dist/Fixture.js"></script></body></html>`;

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
      `OpenStack pages fixture ready at http://127.0.0.1:${port}/dashboard/10000000-0000-4000-8000-000000000001/openstack/71000000-0000-4000-8000-000000000001`,
    );
  });
  process.on("SIGTERM", () => server.close());
  process.on("SIGINT", () => server.close());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
