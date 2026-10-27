/*
 * Offline fixture server for a new version deployed under an open tab. No
 * app or API server needed.
 *
 * It builds Fixture/Index.js twice with Common's own build() - the one every
 * frontend's esbuild.config.js calls, which names the build, writes the id
 * into the bundle and writes dist/build.json beside it - as build A and
 * build B, each page's chunk different in each (__FIXTURE_BUILD__), and
 * serves one build under /dashboard as the App does: the bundle's files
 * from its dist/, a missing one answered 404, every other address the page.
 *
 * The spec drives it over /__fixture/: deploy (switch to the other build,
 * as a deploy replaces the files), server (up, down - the connection
 * dropped - or unavailable - 503, a server restarting), missing (a chunk
 * gone for good, whichever build is served), entry (missing: the entry
 * bundle itself answered 404, so the app cannot start), slow-documents (hold
 * the page itself back), hold-documents (answer the page 204, which leaves
 * the browser on the page it has - so what a page shows as it starts a
 * reload stays on screen to be looked at) and stats (how many times the
 * page, the entry and build.json were asked for, and the page's last
 * address).
 *
 * The page carries what every frontend's index.ejs carries right after its
 * root: Common/Server/Views/Partials/EntryLoadFailure.ejs, rendered as it
 * is, which says what is wrong when the entry does not load.
 */
const fs = require("fs");
const http = require("http");
const path = require("path");

// A production build, as the images ship: minified, React in production mode.
process.env.NODE_ENV = "production";

const { createConfig, build } = require("../../../Common/UI/esbuild-config.js");
const ejs = require("../../../Common/node_modules/ejs");

const repository = path.resolve(__dirname, "../../../..");
const output = path.join(
  repository,
  "output/playwright/new-version-ui/fixture",
);
const port = Number(process.env.NEW_VERSION_FIXTURE_PORT || 4618);

const BUILD_IDS = { a: "fixture-build-a", b: "fixture-build-b" };

// The longest slow-documents may hold a page back; any other value holds nothing.
const MAX_SLOW_DOCUMENTS_IN_MS = 30000;

// The Dashboard's own font, so screenshots are drawn as the product draws them.
const font = path.join(
  repository,
  "packages/Common/Server/Static/Vendor/fonts/InterVariable.woff2",
);

/*
 * The new-version screens' strings, from the Dashboard's own locale files,
 * for the languages the spec draws them in.
 */
const LANGUAGES = ["de", "fa", "ja"];

const STRINGS = [
  "OneUptime has been updated",
  "The next page you open loads the new version.",
  "Reload now? Changes you haven't saved on this page will be lost.",
  "Reload anyway",
  "Reload",
  "Cancel",
  "Dismiss",
  "Updating to the new version",
  "OneUptime was updated while you had it open. This page will open in the new version in a moment.",
  "A new version of OneUptime is ready",
  "This page needs the new version to open. Reloading discards changes you haven't saved.",
  "You're offline",
  "This page will come back as soon as you're online again, just as you left it.",
  "This page needs an internet connection to load. It will load as soon as you're back online.",
  "Can't reach the server",
  "It may be restarting after an update. This page will load as soon as the server is back.",
  "This page couldn't be loaded",
  "A file it needs couldn't be downloaded from the server. Try reloading in a moment.",
  "Try now",
  "Try again",
  "Reload page",
  "Loading",
  "Loading...",
  "Loading the latest version",
  "A newer version of this page is available. It's loading now.",
  "A newer version of this page is ready",
  "Loading the latest version...",
  "You're offline. This will load when you're back online.",
  "Can't reach the server. Trying again automatically.",
  "This needs the latest version. Save your changes, then reload the page.",
  "This couldn't be loaded.",
  "Still stuck?",
  "Download support bundle",
  "Error details",
];

function writeLocales() {
  const locales = {};

  for (const language of LANGUAGES) {
    const all = JSON.parse(
      fs.readFileSync(
        path.join(
          repository,
          "packages/App/FeatureSet/Dashboard/src/Locales",
          `${language}.json`,
        ),
        "utf8",
      ),
    );

    locales[language] = {};

    for (const key of STRINGS) {
      if (typeof all[key] === "string") {
        locales[language][key] = all[key];
      }
    }
  }

  const file = path.join(output, "locales.json");
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(locales));

  return file;
}

async function buildOne(label, localesFile) {
  process.env.ONEUPTIME_FRONTEND_BUILD_ID = BUILD_IDS[label];

  const config = createConfig({
    serviceName: `new-version-fixture-${label}`,
    publicPath: "/dashboard/dist/",
    entryPoint: path.join(__dirname, "Index.js"),
    outdir: path.join(output, `build-${label}`, "dist"),
    additionalAlias: {
      Common: path.join(repository, "packages/Common"),
      react: path.join(repository, "packages/Common/node_modules/react"),
      "react-dom": path.join(
        repository,
        "packages/Common/node_modules/react-dom",
      ),
      "new-version-fixture-locales": localesFile,
    },
  });

  config.target = "es2022";
  config.loader[".js"] = "jsx";
  config.sourcemap = false;
  config.logLevel = "warning";
  config.define = {
    ...config.define,
    __FIXTURE_BUILD__: JSON.stringify(label.toUpperCase()),
  };

  await build(config, `new-version-fixture-${label}`);
}

const state = {
  build: "a",
  server: "up",
  missing: "",
  entry: "ok",
  slowDocumentsInMs: 0,
  holdDocuments: false,
  stats: { documents: 0, manifests: 0, entries: 0, lastDocument: "" },
};

function reset() {
  state.build = "a";
  state.server = "up";
  state.missing = "";
  state.entry = "ok";
  state.slowDocumentsInMs = 0;
  state.holdDocuments = false;
  state.stats = { documents: 0, manifests: 0, entries: 0, lastDocument: "" };
}

/*
 * What every frontend's index.ejs includes right after its root. The
 * language it speaks in is the page's (<html lang>, which the page's first
 * script sets from ?lang=), as a status page's is.
 */
const entryLoadFailurePartial = path.join(
  repository,
  "packages/Common/Server/Views/Partials/EntryLoadFailure.ejs",
);
const entryLoadFailure = ejs.render(
  fs.readFileSync(entryLoadFailurePartial, "utf8"),
  { usesPageLanguage: true },
  { filename: entryLoadFailurePartial },
);

/*
 * The page, as the Dashboard's index.ejs draws it before its bundle: the
 * theme applied before the first paint (?theme=dark, kept for the tab) - a
 * dark page's background painted before any stylesheet arrives, as
 * Common/Server/Views/Partials/Theme.ejs paints it, so a page whose app never
 * started is dark too - the language's direction, Tailwind, Inter and the
 * env the bundle reads.
 */
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>New version</title><script>(function(){var params=new URLSearchParams(window.location.search);var saved={};try{saved=JSON.parse(window.sessionStorage.getItem("new-version-fixture-page")||"{}")}catch(e){}var theme=params.get("theme")||saved.theme||"light";var lang=params.get("lang")||saved.lang||"en";window.sessionStorage.setItem("new-version-fixture-page",JSON.stringify({theme:theme,lang:lang}));if(theme==="dark"){document.documentElement.classList.add("dark");}document.documentElement.lang=lang;document.documentElement.dir=lang==="fa"?"rtl":"ltr";})();window.process={env:{HOST:"localhost",HTTP_PROTOCOL:"http",BILLING_ENABLED:"false",VERSION:"1.0.0"}};window.global=window;</script><script src="/dashboard/assets/js/tailwind-3.4.5.js"></script><script src="/dashboard/assets/js/tailwind-reading-direction.js"></script><script>tailwind.config={darkMode:"class",theme:{extend:{fontFamily:{display:["Inter","sans-serif"],body:["Inter","sans-serif"]}}}};</script><style>@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:block;src:url('/dashboard/assets/fonts/InterVariable.woff2') format('woff2');}html,body{margin:0;background:var(--ou-background-primary,#f9fafb)}html.dark,html.dark body{background:var(--ou-background-primary,#0f172a)}*{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}</style></head><body><div id="root"></div>${entryLoadFailure}<script type="module" src="/dashboard/dist/Index.js"></script></body></html>`;

function readBody(request) {
  return new Promise((resolve) => {
    request.on("data", () => {});
    request.on("end", resolve);
  });
}

function contentTypeOf(file) {
  if (file.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }

  if (file.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }

  return "application/javascript; charset=utf-8";
}

async function handleControl(url, request, response) {
  await readBody(request);

  const command = url.pathname.slice("/__fixture/".length);

  if (command === "reset") {
    reset();
  } else if (command === "deploy") {
    state.build = url.searchParams.get("build") === "b" ? "b" : "a";
  } else if (command === "server") {
    state.server = url.searchParams.get("state") || "up";
  } else if (command === "missing") {
    state.missing = url.searchParams.get("chunk") || "";
  } else if (command === "entry") {
    state.entry =
      url.searchParams.get("state") === "missing" ? "missing" : "ok";
  } else if (command === "slow-documents") {
    const ms = Number(url.searchParams.get("ms") || "0");
    state.slowDocumentsInMs = 0;

    if (ms > 0 && ms <= MAX_SLOW_DOCUMENTS_IN_MS) {
      state.slowDocumentsInMs = ms;
    }
  } else if (command === "hold-documents") {
    state.holdDocuments = url.searchParams.get("on") === "1";
  } else if (command !== "stats") {
    response.writeHead(404).end();
    return;
  }

  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(state));
}

async function main() {
  reset();
  const localesFile = writeLocales();

  await buildOne("a", localesFile);
  await buildOne("b", localesFile);

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);

    if (url.pathname.startsWith("/__fixture/")) {
      await handleControl(url, request, response);
      return;
    }

    const isBundleFile = url.pathname.startsWith("/dashboard/dist/");
    const isManifest = url.pathname === "/dashboard/dist/build.json";

    if (isManifest) {
      state.stats.manifests++;
    }

    const isEntry = url.pathname === "/dashboard/dist/Index.js";

    if (isEntry) {
      state.stats.entries++;
    }

    if (state.server === "down" && isBundleFile) {
      // The connection drops: no answer at all.
      request.socket.destroy();
      return;
    }

    if (state.server === "unavailable" && isBundleFile) {
      response.writeHead(503, {
        "Content-Type": "text/plain",
        "Cache-Control": "no-store",
      });
      response.end("Service Unavailable");
      return;
    }

    const buildDirectory = path.join(output, `build-${state.build}`);

    if (url.pathname === "/dashboard/assets/fonts/InterVariable.woff2") {
      response.setHeader("Content-Type", "font/woff2");
      fs.createReadStream(font).pipe(response);
      return;
    }

    if (url.pathname === "/dashboard/assets/js/tailwind-3.4.5.js") {
      response.setHeader("Content-Type", "application/javascript");
      fs.createReadStream(
        path.join(buildDirectory, "assets/js/tailwind-3.4.5.js"),
      ).pipe(response);
      return;
    }

    // Copied beside the runtime by the build, as index.ejs loads it.
    if (url.pathname === "/dashboard/assets/js/tailwind-reading-direction.js") {
      response.setHeader("Content-Type", "application/javascript");
      fs.createReadStream(
        path.join(buildDirectory, "assets/js/tailwind-reading-direction.js"),
      ).pipe(response);
      return;
    }

    if (isBundleFile) {
      const distDirectory = path.join(buildDirectory, "dist");
      const name = url.pathname.slice("/dashboard/dist/".length);
      const file = path.resolve(distDirectory, name);

      const isGoneForGood =
        (state.missing !== "" && name.startsWith(`${state.missing}-`)) ||
        (isEntry && state.entry === "missing");

      if (
        isGoneForGood ||
        !file.startsWith(distDirectory + path.sep) ||
        !fs.existsSync(file)
      ) {
        // As the App answers a bundle file it does not have.
        response.writeHead(404, {
          "Content-Type": "text/plain",
          "Cache-Control": "no-store",
        });
        response.end("Not found");
        return;
      }

      response.setHeader("Content-Type", contentTypeOf(file));
      /*
       * As nginx serves them: a content-hashed chunk is kept for a year, the
       * entry and build.json never.
       */
      response.setHeader(
        "Cache-Control",
        /-[A-Z0-9]{8,}\.(js|css)$/.test(name)
          ? "public, max-age=31536000, immutable"
          : "no-store",
      );
      fs.createReadStream(file).pipe(response);
      return;
    }

    if (url.pathname.startsWith("/dashboard")) {
      state.stats.documents++;
      state.stats.lastDocument = `${url.pathname}${url.search}`;

      if (state.holdDocuments) {
        // No content: the browser stays on the page it has.
        response.writeHead(204, { "Cache-Control": "no-store" });
        response.end();
        return;
      }

      if (state.slowDocumentsInMs > 0) {
        await new Promise((resolve) => {
          setTimeout(resolve, state.slowDocumentsInMs);
        });
      }

      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.end(html);
      return;
    }

    response.writeHead(302, { Location: "/dashboard/home" });
    response.end();
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(
      `New version fixture ready at http://127.0.0.1:${port}/dashboard/home`,
    );
  });

  process.on("SIGTERM", () => server.close());
  process.on("SIGINT", () => server.close());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
