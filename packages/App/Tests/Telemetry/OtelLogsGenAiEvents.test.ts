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
import LogDropFilterService, {
  LoadedLogDropFilter,
} from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogPipelineService from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import OtelLogsIngestService from "../../FeatureSet/Telemetry/Services/OtelLogsIngestService";
import LogsQueueService from "../../FeatureSet/Telemetry/Services/Queue/LogsQueueService";
import { TelemetryIngestJobData } from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import ExceptionUtil, {
  TelemetryExceptionPayload,
} from "../../FeatureSet/Telemetry/Utils/Exception";
import { compileFilter } from "../../FeatureSet/Telemetry/Utils/LogFilterEvaluator";
import OtelPayloadDecoder from "../../FeatureSet/Telemetry/Utils/OtelPayloadDecoder";
import LogDropFilter from "Common/Models/DatabaseModels/LogDropFilter";
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
import LogDropFilterAction from "Common/Types/Log/LogDropFilterAction";
import LogScrubAction from "Common/Types/Log/LogScrubAction";
import LogScrubField from "Common/Types/Log/LogScrubField";
import LogScrubPatternType from "Common/Types/Log/LogScrubPatternType";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import { ScrubRegExp } from "Common/Types/Telemetry/ScrubRule";
import TelemetryIngestionKeyPolicy from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import LlmLogEventsUtil, {
  LlmLogEventRecord,
} from "Common/Utils/Telemetry/LlmLogEvents";
import LlmMessageParser, {
  LlmCallContent,
  LlmMessage,
} from "Common/Utils/Telemetry/LlmMessageParser";
import {
  GenAiLogEventFixture,
  GenAiLogEventFixtureFile,
  loadGenAiLogEventFixture,
  toStoredMap,
} from "Common/Tests/Helpers/GenAiLogEventFixtures";

/*
 * GENAI LOG EVENTS THROUGH LOG INGEST (#6348).
 *
 * What the OpenTelemetry GenAI instrumentations really sent
 * (Common/Tests/Fixtures/GenAiLogEvents) goes through the real production
 * path - protobuf and OTLP/JSON over the OTLP/HTTP middleware and handler,
 * and gRPC through the Export deserializer built with GrpcServer's own
 * proto-loader options - then OtelPayloadDecoder.decodeFromQueue and
 * OtelLogsIngestService, as OtelLogsSeverityWireFormat does. Pinned here:
 *
 *   - a record that names its event only in the LogRecord's event_name
 *     field (Python's SDK from 1.39) is stored with the `event.name`
 *     attribute, so the AI conversations - and the Logs page, and filters -
 *     find it; the repo's logs.proto must carry that field for protobuf and
 *     gRPC to keep it at all;
 *   - a record's own `event.name` attribute wins over that field;
 *   - an inference details record's messages are stored as their JSON text
 *     and the logs' scrub rules mask what was said in them, as they mask a
 *     message event's body - and the drop filters see the stamped name.
 *
 * Only the persistence edges are replaced: Redis (body store, BullMQ),
 * ClickHouse (the fan-in writer), Postgres (resource resolution, pipelines,
 * drop filters, scrub rules, the exception upsert, auto-discovery) and the
 * ingestion-key lookup.
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
        const key: string = `telemetry:body:genai-${mockStoredBodies.size + 1}`;
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
const SERVICE_NAME: string = "py-openai-app";
const INGESTION_TOKEN: string = "logs-genai-events-token";
const LOGS_EXPORT_SERVICE: string =
  "opentelemetry.proto.collector.logs.v1.LogsService";

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
    LOGS_EXPORT_SERVICE
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

function setupIngest(data?: {
  scrubRules?: Array<CompiledLogScrubRule>;
  dropFilters?: Array<LoadedLogDropFilter>;
}): void {
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
  jest
    .spyOn(LogDropFilterService, "loadDropFilters")
    .mockResolvedValue(data?.dropFilters || []);
  jest
    .spyOn(LogScrubRuleService, "loadScrubRules")
    .mockResolvedValue(data?.scrubRules || []);
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
        // No exception comes out of a GenAI event.
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
  return JSON.parse(
    JSON.stringify(mockEnqueuedJobs[0]),
  ) as TelemetryIngestJobData;
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
  const res: ExpressResponse = fakeResponse();

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

  const reply: { error: grpc.ServiceError | null } = await new Promise(
    (resolve: (value: { error: grpc.ServiceError | null }) => void) => {
      void handleExport(
        { request, metadata },
        (error: grpc.ServiceError | null) => {
          resolve({ error });
        },
        ProductType.Logs,
        LogsQueueService.addLogIngestJob.bind(LogsQueueService),
      );
    },
  );

  expect(reply.error).toBeNull();
  return onlyEnqueuedJob();
}

// A record's ids as OTLP/JSON writes them: hex, not base64.
function toOtlpJson(request: JSONObject): JSONObject {
  const copy: JSONObject = JSON.parse(JSON.stringify(request)) as JSONObject;

  for (const resourceLog of copy["resourceLogs"] as JSONArray) {
    for (const scopeLog of (resourceLog as JSONObject)[
      "scopeLogs"
    ] as JSONArray) {
      for (const record of (scopeLog as JSONObject)[
        "logRecords"
      ] as JSONArray) {
        const fields: JSONObject = record as JSONObject;

        for (const key of ["traceId", "spanId"]) {
          if (typeof fields[key] === "string") {
            fields[key] = Buffer.from(fields[key] as string, "base64").toString(
              "hex",
            );
          }
        }
      }
    }
  }

  return copy;
}

interface Route {
  label: string;
  // The request (protobufjs's JSON form, ids in base64) to the worker's body.
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
          Buffer.from(JSON.stringify(toOtlpJson(request)), "utf-8"),
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

function fixtureLogs(fixture: GenAiLogEventFixture): JSONObject {
  const file: GenAiLogEventFixtureFile = loadGenAiLogEventFixture(fixture);
  return JSON.parse(JSON.stringify(file.logs)) as JSONObject;
}

function recordsOf(request: JSONObject): Array<JSONObject> {
  const records: Array<JSONObject> = [];

  for (const resourceLog of request["resourceLogs"] as JSONArray) {
    for (const scopeLog of (resourceLog as JSONObject)[
      "scopeLogs"
    ] as JSONArray) {
      records.push(
        ...((scopeLog as JSONObject)["logRecords"] as Array<JSONObject>),
      );
    }
  }

  return records;
}

// A stored row as the Log table reads it back (Map(String, String)).
function storedRecord(row: JSONObject): LlmLogEventRecord {
  return {
    traceId: row["traceId"] as string,
    spanId: row["spanId"] as string,
    timeUnixNano: row["timeUnixNano"] as string,
    observedTimeUnixNano: row["observedTimeUnixNano"] as string,
    attributes: toStoredMap(row["attributes"] as JSONObject),
    body: row["body"] as string,
  };
}

// What one span's stored records say, as the conversation view reads them.
function contentOfSpan(spanId: string): LlmCallContent {
  return LlmLogEventsUtil.readContent(
    logRows
      .filter((row: JSONObject): boolean => {
        return row["spanId"] === spanId;
      })
      .map(storedRecord),
  );
}

function lines(messages: Array<LlmMessage>): Array<string> {
  return messages.map((message: LlmMessage): string => {
    return `${message.role}: ${LlmMessageParser.toDisplayText(message)}`;
  });
}

function hexId(base64: unknown): string {
  return Buffer.from(String(base64), "base64").toString("hex");
}

// Every text value equal to `from` in a nested OTLP value becomes `to`.
function replaceText(value: unknown, from: string, to: string): unknown {
  if (typeof value === "string") {
    return value === from ? to : value;
  }

  if (Array.isArray(value)) {
    return value.map((item: unknown): unknown => {
      return replaceText(item, from, to);
    });
  }

  if (value && typeof value === "object") {
    const result: JSONObject = {};

    for (const [key, item] of Object.entries(value as JSONObject)) {
      result[key] = replaceText(item, from, to) as JSONObject;
    }

    return result;
  }

  return value;
}

function emailRule(fields: LogScrubField): CompiledLogScrubRule {
  const rule: LogScrubRule = new LogScrubRule();
  rule.name = "mask emails";
  rule.patternType = LogScrubPatternType.Email;
  rule.fieldsToScrub = fields;
  rule.scrubAction = LogScrubAction.Mask;

  const regex: ScrubRegExp | null = (
    LogScrubRuleService as unknown as {
      getRegexForPattern: (patternType: string) => ScrubRegExp | null;
    }
  ).getRegexForPattern(LogScrubPatternType.Email as string);

  return { rule: rule, regex: regex as ScrubRegExp } as CompiledLogScrubRule;
}

function dropFilter(filterQuery: string): LoadedLogDropFilter {
  // No id: recordDrop() short-circuits without one.
  const filter: LogDropFilter = new LogDropFilter();
  filter.action = LogDropFilterAction.Drop;

  return {
    filter: filter,
    compiledFilter: compileFilter(filterQuery, { emptyQueryMatches: false }),
    projectId: PROJECT_ID,
  };
}

const QUESTION: string = "Say this is a test.";
const QUESTION_WITH_EMAIL: string =
  "Say this is a test. Then mail it to ada.lovelace@example.com please.";

describe("GenAI log events through log ingest", () => {
  test("the repo's logs.proto carries the LogRecord's event_name field (12)", () => {
    const logRecord: protobuf.Type = protobuf
      .loadSync(path.join(PROTO_DIR, "logs.proto"))
      .lookupType("opentelemetry.proto.logs.v1.LogRecord");

    expect(logRecord.fields["eventName"]?.id).toBe(12);
    expect(logRecord.fields["eventName"]?.type).toBe("string");
  });

  test.each(ROUTE_CASES)(
    "%s: a record that names its event only in its event name field is stored with event.name",
    async (_label: string, routeIndex: number) => {
      setupIngest();
      // Python's openai-v2 2.4b0 on SDK 1.45: no event.name attribute.
      const request: JSONObject = fixtureLogs(
        GenAiLogEventFixture.PythonOpenAiV2True,
      );
      const sent: Array<JSONObject> = recordsOf(request);

      expect(
        sent.every((record: JSONObject): boolean => {
          return (
            typeof record["eventName"] === "string" &&
            !JSON.stringify(record["attributes"] || []).includes("event.name")
          );
        }),
      ).toBe(true);

      await ingestDecodedBody(await ROUTES[routeIndex]!.decode(request));

      expect(logRows).toHaveLength(sent.length);
      expect(
        logRows.map((row: JSONObject): unknown => {
          return (row["attributes"] as JSONObject)["event.name"];
        }),
      ).toEqual(
        sent.map((record: JSONObject): unknown => {
          return record["eventName"];
        }),
      );

      for (const row of logRows) {
        expect(row["attributeKeys"]).toContain("event.name");
      }

      // So the conversation reads the first call's prompt and answer.
      const firstSpan: string = hexId(sent[0]!["spanId"]);
      const content: LlmCallContent = contentOfSpan(firstSpan);

      expect(lines(content.input)).toEqual([
        "system: You are a helpful assistant.",
        `user: ${QUESTION}`,
      ]);
      expect(content.output).toHaveLength(1);
    },
  );

  test.each(ROUTE_CASES)(
    "%s: a record's own event.name attribute wins over its event name field",
    async (_label: string, routeIndex: number) => {
      setupIngest();
      const request: JSONObject = fixtureLogs(
        GenAiLogEventFixture.PythonOpenAiV2True,
      );
      const first: JSONObject = recordsOf(request)[0]!;
      first["attributes"] = [
        ...((first["attributes"] as JSONArray) || []),
        { key: "event.name", value: { stringValue: "app.checkout.started" } },
      ];

      await ingestDecodedBody(await ROUTES[routeIndex]!.decode(request));

      expect((logRows[0]!["attributes"] as JSONObject)["event.name"]).toBe(
        "app.checkout.started",
      );
      // The others still take their field's name.
      expect((logRows[1]!["attributes"] as JSONObject)["event.name"]).toBe(
        "gen_ai.user.message",
      );
    },
  );

  test.each(ROUTE_CASES)(
    "%s: a details record's messages are stored as their JSON text, and still read",
    async (_label: string, routeIndex: number) => {
      setupIngest();
      const request: JSONObject = fixtureLogs(
        GenAiLogEventFixture.PythonOpenAiV2EventOnly,
      );

      await ingestDecodedBody(await ROUTES[routeIndex]!.decode(request));

      const first: JSONObject = logRows[0]!["attributes"] as JSONObject;

      expect(first["event.name"]).toBe(
        "gen_ai.client.inference.operation.details",
      );
      expect(typeof first["gen_ai.input.messages"]).toBe("string");
      expect(typeof first["gen_ai.output.messages"]).toBe("string");
      // The OTLP list as attribute flattening writes it, keys prefixed.
      expect(JSON.parse(first["gen_ai.input.messages"] as string)).toEqual([
        expect.objectContaining({ "gen_ai.input.messages.role": "system" }),
        expect.objectContaining({ "gen_ai.input.messages.role": "user" }),
      ]);

      const content: LlmCallContent = contentOfSpan(
        hexId(recordsOf(request)[0]!["spanId"]),
      );

      expect(lines(content.input)).toEqual([
        "system: You are a helpful assistant.",
        `user: ${QUESTION}`,
      ]);
    },
  );

  test.each(ROUTE_CASES)(
    "%s: the logs' email scrub rule masks an address in a details record's messages",
    async (_label: string, routeIndex: number) => {
      setupIngest({ scrubRules: [emailRule(LogScrubField.Attributes)] });
      const request: JSONObject = replaceText(
        fixtureLogs(GenAiLogEventFixture.PythonOpenAiV2EventOnly),
        QUESTION,
        QUESTION_WITH_EMAIL,
      ) as JSONObject;

      await ingestDecodedBody(await ROUTES[routeIndex]!.decode(request));

      const stored: string = JSON.stringify(logRows);

      expect(stored).not.toContain("ada.lovelace@example.com");
      expect(stored).toContain("a***@***.com");

      // What was said still reads, the address masked.
      const content: LlmCallContent = contentOfSpan(
        hexId(recordsOf(request)[0]!["spanId"]),
      );

      expect(lines(content.input)[1]).toBe(
        "user: Say this is a test. Then mail it to a***@***.com please.",
      );
    },
  );

  test("a structured value is masked text by text, as the JSON text ingest holds it as is (#6397)", () => {
    const rule: CompiledLogScrubRule = emailRule(LogScrubField.Attributes);
    const structured: JSONObject = {
      attributes: {
        "gen_ai.input.messages": [
          {
            role: "user",
            parts: [{ type: "text", content: QUESTION_WITH_EMAIL }],
          },
        ],
      },
    };

    // Scrub rules read the texts inside a list too, keeping its shape...
    const scrubbed: JSONObject = LogScrubRuleService.scrubLog(
      JSON.parse(JSON.stringify(structured)) as JSONObject,
      [rule],
    );
    const messages: unknown = (scrubbed["attributes"] as JSONObject)[
      "gen_ai.input.messages"
    ];

    expect(messages).toEqual([
      {
        role: "user",
        parts: [
          {
            type: "text",
            content: "Say this is a test. Then mail it to a***@***.com please.",
          },
        ],
      },
    ]);

    // ...and what was said, held as its JSON text first, is masked the same.
    const held: JSONObject = JSON.parse(
      JSON.stringify(structured),
    ) as JSONObject;
    LlmLogEventsUtil.holdContentAsText(held["attributes"] as JSONObject);

    const heldScrubbed: JSONObject = LogScrubRuleService.scrubLog(held, [rule]);

    expect(
      JSON.parse(
        (heldScrubbed["attributes"] as JSONObject)[
          "gen_ai.input.messages"
        ] as string,
      ),
    ).toEqual(messages);
  });

  test("JavaScript's message events: the email scrub rule masks an address in the body", async () => {
    setupIngest({ scrubRules: [emailRule(LogScrubField.Body)] });
    const request: JSONObject = replaceText(
      fixtureLogs(GenAiLogEventFixture.JavaScriptContent),
      QUESTION,
      QUESTION_WITH_EMAIL,
    ) as JSONObject;

    await ingestDecodedBody(await ROUTES[0]!.decode(request));

    expect(JSON.stringify(logRows)).not.toContain("ada.lovelace@example.com");

    const content: LlmCallContent = contentOfSpan(
      hexId(recordsOf(request)[0]!["spanId"]),
    );

    expect(lines(content.input)[1]).toBe(
      "user: Say this is a test. Then mail it to a***@***.com please.",
    );
  });

  test("a drop filter on event.name drops the events that name themselves only in their field", async () => {
    setupIngest({
      dropFilters: [dropFilter("event.name = 'gen_ai.user.message'")],
    });
    const request: JSONObject = fixtureLogs(
      GenAiLogEventFixture.PythonOpenAiV2True,
    );
    const sent: Array<JSONObject> = recordsOf(request);

    await ingestDecodedBody(await ROUTES[0]!.decode(request));

    const userMessages: number = sent.filter((record: JSONObject): boolean => {
      return record["eventName"] === "gen_ai.user.message";
    }).length;

    expect(userMessages).toBeGreaterThan(0);
    expect(logRows).toHaveLength(sent.length - userMessages);
    expect(
      logRows.some((row: JSONObject): boolean => {
        return (
          (row["attributes"] as JSONObject)["event.name"] ===
          "gen_ai.user.message"
        );
      }),
    ).toBe(false);
  });
});
