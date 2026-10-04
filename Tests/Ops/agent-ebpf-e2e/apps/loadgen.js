"use strict";

/**
 * Load generator of the agent eBPF end-to-end test. ONE long-lived process
 * (one client process for OBI, not thousands of short-lived ones) running
 * CONCURRENCY loops for DURATION seconds over the app's routes, a fresh TCP
 * connection per request. Prints one JSON line at the end, which analyze.py
 * reads:
 *   {"event":"done","stats":{"<route>":{"n":..,"codes":{..}}},"total":..}
 */

const http = require("http");

const DURATION = Number(process.env.DURATION || 90) * 1000;
const CONCURRENCY = Number(process.env.CONCURRENCY || 8);
const PAUSE_MS = Number(process.env.PAUSE_MS || 50);
const TARGET = process.env.TARGET || "app.shop.svc.cluster.local:3000";
const ROUTES = [
  [
    "GET",
    () => {
      return `/api/items/${Math.floor(Math.random() * 100000)}`;
    },
    "/api/items/:id",
  ],
  [
    "POST",
    () => {
      return "/api/orders";
    },
    "/api/orders",
  ],
  [
    "GET",
    () => {
      return "/status/ready";
    },
    "/status/ready",
  ],
  [
    "GET",
    () => {
      return "/cpu/hash";
    },
    "/cpu/hash",
  ],
];
const stats = {};
let total = 0;

function one(i) {
  const [method, path, route] = ROUTES[i % ROUTES.length];
  const [host, port] = TARGET.split(":");
  const body = method === "POST" ? '{"sku":"e2e"}' : null;
  return new Promise((resolve) => {
    if (!stats[route]) {
      stats[route] = { n: 0, codes: {} };
    }
    const s = stats[route];
    const count = (code) => {
      s.n++;
      total++;
      s.codes[code] = (s.codes[code] || 0) + 1;
      resolve();
    };
    const req = http.request(
      {
        host,
        port: Number(port),
        path: path(),
        method,
        agent: false,
        timeout: 30000,
        headers: body
          ? {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(body),
            }
          : {},
      },
      (res) => {
        res.resume();
        res.on("end", () => {
          count(res.statusCode);
        });
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", () => {
      count("ERR");
    });
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function main() {
  const start = Date.now();
  const end = start + DURATION;
  console.log(
    JSON.stringify({
      event: "start",
      at: new Date(start).toISOString(),
      DURATION,
      CONCURRENCY,
      PAUSE_MS,
      TARGET,
    }),
  );
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async (_, worker) => {
      for (let i = worker; Date.now() < end; i += CONCURRENCY) {
        await one(i);
        if (PAUSE_MS) {
          await sleep(PAUSE_MS);
        }
      }
    }),
  );
  console.log(
    JSON.stringify({
      event: "done",
      at: new Date().toISOString(),
      seconds: (Date.now() - start) / 1000,
      total,
      stats,
    }),
  );
}

main();
