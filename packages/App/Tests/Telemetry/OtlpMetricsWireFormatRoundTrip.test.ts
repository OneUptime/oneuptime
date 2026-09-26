import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import http2 from "http2";
import path from "path";
import protobuf from "protobufjs";
import { Readable } from "stream";
import zlib from "zlib";
import {
  MISSING_INGESTION_TOKEN_MESSAGE,
  OTLP_PROTO_LOADER_OPTIONS,
  handleExport,
  startGrpcServer,
} from "../../FeatureSet/Telemetry/GrpcServer";
import OpenTelemetryRequestMiddleware from "../../FeatureSet/Telemetry/Middleware/OtelRequestMiddleware";
import MetricPipelineRuleService from "../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import MetricsQueueService from "../../FeatureSet/Telemetry/Services/Queue/MetricsQueueService";
import { TelemetryIngestJobData } from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import OtelPayloadDecoder, {
  OtelPayloadEncoding,
  OtelPayloadFormat,
} from "../../FeatureSet/Telemetry/Utils/OtelPayloadDecoder";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import {
  OtelAggregationTemporality,
  TelemetryServiceMetadata,
} from "Common/Server/Services/OpenTelemetryIngestService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import TelemetryFanInWriter, {
  FanInInsertTarget,
} from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import {
  AggregationTemporality,
  MetricPointType,
} from "Common/Models/AnalyticsModels/Metric";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import Dictionary from "Common/Types/Dictionary";
import { JSONArray, JSONObject, JSONValue } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import TelemetryIngestionKeyPolicy from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import ServiceType from "Common/Types/Telemetry/ServiceType";

/*
 * GH#3978: a metric's aggregation temporality must survive EVERY way an OTLP
 * exporter can put it on the wire.
 *
 * OTLP/JSON encodes the enum as an integer (1 = DELTA, 2 = CUMULATIVE),
 * protobuf bodies reach the worker through protobufjs `.toJSON()` as the enum
 * NAMES, and gRPC requests through @grpc/proto-loader (enums: String) as the
 * names too. Ingest used to match only the names, so every OTLP/JSON counter
 * was stored with temporality null. Unit tests of the normalizer cannot catch
 * a decoder that emits a third form, so this suite drives REAL bytes:
 *
 *   - one ExportMetricsServiceRequest, hand-written as canonical OTLP/JSON
 *     (lowerCamelCase keys, enums as integers, 64-bit integers as decimal
 *     strings, trace/span ids as hex, proto3 defaults omitted - the shape the
 *     Collector's pdata JSON marshaler emits), deliberately NOT produced by
 *     any encoder in this repository;
 *   - the same request as binary protobuf, encoded with protobufjs from the
 *     repo's own .proto files, loaded exactly the way OtelPayloadDecoder
 *     loads them;
 *   - gzip of both;
 *   - bytes assembled by hand from the upstream OTLP field numbers, so the
 *     .proto files themselves are under test too.
 *
 * Each body goes through the real production path - the OTLP/HTTP
 * middleware, the HTTP handler, TelemetryQueueService, the gRPC server
 * (proto-loader deserializer, handleExport, and a real HTTP/2 socket), then
 * OtelPayloadDecoder.decodeFromQueue and OtelMetricsIngestService - and the
 * stored rows and catalog entries are compared field for field. Only the
 * persistence edges are replaced: Redis (body store, BullMQ), ClickHouse (the
 * fan-in writer), Postgres (resource resolution, the catalog writer, pipeline
 * rules, auto-discovery) and the ingestion-key lookup.
 */

/*
 * BullMQ is replaced by a recorder: the contract crossing it is the job data,
 * which is captured here and handed to the worker half of each round trip
 * exactly as the ProcessTelemetry job would receive it.
 */
const mockEnqueuedJobs: Array<JSONObject> = [];

jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {
      addJob: (
        _queueName: string,
        _jobId: string,
        _jobName: string,
        data: JSONObject,
      ): Promise<void> => {
        mockEnqueuedJobs.push(data);
        return Promise.resolve();
      },
    },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
    },
  };
});

/*
 * In-memory TelemetryBodyStore. Both halves of the real code talk to it: the
 * enqueue side stores the raw request bytes, and decodeFromQueue reads them
 * back. Keys are unique per stored body.
 */
const mockStoredBodies: Map<string, Buffer> = new Map();

jest.mock("../../FeatureSet/Telemetry/Utils/TelemetryBodyStore", () => {
  return {
    __esModule: true,
    default: {
      storeBody: (body: Buffer): Promise<string> => {
        const key: string = `telemetry:body:wire-${mockStoredBodies.size + 1}`;
        mockStoredBodies.set(key, body);
        return Promise.resolve(key);
      },
      readBody: (key: string): Promise<Buffer | null> => {
        return Promise.resolve(mockStoredBodies.get(key) ?? null);
      },
      deleteBody: (): Promise<void> => {
        return Promise.resolve();
      },
    },
  };
});

/*
 * The ingestion-key lookup is a cached Postgres read. One token resolves to
 * a healthy Server key; every other token is unknown.
 */
const mockPolicyByToken: Map<string, TelemetryIngestionKeyPolicy> = new Map();

jest.mock("Common/Server/Services/TelemetryIngestionKeyService", () => {
  return {
    __esModule: true,
    default: {
      getPolicyFromSecretKey: (
        token: string,
      ): Promise<TelemetryIngestionKeyPolicy | null> => {
        return Promise.resolve(mockPolicyByToken.get(token) ?? null);
      },
    },
  };
});

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const SERVICE_NAME: string = "checkout-api";
const SCOPE_NAME: string = "checkout-api.instrumentation";
const SCOPE_VERSION: string = "2.3.1";
const INGESTION_TOKEN: string = "wire-format-round-trip-token";

const START_TIME_UNIX_NANO: string = "1700000000000000000";
const DELTA_START_TIME_UNIX_NANO: string = "1700000050000000000";
const TIME_UNIX_NANO: string = "1700000060000000000";

const TRACE_ID_HEX: string = "5b8efff798038103d269b633813fc60c";
const SPAN_ID_HEX: string = "eee19b7ec3c1b174";

const METRICS_EXPORT_PATH: string =
  "/opentelemetry.proto.collector.metrics.v1.MetricsService/Export";

mockPolicyByToken.set(INGESTION_TOKEN, {
  ingestionKeyId: ObjectID.generate(),
  projectId: PROJECT_ID,
  keyType: TelemetryIngestionKeyType.Server,
  allowedOrigins: [],
  pinnedServiceName: null,
  isEnabled: true,
  expiresAt: null,
  requestsPerMinuteLimit: null,
});

/*
 * The request, as canonical OTLP/JSON. Written by hand on purpose: it is the
 * independent reference every other encoding is checked against.
 */
const OTLP_JSON_REQUEST: JSONObject = {
  resourceMetrics: [
    {
      resource: {
        attributes: [
          { key: "service.name", value: { stringValue: SERVICE_NAME } },
          {
            key: "deployment.environment.name",
            value: { stringValue: "production" },
          },
        ],
      },
      scopeMetrics: [
        {
          scope: { name: SCOPE_NAME, version: SCOPE_VERSION },
          metrics: [
            // Counter: cumulative, monotonic.
            {
              name: "http.server.request.count",
              description: "Requests served",
              unit: "{request}",
              sum: {
                dataPoints: [
                  {
                    attributes: [
                      {
                        key: "http.route",
                        value: { stringValue: "/checkout" },
                      },
                      {
                        key: "http.response.status_code",
                        value: { intValue: "200" },
                      },
                    ],
                    startTimeUnixNano: START_TIME_UNIX_NANO,
                    timeUnixNano: TIME_UNIX_NANO,
                    asInt: "1234",
                  },
                ],
                aggregationTemporality: 2,
                isMonotonic: true,
              },
            },
            // Counter exported with a delta temporality preference.
            {
              name: "queue.messages.processed",
              unit: "{message}",
              sum: {
                dataPoints: [
                  {
                    attributes: [
                      {
                        key: "messaging.destination.name",
                        value: { stringValue: "orders" },
                      },
                    ],
                    startTimeUnixNano: DELTA_START_TIME_UNIX_NANO,
                    timeUnixNano: TIME_UNIX_NANO,
                    asDouble: 42.5,
                  },
                ],
                aggregationTemporality: 1,
                isMonotonic: true,
              },
            },
            /*
             * UpDownCounter: cumulative, NOT monotonic. proto3 omits the
             * false `isMonotonic`, and so does the canonical JSON.
             */
            {
              name: "pool.connections.active",
              unit: "{connection}",
              sum: {
                dataPoints: [
                  {
                    startTimeUnixNano: START_TIME_UNIX_NANO,
                    timeUnixNano: TIME_UNIX_NANO,
                    asInt: "-3",
                  },
                ],
                aggregationTemporality: 2,
              },
            },
            // Histogram: cumulative, with an exemplar (hex ids in JSON).
            {
              name: "http.server.request.duration",
              unit: "s",
              histogram: {
                dataPoints: [
                  {
                    attributes: [
                      {
                        key: "http.route",
                        value: { stringValue: "/checkout" },
                      },
                    ],
                    startTimeUnixNano: START_TIME_UNIX_NANO,
                    timeUnixNano: TIME_UNIX_NANO,
                    count: "6",
                    sum: 1.5,
                    bucketCounts: ["1", "2", "3"],
                    explicitBounds: [0.1, 0.5],
                    exemplars: [
                      {
                        timeUnixNano: TIME_UNIX_NANO,
                        asDouble: 0.9,
                        spanId: SPAN_ID_HEX,
                        traceId: TRACE_ID_HEX,
                      },
                    ],
                    min: 0.05,
                    max: 0.9,
                  },
                ],
                aggregationTemporality: 2,
              },
            },
            /*
             * Exponential histogram: delta. `min` is 0, which survives the
             * wire only because proto3 `optional` gives it explicit presence.
             */
            {
              name: "rpc.client.duration",
              unit: "ms",
              exponentialHistogram: {
                dataPoints: [
                  {
                    startTimeUnixNano: DELTA_START_TIME_UNIX_NANO,
                    timeUnixNano: TIME_UNIX_NANO,
                    count: "5",
                    sum: 12.25,
                    scale: 3,
                    zeroCount: "1",
                    positive: { offset: -2, bucketCounts: ["1", "2", "1"] },
                    min: 0,
                    max: 6.5,
                  },
                ],
                aggregationTemporality: 1,
              },
            },
            // Gauge: no temporality at all.
            {
              name: "system.memory.utilization",
              unit: "1",
              gauge: {
                dataPoints: [
                  {
                    attributes: [
                      {
                        key: "system.memory.state",
                        value: { stringValue: "used" },
                      },
                    ],
                    timeUnixNano: TIME_UNIX_NANO,
                    asDouble: 0.625,
                  },
                ],
              },
            },
            // Summary: no temporality either.
            {
              name: "gc.pause.duration",
              unit: "s",
              summary: {
                dataPoints: [
                  {
                    startTimeUnixNano: START_TIME_UNIX_NANO,
                    timeUnixNano: TIME_UNIX_NANO,
                    count: "4",
                    sum: 0.02,
                    quantileValues: [
                      { quantile: 0.5, value: 0.004 },
                      { quantile: 0.99, value: 0.009 },
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

/*
 * What every encoding must store, per metric. Fields a metric shape does not
 * carry hold the row builder's defaults (null / 0 / []).
 */
function expectedRow(fields: JSONObject): JSONObject {
  return {
    aggregationTemporality: null,
    isMonotonic: null,
    count: null,
    sum: null,
    min: null,
    max: null,
    bucketCounts: [],
    explicitBounds: [],
    scale: 0,
    zeroCount: 0,
    positiveOffset: 0,
    positiveBucketCounts: [],
    negativeOffset: 0,
    negativeBucketCounts: [],
    summaryQuantiles: [],
    summaryValues: [],
    traceId: null,
    spanId: null,
    startTimeUnixNano: null,
    timeUnixNano: TIME_UNIX_NANO,
    ...fields,
  };
}

const EXPECTED_ROWS: Dictionary<JSONObject> = {
  "http.server.request.count": expectedRow({
    metricPointType: MetricPointType.Sum,
    aggregationTemporality: AggregationTemporality.Cumulative,
    isMonotonic: true,
    value: 1234,
    startTimeUnixNano: START_TIME_UNIX_NANO,
  }),
  "queue.messages.processed": expectedRow({
    metricPointType: MetricPointType.Sum,
    aggregationTemporality: AggregationTemporality.Delta,
    isMonotonic: true,
    value: 42.5,
    startTimeUnixNano: DELTA_START_TIME_UNIX_NANO,
  }),
  "pool.connections.active": expectedRow({
    metricPointType: MetricPointType.Sum,
    aggregationTemporality: AggregationTemporality.Cumulative,
    value: -3,
    startTimeUnixNano: START_TIME_UNIX_NANO,
  }),
  "http.server.request.duration": expectedRow({
    metricPointType: MetricPointType.Histogram,
    aggregationTemporality: AggregationTemporality.Cumulative,
    value: 1.5,
    count: 6,
    sum: 1.5,
    min: 0.05,
    max: 0.9,
    bucketCounts: [1, 2, 3],
    explicitBounds: [0.1, 0.5],
    traceId: TRACE_ID_HEX,
    spanId: SPAN_ID_HEX,
    startTimeUnixNano: START_TIME_UNIX_NANO,
  }),
  "rpc.client.duration": expectedRow({
    metricPointType: MetricPointType.ExponentialHistogram,
    aggregationTemporality: AggregationTemporality.Delta,
    value: 12.25,
    count: 5,
    sum: 12.25,
    min: 0,
    max: 6.5,
    scale: 3,
    zeroCount: 1,
    positiveOffset: -2,
    positiveBucketCounts: [1, 2, 1],
    startTimeUnixNano: DELTA_START_TIME_UNIX_NANO,
  }),
  "system.memory.utilization": expectedRow({
    metricPointType: MetricPointType.Gauge,
    value: 0.625,
  }),
  "gc.pause.duration": expectedRow({
    metricPointType: MetricPointType.Summary,
    value: 0.02,
    count: 4,
    sum: 0.02,
    summaryQuantiles: [0.5, 0.99],
    summaryValues: [0.004, 0.009],
    startTimeUnixNano: START_TIME_UNIX_NANO,
  }),
};

interface CatalogSemantics {
  aggregationTemporality: AggregationTemporality | undefined;
  isMonotonic: boolean | undefined;
}

/*
 * Counter semantics denormalized onto the MetricType catalog. A shape that
 * carries no temporality / monotonic flag leaves the entry untouched.
 */
const EXPECTED_CATALOG: Dictionary<CatalogSemantics> = {
  "http.server.request.count": {
    aggregationTemporality: AggregationTemporality.Cumulative,
    isMonotonic: true,
  },
  "queue.messages.processed": {
    aggregationTemporality: AggregationTemporality.Delta,
    isMonotonic: true,
  },
  "pool.connections.active": {
    aggregationTemporality: AggregationTemporality.Cumulative,
    isMonotonic: undefined,
  },
  "http.server.request.duration": {
    aggregationTemporality: AggregationTemporality.Cumulative,
    isMonotonic: undefined,
  },
  "rpc.client.duration": {
    aggregationTemporality: AggregationTemporality.Delta,
    isMonotonic: undefined,
  },
  "system.memory.utilization": {
    aggregationTemporality: undefined,
    isMonotonic: undefined,
  },
  "gc.pause.duration": {
    aggregationTemporality: undefined,
    isMonotonic: undefined,
  },
};

/*
 * Loaded exactly as OtelPayloadDecoder loads its schemas (protobuf.loadSync
 * on the bundled ProtoFiles/OTel/v1 directory), but for the message an
 * exporter actually sends: ExportMetricsServiceRequest.
 */
const PROTO_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Telemetry",
  "ProtoFiles",
  "OTel",
  "v1",
);

const ExportMetricsServiceRequestType: protobuf.Type = protobuf
  .loadSync(path.join(PROTO_DIR, "metrics_service.proto"))
  .lookupType(
    "opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceRequest",
  );

/*
 * OTLP/JSON spells trace and span ids as hex, which protobufjs' fromObject
 * would read as base64. Hand them over as bytes; everything else in the
 * canonical JSON is valid fromObject input as-is (integer enums, decimal
 * string longs, and no proto3 defaults - so protobufjs, which writes any
 * field that is set, emits exactly the fields a Go or Java encoder would).
 */
function withBinaryIds(value: JSONValue): unknown {
  if (Array.isArray(value)) {
    return value.map((entry: JSONValue) => {
      return withBinaryIds(entry);
    });
  }

  if (value && typeof value === "object") {
    const copy: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as JSONObject)) {
      copy[key] =
        (key === "traceId" || key === "spanId") && typeof entry === "string"
          ? Buffer.from(entry, "hex")
          : withBinaryIds(entry as JSONValue);
    }
    return copy;
  }

  return value;
}

function encodeProtobuf(request: JSONObject): Buffer {
  const message: protobuf.Message = ExportMetricsServiceRequestType.fromObject(
    withBinaryIds(request) as Record<string, unknown>,
  );
  return Buffer.from(ExportMetricsServiceRequestType.encode(message).finish());
}

const PROTOBUF_BYTES: Buffer = encodeProtobuf(OTLP_JSON_REQUEST);
const JSON_BYTES: Buffer = Buffer.from(
  JSON.stringify(OTLP_JSON_REQUEST),
  "utf-8",
);
const GZIP_PROTOBUF_BYTES: Buffer = zlib.gzipSync(PROTOBUF_BYTES);
const GZIP_JSON_BYTES: Buffer = zlib.gzipSync(JSON_BYTES);

type GrpcExportMethod = protoLoader.MethodDefinition<
  Record<string, unknown>,
  Record<string, unknown>
>;

/*
 * The metrics Export method, loaded the way startGrpcServer loads it: the
 * service file from the bundled proto directory, with the shared option set.
 */
function loadGrpcExportMethod(options: protoLoader.Options): GrpcExportMethod {
  const includeDir: string = (
    OTLP_PROTO_LOADER_OPTIONS.includeDirs as Array<string>
  )[0]!;
  const definition: protoLoader.PackageDefinition = protoLoader.loadSync(
    path.join(includeDir, "metrics_service.proto"),
    options,
  );
  const service: protoLoader.ServiceDefinition = definition[
    "opentelemetry.proto.collector.metrics.v1.MetricsService"
  ] as protoLoader.ServiceDefinition;
  return service["Export"] as unknown as GrpcExportMethod;
}

const GRPC_EXPORT: GrpcExportMethod = loadGrpcExportMethod(
  OTLP_PROTO_LOADER_OPTIONS,
);

/*
 * ---------------------------------------------------------------------------
 * Hand-assembled protobuf. Field numbers come from the upstream OTLP spec
 * (opentelemetry-proto), NOT from the repo's .proto files, so a renumbered or
 * mistyped field in ProtoFiles/OTel/v1 cannot hide behind a symmetric
 * encode/decode. Defaults are omitted, as every canonical encoder does.
 * ---------------------------------------------------------------------------
 */
type WireBytes = Array<number>;

enum WireType {
  Varint = 0,
  Fixed64 = 1,
  LengthDelimited = 2,
}

function wireVarint(value: number): WireBytes {
  const bytes: WireBytes = [];
  let remaining: number = value;
  while (remaining > 0x7f) {
    bytes.push((remaining % 0x80) + 0x80);
    remaining = Math.floor(remaining / 0x80);
  }
  bytes.push(remaining);
  return bytes;
}

function wireKey(fieldNumber: number, wireType: WireType): WireBytes {
  return wireVarint(fieldNumber * 8 + wireType);
}

function wireMessage(
  fieldNumber: number,
  ...fields: Array<WireBytes>
): WireBytes {
  const payload: WireBytes = ([] as WireBytes).concat(...fields);
  return [
    ...wireKey(fieldNumber, WireType.LengthDelimited),
    ...wireVarint(payload.length),
    ...payload,
  ];
}

function wireString(fieldNumber: number, text: string): WireBytes {
  const bytes: WireBytes = Array.from(Buffer.from(text, "utf-8"));
  return [
    ...wireKey(fieldNumber, WireType.LengthDelimited),
    ...wireVarint(bytes.length),
    ...bytes,
  ];
}

function wireVarintField(fieldNumber: number, value: number): WireBytes {
  return [...wireKey(fieldNumber, WireType.Varint), ...wireVarint(value)];
}

// sint32 zigzag: 0 -> 0, -1 -> 1, 1 -> 2, -2 -> 3, ...
function wireSint32Field(fieldNumber: number, value: number): WireBytes {
  return wireVarintField(fieldNumber, value >= 0 ? value * 2 : -value * 2 - 1);
}

function uint64LittleEndian(decimal: string): WireBytes {
  const buffer: Buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(decimal));
  return Array.from(buffer);
}

function wireFixed64Field(fieldNumber: number, decimal: string): WireBytes {
  return [
    ...wireKey(fieldNumber, WireType.Fixed64),
    ...uint64LittleEndian(decimal),
  ];
}

function wireSfixed64Field(fieldNumber: number, decimal: string): WireBytes {
  const buffer: Buffer = Buffer.alloc(8);
  buffer.writeBigInt64LE(BigInt(decimal));
  return [...wireKey(fieldNumber, WireType.Fixed64), ...Array.from(buffer)];
}

function wireDoubleField(fieldNumber: number, value: number): WireBytes {
  const buffer: Buffer = Buffer.alloc(8);
  buffer.writeDoubleLE(value);
  return [...wireKey(fieldNumber, WireType.Fixed64), ...Array.from(buffer)];
}

// proto3 packs repeated scalars by default.
function wirePackedFixed64Field(
  fieldNumber: number,
  decimals: Array<string>,
): WireBytes {
  const payload: WireBytes = ([] as WireBytes).concat(
    ...decimals.map((decimal: string) => {
      return uint64LittleEndian(decimal);
    }),
  );
  return [
    ...wireKey(fieldNumber, WireType.LengthDelimited),
    ...wireVarint(payload.length),
    ...payload,
  ];
}

function wirePackedDoubleField(
  fieldNumber: number,
  values: Array<number>,
): WireBytes {
  const payload: WireBytes = ([] as WireBytes).concat(
    ...values.map((value: number) => {
      const buffer: Buffer = Buffer.alloc(8);
      buffer.writeDoubleLE(value);
      return Array.from(buffer);
    }),
  );
  return [
    ...wireKey(fieldNumber, WireType.LengthDelimited),
    ...wireVarint(payload.length),
    ...payload,
  ];
}

function wirePackedVarintField(
  fieldNumber: number,
  values: Array<number>,
): WireBytes {
  const payload: WireBytes = ([] as WireBytes).concat(
    ...values.map((value: number) => {
      return wireVarint(value);
    }),
  );
  return [
    ...wireKey(fieldNumber, WireType.LengthDelimited),
    ...wireVarint(payload.length),
    ...payload,
  ];
}

/*
 * ExportMetricsServiceRequest { resource_metrics = 1 {
 *   resource = 1 { attributes = 1 { key = 1, value = 2 { string_value = 1 } } }
 *   scope_metrics = 2 { scope = 1 { name = 1 }, metrics = 2 [Metric] } } }
 */
function wireExportRequest(metrics: Array<WireBytes>): Buffer {
  return Buffer.from(
    wireMessage(
      1,
      wireMessage(
        1,
        wireMessage(
          1,
          wireString(1, "service.name"),
          wireMessage(2, wireString(1, SERVICE_NAME)),
        ),
      ),
      wireMessage(
        2,
        wireMessage(1, wireString(1, SCOPE_NAME)),
        ...metrics.map((metric: WireBytes) => {
          return wireMessage(2, metric);
        }),
      ),
    ),
  );
}

/*
 * Metric { name = 1; oneof data { gauge = 5; sum = 7; histogram = 9;
 * exponential_histogram = 10; summary = 11 } }
 */
enum WireMetricData {
  Gauge = 5,
  Sum = 7,
  Histogram = 9,
  ExponentialHistogram = 10,
  Summary = 11,
}

function wireMetric(
  name: string,
  data: WireMetricData,
  ...fields: Array<WireBytes>
): WireBytes {
  return [...wireString(1, name), ...wireMessage(data, ...fields)];
}

/*
 * ---------------------------------------------------------------------------
 * Harness: the persistence edges of the metrics ingest (same boundaries as
 * OtelMetricsIngestCatalog.test.ts).
 * ---------------------------------------------------------------------------
 */
const AUTO_DISCOVERY_METHODS: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
  "autoDiscoverProxmoxCluster",
  "autoDiscoverVMwareVCenter",
  "autoDiscoverCephCluster",
  "autoDiscoverDockerSwarmCluster",
  "autoDiscoverIoTFleet",
  "autoDiscoverHost",
  "autoDiscoverServerless",
  "autoDiscoverCloudResource",
  "autoDiscoverRum",
  "autoDiscoverDatabaseServer",
];

type IngestTestMethods = Record<string, any> & {
  resolveTelemetryResource: (data: {
    attributes: JSONArray;
  }) => Promise<TelemetryServiceMetadata>;
};

let rows: Array<JSONObject>;
let resolvedServiceNames: Array<string>;
let indexCatalog: jest.SpyInstance;

function serviceNameFromAttributes(attributes: JSONArray): string {
  const attribute: JSONObject | undefined = attributes.find(
    (entry: JSONObject) => {
      return entry["key"] === "service.name";
    },
  );
  return ((attribute?.["value"] as JSONObject | undefined)?.["stringValue"] ??
    "") as string;
}

beforeEach(() => {
  rows = [];
  resolvedServiceNames = [];
  mockEnqueuedJobs.length = 0;
  mockStoredBodies.clear();

  const ingest: IngestTestMethods =
    OtelMetricsIngestService as unknown as IngestTestMethods;
  jest.spyOn(ingest, "runBatchHostEnrichment").mockResolvedValue(undefined);
  for (const method of AUTO_DISCOVERY_METHODS) {
    jest.spyOn(ingest, method).mockResolvedValue(null);
  }
  jest
    .spyOn(ingest, "resolveTelemetryResource")
    .mockImplementation(async (data: { attributes: JSONArray }) => {
      // Record what the wire said, so a mangled resource cannot slip by.
      resolvedServiceNames.push(serviceNameFromAttributes(data.attributes));
      return {
        serviceName: SERVICE_NAME,
        primaryEntityId: new ObjectID(SERVICE_ID.toString()),
        primaryEntityType: ServiceType.OpenTelemetry,
        dataRententionInDays: 15,
        serviceRetentionConfig: null,
        serviceRetentionInDays: null,
        projectRetentionConfig: null,
        projectRetentionInDays: 15,
      };
    });
  jest.spyOn(MetricPipelineRuleService, "loadRules").mockResolvedValue({
    projectRules: [],
    rulesByServiceId: new Map(),
  });
  jest
    .spyOn(TelemetryFanInWriter, "submit")
    .mockImplementation(
      async (_target: FanInInsertTarget, batch: Array<JSONObject>) => {
        rows.push(...batch);
        return { flushed: Promise.resolve() };
      },
    );
  indexCatalog = jest
    .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
    .mockResolvedValue(undefined);
  jest.spyOn(TelemetryIngestionDisabled, "isDisabled").mockReturnValue(false);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * ---------------------------------------------------------------------------
 * The two halves of the production path.
 * ---------------------------------------------------------------------------
 */

// The single job the producer half enqueued, as BullMQ hands it back (JSON).
function onlyEnqueuedJob(): TelemetryIngestJobData {
  expect(mockEnqueuedJobs).toHaveLength(1);
  return JSON.parse(
    JSON.stringify(mockEnqueuedJobs[0]),
  ) as TelemetryIngestJobData;
}

// Worker half, step 1: resolveOtelBody in ProcessTelemetry.
async function decodeJob(job: TelemetryIngestJobData): Promise<JSONObject> {
  expect(job.productType).toBe(ProductType.Metrics);
  return OtelPayloadDecoder.decodeFromQueue({
    productType: job.productType!,
    format: job.bodyFormat!,
    encoding: job.bodyEncoding ?? "none",
    bodyKey: job.bodyKey!,
  });
}

// Worker half, step 2: the TelemetryType.Metrics case in ProcessTelemetry.
async function ingestDecodedBody(
  body: JSONObject,
  headers: Dictionary<string> = {},
): Promise<void> {
  await OtelMetricsIngestService.processMetricsFromQueue({
    projectId: new ObjectID(PROJECT_ID.toString()),
    body,
    headers,
  } as unknown as TelemetryRequest);
}

async function runWorker(job: TelemetryIngestJobData): Promise<void> {
  expect(job.projectId).toBe(PROJECT_ID.toString());
  const body: JSONObject = await decodeJob(job);
  await ingestDecodedBody(body, job.requestHeaders ?? {});
}

function fakeResponse(): ExpressResponse {
  return {
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;
}

type Middleware = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;

async function runMiddleware(
  middleware: Middleware,
  req: ExpressRequest,
  res: ExpressResponse,
): Promise<void> {
  const next: jest.Mock = jest.fn();
  await middleware(req, res, next as unknown as NextFunction);
  expect(next).toHaveBeenCalledTimes(1);
  expect(next).toHaveBeenCalledWith();
}

/*
 * OTLP/HTTP producer half: the request body arrives as a socket stream (in
 * three chunks, so reassembly is exercised), OtelRequestMiddleware reads it
 * and tags the signal, and the real metrics HTTP handler enqueues it. The
 * ingestion-key middleware is the one step skipped: it only attaches
 * `projectId`, which is set directly.
 */
async function postOverHttp(data: {
  bytes: Buffer;
  contentType?: string | undefined;
  contentEncoding?: string | undefined;
}): Promise<TelemetryIngestJobData> {
  const headers: Dictionary<string> = {};
  if (data.contentType) {
    headers["content-type"] = data.contentType;
  }
  if (data.contentEncoding) {
    headers["content-encoding"] = data.contentEncoding;
  }

  const third: number = Math.ceil(data.bytes.length / 3);
  const chunks: Array<Buffer> = [
    data.bytes.subarray(0, third),
    data.bytes.subarray(third, third * 2),
    data.bytes.subarray(third * 2),
  ];
  const req: ExpressRequest = Object.assign(Readable.from(chunks), {
    url: "/otlp/v1/metrics",
    baseUrl: "",
    headers,
    projectId: PROJECT_ID,
  }) as unknown as ExpressRequest;
  const res: ExpressResponse = fakeResponse();

  await runMiddleware(OpenTelemetryRequestMiddleware.parseBody, req, res);
  expect(Buffer.isBuffer(req.body)).toBe(true);
  expect((req.body as Buffer).equals(data.bytes)).toBe(true);
  await runMiddleware(OpenTelemetryRequestMiddleware.getProductType, req, res);
  expect((req as TelemetryRequest).productType).toBe(ProductType.Metrics);

  const next: jest.Mock = jest.fn();
  await OtelMetricsIngestService.ingestMetrics(
    req,
    res,
    next as unknown as NextFunction,
  );
  expect(next).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.send).toHaveBeenCalledWith({});

  return onlyEnqueuedJob();
}

function grpcMetadata(token: string | null): grpc.Metadata {
  const metadata: grpc.Metadata = new grpc.Metadata();
  if (token) {
    metadata.set("x-oneuptime-token", token);
  }
  return metadata;
}

/*
 * gRPC producer half without a socket: the Export method's own deserializer
 * turns the bytes into the object grpc-js hands the handler, then the real
 * handleExport authenticates and enqueues it through MetricsQueueService.
 */
async function exportViaGrpcHandler(
  bytes: Buffer,
  exportMethod: GrpcExportMethod = GRPC_EXPORT,
): Promise<TelemetryIngestJobData> {
  const request: Record<string, unknown> =
    exportMethod.requestDeserialize(bytes);

  const reply: { error: grpc.ServiceError | null; response: unknown } =
    await new Promise(
      (
        resolve: (value: {
          error: grpc.ServiceError | null;
          response: unknown;
        }) => void,
      ) => {
        void handleExport(
          { request, metadata: grpcMetadata(INGESTION_TOKEN) },
          (error: grpc.ServiceError | null, response?: unknown) => {
            resolve({ error, response });
          },
          ProductType.Metrics,
          MetricsQueueService.addMetricIngestJob.bind(MetricsQueueService),
        );
      },
    );

  expect(reply.error).toBeNull();
  expect(reply.response).toEqual({});
  return onlyEnqueuedJob();
}

// Push a raw body straight into the store and decode it the worker's way.
async function decodeStoredBody(data: {
  bytes: Buffer;
  format: OtelPayloadFormat;
  encoding: OtelPayloadEncoding;
}): Promise<JSONObject> {
  const key: string = `telemetry:body:direct-${mockStoredBodies.size + 1}`;
  mockStoredBodies.set(key, data.bytes);
  return OtelPayloadDecoder.decodeFromQueue({
    productType: ProductType.Metrics,
    format: data.format,
    encoding: data.encoding,
    bodyKey: key,
  });
}

/*
 * ---------------------------------------------------------------------------
 * Assertions.
 * ---------------------------------------------------------------------------
 */
const VOLATILE_ROW_FIELDS: Array<string> = [
  "_id",
  "createdAt",
  "retentionDate",
];

// Rows with the per-run fields removed, in a stable order.
function stableRows(): Array<JSONObject> {
  return rows
    .map((row: JSONObject) => {
      const copy: JSONObject = { ...row };
      for (const field of VOLATILE_ROW_FIELDS) {
        delete copy[field];
      }
      return copy;
    })
    .sort((left: JSONObject, right: JSONObject) => {
      return String(left["name"]).localeCompare(String(right["name"]));
    });
}

function rowsByName(): Map<string, JSONObject> {
  const byName: Map<string, JSONObject> = new Map();
  for (const row of rows) {
    const name: string = row["name"] as string;
    expect(byName.has(name)).toBe(false);
    byName.set(name, row);
  }
  return byName;
}

function catalog(): Dictionary<MetricType> {
  expect(indexCatalog).toHaveBeenCalledTimes(1);
  return indexCatalog.mock.calls[0]![0].metricNameServiceNameMap;
}

function catalogSemantics(name: string): CatalogSemantics {
  const entry: MetricType | undefined = catalog()[name];
  expect(entry).toBeDefined();
  return {
    aggregationTemporality: entry!.aggregationTemporality,
    isMonotonic: entry!.isMonotonic,
  };
}

function pick(row: JSONObject, fields: Array<string>): JSONObject {
  const picked: JSONObject = {};
  for (const field of fields) {
    picked[field] = row[field] as JSONValue;
  }
  return picked;
}

function expectCanonicalRequestStored(): void {
  expect(resolvedServiceNames).toEqual([SERVICE_NAME]);

  const byName: Map<string, JSONObject> = rowsByName();
  expect(Array.from(byName.keys()).sort()).toEqual(
    Object.keys(EXPECTED_ROWS).sort(),
  );

  for (const [name, expected] of Object.entries(EXPECTED_ROWS)) {
    // The name rides along so a failure says which metric broke.
    expect({
      name,
      ...pick(byName.get(name)!, Object.keys(expected)),
    }).toEqual({ name, ...expected });
    expect({ name, ...catalogSemantics(name) }).toEqual({
      name,
      ...EXPECTED_CATALOG[name]!,
    });
  }

  // Resource, datapoint and scope attributes survived the encoding too.
  expect(byName.get("http.server.request.count")!["attributes"]).toEqual(
    expect.objectContaining({
      "resource.service.name": SERVICE_NAME,
      "resource.deployment.environment.name": "production",
      "http.route": "/checkout",
      "http.response.status_code": "200",
      "scope.name": SCOPE_NAME,
      "scope.version": SCOPE_VERSION,
    }),
  );
}

// aggregationTemporality of every metric, exactly as the decoder emitted it.
function temporalityForms(body: JSONObject): Dictionary<unknown> {
  const forms: Dictionary<unknown> = {};
  const resourceMetrics: JSONArray = body["resourceMetrics"] as JSONArray;
  for (const resourceMetric of resourceMetrics) {
    for (const scopeMetric of resourceMetric["scopeMetrics"] as JSONArray) {
      for (const metric of scopeMetric["metrics"] as JSONArray) {
        const wrapper: JSONObject = (metric["sum"] ||
          metric["gauge"] ||
          metric["histogram"] ||
          metric["exponentialHistogram"] ||
          metric["summary"]) as JSONObject;
        forms[metric["name"] as string] = wrapper["aggregationTemporality"];
      }
    }
  }
  return forms;
}

/*
 * ---------------------------------------------------------------------------
 * Tests.
 * ---------------------------------------------------------------------------
 */
describe("OTLP metrics wire-format round trip (GH#3978)", () => {
  describe("OTLP/HTTP: middleware -> HTTP handler -> enqueue -> worker decode -> ingest", () => {
    interface HttpCase {
      label: string;
      bytes: Buffer;
      contentType: string | undefined;
      contentEncoding: string | undefined;
      bodyFormat: OtelPayloadFormat;
      bodyEncoding: OtelPayloadEncoding;
    }

    const cases: Array<HttpCase> = [
      {
        label: "protobuf (application/x-protobuf)",
        bytes: PROTOBUF_BYTES,
        contentType: "application/x-protobuf",
        contentEncoding: undefined,
        bodyFormat: OtelPayloadFormat.Protobuf,
        bodyEncoding: "none",
      },
      {
        // The otlphttp exporter's defaults: protobuf, gzip.
        label: "gzip protobuf (application/x-protobuf, content-encoding gzip)",
        bytes: GZIP_PROTOBUF_BYTES,
        contentType: "application/x-protobuf",
        contentEncoding: "gzip",
        bodyFormat: OtelPayloadFormat.Protobuf,
        bodyEncoding: "gzip",
      },
      {
        label: "protobuf (application/protobuf)",
        bytes: PROTOBUF_BYTES,
        contentType: "application/protobuf",
        contentEncoding: undefined,
        bodyFormat: OtelPayloadFormat.Protobuf,
        bodyEncoding: "none",
      },
      {
        label: "OTLP/JSON (application/json)",
        bytes: JSON_BYTES,
        contentType: "application/json",
        contentEncoding: undefined,
        bodyFormat: OtelPayloadFormat.Json,
        bodyEncoding: "none",
      },
      {
        // otlphttp with `encoding: json` - the GH#3978 configuration.
        label: "gzip OTLP/JSON (application/json, content-encoding gzip)",
        bytes: GZIP_JSON_BYTES,
        contentType: "application/json",
        contentEncoding: "gzip",
        bodyFormat: OtelPayloadFormat.Json,
        bodyEncoding: "gzip",
      },
      {
        label: "OTLP/JSON (application/json; charset=utf-8)",
        bytes: JSON_BYTES,
        contentType: "application/json; charset=utf-8",
        contentEncoding: undefined,
        bodyFormat: OtelPayloadFormat.Json,
        bodyEncoding: "none",
      },
      {
        /*
         * No content-type at all: the enqueue path (the one production uses
         * to pick the decoder) treats the body as protobuf.
         */
        label: "protobuf with no content-type",
        bytes: PROTOBUF_BYTES,
        contentType: undefined,
        contentEncoding: undefined,
        bodyFormat: OtelPayloadFormat.Protobuf,
        bodyEncoding: "none",
      },
      {
        label: "gzip protobuf with no content-type",
        bytes: GZIP_PROTOBUF_BYTES,
        contentType: undefined,
        contentEncoding: "gzip",
        bodyFormat: OtelPayloadFormat.Protobuf,
        bodyEncoding: "gzip",
      },
    ];

    test.each(cases)(
      "$label stores every metric's temporality, monotonicity, type and value",
      async (httpCase: HttpCase) => {
        const job: TelemetryIngestJobData = await postOverHttp({
          bytes: httpCase.bytes,
          contentType: httpCase.contentType,
          contentEncoding: httpCase.contentEncoding,
        });

        expect(job.type).toBe("metrics");
        expect(job.bodyFormat).toBe(httpCase.bodyFormat);
        expect(job.bodyEncoding).toBe(httpCase.bodyEncoding);
        // The raw request bytes are what the worker decodes - untouched.
        expect(mockStoredBodies.get(job.bodyKey!)!.equals(httpCase.bytes)).toBe(
          true,
        );

        await runWorker(job);

        expectCanonicalRequestStored();
      },
    );
  });

  describe("worker decode selected by OtelPayloadDecoder.formatFromContentType", () => {
    /*
     * formatFromContentType has no production caller today - the enqueue
     * path above makes the same decision inline - and for a MISSING
     * content-type the two disagree: this helper answers JSON, the enqueue
     * path answers protobuf. This suite pins the helper's answer and the
     * one above pins the enqueue path's, so a future consolidation has to
     * pick one deliberately.
     */
    interface FormatCase {
      label: string;
      contentType: string | undefined;
      bytes: Buffer;
      encoding: OtelPayloadEncoding;
      format: OtelPayloadFormat;
    }

    const cases: Array<FormatCase> = [
      {
        label: "application/x-protobuf",
        contentType: "application/x-protobuf",
        bytes: PROTOBUF_BYTES,
        encoding: "none",
        format: OtelPayloadFormat.Protobuf,
      },
      {
        label: "application/x-protobuf, gzip",
        contentType: "application/x-protobuf",
        bytes: GZIP_PROTOBUF_BYTES,
        encoding: "gzip",
        format: OtelPayloadFormat.Protobuf,
      },
      {
        label: "application/json",
        contentType: "application/json",
        bytes: JSON_BYTES,
        encoding: "none",
        format: OtelPayloadFormat.Json,
      },
      {
        label: "application/json, gzip",
        contentType: "application/json",
        bytes: GZIP_JSON_BYTES,
        encoding: "gzip",
        format: OtelPayloadFormat.Json,
      },
      {
        label: "no content-type (OTLP/JSON body)",
        contentType: undefined,
        bytes: JSON_BYTES,
        encoding: "none",
        format: OtelPayloadFormat.Json,
      },
      {
        label: "no content-type (gzip OTLP/JSON body)",
        contentType: undefined,
        bytes: GZIP_JSON_BYTES,
        encoding: "gzip",
        format: OtelPayloadFormat.Json,
      },
    ];

    test.each(cases)(
      "$label decodes and ingests identically",
      async (formatCase: FormatCase) => {
        const format: OtelPayloadFormat =
          OtelPayloadDecoder.formatFromContentType(formatCase.contentType);
        expect(format).toBe(formatCase.format);

        const body: JSONObject = await decodeStoredBody({
          bytes: formatCase.bytes,
          format,
          encoding: formatCase.encoding,
        });
        await ingestDecodedBody(body);

        expectCanonicalRequestStored();
      },
    );
  });

  describe("gRPC: the Export deserializer with GrpcServer's exact proto-loader options", () => {
    test("the service path is the one OTLP/gRPC exporters call", () => {
      expect(GRPC_EXPORT.path).toBe(METRICS_EXPORT_PATH);
      expect(GRPC_EXPORT.requestStream).toBe(false);
      expect(GRPC_EXPORT.responseStream).toBe(false);
    });

    test("deserializes temporality as enum NAMES, which normalizeAggregationTemporality maps", () => {
      const request: Record<string, unknown> =
        GRPC_EXPORT.requestDeserialize(PROTOBUF_BYTES);
      const forms: Dictionary<unknown> = temporalityForms(
        request as unknown as JSONObject,
      );

      expect(forms).toEqual({
        "http.server.request.count": "AGGREGATION_TEMPORALITY_CUMULATIVE",
        "queue.messages.processed": "AGGREGATION_TEMPORALITY_DELTA",
        "pool.connections.active": "AGGREGATION_TEMPORALITY_CUMULATIVE",
        "http.server.request.duration": "AGGREGATION_TEMPORALITY_CUMULATIVE",
        "rpc.client.duration": "AGGREGATION_TEMPORALITY_DELTA",
        "system.memory.utilization": undefined,
        "gc.pause.duration": undefined,
      });

      const normalized: Dictionary<OtelAggregationTemporality | undefined> = {};
      for (const [name, form] of Object.entries(forms)) {
        normalized[name] =
          OtelMetricsIngestService.normalizeAggregationTemporality(form);
      }
      expect(normalized).toEqual({
        "http.server.request.count": OtelAggregationTemporality.Cumulative,
        "queue.messages.processed": OtelAggregationTemporality.Delta,
        "pool.connections.active": OtelAggregationTemporality.Cumulative,
        "http.server.request.duration": OtelAggregationTemporality.Cumulative,
        "rpc.client.duration": OtelAggregationTemporality.Delta,
        "system.memory.utilization": undefined,
        "gc.pause.duration": undefined,
      });
    });

    test("keeps uint64 timestamps as decimal strings and the other wire fields intact", () => {
      const request: JSONObject = GRPC_EXPORT.requestDeserialize(
        PROTOBUF_BYTES,
      ) as unknown as JSONObject;
      const metrics: JSONArray = (
        (request["resourceMetrics"] as JSONArray)[0]![
          "scopeMetrics"
        ] as JSONArray
      )[0]!["metrics"] as JSONArray;
      const counter: JSONObject = metrics[0]!;
      const upDown: JSONObject = metrics[2]!;
      const counterPoint: JSONObject = (
        (counter["sum"] as JSONObject)["dataPoints"] as JSONArray
      )[0]!;

      expect(counter["name"]).toBe("http.server.request.count");
      expect((counter["sum"] as JSONObject)["isMonotonic"]).toBe(true);
      expect(counterPoint["timeUnixNano"]).toBe(TIME_UNIX_NANO);
      expect(counterPoint["startTimeUnixNano"]).toBe(START_TIME_UNIX_NANO);
      expect(counterPoint["asInt"]).toBe("1234");
      // defaults: false - an elided proto3 default stays absent.
      expect(upDown["name"]).toBe("pool.connections.active");
      expect(upDown["sum"] as JSONObject).not.toHaveProperty("isMonotonic");
      expect(
        ((upDown["sum"] as JSONObject)["dataPoints"] as JSONArray)[0]!["asInt"],
      ).toBe("-3");
    });

    test("handleExport -> real enqueue -> worker stores the same rows", async () => {
      const job: TelemetryIngestJobData =
        await exportViaGrpcHandler(PROTOBUF_BYTES);

      // gRPC hands the worker the decoded object, re-serialized as JSON.
      expect(job.type).toBe("metrics");
      expect(job.bodyFormat).toBe(OtelPayloadFormat.Json);
      expect(job.bodyEncoding).toBe("none");
      // The ingestion token never reaches the queue payload.
      expect(JSON.stringify(job)).not.toContain(INGESTION_TOKEN);

      const body: JSONObject = await decodeJob(job);
      expect(temporalityForms(body)).toEqual(
        temporalityForms(
          GRPC_EXPORT.requestDeserialize(
            PROTOBUF_BYTES,
          ) as unknown as JSONObject,
        ),
      );

      await ingestDecodedBody(body, job.requestHeaders ?? {});

      expectCanonicalRequestStored();
    });
  });

  describe("gRPC over a real HTTP/2 socket (startGrpcServer on an ephemeral port)", () => {
    let grpcServer: grpc.Server | null = null;
    let grpcPort: number = 0;

    beforeAll(async () => {
      /*
       * Run the production startGrpcServer - real service definitions, real
       * handler wiring, real receive limits - but bind to an ephemeral
       * loopback port instead of 0.0.0.0:4317.
       */
      const originalBindAsync: grpc.Server["bindAsync"] =
        grpc.Server.prototype.bindAsync;
      const bound: Promise<{ server: grpc.Server; port: number }> = new Promise(
        (
          resolve: (started: { server: grpc.Server; port: number }) => void,
          reject: (error: Error) => void,
        ) => {
          jest
            .spyOn(grpc.Server.prototype, "bindAsync")
            .mockImplementation(function (
              this: grpc.Server,
              _address: string,
              credentials: grpc.ServerCredentials,
              callback: (error: Error | null, port: number) => void,
            ): void {
              originalBindAsync.call(
                this,
                "127.0.0.1:0",
                credentials,
                (error: Error | null, port: number) => {
                  callback(error, port);
                  if (error) {
                    reject(error);
                    return;
                  }
                  // Arrow function: `this` is still the server instance.
                  resolve({ server: this, port });
                },
              );
            });
        },
      );
      jest.spyOn(logger, "info").mockImplementation(() => {
        return undefined;
      });

      startGrpcServer();
      const started: { server: grpc.Server; port: number } = await bound;
      grpcServer = started.server;
      grpcPort = started.port;
      expect(grpcPort).toBeGreaterThan(0);
      jest.restoreAllMocks();
    });

    afterAll(() => {
      grpcServer?.forceShutdown();
    });

    interface RawGrpcReply {
      status: string | undefined;
      message: string | undefined;
      body: Buffer;
    }

    /*
     * One unary OTLP/gRPC call spoken by hand over node:http2, byte for byte
     * what the Collector's `otlp` exporter puts on the wire: a 5-byte gRPC
     * message prefix (compressed flag + big-endian length) and, for its
     * default `compression: gzip`, a gzipped message with
     * `grpc-encoding: gzip`. No grpc library on the client side, so the
     * compressed flag really is set when the test says it is.
     */
    async function rawGrpcExport(data: {
      bytes: Buffer;
      gzip: boolean;
      token: string | null;
    }): Promise<RawGrpcReply> {
      const message: Buffer = data.gzip
        ? zlib.gzipSync(data.bytes)
        : data.bytes;
      const frame: Buffer = Buffer.alloc(5 + message.length);
      frame.writeUInt8(data.gzip ? 1 : 0, 0);
      frame.writeUInt32BE(message.length, 1);
      message.copy(frame, 5);

      const session: http2.ClientHttp2Session = http2.connect(
        `http://127.0.0.1:${grpcPort}`,
      );

      try {
        return await new Promise(
          (
            resolve: (reply: RawGrpcReply) => void,
            reject: (error: Error) => void,
          ) => {
            const stream: http2.ClientHttp2Stream = session.request({
              ":method": "POST",
              ":path": METRICS_EXPORT_PATH,
              "content-type": "application/grpc",
              te: "trailers",
              ...(data.gzip ? { "grpc-encoding": "gzip" } : {}),
              ...(data.token ? { "x-oneuptime-token": data.token } : {}),
            });
            let headers: http2.IncomingHttpHeaders = {};
            let trailers: http2.IncomingHttpHeaders = {};
            const chunks: Array<Buffer> = [];

            stream.on("response", (received: http2.IncomingHttpHeaders) => {
              headers = received;
            });
            stream.on("trailers", (received: http2.IncomingHttpHeaders) => {
              trailers = received;
            });
            stream.on("data", (chunk: Buffer) => {
              chunks.push(chunk);
            });
            stream.on("end", () => {
              // A trailers-only reply carries the status in the headers.
              const status: unknown =
                trailers["grpc-status"] ?? headers["grpc-status"];
              const statusMessage: unknown =
                trailers["grpc-message"] ?? headers["grpc-message"];
              resolve({
                status: status === undefined ? undefined : String(status),
                message:
                  statusMessage === undefined
                    ? undefined
                    : decodeURIComponent(String(statusMessage)),
                body: Buffer.concat(chunks),
              });
            });
            stream.on("error", reject);
            stream.end(frame);
          },
        );
      } finally {
        session.close();
      }
    }

    test.each([
      ["identity", false],
      ["gzip", true],
    ])(
      "%s-encoded Export stores the same rows as every other encoding",
      async (_label: string, gzip: boolean) => {
        const reply: RawGrpcReply = await rawGrpcExport({
          bytes: PROTOBUF_BYTES,
          gzip,
          token: INGESTION_TOKEN,
        });

        expect(reply.status).toBe(String(grpc.status.OK));
        // One uncompressed, zero-length ExportMetricsServiceResponse {}.
        expect(reply.body).toEqual(Buffer.from([0, 0, 0, 0, 0]));

        const job: TelemetryIngestJobData = onlyEnqueuedJob();
        expect(job.bodyFormat).toBe(OtelPayloadFormat.Json);
        await runWorker(job);

        expectCanonicalRequestStored();
      },
    );

    test("a batch without an ingestion key is refused UNAUTHENTICATED and nothing is enqueued", async () => {
      jest.spyOn(logger, "error").mockImplementation(() => {
        return undefined;
      });

      // Through a real grpc-js client, i.e. the status an exporter sees.
      const client: grpc.Client = new grpc.Client(
        `127.0.0.1:${grpcPort}`,
        grpc.credentials.createInsecure(),
        {
          "grpc.default_compression_algorithm": grpc.compressionAlgorithms.gzip,
        },
      );
      const reply: { error: grpc.ServiceError | null } = await new Promise(
        (resolve: (value: { error: grpc.ServiceError | null }) => void) => {
          // Identity (de)serializers: the exact bytes go on the wire.
          client.makeUnaryRequest(
            METRICS_EXPORT_PATH,
            (message: Buffer) => {
              return message;
            },
            (message: Buffer) => {
              return message;
            },
            PROTOBUF_BYTES,
            grpcMetadata(null),
            (error: grpc.ServiceError | null) => {
              resolve({ error });
            },
          );
        },
      );
      client.close();

      expect(reply.error).not.toBeNull();
      expect(reply.error!.code).toBe(grpc.status.UNAUTHENTICATED);
      // No token was sent, so the missing-token sentence, not any other.
      expect(reply.error!.details).toBe(MISSING_INGESTION_TOKEN_MESSAGE);
      expect(mockEnqueuedJobs).toHaveLength(0);
      expect(mockStoredBodies.size).toBe(0);
      expect(rows).toHaveLength(0);
    });
  });

  test("protobuf, gzip, OTLP/JSON and gRPC store field-for-field identical rows and catalogs", async () => {
    interface Route {
      label: string;
      run: () => Promise<void>;
    }

    const routes: Array<Route> = [
      {
        label: "HTTP protobuf",
        run: async () => {
          await runWorker(
            await postOverHttp({
              bytes: PROTOBUF_BYTES,
              contentType: "application/x-protobuf",
            }),
          );
        },
      },
      {
        label: "HTTP gzip protobuf",
        run: async () => {
          await runWorker(
            await postOverHttp({
              bytes: GZIP_PROTOBUF_BYTES,
              contentType: "application/x-protobuf",
              contentEncoding: "gzip",
            }),
          );
        },
      },
      {
        label: "HTTP OTLP/JSON",
        run: async () => {
          await runWorker(
            await postOverHttp({
              bytes: JSON_BYTES,
              contentType: "application/json",
            }),
          );
        },
      },
      {
        label: "HTTP gzip OTLP/JSON",
        run: async () => {
          await runWorker(
            await postOverHttp({
              bytes: GZIP_JSON_BYTES,
              contentType: "application/json",
              contentEncoding: "gzip",
            }),
          );
        },
      },
      {
        label: "gRPC",
        run: async () => {
          await runWorker(await exportViaGrpcHandler(PROTOBUF_BYTES));
        },
      },
    ];

    const results: Array<{
      label: string;
      rows: Array<JSONObject>;
      catalog: Dictionary<CatalogSemantics>;
    }> = [];

    for (const route of routes) {
      rows = [];
      resolvedServiceNames = [];
      mockEnqueuedJobs.length = 0;
      indexCatalog.mockClear();

      await route.run();

      const semantics: Dictionary<CatalogSemantics> = {};
      for (const name of Object.keys(catalog())) {
        semantics[name] = catalogSemantics(name);
      }
      results.push({
        label: route.label,
        rows: stableRows(),
        catalog: semantics,
      });
    }

    const baseline: (typeof results)[number] = results[0]!;
    expect(baseline.rows).toHaveLength(Object.keys(EXPECTED_ROWS).length);
    for (const result of results.slice(1)) {
      expect({ label: result.label, rows: result.rows }).toEqual({
        label: result.label,
        rows: baseline.rows,
      });
      expect({ label: result.label, catalog: result.catalog }).toEqual({
        label: result.label,
        catalog: baseline.catalog,
      });
    }
  });

  describe("every decoder's temporality form reaches the same stored value", () => {
    /*
     * A one-metric request whose Sum carries `aggregation_temporality = v`
     * EXPLICITLY on the wire (even 0, which canonical encoders elide), so
     * each decoder has to render it.
     */
    function wireSumRequest(temporality: number): Buffer {
      return wireExportRequest([
        wireMetric(
          "temporality.probe",
          WireMetricData.Sum,
          wireMessage(
            1,
            wireFixed64Field(3, TIME_UNIX_NANO),
            wireSfixed64Field(6, "1"),
          ),
          wireVarintField(2, temporality),
          wireVarintField(3, 1),
        ),
      ]);
    }

    function jsonSumRequest(temporality: number): Buffer {
      return Buffer.from(
        JSON.stringify({
          resourceMetrics: [
            {
              resource: {
                attributes: [
                  {
                    key: "service.name",
                    value: { stringValue: SERVICE_NAME },
                  },
                ],
              },
              scopeMetrics: [
                {
                  scope: { name: SCOPE_NAME },
                  metrics: [
                    {
                      name: "temporality.probe",
                      sum: {
                        dataPoints: [
                          { timeUnixNano: TIME_UNIX_NANO, asInt: "1" },
                        ],
                        aggregationTemporality: temporality,
                        isMonotonic: true,
                      },
                    },
                  ],
                },
              ],
            },
          ],
        }),
        "utf-8",
      );
    }

    // What the worker receives, per producer, for a given wire value.
    type Decoder = (temporality: number) => Promise<JSONObject>;

    const numericEnumOptions: protoLoader.Options = {
      ...OTLP_PROTO_LOADER_OPTIONS,
    };
    delete numericEnumOptions.enums;
    const numericEnumExport: GrpcExportMethod =
      loadGrpcExportMethod(numericEnumOptions);

    const decoders: Array<[string, Decoder]> = [
      [
        "HTTP protobuf (protobufjs .toJSON())",
        async (temporality: number) => {
          return decodeStoredBody({
            bytes: wireSumRequest(temporality),
            format: OtelPayloadFormat.Protobuf,
            encoding: "none",
          });
        },
      ],
      [
        "HTTP OTLP/JSON (JSON.parse)",
        async (temporality: number) => {
          return decodeStoredBody({
            bytes: jsonSumRequest(temporality),
            format: OtelPayloadFormat.Json,
            encoding: "none",
          });
        },
      ],
      [
        "gRPC (proto-loader, production options)",
        async (temporality: number) => {
          return decodeJob(
            await exportViaGrpcHandler(wireSumRequest(temporality)),
          );
        },
      ],
      [
        /*
         * Not the production configuration (GrpcServerProtoLoaderOptions pins
         * enums: String), but if that option were ever dropped proto-loader
         * would hand over the integers - and ingest must still read them.
         */
        "gRPC (proto-loader without enums: String)",
        async (temporality: number) => {
          return decodeJob(
            await exportViaGrpcHandler(
              wireSumRequest(temporality),
              numericEnumExport,
            ),
          );
        },
      ],
    ];

    interface TemporalityCase {
      wire: number;
      forms: Array<unknown>;
      normalized: OtelAggregationTemporality | undefined;
      stored: AggregationTemporality | null;
    }

    // forms: one per decoder above, in order.
    const temporalityCases: Array<TemporalityCase> = [
      {
        wire: 1,
        forms: [
          "AGGREGATION_TEMPORALITY_DELTA",
          1,
          "AGGREGATION_TEMPORALITY_DELTA",
          1,
        ],
        normalized: OtelAggregationTemporality.Delta,
        stored: AggregationTemporality.Delta,
      },
      {
        wire: 2,
        forms: [
          "AGGREGATION_TEMPORALITY_CUMULATIVE",
          2,
          "AGGREGATION_TEMPORALITY_CUMULATIVE",
          2,
        ],
        normalized: OtelAggregationTemporality.Cumulative,
        stored: AggregationTemporality.Cumulative,
      },
      {
        // AGGREGATION_TEMPORALITY_UNSPECIFIED, written explicitly.
        wire: 0,
        forms: [
          "AGGREGATION_TEMPORALITY_UNSPECIFIED",
          0,
          "AGGREGATION_TEMPORALITY_UNSPECIFIED",
          0,
        ],
        normalized: undefined,
        stored: null,
      },
      {
        // A value from a future OTLP revision: decoders pass the number on.
        wire: 3,
        forms: [3, 3, 3, 3],
        normalized: undefined,
        stored: null,
      },
    ];

    const matrix: Array<[string, number, number, TemporalityCase]> = [];
    temporalityCases.forEach((temporalityCase: TemporalityCase) => {
      decoders.forEach(([label]: [string, Decoder], index: number) => {
        matrix.push([label, temporalityCase.wire, index, temporalityCase]);
      });
    });

    test.each(matrix)(
      "%s, wire temporality %i",
      async (
        _label: string,
        wire: number,
        decoderIndex: number,
        temporalityCase: TemporalityCase,
      ) => {
        const decode: Decoder = decoders[decoderIndex]![1];
        const body: JSONObject = await decode(wire);

        const form: unknown = temporalityForms(body)["temporality.probe"];
        expect(form).toEqual(temporalityCase.forms[decoderIndex]);
        expect(
          OtelMetricsIngestService.normalizeAggregationTemporality(form),
        ).toBe(temporalityCase.normalized);

        await ingestDecodedBody(body);

        expect(rows).toHaveLength(1);
        expect(rows[0]!["name"]).toBe("temporality.probe");
        expect(rows[0]!["aggregationTemporality"]).toBe(temporalityCase.stored);
        expect(rows[0]!["isMonotonic"]).toBe(true);
        expect(rows[0]!["value"]).toBe(1);
        expect(catalogSemantics("temporality.probe")).toEqual({
          aggregationTemporality: temporalityCase.stored ?? undefined,
          isMonotonic: true,
        });
      },
    );
  });

  describe("bytes assembled from the upstream OTLP field numbers", () => {
    const upstreamRequest: Buffer = wireExportRequest([
      // Sum { data_points = 1, aggregation_temporality = 2, is_monotonic = 3 }
      wireMetric(
        "wire.requests",
        WireMetricData.Sum,
        wireMessage(
          1,
          wireFixed64Field(2, START_TIME_UNIX_NANO),
          wireFixed64Field(3, TIME_UNIX_NANO),
          wireSfixed64Field(6, "7"),
        ),
        wireVarintField(2, 2),
        wireVarintField(3, 1),
      ),
      wireMetric(
        "wire.jobs",
        WireMetricData.Sum,
        wireMessage(
          1,
          wireFixed64Field(3, TIME_UNIX_NANO),
          wireDoubleField(4, 2.5),
        ),
        wireVarintField(2, 1),
        wireVarintField(3, 1),
      ),
      // No aggregation_temporality on the wire at all: UNSPECIFIED.
      wireMetric(
        "wire.unspecified",
        WireMetricData.Sum,
        wireMessage(
          1,
          wireFixed64Field(3, TIME_UNIX_NANO),
          wireSfixed64Field(6, "1"),
        ),
      ),
      /*
       * Histogram { data_points = 1 { time = 3, count = 4, sum = 5,
       * bucket_counts = 6, explicit_bounds = 7 }, aggregation_temporality = 2 }
       */
      wireMetric(
        "wire.latency",
        WireMetricData.Histogram,
        wireMessage(
          1,
          wireFixed64Field(3, TIME_UNIX_NANO),
          wireFixed64Field(4, "2"),
          wireDoubleField(5, 3.5),
          wirePackedFixed64Field(6, ["1", "1"]),
          wirePackedDoubleField(7, [2]),
        ),
        wireVarintField(2, 1),
      ),
      /*
       * ExponentialHistogram { data_points = 1 { time = 3, count = 4,
       * sum = 5, scale = 6 (sint32), positive = 8 { offset = 1 (sint32),
       * bucket_counts = 2 } }, aggregation_temporality = 2 }
       */
      wireMetric(
        "wire.size",
        WireMetricData.ExponentialHistogram,
        wireMessage(
          1,
          wireFixed64Field(3, TIME_UNIX_NANO),
          wireFixed64Field(4, "3"),
          wireDoubleField(5, 4.5),
          wireSint32Field(6, 2),
          wireMessage(8, wireSint32Field(1, -1), wirePackedVarintField(2, [3])),
        ),
        wireVarintField(2, 2),
      ),
      // Gauge { data_points = 1 { time = 3, as_double = 4 } }
      wireMetric(
        "wire.temperature",
        WireMetricData.Gauge,
        wireMessage(
          1,
          wireFixed64Field(3, TIME_UNIX_NANO),
          wireDoubleField(4, 21.5),
        ),
      ),
    ]);

    const expected: Dictionary<JSONObject> = {
      "wire.requests": {
        metricPointType: MetricPointType.Sum,
        aggregationTemporality: AggregationTemporality.Cumulative,
        isMonotonic: true,
        value: 7,
        startTimeUnixNano: START_TIME_UNIX_NANO,
        timeUnixNano: TIME_UNIX_NANO,
      },
      "wire.jobs": {
        metricPointType: MetricPointType.Sum,
        aggregationTemporality: AggregationTemporality.Delta,
        isMonotonic: true,
        value: 2.5,
        startTimeUnixNano: null,
        timeUnixNano: TIME_UNIX_NANO,
      },
      "wire.unspecified": {
        metricPointType: MetricPointType.Sum,
        aggregationTemporality: null,
        isMonotonic: null,
        value: 1,
        startTimeUnixNano: null,
        timeUnixNano: TIME_UNIX_NANO,
      },
      "wire.latency": {
        metricPointType: MetricPointType.Histogram,
        aggregationTemporality: AggregationTemporality.Delta,
        isMonotonic: null,
        value: 3.5,
        count: 2,
        bucketCounts: [1, 1],
        explicitBounds: [2],
      },
      "wire.size": {
        metricPointType: MetricPointType.ExponentialHistogram,
        aggregationTemporality: AggregationTemporality.Cumulative,
        isMonotonic: null,
        value: 4.5,
        count: 3,
        scale: 2,
        positiveOffset: -1,
        positiveBucketCounts: [3],
      },
      "wire.temperature": {
        metricPointType: MetricPointType.Gauge,
        aggregationTemporality: null,
        isMonotonic: null,
        value: 21.5,
      },
    };

    test.each([
      [
        "HTTP protobuf",
        async (): Promise<void> => {
          await runWorker(
            await postOverHttp({
              bytes: upstreamRequest,
              contentType: "application/x-protobuf",
            }),
          );
        },
      ],
      [
        "HTTP gzip protobuf",
        async (): Promise<void> => {
          await runWorker(
            await postOverHttp({
              bytes: zlib.gzipSync(upstreamRequest),
              contentType: "application/x-protobuf",
              contentEncoding: "gzip",
            }),
          );
        },
      ],
      [
        "gRPC",
        async (): Promise<void> => {
          await runWorker(await exportViaGrpcHandler(upstreamRequest));
        },
      ],
    ])(
      "%s decodes them to the right temporality, type and value",
      async (_label: string, run: () => Promise<void>) => {
        await run();

        expect(resolvedServiceNames).toEqual([SERVICE_NAME]);
        const byName: Map<string, JSONObject> = rowsByName();
        expect(Array.from(byName.keys()).sort()).toEqual(
          Object.keys(expected).sort(),
        );
        for (const [name, fields] of Object.entries(expected)) {
          expect({
            name,
            ...pick(byName.get(name)!, Object.keys(fields)),
          }).toEqual({ name, ...fields });
        }
        expect(catalogSemantics("wire.requests")).toEqual({
          aggregationTemporality: AggregationTemporality.Cumulative,
          isMonotonic: true,
        });
        expect(catalogSemantics("wire.latency")).toEqual({
          aggregationTemporality: AggregationTemporality.Delta,
          isMonotonic: undefined,
        });
        expect(catalogSemantics("wire.unspecified")).toEqual({
          aggregationTemporality: undefined,
          isMonotonic: undefined,
        });
      },
    );

    test("the repo's metrics.proto agrees with the upstream numbering", () => {
      // The symmetric check: protobufjs reads the hand-assembled bytes back.
      const decoded: JSONObject = ExportMetricsServiceRequestType.toObject(
        ExportMetricsServiceRequestType.decode(upstreamRequest),
        { longs: String, enums: Number },
      ) as JSONObject;
      const metrics: JSONArray = (
        (decoded["resourceMetrics"] as JSONArray)[0]![
          "scopeMetrics"
        ] as JSONArray
      )[0]!["metrics"] as JSONArray;

      expect(
        metrics.map((metric: JSONObject) => {
          return metric["name"];
        }),
      ).toEqual([
        "wire.requests",
        "wire.jobs",
        "wire.unspecified",
        "wire.latency",
        "wire.size",
        "wire.temperature",
      ]);
      expect(metrics[0]!["sum"]).toEqual({
        dataPoints: [
          {
            startTimeUnixNano: START_TIME_UNIX_NANO,
            timeUnixNano: TIME_UNIX_NANO,
            asInt: "7",
          },
        ],
        aggregationTemporality: 2,
        isMonotonic: true,
      });
      expect(
        (metrics[3]!["histogram"] as JSONObject)["aggregationTemporality"],
      ).toBe(1);
      expect(
        (metrics[4]!["exponentialHistogram"] as JSONObject)[
          "aggregationTemporality"
        ],
      ).toBe(2);
      expect(
        (
          (
            (metrics[4]!["exponentialHistogram"] as JSONObject)[
              "dataPoints"
            ] as JSONArray
          )[0]!["positive"] as JSONObject
        )["offset"],
      ).toBe(-1);
    });
  });

  describe("proto3 default elision", () => {
    /*
     * `is_monotonic` is a plain proto3 bool: a Go/Java encoder (and the
     * Collector's JSON marshaler) drops `false`, while protobufjs and the JS
     * SDK's JSON serializer write it out. The stored row mirrors what was on
     * the wire - false when present, null when elided - and nothing
     * downstream distinguishes the two (the dashboards and the catalog test
     * `=== true` / `typeof === "boolean"`), so a non-monotonic Sum is never
     * mistaken for a counter either way. Temporality is unaffected.
     */
    function upDownCounter(isMonotonic: boolean | undefined): JSONObject {
      return {
        resourceMetrics: [
          {
            resource: {
              attributes: [
                { key: "service.name", value: { stringValue: SERVICE_NAME } },
              ],
            },
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: "pool.connections.active",
                    sum: {
                      dataPoints: [
                        { timeUnixNano: TIME_UNIX_NANO, asInt: "4" },
                      ],
                      aggregationTemporality: 2,
                      ...(isMonotonic === undefined ? {} : { isMonotonic }),
                    },
                  },
                ],
              },
            ],
          },
        ],
      };
    }

    test.each([
      ["protobuf, false written", OtelPayloadFormat.Protobuf, false, false],
      ["protobuf, false elided", OtelPayloadFormat.Protobuf, undefined, null],
      ["OTLP/JSON, false written", OtelPayloadFormat.Json, false, false],
      ["OTLP/JSON, false elided", OtelPayloadFormat.Json, undefined, null],
    ])(
      "isMonotonic: %s",
      async (
        _label: string,
        format: OtelPayloadFormat,
        wireValue: boolean | undefined,
        stored: boolean | null,
      ) => {
        const request: JSONObject = upDownCounter(wireValue);
        const bytes: Buffer =
          format === OtelPayloadFormat.Protobuf
            ? encodeProtobuf(request)
            : Buffer.from(JSON.stringify(request), "utf-8");

        await ingestDecodedBody(
          await decodeStoredBody({ bytes, format, encoding: "none" }),
        );

        expect(rows).toHaveLength(1);
        expect(rows[0]!["aggregationTemporality"]).toBe(
          AggregationTemporality.Cumulative,
        );
        expect(rows[0]!["isMonotonic"]).toBe(stored);
        expect(rows[0]!["value"]).toBe(4);
        expect(catalogSemantics("pool.connections.active")).toEqual({
          aggregationTemporality: AggregationTemporality.Cumulative,
          isMonotonic: stored ?? undefined,
        });
      },
    );

    /*
     * A Summary quantile whose `quantile` or `value` is 0 must be stored.
     *
     * SummaryDataPoint.ValueAtQuantile's fields are plain proto3 doubles, and
     * the Collector elides a 0 in both encodings: its generated protobuf
     * marshaler writes each field only `if != 0`, and its OTLP/JSON marshaler
     * is gogo jsonpb without EmitDefaults. Every decoder here then leaves the
     * key out. completeMetricRow used to skip an entry with a missing key, so
     * a quantile-0 series - e.g. `go_gc_duration_seconds{quantile="0"}` from
     * the Prometheus Go client's Go collector - never reached storage, and
     * summaryQuantiles / summaryValues came out one entry short. Proto3 says
     * an absent double IS 0.
     */
    const goGcDurationSeconds: Buffer = wireExportRequest([
      wireMetric(
        "go.gc.duration.seconds",
        WireMetricData.Summary,
        wireMessage(
          1,
          wireFixed64Field(3, TIME_UNIX_NANO),
          wireFixed64Field(4, "3"),
          wireDoubleField(5, 0.000512),
          // quantile 0 elided; value only.
          wireMessage(6, wireDoubleField(2, 0.0000321)),
          wireMessage(
            6,
            wireDoubleField(1, 0.5),
            wireDoubleField(2, 0.0000452),
          ),
          wireMessage(6, wireDoubleField(1, 1), wireDoubleField(2, 0.000434)),
        ),
      ),
    ]);

    const goGcDurationSecondsJson: Buffer = Buffer.from(
      JSON.stringify({
        resourceMetrics: [
          {
            resource: {
              attributes: [
                { key: "service.name", value: { stringValue: SERVICE_NAME } },
              ],
            },
            scopeMetrics: [
              {
                scope: { name: SCOPE_NAME },
                metrics: [
                  {
                    name: "go.gc.duration.seconds",
                    summary: {
                      dataPoints: [
                        {
                          timeUnixNano: TIME_UNIX_NANO,
                          count: "3",
                          sum: 0.000512,
                          quantileValues: [
                            { value: 0.0000321 },
                            { quantile: 0.5, value: 0.0000452 },
                            { quantile: 1, value: 0.000434 },
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
      }),
      "utf-8",
    );

    const summaryRoutes: Array<[string, () => Promise<void>]> = [
      [
        "HTTP protobuf",
        async (): Promise<void> => {
          await runWorker(
            await postOverHttp({
              bytes: goGcDurationSeconds,
              contentType: "application/x-protobuf",
            }),
          );
        },
      ],
      [
        "HTTP OTLP/JSON",
        async (): Promise<void> => {
          await runWorker(
            await postOverHttp({
              bytes: goGcDurationSecondsJson,
              contentType: "application/json",
            }),
          );
        },
      ],
      [
        "gRPC",
        async (): Promise<void> => {
          await runWorker(await exportViaGrpcHandler(goGcDurationSeconds));
        },
      ],
    ];

    test.each(summaryRoutes)(
      "%s: a Summary's quantile 0 (elided on the wire) is stored",
      async (_label: string, run: () => Promise<void>) => {
        await run();

        expect(rows).toHaveLength(1);
        expect(rows[0]!["metricPointType"]).toBe(MetricPointType.Summary);
        expect(rows[0]!["summaryQuantiles"]).toEqual([0, 0.5, 1]);
        expect(rows[0]!["summaryValues"]).toEqual([
          0.0000321, 0.0000452, 0.000434,
        ]);
      },
    );

    /*
     * The rest of that same datapoint: the row lands, carries no
     * temporality, and every quantile keeps its own value (the two arrays
     * stay index-aligned).
     */
    test.each(summaryRoutes)(
      "%s: the rest of a Summary with an elided quantile is stored intact",
      async (_label: string, run: () => Promise<void>) => {
        await run();

        expect(rows).toHaveLength(1);
        const row: JSONObject = rows[0]!;
        expect(row["name"]).toBe("go.gc.duration.seconds");
        expect(row["metricPointType"]).toBe(MetricPointType.Summary);
        expect(row["aggregationTemporality"]).toBeNull();
        expect(row["isMonotonic"]).toBeNull();
        expect(row["count"]).toBe(3);
        expect(row["sum"]).toBe(0.000512);
        expect(row["value"]).toBe(0.000512);
        expect(row["timeUnixNano"]).toBe(TIME_UNIX_NANO);

        const quantiles: Array<number> = row[
          "summaryQuantiles"
        ] as Array<number>;
        const values: Array<number> = row["summaryValues"] as Array<number>;
        expect(quantiles).toHaveLength(values.length);
        const pairs: Array<[number, number]> = quantiles.map(
          (quantile: number, index: number): [number, number] => {
            return [quantile, values[index]!];
          },
        );
        expect(pairs).toEqual([
          [0, 0.0000321],
          [0.5, 0.0000452],
          [1, 0.000434],
        ]);
      },
    );

    /*
     * A zero VALUE is elided the same way, and a quantile 0 whose value is
     * also 0 goes on the wire as an EMPTY ValueAtQuantile message - both
     * fields absent. A summary whose smallest observations are 0 produces
     * exactly this.
     */
    const zeroValueSummaryWire: (explicitZeros: boolean) => Buffer = (
      explicitZeros: boolean,
    ): Buffer => {
      const zero: (fieldNumber: number) => WireBytes = (
        fieldNumber: number,
      ): WireBytes => {
        return explicitZeros ? wireDoubleField(fieldNumber, 0) : [];
      };
      return wireExportRequest([
        wireMetric(
          "queue.wait.seconds",
          WireMetricData.Summary,
          wireMessage(
            1,
            wireFixed64Field(3, TIME_UNIX_NANO),
            wireFixed64Field(4, "9"),
            wireDoubleField(5, 0.03),
            // quantile 0, value 0.
            wireMessage(6, zero(1), zero(2)),
            // quantile 0.25, value 0.
            wireMessage(6, wireDoubleField(1, 0.25), zero(2)),
            wireMessage(6, wireDoubleField(1, 0.5), wireDoubleField(2, 0.002)),
            wireMessage(6, wireDoubleField(1, 0.99), wireDoubleField(2, 0.01)),
          ),
        ),
      ]);
    };

    const zeroValueSummaryJson: (explicitZeros: boolean) => Buffer = (
      explicitZeros: boolean,
    ): Buffer => {
      const zeros: JSONObject = explicitZeros ? { quantile: 0, value: 0 } : {};
      return Buffer.from(
        JSON.stringify({
          resourceMetrics: [
            {
              resource: {
                attributes: [
                  {
                    key: "service.name",
                    value: { stringValue: SERVICE_NAME },
                  },
                ],
              },
              scopeMetrics: [
                {
                  scope: { name: SCOPE_NAME },
                  metrics: [
                    {
                      name: "queue.wait.seconds",
                      summary: {
                        dataPoints: [
                          {
                            timeUnixNano: TIME_UNIX_NANO,
                            count: "9",
                            sum: 0.03,
                            quantileValues: [
                              zeros,
                              explicitZeros
                                ? { quantile: 0.25, value: 0 }
                                : { quantile: 0.25 },
                              { quantile: 0.5, value: 0.002 },
                              { quantile: 0.99, value: 0.01 },
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
        }),
        "utf-8",
      );
    };

    test.each([
      [
        "HTTP protobuf, zeros elided",
        async (): Promise<void> => {
          await runWorker(
            await postOverHttp({
              bytes: zeroValueSummaryWire(false),
              contentType: "application/x-protobuf",
            }),
          );
        },
      ],
      [
        "HTTP gzip protobuf, zeros elided",
        async (): Promise<void> => {
          await runWorker(
            await postOverHttp({
              bytes: zlib.gzipSync(zeroValueSummaryWire(false)),
              contentType: "application/x-protobuf",
              contentEncoding: "gzip",
            }),
          );
        },
      ],
      [
        "HTTP protobuf, zeros written explicitly",
        async (): Promise<void> => {
          await runWorker(
            await postOverHttp({
              bytes: zeroValueSummaryWire(true),
              contentType: "application/x-protobuf",
            }),
          );
        },
      ],
      [
        "HTTP OTLP/JSON, zeros elided",
        async (): Promise<void> => {
          await runWorker(
            await postOverHttp({
              bytes: zeroValueSummaryJson(false),
              contentType: "application/json",
            }),
          );
        },
      ],
      [
        "HTTP OTLP/JSON, zeros written explicitly",
        async (): Promise<void> => {
          await runWorker(
            await postOverHttp({
              bytes: zeroValueSummaryJson(true),
              contentType: "application/json",
            }),
          );
        },
      ],
      [
        "gRPC, zeros elided",
        async (): Promise<void> => {
          await runWorker(
            await exportViaGrpcHandler(zeroValueSummaryWire(false)),
          );
        },
      ],
      [
        "gRPC, zeros written explicitly",
        async (): Promise<void> => {
          await runWorker(
            await exportViaGrpcHandler(zeroValueSummaryWire(true)),
          );
        },
      ],
    ])(
      "%s: a Summary's value 0, and quantile 0 with value 0, are stored",
      async (_label: string, run: () => Promise<void>) => {
        await run();

        expect(rows).toHaveLength(1);
        const row: JSONObject = rows[0]!;
        expect(row["name"]).toBe("queue.wait.seconds");
        expect(row["metricPointType"]).toBe(MetricPointType.Summary);
        expect(row["count"]).toBe(9);
        expect(row["sum"]).toBe(0.03);
        expect(row["summaryQuantiles"]).toEqual([0, 0.25, 0.5, 0.99]);
        expect(row["summaryValues"]).toEqual([0, 0, 0.002, 0.01]);
      },
    );

    /*
     * Absent is not the same as unreadable. The proto3 JSON mapping reads a
     * `null` field as its default (0), but a value present as a non-finite
     * double ("NaN" / "Infinity" in OTLP/JSON) still drops its whole pair,
     * as does an entry that is not an object at all - so the two arrays stay
     * index-aligned.
     */
    test("OTLP/JSON: a null field is 0; a non-finite value or a non-object entry drops the pair", async () => {
      const request: JSONObject = {
        resourceMetrics: [
          {
            resource: {
              attributes: [
                { key: "service.name", value: { stringValue: SERVICE_NAME } },
              ],
            },
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: "queue.wait.seconds",
                    summary: {
                      dataPoints: [
                        {
                          timeUnixNano: TIME_UNIX_NANO,
                          count: "4",
                          sum: 3.5,
                          quantileValues: [
                            { quantile: null, value: 0.001 },
                            { quantile: 0.25, value: null },
                            { quantile: 0.5, value: "NaN" },
                            { quantile: 0.9, value: "Infinity" },
                            null,
                            { quantile: 1, value: 3 },
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

      await ingestDecodedBody(
        await decodeStoredBody({
          bytes: Buffer.from(JSON.stringify(request), "utf-8"),
          format: OtelPayloadFormat.Json,
          encoding: "none",
        }),
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]!["summaryQuantiles"]).toEqual([0, 0.25, 1]);
      expect(rows[0]!["summaryValues"]).toEqual([0.001, 0, 3]);
    });

    /*
     * An idle data point: nothing was observed in the interval, so `count` is
     * 0 and a Summary's `sum` is 0. Both are plain proto3 scalars
     * (`fixed64 count` on Histogram, ExponentialHistogram and Summary points;
     * `double sum` on Summary points), and the Collector writes them only
     * `if m.Count != 0` / `if m.Sum != 0`, so they arrive absent. That must be
     * stored as 0, not null - and the Summary row's `value`, which is its
     * sum, as 0 too. A Prometheus summary with no observations yet and an
     * empty delta-histogram interval both look like this. So does a Summary
     * whose observations were all 0 (count written, sum elided): stored
     * with a null sum, MetricService's distribution-aware Count / Avg did
     * not recognise it as a distribution row and counted none of them.
     *
     * Histogram and ExponentialHistogram `sum` (like `min` / `max`) is
     * `optional double`: the Collector writes it `if m.Sum_ != nil`, so
     * absent there means "not recorded" and stays null. A Gauge point has no
     * count or sum at all, so both stay null.
     */
    type IdleForm = "elided" | "explicit" | "null";

    const idleWire: (form: Exclude<IdleForm, "null">) => Buffer = (
      form: Exclude<IdleForm, "null">,
    ): Buffer => {
      const explicit: boolean = form === "explicit";
      const count: WireBytes = explicit ? wireFixed64Field(4, "0") : [];
      const summarySum: WireBytes = explicit ? wireDoubleField(5, 0) : [];
      const summaryZeroValue: WireBytes = explicit ? wireDoubleField(2, 0) : [];
      return wireExportRequest([
        // SummaryDataPoint { time = 3, count = 4, sum = 5 }
        wireMetric(
          "rpc.idle.summary",
          WireMetricData.Summary,
          wireMessage(
            1,
            wireFixed64Field(3, TIME_UNIX_NANO),
            count,
            summarySum,
          ),
        ),
        /*
         * Four observations, all 0: count is written, the sum 0 and every
         * quantile's value 0 are not.
         */
        wireMetric(
          "rpc.zero.summary",
          WireMetricData.Summary,
          wireMessage(
            1,
            wireFixed64Field(3, TIME_UNIX_NANO),
            wireFixed64Field(4, "4"),
            summarySum,
            wireMessage(6, wireDoubleField(1, 0.5), summaryZeroValue),
            wireMessage(6, wireDoubleField(1, 1), summaryZeroValue),
          ),
        ),
        /*
         * HistogramDataPoint { time = 3, count = 4, bucket_counts = 6,
         * explicit_bounds = 7 }; the optional sum = 5 is not recorded.
         */
        wireMetric(
          "http.idle.duration",
          WireMetricData.Histogram,
          wireMessage(
            1,
            wireFixed64Field(3, TIME_UNIX_NANO),
            count,
            wirePackedFixed64Field(6, ["0", "0"]),
            wirePackedDoubleField(7, [1]),
          ),
          wireVarintField(2, 1),
        ),
        // ExponentialHistogramDataPoint { time = 3, count = 4 }
        wireMetric(
          "http.idle.size",
          WireMetricData.ExponentialHistogram,
          wireMessage(1, wireFixed64Field(3, TIME_UNIX_NANO), count),
          wireVarintField(2, 1),
        ),
        // NumberDataPoint { time = 3, as_double = 4 }: a oneof, always written.
        wireMetric(
          "idle.temperature",
          WireMetricData.Gauge,
          wireMessage(
            1,
            wireFixed64Field(3, TIME_UNIX_NANO),
            wireDoubleField(4, 0),
          ),
        ),
      ]);
    };

    const idleJson: (form: IdleForm) => Buffer = (form: IdleForm): Buffer => {
      // The proto3 JSON mapping reads a `null` field as its default.
      const zero: JSONValue | undefined =
        form === "elided" ? undefined : form === "null" ? null : 0;
      const count: JSONObject =
        zero === undefined ? {} : { count: zero === 0 ? "0" : null };
      const summarySum: JSONObject = zero === undefined ? {} : { sum: zero };
      const summaryZeroValue: JSONObject =
        zero === undefined ? {} : { value: zero };
      // An optional sum sent as null is "not recorded", like an absent one.
      const histogramSum: JSONObject = form === "null" ? { sum: null } : {};
      return Buffer.from(
        JSON.stringify({
          resourceMetrics: [
            {
              resource: {
                attributes: [
                  {
                    key: "service.name",
                    value: { stringValue: SERVICE_NAME },
                  },
                ],
              },
              scopeMetrics: [
                {
                  scope: { name: SCOPE_NAME },
                  metrics: [
                    {
                      name: "rpc.idle.summary",
                      summary: {
                        dataPoints: [
                          {
                            timeUnixNano: TIME_UNIX_NANO,
                            ...count,
                            ...summarySum,
                          },
                        ],
                      },
                    },
                    {
                      name: "rpc.zero.summary",
                      summary: {
                        dataPoints: [
                          {
                            timeUnixNano: TIME_UNIX_NANO,
                            count: "4",
                            ...summarySum,
                            quantileValues: [
                              { quantile: 0.5, ...summaryZeroValue },
                              { quantile: 1, ...summaryZeroValue },
                            ],
                          },
                        ],
                      },
                    },
                    {
                      name: "http.idle.duration",
                      histogram: {
                        aggregationTemporality: 1,
                        dataPoints: [
                          {
                            timeUnixNano: TIME_UNIX_NANO,
                            ...count,
                            ...histogramSum,
                            bucketCounts: ["0", "0"],
                            explicitBounds: [1],
                          },
                        ],
                      },
                    },
                    {
                      name: "http.idle.size",
                      exponentialHistogram: {
                        aggregationTemporality: 1,
                        dataPoints: [
                          {
                            timeUnixNano: TIME_UNIX_NANO,
                            ...count,
                            ...histogramSum,
                          },
                        ],
                      },
                    },
                    {
                      name: "idle.temperature",
                      gauge: {
                        dataPoints: [
                          { timeUnixNano: TIME_UNIX_NANO, asDouble: 0 },
                        ],
                      },
                    },
                  ],
                },
              ],
            },
          ],
        }),
        "utf-8",
      );
    };

    const expectedIdleRows: Dictionary<JSONObject> = {
      "rpc.idle.summary": {
        metricPointType: MetricPointType.Summary,
        count: 0,
        sum: 0,
        value: 0,
        min: null,
        max: null,
        summaryQuantiles: [],
        summaryValues: [],
      },
      "rpc.zero.summary": {
        metricPointType: MetricPointType.Summary,
        count: 4,
        sum: 0,
        value: 0,
        summaryQuantiles: [0.5, 1],
        summaryValues: [0, 0],
      },
      "http.idle.duration": {
        metricPointType: MetricPointType.Histogram,
        count: 0,
        sum: null,
        value: null,
        min: null,
        max: null,
        bucketCounts: [0, 0],
        explicitBounds: [1],
      },
      "http.idle.size": {
        metricPointType: MetricPointType.ExponentialHistogram,
        count: 0,
        sum: null,
        value: null,
        min: null,
        max: null,
        zeroCount: 0,
        scale: 0,
      },
      "idle.temperature": {
        metricPointType: MetricPointType.Gauge,
        count: null,
        sum: null,
        value: 0,
      },
    };

    test.each([
      [
        "HTTP protobuf, zeros elided",
        async (): Promise<void> => {
          await runWorker(
            await postOverHttp({
              bytes: idleWire("elided"),
              contentType: "application/x-protobuf",
            }),
          );
        },
      ],
      [
        "HTTP gzip protobuf, zeros elided",
        async (): Promise<void> => {
          await runWorker(
            await postOverHttp({
              bytes: zlib.gzipSync(idleWire("elided")),
              contentType: "application/x-protobuf",
              contentEncoding: "gzip",
            }),
          );
        },
      ],
      [
        "HTTP protobuf, zeros written explicitly",
        async (): Promise<void> => {
          await runWorker(
            await postOverHttp({
              bytes: idleWire("explicit"),
              contentType: "application/x-protobuf",
            }),
          );
        },
      ],
      [
        "HTTP OTLP/JSON, zeros elided",
        async (): Promise<void> => {
          await runWorker(
            await postOverHttp({
              bytes: idleJson("elided"),
              contentType: "application/json",
            }),
          );
        },
      ],
      [
        "HTTP OTLP/JSON, zeros written explicitly",
        async (): Promise<void> => {
          await runWorker(
            await postOverHttp({
              bytes: idleJson("explicit"),
              contentType: "application/json",
            }),
          );
        },
      ],
      [
        "HTTP OTLP/JSON, zeros sent as null",
        async (): Promise<void> => {
          await runWorker(
            await postOverHttp({
              bytes: idleJson("null"),
              contentType: "application/json",
            }),
          );
        },
      ],
      [
        "gRPC, zeros elided",
        async (): Promise<void> => {
          await runWorker(await exportViaGrpcHandler(idleWire("elided")));
        },
      ],
      [
        "gRPC, zeros written explicitly",
        async (): Promise<void> => {
          await runWorker(await exportViaGrpcHandler(idleWire("explicit")));
        },
      ],
    ])(
      "%s: count 0 and a Summary's sum 0 are stored, and an unrecorded optional sum stays null",
      async (_label: string, run: () => Promise<void>) => {
        await run();

        const byName: Map<string, JSONObject> = rowsByName();
        expect(Array.from(byName.keys()).sort()).toEqual(
          Object.keys(expectedIdleRows).sort(),
        );
        for (const [name, fields] of Object.entries(expectedIdleRows)) {
          expect({
            name,
            ...pick(byName.get(name)!, Object.keys(fields)),
          }).toEqual({ name, ...fields });
        }
      },
    );

    /*
     * Absent is not the same as unreadable here either: a count or Summary
     * sum that is present but not a finite number is unknown, and stays null
     * rather than being passed off as an idle 0.
     */
    test("OTLP/JSON: a non-finite Summary sum or count stays null", async () => {
      const request: JSONObject = {
        resourceMetrics: [
          {
            resource: {
              attributes: [
                { key: "service.name", value: { stringValue: SERVICE_NAME } },
              ],
            },
            scopeMetrics: [
              {
                metrics: [
                  {
                    name: "queue.wait.seconds",
                    summary: {
                      dataPoints: [
                        {
                          timeUnixNano: TIME_UNIX_NANO,
                          count: "not-a-number",
                          sum: "NaN",
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

      await ingestDecodedBody(
        await decodeStoredBody({
          bytes: Buffer.from(JSON.stringify(request), "utf-8"),
          format: OtelPayloadFormat.Json,
          encoding: "none",
        }),
      );

      expect(rows).toHaveLength(1);
      expect(pick(rows[0]!, ["count", "sum", "value"])).toEqual({
        count: null,
        sum: null,
        value: null,
      });
    });
  });
});
