import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import fs from "fs";
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
import OtelPayloadDecoder, {
  OtelPayloadFormat,
} from "../../FeatureSet/Telemetry/Utils/OtelPayloadDecoder";
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
import Dictionary from "Common/Types/Dictionary";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import LogSeverity from "Common/Types/Log/LogSeverity";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import TelemetryIngestionKeyPolicy from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import ServiceType from "Common/Types/Telemetry/ServiceType";

/*
 * GH#3978: a log record's severity must survive EVERY way an OTLP exporter
 * can put it on the wire.
 *
 * OTLP/JSON encodes SeverityNumber as an integer, but protobuf bodies reach
 * the worker through protobufjs `.toJSON()` as the enum NAME, and gRPC
 * requests through @grpc/proto-loader (enums: String) as the name too. Ingest
 * used to map only the six base names (SEVERITY_NUMBER_TRACE, _DEBUG, ...)
 * and parseInt() everything else, so every other name - ERROR2, WARN3,
 * INFO2, UNSPECIFIED, ... - became NaN: stored as "Unspecified" with a NaN
 * number, and NaN slipped past the exception extractor's
 * `severityNumber < 17` gate, so a WARN2 body was scanned for stack traces.
 * The names are not exotic: the Collector's syslog parser maps alert to
 * ERROR3, crit to ERROR2 and notice to INFO2, and the docs now steer
 * exporters to protobuf.
 *
 * This suite sends every one of the 25 values through the real production
 * path - protobuf over the OTLP/HTTP middleware and handler, OTLP/JSON the
 * same way, and gRPC through the Export deserializer built with GrpcServer's
 * own proto-loader options and the real handleExport - then
 * OtelPayloadDecoder.decodeFromQueue and OtelLogsIngestService, and checks
 * the stored severityNumber / severityText and whether the body was scanned
 * for an exception. Only the persistence edges are replaced: Redis (body
 * store, BullMQ), ClickHouse (the fan-in writer), Postgres (resource
 * resolution, pipelines, drop filters, scrub rules, the exception upsert,
 * auto-discovery) and the ingestion-key lookup.
 */

// BullMQ is replaced by a recorder: the contract crossing it is the job data.
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

// In-memory TelemetryBodyStore, shared by the enqueue side and the decoder.
const mockStoredBodies: Map<string, Buffer> = new Map();

jest.mock("../../FeatureSet/Telemetry/Utils/TelemetryBodyStore", () => {
  return {
    __esModule: true,
    default: {
      storeBody: (body: Buffer): Promise<string> => {
        const key: string = `telemetry:body:severity-${mockStoredBodies.size + 1}`;
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

// One token resolves to a healthy Server key; every other token is unknown.
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
const SERVICE_NAME: string = "billing-worker";
const SCOPE_NAME: string = "com.example.billing";
const INGESTION_TOKEN: string = "logs-severity-wire-format-token";
const TIME_UNIX_NANO: string = "1700000060000000000";

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

/*
 * ---------------------------------------------------------------------------
 * The SeverityNumber enum as the OpenTelemetry Logs Data Model defines it:
 * 0 is UNSPECIFIED, then four steps for each of six levels, the first step
 * unsuffixed (TRACE, TRACE2, TRACE3, TRACE4, DEBUG, ...). Written out from
 * the spec rather than read from the repo's logs.proto, so the proto file is
 * under test too.
 * https://opentelemetry.io/docs/specs/otel/logs/data-model/#field-severitynumber
 * ---------------------------------------------------------------------------
 */
interface SeverityCase {
  name: string;
  number: number;
  text: LogSeverity;
  // Only ERROR (17-20) and FATAL (21-24) bodies are scanned for a stack trace.
  bodyScanned: boolean;
}

const SEVERITY_LEVELS: Array<[string, LogSeverity]> = [
  ["TRACE", LogSeverity.Trace],
  ["DEBUG", LogSeverity.Debug],
  ["INFO", LogSeverity.Information],
  ["WARN", LogSeverity.Warning],
  ["ERROR", LogSeverity.Error],
  ["FATAL", LogSeverity.Fatal],
];

const SEVERITY_CASES: Array<SeverityCase> = [
  {
    name: "SEVERITY_NUMBER_UNSPECIFIED",
    number: 0,
    text: LogSeverity.Unspecified,
    bodyScanned: false,
  },
];

SEVERITY_LEVELS.forEach(
  ([level, text]: [string, LogSeverity], levelIndex: number) => {
    for (let step: number = 1; step <= 4; step++) {
      const severityNumber: number = levelIndex * 4 + step;
      SEVERITY_CASES.push({
        name: `SEVERITY_NUMBER_${level}${step === 1 ? "" : step}`,
        number: severityNumber,
        text,
        bodyScanned: severityNumber >= 17,
      });
    }
  },
);

/*
 * Each record's body is a Java stack trace naming its own severity, so a
 * record that reaches the body scan yields an exception we can attribute.
 * No traceId / spanId and no exception.* attributes: the body scan is the
 * only way an exception can come out of these records.
 */
function probeBody(severityNumber: number): string {
  return [
    `java.lang.IllegalStateException: severity probe ${severityNumber}`,
    "\tat com.example.billing.Invoice.settle(Invoice.java:42)",
    "\tat com.example.billing.Main.main(Main.java:7)",
  ].join("\n");
}

/*
 * The request as canonical OTLP/JSON (enums as integers, 64-bit integers as
 * decimal strings). `severityNumber` undefined leaves the field out, which is
 * how every canonical encoder writes UNSPECIFIED.
 */
function otlpJsonRequest(records: Array<JSONObject>): JSONObject {
  return {
    resourceLogs: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: SERVICE_NAME } },
          ],
        },
        scopeLogs: [{ scope: { name: SCOPE_NAME }, logRecords: records }],
      },
    ],
  };
}

function logRecord(
  severityNumber: unknown,
  bodySeverity: number = typeof severityNumber === "number"
    ? severityNumber
    : 0,
): JSONObject {
  return {
    timeUnixNano: TIME_UNIX_NANO,
    ...(severityNumber === undefined
      ? {}
      : { severityNumber: severityNumber as number }),
    body: { stringValue: probeBody(bodySeverity) },
  };
}

// Loaded exactly as OtelPayloadDecoder loads its schemas.
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

/*
 * protobufjs writes every field that is set, so an explicit severityNumber 0
 * goes on the wire - the "explicitly UNSPECIFIED" case - while an unset one is
 * elided, as a Go or Java encoder would.
 */
function encodeProtobuf(request: JSONObject): Buffer {
  const message: protobuf.Message =
    ExportLogsServiceRequestType.fromObject(request);
  return Buffer.from(ExportLogsServiceRequestType.encode(message).finish());
}

type GrpcExportMethod = protoLoader.MethodDefinition<
  Record<string, unknown>,
  Record<string, unknown>
>;

// The logs Export method, loaded the way startGrpcServer loads it.
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

/*
 * ---------------------------------------------------------------------------
 * Harness: the persistence edges of the logs ingest.
 * ---------------------------------------------------------------------------
 */
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

let logRows: Array<JSONObject>;
let exceptionRows: Array<JSONObject>;
let exceptionUpserts: Array<TelemetryExceptionPayload>;

beforeEach(() => {
  logRows = [];
  exceptionRows = [];
  exceptionUpserts = [];
  mockEnqueuedJobs.length = 0;
  mockStoredBodies.clear();

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
  jest.spyOn(LogScrubRuleService, "loadScrubRules").mockResolvedValue([]);
  jest
    .spyOn(TelemetryFanInWriter, "submit")
    .mockImplementation(
      async (target: FanInInsertTarget, batch: Array<JSONObject>) => {
        if (target === LogService) {
          logRows.push(...batch);
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
        exceptionUpserts.push(...payloads);
      },
    );
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
  expect(job.productType).toBe(ProductType.Logs);
  expect(job.projectId).toBe(PROJECT_ID.toString());
  return OtelPayloadDecoder.decodeFromQueue({
    productType: job.productType!,
    format: job.bodyFormat!,
    encoding: job.bodyEncoding ?? "none",
    bodyKey: job.bodyKey!,
  });
}

// Worker half, step 2: the TelemetryType.Logs case in ProcessTelemetry.
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
  expect(next).toHaveBeenCalledTimes(1);
  expect(next).toHaveBeenCalledWith();
}

/*
 * OTLP/HTTP producer half: the body arrives as a socket stream,
 * OtelRequestMiddleware reads it and tags the signal, and the real logs HTTP
 * handler enqueues it. The ingestion-key middleware only attaches
 * `projectId`, which is set directly.
 */
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

/*
 * gRPC producer half without a socket: the Export method's own deserializer
 * turns the bytes into the object grpc-js hands the handler, then the real
 * handleExport authenticates and enqueues it through LogsQueueService.
 */
async function exportViaGrpcHandler(
  bytes: Buffer,
): Promise<TelemetryIngestJobData> {
  const request: Record<string, unknown> =
    GRPC_EXPORT.requestDeserialize(bytes);
  const metadata: grpc.Metadata = new grpc.Metadata();
  metadata.set("x-oneuptime-token", INGESTION_TOKEN);

  const reply: { error: grpc.ServiceError | null; response: unknown } =
    await new Promise(
      (
        resolve: (value: {
          error: grpc.ServiceError | null;
          response: unknown;
        }) => void,
      ) => {
        void handleExport(
          { request, metadata },
          (error: grpc.ServiceError | null, response?: unknown) => {
            resolve({ error, response });
          },
          ProductType.Logs,
          LogsQueueService.addLogIngestJob.bind(LogsQueueService),
        );
      },
    );

  expect(reply.error).toBeNull();
  expect(reply.response).toEqual({});
  const job: TelemetryIngestJobData = onlyEnqueuedJob();
  // gRPC hands the worker the decoded object, re-serialized as JSON.
  expect(job.bodyFormat).toBe(OtelPayloadFormat.Json);
  return job;
}

/*
 * One producer route: request -> the body the worker decodes. `form` is how
 * that decoder spells a given wire value - pinned so the matrix below provably
 * exercises the enum NAMES and not only integers.
 */
interface Route {
  label: string;
  decode: (request: JSONObject) => Promise<JSONObject>;
  form: (severity: SeverityCase) => unknown;
}

const ROUTES: Array<Route> = [
  {
    label: "HTTP protobuf (protobufjs .toJSON())",
    decode: async (request: JSONObject): Promise<JSONObject> => {
      return decodeJob(
        await postOverHttp(encodeProtobuf(request), "application/x-protobuf"),
      );
    },
    form: (severity: SeverityCase): unknown => {
      return severity.name;
    },
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
    form: (severity: SeverityCase): unknown => {
      return severity.number;
    },
  },
  {
    label: "gRPC (proto-loader with GrpcServer's options, handleExport)",
    decode: async (request: JSONObject): Promise<JSONObject> => {
      return decodeJob(await exportViaGrpcHandler(encodeProtobuf(request)));
    },
    form: (severity: SeverityCase): unknown => {
      return severity.name;
    },
  },
];

function decodedRecords(body: JSONObject): JSONArray {
  return (
    ((body["resourceLogs"] as JSONArray)[0]!["scopeLogs"] as JSONArray)[0]![
      "logRecords"
    ] as JSONArray
  ).map((record: JSONObject) => {
    return record;
  });
}

/*
 * ---------------------------------------------------------------------------
 * Assertions.
 * ---------------------------------------------------------------------------
 */
function expectStoredSeverity(data: {
  severityNumber: number;
  text: LogSeverity;
  bodyScanned: boolean;
  bodySeverity: number;
}): void {
  expect(logRows).toHaveLength(1);
  const row: JSONObject = logRows[0]!;
  expect({
    severityNumber: row["severityNumber"],
    severityText: row["severityText"],
  }).toEqual({ severityNumber: data.severityNumber, severityText: data.text });
  expect(row["body"]).toBe(probeBody(data.bodySeverity));

  if (!data.bodyScanned) {
    expect(exceptionRows).toEqual([]);
    expect(exceptionUpserts).toEqual([]);
    return;
  }

  expect(exceptionRows).toHaveLength(1);
  const exception: JSONObject = exceptionRows[0]!;
  expect(exception["exceptionType"]).toBe("java.lang.IllegalStateException");
  expect(exception["message"]).toBe(`severity probe ${data.bodySeverity}`);
  expect(exception["attributes"]).toEqual({
    "exception.source": "log",
    "log.severityText": data.text,
  });
  expect(exceptionUpserts).toHaveLength(1);
}

/*
 * ---------------------------------------------------------------------------
 * Tests.
 * ---------------------------------------------------------------------------
 */
describe("OTLP log severity wire-format round trip (GH#3978)", () => {
  test("the repo's logs.proto SeverityNumber enum is the spec's 25 values", () => {
    const protoEnum: protobuf.Enum = protobuf
      .loadSync(path.join(PROTO_DIR, "logs.proto"))
      .lookupEnum("opentelemetry.proto.logs.v1.SeverityNumber");

    const expected: Dictionary<number> = {};
    for (const severity of SEVERITY_CASES) {
      expected[severity.name] = severity.number;
    }
    expect(SEVERITY_CASES).toHaveLength(25);
    expect(protoEnum.values).toEqual(expected);
  });

  describe("every SeverityNumber, through every producer", () => {
    const matrix: Array<[string, string, number, number, SeverityCase]> = [];
    ROUTES.forEach((route: Route, routeIndex: number) => {
      for (const severity of SEVERITY_CASES) {
        matrix.push([
          route.label,
          severity.name,
          severity.number,
          routeIndex,
          severity,
        ]);
      }
    });

    test.each(matrix)(
      "%s: %s (%i) is stored with its number and level",
      async (
        _label: string,
        _name: string,
        _number: number,
        routeIndex: number,
        severity: SeverityCase,
      ) => {
        const route: Route = ROUTES[routeIndex]!;
        const body: JSONObject = await route.decode(
          otlpJsonRequest([logRecord(severity.number)]),
        );
        expect(decodedRecords(body)[0]!["severityNumber"]).toEqual(
          route.form(severity),
        );

        await ingestDecodedBody(body);

        expectStoredSeverity({
          severityNumber: severity.number,
          text: severity.text,
          bodyScanned: severity.bodyScanned,
          bodySeverity: severity.number,
        });
      },
    );
  });

  describe("values that are not a SeverityNumber on the wire", () => {
    test.each(
      ROUTES.map((route: Route, routeIndex: number): [string, number] => {
        return [route.label, routeIndex];
      }),
    )(
      "%s: an elided severityNumber is stored as 0 / Unspecified and not scanned",
      async (_label: string, routeIndex: number) => {
        const body: JSONObject = await ROUTES[routeIndex]!.decode(
          otlpJsonRequest([logRecord(undefined)]),
        );
        expect(decodedRecords(body)[0]).not.toHaveProperty("severityNumber");

        await ingestDecodedBody(body);

        expectStoredSeverity({
          severityNumber: 0,
          text: LogSeverity.Unspecified,
          bodyScanned: false,
          bodySeverity: 0,
        });
      },
    );

    /*
     * 25 is past FATAL4. Every decoder passes an unknown enum value on as its
     * number, and ingest must store it as UNSPECIFIED - not a number that says
     * one level while the text says "Unspecified", and never scanned.
     */
    test.each(
      ROUTES.map((route: Route, routeIndex: number): [string, number] => {
        return [route.label, routeIndex];
      }),
    )(
      "%s: an out-of-range severityNumber (25) is stored as 0 / Unspecified and not scanned",
      async (_label: string, routeIndex: number) => {
        const body: JSONObject = await ROUTES[routeIndex]!.decode(
          otlpJsonRequest([logRecord(25)]),
        );
        expect(decodedRecords(body)[0]!["severityNumber"]).toBe(25);

        await ingestDecodedBody(body);

        expectStoredSeverity({
          severityNumber: 0,
          text: LogSeverity.Unspecified,
          bodyScanned: false,
          bodySeverity: 25,
        });
      },
    );
  });

  describe("OTLP/JSON severity spelled as a name or a numeric string", () => {
    /*
     * The proto3 JSON mapping lets a sender spell an enum by name, and a
     * hand-rolled sender may quote the number. Both reach the same ingest
     * code the decoders feed, so they must land on the same row.
     */
    test.each(
      SEVERITY_CASES.map(
        (severity: SeverityCase): [string, string, number, SeverityCase] => {
          return [
            severity.name,
            String(severity.number),
            severity.number,
            severity,
          ];
        },
      ),
    )(
      '%s and "%s" are stored as %i',
      async (
        _name: string,
        _numericString: string,
        _number: number,
        severity: SeverityCase,
      ) => {
        for (const spelling of [severity.name, String(severity.number)]) {
          logRows = [];
          exceptionRows = [];
          exceptionUpserts = [];
          mockEnqueuedJobs.length = 0;

          await ingestDecodedBody(
            await decodeJob(
              await postOverHttp(
                Buffer.from(
                  JSON.stringify(
                    otlpJsonRequest([logRecord(spelling, severity.number)]),
                  ),
                  "utf-8",
                ),
                "application/json",
              ),
            ),
          );

          expectStoredSeverity({
            severityNumber: severity.number,
            text: severity.text,
            bodyScanned: severity.bodyScanned,
            bodySeverity: severity.number,
          });
        }
      },
    );

    test.each([
      ["an unknown name", "SEVERITY_NUMBER_CRITICAL"],
      ["a bare level", "ERROR2"],
      ["a lower-case name", "severity_number_error2"],
      ["a fractional number", 17.5],
      ["a fractional numeric string", "17.5"],
      ["a negative number", -1],
      ["null", null],
      ["a boolean", true],
      ["an object", { value: 17 }],
      ["an Object.prototype key", "constructor"],
    ])(
      "%s is stored as 0 / Unspecified, never NaN, and not scanned",
      async (_label: string, spelling: unknown) => {
        await ingestDecodedBody(
          await decodeJob(
            await postOverHttp(
              Buffer.from(
                JSON.stringify(otlpJsonRequest([logRecord(spelling, 21)])),
                "utf-8",
              ),
              "application/json",
            ),
          ),
        );

        expectStoredSeverity({
          severityNumber: 0,
          text: LogSeverity.Unspecified,
          bodyScanned: false,
          bodySeverity: 21,
        });
      },
    );
  });

  describe("normalizeSeverityNumber never returns anything but an integer in 0..24", () => {
    // Values no JSON or protobuf decoder can produce, for the direct caller.
    test.each([
      ["undefined", undefined],
      ["NaN", NaN],
      ["Infinity", Infinity],
      ["-Infinity", -Infinity],
      ["an unsafe integer", 2 ** 53],
      ["an empty string", ""],
      ["a padded numeric string", " 17"],
      ["an exponent string", "1e1"],
      ["a hex string", "0x11"],
      ["a numeric string past FATAL4", "25"],
      ["a very long numeric string", "9".repeat(400)],
      ["a bigint", BigInt(17)],
      ["an array", [17]],
    ])("%s -> 0", (_label: string, value: unknown) => {
      expect(OtelLogsIngestService.normalizeSeverityNumber(value)).toBe(0);
    });

    test("an in-range integer, its name and its numeric string agree", () => {
      for (const severity of SEVERITY_CASES) {
        expect([
          OtelLogsIngestService.normalizeSeverityNumber(severity.number),
          OtelLogsIngestService.normalizeSeverityNumber(severity.name),
          OtelLogsIngestService.normalizeSeverityNumber(
            String(severity.number),
          ),
        ]).toEqual([severity.number, severity.number, severity.number]);
      }
    });
  });

  test("a mixed batch over gRPC keeps each record's own severity", async () => {
    // One request carrying all 25 values: each record is normalized alone.
    const body: JSONObject = await ROUTES[2]!.decode(
      otlpJsonRequest(
        SEVERITY_CASES.map((severity: SeverityCase) => {
          return logRecord(severity.number);
        }),
      ),
    );

    await ingestDecodedBody(body);

    expect(logRows).toHaveLength(SEVERITY_CASES.length);
    expect(
      logRows.map((row: JSONObject) => {
        return [row["severityNumber"], row["severityText"]];
      }),
    ).toEqual(
      SEVERITY_CASES.map((severity: SeverityCase) => {
        return [severity.number, severity.text];
      }),
    );
    expect(
      exceptionRows
        .map((row: JSONObject) => {
          return row["message"] as string;
        })
        .sort(),
    ).toEqual(
      SEVERITY_CASES.filter((severity: SeverityCase) => {
        return severity.bodyScanned;
      })
        .map((severity: SeverityCase) => {
          return `severity probe ${severity.number}`;
        })
        .sort(),
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * A record that sets only its severityText (issue #8248).
 *
 * The OpenTelemetry Logs Data Model makes severityNumber and severityText
 * both optional, and some senders set only the text: a Node.js app that
 * emits { severityText: "INFO", body }, a log shipper that maps a level field
 * to the text alone. Ingest read only the number, so a record sent with
 * severityText "ERROR" and no number was stored as Unspecified: missing from
 * an Error filter, and from every alert on error logs.
 *
 * Now the text names the severity when the record sets no number - the
 * spec's short names and their numbered steps, and the spellings other
 * logging systems write, in any case - and the number still wins when both
 * are set. Every case goes through the same three producer routes as above.
 * ---------------------------------------------------------------------------
 */

// A record with the severityNumber and severityText given; undefined leaves a field out.
function logRecordWithText(data: {
  severityNumber?: unknown;
  severityText?: unknown;
  bodySeverity: number;
}): JSONObject {
  return {
    timeUnixNano: TIME_UNIX_NANO,
    ...(data.severityNumber === undefined
      ? {}
      : { severityNumber: data.severityNumber as number }),
    ...(data.severityText === undefined
      ? {}
      : { severityText: data.severityText as string }),
    body: { stringValue: probeBody(data.bodySeverity) },
  };
}

// The severity each short name or numbered step of the spec stands for.
const SEVERITY_TEXT_CASES: Array<SeverityCase> = SEVERITY_CASES.filter(
  (severity: SeverityCase): boolean => {
    return severity.number > 0;
  },
).map((severity: SeverityCase): SeverityCase => {
  // SEVERITY_NUMBER_WARN2 -> WARN2: the text the spec gives each step.
  return { ...severity, name: severity.name.replace("SEVERITY_NUMBER_", "") };
});

/*
 * The spellings other logging systems write, as the spec's table of example
 * mappings (Logs Data Model, Appendix B) maps them to a SeverityNumber.
 */
const OTHER_SPELLINGS: Array<[string, number, LogSeverity]> = [
  ["finest", 1, LogSeverity.Trace],
  ["verbose", 5, LogSeverity.Debug],
  ["finer", 5, LogSeverity.Debug],
  ["fine", 6, LogSeverity.Debug],
  ["config", 7, LogSeverity.Debug],
  ["information", 9, LogSeverity.Information],
  ["informational", 9, LogSeverity.Information],
  ["notice", 10, LogSeverity.Information],
  ["warning", 13, LogSeverity.Warning],
  ["err", 17, LogSeverity.Error],
  ["severe", 17, LogSeverity.Error],
  ["crit", 18, LogSeverity.Error],
  ["critical", 18, LogSeverity.Error],
  ["dpanic", 18, LogSeverity.Error],
  ["alert", 19, LogSeverity.Error],
  ["panic", 19, LogSeverity.Error],
  ["emerg", 21, LogSeverity.Fatal],
  ["emergency", 21, LogSeverity.Fatal],
];

// Text that names no severity: stored as Unspecified, as before.
const TEXT_THAT_NAMES_NOTHING: Array<[string, unknown]> = [
  ["an empty text", ""],
  ["spaces", "   "],
  ["a word that is no level", "DETAIL"],
  ["another word that is no level", "LOG"],
  ["a single letter", "E"],
  ["a step past the fourth", "INFO5"],
  ["a step before the second", "WARN1"],
  ["step zero", "ERROR0"],
  ["the enum name, a number's name and not a text", "SEVERITY_NUMBER_ERROR"],
  ["a level inside other words", "ERROR: disk full"],
  ["a level with punctuation", "[ERROR]"],
  ["the word Unspecified", "UNSPECIFIED"],
  ["an Object.prototype key", "constructor"],
  ["another Object.prototype key", "toString"],
  ["a number", 17],
  ["null", null],
  ["a boolean", true],
  ["an object", { value: "ERROR" }],
  ["an array", ["ERROR"]],
];

async function ingestOverHttpJson(records: Array<JSONObject>): Promise<void> {
  await ingestDecodedBody(
    await decodeJob(
      await postOverHttp(
        Buffer.from(JSON.stringify(otlpJsonRequest(records)), "utf-8"),
        "application/json",
      ),
    ),
  );
}

function resetRows(): void {
  logRows = [];
  exceptionRows = [];
  exceptionUpserts = [];
  mockEnqueuedJobs.length = 0;
}

function routeMatrix(): Array<[string, number]> {
  return ROUTES.map((route: Route, routeIndex: number): [string, number] => {
    return [route.label, routeIndex];
  });
}

describe("a record that sets only its severityText (issue #8248)", () => {
  describe("every short name and numbered step the spec gives, through every producer", () => {
    const matrix: Array<[string, string, number, number, SeverityCase]> = [];
    ROUTES.forEach((route: Route, routeIndex: number) => {
      for (const severity of SEVERITY_TEXT_CASES) {
        matrix.push([
          route.label,
          severity.name,
          severity.number,
          routeIndex,
          severity,
        ]);
      }
    });

    test.each(matrix)(
      "%s: severityText %s with no severityNumber is stored as %i and its level",
      async (
        _label: string,
        _name: string,
        _number: number,
        routeIndex: number,
        severity: SeverityCase,
      ) => {
        const body: JSONObject = await ROUTES[routeIndex]!.decode(
          otlpJsonRequest([
            logRecordWithText({
              severityText: severity.name,
              bodySeverity: severity.number,
            }),
          ]),
        );
        // The decoder hands the text on, and no number but UNSPECIFIED.
        expect(decodedRecords(body)[0]!["severityText"]).toBe(severity.name);
        expect(
          OtelLogsIngestService.normalizeSeverityNumber(
            decodedRecords(body)[0]!["severityNumber"],
          ),
        ).toBe(0);

        await ingestDecodedBody(body);

        expectStoredSeverity({
          severityNumber: severity.number,
          text: severity.text,
          bodyScanned: severity.bodyScanned,
          bodySeverity: severity.number,
        });
      },
    );
  });

  test.each(OTHER_SPELLINGS)(
    "the spelling %s is stored as %i (%s), in any case and with spaces around it",
    async (spelling: string, severityNumber: number, text: LogSeverity) => {
      for (const written of [
        spelling,
        spelling.toUpperCase(),
        `${spelling.charAt(0).toUpperCase()}${spelling.slice(1)}`,
        ` ${spelling}\t`,
      ]) {
        resetRows();

        await ingestOverHttpJson([
          logRecordWithText({
            severityText: written,
            bodySeverity: severityNumber,
          }),
        ]);

        expectStoredSeverity({
          severityNumber: severityNumber,
          text: text,
          bodyScanned: severityNumber >= 17,
          bodySeverity: severityNumber,
        });
      }
    },
  );

  test.each([
    ["info", 9, LogSeverity.Information],
    ["Warn", 13, LogSeverity.Warning],
    ["error", 17, LogSeverity.Error],
    ["eRrOr3", 19, LogSeverity.Error],
    ["fatal4", 24, LogSeverity.Fatal],
    ["trace2", 2, LogSeverity.Trace],
    [" DEBUG ", 5, LogSeverity.Debug],
  ])(
    "a short name in any case, %p, is stored as %i (%s)",
    async (written: string, severityNumber: number, text: LogSeverity) => {
      await ingestOverHttpJson([
        logRecordWithText({
          severityText: written,
          bodySeverity: severityNumber,
        }),
      ]);

      expectStoredSeverity({
        severityNumber: severityNumber,
        text: text,
        bodyScanned: severityNumber >= 17,
        bodySeverity: severityNumber,
      });
    },
  );

  test.each(TEXT_THAT_NAMES_NOTHING)(
    "%s (%p) with no severityNumber is stored as 0 / Unspecified, and not scanned",
    async (_label: string, written: unknown) => {
      await ingestOverHttpJson([
        logRecordWithText({ severityText: written, bodySeverity: 21 }),
      ]);

      expectStoredSeverity({
        severityNumber: 0,
        text: LogSeverity.Unspecified,
        bodyScanned: false,
        bodySeverity: 21,
      });
    },
  );

  describe("with a severityNumber too, the number wins", () => {
    test.each(routeMatrix())(
      "%s: INFO (9) with severityText ERROR is stored as 9 / Information, and not scanned",
      async (_label: string, routeIndex: number) => {
        await ingestDecodedBody(
          await ROUTES[routeIndex]!.decode(
            otlpJsonRequest([
              logRecordWithText({
                severityNumber: 9,
                severityText: "ERROR",
                bodySeverity: 9,
              }),
            ]),
          ),
        );

        expectStoredSeverity({
          severityNumber: 9,
          text: LogSeverity.Information,
          bodyScanned: false,
          bodySeverity: 9,
        });
      },
    );

    test.each(routeMatrix())(
      "%s: ERROR2 (18) with severityText INFO is stored as 18 / Error, and scanned",
      async (_label: string, routeIndex: number) => {
        await ingestDecodedBody(
          await ROUTES[routeIndex]!.decode(
            otlpJsonRequest([
              logRecordWithText({
                severityNumber: 18,
                severityText: "INFO",
                bodySeverity: 18,
              }),
            ]),
          ),
        );

        expectStoredSeverity({
          severityNumber: 18,
          text: LogSeverity.Error,
          bodyScanned: true,
          bodySeverity: 18,
        });
      },
    );

    test("a number spelled as its enum name wins over the text as well", async () => {
      await ingestOverHttpJson([
        logRecordWithText({
          severityNumber: "SEVERITY_NUMBER_WARN",
          severityText: "FATAL",
          bodySeverity: 13,
        }),
      ]);

      expectStoredSeverity({
        severityNumber: 13,
        text: LogSeverity.Warning,
        bodyScanned: false,
        bodySeverity: 13,
      });
    });

    test("an explicit UNSPECIFIED number (0) is no number: the text names the severity", async () => {
      await ingestOverHttpJson([
        logRecordWithText({
          severityNumber: 0,
          severityText: "WARN",
          bodySeverity: 13,
        }),
      ]);

      expectStoredSeverity({
        severityNumber: 13,
        text: LogSeverity.Warning,
        bodyScanned: false,
        bodySeverity: 13,
      });
    });

    test("so is SEVERITY_NUMBER_UNSPECIFIED, the name protobuf and gRPC give 0", async () => {
      await ingestOverHttpJson([
        logRecordWithText({
          severityNumber: "SEVERITY_NUMBER_UNSPECIFIED",
          severityText: "ERROR",
          bodySeverity: 17,
        }),
      ]);

      expectStoredSeverity({
        severityNumber: 17,
        text: LogSeverity.Error,
        bodyScanned: true,
        bodySeverity: 17,
      });
    });

    test("a number no SeverityNumber is (25) is no number either: the text names the severity", async () => {
      await ingestOverHttpJson([
        logRecordWithText({
          severityNumber: 25,
          severityText: "error",
          bodySeverity: 17,
        }),
      ]);

      expectStoredSeverity({
        severityNumber: 17,
        text: LogSeverity.Error,
        bodyScanned: true,
        bodySeverity: 17,
      });
    });
  });

  test("with neither field the record is stored as 0 / Unspecified, as before", async () => {
    await ingestOverHttpJson([logRecordWithText({ bodySeverity: 21 })]);

    expectStoredSeverity({
      severityNumber: 0,
      text: LogSeverity.Unspecified,
      bodyScanned: false,
      bodySeverity: 21,
    });
  });

  test("a mixed batch keeps each record's own severity: number only, text only, both and neither", async () => {
    await ingestOverHttpJson([
      logRecordWithText({ severityNumber: 13, bodySeverity: 1 }),
      logRecordWithText({ severityText: "ERROR", bodySeverity: 2 }),
      logRecordWithText({
        severityNumber: 5,
        severityText: "FATAL",
        bodySeverity: 3,
      }),
      logRecordWithText({ bodySeverity: 4 }),
      logRecordWithText({ severityText: "notice", bodySeverity: 5 }),
    ]);

    expect(
      logRows.map((row: JSONObject) => {
        return [row["severityNumber"], row["severityText"]];
      }),
    ).toEqual([
      [13, LogSeverity.Warning],
      [17, LogSeverity.Error],
      [5, LogSeverity.Debug],
      [0, LogSeverity.Unspecified],
      [10, LogSeverity.Information],
    ]);
    // Only the record its text made an ERROR is scanned for a stack trace.
    expect(
      exceptionRows.map((row: JSONObject) => {
        return row["message"];
      }),
    ).toEqual(["severity probe 2"]);
  });

  describe("severityNumberFromText", () => {
    test("names every SeverityNumber from 1 to 24 by its short name or numbered step, in either case", () => {
      expect(SEVERITY_TEXT_CASES).toHaveLength(24);

      for (const severity of SEVERITY_TEXT_CASES) {
        expect([
          OtelLogsIngestService.severityNumberFromText(severity.name),
          OtelLogsIngestService.severityNumberFromText(
            severity.name.toLowerCase(),
          ),
        ]).toEqual([severity.number, severity.number]);
      }
    });

    test.each(OTHER_SPELLINGS)(
      "%s -> %i",
      (spelling: string, severityNumber: number) => {
        expect(OtelLogsIngestService.severityNumberFromText(spelling)).toBe(
          severityNumber,
        );
      },
    );

    test.each(TEXT_THAT_NAMES_NOTHING)(
      "%s (%p) -> 0",
      (_label: string, written: unknown) => {
        expect(OtelLogsIngestService.severityNumberFromText(written)).toBe(0);
      },
    );

    test("undefined -> 0", () => {
      expect(OtelLogsIngestService.severityNumberFromText(undefined)).toBe(0);
    });

    /*
     * The Logs monitor page tells people which texts name a severity
     * (### Log severity). Every one it names, in every language's page, is
     * one this maps - and every page names the same ones.
     */
    test("names a severity for every text the Logs monitor page lists, in every language", () => {
      const docsDir: string = path.resolve(
        __dirname,
        "..",
        "..",
        "FeatureSet",
        "Docs",
        "Content",
      );
      const languages: Array<string> = fs
        .readdirSync(docsDir)
        .filter((language: string): boolean => {
          return fs.existsSync(
            path.join(docsDir, language, "monitor", "logs-monitor.md"),
          );
        });

      expect(languages).toContain("en");
      expect(languages.length).toBeGreaterThan(1);

      const namedIn: (language: string) => Array<string> = (
        language: string,
      ): Array<string> => {
        const page: string = fs.readFileSync(
          path.join(docsDir, language, "monitor", "logs-monitor.md"),
          "utf-8",
        );
        const paragraph: string | undefined = page
          .split("\n")
          .find((line: string): boolean => {
            return line.includes("`WARN2`");
          });

        expect({ language, found: Boolean(paragraph) }).toEqual({
          language,
          found: true,
        });

        return Array.from(
          (paragraph as string).matchAll(/`([^`]+)`/g),
          (match: RegExpMatchArray): string => {
            return match[1] as string;
          },
        );
      };

      const named: Array<string> = namedIn("en");

      expect(named).toEqual([
        "TRACE",
        "DEBUG",
        "INFO",
        "WARN",
        "ERROR",
        "FATAL",
        "WARN2",
        "warning",
        "notice",
        "critical",
        "emerg",
      ]);

      for (const written of named) {
        expect({
          written,
          named: OtelLogsIngestService.severityNumberFromText(written) > 0,
        }).toEqual({ written, named: true });
      }

      for (const language of languages) {
        expect({ language, named: namedIn(language) }).toEqual({
          language,
          named,
        });
      }
    });

    test("every number it gives is a SeverityNumber from 1 to 24, so the row's text and number agree", () => {
      for (const written of [
        ...SEVERITY_TEXT_CASES.map((severity: SeverityCase): string => {
          return severity.name;
        }),
        ...OTHER_SPELLINGS.map(
          (spelling: [string, number, LogSeverity]): string => {
            return spelling[0];
          },
        ),
      ]) {
        const severityNumber: number =
          OtelLogsIngestService.severityNumberFromText(written);

        expect({ written, severityNumber }).toEqual({
          written,
          severityNumber:
            OtelLogsIngestService.normalizeSeverityNumber(severityNumber),
        });
        expect(severityNumber).toBeGreaterThanOrEqual(1);
        expect(severityNumber).toBeLessThanOrEqual(24);
      }
    });
  });
});
