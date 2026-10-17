/*
 * PasswordHash has a known, pre-existing TS5.9 compile failure under
 * ts-jest (Buffer vs BinaryLike) that breaks every suite whose import
 * graph reaches it — including all full-loop telemetry suites. Nothing in
 * this suite touches password hashing; stub the module before the service
 * import graph drags it into compilation.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

import protobuf from "protobufjs";
import path from "path";
import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import OtelTracesIngestService from "../../FeatureSet/Telemetry/Services/OtelTracesIngestService";
import OtelLogsIngestService from "../../FeatureSet/Telemetry/Services/OtelLogsIngestService";
import MetricPipelineRuleService from "../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import TraceDropFilterService from "../../FeatureSet/Telemetry/Services/TraceDropFilterService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import TracePipelineService from "../../FeatureSet/Telemetry/Services/TracePipelineService";
import LlmModelPriceService from "../../FeatureSet/Telemetry/Services/LlmModelPriceService";
import LogDropFilterService from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import LogPipelineService from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import ExceptionUtil from "../../FeatureSet/Telemetry/Utils/Exception";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import OneUptimeDate, { Moment } from "Common/Types/Date";
import UUID from "Common/Utils/UUID";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { JSONObject } from "Common/Types/JSON";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * Three helpers every ingested log, span and metric data point goes through
 * were made cheaper - UUID.generateTimeOrdered (the row's _id),
 * OneUptimeDate.fromUnixNano and OneUptimeDate.toClickhouseDateTime(64) -
 * and together they were most of the CPU the row builders spent. This suite
 * runs the real OTLP walks (processLogsFromQueue, processTracesFromQueue,
 * processMetricsFromQueue) twice on the same batches: once with master's
 * three helpers patched in, verbatim, and once with this branch's. Every
 * row the walks hand the writer - logs, spans, metric data points and the
 * exceptions found in logs and span events - must be the same, field for
 * field and in the same order. The _id differs only in its random bits: its
 * timestamp prefix and its layout are the same.
 *
 * The batches are decoded the way the worker decodes an OTLP/protobuf body
 * (encode, decode, toJSON: 64-bit times as strings, ids as base64), and
 * also sent as OTLP/JSON (times as numbers, ids as hex).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6f0d8bb1-6c55-4a39-a0a9-6b0a4a4e5a10",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "0e8f0b4c-2f5e-4c9a-9a52-8b6b2d3f1c22",
);
const PROTO_DIR: string = path.resolve(
  __dirname,
  "../../FeatureSet/Telemetry/ProtoFiles/OTel/v1",
);

const UUID_V7_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const AUTO_DISCOVERY_METHODS: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
  "autoDiscoverProxmoxCluster",
  "autoDiscoverVMwareVCenter",
  "autoDiscoverCephCluster",
  "autoDiscoverStorageArray",
  "autoDiscoverDockerSwarmCluster",
  "autoDiscoverHost",
  "autoDiscoverServerless",
  "autoDiscoverCloudResource",
  "autoDiscoverRum",
  "autoDiscoverIoTFleet",
  "autoDiscoverDatabaseServer",
];

// 2026-10-17T10:11:12.345678901Z, as OTLP unix nanoseconds.
const TIME_NANO: string = "1792231872345678901";
const TIME_MS: number = 1792231872345;

// The wall clock both runs read (row createdAt and the _id's prefix).
const WALL_CLOCK_MS: number = Date.UTC(2026, 9, 17, 10, 15, 0, 0);

/*
 * Master's three helpers, verbatim (the clock and Web Crypto are read the
 * same way), patched over the branch's for the "master" run.
 */
function masterGenerateTimeOrdered(): string {
  const bytes: Uint8Array = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);

  let timestamp: number = Date.now();
  for (let i: number = 5; i >= 0; i--) {
    bytes[i] = timestamp % 256;
    timestamp = Math.floor(timestamp / 256);
  }

  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;

  const hex: string = Array.from(bytes, (b: number) => {
    return b.toString(16).padStart(2, "0");
  }).join("");

  return (
    hex.slice(0, 8) +
    "-" +
    hex.slice(8, 12) +
    "-" +
    hex.slice(12, 16) +
    "-" +
    hex.slice(16, 20) +
    "-" +
    hex.slice(20, 32)
  );
}

function masterFromUnixNano(timestamp: string | number): Date {
  if (typeof timestamp === "string") {
    const trimmed: string = timestamp.trim();
    const integerPattern: RegExp = /^[+-]?\d+$/;
    if (integerPattern.test(trimmed)) {
      const nanosPerMilli: bigint = BigInt(1000000);
      const millis: number = Number(BigInt(trimmed) / nanosPerMilli);
      return Moment(millis).toDate();
    }
    return Moment(Number(trimmed) / 1000000).toDate();
  }
  return Moment(timestamp / 1000000).toDate();
}

function masterFormatUtcClickhouseDateTime(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    return "Invalid date";
  }

  const year: string = String(date.getUTCFullYear()).padStart(4, "0");
  const month: string = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day: string = String(date.getUTCDate()).padStart(2, "0");
  const hours: string = String(date.getUTCHours()).padStart(2, "0");
  const minutes: string = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds: string = String(date.getUTCSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

// How often each of master's helpers ran in the last "master" run.
interface MasterHelperCalls {
  generateTimeOrdered: number;
  fromUnixNano: number;
  formatUtcClickhouseDateTime: number;
}

const masterHelperCalls: MasterHelperCalls = {
  generateTimeOrdered: 0,
  fromUnixNano: 0,
  formatUtcClickhouseDateTime: 0,
};

function patchInMasterHelpers(): void {
  masterHelperCalls.generateTimeOrdered = 0;
  masterHelperCalls.fromUnixNano = 0;
  masterHelperCalls.formatUtcClickhouseDateTime = 0;

  jest.spyOn(UUID, "generateTimeOrdered").mockImplementation((): string => {
    masterHelperCalls.generateTimeOrdered++;
    return masterGenerateTimeOrdered();
  });
  jest
    .spyOn(OneUptimeDate, "fromUnixNano")
    .mockImplementation((timestamp: string | number): Date => {
      masterHelperCalls.fromUnixNano++;
      return masterFromUnixNano(timestamp);
    });
  jest
    .spyOn(
      OneUptimeDate as unknown as {
        formatUtcClickhouseDateTime: (date: Date) => string;
      },
      "formatUtcClickhouseDateTime",
    )
    .mockImplementation((date: Date): string => {
      masterHelperCalls.formatUtcClickhouseDateTime++;
      return masterFormatUtcClickhouseDateTime(date);
    });
}

type CapturedRows = Record<string, Array<JSONObject>>;

function stubBackends(): CapturedRows {
  const captured: CapturedRows = {};

  jest.spyOn(Date, "now").mockReturnValue(WALL_CLOCK_MS);

  for (const ingestService of [
    OtelMetricsIngestService,
    OtelTracesIngestService,
    OtelLogsIngestService,
  ]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service: Record<string, any> = ingestService as unknown as {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [key: string]: any;
    };

    for (const method of AUTO_DISCOVERY_METHODS) {
      if (typeof service[method] === "function") {
        jest.spyOn(service, method).mockResolvedValue(null);
      }
    }

    jest.spyOn(service, "resolveTelemetryResource").mockResolvedValue({
      serviceName: "checkout",
      primaryEntityId: SERVICE_ID,
      primaryEntityType: ServiceType.OpenTelemetry,
      dataRententionInDays: 15,
      serviceRetentionConfig: null,
      serviceRetentionInDays: null,
      projectRetentionConfig: null,
      projectRetentionInDays: 15,
    });

    for (const submit of [
      "submitMetricsBuffer",
      "submitSpansBuffer",
      "submitLogsBuffer",
      "submitExceptionsBuffer",
    ]) {
      if (typeof service[submit] === "function") {
        jest
          .spyOn(service, submit)
          .mockImplementation((...args: Array<unknown>): Promise<void> => {
            // Drain like the real fan-in submit path (it splices the buffer).
            const rows: Array<JSONObject> = args[0] as Array<JSONObject>;
            const kept: Array<JSONObject> = captured[submit] || [];
            kept.push(...rows.splice(0, rows.length));
            captured[submit] = kept;
            return Promise.resolve();
          });
      }
    }

    if (typeof service["runBatchHostEnrichment"] === "function") {
      jest
        .spyOn(service, "runBatchHostEnrichment")
        .mockResolvedValue(undefined);
    }
  }

  jest
    .spyOn(MetricPipelineRuleService, "loadRules")
    .mockResolvedValue({ projectRules: [], rulesByServiceId: new Map() });
  jest
    .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(TraceDropFilterService, "loadDropFilters")
    .mockResolvedValue([] as never);
  jest
    .spyOn(TraceScrubRuleService, "loadScrubRules")
    .mockResolvedValue([] as never);
  jest
    .spyOn(TracePipelineService, "loadPipelines")
    .mockResolvedValue([] as never);
  jest
    .spyOn(LlmModelPriceService, "loadModelPrices")
    .mockResolvedValue([] as never);
  jest
    .spyOn(ExceptionUtil, "saveOrUpdateTelemetryExceptionsBatch")
    .mockResolvedValue(undefined);
  jest
    .spyOn(LogDropFilterService, "loadDropFilters")
    .mockResolvedValue([] as never);
  jest
    .spyOn(LogScrubRuleService, "loadScrubRules")
    .mockResolvedValue([] as never);
  jest
    .spyOn(LogPipelineService, "loadPipelines")
    .mockResolvedValue([] as never);

  return captured;
}

function attribute(key: string, value: unknown): JSONObject {
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { key: key, value: { intValue: value } }
      : { key: key, value: { doubleValue: value } };
  }
  if (typeof value === "boolean") {
    return { key: key, value: { boolValue: value } };
  }
  return { key: key, value: { stringValue: String(value) } };
}

const RESOURCE: JSONObject = {
  attributes: [
    attribute("service.name", "checkout"),
    attribute("service.version", "1.4.2"),
    attribute("deployment.environment", "production"),
    attribute("telemetry.sdk.language", "nodejs"),
  ],
};

// Nanosecond strings around TIME_NANO, as a protobuf decode writes them.
function nanoAt(offsetNanos: bigint): string {
  return (BigInt(TIME_NANO) + offsetNanos).toString();
}

function idBytes(seed: number, length: number): Buffer {
  const bytes: Buffer = Buffer.alloc(length);
  for (let i: number = 0; i < length; i++) {
    bytes[i] = (seed * 31 + i * 17) % 256;
  }
  return bytes;
}

function metricsPayload(): JSONObject {
  const gaugePoints: Array<JSONObject> = [];
  for (let i: number = 0; i < 40; i++) {
    gaugePoints.push({
      timeUnixNano: nanoAt(BigInt(i) * 250_000_000n),
      startTimeUnixNano: nanoAt(-60_000_000_000n),
      asDouble: i * 1.25,
      attributes: [attribute("cpu", String(i % 4)), attribute("state", "user")],
    });
  }

  return {
    resourceMetrics: [
      {
        resource: RESOURCE,
        scopeMetrics: [
          {
            scope: { name: "hostmetrics", version: "0.98.0" },
            metrics: [
              {
                name: "system.cpu.utilization",
                unit: "1",
                gauge: { dataPoints: gaugePoints },
              },
              {
                name: "http.server.requests",
                unit: "{request}",
                sum: {
                  aggregationTemporality: 2,
                  isMonotonic: true,
                  dataPoints: [
                    {
                      timeUnixNano: TIME_NANO,
                      startTimeUnixNano: "1792231800000000000",
                      asInt: 1234,
                      attributes: [attribute("http.route", "/api/orders")],
                    },
                    {
                      timeUnixNano: nanoAt(999_999_999n),
                      startTimeUnixNano: "0",
                      asInt: 7,
                    },
                  ],
                },
              },
              {
                name: "http.server.duration",
                unit: "s",
                histogram: {
                  aggregationTemporality: 1,
                  dataPoints: [
                    {
                      timeUnixNano: TIME_NANO,
                      startTimeUnixNano: nanoAt(-10_000_000_000n),
                      count: 6,
                      sum: 2.5,
                      min: 0.01,
                      max: 1.2,
                      bucketCounts: [1, 2, 3],
                      explicitBounds: [0.1, 0.5],
                      exemplars: [
                        {
                          timeUnixNano: TIME_NANO,
                          asDouble: 1.2,
                          traceId: idBytes(1, 16),
                          spanId: idBytes(2, 8),
                        },
                      ],
                    },
                  ],
                },
              },
              {
                name: "rpc.latency",
                unit: "ms",
                exponentialHistogram: {
                  aggregationTemporality: 2,
                  dataPoints: [
                    {
                      timeUnixNano: TIME_NANO,
                      startTimeUnixNano: nanoAt(-5_000_000_000n),
                      count: 4,
                      sum: 40,
                      scale: 2,
                      zeroCount: 1,
                      positive: { offset: 3, bucketCounts: [1, 2] },
                      negative: { offset: 0, bucketCounts: [] },
                    },
                  ],
                },
              },
              {
                name: "gc.pause",
                unit: "s",
                summary: {
                  dataPoints: [
                    {
                      timeUnixNano: nanoAt(-1n),
                      count: 10,
                      sum: 1.25,
                      quantileValues: [
                        { quantile: 0.5, value: 0.1 },
                        { quantile: 0.99, value: 0.4 },
                      ],
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

function tracesPayload(): JSONObject {
  const spans: Array<JSONObject> = [];

  for (let i: number = 0; i < 30; i++) {
    spans.push({
      traceId: idBytes(10 + Math.floor(i / 3), 16),
      spanId: idBytes(100 + i, 8),
      parentSpanId: i % 3 === 0 ? Buffer.alloc(0) : idBytes(100 + i - 1, 8),
      name: i % 3 === 0 ? "GET /api/orders/{id}" : "SELECT orders",
      kind: (i % 5) + 1,
      startTimeUnixNano: nanoAt(BigInt(i) * 1_000_000_000n),
      endTimeUnixNano: nanoAt(BigInt(i) * 1_000_000_000n + 2_345_678n),
      attributes: [
        attribute("http.method", "GET"),
        attribute("http.status_code", i % 7 === 0 ? 500 : 200),
        attribute("db.system", "postgresql"),
        attribute("retry", i % 2 === 0),
      ],
      events:
        i % 4 === 0
          ? [
              {
                timeUnixNano: nanoAt(BigInt(i) * 1_000_000_000n + 1_000n),
                name: "exception",
                attributes: [
                  attribute("exception.type", "TypeError"),
                  attribute(
                    "exception.message",
                    `Cannot read properties of undefined (reading 'id') #${i}`,
                  ),
                  attribute(
                    "exception.stacktrace",
                    "TypeError: Cannot read properties of undefined (reading 'id')\n    at handler (/app/orders.js:12:5)",
                  ),
                ],
              },
            ]
          : [
              {
                timeUnixNano: nanoAt(BigInt(i) * 1_000_000_000n + 5n),
                name: "cache.miss",
              },
            ],
      links:
        i % 6 === 0
          ? [{ traceId: idBytes(99, 16), spanId: idBytes(98, 8) }]
          : [],
      status: { code: i % 7 === 0 ? 2 : 1, message: i % 7 === 0 ? "boom" : "" },
    });
  }

  return {
    resourceSpans: [
      {
        resource: RESOURCE,
        scopeSpans: [
          { scope: { name: "@opentelemetry/instrumentation-http" }, spans },
        ],
      },
    ],
  };
}

function logsPayload(): JSONObject {
  const logRecords: Array<JSONObject> = [];
  const severities: Array<number> = [1, 5, 9, 13, 17, 21];

  for (let i: number = 0; i < 36; i++) {
    const severity: number = severities[i % severities.length] as number;
    logRecords.push({
      timeUnixNano: nanoAt(BigInt(i) * 333_333_333n),
      observedTimeUnixNano: nanoAt(BigInt(i) * 333_333_333n + 7n),
      severityNumber: severity,
      severityText: "",
      body:
        severity >= 17
          ? {
              stringValue: `Error: request ${i} failed\n    at Object.<anonymous> (/app/server.js:${i}:3)\n    at Module._compile (node:internal/modules/cjs/loader:1256:14)`,
            }
          : { stringValue: `request ${i} served in ${i * 3} ms` },
      attributes: [
        attribute("logger", "orders"),
        attribute("thread", `worker-${i % 4}`),
      ],
      traceId: i % 2 === 0 ? idBytes(200 + i, 16) : Buffer.alloc(0),
      spanId: i % 2 === 0 ? idBytes(300 + i, 8) : Buffer.alloc(0),
      flags: i % 2,
    });
  }

  return {
    resourceLogs: [
      {
        resource: RESOURCE,
        scopeLogs: [{ scope: { name: "filelog" }, logRecords }],
      },
    ],
  };
}

// The body an OTLP/protobuf batch reaches the worker as.
function asProtobufBody(
  file: string,
  typeName: string,
  value: JSONObject,
): JSONObject {
  const type: protobuf.Type = protobuf
    .loadSync(path.join(PROTO_DIR, file))
    .lookupType(typeName);
  const encoded: Uint8Array = type.encode(type.fromObject(value)).finish();
  return type.decode(encoded).toJSON() as JSONObject;
}

/*
 * The same batch as OTLP/JSON: 64-bit times as numbers, ids as hex. (Numbers
 * past 2^53 lose their last digits, exactly as a JSON sender's would.)
 */
function asOtlpJsonBody(protobufBody: JSONObject): JSONObject {
  return JSON.parse(
    JSON.stringify(protobufBody, (key: string, value: unknown): unknown => {
      if (
        typeof value === "string" &&
        (key === "timeUnixNano" ||
          key === "startTimeUnixNano" ||
          key === "endTimeUnixNano" ||
          key === "observedTimeUnixNano")
      ) {
        return Number(value);
      }
      if (
        typeof value === "string" &&
        (key === "traceId" || key === "spanId" || key === "parentSpanId")
      ) {
        return Buffer.from(value, "base64").toString("hex");
      }
      return value;
    }),
  ) as JSONObject;
}

interface Batch {
  name: string;
  body: () => JSONObject;
  ingest: (request: TelemetryRequest) => Promise<void>;
}

const BATCHES: Array<Batch> = [
  {
    name: "metrics (protobuf)",
    body: (): JSONObject => {
      return asProtobufBody("metrics.proto", "MetricsData", metricsPayload());
    },
    ingest: (request: TelemetryRequest): Promise<void> => {
      return OtelMetricsIngestService.processMetricsFromQueue(request);
    },
  },
  {
    name: "metrics (OTLP/JSON)",
    body: (): JSONObject => {
      return asOtlpJsonBody(
        asProtobufBody("metrics.proto", "MetricsData", metricsPayload()),
      );
    },
    ingest: (request: TelemetryRequest): Promise<void> => {
      return OtelMetricsIngestService.processMetricsFromQueue(request);
    },
  },
  {
    name: "traces (protobuf)",
    body: (): JSONObject => {
      return asProtobufBody("traces.proto", "TracesData", tracesPayload());
    },
    ingest: (request: TelemetryRequest): Promise<void> => {
      return OtelTracesIngestService.processTracesFromQueue(request);
    },
  },
  {
    name: "traces (OTLP/JSON)",
    body: (): JSONObject => {
      return asOtlpJsonBody(
        asProtobufBody("traces.proto", "TracesData", tracesPayload()),
      );
    },
    ingest: (request: TelemetryRequest): Promise<void> => {
      return OtelTracesIngestService.processTracesFromQueue(request);
    },
  },
  {
    name: "logs (protobuf)",
    body: (): JSONObject => {
      return asProtobufBody("logs.proto", "LogsData", logsPayload());
    },
    ingest: (request: TelemetryRequest): Promise<void> => {
      return OtelLogsIngestService.processLogsFromQueue(request);
    },
  },
  {
    name: "logs (OTLP/JSON)",
    body: (): JSONObject => {
      return asOtlpJsonBody(
        asProtobufBody("logs.proto", "LogsData", logsPayload()),
      );
    },
    ingest: (request: TelemetryRequest): Promise<void> => {
      return OtelLogsIngestService.processLogsFromQueue(request);
    },
  },
];

async function ingestOnce(
  batch: Batch,
  helpers: "master" | "branch",
): Promise<CapturedRows> {
  const captured: CapturedRows = stubBackends();

  if (helpers === "master") {
    patchInMasterHelpers();
  }

  try {
    await batch.ingest({
      projectId: PROJECT_ID,
      body: batch.body(),
      headers: {},
    } as unknown as TelemetryRequest);
  } finally {
    jest.restoreAllMocks();
  }

  return captured;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ingest rows are the same with master's helpers and this branch's", () => {
  for (const batch of BATCHES) {
    test(batch.name, async () => {
      const master: CapturedRows = await ingestOnce(batch, "master");

      // The master run really went through master's helpers, all three.
      expect(masterHelperCalls.generateTimeOrdered).toBeGreaterThan(0);
      expect(masterHelperCalls.fromUnixNano).toBeGreaterThan(0);
      expect(masterHelperCalls.formatUtcClickhouseDateTime).toBeGreaterThan(0);

      const branch: CapturedRows = await ingestOnce(batch, "branch");

      expect(Object.keys(branch).sort()).toEqual(Object.keys(master).sort());

      let rowsCompared: number = 0;

      for (const buffer of Object.keys(master)) {
        const masterRows: Array<JSONObject> = master[buffer]!;
        const branchRows: Array<JSONObject> = branch[buffer]!;

        expect(branchRows).toHaveLength(masterRows.length);

        for (let i: number = 0; i < masterRows.length; i++) {
          const masterRow: JSONObject = masterRows[i]!;
          const branchRow: JSONObject = branchRows[i]!;

          // Same columns, in the same order.
          expect(Object.keys(branchRow)).toEqual(Object.keys(masterRow));

          const { _id: masterId, ...masterRest } = masterRow;
          const { _id: branchId, ...branchRest } = branchRow;

          expect(branchRest).toEqual(masterRest);

          // The _id: a v7 id with the same clock prefix; only random bits differ.
          expect(String(branchId)).toMatch(UUID_V7_PATTERN);
          expect(String(masterId)).toMatch(UUID_V7_PATTERN);
          expect(String(branchId).slice(0, 13)).toBe(
            String(masterId).slice(0, 13),
          );

          rowsCompared++;
        }
      }

      expect(rowsCompared).toBeGreaterThan(0);
    });
  }

  test("the batches reach every row kind: data points, spans, logs and exceptions", async () => {
    const counts: Record<string, number> = {};

    for (const batch of BATCHES) {
      const branch: CapturedRows = await ingestOnce(batch, "branch");

      for (const buffer of Object.keys(branch)) {
        counts[buffer] = (counts[buffer] || 0) + branch[buffer]!.length;
      }
    }

    expect(counts["submitMetricsBuffer"]).toBeGreaterThanOrEqual(2 * 45);
    expect(counts["submitSpansBuffer"]).toBe(2 * 30);
    expect(counts["submitLogsBuffer"]).toBe(2 * 36);
    // Exceptions from span events and from error logs with a stack trace.
    expect(counts["submitExceptionsBuffer"]).toBeGreaterThan(0);
  });

  test("row times are read from the batch to the millisecond, not from the wall clock", async () => {
    const branch: CapturedRows = await ingestOnce(BATCHES[4]!, "branch");
    const logs: Array<JSONObject> = branch["submitLogsBuffer"]!;

    // The batch's own second; the nanoseconds as the float the walk reads.
    expect(
      String(logs[0]!["time"]).startsWith(
        `${masterFormatUtcClickhouseDateTime(new Date(TIME_MS))}.`,
      ),
    ).toBe(true);
    expect(String(logs[0]!["time"]).startsWith("2026-10-17 10:11:12.")).toBe(
      true,
    );
    expect(logs[0]!["timeUnixNano"]).toBe(
      Math.trunc(parseFloat(TIME_NANO)).toString(),
    );
    // The wall clock only stamps when the row was written.
    expect(logs[0]!["createdAt"]).toBe("2026-10-17 10:15:00");
  });
});
