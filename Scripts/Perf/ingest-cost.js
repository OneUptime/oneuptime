// What one OTLP batch costs the App's ingest, in process: the kit's batch
// shapes (otlp-load.js's), gzipped protobuf as the telemetry queue stores
// them, decoded by OtelPayloadDecoder, walked by the real logs, traces and
// metrics services, and the rows written out as the insert body the tree
// sends ClickHouse. The datastores are stubbed: a project's resource, its
// pipelines, filters and scrub rules (none), the exceptions it keeps, and
// the fan-in writer, whose submit only writes the body. So it is the CPU of
// ingest's own work, without the App's other jobs - the noise a whole-App
// window carries on a shared machine.
//
// Usage: node ingest-cost.js <packages/App of the tree> [batches] [rounds]
//        (defaults 600 and 3; run it with --expose-gc for a clean start a
//        round). Prints, per signal: rows a batch, and the median over the
//        rounds of CPU, wall time and garbage collection a batch, in µs.
"use strict";

const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const { PerformanceObserver } = require("perf_hooks");

const APP = path.resolve(process.argv[2] || ".");
const BATCHES = Number(process.argv[3] || "600");
const ROUNDS = Number(process.argv[4] || "3");

process.env.LOG_LEVEL = "ERROR";
require(path.join(APP, "node_modules/ts-node")).register({
  transpileOnly: true,
  project: path.join(APP, "tsconfig.json"),
});

const fromApp = (file) => {
  return require(path.join(APP, file));
};
const protobuf = fromApp("node_modules/protobufjs");
const PROTO = path.join(APP, "FeatureSet/Telemetry/ProtoFiles/OTel/v1");

const Logs = fromApp(
  "FeatureSet/Telemetry/Services/OtelLogsIngestService",
).default;
const Traces = fromApp(
  "FeatureSet/Telemetry/Services/OtelTracesIngestService",
).default;
const Metrics = fromApp(
  "FeatureSet/Telemetry/Services/OtelMetricsIngestService",
).default;
const Decoder = fromApp("FeatureSet/Telemetry/Utils/OtelPayloadDecoder");
const BodyStore = fromApp(
  "FeatureSet/Telemetry/Utils/TelemetryBodyStore",
).default;
const ExceptionUtil = fromApp("FeatureSet/Telemetry/Utils/Exception").default;
const Writer = fromApp(
  "node_modules/Common/Server/Utils/Telemetry/TelemetryFanInWriter",
).default;
const TelemetryUtil = fromApp(
  "node_modules/Common/Server/Utils/Telemetry/Telemetry",
).default;
const ObjectID = fromApp("node_modules/Common/Types/ObjectID").default;
const ProductType = fromApp(
  "node_modules/Common/Types/MeteredPlan/ProductType",
).default;
const ServiceType = fromApp(
  "node_modules/Common/Types/Telemetry/ServiceType",
).default;

// The insert body as the tree writes it.
let encodeBody;
try {
  const JsonEachRowBody = fromApp(
    "node_modules/Common/Server/Utils/AnalyticsDatabase/JsonEachRowBody",
  ).default;
  encodeBody = (rows) => {
    return JsonEachRowBody.encode(rows);
  };
} catch {
  // A tree before JsonEachRowBody: what @clickhouse/client wrote for it.
  encodeBody = (rows) => {
    return Buffer.from(
      rows
        .map((row) => {
          return JSON.stringify(row) + "\n";
        })
        .join(""),
    );
  };
}

const none = async () => {
  return [];
};
for (const [file, loaders] of [
  ["FeatureSet/Telemetry/Services/LogPipelineService", ["loadPipelines"]],
  ["FeatureSet/Telemetry/Services/LogDropFilterService", ["loadDropFilters"]],
  ["FeatureSet/Telemetry/Services/LogScrubRuleService", ["loadScrubRules"]],
  ["FeatureSet/Telemetry/Services/TraceDropFilterService", ["loadDropFilters"]],
  ["FeatureSet/Telemetry/Services/TraceScrubRuleService", ["loadScrubRules"]],
  ["FeatureSet/Telemetry/Services/TracePipelineService", ["loadPipelines"]],
  ["FeatureSet/Telemetry/Services/LlmModelPriceService", ["loadModelPrices"]],
]) {
  for (const loader of loaders) {
    fromApp(file).default[loader] = none;
  }
}
fromApp(
  "FeatureSet/Telemetry/Services/MetricPipelineRuleService",
).default.loadRules = async () => {
  return { projectRules: [], rulesByServiceId: new Map() };
};
TelemetryUtil.indexMetricNameServiceNameMap = async () => {};
ExceptionUtil.saveOrUpdateTelemetryExceptionsBatch = async () => {};
ExceptionUtil.resolveGroupFingerprints = async () => {
  return new Map();
};

const SERVICE_ID = new ObjectID("0e8f0b4c-2f5e-4c9a-9a52-8b6b2d3f1c22");
const PROJECT_ID = new ObjectID("6f0d8bb1-6c55-4a39-a0a9-6b0a4a4e5a10");
for (const service of [Logs, Traces, Metrics]) {
  for (const name of Object.getOwnPropertyNames(service)) {
    if (name.startsWith("autoDiscover")) {
      service[name] = async () => {
        return null;
      };
    }
  }
  service.resolveTelemetryResource = async () => {
    return {
      serviceName: "checkout",
      primaryEntityId: SERVICE_ID,
      primaryEntityType: ServiceType.OpenTelemetry,
      dataRententionInDays: 15,
      serviceRetentionConfig: null,
      serviceRetentionInDays: null,
      projectRetentionConfig: null,
      projectRetentionInDays: 15,
    };
  };
  if (service.runBatchHostEnrichment) {
    service.runBatchHostEnrichment = async () => {};
  }
}

let rowsWritten = 0;
Writer.submit = async (_target, rows) => {
  encodeBody(rows);
  rowsWritten += rows.length;
  return { flushed: Promise.resolve() };
};

// otlp-load.js's batches, from 20 projects.
const roots = {
  logs: protobuf
    .loadSync(path.join(PROTO, "logs.proto"))
    .lookupType("LogsData"),
  traces: protobuf
    .loadSync(path.join(PROTO, "traces.proto"))
    .lookupType("TracesData"),
  metrics: protobuf
    .loadSync(path.join(PROTO, "metrics.proto"))
    .lookupType("MetricsData"),
};
let seed = 1;
const below = (n) => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed % n;
};
const attribute = (key, value) => {
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { key, value: { intValue: value } }
      : { key, value: { doubleValue: value } };
  }
  return { key, value: { stringValue: String(value) } };
};
const SERVICES = ["checkout", "cart", "payments", "search", "auth"];
const resourceOf = (project, host, service) => {
  return {
    attributes: [
      attribute("service.name", service),
      attribute("service.version", `1.4.${project % 7}`),
      attribute("host.name", `host-${project}-${host}`),
      attribute("deployment.environment", "production"),
      attribute("k8s.namespace.name", "shop"),
      attribute("k8s.pod.name", `${service}-${host}-7c9f`),
    ],
  };
};
const MS = BigInt(1000000);
const now = BigInt(Date.now()) * MS;
const LEVELS = [
  { number: 9, text: "INFO" },
  { number: 9, text: "INFO" },
  { number: 13, text: "WARN" },
  { number: 17, text: "ERROR" },
];

function logsOf(project) {
  return {
    resourceLogs: SERVICES.map((service, at) => {
      return {
        resource: resourceOf(project, at % 4, service),
        scopeLogs: [
          {
            scope: { name: "app.logger" },
            logRecords: Array.from({ length: 20 }, () => {
              const level = LEVELS[below(4)];
              return {
                timeUnixNano: (now - BigInt(below(1000)) * MS).toString(),
                observedTimeUnixNano: now.toString(),
                severityNumber: level.number,
                severityText: level.text,
                body: {
                  stringValue: `GET /api/v1/orders/${below(100000)} handled in ${below(500)} ms user=${below(5000)} status=200`,
                },
                attributes: [
                  attribute("http.method", "GET"),
                  attribute("http.route", "/api/v1/orders/:id"),
                  attribute("http.status_code", 200),
                  attribute("user.id", `u${below(5000)}`),
                ],
                traceId: crypto.randomBytes(16),
                spanId: crypto.randomBytes(8),
              };
            }),
          },
        ],
      };
    }),
  };
}

function tracesOf(project) {
  return {
    resourceSpans: SERVICES.map((service, at) => {
      const traceId = crypto.randomBytes(16);
      let parent = null;
      return {
        resource: resourceOf(project, at % 4, service),
        scopeSpans: [
          {
            scope: { name: "app.tracer" },
            spans: Array.from({ length: 10 }, (_, index) => {
              const spanId = crypto.randomBytes(8);
              const start = now - BigInt(below(2000) + 5) * MS;
              const isError = below(20) === 0;
              const span = {
                traceId,
                spanId,
                parentSpanId: parent || undefined,
                name: index === 0 ? "GET /api/v1/orders/:id" : "SELECT orders",
                kind: index === 0 ? 2 : 3,
                startTimeUnixNano: start.toString(),
                endTimeUnixNano: (
                  start +
                  BigInt(below(200) + 1) * MS
                ).toString(),
                attributes: [
                  attribute("http.method", "GET"),
                  attribute("http.route", "/api/v1/orders/:id"),
                  attribute("db.system", "postgresql"),
                  attribute("net.peer.name", `db-${project % 3}`),
                ],
                status: { code: isError ? 2 : 1 },
                events: isError
                  ? [
                      {
                        timeUnixNano: start.toString(),
                        name: "exception",
                        attributes: [
                          attribute("exception.type", "TimeoutError"),
                          attribute(
                            "exception.message",
                            "query timed out after 2000 ms",
                          ),
                          attribute(
                            "exception.stacktrace",
                            "TimeoutError: query timed out\n    at Query.run (db.js:120:11)\n    at Orders.get (orders.js:42:9)",
                          ),
                        ],
                      },
                    ]
                  : [],
              };
              if (index === 0) {
                parent = spanId;
              }
              return span;
            }),
          },
        ],
      };
    }),
  };
}

function metricsOf(project) {
  const point = (extra) => {
    return { timeUnixNano: now.toString(), ...extra };
  };
  return {
    resourceMetrics: [0, 1, 2, 3].map((host) => {
      return {
        resource: resourceOf(project, host, SERVICES[host]),
        scopeMetrics: [
          {
            scope: { name: "app.meter" },
            metrics: [
              {
                name: "system.cpu.utilization",
                unit: "1",
                gauge: {
                  dataPoints: [0, 1, 2, 3].map((cpu) => {
                    return point({
                      asDouble: below(1000) / 1000,
                      attributes: [
                        attribute("cpu", String(cpu)),
                        attribute("state", "user"),
                      ],
                    });
                  }),
                },
              },
              {
                name: "system.memory.usage",
                unit: "By",
                sum: {
                  aggregationTemporality: 2,
                  isMonotonic: false,
                  dataPoints: ["used", "free", "cached"].map((state) => {
                    return point({
                      startTimeUnixNano: (now - BigInt(60000) * MS).toString(),
                      asInt: String(below(8000000) * 1000),
                      attributes: [attribute("state", state)],
                    });
                  }),
                },
              },
              ...Array.from({ length: 10 }, (_, index) => {
                return {
                  name: `http.server.request.count.${index}`,
                  unit: "1",
                  sum: {
                    aggregationTemporality: 2,
                    isMonotonic: true,
                    dataPoints: [200, 500].map((code) => {
                      return point({
                        startTimeUnixNano: (
                          now -
                          BigInt(600000) * MS
                        ).toString(),
                        asInt: String(below(100000)),
                        attributes: [
                          attribute("http.status_code", code),
                          attribute("http.route", "/api/v1/orders/:id"),
                        ],
                      });
                    }),
                  },
                };
              }),
              {
                name: "http.server.duration",
                unit: "ms",
                histogram: {
                  aggregationTemporality: 2,
                  dataPoints: [
                    point({
                      startTimeUnixNano: (now - BigInt(60000) * MS).toString(),
                      count: "120",
                      sum: 4200.5,
                      bucketCounts: ["10", "40", "50", "15", "5"],
                      explicitBounds: [5, 10, 50, 100],
                      attributes: [
                        attribute("http.route", "/api/v1/orders/:id"),
                      ],
                    }),
                  ],
                },
              },
            ],
          },
        ],
      };
    }),
  };
}

function storedBodies(project) {
  const stored = (type, data) => {
    return zlib.gzipSync(type.encode(type.fromObject(data)).finish());
  };
  return {
    logs: stored(roots.logs, logsOf(project)),
    traces: stored(roots.traces, tracesOf(project)),
    metrics: stored(roots.metrics, metricsOf(project)),
  };
}

const PRODUCT = {
  logs: ProductType.Logs,
  traces: ProductType.Traces,
  metrics: ProductType.Metrics,
};
const INGEST = {
  logs: (request) => {
    return Logs.processLogsFromQueue(request);
  },
  traces: (request) => {
    return Traces.processTracesFromQueue(request);
  },
  metrics: (request) => {
    return Metrics.processMetricsFromQueue(request);
  },
};

let gcMs = 0;
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    gcMs += entry.duration;
  }
}).observe({ entryTypes: ["gc"] });

async function run(signal, batches, bodies) {
  for (let n = 0; n < batches; n++) {
    const stored = bodies[n % bodies.length][signal];
    BodyStore.readBody = async () => {
      return stored;
    };
    const body = await Decoder.default.decodeFromQueue({
      productType: PRODUCT[signal],
      format: Decoder.OtelPayloadFormat.Protobuf,
      encoding: "gzip",
      bodyKey: "ingest-cost",
    });
    await INGEST[signal]({
      projectId: PROJECT_ID,
      body,
      headers: {},
      receivedAt: new Date(),
    });
  }
}

const SIGNALS = ["logs", "traces", "metrics"];

(async () => {
  const bodies = Array.from({ length: 20 }, (_, project) => {
    return storedBodies(project);
  });
  // Warm up: every code path compiled and optimised before it is measured.
  for (const signal of SIGNALS) {
    await run(signal, 100, bodies);
  }

  const results = { logs: [], traces: [], metrics: [] };
  for (let round = 0; round < ROUNDS; round++) {
    for (const signal of SIGNALS) {
      if (global.gc) {
        global.gc();
      }
      gcMs = 0;
      rowsWritten = 0;
      const cpu = process.cpuUsage();
      const wall = process.hrtime.bigint();
      await run(signal, BATCHES, bodies);
      const used = process.cpuUsage(cpu);
      const wallMs = Number(process.hrtime.bigint() - wall) / 1e6;
      results[signal].push({
        cpuUs: (used.user + used.system) / BATCHES,
        wallUs: (wallMs * 1000) / BATCHES,
        gcUs: (gcMs * 1000) / BATCHES,
        rows: rowsWritten / BATCHES,
      });
    }
  }

  for (const signal of SIGNALS) {
    const rounds = results[signal];
    const median = (key) => {
      const sorted = rounds
        .map((round) => {
          return round[key];
        })
        .sort((a, b) => {
          return a - b;
        });
      return sorted[Math.floor(sorted.length / 2)].toFixed(0);
    };
    console.log(
      `${signal}: ${rounds[0].rows.toFixed(0)} rows a batch, cpu ${median("cpuUs")} µs, wall ${median("wallUs")} µs, gc ${median("gcUs")} µs (cpu by round: ${rounds
        .map((round) => {
          return round.cpuUs.toFixed(0);
        })
        .join(", ")})`,
    );
  }
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
