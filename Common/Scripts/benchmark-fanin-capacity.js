/*
 * Isolated fan-in admission benchmark against the actual writer source.
 * Run with the supported Node runtime from the repository root:
 *
 *   node --expose-gc Common/Scripts/benchmark-fanin-capacity.js
 *
 * Compare in separate processes, extracting the previous source without
 * modifying the checkout (the revision is the pre-change master):
 *
 *   git show 0b23baed11:Common/Server/Utils/Telemetry/TelemetryFanInWriter.ts > /tmp/oneuptime-fanin-before.ts
 *   node --expose-gc Common/Scripts/benchmark-fanin-capacity.js /tmp/oneuptime-fanin-before.ts
 *
 * 200 producers submit chunks sequentially and await all their acceptance
 * acknowledgements at the end, as ingest jobs do. ClickHouse remains blocked
 * during measurement. The only changes between runs are the selected writer
 * source. I/O, logging, shutdown registration and token generation are stubbed.
 * Heap deltas include rows still held by blocked callers, not just admitted
 * buffers; exact values vary with V8. These are isolated workload measurements,
 * not estimates of total deployment memory savings or throughput.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

if (typeof global.gc !== "function") {
  throw new Error("Run this benchmark with node --expose-gc.");
}

const sourcePath = path.resolve(
  process.argv[2] ||
    path.join(__dirname, "../Server/Utils/Telemetry/TelemetryFanInWriter.ts"),
);
const code = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
}).outputText;
let nextToken = 0;
const overrides = {
  "../Logger": { debug() {}, info() {}, warn() {}, error() {} },
  "../../../Types/Sleep": {
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  },
  "../../../Utils/UUID": {
    generateTimeOrdered: () => String(nextToken++),
  },
  "../GracefulShutdown": {
    __esModule: true,
    default: { registerHandler() {} },
    ShutdownPriority: { Buffers: 1 },
  },
  "../AnalyticsDatabase/InsertDedupContext": {
    nextInsertDedupToken: () => undefined,
  },
  "@clickhouse/client": { ClickHouseError: class extends Error {} },
};
const sandbox = {
  exports: {},
  process,
  setTimeout,
  clearTimeout,
  require: (name) => {
    if (!(name in overrides)) {
      throw new Error(`Unexpected writer dependency: ${name}`);
    }
    return overrides[name];
  },
};
vm.runInNewContext(code, sandbox, { filename: sourcePath });

async function nextTurn() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function collect() {
  for (let i = 0; i < 3; i++) {
    global.gc();
    await nextTurn();
  }
}

async function main() {
  const producerCount = 200;
  const chunksPerProducer = 3;
  const rowsPerChunk = 100;
  const rowBodyBytes = 512;
  const maxPendingRows = 1000;
  const writer = new sandbox.exports.TelemetryFanInWriter({
    maxBatchRows: 500,
    maxPendingRows,
    maxConcurrentInserts: 4,
    maxWaitMs: 60_000,
    retryMaxAttempts: 1,
    retryBaseDelayMs: 1,
    retryMaxDelayMs: 1,
  });
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let insertedRows = 0;
  const target = {
    model: { tableName: "CapacityBenchmark" },
    insertJsonRows: async (rows) => {
      await gate;
      insertedRows += rows.length;
    },
  };

  await collect();
  const heapBefore = process.memoryUsage().heapUsed;
  let createdRows = 0;
  let acceptedSubmissions = 0;
  const producers = Array.from(
    { length: producerCount },
    async (_, producer) => {
      const acks = [];
      for (let chunk = 0; chunk < chunksPerProducer; chunk++) {
        const rows = Array.from({ length: rowsPerChunk }, (_, row) => {
          createdRows++;
          return {
            producer,
            chunk,
            row,
            // A flat, separately allocated body for each row.
            body: Buffer.alloc(rowBodyBytes / 2, row % 256).toString("hex"),
          };
        });
        const { flushed } = await writer.submit(target, rows);
        acceptedSubmissions++;
        acks.push(flushed);
      }
      await Promise.all(acks);
    },
  );

  try {
    await nextTurn();
    await collect();
    const heapDeltaMiB =
      (process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024;
    process.stdout.write(
      `${JSON.stringify(
        {
          node: process.version,
          sourcePath,
          producerCount,
          chunksPerProducer,
          rowsPerChunk,
          rowBodyBytes,
          maxPendingRows,
          createdRows,
          acceptedSubmissions,
          ...writer.getStats(),
          heapDeltaMiB: Number(heapDeltaMiB.toFixed(2)),
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    release();
    await writer.flushAll();
    await Promise.all(producers);
    if (insertedRows !== producerCount * chunksPerProducer * rowsPerChunk) {
      throw new Error(`Writer lost rows: inserted ${insertedRows}.`);
    }
    if (writer.getStats().pendingRows !== 0) {
      throw new Error("Writer retained pending rows after drain.");
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
