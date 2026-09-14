/*
 * Benchmark simultaneous failed monitors asking whether their probe is online.
 * Run from the repository root:
 *
 *   node --expose-gc Probe/scripts/benchmark-online-check.js
 *
 * Compare against an earlier revision in a separate process:
 *
 *   git show 0b23baed11:Probe/Utils/OnlineCheck.ts > /tmp/oneuptime-online-check-before.ts
 *   node --expose-gc Probe/scripts/benchmark-online-check.js /tmp/oneuptime-online-check-before.ts
 *
 * The selected OnlineCheck.ts is transpiled and executed unchanged. Reference
 * probes are deferred stubs that all return offline; no network traffic or
 * operating-system ping processes are created. The heap measurement includes
 * these stub promises, their resolver queue and the caller promises, not real
 * sockets or response bodies. It illustrates pending JavaScript work for this
 * workload and is not an estimate of total production memory savings.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

if (typeof global.gc !== "function") {
  throw new Error("Run this benchmark with node --expose-gc.");
}

const callerCount = 10000;
const sourcePath = path.resolve(
  process.argv[2] || path.join(__dirname, "../Utils/OnlineCheck.ts"),
);
const code = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
}).outputText;

let referenceChecks = 0;
let pendingReferences = [];
const referenceProbe = {
  ping: () => {
    referenceChecks++;
    return new Promise((resolve) => {
      pendingReferences.push(resolve);
    });
  },
};
const overrides = {
  "./Monitors/MonitorTypes/PingMonitor": referenceProbe,
  "./Monitors/MonitorTypes/PortMonitor": referenceProbe,
  "./Monitors/MonitorTypes/WebsiteMonitor": referenceProbe,
  "Common/Server/EnvironmentConfig": { IsBillingEnabled: true },
  "Common/Types/API/URL": { fromString: (value) => value },
  "Common/Types/API/Hostname": class Hostname {},
  "Common/Types/Port": class Port {},
};
const sandbox = {
  exports: {},
  require: (name) => {
    if (!(name in overrides)) {
      throw new Error(`Unexpected import: ${name}`);
    }
    return overrides[name];
  },
};
vm.runInNewContext(code, sandbox, { filename: sourcePath });
const OnlineCheck = sandbox.exports.default;

async function nextTurn() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function collectGarbage() {
  for (let round = 0; round < 3; round++) {
    global.gc();
    await nextTurn();
  }
}

async function main() {
  await collectGarbage();
  const heapBefore = process.memoryUsage().heapUsed;
  const checks = Array.from({ length: callerCount }, () => {
    return OnlineCheck.canProbeMonitorWebsiteMonitors();
  });
  const resultsPromise = Promise.all(checks);
  await nextTurn();
  await collectGarbage();
  const pendingHeapMiB =
    (process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024;
  const peakPendingReferences = pendingReferences.length;

  for (let fallback = 0; fallback < 5; fallback++) {
    const references = pendingReferences;
    pendingReferences = [];
    if (references.length === 0) {
      throw new Error("Reference sequence ended earlier than expected.");
    }
    for (const resolve of references) {
      resolve({ isOnline: false });
    }
    await nextTurn();
  }
  if (pendingReferences.length !== 0) {
    throw new Error("Reference sequence exceeded the five fallback domains.");
  }
  const results = await resultsPromise;
  if (results.length !== callerCount || results.some(Boolean)) {
    throw new Error("Not all callers received the expected offline verdict.");
  }

  console.log(
    JSON.stringify({
      sourcePath,
      callerCount,
      referenceChecks,
      peakPendingReferences,
      pendingHeapMiB: Number(pendingHeapMiB.toFixed(2)),
      offlineVerdicts: results.length,
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
