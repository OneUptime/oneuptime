import net from "net";
import CloudConnection from "../../../../Models/DatabaseModels/CloudConnection";
import CloudResource from "../../../../Models/DatabaseModels/CloudResource";
import Queue from "../../../../Server/Infrastructure/Queue";
import Redis from "../../../../Server/Infrastructure/Redis";
import CloudConnectionService from "../../../../Server/Services/CloudConnectionService";
import PayAsYouGoBillingService from "../../../../Server/Services/PayAsYouGoBillingService";
import ProjectService from "../../../../Server/Services/ProjectService";
import CloudStreamActivity from "../../../../Server/Utils/CloudConnection/CloudStreamActivity";
import CloudStreamReader, {
  AzureStreamContext,
  AzureStreamDelivered,
  CLOUD_STREAM_READ_JOB,
  CloudStreamReadOutcome,
} from "../../../../Server/Utils/CloudConnection/CloudStreamReader";
import { CloudConnectionSettings } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { KafkaSocketFactory } from "../../../../Server/Utils/CloudConnection/Kafka/KafkaClient";
import { KafkaRecord } from "../../../../Server/Utils/CloudConnection/Kafka/KafkaProtocol";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";
import LlmConnectionPullRunner from "../../../../Server/Utils/LlmObservability/LlmConnectionPullRunner";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import {
  CloudStreamRefusalReason,
  CloudStreamSummary,
  getCloudStreamState,
} from "../../../../Types/CloudConnection/CloudStream";
import { getAzureCloudStreamNames } from "../../../../Types/CloudConnection/CloudStreamAzure";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { FakeEventHubsBroker } from "./Helpers/FakeEventHubs";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * One read of an Azure connection's event hubs, end to end but for the
 * App's decoder (deliver, a fake that keeps what it is handed): the
 * connection read from its row, Resource Manager and Entra answered by a
 * fake transport, the namespace a fake Kafka broker on a real socket.
 * Pinned: the read holds to the project as every ingest path does; each
 * fetch is handed on with what it is decoded against - the connection's
 * service, project, resources as its reads wrote them and the key metric
 * definitions its reads keep - and its offsets move in Redis at once and in
 * Postgres at the end, never while streaming is stopped; it starts from the
 * newer of the two; and what it read, or why it could not, is said on the
 * connection so its status reads right. `jest` is the global one.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const CONNECTION: ObjectID = new ObjectID("6f1c3a2e-9b8d-4c7e-a1f0-2d3c4b5a6e7f");
const HOST_SUBSCRIPTION: string = "11111111-aaaa-4aaa-8aaa-111111111111";
const NAMESPACE: string = "oneuptime-6f1c3a2e-eastus";
const VM_ID: string =
  "/subscriptions/11111111-aaaa-4aaa-8aaa-111111111111/resourceGroups/rg-Prod/providers/Microsoft.Compute/virtualMachines/web-01";

let broker: FakeEventHubsBroker;
let row: CloudConnection;
let writes: Array<JSONObject>;
let redis: Map<string, string>;
let summaries: Map<string, CloudStreamSummary>;
let handed: Array<{ context: AzureStreamContext; namespaceRegion: string; records: Array<KafkaRecord> }>;
let admitted: boolean;
let queueFails: boolean;
let jobs: Array<{ jobId: string; name: string; data: JSONObject; options: JSONObject }>;

function connectionRow(): CloudConnection {
  const connection: CloudConnection = new CloudConnection();
  connection.id = CONNECTION;
  connection.projectId = PROJECT;
  connection.provider = CloudProvider.Azure;
  connection.isEnabled = true;
  connection.name = "Production Azure";
  connection.streamKeyCreatedAt = new Date("2026-11-06T09:00:00.000Z");
  connection.streamState = { hostSubscriptionId: HOST_SUBSCRIPTION, offsets: {} };
  connection.pullState = {
    azureMetricDefinitions: {
      "microsoft.compute/virtualmachines": {
        at: "2026-11-06T09:00:00.000Z",
        metrics: [
          { name: "Percentage CPU", unit: "Percent", aggregation: "Average", grain: "PT1M" },
          { name: "Available Memory Bytes", unit: "Bytes", aggregation: "Average", grain: "PT1M" },
        ],
      },
    },
  };
  return connection;
}

async function transport(request: DataSourceHttpRequest): Promise<DataSourceHttpResponse> {
  if (request.url.includes("/oauth2/v2.0/token")) {
    return {
      statusCode: 200,
      bodyText: "",
      bodyJson: { access_token: "entra-token", expires_in: 3600 },
    };
  }

  const body: JSONObject = {
    value: [
      {
        name: NAMESPACE,
        location: "eastus",
        properties: { provisioningState: "Succeeded" },
      },
    ],
  };

  return { statusCode: 200, bodyText: JSON.stringify(body), bodyJson: body };
}

async function deliver(data: {
  context: AzureStreamContext;
  namespaceRegion: string;
  records: Array<KafkaRecord>;
}): Promise<AzureStreamDelivered> {
  if (queueFails) {
    throw new Error("The queue is away");
  }

  handed.push(data);

  return {
    sightings: [
      {
        accountId: HOST_SUBSCRIPTION,
        region: data.namespaceRegion,
        namespaces: ["Microsoft.Compute/virtualMachines"],
        logGroups: ["AuditEvent"],
      },
    ],
  };
}

async function read(): Promise<CloudStreamReadOutcome> {
  return await CloudStreamReader.readAzure(CONNECTION, {
    deliver,
    transport,
    socketFactoryFor: async (): Promise<KafkaSocketFactory> => {
      return (): net.Socket => {
        return broker.connect();
      };
    },
  });
}

async function summary(): Promise<CloudStreamSummary> {
  await CloudStreamActivity.flushAll(new Date());
  return summaries.get(CONNECTION.toString()) || { metricSources: [], logSources: [] };
}

beforeEach(async () => {
  broker = new FakeEventHubsBroker();
  broker.host = `${NAMESPACE}.servicebus.windows.net`;
  await broker.start();
  row = connectionRow();
  writes = [];
  redis = new Map();
  summaries = new Map();
  handed = [];
  admitted = true;
  queueFails = false;
  jobs = [];
  CloudStreamReader.reset();
  CloudStreamActivity.reset();

  jest.spyOn(CloudConnectionService, "findOneById").mockImplementation((async () => {
    return row;
  }) as never);
  jest
    .spyOn(CloudConnectionService, "getConnectorSettings")
    .mockImplementation(async (): Promise<CloudConnectionSettings> => {
      return {
        provider: CloudProvider.Azure,
        projectId: PROJECT.toString(),
        config: {
          tenantId: "22222222-bbbb-4bbb-8bbb-222222222222",
          clientId: "0b9f6c1e-2d3a-4b5c-8d7e-9f0a1b2c3d4e",
          cloud: "public",
        },
        secrets: { clientSecret: "app-secret" },
      };
    });
  jest.spyOn(CloudConnectionService, "ensureTelemetryService").mockResolvedValue({
    serviceId: new ObjectID("22222222-2222-4222-8222-222222222222"),
    serviceName: "Production Azure",
  });
  jest
    .spyOn(CloudConnectionService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (data: { data: JSONObject }) => {
      writes.push(data.data);
    }) as never);
  CloudStreamReader.loadResources = async (): Promise<Array<CloudResource>> => {
    const resource: CloudResource = new CloudResource();
    resource.name = "web-01";
    resource.providerResourceId = VM_ID;
    resource.telemetryAttributes = { "azuremonitor.resource_id": VM_ID };
    resource.cloudRegion = "eastus";
    resource.cloudResourceType = "Microsoft.Compute/virtualMachines";
    resource.cloudResourceGroup = "rg-Prod";
    resource.cloudAccountId = HOST_SUBSCRIPTION;
    return [resource];
  };
  jest.spyOn(LlmConnectionPullRunner, "isTelemetryAllowed").mockImplementation(async () => {
    return admitted;
  });
  jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
  jest.spyOn(PayAsYouGoBillingService, "requirePayAsYouGo").mockResolvedValue(undefined);
  jest.spyOn(Redis, "isConnected").mockReturnValue(true);
  jest.spyOn(Redis, "getClient").mockReturnValue({
    get: async (key: string): Promise<string | null> => {
      return redis.get(key) ?? null;
    },
    mget: async (keys: Array<string>): Promise<Array<string | null>> => {
      return keys.map((key: string) => {
        return redis.get(key) ?? null;
      });
    },
    set: async (key: string, value: string): Promise<string> => {
      redis.set(key, value);
      return "OK";
    },
  } as never);
  jest.spyOn(Queue, "addJob").mockImplementation((async (
    _queue: unknown,
    jobId: string,
    name: string,
    data: JSONObject,
    options: JSONObject,
  ) => {
    jobs.push({ jobId, name, data, options });
  }) as never);

  CloudStreamActivity.readSummary = async (id: ObjectID): Promise<CloudStreamSummary> => {
    return summaries.get(id.toString()) || { metricSources: [], logSources: [] };
  };
  CloudStreamActivity.writeSummary = async (data: {
    connectionId: ObjectID;
    summary: CloudStreamSummary;
  }): Promise<void> => {
    summaries.set(data.connectionId.toString(), data.summary);
  };
});

afterEach(async () => {
  jest.restoreAllMocks();
  await broker.stop();
});

describe("a read of a streaming Azure connection", () => {
  test("hands each fetch on with what it is decoded against: the connection's service, project, resources and key metrics", async () => {
    broker.addEvents(0, ['{"records":[]}', '{"records":[]}']);
    broker.addEvents(1, ['{"records":[]}']);

    const outcome: CloudStreamReadOutcome = await read();

    expect(outcome).toEqual({ status: "read", events: 3 });
    expect(handed.length).toBeGreaterThanOrEqual(2);

    const context: AzureStreamContext = handed[0]!.context;
    expect(context.projectId.toString()).toBe(PROJECT.toString());
    expect(context.connectionId.toString()).toBe(CONNECTION.toString());
    expect(context.serviceName).toBe("Production Azure");
    // Keyed lower case, as Azure's records uppercase their ids; the reads' casing kept.
    expect(context.resources.get(VM_ID.toLowerCase())).toEqual({
      resourceId: VM_ID,
      providerResourceId: VM_ID,
      name: "web-01",
      type: "Microsoft.Compute/virtualMachines",
      resourceGroup: "rg-Prod",
      region: "eastus",
      subscriptionId: HOST_SUBSCRIPTION,
    });
    expect(
      context.definitions.get("microsoft.compute/virtualmachines")?.get("percentage cpu"),
    ).toEqual({ name: "Percentage CPU", aggregation: "Average", unit: "Percent", grain: "PT1M" });
    expect(handed[0]!.namespaceRegion).toBe("eastus");
  });

  test("moves its offsets in Redis at once and in Postgres at the end, with the event hubs' subscription", async () => {
    broker.addEvents(0, ["{}", "{}", "{}"]);
    broker.addEvents(1, ["{}"]);

    await read();

    expect(redis.get(`cloudstream:eventhub:${CONNECTION.toString()}:${NAMESPACE}:0`)).toBe("3");
    expect(redis.get(`cloudstream:eventhub:${CONNECTION.toString()}:${NAMESPACE}:1`)).toBe("1");
    expect(writes).toEqual([
      {
        streamState: {
          hostSubscriptionId: HOST_SUBSCRIPTION,
          offsets: { [NAMESPACE]: { "0": 3, "1": 1 } },
        },
      },
    ]);
  });

  test("starts from what Redis holds when a read moved on past what Postgres has, so nothing is queued twice", async () => {
    broker.batchSize = 1;
    broker.addEvents(0, ['{"n":1}', '{"n":2}', '{"n":3}']);
    row.streamState = {
      hostSubscriptionId: HOST_SUBSCRIPTION,
      offsets: { [NAMESPACE]: { "0": 1 } },
    };
    redis.set(`cloudstream:eventhub:${CONNECTION.toString()}:${NAMESPACE}:0`, "2");

    await read();

    expect(
      handed.flatMap((batch: { records: Array<KafkaRecord> }) => {
        return batch.records.map((record: KafkaRecord) => {
          return record.value!.toString("utf8");
        });
      }),
    ).toEqual(['{"n":3}']);
  });

  test("what it read is said on the connection: receiving, from where", async () => {
    broker.addEvents(0, ["{}"]);

    await read();

    const said: CloudStreamSummary = await summary();
    expect(getCloudStreamState({ hasKey: true, summary: said, now: new Date() })).toBe("receiving");
    expect(said.metricSources[0]).toMatchObject({
      accountId: HOST_SUBSCRIPTION,
      region: "eastus",
      namespaces: ["Microsoft.Compute/virtualMachines"],
    });
    expect(said.logSources[0]!.logGroups).toEqual(["AuditEvent"]);
  });

  test("a read with nothing new says it read, so a refusal before it is no longer the newest", async () => {
    summaries.set(CONNECTION.toString(), {
      metricSources: [],
      logSources: [],
      lastRefusal: {
        at: new Date(Date.now() - 60_000).toISOString(),
        reason: CloudStreamRefusalReason.NoAccess,
      },
    });

    await read();

    const said: CloudStreamSummary = await summary();
    expect(said.lastReadAt).toBeDefined();
    expect(getCloudStreamState({ hasKey: true, summary: said, now: new Date() })).toBe("waiting");
  });

  test("a token the namespace refuses says no-access on the connection", async () => {
    broker.token = "not-this-one";

    const outcome: CloudStreamReadOutcome = await read();

    expect(outcome.status).toBe("failed");
    expect((await summary()).lastRefusal?.reason).toBe(CloudStreamRefusalReason.NoAccess);
    expect(writes).toHaveLength(1);
  });

  test("a namespace that cannot be reached says unreachable", async () => {
    await broker.stop();

    await read();

    expect((await summary()).lastRefusal?.reason).toBe(CloudStreamRefusalReason.Unreachable);
    broker = new FakeEventHubsBroker();
    await broker.start();
  });

  test("a project that may not take telemetry reads nothing, and says so", async () => {
    admitted = false;
    broker.addEvents(0, ["{}"]);

    const outcome: CloudStreamReadOutcome = await read();

    expect(outcome.status).toBe("skipped");
    expect(handed).toEqual([]);
    expect(broker.connections).toBe(0);
    expect((await summary()).lastRefusal?.reason).toBe(CloudStreamRefusalReason.NotAllowed);
  });

  test("events the queue could not take are read again, and nothing is said on the connection", async () => {
    broker.addEvents(0, ["{}"]);
    queueFails = true;

    const outcome: CloudStreamReadOutcome = await read();

    expect(outcome).toEqual({ status: "failed", events: 0, reason: "queue" });
    expect((await summary()).lastRefusal).toBeUndefined();
    expect(writes).toEqual([]);

    queueFails = false;
    await read();
    expect(handed).toHaveLength(1);
  });

  test("streaming stopped while it read: the offsets it reached are not written back", async () => {
    broker.addEvents(0, ["{}"]);
    jest.spyOn(CloudConnectionService, "findOneById").mockImplementation((async (data: {
      select: JSONObject;
    }) => {
      // The read's own look at the row, then the look before it writes.
      if (data.select["streamState"]) {
        return row;
      }

      const stopped: CloudConnection = connectionRow();
      stopped.streamKeyCreatedAt = undefined as never;
      return stopped;
    }) as never);

    await read();

    expect(handed).toHaveLength(1);
    expect(writes).toEqual([]);
  });

  test.each([
    ["an AWS connection", (connection: CloudConnection): void => {
      connection.provider = CloudProvider.AWS;
    }],
    ["a connection turned off", (connection: CloudConnection): void => {
      connection.isEnabled = false;
    }],
    ["a connection not streaming", (connection: CloudConnection): void => {
      connection.streamKeyCreatedAt = undefined as never;
    }],
    ["a connection with no event hubs' subscription", (connection: CloudConnection): void => {
      connection.streamState = {};
    }],
  ])("%s is not read", async (_name: string, change: (connection: CloudConnection) => void) => {
    change(row);

    const outcome: CloudStreamReadOutcome = await read();

    expect(outcome.status).toBe("skipped");
    expect(broker.connections).toBe(0);
  });

  test("with no event hub made yet, it reads nothing and says nothing", async () => {
    jest.restoreAllMocks();
    jest.spyOn(CloudConnectionService, "findOneById").mockImplementation((async () => {
      return row;
    }) as never);
    jest.spyOn(CloudConnectionService, "getConnectorSettings").mockResolvedValue({
      provider: CloudProvider.Azure,
      projectId: PROJECT.toString(),
      config: { tenantId: "22222222-bbbb-4bbb-8bbb-222222222222", clientId: "0b9f6c1e-2d3a-4b5c-8d7e-9f0a1b2c3d4e" },
      secrets: { clientSecret: "app-secret" },
    });
    jest.spyOn(LlmConnectionPullRunner, "isTelemetryAllowed").mockResolvedValue(true);
    jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
    jest.spyOn(PayAsYouGoBillingService, "requirePayAsYouGo").mockResolvedValue(undefined);

    const outcome: CloudStreamReadOutcome = await CloudStreamReader.readAzure(CONNECTION, {
      deliver,
      transport: async (request: DataSourceHttpRequest): Promise<DataSourceHttpResponse> => {
        if (request.url.includes("/oauth2/v2.0/token")) {
          return { statusCode: 200, bodyText: "", bodyJson: { access_token: "t", expires_in: 3600 } };
        }

        return {
          statusCode: 404,
          bodyText: "",
          bodyJson: { error: { code: "ResourceGroupNotFound" } },
        };
      },
    });

    expect(outcome).toEqual({ status: "read", events: 0, reason: "no event hubs yet" });
  });
});

describe("the reads queued each minute", () => {
  test("are one job per Azure connection that streams, each kept to one at a time", async () => {
    const other: ObjectID = new ObjectID("7f1c3a2e-9b8d-4c7e-a1f0-2d3c4b5a6e7f");
    const findBy: jest.SpyInstance = jest
      .spyOn(CloudConnectionService, "findBy")
      .mockImplementation((async () => {
        return [row, Object.assign(new CloudConnection(), { id: other })];
      }) as never);

    expect(await CloudStreamReader.enqueueDue(new Date("2026-11-06T10:00:30.000Z"))).toBe(2);

    const query: JSONObject = (findBy.mock.calls[0]![0] as { query: JSONObject }).query;
    expect(query["provider"]).toBe(CloudProvider.Azure);
    expect(query["isEnabled"]).toBe(true);
    expect(query["streamKeyCreatedAt"]).toBeDefined();

    expect(jobs).toEqual([
      {
        jobId: `cloud-stream-read-${CONNECTION.toString()}-29899320`,
        name: CLOUD_STREAM_READ_JOB,
        data: { connectionId: CONNECTION.toString() },
        options: {
          attempts: 1,
          deduplication: { id: `cloud-stream-read-${CONNECTION.toString()}` },
        },
      },
      {
        jobId: `cloud-stream-read-${other.toString()}-29899320`,
        name: CLOUD_STREAM_READ_JOB,
        data: { connectionId: other.toString() },
        options: {
          attempts: 1,
          deduplication: { id: `cloud-stream-read-${other.toString()}` },
        },
      },
    ]);
  });
});

describe("the key metrics a read is decoded against", () => {
  test("are those the connection's reads keep, each type's by name, lower case", () => {
    const definitions: ReturnType<typeof CloudStreamReader.readDefinitions> =
      CloudStreamReader.readDefinitions(connectionRow().pullState);

    expect(Array.from(definitions.keys())).toEqual(["microsoft.compute/virtualmachines"]);
    expect(
      Array.from(definitions.get("microsoft.compute/virtualmachines")!.keys()),
    ).toEqual(["percentage cpu", "available memory bytes"]);
  });

  test("a pull state that holds none, or holds them broken, gives none", () => {
    for (const state of [undefined, null, [], {}, { azureMetricDefinitions: [] }, {
      azureMetricDefinitions: { x: { metrics: [{ name: "", aggregation: "Average" }, 7] } },
    }]) {
      const definitions: ReturnType<typeof CloudStreamReader.readDefinitions> =
        CloudStreamReader.readDefinitions(state);

      expect(
        Array.from(definitions.values()).flatMap((byName: Map<string, unknown>) => {
          return Array.from(byName.keys());
        }),
      ).toEqual([]);
    }
  });

  test("the group the namespaces are looked for in is the connection's", () => {
    expect(getAzureCloudStreamNames(CONNECTION.toString()).resourceGroup).toBe(
      "oneuptime-stream-6f1c3a2e",
    );
  });
});
