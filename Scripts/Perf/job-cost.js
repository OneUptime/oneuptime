// What each Worker job costs per run, and so per hour. Registers every job
// as the App does (the Workers feature set, and the enterprise jobs when
// ee/ is there) with Queue.addJob replaced - nothing is queued, each job's
// schedule is recorded instead - then runs each job's body <runs> times, one
// at a time, in this process against the stack's data, and prints CPU and
// Postgres / ClickHouse / Valkey calls per run, runs per hour from the
// schedule, and CPU seconds per hour, most expensive first.
//
// The jobs do here what they do in production (send notifications, delete
// rows): run it only against a stack of this kit's, seeded with seed.js.
//
// Usage: bash in-app.sh job-cost.js <runs> <out.json> [nameFilter]
"use strict";

const fs = require("fs");

const runs = Math.max(1, Number(process.argv[2] || "2"));
const out = process.argv[3] || "job-cost.json";
const filter = (process.argv[4] || "").toLowerCase();

const counters = { pg: 0, ch: 0, valkey: 0 };
const pg = require("/usr/src/Common/node_modules/pg");
const originalQuery = pg.Client.prototype.query;
pg.Client.prototype.query = function (...args) {
  counters.pg++;
  return originalQuery.apply(this, args);
};

function runsPerHour(schedule) {
  const parser = require("/usr/src/Common/node_modules/cron-parser");
  const from = new Date("2026-01-05T00:00:00Z");
  const to = new Date(from.getTime() + 7 * 24 * 3600 * 1000);
  const expression = parser.parseExpression(schedule, {
    currentDate: from,
    endDate: to,
    tz: "UTC",
  });
  let count = 0;

  while (expression.hasNext() && count < 1000000) {
    expression.next();
    count++;
  }

  return count / (7 * 24);
}

async function connect() {
  const Postgres =
    require("/usr/src/Common/Server/Infrastructure/PostgresDatabase").default;
  const Redis = require("/usr/src/Common/Server/Infrastructure/Redis").default;
  const Clickhouse = require("/usr/src/Common/Server/Infrastructure/ClickhouseDatabase");
  const SigningKeys =
    require("/usr/src/Common/Server/Services/InstanceTokenSigningKeyService").default;

  await Postgres.connect();
  await SigningKeys.loadTokenSigningKey();
  await Redis.connect();

  for (const instance of [
    Clickhouse.ClickhouseAppInstance,
    Clickhouse.ClickhouseIngestInstance,
  ]) {
    await instance.connect(instance.getDatasourceOptions());
    const client = instance.getDataSource();

    for (const method of ["query", "insert", "command", "exec"]) {
      const original = client[method].bind(client);
      client[method] = (...args) => {
        counters.ch++;
        return original(...args);
      };
    }
  }

  const valkey = Redis.getClient();

  if (valkey && valkey.sendCommand) {
    const original = valkey.sendCommand.bind(valkey);
    valkey.sendCommand = (...args) => {
      counters.valkey++;
      return original(...args);
    };
  }
}

function withTimeout(promise, ms) {
  let timer = null;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`timeout after ${ms} ms`));
    }, ms);
  });

  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

async function main() {
  await connect();

  const schedules = {};
  const Queue = require("/usr/src/Common/Server/Infrastructure/Queue").default;
  Queue.addJob = async (_queueName, _jobId, jobName, _data, options) => {
    if (options && options.scheduleAt) {
      schedules[jobName] = options.scheduleAt;
    }
  };

  // Registering is a side effect of loading the job modules.
  require("/usr/src/app/FeatureSet/Workers/Index");
  const EnterpriseLoader =
    require("/usr/src/app/Utils/EnterpriseLoader").default;
  await EnterpriseLoader.load().catch(() => {});
  await EnterpriseLoader.registerWorkerJobs().catch(() => {});
  await new Promise((resolve) => {
    setTimeout(resolve, 3000);
  });

  const JobDictionary =
    require("/usr/src/app/FeatureSet/Workers/Utils/JobDictionary").default;
  const names = Object.keys(JobDictionary.dictionary)
    .filter((name) => {
      return !filter || name.toLowerCase().includes(filter);
    })
    .sort();
  const results = [];

  for (const name of names) {
    const job = JobDictionary.getJobFunction(name);
    const measured = [];

    for (let run = 0; run < runs; run++) {
      const before = process.cpuUsage();
      const counted = { ...counters };
      const started = performance.now();
      let error;

      try {
        await withTimeout(job({ name, data: {} }), 120000);
      } catch (thrown) {
        error = String((thrown && thrown.message) || thrown).slice(0, 160);
      }

      const cpu = process.cpuUsage(before);
      measured.push({
        cpuMs: (cpu.user + cpu.system) / 1000,
        wallMs: performance.now() - started,
        pg: counters.pg - counted.pg,
        ch: counters.ch - counted.ch,
        valkey: counters.valkey - counted.valkey,
        error,
      });
    }

    // The first run compiles code and fills caches: report the cheapest run
    // after it (or the only run).
    const warm = measured.length > 1 ? measured.slice(1) : measured;
    const run = warm.reduce((best, each) => {
      return each.cpuMs < best.cpuMs ? each : best;
    });
    const schedule = schedules[name] || null;
    const perHour = schedule ? runsPerHour(schedule) : 0;

    results.push({
      name,
      schedule,
      runsPerHour: perHour,
      ...run,
      cpuSecondsPerHour: (run.cpuMs * perHour) / 1000,
      pgPerHour: run.pg * perHour,
      firstRun: measured[0],
    });
  }

  results.sort((left, right) => {
    return right.cpuSecondsPerHour - left.cpuSecondsPerHour;
  });

  for (const row of results) {
    console.log(
      `${row.name.padEnd(64)} ${String(row.schedule).padEnd(16)} ${row.cpuMs.toFixed(1).padStart(8)} ms/run ` +
        `${row.cpuSecondsPerHour.toFixed(2).padStart(7)} cpu-s/h  pg ${String(row.pg).padStart(4)}/run ` +
        `ch ${String(row.ch).padStart(3)} valkey ${String(row.valkey).padStart(3)}${row.error ? `  error: ${row.error}` : ""}`,
    );
  }

  const total = results.reduce((sum, row) => {
    return sum + row.cpuSecondsPerHour;
  }, 0);
  console.log(
    `${results.length} jobs: ${total.toFixed(1)} cpu-s an hour in their bodies`,
  );
  fs.writeFileSync(out, JSON.stringify(results, null, 1));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
