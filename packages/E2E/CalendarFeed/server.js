/*
 * The on-call calendar feed cards in a real browser, with no backend:
 * Fixture.js renders the actual Dashboard pages - User Settings > Calendar
 * Feed, a schedule's "Subscribe to this schedule" cards and On-Call Duty >
 * Calendar Feeds - bundled with the app's esbuild config, Tailwind, theme and
 * font, and answers the API calls they make from an in-page store the specs
 * drive: the feed's status, what each action answers, and every request.
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { createConfig } = require("../../Common/UI/esbuild-config.js");
const esbuild = require("../../Common/node_modules/esbuild");

const repository = path.resolve(__dirname, "../../..");
const output = path.join(
  repository,
  "output/playwright/calendar-feed-ui/fixture",
);
const port = Number(process.env["CALENDAR_FEED_FIXTURE_PORT"] || 4294);
const config = createConfig({
  serviceName: "calendar-feed-fixture",
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
const font = path.join(
  repository,
  "packages/Common/Server/Static/Vendor/fonts/InterVariable.woff2",
);

/*
 * The plans a Cloud project can be on, as test-setup.sh describes them, so
 * the Growth gate (CalendarFeedPlanGate) reads a real plan order. Billing is
 * on only for ?billing=on: a self-hosted install has it off.
 */
const env = `{HOST:"localhost",HTTP_PROTOCOL:"http",BILLING_ENABLED:new URLSearchParams(location.search).get("billing")==="on"?"true":"false",VERSION:"1.0.0",NODE_ENV:"development",SUBSCRIPTION_PLAN_BASIC:"Free,priceMonthlyId,priceYearlyId,0,0,1,0",SUBSCRIPTION_PLAN_GROWTH:"Growth,priceMonthlyId2,priceYearlyId2,0,0,2,14",SUBSCRIPTION_PLAN_SCALE:"Scale,priceMonthlyId3,priceYearlyId3,0,0,3,0"}`;

/*
 * The Dashboard's font as its index.ejs loads it: Inter on every element,
 * not only the body - a rule on `*` wins over inheritance, which is what a
 * page draws in.
 */
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Calendar feed fixture</title><script>window.process={env:${env}};window.global=window;</script><script src="/tailwind.js"></script><script>tailwind.config={darkMode:"class"};</script><style>@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:block;src:url('/fonts/InterVariable.woff2') format('woff2');}*{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;}body{margin:0}*{box-sizing:border-box}</style></head><body class="bg-gray-50"><div id="root"></div><script type="module" src="/dist/Fixture.js"></script></body></html>`;

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
        file.endsWith(".css") ? "text/css" : "application/javascript",
      );
      fs.createReadStream(file).pipe(response);
      return;
    }
    response.setHeader("Content-Type", "text/html");
    response.end(html);
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`Calendar feed fixture ready at http://127.0.0.1:${port}/`);
  });
  process.on("SIGTERM", () => server.close());
  process.on("SIGINT", () => server.close());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
