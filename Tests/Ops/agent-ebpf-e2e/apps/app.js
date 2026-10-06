"use strict";

/**
 * The instrumented app of the agent eBPF end-to-end test (Node.js 26).
 *
 * Every request makes exactly one of each outbound call -- Redis SET, Redis
 * GET, Postgres SELECT 1 and HTTP GET downstream /ping -- so the test can tell,
 * per server span, whether OBI linked the request's OWN calls to it. Each
 * request also burns a little CPU inside its own request context so that the
 * eBPF profiler has on-CPU samples to tag with the request's trace context;
 * /cpu/hash burns more.
 *
 * Outside any request, a timer calls downstream's GET /tick every 2 s, the way
 * a worker or a controller calls out on its own: what reaches the sink as a
 * CLIENT span with no parent, the call ebpf.dropUnlinkedClientCalls drops.
 *
 * Routes are declared as Express literals, which OBI's Node.js route harvester
 * reads from this file (it has to live outside node_modules, /tmp, /usr ...).
 */

const crypto = require("crypto");
const express = require("express");
const http = require("http");
const Redis = require("ioredis");
const { Pool } = require("pg");

const BURN_MS = Number(process.env.BURN_MS || 3);
const HASH_BURN_MS = Number(process.env.HASH_BURN_MS || 25);
const TICK_MS = Number(process.env.TICK_MS || 2000);
const redis = new Redis({ host: process.env.REDIS_HOST, port: 6379 });
const pool = new Pool({
  host: process.env.PG_HOST,
  user: "postgres",
  password: process.env.PG_PASSWORD,
  database: "postgres",
  max: 4,
});
const agent = new http.Agent({ keepAlive: true, maxSockets: 4 });

// Synchronous CPU work: what an on-CPU profiler sample can land on.
function burn(ms) {
  const end = process.hrtime.bigint() + BigInt(Math.round(ms * 1e6));
  let hash = Buffer.alloc(32);
  while (process.hrtime.bigint() < end) {
    hash = crypto.createHash("sha256").update(hash).digest();
  }
  return hash[0];
}

function downstream() {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: process.env.DOWNSTREAM_HOST, port: 8080, path: "/ping", agent },
      (res) => {
        res.resume();
        res.on("end", resolve);
      },
    );
    req.on("error", reject);
  });
}

let seq = 0;
async function work(tag, extraBurnMs) {
  const key = `e2e:${tag}:${process.pid}:${seq++}`;
  await redis.set(key, "v", "EX", 60);
  await redis.get(key);
  await pool.query("SELECT 1");
  await downstream();
  if (extraBurnMs) {
    burn(extraBurnMs);
  }
}

function handler(extraBurnMs) {
  return (req, res) => {
    burn(BURN_MS);
    work(req.path.split("/")[1] || "root", extraBurnMs).then(
      () => {
        res.json({ ok: true, path: req.path });
      },
      (err) => {
        res.status(500).json({ ok: false, err: String(err) });
      },
    );
  };
}

const app = express();
app.use(
  express.raw({
    type: () => {
      return true;
    },
    limit: "1mb",
  }),
);
app.get("/api/items/:id", handler(0));
app.post("/api/orders", handler(0));
app.get("/status/ready", handler(0));
app.get("/cpu/hash", handler(HASH_BURN_MS));

/*
 * Work no request triggered (analyze.py TR-13). A connection of its own, so it
 * never queues behind the requests' calls on their agent, nor they behind it.
 * Failures are ignored: downstream may not be up yet.
 */
const tickAgent = new http.Agent({ keepAlive: true, maxSockets: 1 });
setInterval(() => {
  const req = http.get(
    {
      host: process.env.DOWNSTREAM_HOST,
      port: 8080,
      path: "/tick",
      agent: tickAgent,
    },
    (res) => {
      res.resume();
    },
  );
  req.on("error", () => {});
}, TICK_MS);

app.listen(3000, "0.0.0.0", () => {
  console.log(
    `agent-ebpf-e2e app node ${process.version} pid ${process.pid} listening on 3000`,
  );
});
