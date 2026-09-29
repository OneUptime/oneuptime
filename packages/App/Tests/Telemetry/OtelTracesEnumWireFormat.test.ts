import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "path";
import protobuf from "protobufjs";
import { Readable } from "stream";
import {
  OTLP_PROTO_LOADER_OPTIONS,
  handleExport,
} from "../../FeatureSet/Telemetry/GrpcServer";
import OpenTelemetryRequestMiddleware from "../../FeatureSet/Telemetry/Middleware/OtelRequestMiddleware";
import LlmModelPriceService from "../../FeatureSet/Telemetry/Services/LlmModelPriceService";
import OtelTracesIngestService from "../../FeatureSet/Telemetry/Services/OtelTracesIngestService";
import TraceDropFilterService from "../../FeatureSet/Telemetry/Services/TraceDropFilterService";
import TracePipelineService from "../../FeatureSet/Telemetry/Services/TracePipelineService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import TracesQueueService from "../../FeatureSet/Telemetry/Services/Queue/TracesQueueService";
import { TelemetryIngestJobData } from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import ExceptionUtil, {
  TelemetryExceptionPayload,
} from "../../FeatureSet/Telemetry/Utils/Exception";
import OtelPayloadDecoder, {
  OtelPayloadFormat,
} from "../../FeatureSet/Telemetry/Utils/OtelPayloadDecoder";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import SpanService from "Common/Server/Services/SpanService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import TelemetryFanInWriter, {
  FanInInsertTarget,
} from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import { SpanKind, SpanStatus } from "Common/Models/AnalyticsModels/Span";
import { JSONArray, JSONObject, JSONValue } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import TelemetryIngestionKeyPolicy from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import ServiceType from "Common/Types/Telemetry/ServiceType";

/*
 * GH#3978 found two enums - metric aggregation temporality and log severity -
 * that ingest read correctly in one OTLP encoding and not another: OTLP/JSON
 * sends enums as integers, while protobuf bodies (protobufjs `.toJSON()`) and
 * gRPC requests (@grpc/proto-loader, enums: String) reach the worker as enum
 * NAMES. This suite pins the trace path's enums - Span.kind and
 * Status.code - and the span's events and links to the same stored row
 * whichever way the span was encoded: protobuf over OTLP/HTTP, OTLP/JSON over
 * OTLP/HTTP, and gRPC through the Export deserializer built with GrpcServer's
 * own options and the real handleExport. Only the persistence edges are
 * replaced (Redis, ClickHouse, Postgres, the ingestion-key lookup).
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

const mockStoredBodies: Map<string, Buffer> = new Map();

jest.mock("../../FeatureSet/Telemetry/Utils/TelemetryBodyStore", () => {
  return {
    __esModule: true,
    default: {
      storeBody: (body: Buffer): Promise<string> => {
        const key: string = `telemetry:body:traces-${mockStoredBodies.size + 1}`;
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
const INGESTION_TOKEN: string = "traces-enum-wire-format-token";

const START_TIME_UNIX_NANO: string = "1700000000000000000";
const END_TIME_UNIX_NANO: string = "1700000000250000000";
const EVENT_TIME_UNIX_NANO: string = "1700000000100000000";

const TRACE_ID_HEX: string = "5b8efff798038103d269b633813fc60c";
const LINKED_TRACE_ID_HEX: string = "4bf92f3577b34da6a3ce929d0e0e4736";
const LINKED_SPAN_ID_HEX: string = "00f067aa0ba902b7";

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
 * Span.SpanKind and Status.StatusCode as trace.proto defines them. The spec
 * lets a receiver treat SPAN_KIND_UNSPECIFIED as INTERNAL, which ingest does.
 */
interface KindCase {
  wire: number;
  name: string;
  stored: SpanKind;
}

const KIND_CASES: Array<KindCase> = [
  { wire: 0, name: "SPAN_KIND_UNSPECIFIED", stored: SpanKind.Internal },
  { wire: 1, name: "SPAN_KIND_INTERNAL", stored: SpanKind.Internal },
  { wire: 2, name: "SPAN_KIND_SERVER", stored: SpanKind.Server },
  { wire: 3, name: "SPAN_KIND_CLIENT", stored: SpanKind.Client },
  { wire: 4, name: "SPAN_KIND_PRODUCER", stored: SpanKind.Producer },
  { wire: 5, name: "SPAN_KIND_CONSUMER", stored: SpanKind.Consumer },
];

interface StatusCase {
  wire: number;
  name: string;
  stored: SpanStatus;
}

const STATUS_CASES: Array<StatusCase> = [
  { wire: 0, name: "STATUS_CODE_UNSET", stored: SpanStatus.Unset },
  { wire: 1, name: "STATUS_CODE_OK", stored: SpanStatus.Ok },
  { wire: 2, name: "STATUS_CODE_ERROR", stored: SpanStatus.Error },
];

// Every kind with every status: 18 spans, each with a unique span id.
interface SpanCase {
  kind: KindCase;
  status: StatusCase;
  spanIdHex: string;
}

const SPAN_CASES: Array<SpanCase> = [];
for (const kind of KIND_CASES) {
  for (const status of STATUS_CASES) {
    SPAN_CASES.push({
      kind,
      status,
      spanIdHex: `${kind.wire}${status.wire}`.padStart(16, "a"),
    });
  }
}

/*
 * The request as canonical OTLP/JSON: enums as integers, ids as hex, 64-bit
 * integers as decimal strings. Each span carries an exception event and a
 * link, so the nested repeated messages are exercised too. `elideEnums` leaves
 * `kind` and `status` out entirely, the way a Go encoder writes a span whose
 * kind is UNSPECIFIED and whose status is UNSET.
 */
function otlpJsonRequest(options: { elideEnums: boolean }): JSONObject {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: SERVICE_NAME } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: "checkout-api.instrumentation" },
            spans: SPAN_CASES.map((spanCase: SpanCase) => {
              return {
                traceId: TRACE_ID_HEX,
                spanId: spanCase.spanIdHex,
                name: `span ${spanCase.kind.name} ${spanCase.status.name}`,
                ...(options.elideEnums ? {} : { kind: spanCase.kind.wire }),
                startTimeUnixNano: START_TIME_UNIX_NANO,
                endTimeUnixNano: END_TIME_UNIX_NANO,
                events: [
                  {
                    timeUnixNano: EVENT_TIME_UNIX_NANO,
                    name: "exception",
                    attributes: [
                      {
                        key: "exception.type",
                        value: { stringValue: "TimeoutError" },
                      },
                      {
                        key: "exception.message",
                        value: {
                          stringValue: `timed out in ${spanCase.spanIdHex}`,
                        },
                      },
                    ],
                  },
                ],
                links: [
                  {
                    traceId: LINKED_TRACE_ID_HEX,
                    spanId: LINKED_SPAN_ID_HEX,
                    attributes: [
                      {
                        key: "link.reason",
                        value: { stringValue: "retry-of" },
                      },
                    ],
                  },
                ],
                ...(options.elideEnums
                  ? {}
                  : {
                      status: {
                        code: spanCase.status.wire,
                        message: `status ${spanCase.status.wire}`,
                      },
                    }),
              };
            }),
          },
        ],
      },
    ],
  };
}

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

const ExportTraceServiceRequestType: protobuf.Type = protobuf
  .loadSync(path.join(PROTO_DIR, "trace_service.proto"))
  .lookupType(
    "opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest",
  );

// OTLP/JSON ids are hex; protobufjs' fromObject would read them as base64.
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
  const message: protobuf.Message = ExportTraceServiceRequestType.fromObject(
    withBinaryIds(request) as Record<string, unknown>,
  );
  return Buffer.from(ExportTraceServiceRequestType.encode(message).finish());
}

type GrpcExportMethod = protoLoader.MethodDefinition<
  Record<string, unknown>,
  Record<string, unknown>
>;

function loadGrpcExportMethod(): GrpcExportMethod {
  const includeDir: string = (
    OTLP_PROTO_LOADER_OPTIONS.includeDirs as Array<string>
  )[0]!;
  const definition: protoLoader.PackageDefinition = protoLoader.loadSync(
    path.join(includeDir, "trace_service.proto"),
    OTLP_PROTO_LOADER_OPTIONS,
  );
  const service: protoLoader.ServiceDefinition = definition[
    "opentelemetry.proto.collector.trace.v1.TraceService"
  ] as protoLoader.ServiceDefinition;
  return service["Export"] as unknown as GrpcExportMethod;
}

const GRPC_EXPORT: GrpcExportMethod = loadGrpcExportMethod();

/*
 * ---------------------------------------------------------------------------
 * Harness: the persistence edges of the traces ingest.
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
  "autoDiscoverHost",
  "autoDiscoverServerless",
  "autoDiscoverCloudResource",
  "autoDiscoverRum",
  "autoDiscoverDatabaseServer",
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IngestTestMethods = Record<string, any>;

let spanRows: Array<JSONObject>;
let exceptionRows: Array<JSONObject>;

beforeEach(() => {
  spanRows = [];
  exceptionRows = [];
  mockEnqueuedJobs.length = 0;
  mockStoredBodies.clear();

  const ingest: IngestTestMethods =
    OtelTracesIngestService as unknown as IngestTestMethods;
  for (const method of AUTO_DISCOVERY_METHODS) {
    jest.spyOn(ingest, method).mockResolvedValue(null);
  }
  jest.spyOn(ingest, "resolveTelemetryResource").mockResolvedValue({
    serviceName: SERVICE_NAME,
    primaryEntityId: new ObjectID(SERVICE_ID.toString()),
    primaryEntityType: ServiceType.OpenTelemetry,
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: null,
    projectRetentionConfig: null,
    projectRetentionInDays: 15,
  });
  jest.spyOn(TraceDropFilterService, "loadDropFilters").mockResolvedValue([]);
  jest.spyOn(TraceScrubRuleService, "loadScrubRules").mockResolvedValue([]);
  jest.spyOn(TracePipelineService, "loadPipelines").mockResolvedValue([]);
  jest.spyOn(LlmModelPriceService, "loadModelPrices").mockResolvedValue([]);
  jest
    .spyOn(TelemetryFanInWriter, "submit")
    .mockImplementation(
      async (target: FanInInsertTarget, batch: Array<JSONObject>) => {
        if (target === SpanService) {
          spanRows.push(...batch);
        } else if (target === ExceptionInstanceService) {
          exceptionRows.push(...batch);
        } else {
          throw new Error(`unexpected fan-in target ${target.model.tableName}`);
        }
        return { flushed: Promise.resolve() };
      },
    );
  jest
    .spyOn(ExceptionUtil, "saveOrUpdateTelemetryExceptionsBatch")
    .mockImplementation(
      async (_payloads: Array<TelemetryExceptionPayload>): Promise<void> => {
        return undefined;
      },
    );
  jest.spyOn(TelemetryIngestionDisabled, "isDisabled").mockReturnValue(false);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function onlyEnqueuedJob(): TelemetryIngestJobData {
  expect(mockEnqueuedJobs).toHaveLength(1);
  return JSON.parse(
    JSON.stringify(mockEnqueuedJobs[0]),
  ) as TelemetryIngestJobData;
}

async function decodeJob(job: TelemetryIngestJobData): Promise<JSONObject> {
  expect(job.productType).toBe(ProductType.Traces);
  return OtelPayloadDecoder.decodeFromQueue({
    productType: job.productType!,
    format: job.bodyFormat!,
    encoding: job.bodyEncoding ?? "none",
    bodyKey: job.bodyKey!,
  });
}

async function ingestDecodedBody(body: JSONObject): Promise<void> {
  await OtelTracesIngestService.processTracesFromQueue({
    projectId: new ObjectID(PROJECT_ID.toString()),
    body,
    headers: {},
  } as unknown as ExpressRequest);
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
  expect(next).toHaveBeenCalledWith();
}

async function postOverHttp(
  bytes: Buffer,
  contentType: string,
): Promise<TelemetryIngestJobData> {
  const req: ExpressRequest = Object.assign(Readable.from([bytes]), {
    url: "/otlp/v1/traces",
    baseUrl: "",
    headers: { "content-type": contentType },
    projectId: PROJECT_ID,
  }) as unknown as ExpressRequest;
  const res: ExpressResponse = {
    status: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  await runMiddleware(OpenTelemetryRequestMiddleware.parseBody, req, res);
  await runMiddleware(OpenTelemetryRequestMiddleware.getProductType, req, res);
  expect((req as TelemetryRequest).productType).toBe(ProductType.Traces);

  const next: jest.Mock = jest.fn();
  await OtelTracesIngestService.ingestTraces(
    req,
    res,
    next as unknown as NextFunction,
  );
  expect(next).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(200);

  return onlyEnqueuedJob();
}

async function exportViaGrpcHandler(
  bytes: Buffer,
): Promise<TelemetryIngestJobData> {
  const request: Record<string, unknown> =
    GRPC_EXPORT.requestDeserialize(bytes);
  const metadata: grpc.Metadata = new grpc.Metadata();
  metadata.set("x-oneuptime-token", INGESTION_TOKEN);

  const error: grpc.ServiceError | null = await new Promise(
    (resolve: (value: grpc.ServiceError | null) => void) => {
      void handleExport(
        { request, metadata },
        (replyError: grpc.ServiceError | null) => {
          resolve(replyError);
        },
        ProductType.Traces,
        TracesQueueService.addTraceIngestJob.bind(TracesQueueService),
      );
    },
  );

  expect(error).toBeNull();
  const job: TelemetryIngestJobData = onlyEnqueuedJob();
  expect(job.bodyFormat).toBe(OtelPayloadFormat.Json);
  return job;
}

interface Route {
  label: string;
  decode: (request: JSONObject) => Promise<JSONObject>;
  // How this decoder spells an enum: its name, or the wire integer.
  spellsEnumsByName: boolean;
}

const ROUTES: Array<Route> = [
  {
    label: "HTTP protobuf (protobufjs .toJSON())",
    decode: async (request: JSONObject): Promise<JSONObject> => {
      return decodeJob(
        await postOverHttp(encodeProtobuf(request), "application/x-protobuf"),
      );
    },
    spellsEnumsByName: true,
  },
  {
    label: "HTTP OTLP/JSON (JSON.parse)",
    decode: async (request: JSONObject): Promise<JSONObject> => {
      return decodeJob(
        await postOverHttp(
          Buffer.from(JSON.stringify(request), "utf-8"),
          "application/json",
        ),
      );
    },
    spellsEnumsByName: false,
  },
  {
    label: "gRPC (proto-loader with GrpcServer's options, handleExport)",
    decode: async (request: JSONObject): Promise<JSONObject> => {
      return decodeJob(await exportViaGrpcHandler(encodeProtobuf(request)));
    },
    spellsEnumsByName: true,
  },
];

function decodedSpans(body: JSONObject): JSONArray {
  return (
    (body["resourceSpans"] as JSONArray)[0]!["scopeSpans"] as JSONArray
  )[0]!["spans"] as JSONArray;
}

function spanRowsById(): Map<string, JSONObject> {
  const byId: Map<string, JSONObject> = new Map();
  for (const row of spanRows) {
    byId.set(row["spanId"] as string, row);
  }
  expect(byId.size).toBe(SPAN_CASES.length);
  return byId;
}

function expectEventsAndLinks(row: JSONObject, spanCase: SpanCase): void {
  expect(row["traceId"]).toBe(TRACE_ID_HEX);
  expect(row["hasException"]).toBe(true);
  expect(
    (row["events"] as JSONArray).map((event: JSONObject) => {
      return {
        name: event["name"],
        timeUnixNano: event["timeUnixNano"],
        attributes: event["attributes"],
      };
    }),
  ).toEqual([
    {
      name: "exception",
      timeUnixNano: EVENT_TIME_UNIX_NANO,
      attributes: {
        "exception.type": "TimeoutError",
        "exception.message": `timed out in ${spanCase.spanIdHex}`,
      },
    },
  ]);
  expect(row["links"]).toEqual([
    {
      traceId: LINKED_TRACE_ID_HEX,
      spanId: LINKED_SPAN_ID_HEX,
      attributes: { "link.reason": "retry-of" },
    },
  ]);
}

describe("OTLP span enums, events and links across wire formats (GH#3978)", () => {
  test.each(
    ROUTES.map((route: Route, routeIndex: number): [string, number] => {
      return [route.label, routeIndex];
    }),
  )(
    "%s: every kind x status is stored the same way",
    async (_label: string, routeIndex: number) => {
      const route: Route = ROUTES[routeIndex]!;
      const body: JSONObject = await route.decode(
        otlpJsonRequest({ elideEnums: false }),
      );

      // Pin the form the decoder handed over, so names really are exercised.
      expect(
        decodedSpans(body).map((span: JSONObject) => {
          return [span["kind"], (span["status"] as JSONObject)["code"]];
        }),
      ).toEqual(
        SPAN_CASES.map((spanCase: SpanCase) => {
          return route.spellsEnumsByName
            ? [spanCase.kind.name, spanCase.status.name]
            : [spanCase.kind.wire, spanCase.status.wire];
        }),
      );

      await ingestDecodedBody(body);

      const byId: Map<string, JSONObject> = spanRowsById();
      for (const spanCase of SPAN_CASES) {
        const row: JSONObject = byId.get(spanCase.spanIdHex)!;
        expect({
          spanId: spanCase.spanIdHex,
          kind: row["kind"],
          statusCode: row["statusCode"],
          statusMessage: row["statusMessage"],
        }).toEqual({
          spanId: spanCase.spanIdHex,
          kind: spanCase.kind.stored,
          statusCode: spanCase.status.stored,
          statusMessage: `status ${spanCase.status.wire}`,
        });
        expectEventsAndLinks(row, spanCase);
      }
      expect(exceptionRows).toHaveLength(SPAN_CASES.length);
    },
  );

  test.each(
    ROUTES.map((route: Route, routeIndex: number): [string, number] => {
      return [route.label, routeIndex];
    }),
  )(
    "%s: an elided kind and status are stored as INTERNAL / UNSET",
    async (_label: string, routeIndex: number) => {
      const body: JSONObject = await ROUTES[routeIndex]!.decode(
        otlpJsonRequest({ elideEnums: true }),
      );
      for (const span of decodedSpans(body)) {
        expect(span).not.toHaveProperty("kind");
        expect(span).not.toHaveProperty("status");
      }

      await ingestDecodedBody(body);

      const byId: Map<string, JSONObject> = spanRowsById();
      for (const spanCase of SPAN_CASES) {
        const row: JSONObject = byId.get(spanCase.spanIdHex)!;
        expect(row["kind"]).toBe(SpanKind.Internal);
        expect(row["statusCode"]).toBe(SpanStatus.Unset);
        expect(row["statusMessage"]).toBe("");
        expectEventsAndLinks(row, spanCase);
      }
    },
  );
});
