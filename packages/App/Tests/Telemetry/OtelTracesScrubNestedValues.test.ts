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
import OtelPayloadDecoder from "../../FeatureSet/Telemetry/Utils/OtelPayloadDecoder";
import TraceScrubRule from "Common/Models/DatabaseModels/TraceScrubRule";
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
import { JSONArray, JSONObject, JSONValue } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import { ScrubRegExp } from "Common/Types/Telemetry/ScrubRule";
import TelemetryIngestionKeyPolicy from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import TraceScrubAction from "Common/Types/Trace/TraceScrubAction";
import TraceScrubField from "Common/Types/Trace/TraceScrubField";
import TraceScrubPatternType from "Common/Types/Trace/TraceScrubPatternType";
import {
  SCRUB_MAX_NESTED_VALUES_PER_RECORD,
  SCRUB_MAX_VALUE_DEPTH,
} from "Common/Utils/Telemetry/ScrubNestedValues";

/*
 * ---------------------------------------------------------------------------
 * TRACE SCRUB RULES OVER LISTS AND NESTED VALUES, ON EACH OTLP ROUTE (#6397).
 *
 * Real OTLP trace requests - protobuf and OTLP/JSON over the OTLP/HTTP
 * middleware and handler, and gRPC through the Export deserializer built
 * with GrpcServer's own proto-loader options and the real handleExport -
 * then OtelPayloadDecoder.decodeFromQueue and OtelTracesIngestService, with
 * a project's Email and Sensitive Attribute Keys rules. Pinned, whatever the
 * route:
 *
 *   - the texts inside a span's lists, lists of lists and key-value lists,
 *     its resource's and its scope's, are masked - shapes, numbers and true
 *     or false kept - and so are its events' and its links' (a link's
 *     attributes were never scrubbed before);
 *   - a Sensitive Attribute Keys rule hides the values of a header list and
 *     the values under a secret key inside a list or a key-value list;
 *   - the exception an exception event becomes is stored scrubbed alike;
 *   - a value nested too deep, or past the span's allowance, is stored as
 *     its JSON text, masked as text;
 *   - All masks the span's status message and its events' names, and the
 *     rules that scrub its events the exception's type (#6513).
 *
 * Only the persistence edges are replaced (Redis, ClickHouse, Postgres, the
 * ingestion-key lookup).
 * ---------------------------------------------------------------------------
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
        const key: string = `telemetry:body:traces-scrub-${mockStoredBodies.size + 1}`;
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
      // An accepted export stamps its key as used (issue #7887).
      markUsed: (): Promise<void> => {
        return Promise.resolve();
      },
    },
  };
});

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const SERVICE_NAME: string = "checkout-api";
const INGESTION_TOKEN: string = "traces-scrub-nested-values-token";

const TRACE_ID_HEX: string = "5b8efff798038103d269b633813fc60c";
const SPAN_ID_HEX: string = "aaaaaaaaaaaaaa01";
const BOUNDS_SPAN_ID_HEX: string = "aaaaaaaaaaaaaa02";
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
  "autoDiscoverDatabaseServer",
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IngestTestMethods = Record<string, any>;

type CompiledTraceScrubRule = Awaited<
  ReturnType<typeof TraceScrubRuleService.loadScrubRules>
>[number];

let spanRows: Array<JSONObject>;
let exceptionRows: Array<JSONObject>;
let exceptionPayloads: Array<TelemetryExceptionPayload>;

function setupIngest(scrubRules: Array<CompiledTraceScrubRule>): void {
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
  jest
    .spyOn(TraceScrubRuleService, "loadScrubRules")
    .mockResolvedValue(scrubRules);
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
      async (payloads: Array<TelemetryExceptionPayload>): Promise<void> => {
        exceptionPayloads.push(...payloads);
      },
    );
  jest.spyOn(TelemetryIngestionDisabled, "isDisabled").mockReturnValue(false);
}

beforeEach(() => {
  spanRows = [];
  exceptionRows = [];
  exceptionPayloads = [];
  mockEnqueuedJobs.length = 0;
  mockStoredBodies.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

function onlyEnqueuedJob(): TelemetryIngestJobData {
  expect(mockEnqueuedJobs).toHaveLength(1);
  const job: TelemetryIngestJobData = JSON.parse(
    JSON.stringify(mockEnqueuedJobs[0]),
  ) as TelemetryIngestJobData;
  mockEnqueuedJobs.length = 0;
  return job;
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
  return onlyEnqueuedJob();
}

interface Route {
  label: string;
  decode: (request: JSONObject) => Promise<JSONObject>;
}

const ROUTES: Array<Route> = [
  {
    label: "HTTP protobuf",
    decode: async (request: JSONObject): Promise<JSONObject> => {
      return decodeJob(
        await postOverHttp(encodeProtobuf(request), "application/x-protobuf"),
      );
    },
  },
  {
    label: "HTTP OTLP/JSON",
    decode: async (request: JSONObject): Promise<JSONObject> => {
      return decodeJob(
        await postOverHttp(
          Buffer.from(JSON.stringify(request), "utf-8"),
          "application/json",
        ),
      );
    },
  },
  {
    label: "gRPC",
    decode: async (request: JSONObject): Promise<JSONObject> => {
      return decodeJob(await exportViaGrpcHandler(encodeProtobuf(request)));
    },
  },
];

const ROUTE_CASES: Array<[string, number]> = ROUTES.map(
  (route: Route, index: number): [string, number] => {
    return [route.label, index];
  },
);

/*
 * ---------------------------------------------------------------------------
 * The request: OTLP AnyValues, as OTLP/JSON writes them (int64s as text).
 * ---------------------------------------------------------------------------
 */
const EMAIL: string = "ada.lovelace@example.com";
const EMAIL_MASKED: string = "a***@***.com";
const OTHER_EMAIL: string = "grace.hopper@example.org";
const OTHER_EMAIL_MASKED: string = "g***@***.org";

function text(value: string): JSONObject {
  return { stringValue: value };
}

function int(value: string): JSONObject {
  return { intValue: value };
}

function list(...values: Array<JSONObject>): JSONObject {
  return { arrayValue: { values: values } };
}

function pairs(entries: Array<[string, JSONObject]>): JSONArray {
  return entries.map(([key, value]: [string, JSONObject]): JSONObject => {
    return { key: key, value: value };
  });
}

function keyValueList(entries: Array<[string, JSONObject]>): JSONObject {
  return { kvlistValue: { values: pairs(entries) } };
}

function nestedList(inner: JSONObject, lists: number): JSONObject {
  let value: JSONObject = inner;

  for (let level: number = 0; level < lists; level++) {
    value = list(value);
  }

  return value;
}

function nest(inner: unknown, lists: number): unknown {
  let value: unknown = inner;

  for (let level: number = 0; level < lists; level++) {
    value = [value];
  }

  return value;
}

const DEEP_LISTS: number = SCRUB_MAX_VALUE_DEPTH + 8;
const WIDE_VALUES: number = SCRUB_MAX_NESTED_VALUES_PER_RECORD + 2_000;

function tracesRequest(): JSONObject {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: pairs([
            ["service.name", text(SERVICE_NAME)],
            ["deployment.owners", list(text(EMAIL), text("platform team"))],
            ["deploy.tokens", list(text("tok-1"), text("tok-2"))],
          ]),
        },
        scopeSpans: [
          {
            scope: {
              name: "checkout.tracer",
              version: "1.4.0",
              attributes: pairs([
                ["owner.email", text(EMAIL)],
                ["auth.api_key", text("scope-key-1")],
              ]),
            },
            spans: [
              {
                traceId: TRACE_ID_HEX,
                spanId: SPAN_ID_HEX,
                name: "POST /checkout",
                kind: 2,
                startTimeUnixNano: "1794218400000000000",
                endTimeUnixNano: "1794218400250000000",
                attributes: pairs([
                  [
                    "http.request.header.authorization",
                    list(text("Bearer abc.def")),
                  ],
                  [
                    "http.request.header.cookie",
                    list(text("session=1"), text("theme=dark")),
                  ],
                  ["http.request.header.accept", list(text("text/html"))],
                  [
                    "user.emails",
                    list(
                      text(EMAIL),
                      int("7"),
                      { boolValue: true },
                      { doubleValue: 1.5 },
                    ),
                  ],
                  [
                    "matrix",
                    list(
                      list(text(EMAIL)),
                      list(list(text(`deep ${OTHER_EMAIL}`))),
                    ),
                  ],
                  [
                    "contacts",
                    list(
                      keyValueList([
                        ["email", text(EMAIL)],
                        ["password", text("pw-1")],
                        ["age", int("36")],
                      ]),
                    ),
                  ],
                  [
                    "owner",
                    keyValueList([
                      ["email", text(EMAIL)],
                      ["password", text("pw-2")],
                    ]),
                  ],
                ]),
                events: [
                  {
                    timeUnixNano: "1794218400100000000",
                    name: "retry",
                    attributes: pairs([
                      ["retry.emails", list(text(EMAIL))],
                      ["auth.token", list(text("t-1"), text("t-2"))],
                      ["retry.count", int("2")],
                    ]),
                  },
                  {
                    timeUnixNano: "1794218400200000000",
                    name: "exception",
                    attributes: pairs([
                      ["exception.type", text("PaymentError")],
                      ["exception.message", text(`declined for ${EMAIL}`)],
                      ["exception.stacktrace", text("at charge (pay.js:1)")],
                      [
                        "exception.details",
                        list(
                          text(OTHER_EMAIL),
                          keyValueList([["password", text("pw-4")]]),
                        ),
                      ],
                    ]),
                  },
                ],
                links: [
                  {
                    traceId: LINKED_TRACE_ID_HEX,
                    spanId: LINKED_SPAN_ID_HEX,
                    attributes: pairs([
                      ["link.owners", list(text(EMAIL))],
                      [
                        "messaging.header.authorization",
                        list(text("Bearer link")),
                      ],
                      ["link.owner", text(OTHER_EMAIL)],
                      ["link.reason", text("retry-of")],
                    ]),
                  },
                ],
              },
              {
                traceId: TRACE_ID_HEX,
                spanId: BOUNDS_SPAN_ID_HEX,
                name: "bounds",
                kind: 1,
                startTimeUnixNano: "1794218401000000000",
                endTimeUnixNano: "1794218401250000000",
                attributes: pairs([
                  ["deep", nestedList(text(EMAIL), DEEP_LISTS)],
                  [
                    "wide",
                    list(
                      ...new Array<JSONObject>(WIDE_VALUES).fill(
                        text(OTHER_EMAIL),
                      ),
                    ),
                  ],
                ]),
              },
            ],
          },
        ],
      },
    ],
  };
}

function compiledRule(data: {
  patternType: TraceScrubPatternType;
  action: TraceScrubAction;
  customRegex?: string;
}): CompiledTraceScrubRule {
  const rule: TraceScrubRule = new TraceScrubRule();
  rule.name = `rule ${data.patternType}`;
  rule.patternType = data.patternType;
  rule.scrubAction = data.action;
  rule.fieldsToScrub = TraceScrubField.All;

  if (data.customRegex) {
    rule.customRegex = data.customRegex;
  }

  const regex: ScrubRegExp | null = (
    TraceScrubRuleService as unknown as {
      getRegexForPattern: (
        patternType: string,
        customRegex?: string,
      ) => ScrubRegExp | null;
    }
  ).getRegexForPattern(data.patternType as string, data.customRegex);

  expect(regex).not.toBeNull();

  return { rule: rule, regex: regex as ScrubRegExp } as CompiledTraceScrubRule;
}

function projectRules(): Array<CompiledTraceScrubRule> {
  return [
    compiledRule({
      patternType: TraceScrubPatternType.Email,
      action: TraceScrubAction.Mask,
    }),
    compiledRule({
      patternType: TraceScrubPatternType.SensitiveKeys,
      action: TraceScrubAction.Redact,
    }),
  ];
}

function spanRow(spanIdHex: string): JSONObject {
  const row: JSONObject | undefined = spanRows.find(
    (candidate: JSONObject): boolean => {
      return candidate["spanId"] === spanIdHex;
    },
  );

  expect(row).toBeDefined();
  return row!;
}

function eventAttributes(row: JSONObject, name: string): JSONObject {
  const event: JSONObject | undefined = (
    row["events"] as Array<JSONObject>
  ).find((candidate: JSONObject): boolean => {
    return candidate["name"] === name;
  });

  expect(event).toBeDefined();
  return event!["attributes"] as JSONObject;
}

describe("trace scrub rules over lists and nested values, on each OTLP route (#6397)", () => {
  test.each(ROUTE_CASES)(
    "%s: the texts inside a span's lists, lists of lists and key-value lists are masked, their shapes and other values kept",
    async (_label: string, routeIndex: number) => {
      setupIngest(projectRules());

      await ingestDecodedBody(
        await ROUTES[routeIndex]!.decode(tracesRequest()),
      );

      expect(spanRows).toHaveLength(2);

      const attributes: JSONObject = spanRow(SPAN_ID_HEX)[
        "attributes"
      ] as JSONObject;

      expect(attributes).toEqual(
        expect.objectContaining({
          "http.request.header.authorization": ["[REDACTED]"],
          "http.request.header.cookie": ["[REDACTED]", "[REDACTED]"],
          "http.request.header.accept": ["text/html"],
          "user.emails": [EMAIL_MASKED, "7", true, 1.5],
          matrix: [[EMAIL_MASKED], [[`deep ${OTHER_EMAIL_MASKED}`]]],
          contacts: [
            {
              "contacts.email": EMAIL_MASKED,
              "contacts.password": "[REDACTED]",
              "contacts.age": "36",
            },
          ],
          "owner.email": EMAIL_MASKED,
          "owner.password": "[REDACTED]",
          "resource.deployment.owners": [EMAIL_MASKED, "platform team"],
          "resource.deploy.tokens": ["[REDACTED]", "[REDACTED]"],
          "scope.name": "checkout.tracer",
        }),
      );
    },
  );

  test.each(ROUTE_CASES)(
    "%s: an event's lists are masked by the rules, and a link's attributes too",
    async (_label: string, routeIndex: number) => {
      setupIngest(projectRules());

      await ingestDecodedBody(
        await ROUTES[routeIndex]!.decode(tracesRequest()),
      );

      const row: JSONObject = spanRow(SPAN_ID_HEX);

      expect(eventAttributes(row, "retry")).toEqual({
        "retry.emails": [EMAIL_MASKED],
        "auth.token": ["[REDACTED]", "[REDACTED]"],
        "retry.count": "2",
      });
      expect(eventAttributes(row, "exception")).toEqual({
        "exception.type": "PaymentError",
        "exception.message": `declined for ${EMAIL_MASKED}`,
        "exception.stacktrace": "at charge (pay.js:1)",
        "exception.details": [
          OTHER_EMAIL_MASKED,
          { "exception.details.password": "[REDACTED]" },
        ],
      });
      expect(row["links"]).toEqual([
        {
          traceId: LINKED_TRACE_ID_HEX,
          spanId: LINKED_SPAN_ID_HEX,
          attributes: {
            "link.owners": [EMAIL_MASKED],
            "messaging.header.authorization": ["[REDACTED]"],
            "link.owner": OTHER_EMAIL_MASKED,
            "link.reason": "retry-of",
          },
        },
      ]);
    },
  );

  test.each(ROUTE_CASES)(
    "%s: the exception an exception event becomes is stored scrubbed alike",
    async (_label: string, routeIndex: number) => {
      setupIngest(projectRules());

      await ingestDecodedBody(
        await ROUTES[routeIndex]!.decode(tracesRequest()),
      );

      expect(exceptionRows).toHaveLength(1);
      expect(exceptionRows[0]!["message"]).toBe(`declined for ${EMAIL_MASKED}`);
      expect(
        (exceptionRows[0]!["attributes"] as JSONObject)["exception.details"],
      ).toEqual([
        OTHER_EMAIL_MASKED,
        { "exception.details.password": "[REDACTED]" },
      ]);
      expect(exceptionPayloads[0]!.message).toBe(
        `declined for ${EMAIL_MASKED}`,
      );
    },
  );

  test.each(ROUTE_CASES)(
    "%s: nothing either rule was written to hide is stored, and the decoded request is as it was",
    async (_label: string, routeIndex: number) => {
      setupIngest(projectRules());
      const body: JSONObject =
        await ROUTES[routeIndex]!.decode(tracesRequest());
      const decodedBefore: string = JSON.stringify(body);

      await ingestDecodedBody(body);

      const stored: string = JSON.stringify([
        spanRows,
        exceptionRows,
        exceptionPayloads,
      ]);

      for (const secret of [
        EMAIL,
        OTHER_EMAIL,
        "Bearer abc.def",
        "Bearer link",
        "session=1",
        "pw-1",
        "pw-2",
        "pw-4",
        "t-1",
        "tok-1",
        "scope-key-1",
      ]) {
        expect(stored).not.toContain(secret);
      }

      expect(JSON.stringify(body)).toBe(decodedBefore);
    },
  );

  test.each(ROUTE_CASES)(
    "%s: a value too deep, or past a span's allowance, is stored as its JSON text, masked as text",
    async (_label: string, routeIndex: number) => {
      setupIngest(projectRules());

      await ingestDecodedBody(
        await ROUTES[routeIndex]!.decode(tracesRequest()),
      );

      const attributes: JSONObject = spanRow(BOUNDS_SPAN_ID_HEX)[
        "attributes"
      ] as JSONObject;

      expect(attributes["deep"]).toBe(
        JSON.stringify(nest(EMAIL_MASKED, DEEP_LISTS)),
      );
      expect(attributes["wide"]).toBe(
        JSON.stringify(new Array<string>(WIDE_VALUES).fill(OTHER_EMAIL_MASKED)),
      );
    },
  );

  test.each(ROUTE_CASES)(
    "%s: without a rule, every list is stored as it arrived",
    async (_label: string, routeIndex: number) => {
      setupIngest([]);

      await ingestDecodedBody(
        await ROUTES[routeIndex]!.decode(tracesRequest()),
      );

      const row: JSONObject = spanRow(SPAN_ID_HEX);

      expect((row["attributes"] as JSONObject)["matrix"]).toEqual([
        [EMAIL],
        [[`deep ${OTHER_EMAIL}`]],
      ]);
      expect(
        (spanRow(BOUNDS_SPAN_ID_HEX)["attributes"] as JSONObject)["deep"],
      ).toEqual(nest(EMAIL, DEEP_LISTS));
      expect(
        ((row["links"] as Array<JSONObject>)[0]!["attributes"] as JSONObject)[
          "link.owners"
        ],
      ).toEqual([EMAIL]);
    },
  );
});

/*
 * ---------------------------------------------------------------------------
 * A SPAN'S STATUS MESSAGE, ITS EVENTS' NAMES AND ITS EXCEPTION'S TYPE (#6513).
 *
 * No trace rule read a span's status message or an event's name, and an
 * exception's type was stored as its span event's exception.type came, so
 * an address repeated there reached storage past a rule meant to remove
 * it. All reaches the status message and the events' names now, and the
 * rules that scrub a span's events scrub its exception's type - on every
 * route, with the exception still grouped by what it came with.
 * ---------------------------------------------------------------------------
 */
const STATUS_SPAN_ID_HEX: string = "aaaaaaaaaaaaaa03";

function statusRequest(): JSONObject {
  return {
    resourceSpans: [
      {
        resource: { attributes: pairs([["service.name", text(SERVICE_NAME)]]) },
        scopeSpans: [
          {
            scope: { name: "checkout.tracer" },
            spans: [
              {
                traceId: TRACE_ID_HEX,
                spanId: STATUS_SPAN_ID_HEX,
                name: "POST /charge",
                kind: 2,
                startTimeUnixNano: "1794218402000000000",
                endTimeUnixNano: "1794218402250000000",
                status: { code: 2, message: `card declined for ${EMAIL}` },
                events: [
                  {
                    timeUnixNano: "1794218402100000000",
                    name: `retrying for ${OTHER_EMAIL}`,
                    attributes: pairs([["retry.count", int("1")]]),
                  },
                  {
                    timeUnixNano: "1794218402200000000",
                    name: "exception",
                    attributes: pairs([
                      ["exception.type", text(`CardDeclined[${EMAIL}]`)],
                      ["exception.message", text("card declined")],
                      ["exception.stacktrace", text("at charge (pay.js:9)")],
                    ]),
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

// The project's Email rule, masking, for one Fields to Scrub choice.
function emailRuleFor(fields: string): Array<CompiledTraceScrubRule> {
  const compiled: CompiledTraceScrubRule = compiledRule({
    patternType: TraceScrubPatternType.Email,
    action: TraceScrubAction.Mask,
  });

  compiled.rule.fieldsToScrub = fields;

  return [compiled];
}

function eventNames(row: JSONObject): Array<unknown> {
  return (row["events"] as Array<JSONObject>).map(
    (event: JSONObject): unknown => {
      return event["name"];
    },
  );
}

describe("a span's status message, its events' names and its exception's type, on each OTLP route (#6513)", () => {
  test.each(ROUTE_CASES)(
    "%s: All masks the status message, the events' names and the exception's type",
    async (_label: string, routeIndex: number) => {
      setupIngest(projectRules());

      await ingestDecodedBody(
        await ROUTES[routeIndex]!.decode(statusRequest()),
      );

      const row: JSONObject = spanRow(STATUS_SPAN_ID_HEX);

      expect(row["statusMessage"]).toBe(`card declined for ${EMAIL_MASKED}`);
      expect(eventNames(row)).toEqual([
        `retrying for ${OTHER_EMAIL_MASKED}`,
        "exception",
      ]);
      expect(eventAttributes(row, "exception")["exception.type"]).toBe(
        `CardDeclined[${EMAIL_MASKED}]`,
      );

      expect(exceptionRows).toHaveLength(1);
      expect(exceptionRows[0]!["exceptionType"]).toBe(
        `CardDeclined[${EMAIL_MASKED}]`,
      );
      expect(exceptionPayloads).toHaveLength(1);
      expect(exceptionPayloads[0]!.exceptionType).toBe(
        `CardDeclined[${EMAIL_MASKED}]`,
      );

      const stored: string = JSON.stringify([
        spanRows,
        exceptionRows,
        exceptionPayloads,
      ]);

      expect(stored).not.toContain(EMAIL);
      expect(stored).not.toContain(OTHER_EMAIL);
    },
  );

  test.each(ROUTE_CASES)(
    "%s: the exception is grouped by the type it came with, as without a rule",
    async (_label: string, routeIndex: number) => {
      setupIngest([]);
      await ingestDecodedBody(
        await ROUTES[routeIndex]!.decode(statusRequest()),
      );

      const unscrubbed: JSONObject = exceptionRows[0]!;
      const unscrubbedPayload: TelemetryExceptionPayload =
        exceptionPayloads[0]!;

      expect(unscrubbed["exceptionType"]).toBe(`CardDeclined[${EMAIL}]`);

      jest.restoreAllMocks();
      spanRows = [];
      exceptionRows = [];
      exceptionPayloads = [];
      setupIngest(projectRules());
      await ingestDecodedBody(
        await ROUTES[routeIndex]!.decode(statusRequest()),
      );

      expect(exceptionRows[0]!["exceptionType"]).toBe(
        `CardDeclined[${EMAIL_MASKED}]`,
      );
      /*
       * Grouped by the exception as it came (#10600, #10434): it tries the
       * groups it has without the rule first, so an exception made before
       * the rule keeps its occurrences. A new one is made under the keyed
       * fingerprint: the email the rule hid is in the text v1 and v2 hash,
       * and an unkeyed hash of it would give it back to whoever hashes
       * guesses. These exceptions cannot be read, so the occurrence keeps
       * the keyed one too.
       */
      const scrubbedPayload: TelemetryExceptionPayload = exceptionPayloads[0]!;
      const keyed: string = scrubbedPayload.fingerprintCandidates![2]!;

      expect(typeof unscrubbed["fingerprint"]).toBe("string");
      expect(scrubbedPayload.fingerprintCandidates).toEqual([
        unscrubbed["fingerprint"],
        unscrubbedPayload.fingerprintV2,
        keyed,
      ]);
      expect([
        unscrubbed["fingerprint"],
        unscrubbedPayload.fingerprintV2,
      ]).not.toContain(keyed);
      expect(scrubbedPayload.fingerprintV2).toBe(keyed);
      expect(scrubbedPayload.fingerprint).toBe(keyed);
      expect(exceptionRows[0]!["fingerprint"]).toBe(keyed);
    },
  );

  test.each(ROUTE_CASES)(
    "%s: Event Attributes Only masks the exception's type, never the status message or an event's name",
    async (_label: string, routeIndex: number) => {
      setupIngest(emailRuleFor(TraceScrubField.Events));

      await ingestDecodedBody(
        await ROUTES[routeIndex]!.decode(statusRequest()),
      );

      const row: JSONObject = spanRow(STATUS_SPAN_ID_HEX);

      expect(row["statusMessage"]).toBe(`card declined for ${EMAIL}`);
      expect(eventNames(row)).toEqual([
        `retrying for ${OTHER_EMAIL}`,
        "exception",
      ]);
      expect(exceptionRows[0]!["exceptionType"]).toBe(
        `CardDeclined[${EMAIL_MASKED}]`,
      );
    },
  );

  test.each(ROUTE_CASES)(
    "%s: Span Name Only and Attributes Only leave all three as they came",
    async (_label: string, routeIndex: number) => {
      for (const fields of [TraceScrubField.Name, TraceScrubField.Attributes]) {
        jest.restoreAllMocks();
        spanRows = [];
        exceptionRows = [];
        exceptionPayloads = [];
        setupIngest(emailRuleFor(fields));

        await ingestDecodedBody(
          await ROUTES[routeIndex]!.decode(statusRequest()),
        );

        const row: JSONObject = spanRow(STATUS_SPAN_ID_HEX);

        expect([fields, row["statusMessage"]]).toEqual([
          fields,
          `card declined for ${EMAIL}`,
        ]);
        expect([fields, eventNames(row)[0]]).toEqual([
          fields,
          `retrying for ${OTHER_EMAIL}`,
        ]);
        expect([fields, exceptionRows[0]!["exceptionType"]]).toEqual([
          fields,
          `CardDeclined[${EMAIL}]`,
        ]);
      }
    },
  );
});

/*
 * ---------------------------------------------------------------------------
 * #8993: a JSON text held in a string - a span's request body, an AI call's
 * messages with a tool call's arguments, an event's payload, a link's, and
 * an exception's message written as JSON - is read key by key by a
 * Sensitive Attribute Keys rule on each route. The exception row holds what
 * the span row's exception.message holds, and its group stays the one the
 * exception was filed under before the rule.
 * ---------------------------------------------------------------------------
 */
const JSON_TEXTS_SPAN_ID_HEX: string = "aaaaaaaaaaaaaa04";
const REQUEST_BODY: string =
  '{ "username": "ada", "password": "hunter2", "id": 12345678901234567890 }';
const REQUEST_BODY_HIDDEN: string =
  '{ "username": "ada", "password": "[REDACTED]", "id": 12345678901234567890 }';
const TOOL_CALLS: string = JSON.stringify([
  {
    role: "assistant",
    tool_calls: [
      {
        function: {
          name: "login",
          arguments: JSON.stringify({ username: "ada", api_key: "key-55" }),
        },
      },
    ],
  },
]);
const EXCEPTION_MESSAGE: string =
  '{"error":"declined","card_number":"4111-0000","retry":true}';

function jsonTextsTraceRequest(): JSONObject {
  return {
    resourceSpans: [
      {
        resource: { attributes: pairs([["service.name", text(SERVICE_NAME)]]) },
        scopeSpans: [
          {
            scope: { name: "checkout.tracer" },
            spans: [
              {
                traceId: TRACE_ID_HEX,
                spanId: JSON_TEXTS_SPAN_ID_HEX,
                name: "POST /login",
                kind: 2,
                startTimeUnixNano: "1794218403000000000",
                endTimeUnixNano: "1794218403250000000",
                attributes: pairs([
                  ["http.request.body", text(REQUEST_BODY)],
                  ["gen_ai.output.messages", text(TOOL_CALLS)],
                ]),
                events: [
                  {
                    timeUnixNano: "1794218403100000000",
                    name: "request",
                    attributes: pairs([["payload", text(REQUEST_BODY)]]),
                  },
                  {
                    timeUnixNano: "1794218403200000000",
                    name: "exception",
                    attributes: pairs([
                      ["exception.type", text("LoginError")],
                      ["exception.message", text(EXCEPTION_MESSAGE)],
                      ["exception.stacktrace", text("at login (auth.js:3)")],
                    ]),
                  },
                ],
                links: [
                  {
                    traceId: LINKED_TRACE_ID_HEX,
                    spanId: LINKED_SPAN_ID_HEX,
                    attributes: pairs([["link.payload", text(REQUEST_BODY)]]),
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

function toolCallArguments(messages: string): unknown {
  const call: JSONObject = (
    (JSON.parse(messages) as Array<JSONObject>)[0]![
      "tool_calls"
    ] as Array<JSONObject>
  )[0]!;

  return JSON.parse((call["function"] as JSONObject)["arguments"] as string);
}

describe("a JSON text held in a string is read key by key on each OTLP route (#8993)", () => {
  test.each(ROUTE_CASES)(
    "%s: a span's, its events' and its links' JSON texts and its exception's message hide the secret under a key",
    async (_label: string, routeIndex: number) => {
      // Before any rule: the group the exception is filed under.
      setupIngest([]);
      await ingestDecodedBody(
        await ROUTES[routeIndex]!.decode(jsonTextsTraceRequest()),
      );
      const fingerprint: unknown = exceptionRows[0]!["fingerprint"];

      jest.restoreAllMocks();
      spanRows = [];
      exceptionRows = [];

      setupIngest([
        compiledRule({
          patternType: TraceScrubPatternType.SensitiveKeys,
          action: TraceScrubAction.Redact,
        }),
      ]);
      await ingestDecodedBody(
        await ROUTES[routeIndex]!.decode(jsonTextsTraceRequest()),
      );

      const row: JSONObject = spanRow(JSON_TEXTS_SPAN_ID_HEX);
      const attributes: JSONObject = row["attributes"] as JSONObject;

      expect(attributes["http.request.body"]).toBe(REQUEST_BODY_HIDDEN);
      expect(
        toolCallArguments(attributes["gen_ai.output.messages"] as string),
      ).toEqual({ username: "ada", api_key: "[REDACTED]" });
      expect(eventAttributes(row, "request")["payload"]).toBe(
        REQUEST_BODY_HIDDEN,
      );
      expect(
        ((row["links"] as Array<JSONObject>)[0]!["attributes"] as JSONObject)[
          "link.payload"
        ],
      ).toBe(REQUEST_BODY_HIDDEN);

      const hiddenMessage: string = EXCEPTION_MESSAGE.replace(
        '"4111-0000"',
        '"[REDACTED]"',
      );

      expect(eventAttributes(row, "exception")["exception.message"]).toBe(
        hiddenMessage,
      );
      expect(exceptionRows).toHaveLength(1);
      expect(exceptionRows[0]!["message"]).toBe(hiddenMessage);

      /*
       * Grouped by the exception as it came (#10600, #10434): the rule hid
       * part of its message, so it tries the group it was filed under
       * before the rule first. These exceptions cannot be read, so it keeps
       * v2's fingerprint, which the message is not in beside a stack
       * trace's frames: never v1's, an unkeyed hash of what the rule hid.
       */
      const before: TelemetryExceptionPayload = exceptionPayloads[0]!;
      const after: TelemetryExceptionPayload = exceptionPayloads[1]!;

      expect(after.fingerprintCandidates![0]).toBe(fingerprint);
      expect(exceptionRows[0]!["fingerprint"]).toBe(before.fingerprintV2);
      expect(exceptionRows[0]!["fingerprint"]).not.toBe(fingerprint);

      const stored: string = JSON.stringify([spanRows, exceptionRows]);

      expect(stored).not.toContain("hunter2");
      expect(stored).not.toContain("key-55");
      expect(stored).not.toContain("4111-0000");
    },
  );
});
