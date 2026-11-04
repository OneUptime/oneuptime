/*
 * The Queue infrastructure module pulls in BullMQ at import time; the
 * telemetry queue is replaced by the jobs it would have been handed.
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
    },
  };
});

jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

jest.mock(
  "../../FeatureSet/Telemetry/Services/Queue/MetricsQueueService",
  () => {
    return {
      __esModule: true,
      default: { addMetricIngestJob: jest.fn() },
    };
  },
);

jest.mock("../../FeatureSet/Telemetry/Services/Queue/LogsQueueService", () => {
  return {
    __esModule: true,
    default: { addLogIngestJob: jest.fn() },
  };
});

import http from "http";
import zlib from "zlib";
import { AddressInfo } from "net";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import CloudConnection from "Common/Models/DatabaseModels/CloudConnection";
import Service from "Common/Models/DatabaseModels/Service";
import Redis from "Common/Server/Infrastructure/Redis";
import CloudConnectionService from "Common/Server/Services/CloudConnectionService";
import PayAsYouGoBillingService from "Common/Server/Services/PayAsYouGoBillingService";
import ProjectService from "Common/Server/Services/ProjectService";
import CloudStreamActivity from "Common/Server/Utils/CloudConnection/CloudStreamActivity";
import CloudStreamAuthenticator from "Common/Server/Utils/CloudConnection/CloudStreamAuthentication";
import CloudStreamKeys from "Common/Server/Utils/CloudConnection/CloudStreamKeys";
import {
  createExpressApp,
  ExpressApplication,
} from "Common/Server/Utils/Express";
import LlmConnectionPullRunner from "Common/Server/Utils/LlmObservability/LlmConnectionPullRunner";
import TelemetryUtil from "Common/Server/Utils/Telemetry/Telemetry";
import TelemetryIngestionKeyRateLimiter, {
  TelemetryIngestionKeyLimitOutcome,
} from "Common/Server/Utils/Telemetry/TelemetryIngestionKeyRateLimiter";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import {
  CloudMonitoredResource,
  resolveCloudMonitoredResource,
} from "Common/Types/Cloud/CloudMonitoredResource";
import { STORED_CLOUD_RESOURCE_ID_ATTRIBUTE } from "Common/Types/Cloud/CloudLogGroups";
import {
  CLOUD_STREAM_MAX_REQUEST_BYTES,
  CloudStreamRefusalReason,
  CloudStreamSummary,
  buildCloudStreamKey,
} from "Common/Types/CloudConnection/CloudStream";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import AwsFirehoseAPI from "../../FeatureSet/Telemetry/API/AwsFirehose";
import LogsQueueService from "../../FeatureSet/Telemetry/Services/Queue/LogsQueueService";
import MetricsQueueService from "../../FeatureSet/Telemetry/Services/Queue/MetricsQueueService";
import {
  MAX_DATAPOINTS_PER_JOB,
  STREAM_QUEUE_UNAVAILABLE_MESSAGE,
  STREAM_THROTTLED_MESSAGE,
  STREAM_TOO_LARGE_MESSAGE,
} from "../../FeatureSet/Telemetry/Services/AwsFirehoseIngestService";
import {
  ACCOUNT_ID,
  CONTROL_MESSAGE_DOCUMENT,
  FirehoseReply,
  LOGS_FIREHOSE_ARN,
  METRICS_FIREHOSE_ARN,
  MINUTE_START_MS,
  REGION,
  cloudWatchLogsDocument,
  cloudWatchLogsRecord,
  firehoseEnvelope,
  jsonMetricRecord,
  jsonMetricUpdate,
  openTelemetryMetric,
  openTelemetryRecord,
  openTelemetryRequest,
  sendFirehoseDelivery,
} from "./Helpers/FakeFirehose";

/*
 * A FAKE FIREHOSE AGAINST THE REAL ENDPOINT, OVER A REAL SOCKET.
 *
 * The stream endpoint's router, mounted as the Telemetry feature set mounts
 * it, is sent what Amazon Data Firehose sends - its headers, its envelope,
 * gzip on the wire - around records in the shapes CloudWatch writes them:
 * metric streams in OpenTelemetry 1.0 and in JSON, CloudWatch Logs
 * subscription deliveries and their test message. Who a delivery is from
 * is decided by the real authenticator, over connections of two projects;
 * the telemetry queue is replaced by the jobs it is handed. Pinned:
 *
 *   - every answer is Firehose's: 200 with the request's id and a
 *     timestamp, exactly application/json, never compressed, under 1,000
 *     bytes - refusals too, each with its errorMessage;
 *   - what Firehose sends again (401, 403, 429, 400, 503) and what it does
 *     not (413), as its contract reads;
 *   - each delivery's records land as OTLP metrics and logs of the key's
 *     project only, under the connection's service and id, filed under
 *     their cloud resource and account;
 *   - a delivery Firehose sends again after it was taken is not taken twice;
 *   - limits: the body as sent, what it decompresses to, deliveries a
 *     minute.
 *
 * `jest` is the global one.
 */

const PROJECT_A: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PROJECT_B: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const CONNECTION_A: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const CONNECTION_B: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

function keyOf(connectionId: ObjectID, pair: string): string {
  return buildCloudStreamKey({
    connectionId: connectionId.toString(),
    secret: pair.repeat(32),
  });
}

const KEY_A: string = keyOf(CONNECTION_A, "a1");
const KEY_B: string = keyOf(CONNECTION_B, "b2");

let server: http.Server;
let port: number;
let metricJobs: Array<{
  projectId: string;
  body: JSONObject;
  productType: string;
}>;
let logJobs: Array<{
  projectId: string;
  body: JSONObject;
  productType: string;
}>;
let summaries: Map<string, CloudStreamSummary>;
let rateDecision: TelemetryIngestionKeyLimitOutcome;
let queueFails: boolean;
let ledger: Map<string, string>;
let requestCounter: number = 0;

function connectionRow(data: {
  id: ObjectID;
  projectId: ObjectID;
  key: string;
  serviceName: string;
  isEnabled?: boolean;
}): CloudConnection {
  const connection: CloudConnection = new CloudConnection();
  connection.id = data.id;
  connection.projectId = data.projectId;
  connection.provider = CloudProvider.AWS;
  connection.isEnabled = data.isEnabled !== false;
  connection.serviceId = ObjectID.generate();
  const service: Service = new Service();
  service.name = data.serviceName;
  connection.service = service;
  connection.streamKeyHashes = {
    current: {
      hash: CloudStreamKeys.hash(data.key),
      createdAt: new Date().toISOString(),
    },
  };
  return connection;
}

let rows: Map<string, CloudConnection>;

function nextRequestId(): string {
  requestCounter++;
  return `ed4acda5-034f-9f42-bba1-${String(requestCounter).padStart(12, "0")}`;
}

async function deliver(data: {
  path?: string;
  key?: string | undefined;
  records: Array<Buffer>;
  requestId?: string;
  sourceArn?: string;
  gzip?: boolean;
}): Promise<FirehoseReply> {
  const requestId: string = data.requestId || nextRequestId();

  return await sendFirehoseDelivery({
    port,
    path: data.path || "/telemetry/aws-firehose/v1/metrics",
    accessKey: "key" in data ? data.key : KEY_A,
    requestId,
    sourceArn: data.sourceArn || METRICS_FIREHOSE_ARN,
    body: firehoseEnvelope({ requestId, records: data.records }),
    gzip: data.gzip,
  });
}

function expectFirehoseAnswer(
  reply: FirehoseReply,
  data: { status: number; requestId?: string; errorMessage?: string },
): void {
  expect(reply.status).toBe(data.status);
  // Exactly application/json, never compressed, with its length, under a kilobyte.
  expect(reply.headers["content-type"]).toBe("application/json");
  expect(reply.headers["content-encoding"]).toBeUndefined();
  expect(Number(reply.headers["content-length"])).toBe(
    Buffer.byteLength(reply.text, "utf8"),
  );
  expect(Buffer.byteLength(reply.text, "utf8")).toBeLessThan(1000);
  expect(typeof reply.body["requestId"]).toBe("string");
  expect(typeof reply.body["timestamp"]).toBe("number");

  if (data.requestId !== undefined) {
    expect(reply.body["requestId"]).toBe(data.requestId);
  }

  if (data.errorMessage !== undefined) {
    expect(reply.body["errorMessage"]).toBe(data.errorMessage);
  } else if (data.status === 200) {
    expect(reply.body["errorMessage"]).toBeUndefined();
  }
}

function resourceAttribute(
  resource: JSONObject,
  key: string,
): string | undefined {
  const attributes: Array<JSONObject> = (resource["resource"] as JSONObject)[
    "attributes"
  ] as Array<JSONObject>;
  const found: JSONObject | undefined = attributes.find(
    (attribute: JSONObject) => {
      return attribute["key"] === key;
    },
  );
  return found
    ? ((found["value"] as JSONObject)["stringValue"] as string)
    : undefined;
}

const EC2_CPU: JSONObject = openTelemetryMetric({
  namespace: "AWS/EC2",
  metricName: "CPUUtilization",
  dimensions: { InstanceId: "i-0abc123def" },
  count: 1,
  sum: 12.5,
  min: 12.5,
  max: 12.5,
});

const LAMBDA_EVENTS: Array<{ id: string; timestamp: number; message: string }> =
  [
    {
      id: "31953106606966983378809025079804211143289615424298221568",
      timestamp: MINUTE_START_MS + 1000,
      message:
        "START RequestId: 0b1d2c3e-1111-2222-3333-444455556666 Version: $LATEST\n",
    },
    {
      id: "31953106606966983378809025079804211143289615424298221569",
      timestamp: MINUTE_START_MS + 1200,
      message:
        "2026-11-04T09:59:01.200Z\t0b1d2c3e-1111-2222-3333-444455556666\tERROR\tPayment failed: card declined\n",
    },
    {
      id: "31953106606966983378809025079804211143289615424298221570",
      timestamp: MINUTE_START_MS + 1300,
      message:
        '{"timestamp":"2026-11-04T09:59:01.300Z","level":"WARN","message":"retrying"}',
    },
  ];

beforeAll(async () => {
  const app: ExpressApplication = createExpressApp();
  app.use(["/telemetry", "/"], AwsFirehoseAPI);

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
  metricJobs = [];
  logJobs = [];
  summaries = new Map();
  rateDecision = TelemetryIngestionKeyLimitOutcome.Allowed;
  queueFails = false;
  ledger = new Map();

  rows = new Map();
  rows.set(
    CONNECTION_A.toString(),
    connectionRow({
      id: CONNECTION_A,
      projectId: PROJECT_A,
      key: KEY_A,
      serviceName: "Production AWS",
    }),
  );
  rows.set(
    CONNECTION_B.toString(),
    connectionRow({
      id: CONNECTION_B,
      projectId: PROJECT_B,
      key: KEY_B,
      serviceName: "Staging AWS",
    }),
  );

  CloudStreamAuthenticator.forget(CONNECTION_A);
  CloudStreamAuthenticator.forget(CONNECTION_B);
  CloudStreamActivity.reset();

  jest
    .spyOn(CloudConnectionService, "findOneById")
    .mockImplementation((async (data: { id: ObjectID }) => {
      return rows.get(data.id.toString()) || null;
    }) as never);
  jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
  jest
    .spyOn(PayAsYouGoBillingService, "requirePayAsYouGo")
    .mockResolvedValue(undefined);
  jest
    .spyOn(LlmConnectionPullRunner, "isTelemetryAllowed")
    .mockResolvedValue(true);
  jest
    .spyOn(TelemetryIngestionKeyRateLimiter, "consume")
    .mockImplementation(async () => {
      return rateDecision === TelemetryIngestionKeyLimitOutcome.RateLimited
        ? {
            outcome: rateDecision,
            retryAfterSeconds: 17,
            isFirstRejectionInWindow: true,
          }
        : { outcome: rateDecision };
    });

  // A Redis that holds the ledger of deliveries taken.
  jest.spyOn(Redis, "isConnected").mockReturnValue(true);
  jest.spyOn(Redis, "getClient").mockReturnValue({
    get: async (key: string): Promise<string | null> => {
      return ledger.get(key) ?? null;
    },
    set: async (key: string, value: string): Promise<string> => {
      ledger.set(key, value);
      return "OK";
    },
  } as never);

  (MetricsQueueService.addMetricIngestJob as jest.Mock).mockImplementation(
    async (job: unknown): Promise<void> => {
      if (queueFails) {
        throw new Error("Redis is away");
      }

      const request: JSONObject = job as JSONObject;
      metricJobs.push({
        projectId: (request["projectId"] as ObjectID).toString(),
        body: request["body"] as JSONObject,
        productType: request["productType"] as string,
      });
    },
  );
  (LogsQueueService.addLogIngestJob as jest.Mock).mockImplementation(
    async (job: unknown): Promise<void> => {
      if (queueFails) {
        throw new Error("Redis is away");
      }

      const request: JSONObject = job as JSONObject;
      logJobs.push({
        projectId: (request["projectId"] as ObjectID).toString(),
        body: request["body"] as JSONObject,
        productType: request["productType"] as string,
      });
    },
  );

  CloudStreamActivity.readSummary = async (
    connectionId: ObjectID,
  ): Promise<CloudStreamSummary> => {
    return (
      summaries.get(connectionId.toString()) || {
        metricSources: [],
        logSources: [],
      }
    );
  };
  CloudStreamActivity.writeSummary = async (data: {
    connectionId: ObjectID;
    summary: CloudStreamSummary;
  }): Promise<void> => {
    summaries.set(data.connectionId.toString(), data.summary);
  };
});

afterEach(() => {
  jest.restoreAllMocks();
  (MetricsQueueService.addMetricIngestJob as jest.Mock).mockReset();
  (LogsQueueService.addLogIngestJob as jest.Mock).mockReset();
});

async function settle(): Promise<void> {
  for (let index: number = 0; index < 5; index++) {
    await new Promise<void>((resolve: () => void) => {
      setImmediate(resolve);
    });
  }
}

describe("a metric stream in OpenTelemetry 1.0", () => {
  test("is taken: 200 with the request's id, and queued as the connection's metrics", async () => {
    const requestId: string = nextRequestId();
    const reply: FirehoseReply = await deliver({
      requestId,
      records: [openTelemetryRecord([openTelemetryRequest([EC2_CPU])])],
    });

    expectFirehoseAnswer(reply, { status: 200, requestId });
    expect(metricJobs).toHaveLength(1);
    expect(metricJobs[0]!.projectId).toBe(PROJECT_A.toString());
    expect(metricJobs[0]!.productType).toBe(ProductType.Metrics);

    const resource: JSONObject = (
      metricJobs[0]!.body["resourceMetrics"] as Array<JSONObject>
    )[0]!;

    expect(resourceAttribute(resource, "service.name")).toBe("Production AWS");
    expect(resourceAttribute(resource, "oneuptime.cloud.connection.id")).toBe(
      CONNECTION_A.toString(),
    );
    expect(resourceAttribute(resource, "cloud.account.id")).toBe(ACCOUNT_ID);
    expect(resourceAttribute(resource, "cloud.region")).toBe(REGION);
    expect(resourceAttribute(resource, "aws.exporter.arn")).toContain(
      "metric-stream/OneUptime-6f1c3a2e",
    );

    const metric: JSONObject = (
      (resource["scopeMetrics"] as Array<JSONObject>)[0]![
        "metrics"
      ] as Array<JSONObject>
    )[0]!;
    const point: JSONObject = (
      (metric["summary"] as JSONObject)["dataPoints"] as Array<JSONObject>
    )[0]!;

    expect(metric["name"]).toBe("amazonaws.com/AWS/EC2/CPUUtilization");
    expect(point["sum"]).toBe(12.5);
    expect(point["timeUnixNano"]).toBe(`${MINUTE_START_MS + 60_000}000000`);
  });

  test("is filed under the resource the connection's inventory lists, in its account", async () => {
    await deliver({
      records: [openTelemetryRecord([openTelemetryRequest([EC2_CPU])])],
    });

    const resource: JSONObject = (
      metricJobs[0]!.body["resourceMetrics"] as Array<JSONObject>
    )[0]!;
    const metric: JSONObject = (
      (resource["scopeMetrics"] as Array<JSONObject>)[0]![
        "metrics"
      ] as Array<JSONObject>
    )[0]!;
    const point: JSONObject = (
      (metric["summary"] as JSONObject)["dataPoints"] as Array<JSONObject>
    )[0]!;

    // The row the ingest will store, and the resource its resolver files it under.
    const filed: CloudMonitoredResource | null = resolveCloudMonitoredResource({
      metricName: metric["name"],
      attributes: {
        ...TelemetryUtil.getAttributes({
          prefixKeysWithString: "resource",
          items: (resource["resource"] as JSONObject)[
            "attributes"
          ] as JSONArray,
        }),
        ...TelemetryUtil.getAttributes({
          prefixKeysWithString: "",
          items: point["attributes"] as JSONArray,
        }),
      },
    });

    expect(filed).toEqual(
      expect.objectContaining({
        provider: CloudProvider.AWS,
        resourceType: "AWS::EC2::Instance",
        accountId: ACCOUNT_ID,
        region: REGION,
        providerResourceId: `arn:aws:ec2:${REGION}:${ACCOUNT_ID}:instance/i-0abc123def`,
      }),
    );
  });

  test("records what arrived on the connection: the account, Region and namespaces", async () => {
    await deliver({
      records: [
        openTelemetryRecord([
          openTelemetryRequest([
            EC2_CPU,
            openTelemetryMetric({
              namespace: "AWS/RDS",
              metricName: "FreeStorageSpace",
              dimensions: { DBInstanceIdentifier: "orders-db" },
              unit: "By",
              count: 1,
              sum: 1e9,
              min: 1e9,
              max: 1e9,
            }),
          ]),
        ]),
      ],
    });
    await settle();

    const summary: CloudStreamSummary = summaries.get(CONNECTION_A.toString())!;

    expect(summary.metricSources).toEqual([
      expect.objectContaining({
        accountId: ACCOUNT_ID,
        region: REGION,
        namespaces: expect.arrayContaining(["AWS/EC2", "AWS/RDS"]),
      }),
    ]);
    expect(summary.lastDeliveryAt).toBeDefined();
  });
});

describe("a metric stream in JSON", () => {
  test("lands as the very series OpenTelemetry 1.0 writes", async () => {
    await deliver({
      records: [
        jsonMetricRecord([
          jsonMetricUpdate({
            namespace: "AWS/EC2",
            metricName: "CPUUtilization",
            dimensions: { InstanceId: "i-0abc123def" },
            value: { max: 12.5, min: 12.5, sum: 12.5, count: 1, p99: 12.5 },
          }),
        ]),
      ],
    });

    const resource: JSONObject = (
      metricJobs[0]!.body["resourceMetrics"] as Array<JSONObject>
    )[0]!;
    const metric: JSONObject = (
      (resource["scopeMetrics"] as Array<JSONObject>)[0]![
        "metrics"
      ] as Array<JSONObject>
    )[0]!;
    const point: JSONObject = (
      (metric["summary"] as JSONObject)["dataPoints"] as Array<JSONObject>
    )[0]!;
    const stored: Record<string, unknown> = TelemetryUtil.getAttributes({
      prefixKeysWithString: "",
      items: point["attributes"] as JSONArray,
    });

    expect(metric["name"]).toBe("amazonaws.com/AWS/EC2/CPUUtilization");
    expect(stored).toEqual({
      Namespace: "AWS/EC2",
      MetricName: "CPUUtilization",
      "Dimensions.InstanceId": "i-0abc123def",
    });
    expect(point["quantileValues"]).toEqual([
      { quantile: 0, value: 12.5 },
      { quantile: 0.99, value: 12.5 },
      { quantile: 1, value: 12.5 },
    ]);
    expect(resourceAttribute(resource, "service.name")).toBe("Production AWS");
    expect(resourceAttribute(resource, "cloud.account.id")).toBe(ACCOUNT_ID);
  });
});

describe("CloudWatch Logs subscriptions", () => {
  test("land as the connection's logs, filed under the function they are the log of", async () => {
    const reply: FirehoseReply = await deliver({
      path: "/telemetry/aws-firehose/v1/logs",
      sourceArn: LOGS_FIREHOSE_ARN,
      records: [
        cloudWatchLogsRecord(
          cloudWatchLogsDocument({
            logGroup: "/aws/lambda/checkout",
            logStream: "2026/11/04/[$LATEST]0123456789abcdef0123456789abcdef",
            events: LAMBDA_EVENTS,
          }),
        ),
      ],
    });

    expectFirehoseAnswer(reply, { status: 200 });
    expect(metricJobs).toHaveLength(0);
    expect(logJobs).toHaveLength(1);
    expect(logJobs[0]!.projectId).toBe(PROJECT_A.toString());
    expect(logJobs[0]!.productType).toBe(ProductType.Logs);

    const resource: JSONObject = (
      logJobs[0]!.body["resourceLogs"] as Array<JSONObject>
    )[0]!;
    const stored: Record<string, unknown> = TelemetryUtil.getAttributes({
      prefixKeysWithString: "resource",
      items: (resource["resource"] as JSONObject)["attributes"] as JSONArray,
    });

    expect(stored).toEqual({
      "resource.service.name": "Production AWS",
      "resource.cloud.provider": "aws",
      "resource.oneuptime.cloud.connection.id": CONNECTION_A.toString(),
      "resource.cloud.account.id": ACCOUNT_ID,
      // The stream's Region, which a subscription shares with its log group.
      "resource.cloud.region": REGION,
      "resource.aws.log.group.name": "/aws/lambda/checkout",
      [STORED_CLOUD_RESOURCE_ID_ATTRIBUTE]: `arn:aws:lambda:${REGION}:${ACCOUNT_ID}:function:checkout`,
      "resource.cloud.platform": "aws_lambda",
      "resource.faas.name": "checkout",
    });

    const records: Array<JSONObject> = (
      resource["scopeLogs"] as Array<JSONObject>
    )[0]!["logRecords"] as Array<JSONObject>;

    expect(records).toHaveLength(3);
    expect(
      records.map((record: JSONObject) => {
        return [
          record["severityText"],
          (record["body"] as JSONObject)["stringValue"],
        ];
      }),
    ).toEqual([
      ["", LAMBDA_EVENTS[0]!.message],
      ["ERROR", LAMBDA_EVENTS[1]!.message],
      ["WARN", LAMBDA_EVENTS[2]!.message],
    ]);
    expect(records[1]!["timeUnixNano"]).toBe(`${MINUTE_START_MS + 1200}000000`);
    expect(
      TelemetryUtil.getAttributes({
        prefixKeysWithString: "",
        items: records[1]!["attributes"] as JSONArray,
      }),
    ).toEqual({
      "aws.log.stream.name":
        "2026/11/04/[$LATEST]0123456789abcdef0123456789abcdef",
      "aws.log.event.id": LAMBDA_EVENTS[1]!.id,
    });
  });

  test("CloudWatch Logs' test message is taken and stored as nothing", async () => {
    const reply: FirehoseReply = await deliver({
      path: "/telemetry/aws-firehose/v1/logs",
      sourceArn: LOGS_FIREHOSE_ARN,
      records: [cloudWatchLogsRecord(CONTROL_MESSAGE_DOCUMENT)],
    });

    expectFirehoseAnswer(reply, { status: 200 });
    expect(logJobs).toHaveLength(0);

    await settle();

    // The delivery arrived: the person setting the stream up sees it did.
    expect(
      summaries.get(CONNECTION_A.toString())?.lastDeliveryAt,
    ).toBeDefined();
  });

  test("a group no rule reads lands unfiled, under its account and Region", async () => {
    await deliver({
      path: "/telemetry/aws-firehose/v1/logs",
      sourceArn: LOGS_FIREHOSE_ARN,
      records: [
        cloudWatchLogsRecord(
          cloudWatchLogsDocument({
            logGroup: "/my-team/payments",
            logStream: "web-1",
            events: [{ id: "1", timestamp: MINUTE_START_MS, message: "hello" }],
          }),
        ),
      ],
    });

    const resource: JSONObject = (
      logJobs[0]!.body["resourceLogs"] as Array<JSONObject>
    )[0]!;

    expect(resourceAttribute(resource, "cloud.account.id")).toBe(ACCOUNT_ID);
    expect(resourceAttribute(resource, "aws.log.group.name")).toBe(
      "/my-team/payments",
    );
    expect(resourceAttribute(resource, "cloud.resource_id")).toBeUndefined();
  });

  test("records Firehose decompressed itself are read the same", async () => {
    await deliver({
      path: "/telemetry/aws-firehose/v1/logs",
      sourceArn: LOGS_FIREHOSE_ARN,
      records: [
        cloudWatchLogsRecord(
          cloudWatchLogsDocument({
            logGroup: "/aws/rds/instance/orders-db/error",
            logStream: "orders-db",
            events: [
              {
                id: "1",
                timestamp: MINUTE_START_MS,
                message: "ERROR: deadlock detected",
              },
            ],
          }),
          { gzip: false },
        ),
      ],
    });

    const resource: JSONObject = (
      logJobs[0]!.body["resourceLogs"] as Array<JSONObject>
    )[0]!;

    expect(resourceAttribute(resource, "cloud.resource_id")).toBe(
      `arn:aws:rds:${REGION}:${ACCOUNT_ID}:db:orders-db`,
    );
  });

  test("records sent to the metrics endpoint still land as logs", async () => {
    const reply: FirehoseReply = await deliver({
      path: "/aws-firehose/v1/metrics",
      sourceArn: LOGS_FIREHOSE_ARN,
      records: [
        cloudWatchLogsRecord(
          cloudWatchLogsDocument({
            logGroup: "/aws/lambda/checkout",
            logStream: "s",
            events: [{ id: "1", timestamp: MINUTE_START_MS, message: "x" }],
          }),
        ),
        openTelemetryRecord([openTelemetryRequest([EC2_CPU])]),
      ],
    });

    expectFirehoseAnswer(reply, { status: 200 });
    expect(logJobs).toHaveLength(1);
    expect(metricJobs).toHaveLength(1);
  });
});

describe("the body", () => {
  test("may come without gzip", async () => {
    const reply: FirehoseReply = await deliver({
      gzip: false,
      records: [openTelemetryRecord([openTelemetryRequest([EC2_CPU])])],
    });

    expectFirehoseAnswer(reply, { status: 200 });
    expect(metricJobs).toHaveLength(1);
  });

  test("declared larger than OneUptime takes is 413 - which Firehose does not send again - before it is read", async () => {
    const requestId: string = nextRequestId();
    const reply: FirehoseReply = await sendFirehoseDelivery({
      port,
      path: "/telemetry/aws-firehose/v1/metrics",
      accessKey: KEY_A,
      requestId,
      sourceArn: METRICS_FIREHOSE_ARN,
      gzip: false,
      body: Buffer.alloc(CLOUD_STREAM_MAX_REQUEST_BYTES + 1, 0x20),
    });

    expectFirehoseAnswer(reply, {
      status: 413,
      requestId,
      errorMessage: STREAM_TOO_LARGE_MESSAGE,
    });
    expect(metricJobs).toHaveLength(0);

    await settle();

    expect(summaries.get(CONNECTION_A.toString())?.lastRefusal?.reason).toBe(
      CloudStreamRefusalReason.TooLarge,
    );
  });

  test("that decompresses to more than OneUptime takes is 413 too: a gzip bomb is stopped", async () => {
    const requestId: string = nextRequestId();
    const bomb: Buffer = zlib.gzipSync(Buffer.alloc(40 * 1024 * 1024, 0x20));

    const reply: FirehoseReply = await sendFirehoseDelivery({
      port,
      path: "/telemetry/aws-firehose/v1/metrics",
      accessKey: KEY_A,
      requestId,
      sourceArn: METRICS_FIREHOSE_ARN,
      gzip: false,
      headers: { "Content-Encoding": "gzip" },
      body: bomb,
    });

    expectFirehoseAnswer(reply, { status: 413, requestId });
    expect(metricJobs).toHaveLength(0);
  });

  test("a record whose gzip decompresses to more than a record may is 413", async () => {
    const reply: FirehoseReply = await deliver({
      path: "/telemetry/aws-firehose/v1/logs",
      records: [zlib.gzipSync(Buffer.alloc(9 * 1024 * 1024, 0x7b))],
    });

    expect(reply.status).toBe(413);
    expect(logJobs).toHaveLength(0);
  });

  test("that is not a Firehose delivery is 400, and why", async () => {
    const requestId: string = nextRequestId();
    const notJson: FirehoseReply = await sendFirehoseDelivery({
      port,
      path: "/telemetry/aws-firehose/v1/metrics",
      accessKey: KEY_A,
      requestId,
      body: Buffer.from("hello", "utf8"),
    });

    expectFirehoseAnswer(notJson, { status: 400, requestId });
    expect(notJson.body["errorMessage"]).toContain("not JSON");

    const noRecords: FirehoseReply = await sendFirehoseDelivery({
      port,
      path: "/telemetry/aws-firehose/v1/metrics",
      accessKey: KEY_A,
      requestId: nextRequestId(),
      body: { requestId: "x", records: "nope" },
    });

    expect(noRecords.status).toBe(400);
    expect(metricJobs).toHaveLength(0);
  });

  test("in a coding Firehose never sends is 400", async () => {
    const reply: FirehoseReply = await sendFirehoseDelivery({
      port,
      path: "/telemetry/aws-firehose/v1/metrics",
      accessKey: KEY_A,
      requestId: nextRequestId(),
      gzip: false,
      headers: { "Content-Encoding": "br" },
      body: firehoseEnvelope({ requestId: "r", records: [] }),
    });

    expect(reply.status).toBe(400);
  });

  test("records that are none of CloudWatch's formats are left out, and the rest taken", async () => {
    const reply: FirehoseReply = await deliver({
      records: [
        Buffer.from("not a record", "utf8"),
        Buffer.from([0xff, 0xfe, 0x00, 0x01]),
        openTelemetryRecord([openTelemetryRequest([EC2_CPU])]),
      ],
    });

    expectFirehoseAnswer(reply, { status: 200 });
    expect(metricJobs).toHaveLength(1);
  });

  test("the request id comes from the body when the header has none", async () => {
    const reply: FirehoseReply = await sendFirehoseDelivery({
      port,
      path: "/telemetry/aws-firehose/v1/metrics",
      accessKey: KEY_A,
      requestId: "",
      body: firehoseEnvelope({
        requestId: "body-request-id",
        records: [openTelemetryRecord([openTelemetryRequest([EC2_CPU])])],
      }),
    });

    expectFirehoseAnswer(reply, { status: 200, requestId: "body-request-id" });
  });
});

describe("who a delivery is from", () => {
  test("a wrong key is 401 - which Firehose sends again until its retry time is up - and nothing is queued", async () => {
    const requestId: string = nextRequestId();
    const reply: FirehoseReply = await deliver({
      requestId,
      key: keyOf(CONNECTION_A, "ff"),
      records: [openTelemetryRecord([openTelemetryRequest([EC2_CPU])])],
    });

    expectFirehoseAnswer(reply, { status: 401, requestId });
    expect(reply.body["errorMessage"]).toContain(
      "not the connection's stream key",
    );
    expect(metricJobs).toHaveLength(0);

    await settle();

    // The key named connection A: its summary says why.
    expect(summaries.get(CONNECTION_A.toString())?.lastRefusal?.reason).toBe(
      CloudStreamRefusalReason.WrongKey,
    );
  });

  test("no key, or a key of no connection, is refused alike, and noted nowhere", async () => {
    const noKey: FirehoseReply = await deliver({
      key: undefined,
      records: [openTelemetryRecord([openTelemetryRequest([EC2_CPU])])],
    });
    const nobody: FirehoseReply = await deliver({
      key: keyOf(new ObjectID("99999999-9999-4999-8999-999999999999"), "c3"),
      records: [openTelemetryRecord([openTelemetryRequest([EC2_CPU])])],
    });

    expect(noKey.status).toBe(401);
    expect(nobody.status).toBe(401);
    expect(noKey.body["errorMessage"]).toBe(nobody.body["errorMessage"]);

    await settle();

    expect(summaries.size).toBe(0);
  });

  test("each project's key writes into that project only, whatever account its records name", async () => {
    await deliver({
      key: KEY_A,
      records: [openTelemetryRecord([openTelemetryRequest([EC2_CPU])])],
    });
    await deliver({
      key: KEY_B,
      records: [
        openTelemetryRecord([
          openTelemetryRequest([EC2_CPU], { accountId: "999999999999" }),
        ]),
      ],
    });

    expect(
      metricJobs.map((job: { projectId: string }) => {
        return job.projectId;
      }),
    ).toEqual([PROJECT_A.toString(), PROJECT_B.toString()]);

    const resourceB: JSONObject = (
      metricJobs[1]!.body["resourceMetrics"] as Array<JSONObject>
    )[0]!;

    expect(resourceAttribute(resourceB, "service.name")).toBe("Staging AWS");
    expect(resourceAttribute(resourceB, "oneuptime.cloud.connection.id")).toBe(
      CONNECTION_B.toString(),
    );
  });

  test("a service.name or a connection id a record carries is replaced by the key's", async () => {
    const forged: JSONObject = openTelemetryRequest([EC2_CPU]);
    const resource: JSONObject = (
      forged["resourceMetrics"] as Array<JSONObject>
    )[0]!;
    (
      (resource["resource"] as JSONObject)["attributes"] as Array<JSONObject>
    ).push(
      { key: "service.name", value: { stringValue: "someone else" } },
      {
        key: "oneuptime.cloud.connection.id",
        value: { stringValue: CONNECTION_B.toString() },
      },
    );

    await deliver({ key: KEY_A, records: [openTelemetryRecord([forged])] });

    const stamped: JSONObject = (
      metricJobs[0]!.body["resourceMetrics"] as Array<JSONObject>
    )[0]!;
    const keys: Array<string> = (
      (stamped["resource"] as JSONObject)["attributes"] as Array<JSONObject>
    ).map((attribute: JSONObject) => {
      return attribute["key"] as string;
    });

    expect(resourceAttribute(stamped, "service.name")).toBe("Production AWS");
    expect(resourceAttribute(stamped, "oneuptime.cloud.connection.id")).toBe(
      CONNECTION_A.toString(),
    );
    expect(
      keys.filter((key: string) => {
        return (
          key === "service.name" || key === "oneuptime.cloud.connection.id"
        );
      }),
    ).toHaveLength(2);
  });

  test("a connection that is turned off is 403", async () => {
    rows.set(
      CONNECTION_A.toString(),
      connectionRow({
        id: CONNECTION_A,
        projectId: PROJECT_A,
        key: KEY_A,
        serviceName: "Production AWS",
        isEnabled: false,
      }),
    );

    const reply: FirehoseReply = await deliver({
      records: [openTelemetryRecord([openTelemetryRequest([EC2_CPU])])],
    });

    expect(reply.status).toBe(403);
    expect(metricJobs).toHaveLength(0);
  });
});

describe("what makes Firehose send a batch again", () => {
  test("a queue that cannot take the batch is 503; sent again, it is taken", async () => {
    const requestId: string = nextRequestId();
    queueFails = true;

    const first: FirehoseReply = await deliver({
      requestId,
      records: [openTelemetryRecord([openTelemetryRequest([EC2_CPU])])],
    });

    expectFirehoseAnswer(first, {
      status: 503,
      requestId,
      errorMessage: STREAM_QUEUE_UNAVAILABLE_MESSAGE,
    });
    expect(metricJobs).toHaveLength(0);

    queueFails = false;

    const again: FirehoseReply = await deliver({
      requestId,
      records: [openTelemetryRecord([openTelemetryRequest([EC2_CPU])])],
    });

    expectFirehoseAnswer(again, { status: 200, requestId });
    expect(metricJobs).toHaveLength(1);
  });

  test("a batch sent again after it was taken is answered 200 and not queued twice", async () => {
    const requestId: string = nextRequestId();

    await deliver({
      requestId,
      records: [openTelemetryRecord([openTelemetryRequest([EC2_CPU])])],
    });
    const again: FirehoseReply = await deliver({
      requestId,
      records: [openTelemetryRecord([openTelemetryRequest([EC2_CPU])])],
    });

    expectFirehoseAnswer(again, { status: 200, requestId });
    expect(metricJobs).toHaveLength(1);

    // Another connection's batch of the same id is its own.
    await deliver({
      requestId,
      key: KEY_B,
      records: [openTelemetryRecord([openTelemetryRequest([EC2_CPU])])],
    });

    expect(metricJobs).toHaveLength(2);
  });

  test("more deliveries a minute than a connection may make is 429, with when to come back", async () => {
    rateDecision = TelemetryIngestionKeyLimitOutcome.RateLimited;
    const requestId: string = nextRequestId();

    const reply: FirehoseReply = await deliver({
      requestId,
      records: [openTelemetryRecord([openTelemetryRequest([EC2_CPU])])],
    });

    expectFirehoseAnswer(reply, {
      status: 429,
      requestId,
      errorMessage: STREAM_THROTTLED_MESSAGE,
    });
    expect(reply.headers["retry-after"]).toBe("17");
    expect(metricJobs).toHaveLength(0);

    await settle();

    expect(summaries.get(CONNECTION_A.toString())?.lastRefusal?.reason).toBe(
      CloudStreamRefusalReason.Throttled,
    );
  });

  test("the rate is counted per connection, never per project or per caller", async () => {
    await deliver({
      records: [openTelemetryRecord([openTelemetryRequest([EC2_CPU])])],
    });

    expect(TelemetryIngestionKeyRateLimiter.consume).toHaveBeenCalledWith({
      ingestionKeyId: CONNECTION_A,
      limitPerMinute: 600,
    });
  });
});

describe("a big delivery", () => {
  test("is queued in jobs of at most 10,000 datapoints, whole resources each", async () => {
    const records: Array<Buffer> = [];

    for (let record: number = 0; record < 12; record++) {
      const metrics: Array<JSONObject> = [];

      for (let index: number = 0; index < 1000; index++) {
        metrics.push(
          openTelemetryMetric({
            namespace: "AWS/EC2",
            metricName: "CPUUtilization",
            dimensions: { InstanceId: `i-${record}-${index}` },
            count: 1,
            sum: index,
            min: index,
            max: index,
          }),
        );
      }

      records.push(openTelemetryRecord([openTelemetryRequest(metrics)]));
    }

    const reply: FirehoseReply = await deliver({ records });

    expectFirehoseAnswer(reply, { status: 200 });
    expect(metricJobs.length).toBe(2);

    let total: number = 0;

    for (const job of metricJobs) {
      let points: number = 0;

      for (const resource of job.body["resourceMetrics"] as Array<JSONObject>) {
        for (const scope of resource["scopeMetrics"] as Array<JSONObject>) {
          points += (scope["metrics"] as Array<JSONObject>).length;
        }
      }

      expect(points).toBeLessThanOrEqual(MAX_DATAPOINTS_PER_JOB);
      total += points;
    }

    expect(total).toBe(12_000);
  });
});
