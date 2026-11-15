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
import OtelPayloadDecoder, {
  OtelPayloadFormat,
} from "../../FeatureSet/Telemetry/Utils/OtelPayloadDecoder";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import DockerResourceService, {
  ParsedDockerResource,
} from "Common/Server/Services/DockerResourceService";
import DockerSwarmClusterService from "Common/Server/Services/DockerSwarmClusterService";
import DockerSwarmResourceService, {
  ParsedDockerSwarmResource,
} from "Common/Server/Services/DockerSwarmResourceService";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import KubernetesResourceService from "Common/Server/Services/KubernetesResourceService";
import LogService from "Common/Server/Services/LogService";
import PodmanResourceService, {
  ParsedPodmanResource,
} from "Common/Server/Services/PodmanResourceService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import TelemetryFanInWriter, {
  FanInInsertTarget,
} from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import OneUptimeDate from "Common/Types/Date";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import { ParsedKubernetesResource } from "Common/Types/Kubernetes/KubernetesInventoryExtractor";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import TelemetryIngestionKeyPolicy from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { toOtlpAnyValue } from "Common/Tests/Helpers/KubernetesEventRecords";

/*
 * #6395: an OTLP log record that sends no time of its own is stored at its
 * observed time - OpenTelemetry's logs data model: "Use time_unix_nano if
 * it is present, otherwise use observed_time_unix_nano" - and only one
 * that sends neither at the time it arrived. Before, every record without
 * its own time was stored at the time it arrived: after its exporter's
 * batch delay, its retries and the ingest queue.
 *
 * Each record goes through the real production path of each OTLP route -
 * protobuf and OTLP/JSON through the OTLP/HTTP middleware and handler, gRPC
 * through the Export deserializer built with GrpcServer's own proto-loader
 * options and the real handleExport - then OtelPayloadDecoder and
 * OtelLogsIngestService, and the row the log writer is handed is read. Only
 * the persistence edges are replaced: Redis (body store, BullMQ),
 * ClickHouse (the fan-in writer), Postgres (resource resolution, pipelines,
 * drop filters, scrub rules, the exception upsert, the inventory upserts)
 * and the ingestion-key lookup. OtelLogsObservedTimeClickhouse writes the
 * same rows to a real ClickHouse.
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
        const key: string = `telemetry:body:observed-${mockStoredBodies.size + 1}`;
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
const CLUSTER_ID: ObjectID = ObjectID.generate();
const DOCKER_HOST_ID: ObjectID = ObjectID.generate();
const PODMAN_HOST_ID: ObjectID = ObjectID.generate();
const SWARM_ID: ObjectID = ObjectID.generate();
const SERVICE_NAME: string = "checkout";
const INGESTION_TOKEN: string = "logs-observed-time-token";

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

// 2026-11-09T10:00:00.123456789Z: when the record says it happened.
const OWN_TIME: string = "1794218400123456789";
const OWN_TIME_COLUMN: string = "2026-11-09 10:00:00.123456789";
// 2026-11-09T10:00:00.124000001Z: when its SDK observed it.
const OBSERVED_TIME: string = "1794218400124000001";
const OBSERVED_TIME_COLUMN: string = "2026-11-09 10:00:00.124000001";
// 2026-11-09T10:00:01.500000300Z: another record's observed time.
const OTHER_OBSERVED_TIME: string = "1794218401500000300";
const OTHER_OBSERVED_TIME_COLUMN: string = "2026-11-09 10:00:01.500000300";
// When the records arrive here: seconds after, on the server's clock.
const ARRIVED_AT_MS: number = Date.UTC(2026, 10, 9, 10, 0, 7, 250);
const ARRIVED_AT_NANO: string = `${ARRIVED_AT_MS}000000`;
const ARRIVED_AT_COLUMN: string = "2026-11-09 10:00:07.250000000";

// The last nanosecond the Log table holds, and one a fixed64 holds past it.
const LAST_STORABLE: string = "9223372036854775807";
const PAST_THE_TABLE: string = "9300000000000000000";

function stringAttribute(
  key: string,
  value: string,
): { key: string; value: { stringValue: string } } {
  return { key: key, value: { stringValue: value } };
}

function otlpRequest(
  records: Array<JSONObject>,
  resource: Array<JSONObject> = [stringAttribute("service.name", SERVICE_NAME)],
): JSONObject {
  return {
    resourceLogs: [
      {
        resource: { attributes: resource },
        scopeLogs: [{ scope: { name: "observed-time" }, logRecords: records }],
      },
    ],
  };
}

function record(
  body: string,
  times: { timeUnixNano?: unknown; observedTimeUnixNano?: unknown },
): JSONObject {
  return {
    ...(times as JSONObject),
    severityNumber: 9,
    body: { stringValue: body },
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

// What a Go or Java encoder writes: a time that is not set is not sent.
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
  "autoDiscoverIoTFleet",
  "autoDiscoverDatabaseServer",
  "autoDiscoverOpenStackCloud",
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IngestTestMethods = Record<string, any>;

let logRows: Array<JSONObject>;
let exceptionRows: Array<JSONObject>;
let exceptionUpserts: Array<TelemetryExceptionPayload>;
let timeWarnings: Array<string>;

beforeEach(() => {
  logRows = [];
  exceptionRows = [];
  exceptionUpserts = [];
  timeWarnings = [];
  mockEnqueuedJobs.length = 0;
  mockStoredBodies.clear();

  const ingest: IngestTestMethods =
    OtelLogsIngestService as unknown as IngestTestMethods;
  for (const method of AUTO_DISCOVERY_METHODS) {
    if (typeof ingest[method] === "function") {
      jest.spyOn(ingest, method).mockResolvedValue(null);
    }
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

  // The server's clock, read as the records arrive.
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation((): Date => {
    return new Date(ARRIVED_AT_MS);
  });

  // What ingest says about a record's time, and nothing else it logs.
  const warn: typeof logger.warn = logger.warn.bind(logger);
  jest.spyOn(logger, "warn").mockImplementation(((
    message: unknown,
    ...rest: Array<unknown>
  ): void => {
    if (String(message).startsWith("Error processing timestamp")) {
      timeWarnings.push(String(message));
      return;
    }
    (warn as (...args: Array<unknown>) => void)(message, ...rest);
  }) as typeof logger.warn);
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
  const job: TelemetryIngestJobData = JSON.parse(
    JSON.stringify(mockEnqueuedJobs[0]),
  ) as TelemetryIngestJobData;
  mockEnqueuedJobs.length = 0;
  return job;
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

// OTLP/HTTP: OtelRequestMiddleware reads the body, the logs handler enqueues.
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

// gRPC without a socket: the Export deserializer, then the real handleExport.
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
  expect(job.bodyFormat).toBe(OtelPayloadFormat.Json);
  return job;
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

function decodedRecords(body: JSONObject): Array<JSONObject> {
  return (
    (body["resourceLogs"] as JSONArray)[0]!["scopeLogs"] as JSONArray
  )[0]!["logRecords"] as Array<JSONObject>;
}

// The two times each decoded record carries, as the route spells them.
function decodedTimes(body: JSONObject): Array<JSONObject> {
  return decodedRecords(body).map((decoded: JSONObject): JSONObject => {
    const times: JSONObject = {};
    for (const key of ["timeUnixNano", "observedTimeUnixNano"]) {
      if (decoded[key] !== undefined) {
        times[key] = decoded[key];
      }
    }
    return times;
  });
}

// What the log writer was handed: each row's three time columns.
function storedTimes(): Array<Array<unknown>> {
  return logRows.map((row: JSONObject): Array<unknown> => {
    return [
      row["body"],
      row["time"],
      row["timeUnixNano"],
      row["observedTimeUnixNano"],
    ];
  });
}

/*
 * ---------------------------------------------------------------------------
 * Tests.
 * ---------------------------------------------------------------------------
 */
describe("each OTLP route stores a record at its own time, else its observed time, else when it arrived", () => {
  test.each(
    ROUTES.map((route: Route): [string, Route] => {
      return [route.label, route];
    }),
  )(
    "%s: both times, only the observed time, and neither",
    async (_label: string, route: Route) => {
      const body: JSONObject = await route.decode(
        otlpRequest([
          record("both", {
            timeUnixNano: OWN_TIME,
            observedTimeUnixNano: OBSERVED_TIME,
          }),
          record("observed only", {
            observedTimeUnixNano: OTHER_OBSERVED_TIME,
          }),
          record("neither", {}),
        ]),
      );

      /*
       * Every route hands the worker the times as digits, and leaves out
       * a time that was not sent.
       */
      expect(decodedTimes(body)).toEqual([
        { timeUnixNano: OWN_TIME, observedTimeUnixNano: OBSERVED_TIME },
        { observedTimeUnixNano: OTHER_OBSERVED_TIME },
        {},
      ]);

      await ingestDecodedBody(body);

      expect(storedTimes()).toEqual([
        ["both", OWN_TIME_COLUMN, OWN_TIME, OBSERVED_TIME],
        // Before #6395: stored at the time it arrived, 10:00:07.25.
        [
          "observed only",
          OTHER_OBSERVED_TIME_COLUMN,
          OTHER_OBSERVED_TIME,
          OTHER_OBSERVED_TIME,
        ],
        ["neither", ARRIVED_AT_COLUMN, ARRIVED_AT_NANO, "0"],
      ]);
      expect(timeWarnings).toEqual([]);
    },
  );

  test.each(
    ROUTES.map((route: Route): [string, Route] => {
      return [route.label, route];
    }),
  )(
    "%s: the bounds - kept up to the last nanosecond the Log table holds, a time past it is no time",
    async (_label: string, route: Route) => {
      const body: JSONObject = await route.decode(
        otlpRequest([
          record("own past the table", {
            timeUnixNano: PAST_THE_TABLE,
            observedTimeUnixNano: OBSERVED_TIME,
          }),
          record("observed past the table", {
            observedTimeUnixNano: PAST_THE_TABLE,
          }),
          record("own at the last nanosecond", {
            timeUnixNano: LAST_STORABLE,
            observedTimeUnixNano: OBSERVED_TIME,
          }),
          record("observed at the last nanosecond", {
            observedTimeUnixNano: LAST_STORABLE,
          }),
          record("own a nanosecond past the epoch", {
            timeUnixNano: "1",
            observedTimeUnixNano: OBSERVED_TIME,
          }),
          record("observed in 2200", {
            observedTimeUnixNano: "7258118400000000001",
          }),
        ]),
      );

      await ingestDecodedBody(body);

      expect(storedTimes()).toEqual([
        // Before #6395 stored past 2262-04-11: ClickHouse refused the insert.
        [
          "own past the table",
          OBSERVED_TIME_COLUMN,
          OBSERVED_TIME,
          OBSERVED_TIME,
        ],
        [
          "observed past the table",
          ARRIVED_AT_COLUMN,
          ARRIVED_AT_NANO,
          PAST_THE_TABLE,
        ],
        [
          "own at the last nanosecond",
          "2262-04-11 23:47:16.854775807",
          LAST_STORABLE,
          OBSERVED_TIME,
        ],
        [
          "observed at the last nanosecond",
          "2262-04-11 23:47:16.854775807",
          LAST_STORABLE,
          LAST_STORABLE,
        ],
        [
          "own a nanosecond past the epoch",
          "1970-01-01 00:00:00.000000001",
          "1",
          OBSERVED_TIME,
        ],
        [
          "observed in 2200",
          "2200-01-01 00:00:00.000000001",
          "7258118400000000001",
          "7258118400000000001",
        ],
      ]);
      expect(timeWarnings).toEqual([
        `Error processing timestamp ${PAST_THE_TABLE}: Timestamp out of storable range: ${PAST_THE_TABLE}, using observed time`,
      ]);
    },
  );
});

describe("what OTLP/JSON can spell that protobuf cannot", () => {
  async function postJson(records: Array<JSONObject>): Promise<void> {
    await ingestDecodedBody(await ROUTES[1]!.decode(otlpRequest(records)));
  }

  test("an own time written as a zero is OTLP's unknown time: the observed time, no longer the epoch", async () => {
    await postJson([
      record("zero text", {
        timeUnixNano: "0",
        observedTimeUnixNano: OBSERVED_TIME,
      }),
      record("zero number", {
        timeUnixNano: 0,
        observedTimeUnixNano: OTHER_OBSERVED_TIME,
      }),
      record("zeros", { timeUnixNano: "0", observedTimeUnixNano: "0" }),
    ]);

    expect(storedTimes()).toEqual([
      // Before #6395: "1970-01-01 00:00:00.000000000" and "0".
      ["zero text", OBSERVED_TIME_COLUMN, OBSERVED_TIME, OBSERVED_TIME],
      [
        "zero number",
        OTHER_OBSERVED_TIME_COLUMN,
        OTHER_OBSERVED_TIME,
        OTHER_OBSERVED_TIME,
      ],
      ["zeros", ARRIVED_AT_COLUMN, ARRIVED_AT_NANO, "0"],
    ]);
  });

  test("times written as numbers are read as the floats they always were", async () => {
    const asNumber: number = Number(OBSERVED_TIME);

    await postJson([record("a number", { observedTimeUnixNano: asNumber })]);

    expect(storedTimes()).toEqual([
      [
        "a number",
        OneUptimeDate.toClickhouseDateTime64(
          OneUptimeDate.fromUnixNano(asNumber),
          asNumber,
        ),
        Math.trunc(asNumber).toString(),
        Math.trunc(asNumber).toString(),
      ],
    ]);
  });

  test("a time below zero, or text that is no time: never written where ClickHouse refuses it", async () => {
    await postJson([
      record("own below zero", {
        timeUnixNano: "-5",
        observedTimeUnixNano: OBSERVED_TIME,
      }),
      record("observed below zero", { observedTimeUnixNano: "-5" }),
      record("own no time", {
        timeUnixNano: "soon",
        observedTimeUnixNano: OBSERVED_TIME,
      }),
      record("observed no time", { observedTimeUnixNano: "soon" }),
    ]);

    expect(storedTimes()).toEqual([
      // Before #6395 "-5" went to the UInt64 timeUnixNano column: insert refused.
      ["own below zero", OBSERVED_TIME_COLUMN, OBSERVED_TIME, OBSERVED_TIME],
      // ...and to the observedTimeUnixNano column.
      ["observed below zero", ARRIVED_AT_COLUMN, ARRIVED_AT_NANO, "0"],
      ["own no time", OBSERVED_TIME_COLUMN, OBSERVED_TIME, OBSERVED_TIME],
      ["observed no time", ARRIVED_AT_COLUMN, ARRIVED_AT_NANO, "0"],
    ]);
    expect(timeWarnings).toEqual([
      "Error processing timestamp soon: Invalid timestamp string: soon, using observed time",
    ]);
  });

  test("an observed time with a fraction is stored, and kept, in whole nanoseconds", async () => {
    await postJson([
      record("fraction text", { observedTimeUnixNano: "1500.75" }),
      record("fraction number", { observedTimeUnixNano: 2500.25 }),
    ]);

    /*
     * Before #6395 both were stored when they arrived. At their observed
     * time now, in whole nanoseconds: the time column cannot hold a
     * fraction's point ("00:00:00.000001500.75" is refused).
     */
    expect(storedTimes()).toEqual([
      ["fraction text", "1970-01-01 00:00:00.000001500", "1500", "1500"],
      ["fraction number", "1970-01-01 00:00:00.000002500", "2500", "2500"],
    ]);
    expect(timeWarnings).toEqual([]);
  });
});

describe("what reads a record's time at ingest", () => {
  test("an exception logged with only an observed time happened then", async () => {
    await ingestDecodedBody(
      await ROUTES[0]!.decode(
        otlpRequest([
          {
            observedTimeUnixNano: OBSERVED_TIME,
            severityNumber: 17,
            body: { stringValue: "Payment failed" },
            attributes: [
              stringAttribute("exception.type", "PaymentError"),
              stringAttribute("exception.message", "Payment failed"),
              stringAttribute(
                "exception.stacktrace",
                "PaymentError: Payment failed\n    at charge (pay.js:10:5)",
              ),
            ],
          },
        ]),
      ),
    );

    expect(logRows).toHaveLength(1);
    expect(exceptionRows).toHaveLength(1);
    expect(exceptionRows[0]!["time"]).toBe("2026-11-09 10:00:00");
    expect(exceptionRows[0]!["timeUnixNano"]).toBe(OBSERVED_TIME);
    expect(exceptionUpserts).toHaveLength(1);
    expect(exceptionUpserts[0]!.occurredAt!.toISOString()).toBe(
      "2026-11-09T10:00:00.124Z",
    );
  });

  describe("an inventory snapshot", () => {
    interface Inventory {
      kubernetes: Array<ParsedKubernetesResource>;
      docker: Array<ParsedDockerResource>;
      podman: Array<ParsedPodmanResource>;
      swarm: Array<ParsedDockerSwarmResource>;
    }

    // Every agent's resource known, so every inventory hook runs.
    function captureInventory(): Inventory {
      const inventory: Inventory = {
        kubernetes: [],
        docker: [],
        podman: [],
        swarm: [],
      };
      const ingest: IngestTestMethods =
        OtelLogsIngestService as unknown as IngestTestMethods;

      jest
        .spyOn(ingest, "autoDiscoverKubernetesCluster")
        .mockResolvedValue(CLUSTER_ID);
      jest
        .spyOn(ingest, "autoDiscoverDockerHost")
        .mockResolvedValue(DOCKER_HOST_ID);
      jest
        .spyOn(ingest, "autoDiscoverPodmanHost")
        .mockResolvedValue(PODMAN_HOST_ID);
      jest
        .spyOn(ingest, "autoDiscoverDockerSwarmCluster")
        .mockResolvedValue(SWARM_ID);

      jest
        .spyOn(KubernetesResourceService, "bulkUpsert")
        .mockImplementation(async (...args: Array<unknown>): Promise<void> => {
          inventory.kubernetes.push(
            ...(args[0] as { resources: Array<ParsedKubernetesResource> })
              .resources,
          );
        });
      jest
        .spyOn(DockerResourceService, "bulkUpsert")
        .mockImplementation(async (...args: Array<unknown>): Promise<void> => {
          inventory.docker.push(
            ...(args[0] as { resources: Array<ParsedDockerResource> })
              .resources,
          );
        });
      jest
        .spyOn(PodmanResourceService, "bulkUpsert")
        .mockImplementation(async (...args: Array<unknown>): Promise<void> => {
          inventory.podman.push(
            ...(args[0] as { resources: Array<ParsedPodmanResource> })
              .resources,
          );
        });
      jest
        .spyOn(DockerSwarmResourceService, "bulkUpsert")
        .mockImplementation(async (...args: Array<unknown>): Promise<void> => {
          inventory.swarm.push(
            ...(args[0] as { resources: Array<ParsedDockerSwarmResource> })
              .resources,
          );
        });
      jest
        .spyOn(DockerSwarmClusterService, "updateLastSeen")
        .mockResolvedValue(undefined as never);

      return inventory;
    }

    // One snapshot record of each agent, at the times given.
    function snapshotRecords(times: JSONObject): Array<JSONObject> {
      return [
        {
          ...times,
          severityNumber: 9,
          attributes: [stringAttribute("k8s.resource.name", "namespaces")],
          body: toOtlpAnyValue({
            apiVersion: "v1",
            kind: "Namespace",
            metadata: { name: "shop", uid: "uid-shop" },
            status: { phase: "Active" },
          }),
        },
        {
          ...times,
          attributes: [stringAttribute("oneuptime.docker.kind", "Volume")],
          body: {
            stringValue: JSON.stringify({ Name: "data", Driver: "local" }),
          },
        },
        {
          ...times,
          attributes: [stringAttribute("oneuptime.podman.kind", "Volume")],
          body: {
            stringValue: JSON.stringify({ Name: "cache", Driver: "local" }),
          },
        },
        {
          ...times,
          attributes: [stringAttribute("oneuptime.dockerswarm.kind", "Config")],
          body: {
            stringValue: JSON.stringify({
              kind: "Config",
              data: { ID: "cfg1", Name: "nginx-conf" },
            }),
          },
        },
      ];
    }

    function lastSeen(inventory: Inventory): Array<string> {
      return [
        ...inventory.kubernetes,
        ...inventory.docker,
        ...inventory.podman,
        ...inventory.swarm,
      ].map((resource: { lastSeenAt: Date }): string => {
        return resource.lastSeenAt.toISOString();
      });
    }

    test("with only the agent's observed time is seen when it arrived, by the server's clock the stale sweep reads", async () => {
      const inventory: Inventory = captureInventory();
      // The agent's clock runs 20 minutes behind.
      const agentObserved: string = `${ARRIVED_AT_MS - 20 * 60 * 1000}000000`;

      await ingestDecodedBody(
        await ROUTES[2]!.decode(
          otlpRequest(snapshotRecords({ observedTimeUnixNano: agentObserved })),
        ),
      );

      // The log rows are stored at the observed time...
      expect(logRows).toHaveLength(4);
      for (const row of logRows) {
        expect(row["timeUnixNano"]).toBe(agentObserved);
      }

      // ...and every resource is seen at the time it arrived, as before.
      expect(lastSeen(inventory)).toEqual([
        "2026-11-09T10:00:07.250Z",
        "2026-11-09T10:00:07.250Z",
        "2026-11-09T10:00:07.250Z",
        "2026-11-09T10:00:07.250Z",
      ]);
    });

    test("with a time of its own is seen then, as before", async () => {
      const inventory: Inventory = captureInventory();

      await ingestDecodedBody(
        await ROUTES[2]!.decode(
          otlpRequest(
            snapshotRecords({
              timeUnixNano: OWN_TIME,
              observedTimeUnixNano: OBSERVED_TIME,
            }),
          ),
        ),
      );

      expect(lastSeen(inventory)).toEqual([
        "2026-11-09T10:00:00.123Z",
        "2026-11-09T10:00:00.123Z",
        "2026-11-09T10:00:00.123Z",
        "2026-11-09T10:00:00.123Z",
      ]);
    });

    test("with neither is seen when it arrived, as before", async () => {
      const inventory: Inventory = captureInventory();

      await ingestDecodedBody(
        await ROUTES[0]!.decode(otlpRequest(snapshotRecords({}))),
      );

      expect(lastSeen(inventory)).toEqual([
        "2026-11-09T10:00:07.250Z",
        "2026-11-09T10:00:07.250Z",
        "2026-11-09T10:00:07.250Z",
        "2026-11-09T10:00:07.250Z",
      ]);
    });
  });
});
