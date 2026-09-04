/*
 * Run from the repository root, using separate processes for before and after:
 *
 * git show 0b23baed11:App/FeatureSet/Telemetry/Services/LogPipelineService.ts > /tmp/oneuptime-log-pipeline-before.ts
 * node --expose-gc App/scripts/benchmark-pipeline-loads.js /tmp/oneuptime-log-pipeline-before.ts
 * node --expose-gc App/scripts/benchmark-pipeline-loads.js
 *
 * Executes the selected service unchanged with asynchronous database stubs.
 * The cache and filter compiler are real source. This measures redundant query
 * calls/configuration graphs in one cold-project burst, not Postgres latency,
 * network usage, or total ingestion throughput. Results retain all callers'
 * returned graphs to model overlapping ingest requests consuming their config.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

if (typeof global.gc !== "function") {
  throw new Error("Run with node --expose-gc.");
}

const root = path.resolve(__dirname, "../..");
const sourcePath = path.resolve(
  process.argv[2] ||
    path.join(root, "App/FeatureSet/Telemetry/Services/LogPipelineService.ts"),
);
const callers = 1000;
const pipelineCount = 20;
let queries = 0;
let filterCompilations = 0;

const stubs = {
  "Common/Models/DatabaseModels/LogPipeline": class LogPipeline {},
  "Common/Models/DatabaseModels/LogPipelineProcessor": class LogPipelineProcessor {},
  "Common/Server/Services/DatabaseService": class DatabaseService {
    async findBy(data) {
      queries++;
      await Promise.resolve();
      if (data.query.projectId) {
        return Array.from({ length: pipelineCount }, (_, index) => ({
          _id: `pipeline-${index}`,
          name: `pipeline-${index}`,
          sortOrder: index,
          filterQuery: "attributes.level = 'error' AND body LIKE 'request %'",
        }));
      }
      return [
        {
          _id: `processor-${data.query.logPipelineId}`,
          name: "category",
          configuration: JSON.stringify({
            targetKey: "category",
            categories: [
              { name: "errors", filterQuery: "attributes.level = 'error'" },
            ],
          }),
        },
      ];
    }
  },
  "Common/Types/BaseDatabase/SortOrder": { Ascending: "ASC" },
  "Common/Types/Database/LimitMax": 10000,
  "Common/Types/Log/LogPipelineProcessorType": {},
  "Common/Types/Log/LogSeverity": {},
  "Common/Utils/Grok/Grok": {},
  "Common/Server/Utils/Logger": { error: () => {} },
  "../Utils/PipelineProcessorConfig": () => ({}),
};
const sources = {
  "Common/Server/Infrastructure/InMemoryTTLCache":
    "Common/Server/Infrastructure/InMemoryTTLCache.ts",
  "../Utils/PipelineCache": "App/FeatureSet/Telemetry/Utils/PipelineCache.ts",
  "../Utils/LogFilterEvaluator":
    "App/FeatureSet/Telemetry/Utils/LogFilterEvaluator.ts",
};
const modules = new Map();
function load(file) {
  if (modules.has(file)) {
    return modules.get(file);
  }
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const sandbox = {
    exports: {},
    require: (name) => {
      if (Object.hasOwn(stubs, name)) {
        return stubs[name];
      }
      if (Object.hasOwn(sources, name)) {
        return load(path.join(root, sources[name]));
      }
      throw new Error(`Unexpected import: ${name}`);
    },
  };
  vm.runInNewContext(code, sandbox, { filename: file });
  if (file.endsWith("LogFilterEvaluator.ts")) {
    const compile = sandbox.exports.compileFilter;
    sandbox.exports.compileFilter = (query) => {
      filterCompilations++;
      return compile(query);
    };
  }
  modules.set(file, sandbox.exports);
  return sandbox.exports;
}
const service = load(sourcePath).default;
async function collectGarbage() {
  for (let index = 0; index < 3; index++) {
    global.gc();
    await new Promise((resolve) => setImmediate(resolve));
  }
}
async function main() {
  await service.loadPipelines({ toString: () => "warmup" });
  queries = 0;
  filterCompilations = 0;
  await collectGarbage();
  const heapBefore = process.memoryUsage().heapUsed;
  const cpuBefore = process.cpuUsage();
  const results = await Promise.all(
    Array.from({ length: callers }, () =>
      service.loadPipelines({ toString: () => "project" }),
    ),
  );
  const cpu = process.cpuUsage(cpuBefore);
  if (
    results.some(
      (result) =>
        result.length !== pipelineCount ||
        result.some((item) => item.processors.length !== 1),
    )
  ) {
    throw new Error("Loaded pipeline/processor count mismatch.");
  }
  await collectGarbage();
  process.stdout.write(
    `${JSON.stringify(
      {
        node: process.version,
        sourcePath,
        callers,
        pipelineCount,
        databaseQueries: queries,
        filterCompilations,
        distinctConfigurationGraphs: new Set(results).size,
        cpuMilliseconds: (cpu.user + cpu.system) / 1000,
        retainedHeapMiB: Number(
          ((process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024).toFixed(
            2,
          ),
        ),
      },
      null,
      2,
    )}\n`,
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
