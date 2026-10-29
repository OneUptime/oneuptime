// What one monitor check costs the App: runs MonitorResourceUtil.monitorResource
// the way the heartbeat sweep (CheckHeartbeat) and the probe ingest run it,
// for seeded monitors, in a process of its own against the stack's
// datastores, and prints CPU per call and Postgres / ClickHouse / Valkey
// calls per call; with --sql also every statement of one call, and with
// --profile <out.cpuprofile> a CPU profile of the measured calls.
//
// Usage: bash in-app.sh monitor-cost.js <heartbeat|probe> <calls> [--sql] [--profile out.cpuprofile]
//   heartbeat: an Incoming Request monitor's check, as CheckHeartbeat runs it
//   probe:     a Website monitor's probe result, as the probe ingest runs it
// Settings: MONITORS (30) - how many seeded monitors the calls go round.
"use strict";

const fs = require("fs");
const inspector = require("inspector");

const kind = process.argv[2] || "heartbeat";
const calls = Number(process.argv[3] || "50");
const showSql = process.argv.includes("--sql");
const profileAt = process.argv.indexOf("--profile");
const profileOut = profileAt > 0 ? process.argv[profileAt + 1] : null;

const counters = { pg: 0, ch: 0, valkey: 0 };
let recording = null;

// Count the driver calls before anything connects.
const pg = require("/usr/src/Common/node_modules/pg");
const originalQuery = pg.Client.prototype.query;
pg.Client.prototype.query = function (...args) {
  counters.pg++;
  if (recording) {
    recording.push(
      typeof args[0] === "string"
        ? args[0]
        : (args[0] && args[0].text) || String(args[0]),
    );
  }
  return originalQuery.apply(this, args);
};

function post(session, method, params) {
  return new Promise((resolve, reject) => {
    session.post(method, params || {}, (error, result) => {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
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
        if (recording) {
          recording.push(
            `CH ${method}: ${String((args[0] && (args[0].query || args[0].table)) || "").slice(0, 200)}`,
          );
        }
        return original(...args);
      };
    }
  }

  const valkey = Redis.getClient();

  if (valkey && valkey.sendCommand) {
    const original = valkey.sendCommand.bind(valkey);
    valkey.sendCommand = (...args) => {
      counters.valkey++;
      if (recording) {
        recording.push(`VALKEY ${String((args[0] && args[0].name) || "")}`);
      }
      return original(...args);
    };
  }
}

async function main() {
  if (kind !== "heartbeat" && kind !== "probe") {
    throw new Error("kind must be heartbeat or probe");
  }

  await connect();

  const MonitorService =
    require("/usr/src/Common/Server/Services/MonitorService").default;
  const MonitorProbeService =
    require("/usr/src/Common/Server/Services/MonitorProbeService").default;
  const MonitorResourceUtil =
    require("/usr/src/Common/Server/Utils/Monitor/MonitorResource").default;
  const MonitorType =
    require("/usr/src/Common/Types/Monitor/MonitorType").default;
  const ObjectID = require("/usr/src/Common/Types/ObjectID").default;
  const OneUptimeDate = require("/usr/src/Common/Types/Date").default;

  const monitors = await MonitorService.findBy({
    query: {
      ...MonitorService.getEnabledMonitorQuery(),
      monitorType:
        kind === "probe" ? MonitorType.Website : MonitorType.IncomingRequest,
    },
    select: {
      _id: true,
      projectId: true,
      monitorSteps: true,
      incomingMonitorRequest: true,
      createdAt: true,
    },
    limit: Number(process.env.MONITORS || "30"),
    skip: 0,
    props: { isRoot: true },
  });

  if (monitors.length === 0) {
    throw new Error("no seeded monitors of that kind; run seed.js first");
  }

  const probeOf = new Map();

  async function oneCall(monitor) {
    if (kind === "heartbeat") {
      const request = monitor.incomingMonitorRequest || {};
      await MonitorResourceUtil.monitorResource({
        ...request,
        incomingRequestReceivedAt:
          request.incomingRequestReceivedAt || monitor.createdAt,
        onlyCheckForIncomingRequestReceivedAt: true,
        monitorId: monitor.id,
        projectId: monitor.projectId,
        checkedAt: OneUptimeDate.getCurrentDate(),
      });
      return;
    }

    if (!probeOf.has(monitor.id.toString())) {
      const rows = await MonitorProbeService.findBy({
        query: { monitorId: monitor.id },
        select: { probeId: true },
        limit: 1,
        skip: 0,
        props: { isRoot: true },
      });
      probeOf.set(monitor.id.toString(), rows[0] && rows[0].probeId);
    }

    const probeId = probeOf.get(monitor.id.toString());
    const step = monitor.monitorSteps.data.monitorStepsInstanceArray[0];
    await MonitorResourceUtil.monitorResource(
      {
        monitorId: monitor.id,
        probeId,
        monitorStepId: new ObjectID(step.id),
        isOnline: true,
        responseTimeInMs: 42,
        responseCode: 200,
        responseHeaders: { "content-type": "text/html" },
        responseBody: "<html><body>OK</body></html>",
        monitoredAt: OneUptimeDate.getCurrentDate(),
        isTimeout: false,
      },
      { reportingProbeId: probeId },
    );
  }

  // Warm up: every monitor twice, so code is compiled and any state a first
  // result changes is settled before the measured calls repeat the results.
  for (let round = 0; round < 2; round++) {
    for (const monitor of monitors) {
      await oneCall(monitor);
    }
  }

  if (showSql) {
    recording = [];
    await oneCall(monitors[0]);
    const lines = recording;
    recording = null;
    console.log(`--- one call: ${lines.length} statements and commands`);
    for (const line of lines) {
      console.log(`  ${line.replace(/\s+/g, " ").slice(0, 300)}`);
    }
  }

  let session = null;

  if (profileOut) {
    session = new inspector.Session();
    session.connect();
    await post(session, "Profiler.enable");
    await post(session, "Profiler.setSamplingInterval", { interval: 500 });
    await post(session, "Profiler.start");
  }

  const before = process.cpuUsage();
  const counted = { ...counters };
  const started = performance.now();

  for (let index = 0; index < calls; index++) {
    await oneCall(monitors[index % monitors.length]);
  }

  const wall = performance.now() - started;
  const cpu = process.cpuUsage(before);

  if (session) {
    const result = await post(session, "Profiler.stop");
    fs.writeFileSync(profileOut, JSON.stringify(result.profile));
    console.log(`profile written to ${profileOut}`);
  }

  const per = (value) => {
    return (value / calls).toFixed(1);
  };

  console.log(
    `${kind} ${calls} calls: cpu ${((cpu.user + cpu.system) / 1000 / calls).toFixed(2)} ms/call, ` +
      `wall ${(wall / calls).toFixed(2)} ms/call, per call pg ${per(counters.pg - counted.pg)} ` +
      `ch ${per(counters.ch - counted.ch)} valkey ${per(counters.valkey - counted.valkey)}`,
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
