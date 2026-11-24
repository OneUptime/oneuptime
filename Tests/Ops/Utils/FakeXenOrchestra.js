"use strict";

/**
 * A stand-in Xen Orchestra, answering /openmetrics the way xo-server and its
 * OpenMetrics plugin do (xo-server-openmetrics 1.9.4, read from
 * vatesfr/xen-orchestra on 24 November 2026):
 *
 *   - xo-server proxies /openmetrics/* to the plugin's own server, which sees
 *     the path without the prefix;
 *   - GET /openmetrics/health answers 200 {"status":"ok"} with no token;
 *   - any other request needs `Authorization: Bearer <secret>`: none is 401
 *     {"error":"Query is not authenticated"}, another one is 401
 *     {"error":"Query authentication does not match server setting"} -
 *     checked before the path, so a right token on an unknown path is 404
 *     {"error":"Not found"};
 *   - GET /openmetrics/metrics answers the scrape with Content-Type
 *     `application/openmetrics-text; version=1.0.0; charset=utf-8`;
 *   - with the plugin not loaded, xo-server's proxy fails every /openmetrics
 *     request with 500 text/plain "There was a problem proxying this
 *     request." (`plugin: "off"`).
 *
 * The scrape is the recorded one (Fixtures/XcpNg/XenOrchestraScrape.js): the
 * first metrics request gets scrape 1, every later one scrape 2, each on a
 * clock of its own that moves 60 seconds per scrape from `baseSeconds`, so
 * what was served when is known exactly (`served`). `lostPoolAt` makes Xen
 * Orchestra lose the unnamed pool from that scrape on (its lines are left
 * out, as the plugin leaves out a pool it is no longer connected to), and
 * `noPools` answers as a Xen Orchestra connected to no pool.
 *
 * Used in-process by the agent's jest suites, and as a script by
 * xcp-ng-agent-scrape-behaviour.sh, which runs it in a container with its
 * settings in the environment (XO_SECRET, XO_CERT, XO_KEY, XO_PORT,
 * XO_BASE_SECONDS, XO_LOSE_POOL_AT, XO_PLAIN_HTTP, XO_PLUGIN): it logs one
 * line per request to stdout.
 */

const fs = require("fs");
const http = require("http");
const https = require("https");
const {
  buildXenOrchestraScrape,
  POOLS,
} = require("../Fixtures/XcpNg/XenOrchestraScrape");

const OPENMETRICS_CONTENT_TYPE =
  "application/openmetrics-text; version=1.0.0; charset=utf-8";
const NOT_AUTHENTICATED = { error: "Query is not authenticated" };
const WRONG_SECRET = {
  error: "Query authentication does not match server setting",
};
const PROXY_ERROR = "There was a problem proxying this request.";

// The scrape with every line of the unnamed pool (and its host's) left out.
function withoutUnnamedPool(body) {
  return body
    .split("\n")
    .filter((line) => {
      return (
        !line.includes(`pool_id="${POOLS.unnamed.id}"`) &&
        !line.includes('host_name="xcp-lab-01"')
      );
    })
    .join("\n");
}

function createFakeXenOrchestra(options = {}) {
  const settings = {
    secret: "fake-xo-secret",
    baseSeconds: 1795000000,
    lostPoolAt: 0,
    noPools: false,
    plugin: "on",
    log: null,
    ...options,
  };
  const requests = [];
  const served = [];

  const handler = (request, response) => {
    const record = {
      method: request.method,
      url: request.url,
      authorization: request.headers["authorization"] || null,
      verdict: "",
    };
    requests.push(record);
    const done = (status, type, body, verdict) => {
      record.verdict = verdict;
      if (settings.log) {
        settings.log(
          `REQUEST ${request.method} ${request.url} ${status} ${verdict}`,
        );
      }
      response.writeHead(status, { "Content-Type": type });
      response.end(body);
    };
    const json = (status, data, verdict) => {
      return done(status, "application/json", JSON.stringify(data), verdict);
    };

    const url = request.url || "/";
    if (!url.startsWith("/openmetrics/")) {
      return done(
        404,
        "text/html",
        "<!doctype html><title>Xen Orchestra</title>",
        "ui",
      );
    }
    if (settings.plugin === "off") {
      return done(500, "text/plain", PROXY_ERROR, "plugin-off");
    }
    const path = url.substring("/openmetrics".length);
    if (path === "/health" && request.method === "GET") {
      return json(200, { status: "ok" }, "health");
    }
    const auth = (request.headers["authorization"] || "").trim();
    if (!auth) {
      return json(401, NOT_AUTHENTICATED, "no-secret");
    }
    if (auth !== `Bearer ${settings.secret}`) {
      return json(401, WRONG_SECRET, "wrong-secret");
    }
    if (path === "/metrics" && request.method === "GET") {
      if (settings.noPools) {
        return done(
          200,
          OPENMETRICS_CONTENT_TYPE,
          "# No connected hosts\n# EOF",
          "no-pools",
        );
      }
      const index = served.length + 1;
      const scrape = index === 1 ? 1 : 2;
      const nowSeconds = settings.baseSeconds + 60 * (index - 1);
      let body = buildXenOrchestraScrape({ scrape, nowSeconds });
      const lostPool = settings.lostPoolAt > 0 && index >= settings.lostPoolAt;
      if (lostPool) {
        body = withoutUnnamedPool(body);
      }
      served.push({ index, scrape, nowSeconds, lostPool });
      return done(
        200,
        OPENMETRICS_CONTENT_TYPE,
        body,
        `served=${index} scrape=${scrape} now=${nowSeconds}${lostPool ? " lost-pool" : ""}`,
      );
    }
    return json(404, { error: "Not found" }, "not-found");
  };

  const server =
    settings.cert && settings.key
      ? https.createServer({ cert: settings.cert, key: settings.key }, handler)
      : http.createServer(handler);

  return {
    server,
    requests,
    served,
    settings,
    listen(port = 0, host = "::") {
      return new Promise((resolve) => {
        server.listen(port, host, () => {
          resolve(server.address().port);
        });
      });
    },
    close() {
      return new Promise((resolve) => {
        server.close(() => {
          resolve();
        });
        if (server.closeAllConnections) {
          server.closeAllConnections();
        }
      });
    },
  };
}

module.exports = {
  OPENMETRICS_CONTENT_TYPE,
  NOT_AUTHENTICATED,
  WRONG_SECRET,
  PROXY_ERROR,
  createFakeXenOrchestra,
  withoutUnnamedPool,
};

if (require.main === module) {
  const env = process.env;
  const plain = env["XO_PLAIN_HTTP"] === "1";
  const fake = createFakeXenOrchestra({
    secret: env["XO_SECRET"],
    baseSeconds: Number(env["XO_BASE_SECONDS"] || 1795000000),
    lostPoolAt: Number(env["XO_LOSE_POOL_AT"] || 0),
    plugin: env["XO_PLUGIN"] || "on",
    cert: plain ? null : fs.readFileSync(env["XO_CERT"]),
    key: plain ? null : fs.readFileSync(env["XO_KEY"]),
    log: (line) => {
      process.stdout.write(`${line}\n`);
    },
  });
  fake.listen(Number(env["XO_PORT"] || (plain ? 80 : 443))).then((port) => {
    process.stdout.write(`LISTENING ${port}\n`);
  });
  process.on("SIGTERM", () => {
    process.exit(0);
  });
}
