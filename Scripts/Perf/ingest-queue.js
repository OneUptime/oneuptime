// What the telemetry queue does while a load runs: every <interval> seconds
// how many jobs wait, how many completed in the window (read from the
// queue's event stream every half second, as BullMQ trims it to about a
// thousand entries), and how long the OTLP jobs among them ran
// (finishedOn - processedOn) and waited to start (processedOn - timestamp).
// Telemetry monitor checks share the queue but not the numbers.
//
// Usage: node ingest-queue.js <seconds> [interval] [out.json]
// Settings: PERF_VALKEY_PORT (16371). Needs `npm ci` in packages/Common.
"use strict";

const fs = require("fs");
const path = require("path");

const Redis = require(
  path.resolve(__dirname, "..", "..", "packages/Common/node_modules/ioredis"),
);

const seconds = Number(process.argv[2] || "120");
const interval = Number(process.argv[3] || "10");
const out = process.argv[4];

const redis = new Redis({
  host: "127.0.0.1",
  port: Number(process.env.PERF_VALKEY_PORT || "16371"),
  password: "please-change-this-to-random-value",
});

function percentile(sorted, p) {
  if (sorted.length === 0) {
    return null;
  }
  return sorted[
    Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  ];
}

// The OTLP jobs still in the completed set (it keeps 500) that finished since `sinceMs`.
async function finishedSince(sinceMs) {
  const ids = await redis.zrangebyscore(
    "bull:Telemetry:completed",
    sinceMs,
    "+inf",
  );
  const jobs = [];

  for (const id of ids) {
    if (String(id).startsWith("telemetry-monitor")) {
      continue;
    }

    const [timestamp, processedOn, finishedOn] = await redis.hmget(
      `bull:Telemetry:${id}`,
      "timestamp",
      "processedOn",
      "finishedOn",
    );

    if (processedOn && finishedOn) {
      jobs.push({
        run: Number(finishedOn) - Number(processedOn),
        wait: Number(processedOn) - Number(timestamp),
      });
    }
  }

  return jobs;
}

let completed = 0;
let lastEventId = `${Date.now()}-0`;
let polling = true;

async function pollEvents() {
  while (polling) {
    for (;;) {
      const entries = await redis.xrange(
        "bull:Telemetry:events",
        `(${lastEventId}`,
        "+",
        "COUNT",
        5000,
      );

      for (const [id, fields] of entries) {
        lastEventId = id;
        for (let i = 0; i < fields.length; i += 2) {
          if (fields[i] === "event" && fields[i + 1] === "completed") {
            completed++;
          }
        }
      }

      if (entries.length < 5000) {
        break;
      }
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 500);
    });
  }
}

(async () => {
  const samples = [];
  const started = Date.now();
  let since = started;
  const poller = pollEvents();

  while (Date.now() - started < seconds * 1000) {
    await new Promise((resolve) => {
      setTimeout(resolve, interval * 1000);
    });

    const now = Date.now();
    const [waiting, prioritized] = await Promise.all([
      redis.llen("bull:Telemetry:wait"),
      redis.zcard("bull:Telemetry:prioritized"),
    ]);
    const jobs = await finishedSince(since);
    since = now;

    const windowCompleted = completed;
    completed = 0;

    const runs = jobs.map((job) => job.run).sort((a, b) => a - b);
    const waits = jobs.map((job) => job.wait).sort((a, b) => a - b);
    const sample = {
      at: new Date(now).toISOString(),
      backlog: waiting + prioritized,
      completed: windowCompleted,
      perSecond: Math.round((windowCompleted / interval) * 10) / 10,
      runMs: { p50: percentile(runs, 50), p90: percentile(runs, 90) },
      queuedMs: { p50: percentile(waits, 50), p90: percentile(waits, 90) },
    };

    samples.push(sample);
    console.log(JSON.stringify(sample));
  }

  polling = false;
  await poller;

  if (out) {
    fs.writeFileSync(out, JSON.stringify(samples, null, 2));
  }

  await redis.quit();
})();
