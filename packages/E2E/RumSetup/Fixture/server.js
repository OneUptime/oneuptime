/*
 * Offline fixture server for a RUM application's setup surfaces (issues
 * #6379, #6457, #6458): its Overview, Logs and Documentation pages
 * (Fixture.js), bundled with the app's esbuild config and drawn with the
 * Dashboard's Tailwind runtime, its reading-direction config
 * (Common/UI/Styles/TailwindReadingDirection.js), Theme.css and font. No
 * app, database or Docker stack.
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { createConfig } = require("../../../Common/UI/esbuild-config.js");
const {
  dashboardLocalesPlugin,
} = require("../../SuiteHelpers/FixtureLocalesBuild.js");
const esbuild = require("../../../Common/node_modules/esbuild");

const repository = path.resolve(__dirname, "../../../..");
const common = path.join(repository, "packages/Common");
const dashboard = path.join(repository, "packages/App/FeatureSet/Dashboard");
const output = path.join(repository, "output/playwright/rum-setup-ui/fixture");
const port = Number(process.env.RUM_SETUP_FIXTURE_PORT || 4379);

const config = createConfig({
  serviceName: "rum-setup-fixture",
  publicPath: "/dist/",
  entryPoint: path.join(__dirname, "Fixture.js"),
  outdir: output,
  additionalAlias: {
    Common: common,
    react: path.join(common, "node_modules/react"),
    "react-dom": path.join(common, "node_modules/react-dom"),
  },
  // The locales as the Dashboard's own build ships them (#8366).
  additionalPlugins: [dashboardLocalesPlugin()],
});
config.target = "es2022";
config.loader[".js"] = "jsx";
config.sourcemap = false;
config.minify = false;
config.logLevel = "warning";
config.nodePaths = [
  path.join(common, "node_modules"),
  path.join(dashboard, "node_modules"),
];

const tailwind = path.join(
  common,
  "Server/Static/Vendor/tailwind/tailwind-3.4.5.js",
);
// What every index.ejs loads right after the runtime.
const readingDirection = path.join(
  common,
  "UI/Styles/TailwindReadingDirection.js",
);
// The Dashboard's own font, so the pages are measured as they are drawn.
const font = path.join(
  common,
  "Server/Static/Vendor/fonts/InterVariable.woff2",
);
// Avatars load from /api/user/profile-picture/:userId: the blank picture.
const blankProfilePicture = path.join(
  common,
  "UI/Images/users/blank-profile.svg",
);

/*
 * The head the Dashboard's views/index.ejs writes: the Tailwind runtime and
 * the reading-direction config after it, the same tailwind.config
 * (class-based dark mode), Inter as @font-face and the `*` rule that draws
 * every element in it. ?theme=dark adds the class on <html> that Theme.css
 * reads. HOST is a made-up domain nothing is fetched from: it is the
 * address the setup guides print.
 */
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RUM setup preview</title><script>window.process={env:{HOST:"oneuptime.acme-shop.example",HTTP_PROTOCOL:"https",BILLING_ENABLED:"false",VERSION:"1.0.0",NODE_ENV:"development"}};window.global=window;if(new URLSearchParams(window.location.search).get("theme")==="dark"){document.documentElement.classList.add("dark");}</script><script src="/tailwind.js"></script><script src="/tailwind-reading-direction.js"></script><script>tailwind.config={darkMode:"class",theme:{extend:{fontFamily:{display:["Inter","sans-serif"],body:["Inter","sans-serif"]}}}};</script><style>@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:block;src:url('/fonts/InterVariable.woff2') format('woff2');}html,body{margin:0;background-color:#f9fafb}html.dark,html.dark body{background-color:#0f172a}*{box-sizing:border-box;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}</style></head><body class="h-full bg-gray-50"><div id="root"></div><script type="module" src="/dist/Fixture.js"></script></body></html>`;

async function main() {
  fs.mkdirSync(output, { recursive: true });
  await esbuild.build(config);

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
        file.endsWith(".css")
          ? "text/css"
          : file.endsWith(".json")
            ? "application/json"
            : "application/javascript",
      );
      fs.createReadStream(file).pipe(response);
      return;
    }
    if (url.pathname.startsWith("/api/user/profile-picture/")) {
      response.setHeader("Content-Type", "image/svg+xml");
      fs.createReadStream(blankProfilePicture).pipe(response);
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
      `RUM setup fixture ready at http://127.0.0.1:${port}/dashboard/10000000-0000-4000-8000-000000006379/rum/20000000-0000-4000-8000-000000006379/documentation`,
    );
  });
  process.on("SIGTERM", () => server.close());
  process.on("SIGINT", () => server.close());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
