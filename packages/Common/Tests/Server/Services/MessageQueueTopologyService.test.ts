import "../TestingUtils/Init";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import MessageQueueService from "../../../Server/Services/MessageQueueService";
import MessageQueueTopologyService, {
  MessageQueueTopologyRequest,
} from "../../../Server/Services/MessageQueueTopologyService";
import ServiceService from "../../../Server/Services/ServiceService";
import SpanService from "../../../Server/Services/SpanService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import MessageQueue from "../../../Models/DatabaseModels/MessageQueue";
import Service from "../../../Models/DatabaseModels/Service";
import Includes from "../../../Types/BaseDatabase/Includes";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import {
  MESSAGE_QUEUE_TOPOLOGY_MAX_PAIRS,
  MESSAGE_QUEUE_TOPOLOGY_MAX_QUEUES,
  MessageQueueTopologyQueue,
  MessageQueueTopologyResponse,
} from "../../../Types/MessageQueue/MessageQueueTopology";
import { parseMessageQueueIdentifier } from "../../../Types/MessageQueue/MessageQueueIdentity";
import { keyForMessageQueue } from "../../../Utils/Telemetry/EntityKey";

/*
 * Running the Queues topology's read for one project: the caller's live
 * queues from Postgres with their props, the one span read over every
 * queue's key under their read scope, the names of the services it found -
 * and nothing more than needed (no span read without a queue key, no name
 * lookup without a service).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5f2b7c1e-8d3a-4b6f-9c0d-1e2f3a4b5c6d",
);
const SERVICE_A: string = "3c0e7b2a-1111-4111-8111-000000000001";
const SERVICE_B: string = "3c0e7b2a-1111-4111-8111-000000000002";

const PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: ObjectID.generate(),
};

function request(
  extra?: Partial<MessageQueueTopologyRequest>,
): MessageQueueTopologyRequest {
  return {
    projectId: PROJECT_ID,
    window: {
      startTime: new Date("2026-11-07T11:00:00.000Z"),
      endTime: new Date("2026-11-07T12:00:00.000Z"),
    },
    serviceFilter: {},
    props: PROPS,
    ...extra,
  };
}

function queueRow(
  id: string,
  identifier: string,
  system: string,
): MessageQueue {
  const row: MessageQueue = new MessageQueue();
  // "system|broker scope|destination": one that names no queue has none.
  const destination: string | undefined = identifier.split("|")[2];
  row._id = id;
  if (destination !== undefined) {
    row.name = destination;
    row.destinationName = destination;
  }
  row.messagingSystem = system;
  row.queueIdentifier = identifier;
  row.discoverySource = "traces";
  return row;
}

function keyOf(identifier: string): string {
  return keyForMessageQueue(
    PROJECT_ID.toString(),
    parseMessageQueueIdentifier(identifier)!,
  );
}

function service(id: string, name: string): Service {
  const row: Service = new Service();
  row._id = id;
  row.name = name;
  return row;
}

type Spy = {
  mock: { calls: Array<Array<unknown>> };
  mockResolvedValue: (value: unknown) => void;
  mockRejectedValue: (value: unknown) => void;
};

let findQueues: Spy;
let countQueues: Spy;
let executeQuery: Spy;
let findServices: Spy;

function answerRows(rows: Array<JSONObject>): void {
  executeQuery.mockResolvedValue({
    json: async () => {
      return { data: rows };
    },
  });
}

describe("MessageQueueTopologyService", () => {
  beforeEach(() => {
    findQueues = jest.spyOn(
      MessageQueueService,
      "findBy" as never,
    ) as unknown as Spy;
    countQueues = jest.spyOn(
      MessageQueueService,
      "countBy" as never,
    ) as unknown as Spy;
    executeQuery = jest.spyOn(
      SpanService,
      "executeQuery" as never,
    ) as unknown as Spy;
    findServices = jest.spyOn(
      ServiceService,
      "findBy" as never,
    ) as unknown as Spy;
    findQueues.mockResolvedValue([]);
    countQueues.mockResolvedValue(new PositiveNumber(0));
    answerRows([]);
    findServices.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("reads the live queues with the caller's props, oldest first, at most the topology's limit", async () => {
    await MessageQueueTopologyService.getTopology(request());
    expect(findQueues.mock.calls).toHaveLength(1);
    const findBy: JSONObject = findQueues.mock.calls[0]![0] as JSONObject;
    expect(findBy["query"]).toEqual({
      projectId: PROJECT_ID,
      isArchived: false,
    });
    expect(findBy["props"]).toBe(PROPS);
    expect(findBy["limit"]).toBe(MESSAGE_QUEUE_TOPOLOGY_MAX_QUEUES);
    expect(findBy["skip"]).toBe(0);
    expect(findBy["sort"]).toEqual({ createdAt: SortOrder.Ascending });
    expect(Object.keys(findBy["select"] as JSONObject).sort()).toEqual(
      [
        "_id",
        "brokerAddress",
        "brokerMetricsLastSeenAt",
        "brokerScope",
        "destinationName",
        "discoverySource",
        "lastSeenAt",
        "messagingSystem",
        "name",
        "queueIdentifier",
      ].sort(),
    );
  });

  test("a project with no queue sends no span read and looks up no name", async () => {
    const topology: MessageQueueTopologyResponse =
      await MessageQueueTopologyService.getTopology(request());
    expect(executeQuery.mock.calls).toHaveLength(0);
    expect(findServices.mock.calls).toHaveLength(0);
    expect(topology.queues).toEqual([]);
    expect(topology.flows).toEqual([]);
    expect(topology.truncation).toEqual({ queues: false, flows: false });
  });

  test("queues whose identifiers name no queue are listed, and send no span read", async () => {
    findQueues.mockResolvedValue([queueRow("q1", "garbage", "kafka")]);
    const topology: MessageQueueTopologyResponse =
      await MessageQueueTopologyService.getTopology(request());
    expect(executeQuery.mock.calls).toHaveLength(0);
    expect(
      topology.queues.map((queue: MessageQueueTopologyQueue) => {
        return queue.id;
      }),
    ).toEqual(["q1"]);
  });

  test("one span read over every queue's key, under the caller's scope; the rows become the map", async () => {
    findQueues.mockResolvedValue([
      queueRow("q1", "kafka||orders", "kafka"),
      queueRow("q2", "aws_sqs||payments", "aws_sqs"),
    ]);
    answerRows([
      {
        queueKey: keyOf("kafka||orders"),
        serviceId: SERVICE_A,
        spanCount: "10",
        errorCount: "1",
        publishCount: "10",
        publishErrors: "1",
        publishP95: 4_000_000,
      },
      {
        queueKey: keyOf("kafka||orders"),
        serviceId: SERVICE_B,
        spanCount: "8",
        errorCount: "0",
        consumeCount: "8",
        consumeErrors: "0",
        consumeP95: 30_000_000,
      },
    ]);
    findServices.mockResolvedValue([
      service(SERVICE_A, "checkout"),
      service(SERVICE_B, "fulfilment"),
    ]);

    const topology: MessageQueueTopologyResponse =
      await MessageQueueTopologyService.getTopology(
        request({
          serviceFilter: {
            serviceIds: [new ObjectID(SERVICE_A), new ObjectID(SERVICE_B)],
          },
        }),
      );

    expect(executeQuery.mock.calls).toHaveLength(1);
    const statement: Statement = executeQuery.mock.calls[0]![0] as Statement;
    const params: Array<unknown> = Object.values(statement.query_params);
    expect(params).toContainEqual(
      expect.arrayContaining([
        keyOf("kafka||orders"),
        keyOf("aws_sqs||payments"),
      ]),
    );
    expect(params).toContainEqual([SERVICE_A, SERVICE_B]);
    expect(params).toContain(MESSAGE_QUEUE_TOPOLOGY_MAX_PAIRS);

    expect(
      topology.queues.find((queue: MessageQueueTopologyQueue) => {
        return queue.id === "q1";
      }),
    ).toMatchObject({
      spans: 18,
      errors: 1,
      published: 10,
      consumed: 8,
    });
    expect(
      topology.queues.find((queue: MessageQueueTopologyQueue) => {
        return queue.id === "q2";
      }),
    ).toMatchObject({
      spans: 0,
      published: 0,
    });
    expect(topology.flows).toEqual([
      {
        queueId: "q1",
        serviceId: SERVICE_A,
        direction: "publish",
        messages: 10,
        errors: 1,
        errorRatePercent: 10,
        p95DurationMs: 4,
      },
      {
        queueId: "q1",
        serviceId: SERVICE_B,
        direction: "consume",
        messages: 8,
        errors: 0,
        errorRatePercent: 0,
        p95DurationMs: 30,
      },
    ]);
    expect(topology.services).toEqual([
      { id: SERVICE_A, name: "checkout" },
      { id: SERVICE_B, name: "fulfilment" },
    ]);
  });

  test("the names are read with the caller's props, only for the services found, only real ids", async () => {
    findQueues.mockResolvedValue([queueRow("q1", "kafka||orders", "kafka")]);
    answerRows([
      {
        queueKey: keyOf("kafka||orders"),
        serviceId: SERVICE_A,
        spanCount: "1",
        publishCount: "1",
      },
      {
        queueKey: keyOf("kafka||orders"),
        serviceId: "",
        spanCount: "1",
        publishCount: "1",
      },
      {
        queueKey: keyOf("kafka||orders"),
        serviceId: "not-an-id",
        spanCount: "1",
        publishCount: "1",
      },
    ]);
    await MessageQueueTopologyService.getTopology(request());
    expect(findServices.mock.calls).toHaveLength(1);
    const findBy: JSONObject = findServices.mock.calls[0]![0] as JSONObject;
    expect(findBy["props"]).toBe(PROPS);
    const ids: Includes = (findBy["query"] as JSONObject)[
      "_id"
    ] as unknown as Includes;
    expect(
      ids.values.map((value: unknown) => {
        return String(value);
      }),
    ).toEqual([SERVICE_A]);
    expect((findBy["query"] as JSONObject)["projectId"]).toBe(PROJECT_ID);
  });

  test("a failed name lookup leaves the services unnamed; the map still stands", async () => {
    findQueues.mockResolvedValue([queueRow("q1", "kafka||orders", "kafka")]);
    answerRows([
      {
        queueKey: keyOf("kafka||orders"),
        serviceId: SERVICE_A,
        spanCount: "1",
        publishCount: "1",
      },
    ]);
    findServices.mockRejectedValue(new Error("not allowed to read services"));
    const topology: MessageQueueTopologyResponse =
      await MessageQueueTopologyService.getTopology(request());
    expect(topology.services).toEqual([{ id: SERVICE_A, name: "" }]);
    expect(topology.flows).toHaveLength(1);
  });

  test("a span read that fails, fails the topology (the route answers with its error)", async () => {
    findQueues.mockResolvedValue([queueRow("q1", "kafka||orders", "kafka")]);
    executeQuery.mockRejectedValue(
      new Error("This query took longer than 45 seconds"),
    );
    await expect(
      MessageQueueTopologyService.getTopology(request()),
    ).rejects.toThrow("This query took longer than 45 seconds");
  });

  test("a queue read the caller may not make is refused before any span is read", async () => {
    findQueues.mockRejectedValue(
      new Error("You do not have permission to read Queues"),
    );
    await expect(
      MessageQueueTopologyService.getTopology(request()),
    ).rejects.toThrow("permission");
    expect(executeQuery.mock.calls).toHaveLength(0);
  });

  test("says when it read only some of the queues, counting them only then", async () => {
    const rows: Array<MessageQueue> = Array.from(
      { length: 3 },
      (_value: unknown, index: number): MessageQueue => {
        return queueRow(`q${index}`, `kafka||topic-${index}`, "kafka");
      },
    );
    findQueues.mockResolvedValue(rows);
    let topology: MessageQueueTopologyResponse =
      await MessageQueueTopologyService.getTopology(request());
    expect(countQueues.mock.calls).toHaveLength(0);
    expect(topology.truncation.queues).toBe(false);

    const full: Array<MessageQueue> = Array.from(
      { length: MESSAGE_QUEUE_TOPOLOGY_MAX_QUEUES },
      (_value: unknown, index: number): MessageQueue => {
        return queueRow(`q${index}`, `kafka||t${index}`, "kafka");
      },
    );
    findQueues.mockResolvedValue(full);
    countQueues.mockResolvedValue(
      new PositiveNumber(MESSAGE_QUEUE_TOPOLOGY_MAX_QUEUES + 5),
    );
    topology = await MessageQueueTopologyService.getTopology(request());
    expect(countQueues.mock.calls).toHaveLength(1);
    expect(topology.truncation.queues).toBe(true);

    // Exactly at the limit is the whole list.
    countQueues.mockResolvedValue(
      new PositiveNumber(MESSAGE_QUEUE_TOPOLOGY_MAX_QUEUES),
    );
    topology = await MessageQueueTopologyService.getTopology(request());
    expect(topology.truncation.queues).toBe(false);
  });

  test("says when the span read reached its row limit", async () => {
    findQueues.mockResolvedValue([queueRow("q1", "kafka||orders", "kafka")]);
    const rows: Array<JSONObject> = Array.from(
      { length: MESSAGE_QUEUE_TOPOLOGY_MAX_PAIRS },
      (): JSONObject => {
        return {
          queueKey: keyOf("kafka||orders"),
          serviceId: "",
          spanCount: "1",
        };
      },
    );
    answerRows(rows);
    const topology: MessageQueueTopologyResponse =
      await MessageQueueTopologyService.getTopology(request());
    expect(topology.truncation.flows).toBe(true);
  });
});
