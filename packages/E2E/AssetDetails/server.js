/*
 * An asset's details in a real browser, with no backend: Fixture.js renders
 * the actual Asset Details card of an Inventory item and Inventory card of a
 * network device, bundled with the app's esbuild config, Tailwind and theme,
 * and answers the API calls they make from an in-page store the specs read
 * (issue #5185).
 */
const fs = require("fs");
const http = require("http");
const path = require("path");

/*
 * The device Overview's other cards - its health, interfaces, attachment,
 * diagnostics, monitors and the vendor template offer - each read a backend
 * of their own and are each covered by suites of their own. Here they are
 * placeholders, so the page around the Device Details and Inventory cards is
 * the real one without modelling every read those cards make.
 */
const OVERVIEW_PLACEHOLDERS = {
  DeviceStatusHero: "Health",
  DeviceInterfacesPreview: "Interfaces",
  DeviceAttachmentCard: "Attached to",
  DeviceDiagnosticsCard: "Diagnostics",
  DeviceMonitorsCard: "Monitors",
  DeviceVendorTemplateBanner: null,
};

const overviewPlaceholders = {
  name: "asset-details-overview-placeholders",
  setup(build) {
    build.onResolve(
      {
        filter:
          /\/NetworkDevice\/(DeviceStatusHero|DeviceInterfacesPreview|DeviceAttachmentCard|DeviceDiagnosticsCard|DeviceMonitorsCard|DeviceVendorTemplateBanner|DeviceMonitorLookupUtil)$/,
      },
      (args) => {
        return {
          path: args.path.split("/").pop(),
          namespace: "asset-details-placeholder",
        };
      },
    );
    build.onLoad(
      { filter: /.*/, namespace: "asset-details-placeholder" },
      (args) => {
        const resolveDir = path.join(
          repository,
          "packages/App/FeatureSet/Dashboard/src",
        );
        if (args.path === "DeviceMonitorLookupUtil") {
          return {
            contents:
              "export default class DeviceMonitorLookupUtil { static async getDeviceMonitorContext() { return { monitors: [], isMonitorBacked: true }; } }",
            loader: "js",
            resolveDir: resolveDir,
          };
        }
        const label = OVERVIEW_PLACEHOLDERS[args.path];
        return {
          contents: label
            ? `import React from "react"; export default function Placeholder() { return React.createElement("div", { className: "rounded-lg border border-dashed border-gray-300 px-4 py-3 text-xs text-gray-400", "data-testid": "overview-placeholder" }, ${JSON.stringify(label)}); }`
            : "export default function Placeholder() { return null; }",
          loader: "jsx",
          resolveDir: resolveDir,
        };
      },
    );
  },
};
const { createConfig } = require("../../Common/UI/esbuild-config.js");
const esbuild = require("../../Common/node_modules/esbuild");

const repository = path.resolve(__dirname, "../../..");
const output = path.join(
  repository,
  "output/playwright/asset-details-ui/fixture",
);
const port = Number(process.env["ASSET_DETAILS_FIXTURE_PORT"] || 4531);
const config = createConfig({
  serviceName: "asset-details-fixture",
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
  additionalPlugins: [overviewPlaceholders],
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
 * What every index.ejs loads right after the runtime: left and right follow
 * the page's reading direction, so the Persian page (dir="rtl", ?lang=fa) is
 * laid out as production lays it out.
 */
const readingDirection = path.join(
  repository,
  "packages/Common/UI/Styles/TailwindReadingDirection.js",
);

/*
 * Inter, as production serves it: the Dashboard's index.ejs declares the
 * font and gives EVERY element Inter with a universal `*` rule. Without
 * them the page is drawn in the browser's fallback font, whose widths and
 * weights are not the ones people see - and what wraps where is half of
 * what these specs check.
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
const tailwindConfig = `tailwind.config={darkMode:"class",theme:{extend:{fontFamily:{display:["Inter","sans-serif"],body:["Inter","sans-serif"]}}}};`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Asset details fixture</title><script>window.process={env:{HOST:"localhost",HTTP_PROTOCOL:"http",BILLING_ENABLED:"false",VERSION:"1.0.0",NODE_ENV:"development"}};window.global=window;</script><script src="/tailwind.js"></script><script src="/tailwind-reading-direction.js"></script><script>${tailwindConfig}</script><style>${fontRules}body{margin:0}*{box-sizing:border-box}</style></head><body class="bg-gray-50"><div id="root"></div><script type="module" src="/dist/Fixture.js"></script></body></html>`;

async function main() {
  fs.mkdirSync(output, { recursive: true });
  await esbuild.build(config);
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    response.setHeader("Cache-Control", "no-store");
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
    response.setHeader("Content-Type", "text/html");
    response.end(html);
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`Asset details fixture ready at http://127.0.0.1:${port}/`);
  });
  process.on("SIGTERM", () => server.close());
  process.on("SIGINT", () => server.close());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
