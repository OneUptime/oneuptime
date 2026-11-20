"use strict";

/*
 * A stand-in for OneUptime's App behind the ingress, for
 * StatusCheckIngress.test.js. It answers as the App does by the name a
 * request names (App/FeatureSet/Frontend/Index.ts): the Dashboard, Accounts
 * and the Admin Dashboard under the App's own names alone - HOST, localhost
 * and ingress, without the port - and under any other name a status page's
 * custom domain, which has no status page here: 404. The routes the App
 * serves under every name (/status, /status-page, /public-dashboard, /api
 * and a probe's) answer 200, and the doctor's POST a server with nothing to
 * fix.
 *
 * It writes every request it takes, a JSON line each, to
 * /requests/requests.jsonl before it answers, so the test reads them all.
 */

const fs = require("fs");
const http = require("http");

const LOG = "/requests/requests.jsonl";

// HostAddressUtil.stripPort: a bracketed IPv6 address keeps its brackets.
const stripPort = (value) => {
  const text = String(value || "").trim();
  const closing = text.indexOf("]");

  if (text.startsWith("[") && closing !== -1) {
    return text.slice(0, closing + 1);
  }

  const colon = text.indexOf(":");

  if (colon === -1 || colon !== text.lastIndexOf(":")) {
    return text;
  }

  return text.slice(0, colon);
};

// The App's own names (getPrimaryHosts), as it compares them.
const PRIMARY_HOSTS = new Set(
  [process.env.HOST || "", "localhost", "ingress"]
    .map((name) => {
      return stripPort(name).toLowerCase();
    })
    .filter(Boolean),
);

// The frontends the App serves under its own names alone (primaryHostOnly).
const PRIMARY_HOST_ONLY = ["/accounts", "/dashboard", "/admin"];

// What the App serves under every name, a probe's API among it.
const EVERY_HOST = [
  "/status",
  "/status-page",
  "/public-dashboard",
  "/api",
  "/probe-ingest",
  "/ingestor",
  "/incoming-request-ingest",
];

const isUnder = (pathname, prefix) => {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
};

const DOCTOR_PATH = "/api/admin/health/doctor";

http
  .createServer((request, response) => {
    let bytes = 0;

    request.on("data", (chunk) => {
      bytes += chunk.length;
    });
    request.on("end", () => {
      const host = request.headers.host || "";
      const pathname = new URL(request.url, "http://stand-in").pathname;
      const isPrimary = PRIMARY_HOSTS.has(stripPort(host).toLowerCase());
      let status = isPrimary ? 200 : 404;

      if (
        EVERY_HOST.some((prefix) => {
          return isUnder(pathname, prefix);
        })
      ) {
        status = 200;
      } else if (
        PRIMARY_HOST_ONLY.some((prefix) => {
          return isUnder(pathname, prefix);
        })
      ) {
        status = isPrimary ? 200 : 404;
      }

      fs.appendFileSync(
        LOG,
        `${JSON.stringify({
          method: request.method,
          path: request.url,
          host: host,
          bytes: bytes,
          status: status,
        })}\n`,
      );

      if (request.method === "POST" && pathname === DOCTOR_PATH) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            findings: [],
            checked: ["postgres", "clickhouse", "valkey"],
          }),
        );
        return;
      }

      response.writeHead(status, { "Content-Type": "text/plain" });
      response.end(`${status}\n`);
    });
  })
  .listen(Number(process.env.APP_PORT), "0.0.0.0");
