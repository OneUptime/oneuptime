// Steady OTLP load as OpenTelemetry Collectors send it: OTLP/protobuf over
// HTTP, gzip-compressed, one collector per project sending a batch of logs,
// one of spans and one of metric points every <periodMs>.
//
// Usage: node otlp-load.js <seed.json> <minutes> [collectors] [periodMs]
// Settings: LOGS_PER_BATCH (100), SPANS_PER_BATCH (50), HOSTS (4),
// METRICS (10), PERF_APP_URL (http://localhost:3371).
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const REPO = path.resolve(__dirname, "..", "..");
const protobuf = require(
  path.join(REPO, "packages/App/node_modules/protobufjs"),
);
const PROTO = path.join(
  REPO,
  "packages/App/FeatureSet/Telemetry/ProtoFiles/OTel/v1",
);
const BASE = process.env.PERF_APP_URL || "http://localhost:3371";

const seed = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const minutes = Number(process.argv[3] || "10");
const collectors = Math.min(
  Number(process.argv[4] || "20"),
  seed.projects.length,
);
const periodMs = Number(process.argv[5] || "2000");
const LOGS = Number(process.env.LOGS_PER_BATCH || "100");
const SPANS = Number(process.env.SPANS_PER_BATCH || "50");
const HOSTS = Number(process.env.HOSTS || "4");
const METRICS = Number(process.env.METRICS || "10");

const logsType = protobuf
  .loadSync(path.join(PROTO, "logs_service.proto"))
  .lookupType("opentelemetry.proto.collector.logs.v1.ExportLogsServiceRequest");
const tracesType = protobuf
  .loadSync(path.join(PROTO, "trace_service.proto"))
  .lookupType(
    "opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest",
  );
const metricsType = protobuf
  .loadSync(path.join(PROTO, "metrics_service.proto"))
  .lookupType(
    "opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceRequest",
  );

const SERVICES = ["checkout", "cart", "payments", "search", "auth"];
const LEVELS = [
  { number: 9, text: "INFO" },
  { number: 9, text: "INFO" },
  { number: 9, text: "INFO" },
  { number: 13, text: "WARN" },
  { number: 17, text: "ERROR" },
];

// Load, not a test: any spread of values will do.
function below(limit) {
  return Math.floor(Math.random() * limit);
}

function attribute(key, value) {
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { key, value: { intValue: value } }
      : { key, value: { doubleValue: value } };
  }

  return { key, value: { stringValue: String(value) } };
}

function resourceOf(project, host, service) {
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
}

function nowNano() {
  return BigInt(Date.now()) * 1000000n;
}

function logsBody(project) {
  const now = nowNano();
  const perService = Math.ceil(LOGS / SERVICES.length);
  const resourceLogs = SERVICES.map((service, at) => {
    const logRecords = [];

    for (let index = 0; index < perService; index++) {
      const level = LEVELS[below(LEVELS.length)];
      logRecords.push({
        timeUnixNano: (now - BigInt(below(1000)) * 1000000n).toString(),
        observedTimeUnixNano: now.toString(),
        severityNumber: level.number,
        severityText: level.text,
        body: {
          stringValue: `GET /api/v1/orders/${below(100000)} handled in ${below(500)} ms user=${below(5000)} status=${level.number > 13 ? 500 : 200}`,
        },
        attributes: [
          attribute("http.method", "GET"),
          attribute("http.route", "/api/v1/orders/:id"),
          attribute("http.status_code", level.number > 13 ? 500 : 200),
          attribute("user.id", `u${below(5000)}`),
        ],
        traceId: crypto.randomBytes(16),
        spanId: crypto.randomBytes(8),
      });
    }

    return {
      resource: resourceOf(project, at % HOSTS, service),
      scopeLogs: [{ scope: { name: "app.logger" }, logRecords }],
    };
  });

  return logsType.encode(logsType.fromObject({ resourceLogs })).finish();
}

function tracesBody(project) {
  const now = nowNano();
  const perService = Math.ceil(SPANS / SERVICES.length);
  const resourceSpans = SERVICES.map((service, at) => {
    const spans = [];
    const traceId = crypto.randomBytes(16);
    let parent = null;

    for (let index = 0; index < perService; index++) {
      const spanId = crypto.randomBytes(8);
      const start = now - BigInt(below(2000) + 5) * 1000000n;
      const isError = below(20) === 0;

      spans.push({
        traceId,
        spanId,
        parentSpanId: parent || undefined,
        name: index === 0 ? "GET /api/v1/orders/:id" : "SELECT orders",
        kind: index === 0 ? 2 : 3,
        startTimeUnixNano: start.toString(),
        endTimeUnixNano: (start + BigInt(below(200) + 1) * 1000000n).toString(),
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
      });

      if (index === 0) {
        parent = spanId;
      }
    }

    return {
      resource: resourceOf(project, at % HOSTS, service),
      scopeSpans: [{ scope: { name: "app.tracer" }, spans }],
    };
  });

  return tracesType.encode(tracesType.fromObject({ resourceSpans })).finish();
}

function metricsBody(project) {
  const now = nowNano();
  const resourceMetrics = [];

  for (let host = 0; host < HOSTS; host++) {
    const metrics = [
      {
        name: "system.cpu.utilization",
        unit: "1",
        gauge: {
          dataPoints: [0, 1, 2, 3].map((cpu) => {
            return {
              timeUnixNano: now.toString(),
              asDouble: below(1000) / 1000,
              attributes: [
                attribute("cpu", String(cpu)),
                attribute("state", "user"),
              ],
            };
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
            return {
              timeUnixNano: now.toString(),
              startTimeUnixNano: (now - 60000000000n).toString(),
              asInt: String(below(8000000) * 1000),
              attributes: [attribute("state", state)],
            };
          }),
        },
      },
    ];

    for (let index = 0; index < METRICS; index++) {
      metrics.push({
        name: `http.server.request.count.${index}`,
        unit: "1",
        sum: {
          aggregationTemporality: 2,
          isMonotonic: true,
          dataPoints: [200, 500].map((code) => {
            return {
              timeUnixNano: now.toString(),
              startTimeUnixNano: (now - 600000000000n).toString(),
              asInt: String(below(100000)),
              attributes: [
                attribute("http.status_code", code),
                attribute("http.route", "/api/v1/orders/:id"),
              ],
            };
          }),
        },
      });
    }

    metrics.push({
      name: "http.server.duration",
      unit: "ms",
      histogram: {
        aggregationTemporality: 2,
        dataPoints: [
          {
            timeUnixNano: now.toString(),
            startTimeUnixNano: (now - 60000000000n).toString(),
            count: "120",
            sum: 4200.5,
            bucketCounts: ["10", "40", "50", "15", "5"],
            explicitBounds: [5, 10, 50, 100],
            attributes: [attribute("http.route", "/api/v1/orders/:id")],
          },
        ],
      },
    });

    resourceMetrics.push({
      resource: resourceOf(project, host, SERVICES[host % SERVICES.length]),
      scopeMetrics: [{ scope: { name: "app.meter" }, metrics }],
    });
  }

  return metricsType
    .encode(metricsType.fromObject({ resourceMetrics }))
    .finish();
}

const stats = { sent: 0, failed: 0, bytes: 0, statuses: {} };

async function post(signal, key, body) {
  const compressed = zlib.gzipSync(body);
  stats.bytes += compressed.length;

  try {
    const response = await fetch(`${BASE}/otlp/v1/${signal}`, {
      method: "POST",
      headers: {
        "content-type": "application/x-protobuf",
        "content-encoding": "gzip",
        "x-oneuptime-token": key,
      },
      body: compressed,
    });
    await response.arrayBuffer();
    stats.statuses[response.status] =
      (stats.statuses[response.status] || 0) + 1;

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

async function collector(index, deadline) {
  const project = seed.projects[index];

  // Spread the collectors over the period.
  await sleep((periodMs / collectors) * index);

  while (Date.now() < deadline) {
    const started = Date.now();
    await Promise.all([
      post("logs", project.ingestionKey, logsBody(project.index)),
      post("traces", project.ingestionKey, tracesBody(project.index)),
      post("metrics", project.ingestionKey, metricsBody(project.index)),
    ]);
    await sleep(Math.max(0, periodMs - (Date.now() - started)));
  }
}

(async () => {
  const deadline = Date.now() + minutes * 60000;
  const timer = setInterval(() => {
    console.log(`${new Date().toISOString()} ${JSON.stringify(stats)}`);
  }, 30000);

  await Promise.all(
    Array.from({ length: collectors }, (_unused, index) => {
      return collector(index, deadline);
    }),
  );
  clearInterval(timer);

  const perSecond = 1000 / periodMs;
  console.log(
    `done ${JSON.stringify(stats)}; per second: ${Math.round(collectors * LOGS * perSecond)} logs, ` +
      `${Math.round(collectors * SPANS * perSecond)} spans, ` +
      `${Math.round(collectors * HOSTS * (4 + 3 + METRICS * 2 + 1) * perSecond)} metric points`,
  );
})();
