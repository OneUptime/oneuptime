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
import LogDropFilterService from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogPipelineService from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import OtelLogsIngestService from "../../FeatureSet/Telemetry/Services/OtelLogsIngestService";
import LogsQueueService from "../../FeatureSet/Telemetry/Services/Queue/LogsQueueService";
import { TelemetryIngestJobData } from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import ExceptionUtil, {
  TelemetryExceptionPayload,
} from "../../FeatureSet/Telemetry/Utils/Exception";
import OtelPayloadDecoder from "../../FeatureSet/Telemetry/Utils/OtelPayloadDecoder";
import LogScrubRule from "Common/Models/DatabaseModels/LogScrubRule";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import LogService from "Common/Server/Services/LogService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import TelemetryFanInWriter, {
  FanInInsertTarget,
} from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import LogScrubAction from "Common/Types/Log/LogScrubAction";
import LogScrubField from "Common/Types/Log/LogScrubField";
import LogScrubPatternType from "Common/Types/Log/LogScrubPatternType";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import { ScrubRegExp } from "Common/Types/Telemetry/ScrubRule";
import TelemetryIngestionKeyPolicy from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import {
  SCRUB_MAX_NESTED_VALUES_PER_RECORD,
  SCRUB_MAX_VALUE_DEPTH,
} from "Common/Utils/Telemetry/ScrubNestedValues";

/*
 * ---------------------------------------------------------------------------
 * LOG SCRUB RULES OVER LISTS AND NESTED VALUES, ON EACH OTLP ROUTE (#6397).
 *
 * Real OTLP log requests - protobuf and OTLP/JSON over the OTLP/HTTP
 * middleware and handler, and gRPC through the Export deserializer built
 * with GrpcServer's own proto-loader options and the real handleExport -
 * then OtelPayloadDecoder.decodeFromQueue and OtelLogsIngestService, with a
 * project's Email and Sensitive Attribute Keys rules. Each route decodes a
 * list, a list of lists and a key-value list its own way (gRPC adds a field
 * naming each value's kind; int64s arrive as text); what is stored must not
 * depend on it:
 *
 *   - the texts inside a record's lists, lists of lists and key-value lists,
 *     its resource's and its scope's, are masked - their shapes kept, their
 *     numbers and true or false left alone;
 *   - a Sensitive Attribute Keys rule hides the values of a header list and
 *     the values under a secret key inside a list or a key-value list, a
 *     scope's {key, value} pairs included;
 *   - a body sent as a map or a list is stored as its JSON text, masked in
 *     place;
 *   - a value nested too deep, or past a record's allowance, is stored as
 *     the very JSON text the Log table stores for the list, masked as text.
 *
 * Only the persistence edges are replaced: Redis (body store, BullMQ),
 * ClickHouse (the fan-in writer), Postgres (resource resolution, pipelines,
 * drop filters, scrub rules, the exception upsert, auto-discovery) and the
 * ingestion-key lookup.
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
        const key: string = `telemetry:body:logs-scrub-${mockStoredBodies.size + 1}`;
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
const INGESTION_TOKEN: string = "logs-scrub-nested-values-token";

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

const ExportLogsServiceRequestType: protobuf.Type = protobuf
  .loadSync(path.join(PROTO_DIR, "logs_service.proto"))
  .lookupType("opentelemetry.proto.collector.logs.v1.ExportLogsServiceRequest");

function encodeProtobuf(request: JSONObject): Buffer {
  const message: protobuf.Message =
    ExportLogsServiceRequestType.fromObject(request);
  return Buffer.from(ExportLogsServiceRequestType.encode(message).finish());
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
    path.join(includeDir, "logs_service.proto"),
    OTLP_PROTO_LOADER_OPTIONS,
  );
  const service: protoLoader.ServiceDefinition = definition[
    "opentelemetry.proto.collector.logs.v1.LogsService"
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

type CompiledLogScrubRule = Awaited<
  ReturnType<typeof LogScrubRuleService.loadScrubRules>
>[number];

let logRows: Array<JSONObject>;

function setupIngest(scrubRules: Array<CompiledLogScrubRule>): void {
  const ingest: IngestTestMethods =
    OtelLogsIngestService as unknown as IngestTestMethods;

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
  jest.spyOn(LogPipelineService, "loadPipelines").mockResolvedValue([]);
  jest.spyOn(LogDropFilterService, "loadDropFilters").mockResolvedValue([]);
  jest
    .spyOn(LogScrubRuleService, "loadScrubRules")
    .mockResolvedValue(scrubRules);
  jest
    .spyOn(TelemetryFanInWriter, "submit")
    .mockImplementation(
      async (target: FanInInsertTarget, batch: Array<JSONObject>) => {
        if (target === LogService) {
          logRows.push(...batch);
        } else if (target !== ExceptionInstanceService) {
          throw new Error(`unexpected fan-in target ${target.model.tableName}`);
        }
        return { flushed: Promise.resolve() };
      },
    );
  jest
    .spyOn(ExceptionUtil, "saveOrUpdateTelemetryExceptionsBatch")
    .mockImplementation(
      async (_payloads: Array<TelemetryExceptionPayload>): Promise<void> => {
        // No record here is an exception.
      },
    );
  jest.spyOn(TelemetryIngestionDisabled, "isDisabled").mockReturnValue(false);
}

beforeEach(() => {
  logRows = [];
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
  expect(job.productType).toBe(ProductType.Logs);
  return OtelPayloadDecoder.decodeFromQueue({
    productType: job.productType!,
    format: job.bodyFormat!,
    encoding: job.bodyEncoding ?? "none",
    bodyKey: job.bodyKey!,
  });
}

async function ingestDecodedBody(body: JSONObject): Promise<void> {
  await OtelLogsIngestService.processLogsFromQueue({
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
    url: "/otlp/v1/logs",
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
  expect((req as TelemetryRequest).productType).toBe(ProductType.Logs);

  const next: jest.Mock = jest.fn();
  await OtelLogsIngestService.ingestLogs(
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
        ProductType.Logs,
        LogsQueueService.addLogIngestJob.bind(LogsQueueService),
      );
    },
  );

  expect(error).toBeNull();
  return onlyEnqueuedJob();
}

interface Route {
  label: string;
  // The request, as OTLP/JSON writes it, to the body the worker reads.
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

// `inner` inside `lists` OTLP lists, one in the other.
function nestedList(inner: JSONObject, lists: number): JSONObject {
  let value: JSONObject = inner;

  for (let level: number = 0; level < lists; level++) {
    value = list(value);
  }

  return value;
}

// The same, as ingest keeps it: JavaScript lists.
function nest(inner: unknown, lists: number): unknown {
  let value: unknown = inner;

  for (let level: number = 0; level < lists; level++) {
    value = [value];
  }

  return value;
}

const DEEP_LISTS: number = SCRUB_MAX_VALUE_DEPTH + 8;
const WIDE_VALUES: number = SCRUB_MAX_NESTED_VALUES_PER_RECORD + 2_000;

function logsRequest(): JSONObject {
  return {
    resourceLogs: [
      {
        resource: {
          attributes: pairs([
            ["service.name", text(SERVICE_NAME)],
            ["deployment.owners", list(text(EMAIL), text("platform team"))],
            ["deploy.tokens", list(text("tok-1"), text("tok-2"))],
          ]),
        },
        scopeLogs: [
          {
            scope: {
              name: "checkout.logger",
              version: "1.4.0",
              attributes: pairs([
                ["owner.email", text(EMAIL)],
                ["auth.api_key", text("scope-key-1")],
                ["library.tags", list(text("stable"), text(OTHER_EMAIL))],
              ]),
            },
            logRecords: [
              {
                timeUnixNano: "1794218400000000000",
                severityNumber: 9,
                body: text(`order placed by ${EMAIL}`),
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
                      text("no address"),
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
                        ["name", text("Ada")],
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
                  ["retries", int("3")],
                  ["ok", { boolValue: true }],
                ]),
              },
              {
                timeUnixNano: "1794218401000000000",
                severityNumber: 9,
                body: keyValueList([
                  ["message", text(`contact ${EMAIL}`)],
                  ["password", text("pw-3")],
                  ["codes", list(int("1"), text(OTHER_EMAIL))],
                ]),
              },
              {
                timeUnixNano: "1794218402000000000",
                severityNumber: 9,
                body: list(text(EMAIL), int("5"), list(text(OTHER_EMAIL))),
              },
              {
                timeUnixNano: "1794218403000000000",
                severityNumber: 9,
                body: text("bounds"),
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
  patternType: LogScrubPatternType;
  action: LogScrubAction;
  customRegex?: string;
}): CompiledLogScrubRule {
  const rule: LogScrubRule = new LogScrubRule();
  rule.name = `rule ${data.patternType}`;
  rule.patternType = data.patternType;
  rule.scrubAction = data.action;
  rule.fieldsToScrub = LogScrubField.Both;

  if (data.customRegex) {
    rule.customRegex = data.customRegex;
  }

  const regex: ScrubRegExp | null = (
    LogScrubRuleService as unknown as {
      getRegexForPattern: (
        patternType: string,
        customRegex?: string,
      ) => ScrubRegExp | null;
    }
  ).getRegexForPattern(data.patternType as string, data.customRegex);

  expect(regex).not.toBeNull();

  return { rule: rule, regex: regex as ScrubRegExp } as CompiledLogScrubRule;
}

const PROJECT_RULES: () => Array<CompiledLogScrubRule> =
  (): Array<CompiledLogScrubRule> => {
    return [
      compiledRule({
        patternType: LogScrubPatternType.Email,
        action: LogScrubAction.Mask,
      }),
      compiledRule({
        patternType: LogScrubPatternType.SensitiveKeys,
        action: LogScrubAction.Redact,
      }),
    ];
  };

function rowWithBody(body: string): JSONObject {
  const row: JSONObject | undefined = logRows.find(
    (candidate: JSONObject): boolean => {
      return candidate["body"] === body;
    },
  );

  expect(row).toBeDefined();
  return row!;
}

function attributesOf(row: JSONObject): JSONObject {
  return row["attributes"] as JSONObject;
}

// gRPC names each AnyValue's kind in a `value` field: read without it.
function withoutKindNames(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(withoutKindNames);
  }

  if (value && typeof value === "object") {
    const copy: JSONObject = {};

    for (const [key, item] of Object.entries(value as JSONObject)) {
      if (key === "value" && typeof item === "string") {
        continue;
      }

      copy[key] = withoutKindNames(item) as JSONObject;
    }

    return copy;
  }

  return value;
}

function logRecordsOf(body: JSONObject): Array<JSONObject> {
  return (
    ((body["resourceLogs"] as JSONArray)[0] as JSONObject)[
      "scopeLogs"
    ] as JSONArray
  ).flatMap((scopeLog: JSONObject): Array<JSONObject> => {
    return scopeLog["logRecords"] as Array<JSONObject>;
  });
}

describe("log scrub rules over lists and nested values, on each OTLP route (#6397)", () => {
  test.each(ROUTE_CASES)(
    "%s: the texts inside a record's lists, lists of lists and key-value lists are masked, their shapes and other values kept",
    async (_label: string, routeIndex: number) => {
      setupIngest(PROJECT_RULES());

      await ingestDecodedBody(await ROUTES[routeIndex]!.decode(logsRequest()));

      expect(logRows).toHaveLength(4);

      const row: JSONObject = rowWithBody(`order placed by ${EMAIL_MASKED}`);
      const attributes: JSONObject = attributesOf(row);

      expect(attributes).toEqual(
        expect.objectContaining({
          "user.emails": [EMAIL_MASKED, "7", true, 1.5, "no address"],
          matrix: [[EMAIL_MASKED], [[`deep ${OTHER_EMAIL_MASKED}`]]],
          contacts: [
            {
              "contacts.name": "Ada",
              "contacts.email": EMAIL_MASKED,
              "contacts.password": "[REDACTED]",
              "contacts.age": "36",
            },
          ],
          "owner.email": EMAIL_MASKED,
          "owner.password": "[REDACTED]",
          retries: "3",
          ok: true,
        }),
      );

      // Nothing either rule was written to hide is stored, on any record.
      const stored: string = JSON.stringify(logRows);

      for (const secret of [
        EMAIL,
        OTHER_EMAIL,
        "Bearer abc.def",
        "session=1",
        "theme=dark",
        "pw-1",
        "pw-2",
        "tok-1",
        "scope-key-1",
      ]) {
        expect(stored).not.toContain(secret);
      }
    },
  );

  test.each(ROUTE_CASES)(
    "%s: a Sensitive Attribute Keys rule hides the values of a header list, and leaves a header that names no secret",
    async (_label: string, routeIndex: number) => {
      setupIngest(PROJECT_RULES());

      await ingestDecodedBody(await ROUTES[routeIndex]!.decode(logsRequest()));

      const attributes: JSONObject = attributesOf(
        rowWithBody(`order placed by ${EMAIL_MASKED}`),
      );

      expect(attributes["http.request.header.authorization"]).toEqual([
        "[REDACTED]",
      ]);
      expect(attributes["http.request.header.cookie"]).toEqual([
        "[REDACTED]",
        "[REDACTED]",
      ]);
      expect(attributes["http.request.header.accept"]).toEqual(["text/html"]);
    },
  );

  test.each(ROUTE_CASES)(
    "%s: the resource's lists and the scope's {key, value} pairs are scrubbed on every record, the request's own values kept",
    async (_label: string, routeIndex: number) => {
      setupIngest(PROJECT_RULES());
      const body: JSONObject = await ROUTES[routeIndex]!.decode(logsRequest());
      const decodedBefore: string = JSON.stringify(body);

      await ingestDecodedBody(body);

      for (const row of logRows) {
        const attributes: JSONObject = attributesOf(row);

        expect(attributes["resource.deployment.owners"]).toEqual([
          EMAIL_MASKED,
          "platform team",
        ]);
        expect(attributes["resource.deploy.tokens"]).toEqual([
          "[REDACTED]",
          "[REDACTED]",
        ]);
        expect(attributes["scope.name"]).toBe("checkout.logger");
        expect(withoutKindNames(attributes["scope.attributes"])).toEqual([
          { key: "owner.email", value: { stringValue: EMAIL_MASKED } },
          { key: "auth.api_key", value: { stringValue: "[REDACTED]" } },
          {
            key: "library.tags",
            value: {
              arrayValue: {
                values: [
                  { stringValue: "stable" },
                  { stringValue: OTHER_EMAIL_MASKED },
                ],
              },
            },
          },
        ]);
      }

      // The decoded request - which every record's values came from - is as it was.
      expect(JSON.stringify(body)).toBe(decodedBefore);
    },
  );

  test.each(ROUTE_CASES)(
    "%s: a body sent as a map or a list is stored as its JSON text, masked in place",
    async (_label: string, routeIndex: number) => {
      setupIngest(PROJECT_RULES());
      const body: JSONObject = await ROUTES[routeIndex]!.decode(logsRequest());
      const records: Array<JSONObject> = logRecordsOf(body);
      const mapBody: string = JSON.stringify(records[1]!["body"]);
      const listBody: string = JSON.stringify(records[2]!["body"]);

      await ingestDecodedBody(body);

      const masked: (bodyText: string) => string = (
        bodyText: string,
      ): string => {
        return bodyText
          .split(EMAIL)
          .join(EMAIL_MASKED)
          .split(OTHER_EMAIL)
          .join(OTHER_EMAIL_MASKED);
      };

      expect(mapBody).toContain(EMAIL);
      rowWithBody(masked(mapBody));
      rowWithBody(masked(listBody));

      // Keys are read in attributes only: a body is text to the rules.
      expect(masked(mapBody)).toContain("pw-3");
    },
  );

  test.each(ROUTE_CASES)(
    "%s: a value too deep, or past a record's allowance, is stored as its JSON text, masked as text",
    async (_label: string, routeIndex: number) => {
      setupIngest(PROJECT_RULES());

      await ingestDecodedBody(await ROUTES[routeIndex]!.decode(logsRequest()));

      const attributes: JSONObject = attributesOf(rowWithBody("bounds"));

      expect(attributes["deep"]).toBe(
        JSON.stringify(nest(EMAIL_MASKED, DEEP_LISTS)),
      );
      expect(attributes["wide"]).toBe(
        JSON.stringify(new Array<string>(WIDE_VALUES).fill(OTHER_EMAIL_MASKED)),
      );
    },
  );

  test.each(ROUTE_CASES)(
    "%s: a value held as text is the very text the Log table stores for it as a list",
    async (_label: string, routeIndex: number) => {
      // No rule: the lists go to the Log table as lists, written as JSON.
      setupIngest([]);
      await ingestDecodedBody(await ROUTES[routeIndex]!.decode(logsRequest()));
      const asLists: JSONObject = attributesOf(rowWithBody("bounds"));

      expect(Array.isArray(asLists["deep"])).toBe(true);
      expect(Array.isArray(asLists["wide"])).toBe(true);

      jest.restoreAllMocks();
      logRows = [];

      // A rule that matches nothing: the same values, held as their text.
      setupIngest([
        compiledRule({
          patternType: LogScrubPatternType.Custom,
          action: LogScrubAction.Redact,
          customRegex: "NEVER-[0-9]{12}",
        }),
      ]);
      await ingestDecodedBody(await ROUTES[routeIndex]!.decode(logsRequest()));
      const held: JSONObject = attributesOf(rowWithBody("bounds"));

      expect(held["deep"]).toBe(JSON.stringify(asLists["deep"]));
      expect(held["wide"]).toBe(JSON.stringify(asLists["wide"]));
      // The values that fit stay lists.
      expect(
        attributesOf(rowWithBody(`order placed by ${EMAIL}`))["matrix"],
      ).toEqual([[EMAIL], [[`deep ${OTHER_EMAIL}`]]]);
    },
  );
});
