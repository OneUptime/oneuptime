import net from "net";
import AzureArm from "../../../../Server/Utils/CloudConnection/Azure/AzureArm";
import AzureEventHubsStream, {
  AzureEventHubBatch,
  AzureEventHubNamespace,
  AzureEventHubsDeliveryFailed,
  AzureEventHubsRead,
} from "../../../../Server/Utils/CloudConnection/Azure/AzureEventHubsStream";
import { KafkaSocketFactory } from "../../../../Server/Utils/CloudConnection/Kafka/KafkaClient";
import { KafkaRecord } from "../../../../Server/Utils/CloudConnection/Kafka/KafkaProtocol";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";
import { getAzureCloudStreamNames } from "../../../../Types/CloudConnection/CloudStreamAzure";
import { JSONObject } from "../../../../Types/JSON";
import { FakeEventHubsBroker } from "./Helpers/FakeEventHubs";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Reading an Azure connection's event hubs: the namespaces Resource
 * Manager lists in the group the command names after the connection, then
 * each one over its Kafka endpoint - a fake namespace on a real socket -
 * signed in with an Entra token for that namespace alone. Pinned: events
 * are handed on a fetch at a time, and a partition's offset moves only
 * once they were taken; a read starts where the last stopped, from the
 * first event the first time and whenever the event hub no longer holds
 * where it stopped; it stops at its byte budget and its deadline; and each
 * way a namespace can fail is said for what it is.
 */

const CONNECTION: string = "6f1c3a2e-9b8d-4c7e-a1f0-2d3c4b5a6e7f";
const HOST_SUBSCRIPTION: string = "11111111-aaaa-4aaa-8aaa-111111111111";
const GROUP: string = getAzureCloudStreamNames(CONNECTION).resourceGroup;

let broker: FakeEventHubsBroker;
let armRequests: Array<DataSourceHttpRequest>;
let namespacesAnswer: { status: number; body: JSONObject };
let tokenScopes: Array<string>;

function namespaceItem(name: string, location: string, state: string = "Succeeded"): JSONObject {
  return {
    id: `/subscriptions/${HOST_SUBSCRIPTION}/resourceGroups/${GROUP}/providers/Microsoft.EventHub/namespaces/${name}`,
    name,
    location,
    properties: {
      provisioningState: state,
      serviceBusEndpoint: `https://${name}.servicebus.windows.net:443/`,
      kafkaEnabled: true,
    },
  };
}

async function transport(request: DataSourceHttpRequest): Promise<DataSourceHttpResponse> {
  armRequests.push(request);

  if (request.url.includes("/oauth2/v2.0/token")) {
    const scope: string = String((request.body as Record<string, string>)["scope"] || "");
    tokenScopes.push(scope);
    return {
      statusCode: 200,
      bodyText: "",
      bodyJson: { access_token: "entra-token", expires_in: 3600 },
    };
  }

  return {
    statusCode: namespacesAnswer.status,
    bodyText: JSON.stringify(namespacesAnswer.body),
    bodyJson: namespacesAnswer.body,
  };
}

function stream(now?: () => number): AzureEventHubsStream {
  return new AzureEventHubsStream({
    arm: new AzureArm({
      tenantId: "22222222-bbbb-4bbb-8bbb-222222222222",
      clientId: "0b9f6c1e-2d3a-4b5c-8d7e-9f0a1b2c3d4e",
      clientSecret: "app-secret",
      cloud: "public",
      transport,
      sleep: async (): Promise<void> => {},
    }),
    cloud: "public",
    socketFactoryFor: async (): Promise<KafkaSocketFactory> => {
      return (): net.Socket => {
        return broker.connect();
      };
    },
    ...(now ? { now } : {}),
  });
}

const EASTUS: AzureEventHubNamespace = {
  name: "oneuptime-6f1c3a2e-eastus",
  region: "eastus",
  host: "oneuptime-6f1c3a2e-eastus.servicebus.windows.net",
};

beforeEach(async () => {
  broker = new FakeEventHubsBroker();
  await broker.start();
  armRequests = [];
  tokenScopes = [];
  namespacesAnswer = {
    status: 200,
    body: {
      value: [
        namespaceItem("oneuptime-6f1c3a2e-westeurope", "westeurope"),
        namespaceItem("oneuptime-6f1c3a2e-eastus", "eastus"),
        namespaceItem("oneuptime-11111111-eastus", "eastus"),
        namespaceItem("my-own-namespace", "eastus"),
        namespaceItem("oneuptime-6f1c3a2e-uksouth", "uksouth", "Creating"),
      ],
    },
  };
});

afterEach(async () => {
  await broker.stop();
});

async function readAll(data: {
  offsets?: Record<string, Record<string, number>>;
  maxBytes?: number;
  deadlineMs?: number;
  deliver?: (batch: AzureEventHubBatch) => Promise<void>;
  now?: () => number;
}): Promise<{ read: AzureEventHubsRead; delivered: Array<AzureEventHubBatch>; moved: Array<string> }> {
  const delivered: Array<AzureEventHubBatch> = [];
  const moved: Array<string> = [];
  const read: AzureEventHubsRead = await stream(data.now).read({
    namespaces: [EASTUS],
    offsets: data.offsets || {},
    maxBytes: data.maxBytes ?? 64 * 1024 * 1024,
    deadlineMs: data.deadlineMs ?? Date.now() + 30_000,
    deliver:
      data.deliver ||
      (async (batch: AzureEventHubBatch): Promise<void> => {
        delivered.push(batch);
      }),
    onOffset: async (namespace: string, partition: number, offset: number): Promise<void> => {
      moved.push(`${namespace}:${partition}:${offset}`);
    },
  });

  return { read, delivered, moved };
}

function values(batches: Array<AzureEventHubBatch>): Array<string> {
  return batches.flatMap((batch: AzureEventHubBatch) => {
    return batch.records.map((record: KafkaRecord) => {
      return `${batch.partition}:${record.value!.toString("utf8")}`;
    });
  });
}

describe("the connection's namespaces", () => {
  test("are the group's whose names are the connection's and are made, each in its region", async () => {
    const namespaces: Array<AzureEventHubNamespace> = await stream().listNamespaces({
      connectionId: CONNECTION,
      hostSubscriptionId: HOST_SUBSCRIPTION,
    });

    expect(namespaces).toEqual([
      EASTUS,
      {
        name: "oneuptime-6f1c3a2e-westeurope",
        region: "westeurope",
        host: "oneuptime-6f1c3a2e-westeurope.servicebus.windows.net",
      },
    ]);

    const listed: DataSourceHttpRequest = armRequests.find((request: DataSourceHttpRequest) => {
      return request.url.includes("Microsoft.EventHub");
    })!;
    expect(new URL(listed.url).pathname).toBe(
      `/subscriptions/${HOST_SUBSCRIPTION}/resourceGroups/${GROUP}/providers/Microsoft.EventHub/namespaces`,
    );
    expect(new URL(listed.url).host).toBe("management.azure.com");
  });

  test("a group the command has not made yet is no namespace yet, not a failure", async () => {
    namespacesAnswer = {
      status: 404,
      body: { error: { code: "ResourceGroupNotFound", message: "Resource group not found." } },
    };

    expect(
      await stream().listNamespaces({
        connectionId: CONNECTION,
        hostSubscriptionId: HOST_SUBSCRIPTION,
      }),
    ).toEqual([]);
  });
});

describe("a read of an event hub", () => {
  test("signs in for that namespace alone and reads every partition from its first event the first time", async () => {
    broker.addEvents(0, ["a", "b", "c"]);
    broker.addEvents(1, ["d"]);

    const { read, delivered, moved } = await readAll({});

    expect(values(delivered).sort()).toEqual(["0:a", "0:b", "0:c", "1:d"]);
    expect(read.events).toBe(4);
    expect(read.offsets[EASTUS.name]).toEqual({ "0": 3, "1": 1 });
    expect(moved).toEqual(expect.arrayContaining([`${EASTUS.name}:0:3`, `${EASTUS.name}:1:1`]));
    expect(tokenScopes).toEqual([`https://${EASTUS.host}/.default`]);
    expect(broker.tokens).toEqual(["entra-token"]);
  });

  test("starts where the last read stopped: nothing is read twice", async () => {
    broker.addEvents(0, ["a", "b", "c", "e"]);
    broker.batchSize = 1;

    const { delivered, read } = await readAll({ offsets: { [EASTUS.name]: { "0": 3, "1": 0 } } });

    expect(values(delivered)).toEqual(["0:e"]);
    expect(read.offsets[EASTUS.name]).toEqual({ "0": 4, "1": 0 });
  });

  test("a batch holding events before where it stopped hands on only those after", async () => {
    broker.addEvents(0, ["a", "b", "c"]);
    broker.batchSize = 3;

    const { delivered } = await readAll({ offsets: { [EASTUS.name]: { "0": 1 } } });

    expect(values(delivered)).toEqual(["0:b", "0:c"]);
  });

  test("past where retention left the event hub, it reads from the first event still held", async () => {
    broker.partitions[0] = { earliest: 10, events: [] };
    broker.addEvents(0, ["k", "l"]);

    const { delivered, read } = await readAll({ offsets: { [EASTUS.name]: { "0": 4 } } });

    expect(values(delivered)).toEqual(["0:k", "0:l"]);
    expect(read.offsets[EASTUS.name]!["0"]).toBe(12);
  });

  test("an event hub made again, behind where it stopped, is read from its first event", async () => {
    broker.addEvents(0, ["new"]);

    const { delivered } = await readAll({ offsets: { [EASTUS.name]: { "0": 900 } } });

    expect(values(delivered)).toEqual(["0:new"]);
  });

  test("a partition's offset moves only once its events were taken: ones the queue could not take are read again", async () => {
    broker.addEvents(0, ["a", "b"]);
    broker.addEvents(1, ["c"]);
    const offsets: Record<string, Record<string, number>> = {};
    const moved: Array<string> = [];

    // Not the namespace's trouble: not said as it, and the read stops.
    await expect(
      stream().read({
        namespaces: [EASTUS],
        offsets,
        maxBytes: 64 * 1024 * 1024,
        deadlineMs: Date.now() + 30_000,
        deliver: async (): Promise<void> => {
          throw new Error("The queue is away");
        },
        onOffset: async (namespace: string, partition: number, offset: number): Promise<void> => {
          moved.push(`${partition}:${offset}`);
        },
      }),
    ).rejects.toThrow(AzureEventHubsDeliveryFailed);
    expect(moved).toEqual([]);

    const again: { delivered: Array<AzureEventHubBatch> } = await readAll({ offsets });
    expect(values(again.delivered).sort()).toEqual(["0:a", "0:b", "1:c"]);
  });

  test("stops at its byte budget and leaves the rest for the next read", async () => {
    broker.batchSize = 1;
    broker.addEvents(0, ["x".repeat(600), "y".repeat(600), "z".repeat(600)]);

    const { read, delivered } = await readAll({ maxBytes: 1000 });

    expect(read.isBudgetSpent).toBe(true);
    expect(values(delivered)).toHaveLength(2);
    expect(read.offsets[EASTUS.name]!["0"]).toBe(2);
  });

  test("stops at its deadline", async () => {
    broker.addEvents(0, ["a"]);

    const { read, delivered } = await readAll({ deadlineMs: Date.now() - 1 });

    expect(read.isBudgetSpent).toBe(true);
    expect(delivered).toEqual([]);
  });

  test("an event past the largest Event Hubs takes, or one with no value, is passed and never handed on", async () => {
    broker.batchSize = 1;
    broker.addEvents(0, [Buffer.alloc(0), "ok"]);

    const { delivered, read } = await readAll({});

    expect(values(delivered)).toEqual(["0:ok"]);
    expect(read.offsets[EASTUS.name]!["0"]).toBe(2);
  });

  test("a token the namespace refuses is no-access: the role is missing, or not in force yet", async () => {
    broker.token = "another";
    broker.addEvents(0, ["a"]);

    const { read, delivered } = await readAll({});

    expect(read.namespaces[0]!.problem).toBe("no-access");
    expect(delivered).toEqual([]);
  });

  test("an event hub the app may not read is no-access too", async () => {
    broker.isTopicDenied = true;

    const { read } = await readAll({});

    expect(read.namespaces[0]!.problem).toBe("no-access");
  });

  test("an event hub not made yet is waited for, not a problem", async () => {
    broker.isTopicMissing = true;

    const { read } = await readAll({});

    expect(read.namespaces[0]!.problem).toBeUndefined();
    expect(read.namespaces[0]!.isWaiting).toBe(true);
  });

  test("a namespace that cannot be reached is unreachable, said with why", async () => {
    await broker.stop();

    const { read } = await readAll({});

    expect(read.namespaces[0]!.problem).toBe("unreachable");
    expect(read.namespaces[0]!.message).toContain("could not be reached");

    broker = new FakeEventHubsBroker();
    await broker.start();
  });

  test("a broker asking to slow down is left until the next read", async () => {
    broker.batchSize = 1;
    broker.throttleTimeMs = 500;
    // An event a fetch at a time: each is past half of what a partition answers.
    broker.addEvents(0, ["a".repeat(600 * 1024), "b".repeat(600 * 1024), "c".repeat(600 * 1024)]);

    const { read } = await readAll({});

    expect(broker.fetches).toHaveLength(1);
    expect(read.events).toBe(1);
  });
});
