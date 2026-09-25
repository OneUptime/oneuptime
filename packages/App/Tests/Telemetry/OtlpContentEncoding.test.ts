import crypto from "crypto";
import http from "http";
import { AddressInfo } from "net";
import path from "path";
import protobuf from "protobufjs";
import zlib from "zlib";
import OTelIngestAPI from "../../FeatureSet/Telemetry/API/OTelIngest";
import OpenTelemetryRequestMiddleware from "../../FeatureSet/Telemetry/Middleware/OtelRequestMiddleware";
import MetricPipelineRuleService from "../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import OtelMetricsIngestService from "../../FeatureSet/Telemetry/Services/OtelMetricsIngestService";
import TelemetryQueueService, {
  TelemetryIngestJobData,
  TelemetryType,
} from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import OtelPayloadDecoder, {
  MAX_DECOMPRESSED_OTLP_BODY_BYTES,
  MAX_ZSTD_WINDOW_LOG,
  OtelPayloadEncoding,
  OtelPayloadFormat,
  SUPPORTED_OTLP_CONTENT_ENCODINGS,
} from "../../FeatureSet/Telemetry/Utils/OtelPayloadDecoder";
import TelemetryBodyStore from "../../FeatureSet/Telemetry/Utils/TelemetryBodyStore";
import Queue, { QueueName } from "Common/Server/Infrastructure/Queue";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import { TelemetryServiceMetadata } from "Common/Server/Services/OpenTelemetryIngestService";
import Express, {
  ExpressApplication,
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { expressErrorHandler } from "Common/Server/Utils/StartServer";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import TelemetryFanInWriter, {
  FanInInsertTarget,
} from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import {
  AggregationTemporality,
  MetricPointType,
} from "Common/Models/AnalyticsModels/Metric";
import { JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import TelemetryIngestionKeyPolicy from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";

/*
 * GH#3978: an OTel Collector built for Datadog, re-pointed at OneUptime.
 *
 * Datadog's recommended Collector config exports with `compression: zstd`.
 * OTLP/HTTP admission knew one content coding, gzip: any other body was
 * answered 200, stored as if it were uncompressed, and then failed to
 * decode in the worker - every batch lost, and no error on either side.
 *
 * Now the endpoints accept gzip (and x-gzip), deflate (and zlib, zlib-
 * wrapped or raw) and zstd, bounded by the same decompression ceiling, and
 * answer 415 at admission for anything else - before the body is stored or
 * a job is queued, so the exporter hears about it.
 *
 * The HTTP tests post real bytes over a real socket through the real global
 * body parsers (StartServer), the real OTLP router on both of the prefixes
 * the App mounts it on, the real ingestion-key middleware and the real
 * queue producer; then the queued job is run through the real worker decode
 * and (for metrics) the real ingest walk down to the rows it would write.
 * Stubbed: the ingestion-key lookup, Redis (body store + queue), and the
 * metrics ingest's database-facing collaborators - service resolution,
 * pipeline rules, host enrichment, entity discovery, the metric catalog and
 * the ClickHouse writer.
 */

type AnyFunction = (...args: Array<any>) => any;

const KEY: string = "0f8fad5b-d9cb-469f-a165-70867728950e";
const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const SERVICE_NAME: string = "content-encoding-test";

// 2026-09-25T12:00:00Z and one hour earlier, as OTLP unix-nano strings.
const TIME_NANO: string = `${Date.UTC(2026, 8, 25, 12, 0, 0, 0)}000000`;
const START_NANO: string = `${Date.UTC(2026, 8, 25, 11, 0, 0, 0)}000000`;
const TIME_DB: string = "2026-09-25 12:00:00";

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

function exportRequestType(file: string, name: string): protobuf.Type {
  return protobuf.loadSync(path.join(PROTO_DIR, file)).lookupType(name);
}

const ExportMetricsServiceRequest: protobuf.Type = exportRequestType(
  "metrics_service.proto",
  "ExportMetricsServiceRequest",
);

/*
 * ---------------------------------------------------------------------------
 * Payloads, in their OTLP/JSON wire form
 * ---------------------------------------------------------------------------
 */

function resourceAttributes(): JSONObject {
  return {
    attributes: [{ key: "service.name", value: { stringValue: SERVICE_NAME } }],
  };
}

// One of each common metric kind, so a stored row proves which one it was.
const METRICS_PAYLOAD: JSONObject = {
  resourceMetrics: [
    {
      resource: resourceAttributes(),
      scopeMetrics: [
        {
          scope: { name: "content-encoding-test", version: "1.0.0" },
          metrics: [
            {
              name: "encoding.requests",
              unit: "1",
              sum: {
                aggregationTemporality: 1,
                isMonotonic: true,
                dataPoints: [
                  {
                    timeUnixNano: TIME_NANO,
                    startTimeUnixNano: START_NANO,
                    asInt: "42",
                  },
                ],
              },
            },
            {
              name: "encoding.memory.utilization",
              unit: "1",
              gauge: {
                dataPoints: [{ timeUnixNano: TIME_NANO, asDouble: 0.25 }],
              },
            },
            {
              name: "encoding.latency",
              unit: "ms",
              histogram: {
                aggregationTemporality: 2,
                dataPoints: [
                  {
                    timeUnixNano: TIME_NANO,
                    startTimeUnixNano: START_NANO,
                    count: "3",
                    sum: 6.5,
                    bucketCounts: ["1", "2"],
                    explicitBounds: [1],
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

// What processMetricsFromQueue must store for METRICS_PAYLOAD, sorted by name.
const EXPECTED_METRIC_ROWS: Array<JSONObject> = [
  {
    name: "encoding.latency",
    metricPointType: MetricPointType.Histogram,
    aggregationTemporality: AggregationTemporality.Cumulative,
    isMonotonic: null,
    count: 3,
    sum: 6.5,
    // A histogram row's value is its sum.
    value: 6.5,
    time: TIME_DB,
  },
  {
    name: "encoding.memory.utilization",
    metricPointType: MetricPointType.Gauge,
    aggregationTemporality: null,
    isMonotonic: null,
    count: null,
    sum: null,
    value: 0.25,
    time: TIME_DB,
  },
  {
    name: "encoding.requests",
    metricPointType: MetricPointType.Sum,
    aggregationTemporality: AggregationTemporality.Delta,
    isMonotonic: true,
    count: null,
    sum: null,
    value: 42,
    time: TIME_DB,
  },
];

interface SignalRoute {
  signal: "traces" | "metrics" | "logs" | "profiles";
  productType: ProductType;
  requestType: protobuf.Type;
  payload: JSONObject;
}

const SIGNAL_ROUTES: Array<SignalRoute> = [
  {
    signal: "traces",
    productType: ProductType.Traces,
    requestType: exportRequestType(
      "trace_service.proto",
      "ExportTraceServiceRequest",
    ),
    payload: {
      resourceSpans: [
        {
          resource: resourceAttributes(),
          scopeSpans: [
            {
              spans: [
                {
                  traceId: "W6jl5bW3/U0gq9xiQwq6Bw==",
                  spanId: "Hv3qsIK2yh0=",
                  name: "GET /checkout",
                  kind: 2,
                  startTimeUnixNano: START_NANO,
                  endTimeUnixNano: TIME_NANO,
                },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    signal: "metrics",
    productType: ProductType.Metrics,
    requestType: ExportMetricsServiceRequest,
    payload: METRICS_PAYLOAD,
  },
  {
    signal: "logs",
    productType: ProductType.Logs,
    requestType: exportRequestType(
      "logs_service.proto",
      "ExportLogsServiceRequest",
    ),
    payload: {
      resourceLogs: [
        {
          resource: resourceAttributes(),
          scopeLogs: [
            {
              logRecords: [
                {
                  timeUnixNano: TIME_NANO,
                  severityText: "INFO",
                  body: { stringValue: "checkout complete" },
                },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    signal: "profiles",
    productType: ProductType.Profiles,
    requestType: exportRequestType(
      "profiles_service.proto",
      "ExportProfilesServiceRequest",
    ),
    payload: {
      resourceProfiles: [
        {
          resource: resourceAttributes(),
          scopeProfiles: [{ profiles: [] }],
        },
      ],
    },
  },
];

// Both prefixes the App mounts the OTLP router on (Telemetry/Index.ts).
const PREFIXES: Array<string> = ["", "/telemetry"];

function protobufBody(route: SignalRoute): Buffer {
  return Buffer.from(
    route.requestType
      .encode(route.requestType.fromObject(route.payload))
      .finish(),
  );
}

function jsonBody(route: SignalRoute): Buffer {
  return Buffer.from(JSON.stringify(route.payload));
}

/*
 * ---------------------------------------------------------------------------
 * Content codings, produced with Node's zlib
 * ---------------------------------------------------------------------------
 */

/*
 * A zstd frame shaped like the one the OpenTelemetry Collector sends. Its
 * Go encoder (klauspost/compress, used by confighttp for `compression:
 * zstd`) was observed - otelcol-contrib 0.161.0 posting hostmetrics - to
 * emit a standard RFC 8878 frame whose descriptor is 0x64: single segment,
 * content size present, content checksum on. libzstd produces exactly that
 * shape for the same sizes once the checksum flag is set.
 */
function zstdLikeTheCollector(raw: Buffer): Buffer {
  return zlib.zstdCompressSync(raw as unknown as Uint8Array, {
    params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 },
  });
}

/*
 * The other standard frame shape: what a streaming encoder writes when it
 * does not know the total size up front - no content size in the header,
 * so the decoder cannot pre-size its output and must honour the ceiling
 * incrementally.
 */
function zstdStreamed(raw: Buffer): Buffer {
  return zlib.zstdCompressSync(raw as unknown as Uint8Array, {
    params: {
      [zlib.constants.ZSTD_c_contentSizeFlag]: 0,
      [zlib.constants.ZSTD_c_checksumFlag]: 1,
    },
  });
}

function gzip(raw: Buffer): Buffer {
  return zlib.gzipSync(raw as unknown as Uint8Array);
}

// RFC 1950: what Go's compress/zlib writes, so what the Collector sends.
function zlibWrapped(raw: Buffer): Buffer {
  return zlib.deflateSync(raw as unknown as Uint8Array);
}

// RFC 1951: what some other clients send as "deflate".
function rawDeflate(raw: Buffer): Buffer {
  return zlib.deflateRawSync(raw as unknown as Uint8Array);
}

function identity(raw: Buffer): Buffer {
  return raw;
}

interface Coding {
  label: string;
  contentEncoding: string | undefined;
  expected: OtelPayloadEncoding;
  encode: (raw: Buffer) => Buffer;
}

const ACCEPTED_CODINGS: Array<Coding> = [
  {
    label: "gzip (the otlphttp default)",
    contentEncoding: "gzip",
    expected: "gzip",
    encode: gzip,
  },
  {
    label: "x-gzip",
    contentEncoding: "x-gzip",
    expected: "gzip",
    encode: gzip,
  },
  {
    label: "gzip, mixed case and padded",
    contentEncoding: " GZip ",
    expected: "gzip",
    encode: gzip,
  },
  {
    label: "deflate, zlib-wrapped (Collector compression: deflate)",
    contentEncoding: "deflate",
    expected: "deflate",
    encode: zlibWrapped,
  },
  {
    label: "deflate, raw RFC 1951",
    contentEncoding: "deflate",
    expected: "deflate",
    encode: rawDeflate,
  },
  {
    label: "zlib (Collector compression: zlib)",
    contentEncoding: "zlib",
    expected: "deflate",
    encode: zlibWrapped,
  },
  {
    label: "zstd, the Collector's frame (Datadog's recommended config)",
    contentEncoding: "zstd",
    expected: "zstd",
    encode: zstdLikeTheCollector,
  },
  {
    label: "zstd, streamed frame without a content size",
    contentEncoding: "ZSTD",
    expected: "zstd",
    encode: zstdStreamed,
  },
  {
    label: "identity",
    contentEncoding: "identity",
    expected: "none",
    encode: identity,
  },
  {
    label: "no Content-Encoding",
    contentEncoding: undefined,
    expected: "none",
    encode: identity,
  },
];

// Codings, and stacks of codings, the worker cannot undo.
const REFUSED_CONTENT_ENCODINGS: Array<string> = [
  "snappy",
  "x-snappy-framed",
  "lz4",
  "br",
  "compress",
  "gzip, zstd",
  "zstd, gzip",
  "gzip, gzip",
  "definitely-not-a-coding",
];

/*
 * ---------------------------------------------------------------------------
 * The server, the stubs and the worker
 * ---------------------------------------------------------------------------
 */

interface HttpResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: JSONObject | null;
}

let server: http.Server;
let port: number;
let stagedBodies: Map<string, Buffer>;
let enqueuedJobs: Array<TelemetryIngestJobData>;
let storeBody: jest.SpyInstance;
let addJob: jest.SpyInstance;
let rows: Array<JSONObject>;

function post(data: {
  path: string;
  body: Buffer;
  contentType: string;
  contentEncoding: string | undefined;
}): Promise<HttpResult> {
  const headers: http.OutgoingHttpHeaders = {
    "content-type": data.contentType,
    "content-length": data.body.length,
    "x-oneuptime-token": KEY,
  };
  if (data.contentEncoding !== undefined) {
    headers["content-encoding"] = data.contentEncoding;
  }

  return new Promise<HttpResult>(
    (resolve: (result: HttpResult) => void, reject: (err: Error) => void) => {
      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: port,
          method: "POST",
          path: data.path,
          headers: headers,
        },
        (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];
          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });
          response.on("end", () => {
            const text: string = Buffer.concat(
              chunks as unknown as Array<Uint8Array>,
            ).toString("utf-8");
            let body: JSONObject | null = null;
            try {
              body = text ? (JSON.parse(text) as JSONObject) : null;
            } catch {
              body = null;
            }
            resolve({
              status: response.statusCode ?? 0,
              headers: response.headers,
              body: body,
            });
          });
        },
      );
      request.on("error", reject);
      request.end(data.body);
    },
  );
}

/*
 * Buffer.equals, not toEqual: jest compares a Buffer element by element,
 * which alone took seconds for the deflate-framing inputs below. The
 * lengths are compared too, so a mismatch still says something useful.
 */
function expectSameBytes(actual: Buffer, expected: Buffer): void {
  expect({ length: actual.length, sameBytes: actual.equals(expected) }).toEqual(
    { length: expected.length, sameBytes: true },
  );
}

function onlyJob(): TelemetryIngestJobData {
  expect(enqueuedJobs).toHaveLength(1);
  return enqueuedJobs[0]!;
}

// The decode half of ProcessTelemetry's resolveOtelBody.
async function decodeJob(job: TelemetryIngestJobData): Promise<JSONObject> {
  return await OtelPayloadDecoder.decodeFromQueue({
    productType: job.productType!,
    format: job.bodyFormat!,
    encoding: job.bodyEncoding ?? "none",
    bodyKey: job.bodyKey!,
  });
}

// ProcessTelemetry's Metrics case: decode, then the real ingest walk.
async function runMetricsWorker(job: TelemetryIngestJobData): Promise<void> {
  const body: JSONObject = await decodeJob(job);
  await OtelMetricsIngestService.processMetricsFromQueue({
    projectId: new ObjectID(job.projectId!),
    body: body,
    headers: job.requestHeaders ?? {},
  } as unknown as TelemetryRequest);
}

const ROW_FIELDS: Array<string> = [
  "name",
  "metricPointType",
  "aggregationTemporality",
  "isMonotonic",
  "value",
  "count",
  "sum",
  "time",
];

function storedRows(): Array<JSONObject> {
  return rows
    .map((row: JSONObject) => {
      const projected: JSONObject = {};
      for (const field of ROW_FIELDS) {
        if (row[field] !== undefined) {
          projected[field] = row[field]!;
        }
      }
      return projected;
    })
    .sort((a: JSONObject, b: JSONObject) => {
      return String(a["name"]).localeCompare(String(b["name"]));
    });
}

function expectNothingStoredOrQueued(): void {
  expect(storeBody).not.toHaveBeenCalled();
  expect(addJob).not.toHaveBeenCalled();
  expect(stagedBodies.size).toBe(0);
}

function policy(): TelemetryIngestionKeyPolicy {
  return {
    ingestionKeyId: ObjectID.generate(),
    projectId: PROJECT_ID,
    keyType: TelemetryIngestionKeyType.Server,
    allowedOrigins: [],
    pinnedServiceName: null,
    isEnabled: true,
    expiresAt: null,
    requestsPerMinuteLimit: null,
  };
}

function serviceMetadata(): TelemetryServiceMetadata {
  return {
    serviceName: SERVICE_NAME,
    primaryEntityId: SERVICE_ID,
    primaryEntityType: ServiceType.OpenTelemetry,
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: null,
    projectRetentionConfig: null,
    projectRetentionInDays: 15,
  };
}

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

beforeAll(async () => {
  /*
   * Importing StartServer installed the real global body parsers on this
   * app; the OTLP router is mounted behind them on the App's prefixes.
   */
  const app: ExpressApplication = Express.getExpressApp();
  app.use(["/telemetry", "/"], OTelIngestAPI);
  app.use(expressErrorHandler);

  server = http.createServer(app);
  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  stagedBodies = new Map();
  enqueuedJobs = [];
  rows = [];

  jest
    .spyOn(TelemetryIngestionKeyService, "getPolicyFromSecretKey")
    .mockImplementation(async (secretKey: string) => {
      return secretKey === KEY ? policy() : null;
    });
  jest
    .spyOn(TelemetryIngestionKeyService, "markUsed")
    .mockResolvedValue(undefined);

  storeBody = jest
    .spyOn(TelemetryBodyStore, "storeBody")
    .mockImplementation(async (buffer: Buffer) => {
      const key: string = `telemetry:body:${ObjectID.generate().toString()}`;
      stagedBodies.set(key, buffer);
      return key;
    });
  jest
    .spyOn(TelemetryBodyStore, "readBody")
    .mockImplementation(async (key: string) => {
      return stagedBodies.get(key) ?? null;
    });
  addJob = jest
    .spyOn(Queue, "addJob")
    .mockImplementation(
      async (
        _queueName: QueueName,
        _jobId: string,
        _jobName: string,
        data: JSONObject,
      ) => {
        enqueuedJobs.push(data as unknown as TelemetryIngestJobData);
        return {} as Awaited<ReturnType<typeof Queue.addJob>>;
      },
    );

  const ingest: Record<string, AnyFunction> =
    OtelMetricsIngestService as unknown as Record<string, AnyFunction>;
  jest.spyOn(ingest, "runBatchHostEnrichment").mockResolvedValue(undefined);
  for (const method of AUTO_DISCOVERY_METHODS) {
    jest.spyOn(ingest, method).mockResolvedValue(null);
  }
  jest
    .spyOn(ingest, "resolveTelemetryResource")
    .mockResolvedValue(serviceMetadata());
  jest
    .spyOn(MetricPipelineRuleService, "loadRules")
    .mockResolvedValue({ projectRules: [], rulesByServiceId: new Map() });
  jest
    .spyOn(TelemetryFanInWriter, "submit")
    .mockImplementation(
      async (_target: FanInInsertTarget, batch: Array<JSONObject>) => {
        rows.push(...batch);
        return { flushed: Promise.resolve() };
      },
    );
  jest
    .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * ---------------------------------------------------------------------------
 * The Content-Encoding contract
 * ---------------------------------------------------------------------------
 */

describe("OtelPayloadDecoder.encodingFromContentEncoding", () => {
  test.each([
    [undefined, "none"],
    ["", "none"],
    ["   ", "none"],
    ["identity", "none"],
    [" IDENTITY ", "none"],
    ["gzip", "gzip"],
    ["GZIP", "gzip"],
    [" gzip ", "gzip"],
    ["x-gzip", "gzip"],
    ["X-GZip", "gzip"],
    ["deflate", "deflate"],
    ["Deflate", "deflate"],
    ["zlib", "deflate"],
    ["zstd", "zstd"],
    ["ZStd", "zstd"],
    // "identity" is a no-op, so it does not make a stack.
    ["identity, gzip", "gzip"],
    ["zstd, identity", "zstd"],
    ["gzip,", "gzip"],
    [["gzip"], "gzip"],
    [[], "none"],
  ] as Array<[string | Array<string> | undefined, OtelPayloadEncoding]>)(
    "%p is %p",
    (
      header: string | Array<string> | undefined,
      expected: OtelPayloadEncoding,
    ) => {
      expect(OtelPayloadDecoder.encodingFromContentEncoding(header)).toBe(
        expected,
      );
    },
  );

  test.each([
    ...REFUSED_CONTENT_ENCODINGS,
    "x-compress",
    "gzip;q=1",
    // Must not resolve through Object.prototype.
    "constructor",
    "toString",
    "__proto__",
    "hasOwnProperty",
  ])("%p is refused", (header: string) => {
    expect(OtelPayloadDecoder.encodingFromContentEncoding(header)).toBeNull();
  });

  test("an array header is read in full, not by its first element", () => {
    // Node folds a repeated Content-Encoding header into "gzip, zstd".
    expect(
      OtelPayloadDecoder.encodingFromContentEncoding(["gzip", "zstd"]),
    ).toBeNull();
  });

  test("the advertised codings are gzip, deflate and zstd", () => {
    expect(SUPPORTED_OTLP_CONTENT_ENCODINGS).toEqual([
      "gzip",
      "deflate",
      "zstd",
    ]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Framing
 * ---------------------------------------------------------------------------
 */

describe("zstd framing", () => {
  test("the Collector-shaped frame is a standard RFC 8878 frame with descriptor 0x64", () => {
    const frame: Buffer = zstdLikeTheCollector(protobufBody(SIGNAL_ROUTES[1]!));

    expect(frame.subarray(0, 4).toString("hex")).toBe("28b52ffd");
    /*
     * Frame_Header_Descriptor 0x64 = FCS flag 1 (2-byte content size),
     * Single_Segment 1, Content_Checksum 1, no dictionary id - the byte
     * otelcol-contrib 0.161.0 put on the wire for a body in the same
     * 256 B - 64 KiB content-size class (its was 1776 bytes).
     */
    expect(frame[4]).toBe(0x64);
  });

  test("the streamed frame carries no content size", () => {
    const frame: Buffer = zstdStreamed(protobufBody(SIGNAL_ROUTES[1]!));

    expect(frame.subarray(0, 4).toString("hex")).toBe("28b52ffd");
    // FCS flag 0 and Single_Segment 0: the size is unknown to the decoder.
    expect(frame[4]! >> 5).toBe(0);
    expect((frame[4]! >> 2) & 1).toBe(1);
  });
});

describe("deflate framing: zlib-wrapped and raw are both decoded", () => {
  const inputs: Array<[string, Buffer]> = [
    ["empty", Buffer.alloc(0)],
    ["one byte", Buffer.from("x")],
    ["an OTLP body", protobufBody(SIGNAL_ROUTES[1]!)],
    // Over one stored block, so level 0 writes a NON-final stored block first.
    [
      "70 KB, over one stored block",
      Buffer.from(ObjectID.generate().toString().repeat(2000)),
    ],
  ];

  test.each(inputs)(
    "%s, at every compression level",
    async (_label: string, input: Buffer) => {
      for (let level: number = 0; level <= 9; level++) {
        const wrapped: Buffer = zlib.deflateSync(
          input as unknown as Uint8Array,
          { level },
        );
        const raw: Buffer = zlib.deflateRawSync(
          input as unknown as Uint8Array,
          { level },
        );

        expectSameBytes(
          await OtelPayloadDecoder.decompress(wrapped, "deflate"),
          input,
        );
        expectSameBytes(
          await OtelPayloadDecoder.decompress(raw, "deflate"),
          input,
        );
      }
    },
  );
});

/*
 * ---------------------------------------------------------------------------
 * The decompression ceiling, per coding
 * ---------------------------------------------------------------------------
 */

describe("the decompression ceiling holds for every coding", () => {
  const BOMB_CODINGS: Array<
    [string, OtelPayloadEncoding, (raw: Buffer) => Buffer]
  > = [
    ["gzip", "gzip", gzip],
    ["deflate, zlib-wrapped", "deflate", zlibWrapped],
    ["deflate, raw", "deflate", rawDeflate],
    ["zstd, Collector frame", "zstd", zstdLikeTheCollector],
    ["zstd, streamed frame", "zstd", zstdStreamed],
  ];

  test.each(BOMB_CODINGS)(
    "%s: one byte over the ceiling is refused, exactly at it is inflated",
    async (
      _label: string,
      encoding: OtelPayloadEncoding,
      encode: (raw: Buffer) => Buffer,
    ) => {
      const bomb: Buffer = encode(
        Buffer.alloc(MAX_DECOMPRESSED_OTLP_BODY_BYTES + 1),
      );
      // Small on the wire: well under nginx's 4 MiB, let alone the 50 MiB cap.
      expect(bomb.length).toBeLessThan(MAX_DECOMPRESSED_OTLP_BODY_BYTES / 500);

      await expect(
        OtelPayloadDecoder.decompress(bomb, encoding),
      ).rejects.toMatchObject({ code: "ERR_BUFFER_TOO_LARGE" });

      const atCeiling: Buffer = await OtelPayloadDecoder.decompress(
        encode(Buffer.alloc(MAX_DECOMPRESSED_OTLP_BODY_BYTES)),
        encoding,
      );
      expect(atCeiling.length).toBe(MAX_DECOMPRESSED_OTLP_BODY_BYTES);
    },
    60_000,
  );

  test.each([
    ["deflate", "deflate", zlibWrapped],
    ["zstd", "zstd", zstdLikeTheCollector],
    ["gzip", "gzip", gzip],
  ] as Array<[string, OtelPayloadEncoding, (raw: Buffer) => Buffer]>)(
    "%s: a bomb admitted over HTTP is refused by the worker and stores nothing",
    async (
      contentEncoding: string,
      encoding: OtelPayloadEncoding,
      encode: (raw: Buffer) => Buffer,
    ) => {
      const result: HttpResult = await post({
        path: "/otlp/v1/metrics",
        body: encode(Buffer.alloc(MAX_DECOMPRESSED_OTLP_BODY_BYTES + 1)),
        contentType: "application/x-protobuf",
        contentEncoding: contentEncoding,
      });

      // The wire body is legitimate-sized; only the worker can see the bomb.
      expect(result.status).toBe(200);
      const job: TelemetryIngestJobData = onlyJob();
      expect(job.bodyEncoding).toBe(encoding);

      await expect(runMetricsWorker(job)).rejects.toMatchObject({
        code: "ERR_BUFFER_TOO_LARGE",
      });
      expect(rows).toHaveLength(0);
    },
    60_000,
  );
});

/*
 * maxOutputLength caps what zstd writes, not the history window it keeps
 * while writing it, and a zstd frame names its own window: libzstd would
 * allocate up to 128 MiB for one by default, on top of the capped output.
 * MAX_ZSTD_WINDOW_LOG caps that at 16 MiB, twice RFC 9659's 8 MB limit for
 * the "zstd" HTTP content coding.
 */
describe("zstd: the decoder's window is capped as well as its output", () => {
  const WINDOW_TOO_LARGE: string = "ZSTD_error_frameParameter_windowTooLarge";

  // A streamed frame (no content size) whose header declares 2^windowLog.
  function zstdWithWindow(raw: Buffer, windowLog: number): Buffer {
    return zlib.zstdCompressSync(raw as unknown as Uint8Array, {
      params: {
        [zlib.constants.ZSTD_c_windowLog]: windowLog,
        [zlib.constants.ZSTD_c_contentSizeFlag]: 0,
      },
    });
  }

  // RFC 8878 Window_Descriptor, the byte after a no-dictionary descriptor.
  function declaredWindowLog(frame: Buffer): number {
    expect((frame[4]! >> 5) & 1).toBe(0);
    expect(frame[5]! & 0x07).toBe(0);
    return 10 + (frame[5]! >> 3);
  }

  // 40 MiB that repeats every 1 MiB: under the output ceiling on purpose.
  let large: Buffer;
  beforeAll(() => {
    large = Buffer.from(
      crypto
        .randomBytes(512 * 1024)
        .toString("hex")
        .repeat(40),
    );
  });

  test.each([
    ["8 MiB (RFC 9659's limit, and the Collector's own window)", 23],
    ["16 MiB (the cap itself)", 24],
  ])(
    "a window of %s still decodes",
    async (_label: string, windowLog: number) => {
      const frame: Buffer = zstdWithWindow(large, windowLog);
      expect(declaredWindowLog(frame)).toBe(windowLog);

      expectSameBytes(
        await OtelPayloadDecoder.decompress(frame, "zstd"),
        large,
      );
    },
    60_000,
  );

  test("a 32 MiB window is refused on its header, though its output would fit", async () => {
    const frame: Buffer = zstdWithWindow(large, MAX_ZSTD_WINDOW_LOG + 1);
    expect(declaredWindowLog(frame)).toBe(25);
    expect(large.length).toBeLessThan(MAX_DECOMPRESSED_OTLP_BODY_BYTES);

    await expect(
      OtelPayloadDecoder.decompress(frame, "zstd"),
    ).rejects.toMatchObject({ code: WINDOW_TOO_LARGE });
  }, 60_000);

  test("a bomb declaring libzstd's default 128 MiB window is refused before it inflates anything", async () => {
    const bomb: Buffer = zstdWithWindow(
      Buffer.alloc(MAX_DECOMPRESSED_OTLP_BODY_BYTES + 1),
      27,
    );
    expect(declaredWindowLog(bomb)).toBe(27);
    expect(bomb.length).toBeLessThan(4096);

    /*
     * The window check, not the output cap (ERR_BUFFER_TOO_LARGE): without
     * it this decode would hold the 64 MiB of output plus up to another
     * 64 MiB of window before failing.
     */
    await expect(
      OtelPayloadDecoder.decompress(bomb, "zstd"),
    ).rejects.toMatchObject({ code: WINDOW_TOO_LARGE });
  }, 60_000);

  test("a single-segment frame's window is its content size: 16 MiB decodes, one byte more is refused", async () => {
    function singleSegment(size: number): Buffer {
      const frame: Buffer = zlib.zstdCompressSync(
        Buffer.alloc(size, 0x61) as unknown as Uint8Array,
        { params: { [zlib.constants.ZSTD_c_windowLog]: 25 } },
      );
      // Single_Segment set: no Window_Descriptor, the content size stands in.
      expect((frame[4]! >> 5) & 1).toBe(1);
      return frame;
    }

    const atCap: Buffer = await OtelPayloadDecoder.decompress(
      singleSegment(2 ** MAX_ZSTD_WINDOW_LOG),
      "zstd",
    );
    expect(atCap.length).toBe(2 ** MAX_ZSTD_WINDOW_LOG);

    await expect(
      OtelPayloadDecoder.decompress(
        singleSegment(2 ** MAX_ZSTD_WINDOW_LOG + 1),
        "zstd",
      ),
    ).rejects.toMatchObject({ code: WINDOW_TOO_LARGE });
  }, 60_000);

  test("a window bomb admitted over HTTP is refused by the worker and stores nothing", async () => {
    const result: HttpResult = await post({
      path: "/otlp/v1/metrics",
      body: zstdWithWindow(
        Buffer.alloc(MAX_DECOMPRESSED_OTLP_BODY_BYTES + 1),
        27,
      ),
      contentType: "application/x-protobuf",
      contentEncoding: "zstd",
    });

    expect(result.status).toBe(200);
    const job: TelemetryIngestJobData = onlyJob();
    expect(job.bodyEncoding).toBe("zstd");

    await expect(runMetricsWorker(job)).rejects.toMatchObject({
      code: WINDOW_TOO_LARGE,
    });
    expect(rows).toHaveLength(0);
  }, 60_000);
});

/*
 * ---------------------------------------------------------------------------
 * OTLP/HTTP: accepted codings, end to end
 * ---------------------------------------------------------------------------
 */

describe("OTLP/HTTP metrics: every accepted coding lands the same rows", () => {
  const FORMATS: Array<{
    label: string;
    contentType: string;
    format: OtelPayloadFormat;
    body: () => Buffer;
  }> = [
    {
      label: "protobuf",
      contentType: "application/x-protobuf",
      format: OtelPayloadFormat.Protobuf,
      body: () => {
        return protobufBody(SIGNAL_ROUTES[1]!);
      },
    },
    {
      label: "JSON",
      contentType: "application/json",
      format: OtelPayloadFormat.Json,
      body: () => {
        return jsonBody(SIGNAL_ROUTES[1]!);
      },
    },
  ];

  const CASES: Array<{
    label: string;
    prefix: string;
    coding: Coding;
    format: (typeof FORMATS)[number];
  }> = [];
  for (const coding of ACCEPTED_CODINGS) {
    for (const format of FORMATS) {
      for (const prefix of PREFIXES) {
        CASES.push({
          label: `${coding.label}, ${format.label}, ${prefix}/otlp`,
          prefix,
          coding,
          format,
        });
      }
    }
  }

  test.each(CASES)("$label", async (testCase: (typeof CASES)[number]) => {
    const wireBody: Buffer = testCase.coding.encode(testCase.format.body());

    const result: HttpResult = await post({
      path: `${testCase.prefix}/otlp/v1/metrics`,
      body: wireBody,
      contentType: testCase.format.contentType,
      contentEncoding: testCase.coding.contentEncoding,
    });

    expect(result.status).toBe(200);

    // Admission stores the bytes exactly as sent, and defers the inflate.
    expect(storeBody).toHaveBeenCalledTimes(1);
    expectSameBytes(storeBody.mock.calls[0]![0], wireBody);

    const job: TelemetryIngestJobData = onlyJob();
    expect(job.type).toBe(TelemetryType.Metrics);
    expect(job.productType).toBe(ProductType.Metrics);
    expect(job.bodyFormat).toBe(testCase.format.format);
    expect(job.bodyEncoding).toBe(testCase.coding.expected);

    await runMetricsWorker(job);

    expect(storedRows()).toEqual(EXPECTED_METRIC_ROWS);
  });
});

describe("OTLP/HTTP: zstd is admitted and decoded on every signal route", () => {
  const CASES: Array<{ label: string; prefix: string; route: SignalRoute }> =
    [];
  for (const route of SIGNAL_ROUTES) {
    for (const prefix of PREFIXES) {
      CASES.push({ label: `${prefix}/otlp/v1/${route.signal}`, prefix, route });
    }
  }

  test.each(CASES)("$label", async (testCase: (typeof CASES)[number]) => {
    const plain: Buffer = protobufBody(testCase.route);

    const result: HttpResult = await post({
      path: `${testCase.prefix}/otlp/v1/${testCase.route.signal}`,
      body: zstdLikeTheCollector(plain),
      contentType: "application/x-protobuf",
      contentEncoding: "zstd",
    });

    expect(result.status).toBe(200);
    const job: TelemetryIngestJobData = onlyJob();
    expect(job.productType).toBe(testCase.route.productType);
    expect(job.bodyEncoding).toBe("zstd");

    // The worker sees exactly what it would have for an uncompressed body.
    expect(await decodeJob(job)).toEqual(
      testCase.route.requestType.decode(plain).toJSON(),
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * OTLP/HTTP: refused codings
 * ---------------------------------------------------------------------------
 */

describe("OTLP/HTTP: an unsupported coding is a 415 and nothing is stored or queued", () => {
  const CASES: Array<{
    label: string;
    path: string;
    contentEncoding: string;
    body: Buffer;
  }> = [];
  for (const route of SIGNAL_ROUTES) {
    for (const prefix of PREFIXES) {
      for (const contentEncoding of REFUSED_CONTENT_ENCODINGS) {
        CASES.push({
          label: `${prefix}/otlp/v1/${route.signal} with "${contentEncoding}"`,
          path: `${prefix}/otlp/v1/${route.signal}`,
          contentEncoding,
          body: protobufBody(route),
        });
      }
    }
  }

  test.each(CASES)("$label", async (testCase: (typeof CASES)[number]) => {
    const result: HttpResult = await post({
      path: testCase.path,
      body: testCase.body,
      contentType: "application/x-protobuf",
      contentEncoding: testCase.contentEncoding,
    });

    expect(result.status).toBe(415);
    // RFC 9110 section 15.5.16: say which codings would have been accepted.
    expect(result.headers["accept-encoding"]).toBe("gzip, deflate, zstd");
    expect(result.body).toEqual({
      error: "unsupported-content-encoding",
      message: `Unsupported Content-Encoding "${testCase.contentEncoding}". OTLP/HTTP request bodies must be uncompressed or compressed with exactly one of: gzip, deflate, zstd. Set the exporter's compression to one of these.`,
    });

    expectNothingStoredOrQueued();
  });

  test("a JSON body is refused the same way", async () => {
    const result: HttpResult = await post({
      path: "/otlp/v1/metrics",
      body: jsonBody(SIGNAL_ROUTES[1]!),
      contentType: "application/json",
      contentEncoding: "snappy",
    });

    expect(result.status).toBe(415);
    expectNothingStoredOrQueued();
  });

  test("the refusal is answered before the body is read: it arrives while the upload is still in flight", async () => {
    /*
     * Declare 8 MiB, send the headers and a first 64 KiB, and never send
     * the rest. A parseBody that read the body before judging its coding
     * would still be waiting for its "end", and this would time out.
     */
    const request: http.ClientRequest = http.request({
      host: "127.0.0.1",
      port: port,
      method: "POST",
      path: "/telemetry/otlp/v1/logs",
      headers: {
        "content-type": "application/x-protobuf",
        "content-length": 8 * 1024 * 1024,
        "content-encoding": "br",
        "x-oneuptime-token": KEY,
      },
    });
    // Destroying the socket mid-upload, below, raises one on the client.
    request.on("error", () => {});

    const responded: Promise<HttpResult> = new Promise<HttpResult>(
      (resolve: (result: HttpResult) => void) => {
        request.on("response", (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];
          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });
          response.on("end", () => {
            resolve({
              status: response.statusCode ?? 0,
              headers: response.headers,
              body: JSON.parse(
                Buffer.concat(chunks as unknown as Array<Uint8Array>).toString(
                  "utf-8",
                ),
              ) as JSONObject,
            });
          });
        });
      },
    );

    let timer: NodeJS.Timeout | undefined;
    const timedOut: Promise<HttpResult> = new Promise<HttpResult>(
      (_resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
        timer = setTimeout(() => {
          reject(new Error("no response while the request body was in flight"));
        }, 10_000);
      },
    );

    request.write(Buffer.alloc(64 * 1024, 0x61));

    let result: HttpResult;
    try {
      result = await Promise.race([responded, timedOut]);
    } finally {
      clearTimeout(timer);
      // Only now is the upload abandoned: it was still open when answered.
      expect(request.writableEnded).toBe(false);
      request.destroy();
    }

    expect(result.status).toBe(415);
    expect(result.headers["accept-encoding"]).toBe("gzip, deflate, zstd");
    expect(result.body?.["error"]).toBe("unsupported-content-encoding");
    expectNothingStoredOrQueued();

    // The server is still healthy for the next, well-formed request.
    const next: HttpResult = await post({
      path: "/telemetry/otlp/v1/metrics",
      body: gzip(protobufBody(SIGNAL_ROUTES[1]!)),
      contentType: "application/x-protobuf",
      contentEncoding: "gzip",
    });
    expect(next.status).toBe(200);
  });

  test("a body something upstream already read is refused too, not waved through", async () => {
    /*
     * These routes bypass the global parsers, so over HTTP req.body is never
     * set here. But were it set, parseBody's already-parsed early-out must
     * not skip the check: the queue takes the job's bodyEncoding from the
     * same header, whoever read the body.
     */
    const headers: Record<string, string> = {};
    const res: {
      statusCode: number;
      headersSent: boolean;
      setHeader: (name: string, value: string) => void;
      status: (code: number) => typeof res;
      json: (body: unknown) => typeof res;
    } = {
      statusCode: 0,
      headersSent: false,
      setHeader: (name: string, value: string): void => {
        headers[name.toLowerCase()] = value;
      },
      status: (code: number): typeof res => {
        res.statusCode = code;
        return res;
      },
      json: (): typeof res => {
        res.headersSent = true;
        return res;
      },
    };
    const next: jest.Mock = jest.fn();

    await OpenTelemetryRequestMiddleware.parseBody(
      {
        headers: { "content-encoding": "br" },
        body: Buffer.from("already read"),
        resume: jest.fn(),
      } as unknown as ExpressRequest,
      res as unknown as ExpressResponse,
      next as unknown as NextFunction,
    );

    expect(res.statusCode).toBe(415);
    expect(headers["accept-encoding"]).toBe("gzip, deflate, zstd");
    expect(next).not.toHaveBeenCalled();
  });
});

/*
 * ---------------------------------------------------------------------------
 * The queue producer's backstop
 * ---------------------------------------------------------------------------
 */

describe("TelemetryQueueService: the admission backstop", () => {
  function rawRequest(
    contentEncoding: string,
    body: unknown,
  ): TelemetryRequest {
    return {
      projectId: PROJECT_ID,
      productType: ProductType.Metrics,
      headers: {
        "content-type": "application/x-protobuf",
        "content-encoding": contentEncoding,
      },
      body: body,
    } as unknown as TelemetryRequest;
  }

  test.each([
    TelemetryType.Traces,
    TelemetryType.Metrics,
    TelemetryType.Logs,
    TelemetryType.Profiles,
  ])(
    "a raw %s body with an unsupported coding is refused before it is stored",
    async (type: TelemetryType) => {
      await expect(
        TelemetryQueueService.addTelemetryIngestJob(
          rawRequest("snappy", Buffer.from("not decodable")),
          type,
        ),
      ).rejects.toThrow(/unsupported Content-Encoding/);

      expectNothingStoredOrQueued();
    },
  );

  test("a parsed-object body (gRPC, Pyroscope, MQTT) is not judged by the request's header", async () => {
    await TelemetryQueueService.addTelemetryIngestJob(
      rawRequest("snappy", { resourceMetrics: [] }),
      TelemetryType.Metrics,
    );

    const job: TelemetryIngestJobData = onlyJob();
    expect(job.bodyFormat).toBe(OtelPayloadFormat.Json);
    expect(job.bodyEncoding).toBe("none");
  });

  test("a non-OTel raw body keeps being queued (its worker never decodes a stored body)", async () => {
    await TelemetryQueueService.addTelemetryIngestJob(
      rawRequest("snappy", Buffer.from("<14>fluent line")),
      TelemetryType.FluentLogs,
    );

    expect(addJob).toHaveBeenCalledTimes(1);
  });
});

/*
 * ---------------------------------------------------------------------------
 * A runtime without zstd
 * ---------------------------------------------------------------------------
 */

describe("a Node runtime whose zlib has no zstd", () => {
  test("refuses zstd at admission instead of queueing what it cannot decode", async () => {
    let decoderModule:
      | typeof import("../../FeatureSet/Telemetry/Utils/OtelPayloadDecoder")
      | undefined;

    jest.isolateModules(() => {
      jest.doMock("zlib", () => {
        const actual: typeof zlib = jest.requireActual("zlib");
        return { ...actual, zstdDecompress: undefined };
      });
      /*
       * Importing must not throw (promisify(undefined) would). A require,
       * because only a load inside isolateModules sees the mocked zlib.
       */
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      decoderModule = require("../../FeatureSet/Telemetry/Utils/OtelPayloadDecoder");
    });
    jest.dontMock("zlib");

    const decoder: typeof OtelPayloadDecoder = decoderModule!.default;

    expect(decoder.encodingFromContentEncoding("zstd")).toBeNull();
    expect(decoder.encodingFromContentEncoding("gzip")).toBe("gzip");
    expect(decoderModule!.SUPPORTED_OTLP_CONTENT_ENCODINGS).toEqual([
      "gzip",
      "deflate",
    ]);
    await expect(
      decoder.decompress(zstdLikeTheCollector(Buffer.from("x")), "zstd"),
    ).rejects.toThrow(/no zlib.zstdDecompress/);
  });
});
