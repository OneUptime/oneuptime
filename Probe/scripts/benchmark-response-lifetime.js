/*
 * Isolated heap benchmark for the periodic monitor response lifecycle.
 * Run from the repository root with the supported Node runtime:
 *
 *   node --expose-gc Probe/scripts/benchmark-response-lifetime.js
 *
 * The optional argument selects another Monitor.ts source. To compare with
 * master before this change is merged, extract the baseline without changing
 * the checkout, then run it in a separate process:
 *
 *   git show master:Probe/Utils/Monitors/Monitor.ts > /tmp/oneuptime-monitor-before.ts
 *   node --expose-gc Probe/scripts/benchmark-response-lifetime.js /tmp/oneuptime-monitor-before.ts
 *
 * After merging, replace master in the extraction command with the commit
 * preceding the response-lifetime change (for example, the merge's first
 * parent). Each run transpiles the selected source and uses its actual
 * probeMonitor implementation. Monitor I/O, logging and telemetry context
 * are stubbed; no network connections or production resources are used.
 *
 * All 100 monitors ingest a 512 KiB first-step body, then wait on a second
 * step. After forced garbage collection, WeakRefs show how many ingested
 * responses remain reachable while those monitors are still pending. Heap
 * deltas isolate this workload and are not estimates of total production
 * memory savings. Run before and after in separate processes; exact heap
 * values vary with Node/V8 versions.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

if (typeof global.gc !== "function") {
  throw new Error("Run this benchmark with node --expose-gc.");
}

const monitorCount = 100;
const responseBodyBytes = 512 * 1024;
const sourcePath = path.resolve(
  process.argv[2] || path.join(__dirname, "../Utils/Monitors/Monitor.ts"),
);
const source = fs.readFileSync(sourcePath, "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
}).outputText;

const url = {
  toString: () => "https://example.test",
  addRoute() {
    return this;
  },
};
let ingested = 0;
const overrides = {
  "../../Config": { PROBE_INGEST_URL: url },
  "../Probe": { getProbeId: () => "probe" },
  "../ProbeAPIRequest": {
    getDefaultRequestBody: () => ({}),
    getDefaultRequestOptions: () => ({}),
  },
  "Common/Types/API/URL": { fromString: () => url },
  "Common/Types/API/HTTPMethod": { POST: "POST" },
  "Common/Utils/API": {
    fetch: async () => {
      ingested++;
    },
  },
  "Common/Server/Utils/Logger": { debug() {}, error() {} },
  "Common/Server/Utils/Telemetry/TelemetryContext": {
    runWithContext: (_attributes, fn) => fn(),
  },
  "Common/Types/Telemetry/UnitOfWork": {
    UnitOfWork: { ProbeCheck: "check" },
    TelemetryComponent: { Probe: "probe" },
  },
};
const sandbox = {
  exports: {},
  require: (name) => overrides[name] || {},
  process,
};
vm.runInNewContext(code, sandbox, { filename: sourcePath });
const MonitorUtil = sandbox.exports.default;
const references = [];
const finishChecks = [];

MonitorUtil.probeMonitorStep = async ({ monitorStep, monitorId }) => {
  if (monitorStep.id === "second") {
    return new Promise((resolve) => {
      finishChecks.push(() => resolve(null));
    });
  }

  const response = {
    monitorId,
    // Materialize a flat string so V8 cannot represent the body as a cheap
    // repeated-string node. Hex encoding doubles the allocated byte count.
    responseBody: Buffer.alloc(
      responseBodyBytes / 2,
      monitorId.charCodeAt(0),
    ).toString("hex"),
  };
  references.push(new WeakRef(response));
  return response;
};

async function nextTurn() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function main() {
  // Let temporary transpiler/module-loading allocations become collectible
  // before the baseline, using the same collection cadence as the result.
  for (let attempt = 0; attempt < 3; attempt++) {
    global.gc();
    await nextTurn();
  }
  const before = process.memoryUsage().heapUsed;
  const runs = Array.from({ length: monitorCount }, (_, index) => {
    return MonitorUtil.probeMonitor({
      id: String(index),
      projectId: "project",
      monitorType: "Website",
      monitorSteps: {
        data: {
          monitorStepsInstanceArray: [{ id: "first" }, { id: "second" }],
        },
      },
    });
  });

  try {
    await nextTurn();
    if (ingested !== monitorCount || finishChecks.length !== monitorCount) {
      throw new Error("The selected source did not reach the expected pending state.");
    }

    // WeakRefs keep targets alive for the current JS job. Yield before GC
    // and between attempts, and only dereference once measurements are done.
    for (let attempt = 0; attempt < 3; attempt++) {
      global.gc();
      await nextTurn();
    }
    const heapDeltaMiB =
      (process.memoryUsage().heapUsed - before) / 1024 / 1024;
    const retained = references.filter((reference) => {
      return reference.deref() !== undefined;
    }).length;

    console.log(
      JSON.stringify({
        sourcePath,
        monitorCount,
        responseBodyBytes,
        completedStepResponses: ingested,
        stillPendingMonitors: finishChecks.length,
        retainedResponseObjects: retained,
        heapDeltaMiB: Number(heapDeltaMiB.toFixed(2)),
      }),
    );
  } finally {
    for (const finish of finishChecks) {
      finish();
    }
    await Promise.all(runs);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
