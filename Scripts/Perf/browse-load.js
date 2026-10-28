// People using the Dashboard: <users> signed-in people (one browser context
// each, in one headless Chromium), each in a project of their own, opening
// a page every <thinkMs> through the app's own navigation (the router, as a
// click does, so the app shell stays loaded, as it does for a person), round
// the pages below. Every page polls and refetches as it does for a person.
//
// Needs the Dashboard built (npm run build in packages/App/FeatureSet/
// Dashboard) and Playwright's Chromium (packages/E2E: npm ci, then
// npx playwright install chromium).
//
// Each person signs in afresh (seed.js's cookies stop working once a run
// has refreshed them).
//
// Usage: node browse-load.js <seed.json> <users> <minutes> [thinkMs]
"use strict";

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..");
const { chromium } = require(
  path.join(REPO, "packages/E2E/node_modules/playwright"),
);
const { BASE, signIn } = require("./api.js");
const ORIGIN = new URL(BASE).origin;

const seed = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const users = Number(process.argv[3] || "5");
const minutes = Number(process.argv[4] || "10");
const thinkMs = Number(process.argv[5] || "15000");

// What nginx does in production: these first path segments go to /api.
const API_ALIASES = new Set(["identity", "file", "notification"]);

function pagesFor(project) {
  const dashboard = `/dashboard/${project.projectId}`;

  return [
    `${dashboard}/home/`,
    `${dashboard}/monitors`,
    `${dashboard}/monitors/${project.monitorIds[0]}`,
    `${dashboard}/incidents`,
    `${dashboard}/incidents/${project.incidentIds[project.incidentIds.length - 1]}`,
    `${dashboard}/alerts`,
    `${dashboard}/alerts/${project.alertIds[project.alertIds.length - 1]}`,
    `${dashboard}/logs`,
    `${dashboard}/traces`,
    `${dashboard}/metrics`,
    `${dashboard}/status-pages`,
    `${dashboard}/monitors/${project.monitorIds[3]}`,
  ];
}

// signedOut: page opens that found the person signed out (the Dashboard sent
// them to /accounts) - a load that is not the load it says.
const stats = { pages: 0, requests: 0, failed: 0, signedOut: 0 };

function countSignedOut(page) {
  if (new URL(page.url()).pathname.startsWith("/accounts")) {
    stats.signedOut++;
  }
}

function isApi(url) {
  const parsed = new URL(url);
  return parsed.origin === ORIGIN && parsed.pathname.startsWith("/api/");
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function person(browser, project, offset, deadline) {
  const session = await signIn(project.email);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const host = new URL(BASE).hostname;

  await context.addCookies(
    Object.entries(session.cookies).map(([name, value]) => {
      return { name, value, domain: host, path: "/" };
    }),
  );
  await context.route(
    (url) => {
      return (
        url.origin === ORIGIN && API_ALIASES.has(url.pathname.split("/")[1])
      );
    },
    (route) => {
      const url = new URL(route.request().url());
      url.pathname = "/api" + url.pathname;
      return route.continue({ url: url.toString() });
    },
  );

  const page = await context.newPage();
  page.on("request", (request) => {
    if (isApi(request.url())) {
      stats.requests++;
    }
  });
  page.on("requestfailed", (request) => {
    if (isApi(request.url())) {
      stats.failed++;
    }
  });

  const pages = pagesFor(project);
  await sleep(offset);
  await page
    .goto(BASE + pages[0], { waitUntil: "load", timeout: 120000 })
    .catch(() => {});
  countSignedOut(page);

  let next = 1;

  while (Date.now() < deadline) {
    await sleep(thinkMs);
    const target = pages[next % pages.length];
    next++;
    await page
      .evaluate((to) => {
        window.history.pushState({}, "", to);
        window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
      }, target)
      .catch(() => {});
    stats.pages++;
    countSignedOut(page);
  }

  await context.close();
}

(async () => {
  const deadline = Date.now() + minutes * 60000;
  const browser = await chromium.launch({ headless: true });
  const timer = setInterval(() => {
    console.log(`${new Date().toISOString()} ${JSON.stringify(stats)}`);
  }, 30000);

  await Promise.all(
    Array.from({ length: users }, (_unused, index) => {
      return person(
        browser,
        seed.projects[index % seed.projects.length],
        (thinkMs / users) * index,
        deadline,
      );
    }),
  );
  clearInterval(timer);
  console.log(`done ${JSON.stringify(stats)}`);
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
