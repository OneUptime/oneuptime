// Sends every seeded Incoming Request monitor its heartbeat once a minute,
// spread over the minute, as cron jobs and services do - except the second
// heartbeat of every tenth project, which stays silent (some heartbeat
// monitors are offline, as in real life).
//
// Usage: node heartbeats.js <seed.json> <minutes>
"use strict";

const fs = require("fs");

const BASE = process.env.PERF_APP_URL || "http://localhost:3371";
const seed = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const minutes = Number(process.argv[3] || "10");

const keys = [];

for (const project of seed.projects) {
  project.heartbeatKeys.forEach((key, index) => {
    if (!(index === 1 && project.index % 10 === 0)) {
      keys.push(key);
    }
  });
}

const stats = { sent: 0, failed: 0 };

async function beat(key) {
  try {
    const response = await fetch(
      `${BASE}/incoming-request-ingest/incoming-request/${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "ok", job: "nightly-backup" }),
      },
    );
    await response.text();

    if (response.ok) {
      stats.sent++;
    } else {
      stats.failed++;
    }
  } catch {
    stats.failed++;
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

(async () => {
  const deadline = Date.now() + minutes * 60000;

  while (Date.now() < deadline) {
    const started = Date.now();
    const gap = 60000 / Math.max(1, keys.length);

    for (const key of keys) {
      if (Date.now() >= deadline) {
        break;
      }

      void beat(key);
      await sleep(gap);
    }

    await sleep(Math.max(0, 60000 - (Date.now() - started)));
    console.log(`${new Date().toISOString()} ${JSON.stringify(stats)}`);
  }
})();
