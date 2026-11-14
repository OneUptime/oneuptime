/* Serve the production products menu and Dashboard catalog in isolation. */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { createConfig } = require("../../Common/UI/esbuild-config.js");
const esbuild = require("../../Common/node_modules/esbuild");
const repository = path.resolve(__dirname, "../../..");
const output = path.join(
  repository,
  "output/playwright/navigation-search/fixture",
);
// NAVIGATION_SEARCH_PORT lets a second checkout run the suite beside this one.
const port = Number(process.env["NAVIGATION_SEARCH_PORT"]) || 4242;
const config = createConfig({
  serviceName: "navigation-search-fixture",
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
/*
 * HOST is this server, so the Dashboard's API requests stay on the page's
 * origin (connect-src 'self'): the navbar asks for the project's products
 * (/api/project-products, issue #6814), answered below with nothing hidden
 * and nothing pinned unless a spec answers it itself (page.route). Left and
 * right follow the reading direction, as every index.ejs loads it.
 */
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Navigation search regression</title><script>window.process={env:{HOST:"127.0.0.1:${port}",HTTP_PROTOCOL:"http",BILLING_ENABLED:"false",VERSION:"1.0.0",NODE_ENV:"development"}};window.global=window;</script><script src="/tailwind.js"></script><script src="/tailwind-reading-direction.js"></script><style>body{margin:0;background:#f8fafc;font-family:Inter,ui-sans-serif,system-ui,sans-serif}*{box-sizing:border-box}</style></head><body><div id="root"></div><script type="module" src="/dist/Fixture.js"></script></body></html>`;

/*
 * ?header=true (HeaderFixture.js) draws the top of a Dashboard page, so its
 * page is the Dashboard's own (views/index.ejs): the same fonts (Inter, and
 * Vazirmatn for Arabic letters, by the very @font-face rules and universal
 * `*` rule index.ejs writes), the reading-direction script that makes left
 * and right follow an Arabic page, its tailwind.config (class-based dark
 * mode) and Theme.css. ?theme=dark adds html.dark, as the theme switch does.
 * What fits in the header at a width depends on those fonts.
 */
const dashboardIndex = fs.readFileSync(
  path.join(repository, "packages/App/FeatureSet/Dashboard/views/index.ejs"),
  "utf8",
);
const INTER_FONT_FACE_PATTERN = /@font-face\s*\{[^}]*'Inter'[^}]*\}/g;
const UNIVERSAL_FONT_RULE_PATTERN = /^\s*\*\s*\{[^}]*\}/m;
const interFontFaces = dashboardIndex.match(INTER_FONT_FACE_PATTERN) || [];
const universalFontRule = dashboardIndex.match(UNIVERSAL_FONT_RULE_PATTERN);

if (interFontFaces.length !== 2 || !universalFontRule) {
  throw new Error(
    "Dashboard index.ejs no longer declares Inter (and Vazirmatn as Inter) and its universal `*` font rule as this fixture reads them",
  );
}

// The font files index.ejs names, served from where production keeps them.
const DASHBOARD_FONTS_PATH = "/dashboard/assets/fonts/";
const fonts = path.join(
  repository,
  "packages/Common/Server/Static/Vendor/fonts",
);
const readingDirection = path.join(
  repository,
  "packages/Common/UI/Styles/TailwindReadingDirection.js",
);
const theme = path.join(repository, "packages/Common/UI/Styles/Theme.css");
const tailwindConfig = `tailwind.config={darkMode:"class",theme:{extend:{fontFamily:{display:["Inter","sans-serif"],body:["Inter","sans-serif"]}}}};`;
const headerHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dashboard header</title><script>window.process={env:{HOST:"localhost",HTTP_PROTOCOL:"http",BILLING_ENABLED:"false",VERSION:"1.0.0",NODE_ENV:"development"}};window.global=window;if(new URLSearchParams(location.search).get("theme")==="dark"){document.documentElement.classList.add("dark")}</script><script src="/tailwind.js"></script><script src="/tailwind-reading-direction.js"></script><script>${tailwindConfig}</script><style>${interFontFaces.join("")}${universalFontRule[0]}body{margin:0;background:#f9fafb}*{box-sizing:border-box}</style><link rel="stylesheet" href="/theme.css"></head><body><div id="root"></div><script type="module" src="/dist/Fixture.js"></script></body></html>`;

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
    if (url.pathname === "/theme.css") {
      response.setHeader("Content-Type", "text/css");
      fs.createReadStream(theme).pipe(response);
      return;
    }
    if (url.pathname.startsWith(DASHBOARD_FONTS_PATH)) {
      const file = path.resolve(
        fonts,
        url.pathname.slice(DASHBOARD_FONTS_PATH.length),
      );
      if (!file.startsWith(fonts + path.sep) || !fs.existsSync(file)) {
        response.writeHead(404).end();
        return;
      }
      response.setHeader("Content-Type", "font/woff2");
      fs.createReadStream(file).pipe(response);
      return;
    }
    // The API: a project with nothing hidden or pinned, and no records.
    if (url.pathname.startsWith("/api/")) {
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify(
          url.pathname === "/api/project-products"
            ? {
                hidden: [],
                chosenBy: null,
                pinned: [],
                usage: {},
                neededPlans: {},
                canChooseProducts: false,
                hiddenWithData: [],
              }
            : { data: [], count: 0, skip: 0, limit: 10 },
        ),
      );
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
    response.end(url.searchParams.get("header") === "true" ? headerHtml : html);
  });
  server.listen(port, "127.0.0.1", () =>
    console.log(`Navigation search fixture ready at http://127.0.0.1:${port}`),
  );
  process.on("SIGTERM", () => server.close());
  process.on("SIGINT", () => server.close());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
