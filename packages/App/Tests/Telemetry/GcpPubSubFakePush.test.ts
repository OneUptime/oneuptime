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

jest.mock("../../FeatureSet/Telemetry/Services/Queue/LogsQueueService", () => {
  return {
    __esModule: true,
    default: { addLogIngestJob: jest.fn() },
  };
});

import http from "http";
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
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import CloudStreamActivity from "Common/Server/Utils/CloudConnection/CloudStreamActivity";
import CloudStreamAuthenticator from "Common/Server/Utils/CloudConnection/CloudStreamAuthentication";
import CloudStreamKeyedConnections from "Common/Server/Utils/CloudConnection/CloudStreamKeyedConnections";
import CloudStreamKeys from "Common/Server/Utils/CloudConnection/CloudStreamKeys";
import GoogleOidcTokens from "Common/Server/Utils/CloudConnection/GoogleOidcTokens";
import { createExpressApp, ExpressApplication } from "Common/Server/Utils/Express";
import { isCloudStreamPath } from "Common/Server/Utils/StartServer";
import LlmConnectionPullRunner from "Common/Server/Utils/LlmObservability/LlmConnectionPullRunner";
import TelemetryIngestionKeyRateLimiter, {
  TelemetryIngestionKeyLimitOutcome,
} from "Common/Server/Utils/Telemetry/TelemetryIngestionKeyRateLimiter";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import {
  CloudMonitoredResource,
  resolveCloudMonitoredResource,
} from "Common/Types/Cloud/CloudMonitoredResource";
import {
  CLOUD_STREAM_PUBSUB_MAX_MESSAGE_BYTES,
  CLOUD_STREAM_PUBSUB_MAX_REQUEST_BYTES,
  CloudStreamRefusalReason,
  CloudStreamSummary,
  PUBSUB_ACKNOWLEDGING_STATUSES,
  buildCloudStreamKey,
  getCloudStreamPushServiceAccountEmail,
} from "Common/Types/CloudConnection/CloudStream";
import { JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import GcpPubSubAPI from "../../FeatureSet/Telemetry/API/GcpPubSub";
import LogsQueueService from "../../FeatureSet/Telemetry/Services/Queue/LogsQueueService";
import PubSubLogBatcher from "../../FeatureSet/Telemetry/Utils/GcpPubSub/PubSubLogBatcher";
import {
  ENTRY_TIME_UNIX_NANO,
  FakeGoogleKey,
  FakeGoogleKeys,
  OTHER_PROJECT,
  PROJECT,
  PushReply,
  auditLogEntry,
  cloudFunctionEntry,
  cloudRunRequestEntry,
  computeSyslogEntry,
  gkeContainerEntry,
  makeGoogleKey,
  pushEnvelope,
  pushToken,
  sendPush,
} from "./Helpers/FakePubSub";

/*
 * A FAKE PUB/SUB PUSH AGAINST THE REAL ENDPOINT, OVER A REAL SOCKET.
 *
 * The push endpoint's router, mounted as the Telemetry feature set mounts
 * it, is sent what a Pub/Sub push subscription sends - its wrapped
 * envelope, its OIDC token, one log entry a request in the shapes Cloud
 * Logging writes them - with "Google" a key pair whose public half a fake
 * serves as Google serves its key set, on a socket of its own. Who a push
 * is from is decided by the real authenticator and the real token check,
 * over connections of two projects; the logs queue is replaced by the jobs
 * it is handed. Pinned:
 *
 *   - every answer is one Pub/Sub reads: 204 for a push taken or taken
 *     before, a refusal's status for what Pub/Sub should push again, each
 *     under a kilobyte and never compressed;
 *   - each entry lands as one OTLP log record of the key's project only,
 *     under the connection's service and id, filed under its project and
 *     the cloud resource its labels name;
 *   - the key alone is not enough: the token must be Google's, for the
 *     push service account the key was made for, with the key as its
 *     audience;
 *   - a message pushed again after it was taken is not taken twice;
 *   - limits: the request as sent - a length declared past it answered
 *     before the body comes, a body sent without one let go of as it grows
 *     - the message's data, pushes a minute;
 *   - a burst of pushes is queued a batch at a time, each answered only
 *     once its batch is queued.
 *
 * `jest` is the global one.
 */

const PROJECT_A: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const PROJECT_B: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const CONNECTION_A: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const CONNECTION_B: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

function keyOf(connectionId: ObjectID, pair: string): string {
  return buildCloudStreamKey({
    connectionId: connectionId.toString(),
    secret: pair.repeat(32),
  });
}

const KEY_A: string = keyOf(CONNECTION_A, "a1");
const KEY_B: string = keyOf(CONNECTION_B, "b2");
const PUSHER_A: string = getCloudStreamPushServiceAccountEmail({
  connectionId: CONNECTION_A.toString(),
  projectId: PROJECT,
})!;
const PUSHER_B: string = getCloudStreamPushServiceAccountEmail({
  connectionId: CONNECTION_B.toString(),
  projectId: OTHER_PROJECT,
})!;

const GOOGLE: FakeGoogleKey = makeGoogleKey("google-2026-11");
const IMPOSTOR: FakeGoogleKey = makeGoogleKey("google-2026-11");

let server: http.Server;
let port: number;
let google: FakeGoogleKeys;
let logJobs: Array<{ projectId: string; body: JSONObject; productType: string }>;
let summaries: Map<string, CloudStreamSummary>;
let rateDecision: TelemetryIngestionKeyLimitOutcome;
let queueFails: boolean;
let ledger: Map<string, string>;
let rows: Map<string, CloudConnection>;
let connectionReads: number;
let messageCounter: number = 0;

function connectionRow(data: {
  id: ObjectID;
  projectId: ObjectID;
  key: string;
  pusher: string;
  serviceName: string;
  isEnabled?: boolean;
}): CloudConnection {
  const connection: CloudConnection = new CloudConnection();
  connection.id = data.id;
  connection.projectId = data.projectId;
  connection.provider = CloudProvider.GCP;
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
    pushServiceAccount: data.pusher,
  };
  return connection;
}

function nextMessageId(): string {
  messageCounter++;
  return String(2070443601311540 + messageCounter);
}

// A push of one entry, signed by Google for A's push service account with A's key.
async function push(data: {
  entry?: JSONObject;
  rawData?: string;
  messageId?: string;
  token?: string;
  authorization?: string;
  path?: string;
  subscription?: string;
}): Promise<PushReply> {
  return await sendPush({
    port,
    path: data.path,
    authorization: data.authorization,
    token:
      data.authorization !== undefined
        ? undefined
        : data.token ?? pushToken({ key: GOOGLE, audience: KEY_A, email: PUSHER_A }),
    body: pushEnvelope({
      entry: data.entry || cloudRunRequestEntry(),
      rawData: data.rawData,
      messageId: data.messageId || nextMessageId(),
      subscription: data.subscription,
    }),
  });
}

function expectPubSubAnswer(reply: PushReply, status: number): void {
  expect(reply.status).toBe(status);
  expect(reply.headers["content-encoding"]).toBeUndefined();
  expect(Buffer.byteLength(reply.text, "utf8")).toBeLessThan(1000);

  if (status === 204) {
    expect(reply.text).toBe("");
  } else {
    expect(reply.headers["content-type"]).toBe("application/json");
    expect(typeof (JSON.parse(reply.text) as JSONObject)["error"]).toBe("string");
  }

  // What Pub/Sub takes as delivered, and what it pushes again.
  expect(PUBSUB_ACKNOWLEDGING_STATUSES.includes(status)).toBe(status === 204);
}

function resourceAttribute(resource: JSONObject, key: string): string | undefined {
  const attributes: Array<JSONObject> = (resource["resource"] as JSONObject)[
    "attributes"
  ] as Array<JSONObject>;
  const found: JSONObject | undefined = attributes.find((attribute: JSONObject) => {
    return attribute["key"] === key;
  });
  return found ? ((found["value"] as JSONObject)["stringValue"] as string) : undefined;
}

function recordsOf(job: { body: JSONObject }): Array<{ resource: JSONObject; record: JSONObject }> {
  const records: Array<{ resource: JSONObject; record: JSONObject }> = [];

  for (const resource of job.body["resourceLogs"] as Array<JSONObject>) {
    for (const scope of resource["scopeLogs"] as Array<JSONObject>) {
      for (const record of scope["logRecords"] as Array<JSONObject>) {
        records.push({ resource, record });
      }
    }
  }

  return records;
}

function allRecords(): Array<{ resource: JSONObject; record: JSONObject; projectId: string }> {
  return logJobs.flatMap((job: { projectId: string; body: JSONObject }) => {
    return recordsOf(job).map((item: { resource: JSONObject; record: JSONObject }) => {
      return { ...item, projectId: job.projectId };
    });
  });
}

function attributeOf(record: JSONObject, key: string): JSONObject | undefined {
  const found: JSONObject | undefined = (record["attributes"] as Array<JSONObject>).find(
    (attribute: JSONObject) => {
      return attribute["key"] === key;
    },
  );
  return found ? (found["value"] as JSONObject) : undefined;
}

function gcpResourceOf(type: string, labels: Record<string, string>): CloudMonitoredResource {
  const attributes: Record<string, string> = { "resource.gcp.resource_type": type };

  for (const key of Object.keys(labels)) {
    attributes[`resource.${key}`] = labels[key]!;
  }

  return resolveCloudMonitoredResource({ metricName: "x", attributes })!;
}

async function settle(): Promise<void> {
  for (let index: number = 0; index < 5; index++) {
    await new Promise<void>((resolve: () => void) => {
      setImmediate(resolve);
    });
  }
}

beforeAll(async () => {
  const app: ExpressApplication = createExpressApp();
  app.use(["/telemetry", "/"], GcpPubSubAPI);

  server = http.createServer(app);
  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  port = (server.address() as AddressInfo).port;

  google = new FakeGoogleKeys();
  google.keys = [GOOGLE];
  await google.start();
});

afterAll(async () => {
  await new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });
  await google.stop();
});

beforeEach(() => {
  logJobs = [];
  summaries = new Map();
  rateDecision = TelemetryIngestionKeyLimitOutcome.Allowed;
  queueFails = false;
  ledger = new Map();
  rows = new Map();
  connectionReads = 0;
  google.keys = [GOOGLE];
  google.status = 200;
  google.reads = 0;

  rows.set(
    CONNECTION_A.toString(),
    connectionRow({
      id: CONNECTION_A,
      projectId: PROJECT_A,
      key: KEY_A,
      pusher: PUSHER_A,
      serviceName: "Production Google Cloud",
    }),
  );
  rows.set(
    CONNECTION_B.toString(),
    connectionRow({
      id: CONNECTION_B,
      projectId: PROJECT_B,
      key: KEY_B,
      pusher: PUSHER_B,
      serviceName: "Data Google Cloud",
    }),
  );

  CloudStreamAuthenticator.forget(CONNECTION_A);
  CloudStreamAuthenticator.forget(CONNECTION_B);
  CloudStreamActivity.reset();
  CloudStreamKeyedConnections.reset();
  GoogleOidcTokens.reset();
  PubSubLogBatcher.reset();
  PubSubLogBatcher.maxWaitMs = 25;

  jest.spyOn(GoogleOidcTokens, "fetchKeys").mockImplementation(async () => {
    return await google.fetch();
  });
  jest
    .spyOn(CloudConnectionService, "findOneById")
    .mockImplementation((async (data: { id: ObjectID }) => {
      connectionReads++;
      return rows.get(data.id.toString()) || null;
    }) as never);
  jest
    .spyOn(CloudStreamKeyedConnections, "readIds")
    .mockImplementation(async (): Promise<Array<string>> => {
      return Array.from(rows.values())
        .filter((connection: CloudConnection): boolean => {
          return Boolean(connection.streamKeyHashes);
        })
        .map((connection: CloudConnection): string => {
          return connection.id!.toString();
        });
    });
  jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
  jest.spyOn(PayAsYouGoBillingService, "requirePayAsYouGo").mockResolvedValue(undefined);
  jest.spyOn(LlmConnectionPullRunner, "isTelemetryAllowed").mockResolvedValue(true);
  jest
    .spyOn(TelemetryIngestionKeyRateLimiter, "consume")
    .mockImplementation(async () => {
      return rateDecision === TelemetryIngestionKeyLimitOutcome.RateLimited
        ? { outcome: rateDecision, retryAfterSeconds: 23, isFirstRejectionInWindow: true }
        : { outcome: rateDecision };
    });

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

  CloudStreamActivity.readSummary = async (connectionId: ObjectID): Promise<CloudStreamSummary> => {
    return summaries.get(connectionId.toString()) || { metricSources: [], logSources: [] };
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
  (LogsQueueService.addLogIngestJob as jest.Mock).mockReset();
  PubSubLogBatcher.reset();
});

describe("a push Google signed, with the connection's key", () => {
  test("is taken: 204, and the entry is queued as the key's project's logs", async () => {
    const reply: PushReply = await push({});

    expectPubSubAnswer(reply, 204);
    expect(logJobs).toHaveLength(1);
    expect(logJobs[0]!.projectId).toBe(PROJECT_A.toString());
    expect(logJobs[0]!.productType).toBe(ProductType.Logs);

    const records: Array<{ resource: JSONObject; record: JSONObject }> = recordsOf(logJobs[0]!);
    expect(records).toHaveLength(1);

    const { resource, record } = records[0]!;
    expect(resourceAttribute(resource, "service.name")).toBe("Production Google Cloud");
    expect(resourceAttribute(resource, "oneuptime.cloud.connection.id")).toBe(
      CONNECTION_A.toString(),
    );
    expect(resourceAttribute(resource, "cloud.provider")).toBe("gcp");
    expect(resourceAttribute(resource, "cloud.account.id")).toBe(PROJECT);
    expect(resourceAttribute(resource, "cloud.region")).toBe("us-central1");
    expect(resourceAttribute(resource, "gcp.resource_type")).toBe("cloud_run_revision");
    // A Cloud Run log names no platform: no app is made up from the connection's service.
    expect(resourceAttribute(resource, "cloud.platform")).toBeUndefined();

    expect(record["timeUnixNano"]).toBe(ENTRY_TIME_UNIX_NANO);
    expect(record["severityText"]).toBe("ERROR");
    expect(record["severityNumber"]).toBe(17);
    expect(record["traceId"]).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(record["spanId"]).toBe("a1b2c3d4e5f60718");
    expect(attributeOf(record, "http.response.status_code")).toEqual({ intValue: "503" });
    expect(attributeOf(record, "gcp.log.id")).toEqual({
      stringValue: "run.googleapis.com/requests",
    });

    // Noted on the connection: the project, its region and the log.
    await CloudStreamActivity.flushAll(new Date());
    const summary: CloudStreamSummary = summaries.get(CONNECTION_A.toString())!;
    expect(summary.logSources).toHaveLength(1);
    expect(summary.logSources[0]).toMatchObject({
      accountId: PROJECT,
      region: "us-central1",
      logGroups: ["run.googleapis.com/requests"],
    });
  });

  test("each kind of entry is filed under the resource its labels name, the one its metrics land on", async () => {
    for (const entry of [computeSyslogEntry(), cloudFunctionEntry(), auditLogEntry()]) {
      expectPubSubAnswer(await push({ entry }), 204);
    }

    const records: Array<{ resource: JSONObject; record: JSONObject }> = allRecords();
    expect(records).toHaveLength(3);

    const vm: CloudMonitoredResource = gcpResourceOf("gce_instance", {
      instance_id: "4876543210987654321",
      project_id: PROJECT,
      zone: "us-central1-a",
    });
    const fn: CloudMonitoredResource = gcpResourceOf("cloud_function", {
      function_name: "charge-card",
      project_id: PROJECT,
      region: "us-central1",
    });
    const database: CloudMonitoredResource = gcpResourceOf("cloudsql_database", {
      database_id: `${PROJECT}:orders-db`,
      project_id: PROJECT,
      region: "us-central1",
    });

    expect(
      records.map((item: { resource: JSONObject }) => {
        return resourceAttribute(item.resource, "cloud.resource_id");
      }),
    ).toEqual([vm.providerResourceId, fn.providerResourceId, database.providerResourceId]);

    // The syslog line, the function's message beside its fields, the audit log's one line.
    expect((records[0]!.record["body"] as JSONObject)["stringValue"]).toBe(
      "kernel: Out of memory: Killed process 1234 (java)",
    );
    expect((records[1]!.record["body"] as JSONObject)["stringValue"]).toBe(
      "Payment failed: card declined",
    );
    expect(attributeOf(records[1]!.record, "gcp.json_payload.orderId")).toEqual({
      stringValue: "o-981",
    });
    // A Cloud Functions function's logs are the function's in Serverless too.
    expect(resourceAttribute(records[1]!.resource, "cloud.platform")).toBe("gcp_cloud_functions");
    expect(resourceAttribute(records[1]!.resource, "faas.name")).toBe("charge-card");
    expect((records[2]!.record["body"] as JSONObject)["stringValue"]).toBe(
      `cloudsql.instances.update projects/${PROJECT}/instances/orders-db`,
    );
    expect(attributeOf(records[2]!.record, "enduser.id")).toEqual({
      stringValue: "alice@acme.com",
    });
    expect(records[2]!.record["severityText"]).toBe("INFO");
  });

  test("an entry of a resource the catalog has no rule for streams all the same, unfiled", async () => {
    expectPubSubAnswer(await push({ entry: gkeContainerEntry() }), 204);

    const records: Array<{ resource: JSONObject; record: JSONObject }> = allRecords();
    expect(records).toHaveLength(1);
    expect(resourceAttribute(records[0]!.resource, "cloud.resource_id")).toBeUndefined();
    expect(resourceAttribute(records[0]!.resource, "gcp.resource_type")).toBe("k8s_container");
    expect(resourceAttribute(records[0]!.resource, "cloud.account.id")).toBe(PROJECT);
  });

  test("a message that is no log entry is taken and left out: Pub/Sub would only push it again", async () => {
    for (const rawData of [
      Buffer.from("not json").toString("base64"),
      Buffer.from(JSON.stringify({ hello: "world" })).toString("base64"),
      "",
    ]) {
      expectPubSubAnswer(await push({ rawData }), 204);
    }

    expect(logJobs).toEqual([]);
  });
});

describe("a push pushed again", () => {
  test("after it was taken is answered 204 and not queued twice", async () => {
    const messageId: string = nextMessageId();

    expectPubSubAnswer(await push({ messageId }), 204);
    expectPubSubAnswer(await push({ messageId }), 204);
    expect(allRecords()).toHaveLength(1);
  });

  test("after the queue could not take it is queued then, whole", async () => {
    const messageId: string = nextMessageId();

    queueFails = true;
    expectPubSubAnswer(await push({ messageId }), 503);
    expect(logJobs).toEqual([]);

    queueFails = false;
    expectPubSubAnswer(await push({ messageId }), 204);
    expect(allRecords()).toHaveLength(1);
  });

  test("one connection's message ids are never another's", async () => {
    const messageId: string = nextMessageId();

    expectPubSubAnswer(await push({ messageId }), 204);
    expectPubSubAnswer(
      await push({
        messageId,
        token: pushToken({ key: GOOGLE, audience: KEY_B, email: PUSHER_B }),
      }),
      204,
    );

    expect(allRecords()).toHaveLength(2);
  });
});

describe("who a push is from", () => {
  test("the key decides the project, whatever the entry and the subscription say", async () => {
    expectPubSubAnswer(
      await push({
        token: pushToken({ key: GOOGLE, audience: KEY_B, email: PUSHER_B }),
        subscription: `projects/${PROJECT}/subscriptions/someone-elses`,
      }),
      204,
    );

    expect(logJobs).toHaveLength(1);
    expect(logJobs[0]!.projectId).toBe(PROJECT_B.toString());
    expect(resourceAttribute(recordsOf(logJobs[0]!)[0]!.resource, "service.name")).toBe(
      "Data Google Cloud",
    );
  });

  test("no token, or one that is no token, is refused alike: 401, and no connection read", async () => {
    for (const authorization of ["", "Basic dXNlcjpwYXNz", "Bearer not.a-token", "Bearer x"]) {
      expectPubSubAnswer(await push({ authorization }), 401);
    }

    expect(connectionReads).toBe(0);
    expect(logJobs).toEqual([]);
  });

  test("a wrong key of a connection that streams is refused and said on it", async () => {
    const wrong: string = keyOf(CONNECTION_A, "ff");

    expectPubSubAnswer(
      await push({ token: pushToken({ key: GOOGLE, audience: wrong, email: PUSHER_A }) }),
      401,
    );
    await CloudStreamActivity.flushAll(new Date());

    expect(summaries.get(CONNECTION_A.toString())?.lastRefusal?.reason).toBe(
      CloudStreamRefusalReason.WrongKey,
    );
    expect(logJobs).toEqual([]);
  });

  test("a key naming a connection that streams nothing is refused without reading it", async () => {
    const stranger: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");

    expectPubSubAnswer(
      await push({
        token: pushToken({ key: GOOGLE, audience: keyOf(stranger, "cd"), email: PUSHER_A }),
      }),
      401,
    );
    expect(connectionReads).toBe(0);
  });

  test("the right key with a token anyone else signed is refused, and said on the connection", async () => {
    expectPubSubAnswer(
      await push({ token: pushToken({ key: IMPOSTOR, audience: KEY_A, email: PUSHER_A }) }),
      401,
    );
    await CloudStreamActivity.flushAll(new Date());

    expect(summaries.get(CONNECTION_A.toString())?.lastRefusal?.reason).toBe(
      CloudStreamRefusalReason.WrongToken,
    );
    expect(logJobs).toEqual([]);
  });

  test("the right key with Google's token for another service account is refused: knowing the key is not enough", async () => {
    for (const email of [
      PUSHER_B,
      "attacker-sa@evil-project-1.iam.gserviceaccount.com",
      "someone@gmail.com",
    ]) {
      expectPubSubAnswer(
        await push({ token: pushToken({ key: GOOGLE, audience: KEY_A, email }) }),
        401,
      );
    }

    expectPubSubAnswer(
      await push({
        token: pushToken({
          key: GOOGLE,
          audience: KEY_A,
          email: PUSHER_A,
          payload: { email_verified: false },
        }),
      }),
      401,
    );
    expect(logJobs).toEqual([]);
  });

  test("an expired token is refused", async () => {
    const nowSeconds: number = Math.floor(Date.now() / 1000);

    expectPubSubAnswer(
      await push({
        token: pushToken({
          key: GOOGLE,
          audience: KEY_A,
          email: PUSHER_A,
          payload: { iat: nowSeconds - 7200, exp: nowSeconds - 3600 },
        }),
      }),
      401,
    );
  });

  test("while Google's keys cannot be read, a push is answered 503 - pushed again - and said on no connection", async () => {
    google.status = 500;

    expectPubSubAnswer(await push({}), 503);
    await CloudStreamActivity.flushAll(new Date());
    expect(summaries.get(CONNECTION_A.toString())?.lastRefusal).toBeUndefined();
    expect(logJobs).toEqual([]);
  });

  test("a connection turned off, a project that may not take telemetry or may not be billed is refused, pushed again", async () => {
    rows.get(CONNECTION_A.toString())!.isEnabled = false;
    CloudStreamAuthenticator.forget(CONNECTION_A);
    expectPubSubAnswer(await push({}), 403);

    rows.get(CONNECTION_A.toString())!.isEnabled = true;
    CloudStreamAuthenticator.forget(CONNECTION_A);
    (ProjectService.isProjectBlocked as jest.Mock).mockResolvedValue(true as never);
    expectPubSubAnswer(await push({}), 403);

    expect(logJobs).toEqual([]);
  });

  test("an AWS connection's key is refused at the Pub/Sub endpoint", async () => {
    rows.get(CONNECTION_A.toString())!.provider = CloudProvider.AWS;
    CloudStreamAuthenticator.forget(CONNECTION_A);

    expectPubSubAnswer(await push({}), 401);
    expect(logJobs).toEqual([]);
  });
});

describe("limits", () => {
  test("a request declaring more than it takes is answered before its body is sent", async () => {
    const reply: PushReply = await sendPush({
      port,
      token: pushToken({ key: GOOGLE, audience: KEY_A, email: PUSHER_A }),
      body: Buffer.alloc(16),
      declaredLength: CLOUD_STREAM_PUBSUB_MAX_REQUEST_BYTES + 1,
    });

    expectPubSubAnswer(reply, 413);
    await CloudStreamActivity.flushAll(new Date());
    expect(summaries.get(CONNECTION_A.toString())?.lastRefusal?.reason).toBe(
      CloudStreamRefusalReason.TooLarge,
    );
  });

  test("a body sent without a length is let go of as it grows past the limit", async () => {
    const reply: PushReply = await sendPush({
      port,
      token: pushToken({ key: GOOGLE, audience: KEY_A, email: PUSHER_A }),
      body: Buffer.alloc(CLOUD_STREAM_PUBSUB_MAX_REQUEST_BYTES + 64 * 1024, 120),
      chunked: true,
    });

    expectPubSubAnswer(reply, 413);
    expect(logJobs).toEqual([]);
  });

  test("a message's data past its limit is refused before it is decoded", async () => {
    const data: string = Buffer.alloc(CLOUD_STREAM_PUBSUB_MAX_MESSAGE_BYTES + 4096, 97).toString(
      "base64",
    );

    expectPubSubAnswer(await push({ rawData: data }), 413);
  });

  test("a body that is not a push is 400 and said on the connection", async () => {
    const reply: PushReply = await sendPush({
      port,
      token: pushToken({ key: GOOGLE, audience: KEY_A, email: PUSHER_A }),
      body: Buffer.from('{"records":[]}'),
    });

    expectPubSubAnswer(reply, 400);
    await CloudStreamActivity.flushAll(new Date());
    expect(summaries.get(CONNECTION_A.toString())?.lastRefusal?.reason).toBe(
      CloudStreamRefusalReason.Malformed,
    );
  });

  test("a compressed body is refused: Pub/Sub never compresses", async () => {
    const reply: PushReply = await sendPush({
      port,
      token: pushToken({ key: GOOGLE, audience: KEY_A, email: PUSHER_A }),
      body: pushEnvelope({ entry: cloudRunRequestEntry(), messageId: nextMessageId() }),
      headers: { "Content-Encoding": "gzip" },
    });

    expectPubSubAnswer(reply, 400);
  });

  test("past its pushes a minute, a connection is told 429 with when to push again, said once", async () => {
    rateDecision = TelemetryIngestionKeyLimitOutcome.RateLimited;

    const reply: PushReply = await push({});

    expectPubSubAnswer(reply, 429);
    expect(reply.headers["retry-after"]).toBe("23");
    await CloudStreamActivity.flushAll(new Date());
    expect(summaries.get(CONNECTION_A.toString())?.lastRefusal?.reason).toBe(
      CloudStreamRefusalReason.Throttled,
    );
  });

  test("with ingestion turned off, a push is taken and dropped", async () => {
    jest.spyOn(TelemetryIngestionDisabled, "isDisabled").mockReturnValue(true);

    expectPubSubAnswer(await push({}), 204);
    await settle();
    expect(logJobs).toEqual([]);
  });
});

describe("a burst of pushes", () => {
  test("is queued a batch at a time, every push answered once its batch is queued", async () => {
    PubSubLogBatcher.maxWaitMs = 150;

    const replies: Array<PushReply> = await Promise.all(
      Array.from({ length: 30 }, () => {
        return push({});
      }),
    );

    for (const reply of replies) {
      expectPubSubAnswer(reply, 204);
    }

    expect(allRecords()).toHaveLength(30);
    expect(logJobs.length).toBeLessThan(30);
    expect(logJobs.length).toBeGreaterThanOrEqual(1);
  });

  test("two projects' pushes are never one job", async () => {
    await Promise.all([
      push({}),
      push({ token: pushToken({ key: GOOGLE, audience: KEY_B, email: PUSHER_B }) }),
      push({}),
    ]);

    for (const job of logJobs) {
      const services: Set<string | undefined> = new Set(
        recordsOf(job).map((item: { resource: JSONObject }) => {
          return resourceAttribute(item.resource, "service.name");
        }),
      );

      expect(services.size).toBe(1);
      expect(job.projectId).toBe(
        services.has("Data Google Cloud") ? PROJECT_B.toString() : PROJECT_A.toString(),
      );
    }

    expect(allRecords()).toHaveLength(3);
  });
});

describe("the path", () => {
  test("is answered under /telemetry and /, with a trailing slash and in any case - its body left raw", async () => {
    for (const path of [
      "/telemetry/gcp-pubsub/v1/logs",
      "/gcp-pubsub/v1/logs",
      "/telemetry/gcp-pubsub/v1/logs/",
      "/Telemetry/GCP-PubSub/v1/Logs",
    ]) {
      expect(isCloudStreamPath(path)).toBe(true);
      expectPubSubAnswer(await push({ path }), 204);
    }

    expect(isCloudStreamPath("/gcp-pubsub/v1/metrics")).toBe(false);
  });
});
