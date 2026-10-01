/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it, and DatabaseService imports it.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import MessageQueueService, {
  MessageQueueFindOrCreateResult,
  getMessagingSystemRuleMatchValues,
  resolveManualMessageQueue,
} from "../../../Server/Services/MessageQueueService";
import MessageQueueLabelRuleEngineService from "../../../Server/Services/MessageQueueLabelRuleEngineService";
import MessageQueueOwnerRuleEngineService from "../../../Server/Services/MessageQueueOwnerRuleEngineService";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import ResourceHeartbeat from "../../../Server/Utils/Telemetry/ResourceHeartbeat";
import SingleFlight from "../../../Server/Utils/SingleFlight";
import logger from "../../../Server/Utils/Logger";
import MessageQueue from "../../../Models/DatabaseModels/MessageQueue";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import {
  MessageQueueIdentity,
  buildMessageQueueDisplayName,
  toMessageQueueIdentity,
} from "../../../Types/MessageQueue/MessageQueueIdentity";
import { resolveManualMessageQueue as sharedResolveManualMessageQueue } from "../../../Types/MessageQueue/MessageQueueManualIdentity";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import { getJestSpyOn } from "../../Spy";
import crypto from "crypto";

/*
 * MessageQueueService - the Queues product's root service.
 *
 * Pinned here, everything external mocked at its seam (no Postgres, no Redis):
 *
 *   - a MANUAL create through the real create pipeline, column permission
 *     check included: system normalized, destination normalized as
 *     discovery normalizes it (a RabbitMQ queue's name taken whole, as its
 *     broker reports it), identity computed on the system's family,
 *     discoverySource forced to manual, and a friendly refusal for every
 *     unusable value and for a duplicate;
 *   - findOrCreateByIdentity: lookup first, the system refined within its
 *     family (never back, never across), discovery's archive undone and a
 *     person's never, allowCreate=false and the budget never create, the
 *     create as root without hooks, and the unique-index race (the winner's
 *     row returned, the rule engines run only by the winner);
 *   - recordSighting: two heartbeats in two namespaces, the broker address
 *     only when non-empty and changed, lastSeenAt as the time discovery saw
 *     the queue (never moving backwards, whichever source writes last or
 *     however late its data) and the broker's own datapoint time as
 *     brokerMetricsLastSeenAt;
 *   - the auto-archive and budget SQL, each scoping project + deletedAt
 *     itself, and a person's archive decisions and labels.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const USER_ID: ObjectID = new ObjectID("dddddddd-dddd-4ddd-8ddd-dddddddddddd");

const service: any = MessageQueueService;

function userPermission(permission: Permission): UserPermission {
  return {
    permission,
    labelIds: [],
    isBlockPermission: false,
    _type: "UserPermission",
  };
}

function memberProps(
  permissions: Array<Permission> = [Permission.ProjectMember],
): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userGlobalAccessPermission: {
      projectIds: [PROJECT_ID],
      globalPermissions: [Permission.Public, Permission.User],
      _type: "UserGlobalAccessPermission",
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        projectId: PROJECT_ID,
        permissions: permissions.map(userPermission),
        _type: "UserTenantAccessPermission",
      },
    },
  };
}

function queueRow(overrides: Partial<MessageQueue> = {}): MessageQueue {
  const row: MessageQueue = new MessageQueue(ObjectID.generate());
  row.projectId = PROJECT_ID;
  row.name = "orders";
  row.queueIdentifier = "jms||orders";
  row.messagingSystem = "jms";
  row.destinationName = "orders";
  row.discoverySource = "traces";
  row.isArchived = false;
  Object.assign(row, overrides);
  return row;
}

function identityOf(value: {
  system: string;
  brokerScope?: string;
  destination: string;
}): MessageQueueIdentity {
  const identity: MessageQueueIdentity | null = toMessageQueueIdentity(value);

  if (!identity) {
    throw new Error(`not an identity: ${JSON.stringify(value)}`);
  }

  return identity;
}

/** Let the fire-and-forget rule chains drain before asserting on them. */
function flushPromises(): Promise<void> {
  return new Promise((resolve: () => void) => {
    setTimeout(resolve, 0);
  });
}

interface LoggerSpies {
  error: jest.SpyInstance;
  warn: jest.SpyInstance;
  info: jest.SpyInstance;
  debug: jest.SpyInstance;
}

function silenceLogs(): LoggerSpies {
  return {
    error: jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined as never;
    }),
    warn: jest.spyOn(logger, "warn").mockImplementation(() => {
      return undefined as never;
    }),
    info: jest.spyOn(logger, "info").mockImplementation(() => {
      return undefined as never;
    }),
    debug: jest.spyOn(logger, "debug").mockImplementation(() => {
      return undefined as never;
    }),
  };
}

interface RuleEngineSpies {
  labelRules: jest.SpyInstance;
  ownerRules: jest.SpyInstance;
}

function mockRuleEngines(): RuleEngineSpies {
  return {
    labelRules: getJestSpyOn(
      MessageQueueLabelRuleEngineService,
      "applyRulesToMessageQueue",
    ).mockResolvedValue(undefined),
    ownerRules: getJestSpyOn(
      MessageQueueOwnerRuleEngineService,
      "applyRulesToMessageQueue",
    ).mockResolvedValue(undefined),
  };
}

/*
 * Raw SQL issued through getRepository().manager.query, answered by what
 * each statement is: the budget count, the system refinement, the restore.
 * An Error answer is thrown.
 */
interface RawQueryAnswers {
  count?: unknown;
  refined?: unknown;
  restored?: unknown;
  other?: unknown;
}

function mockRawQueries(answers: RawQueryAnswers = {}): jest.Mock {
  const answer: (value: unknown, fallback: unknown) => unknown = (
    value: unknown,
    fallback: unknown,
  ): unknown => {
    if (value instanceof Error) {
      throw value;
    }
    return value === undefined ? fallback : value;
  };

  const query: jest.Mock = jest.fn(async (sql: string) => {
    if (sql.includes(`COUNT(*)::int AS "count"`)) {
      return answer(answers.count, [{ count: 0 }]);
    }
    if (sql.includes(`WITH "refined"`)) {
      return answer(answers.refined, []);
    }
    if (sql.includes(`WITH "restored"`)) {
      return answer(answers.restored, []);
    }
    return answer(answers.other, []);
  });

  getJestSpyOn(service, "getRepository").mockReturnValue({
    manager: { query },
  } as never);

  return query;
}

function callsMatching(query: jest.Mock, fragment: string): Array<any> {
  return query.mock.calls.filter((call: Array<any>): boolean => {
    return String(call[0]).includes(fragment);
  });
}

function withEnv(name: string, value: string | undefined): () => void {
  const previous: string | undefined = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
  return () => {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
  };
}

afterEach(() => {
  jest.restoreAllMocks();
  MessageQueueService.clearAutoCreateBudgetMemo();
});

/*
 * ---------------------------------------------------------------------------
 * The identity of a queue a person types
 * ---------------------------------------------------------------------------
 * Every system's normalization and refusal is pinned where the resolution
 * lives, in the pure module the create form shares
 * (Tests/Types/MessageQueue/MessageQueueManualIdentity.test.ts). Here: that
 * the service hands its callers that same function, and applies it in
 * onBeforeCreate (the manual create suite below).
 */
describe("resolveManualMessageQueue", () => {
  test("is the shared module's, re-exported", () => {
    expect(resolveManualMessageQueue).toBe(sharedResolveManualMessageQueue);
  });
});

describe("getMessagingSystemRuleMatchValues", () => {
  test.each([
    ["kafka", ["kafka", "Apache Kafka"]],
    ["aws_sqs", ["aws_sqs", "Amazon SQS"]],
    ["activemq", ["activemq", "Apache ActiveMQ"]],
    ["jms", ["jms", "JMS"]],
    // An alias is matched as the system it names.
    ["AmazonSQS", ["aws_sqs", "Amazon SQS"]],
    // A long-tail system has no display name of its own.
    ["ibmmq", ["ibmmq"]],
    ["", []],
  ])("%p is matched as %p", (system: string, values: Array<string>) => {
    expect(getMessagingSystemRuleMatchValues(system)).toEqual(values);
  });

  test("anything that is not a string matches nothing", () => {
    expect(getMessagingSystemRuleMatchValues(undefined)).toEqual([]);
    expect(getMessagingSystemRuleMatchValues(null)).toEqual([]);
    expect(getMessagingSystemRuleMatchValues(7)).toEqual([]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * A person adding a queue - the real create pipeline
 * ---------------------------------------------------------------------------
 */
describe("MessageQueueService - manual create (real create pipeline)", () => {
  let save: jest.Mock;
  let findSameIdentity: jest.SpyInstance;
  let ruleEngines: RuleEngineSpies;

  function manualRequest(overrides: Partial<MessageQueue> = {}): {
    data: MessageQueue;
    props: DatabaseCommonInteractionProps;
  } {
    const data: MessageQueue = new MessageQueue();
    data.messagingSystem = "AmazonSQS";
    data.destinationName =
      "https://sqs.eu-west-1.amazonaws.com/123456789012/Orders";
    Object.assign(data, overrides);
    return { data: data, props: memberProps() };
  }

  beforeEach(() => {
    silenceLogs();
    save = jest.fn(async (entity: any) => {
      entity._id = ObjectID.generate().toString();
      return entity;
    });
    getJestSpyOn(service, "getRepository").mockReturnValue({ save } as never);
    getJestSpyOn(service, "countBy").mockResolvedValue(
      new PositiveNumber(0) as never,
    );
    getJestSpyOn(service, "onTriggerWorkflow").mockResolvedValue(
      undefined as never,
    );
    getJestSpyOn(service, "onTriggerRealtime").mockResolvedValue(
      undefined as never,
    );
    findSameIdentity = getJestSpyOn(service, "findOneBy").mockResolvedValue(
      null,
    );
    ruleEngines = mockRuleEngines();
  });

  test("computes identity from the normalized system and destination, and stamps 'manual'", async () => {
    const created: MessageQueue = await MessageQueueService.create(
      manualRequest({
        // A caller cannot pretend discovery found it...
        discoverySource: "broker-metrics",
        // ...or choose its identity.
        queueIdentifier: "kafka||somewhere-else",
      }),
    );

    expect(save).toHaveBeenCalledTimes(1);
    expect(created.messagingSystem).toBe("aws_sqs");
    expect(created.destinationName).toBe("Orders");
    expect(created.queueIdentifier).toBe("aws_sqs||orders");
    expect(created.discoverySource).toBe("manual");
    expect(created.name).toBe("Orders");
    expect(created.brokerScope).toBeUndefined();
    expect(created.projectId!.toString()).toBe(PROJECT_ID.toString());
    expect(created.createdByUserId!.toString()).toBe(USER_ID.toString());
    expect(created.slug).toBeTruthy();
  });

  test("looks for the same identity in this project, as root, before inserting", async () => {
    await MessageQueueService.create(manualRequest());

    expect(findSameIdentity).toHaveBeenCalledTimes(1);
    const lookup: any = findSameIdentity.mock.calls[0]![0];
    expect(lookup.query.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(lookup.query.queueIdentifier).toBe("aws_sqs||orders");
    expect(lookup.props).toEqual({ isRoot: true });
  });

  test("an ActiveMQ queue keeps its broker and keys on the JMS family", async () => {
    const created: MessageQueue = await MessageQueueService.create(
      manualRequest({
        messagingSystem: "activemq",
        destinationName: "queue://orders",
      }),
    );

    expect(created.messagingSystem).toBe("activemq");
    expect(created.destinationName).toBe("orders");
    expect(created.queueIdentifier).toBe("jms||orders");
  });

  /*
   * The rabbitmq receiver keys a queue's metrics on its exact name, and
   * Hutch (`namespace:consumer`) and EasyNetQ (`Type, Assembly_sub`) put
   * the separators of a span's joined RabbitMQ names in real queue names.
   */
  test.each([
    ["myapp:billing:invoice_consumer"],
    ["MyApp.Messages.OrderCreated, MyApp.Messages_billing"],
  ])(
    "a RabbitMQ queue %p is stored and looked up under its whole name",
    async (queue: string) => {
      const created: MessageQueue = await MessageQueueService.create(
        manualRequest({ messagingSystem: "rabbitmq", destinationName: queue }),
      );

      const identifier: string = `rabbitmq||${queue.toLowerCase()}`;
      expect(created.messagingSystem).toBe("rabbitmq");
      expect(created.destinationName).toBe(queue);
      expect(created.name).toBe(queue);
      expect(created.queueIdentifier).toBe(identifier);
      expect(findSameIdentity.mock.calls[0]![0].query.queueIdentifier).toBe(
        identifier,
      );
    },
  );

  /*
   * Split like a span's joined name, a Hutch queue was cut to its last
   * part, and an EasyNetQ queue to its message type - so every subscription
   * to one type was refused as the first one's queue.
   */
  test.each([
    ["app:payments:dlq", "dlq"],
    [
      "MyApp.Messages.OrderCreated, MyApp.Messages_shipping",
      "MyApp.Messages.OrderCreated",
    ],
  ])(
    "RabbitMQ queue %p is not refused as the queue %p",
    async (queue: string, cutName: string) => {
      // A row keyed by the identifier the name was once cut down to.
      const cutIdentifier: string = `rabbitmq||${cutName.toLowerCase()}`;
      findSameIdentity.mockImplementation(async (input: any) => {
        return input.query?.queueIdentifier === cutIdentifier
          ? queueRow({ name: cutName, queueIdentifier: cutIdentifier })
          : null;
      });

      const created: MessageQueue = await MessageQueueService.create(
        manualRequest({ messagingSystem: "rabbitmq", destinationName: queue }),
      );

      expect(created.queueIdentifier).toBe(`rabbitmq||${queue.toLowerCase()}`);
      expect(save).toHaveBeenCalledTimes(1);
    },
  );

  test("a Service Bus queue carries its namespace in its identity and its column", async () => {
    const created: MessageQueue = await MessageQueueService.create(
      manualRequest({
        messagingSystem: "servicebus",
        destinationName: "Orders",
        brokerScope: "Orders-Prod.servicebus.windows.net",
      }),
    );

    expect(created.brokerScope).toBe("orders-prod");
    expect(created.queueIdentifier).toBe("servicebus|orders-prod|orders");
    expect(created.name).toBe("Orders");
  });

  test("a namespace sent for a system without one is dropped, not stored", async () => {
    const created: MessageQueue = await MessageQueueService.create(
      manualRequest({
        messagingSystem: "kafka",
        destinationName: "orders",
        brokerScope: "orders-prod",
      }),
    );

    expect(created.queueIdentifier).toBe("kafka||orders");
    expect(created.brokerScope).toBeUndefined();
    expect(save.mock.calls[0]![0].brokerScope).toBeUndefined();
  });

  test("keeps a name the person chose, trimmed", async () => {
    const created: MessageQueue = await MessageQueueService.create(
      manualRequest({ name: "  Checkout orders  " }),
    );

    expect(created.name).toBe("Checkout orders");
    expect(created.destinationName).toBe("Orders");
  });

  test("a long destination gets a clamped default name", async () => {
    const destination: string = `orders-${"x".repeat(150)}`;
    const created: MessageQueue = await MessageQueueService.create(
      manualRequest({ messagingSystem: "kafka", destinationName: destination }),
    );

    expect(created.name).toBe(buildMessageQueueDisplayName({ destination }));
    expect(created.name!.length).toBe(100);
    expect(created.name!.endsWith("…")).toBe(true);
    expect(created.destinationName).toBe(destination);
  });

  test("runs the label then owner rules on the created queue", async () => {
    const created: MessageQueue =
      await MessageQueueService.create(manualRequest());
    await flushPromises();

    expect(ruleEngines.labelRules).toHaveBeenCalledWith(created);
    expect(ruleEngines.ownerRules).toHaveBeenCalledWith(created);
    expect(ruleEngines.labelRules.mock.invocationCallOrder[0]!).toBeLessThan(
      ruleEngines.ownerRules.mock.invocationCallOrder[0]!,
    );
  });

  test("a failing rule engine never fails the create", async () => {
    ruleEngines.labelRules.mockRejectedValue(new Error("rules exploded"));

    await expect(
      MessageQueueService.create(manualRequest()),
    ).resolves.toBeDefined();
    await flushPromises();
    expect(ruleEngines.ownerRules).not.toHaveBeenCalled();
  });

  test("the same identity twice is refused before the unique index can, naming the queue", async () => {
    findSameIdentity.mockImplementation(async (input: any) => {
      if (input.props?.isRoot) {
        return queueRow({ name: "Orders queue" });
      }
      // The caller may read it.
      return queueRow({ name: "Orders queue" });
    });

    await expect(MessageQueueService.create(manualRequest())).rejects.toThrow(
      'The Amazon SQS queue "Orders" already exists: "Orders queue".',
    );
    expect(save).not.toHaveBeenCalled();
  });

  test("a duplicate in a namespace says which namespace", async () => {
    findSameIdentity.mockResolvedValue(queueRow({ name: "Orders" }));

    await expect(
      MessageQueueService.create(
        manualRequest({
          messagingSystem: "servicebus",
          destinationName: "orders",
          brokerScope: "orders-prod",
        }),
      ),
    ).rejects.toThrow(
      'The Azure Service Bus queue "orders" in the "orders-prod" namespace already exists',
    );
  });

  test("a duplicate the caller cannot read is not named", async () => {
    findSameIdentity.mockImplementation(async (input: any) => {
      if (input.props?.isRoot) {
        return queueRow({ name: "Secret queue" });
      }
      throw new NotAuthorizedException("no access");
    });

    let caught: unknown = null;

    try {
      await MessageQueueService.create(manualRequest());
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BadDataException);
    expect((caught as Error).message).toBe(
      'The Amazon SQS queue "Orders" already exists.',
    );
    expect((caught as Error).message).not.toContain("Secret");
  });

  test.each([
    [{ messagingSystem: "" }, "Messaging system is required"],
    [{ messagingSystem: "no such thing" }, "is not a messaging system"],
    [{ destinationName: "" }, "Destination is required"],
    [
      { messagingSystem: "rabbitmq", destinationName: "amq.gen-abc" },
      "cannot be a queue",
    ],
    [
      { messagingSystem: "rabbitmq", destinationName: "amq.default" },
      "is RabbitMQ's default exchange, not a queue",
    ],
    [
      {
        messagingSystem: "servicebus",
        destinationName: "orders",
        brokerScope: "not a namespace",
      },
      "is not an Azure namespace name",
    ],
  ] as Array<[Partial<MessageQueue>, string]>)(
    "%p is refused before anything is looked up: %s",
    async (overrides: Partial<MessageQueue>, message: string) => {
      await expect(
        MessageQueueService.create(manualRequest(overrides)),
      ).rejects.toThrow(message);

      expect(findSameIdentity).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
    },
  );

  test("a caller who may not add queues learns nothing: refused before any lookup", async () => {
    await expect(
      MessageQueueService.create({
        data: manualRequest().data,
        props: memberProps([Permission.ReadMessageQueue]),
      }),
    ).rejects.toThrow();

    expect(findSameIdentity).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  test("the granular create permission alone is enough", async () => {
    await expect(
      MessageQueueService.create({
        data: manualRequest().data,
        props: memberProps([Permission.CreateMessageQueue]),
      }),
    ).resolves.toBeDefined();
  });

  test.each([
    ["lastSeenAt", new Date()],
    ["brokerMetricsLastSeenAt", new Date()],
    ["brokerAddress", "broker:9092"],
    ["autoArchivedAt", new Date()],
    ["automaticAssignments", { labelIds: [] }],
  ])(
    "a manual create carrying the root-only %s is refused",
    async (column: string, value: unknown) => {
      const request: {
        data: MessageQueue;
        props: DatabaseCommonInteractionProps;
      } = manualRequest();
      (request.data as unknown as Record<string, unknown>)[column] = value;

      await expect(MessageQueueService.create(request)).rejects.toThrow(
        `User is not allowed to create on ${column} column of Queue`,
      );
      expect(save).not.toHaveBeenCalled();
    },
  );

  test("a root create passes through untouched - discovery computes its own identity", async () => {
    const data: MessageQueue = new MessageQueue();
    data.projectId = PROJECT_ID;
    data.name = "orders";
    data.queueIdentifier = "kafka||orders";
    data.messagingSystem = "kafka";
    data.destinationName = "orders";
    data.discoverySource = "traces";

    const created: MessageQueue = await MessageQueueService.create({
      data: data,
      props: { isRoot: true },
    });

    expect(findSameIdentity).not.toHaveBeenCalled();
    expect(created.discoverySource).toBe("traces");
    expect(created.queueIdentifier).toBe("kafka||orders");
  });
});

/*
 * ---------------------------------------------------------------------------
 * Discovery: find or create by identity
 * ---------------------------------------------------------------------------
 */
describe("MessageQueueService.findOrCreateByIdentity", () => {
  let findOneBy: jest.SpyInstance;
  let create: jest.SpyInstance;
  let query: jest.Mock;
  let ruleEngines: RuleEngineSpies;
  let logs: LoggerSpies;

  const JMS_ORDERS: MessageQueueIdentity = identityOf({
    system: "jms",
    destination: "orders",
  });

  function sighting(overrides: Record<string, unknown> = {}): any {
    return {
      projectId: PROJECT_ID,
      identity: JMS_ORDERS,
      system: "activemq",
      destination: "Orders",
      brokerAddress: "broker-1.internal:61616",
      source: "broker-metrics",
      allowCreate: true,
      ...overrides,
    };
  }

  beforeEach(() => {
    logs = silenceLogs();
    findOneBy = getJestSpyOn(service, "findOneBy").mockResolvedValue(null);
    create = getJestSpyOn(service, "create").mockImplementation(
      async (input: any) => {
        input.data._id = ObjectID.generate().toString();
        return input.data;
      },
    );
    query = mockRawQueries({ count: [{ count: 0 }] });
    ruleEngines = mockRuleEngines();
  });

  test("looks the queue up by project and identifier first, as root", async () => {
    const existing: MessageQueue = queueRow({ messagingSystem: "activemq" });
    findOneBy.mockResolvedValue(existing);

    const result: MessageQueueFindOrCreateResult =
      await MessageQueueService.findOrCreateByIdentity(sighting());

    expect(result).toEqual({ queue: existing, created: false });
    expect(findOneBy).toHaveBeenCalledTimes(1);
    const lookup: any = findOneBy.mock.calls[0]![0];
    expect(lookup.query).toEqual({
      projectId: PROJECT_ID,
      queueIdentifier: "jms||orders",
    });
    expect(lookup.props).toEqual({ isRoot: true });
    // Everything discovery reads back.
    expect(lookup.select).toMatchObject({
      _id: true,
      projectId: true,
      name: true,
      queueIdentifier: true,
      messagingSystem: true,
      destinationName: true,
      brokerScope: true,
      isArchived: true,
      autoArchivedAt: true,
    });
    expect(create).not.toHaveBeenCalled();
    await flushPromises();
    expect(ruleEngines.labelRules).not.toHaveBeenCalled();
  });

  test("the identity is canonicalized again - any spelling finds the same row", async () => {
    findOneBy.mockResolvedValue(queueRow());

    await MessageQueueService.findOrCreateByIdentity(
      sighting({
        identity: {
          system: "ActiveMQ",
          brokerScope: "",
          destination: " ORDERS ",
        },
      }),
    );

    expect(findOneBy.mock.calls[0]![0].query.queueIdentifier).toBe(
      "jms||orders",
    );
  });

  test("an invalid identity answers nothing without a lookup", async () => {
    for (const identity of [
      { system: "", brokerScope: "", destination: "orders" },
      { system: "kafka", brokerScope: "", destination: "" },
      { system: "not a system", brokerScope: "", destination: "orders" },
      { system: "kafka", brokerScope: "", destination: "x".repeat(600) },
    ]) {
      await expect(
        MessageQueueService.findOrCreateByIdentity(sighting({ identity })),
      ).resolves.toEqual({ queue: null, created: false });
    }

    await expect(
      MessageQueueService.findOrCreateByIdentity(undefined as any),
    ).resolves.toEqual({ queue: null, created: false });
    expect(findOneBy).not.toHaveBeenCalled();
  });

  describe("an existing row is told about the sighting", () => {
    test("a JMS row seen by ActiveMQ metrics is refined to activemq - one compare-and-set", async () => {
      const existing: MessageQueue = queueRow({ messagingSystem: "jms" });
      findOneBy.mockResolvedValue(existing);
      query = mockRawQueries({ refined: [{ _id: existing.id!.toString() }] });

      await MessageQueueService.findOrCreateByIdentity(sighting());

      const refines: Array<any> = callsMatching(query, `WITH "refined"`);
      expect(refines).toHaveLength(1);
      const [sql, params] = refines[0]! as [string, Array<unknown>];
      expect(sql).toContain(`SET "messagingSystem" = $1`);
      expect(sql).toContain(`"messagingSystem" IS NOT DISTINCT FROM $4`);
      expect(sql).toContain(`"projectId" = $3`);
      expect(sql).toContain(`"deletedAt" IS NULL`);
      expect(params).toEqual([
        "activemq",
        existing.id!.toString(),
        PROJECT_ID.toString(),
        "jms",
      ]);
      expect(existing.messagingSystem).toBe("activemq");
    });

    test("a refinement another writer beat keeps the row as read", async () => {
      const existing: MessageQueue = queueRow({ messagingSystem: "jms" });
      findOneBy.mockResolvedValue(existing);
      mockRawQueries({ refined: [] });

      await MessageQueueService.findOrCreateByIdentity(sighting());

      expect(existing.messagingSystem).toBe("jms");
    });

    test("never back: an ActiveMQ row seen through JMS spans stays ActiveMQ", async () => {
      findOneBy.mockResolvedValue(queueRow({ messagingSystem: "activemq" }));

      await MessageQueueService.findOrCreateByIdentity(
        sighting({ system: "jms", source: "traces" }),
      );

      expect(callsMatching(query, `WITH "refined"`)).toHaveLength(0);
    });

    test("never across families: a sighting's foreign system writes nothing", async () => {
      const existing: MessageQueue = queueRow({ messagingSystem: "jms" });
      findOneBy.mockResolvedValue(existing);

      await MessageQueueService.findOrCreateByIdentity(
        sighting({ system: "kafka" }),
      );

      expect(callsMatching(query, `WITH "refined"`)).toHaveLength(0);
      expect(existing.messagingSystem).toBe("jms");
    });

    test("the same system writes nothing", async () => {
      findOneBy.mockResolvedValue(queueRow({ messagingSystem: "jms" }));

      await MessageQueueService.findOrCreateByIdentity(
        sighting({ system: "JMS" }),
      );

      expect(callsMatching(query, `WITH "refined"`)).toHaveLength(0);
    });

    test("a failing refinement is logged, never thrown", async () => {
      const existing: MessageQueue = queueRow({ messagingSystem: "jms" });
      findOneBy.mockResolvedValue(existing);
      mockRawQueries({ refined: new Error("deadlock detected") });

      await expect(
        MessageQueueService.findOrCreateByIdentity(sighting()),
      ).resolves.toEqual({ queue: existing, created: false });
      expect(logs.warn).toHaveBeenCalledWith(
        expect.stringContaining("deadlock detected"),
        expect.anything(),
      );
      expect(existing.messagingSystem).toBe("jms");
    });

    test("a row discovery auto-archived is restored when seen again", async () => {
      const archived: MessageQueue = queueRow({
        messagingSystem: "activemq",
        isArchived: true,
        autoArchivedAt: new Date(),
      });
      findOneBy.mockResolvedValue(archived);
      query = mockRawQueries({ restored: [{ _id: archived.id!.toString() }] });

      await MessageQueueService.findOrCreateByIdentity(sighting());

      const restores: Array<any> = callsMatching(query, `WITH "restored"`);
      expect(restores).toHaveLength(1);
      const [sql, params] = restores[0]! as [string, Array<unknown>];
      // The conditions live in the statement: only discovery's own archive.
      expect(sql).toContain(`"isArchived" = true`);
      expect(sql).toContain(`"autoArchivedAt" IS NOT NULL`);
      expect(sql).toContain(`"deletedAt" IS NULL`);
      expect(sql).toContain(`"archivedByUserId" = NULL`);
      expect(params).toEqual([archived.id!.toString(), PROJECT_ID.toString()]);
      expect(archived.isArchived).toBe(false);
      expect(archived.autoArchivedAt).toBeUndefined();
    });

    test("a restore happens even when creating is not allowed - it is still a sighting", async () => {
      const archived: MessageQueue = queueRow({
        isArchived: true,
        autoArchivedAt: new Date(),
      });
      findOneBy.mockResolvedValue(archived);
      query = mockRawQueries({ restored: [{ _id: archived.id!.toString() }] });

      const result: MessageQueueFindOrCreateResult =
        await MessageQueueService.findOrCreateByIdentity(
          sighting({ allowCreate: false }),
        );

      expect(result.queue).toBe(archived);
      expect(archived.isArchived).toBe(false);
    });

    test("a row a PERSON archived is never un-archived by discovery", async () => {
      const archivedByPerson: MessageQueue = queueRow({
        messagingSystem: "activemq",
        isArchived: true,
      });
      findOneBy.mockResolvedValue(archivedByPerson);

      await MessageQueueService.findOrCreateByIdentity(sighting());

      expect(callsMatching(query, `WITH "restored"`)).toHaveLength(0);
      expect(archivedByPerson.isArchived).toBe(true);
    });

    test("a restore that lost to a person keeps the row as read", async () => {
      const archived: MessageQueue = queueRow({
        messagingSystem: "activemq",
        isArchived: true,
        autoArchivedAt: new Date(),
      });
      findOneBy.mockResolvedValue(archived);
      mockRawQueries({ restored: [] });

      await MessageQueueService.findOrCreateByIdentity(sighting());

      expect(archived.isArchived).toBe(true);
      expect(archived.autoArchivedAt).toBeDefined();
    });

    test("a failing restore never fails the lookup", async () => {
      const archived: MessageQueue = queueRow({
        messagingSystem: "activemq",
        isArchived: true,
        autoArchivedAt: new Date(),
      });
      findOneBy.mockResolvedValue(archived);
      mockRawQueries({ restored: new Error("connection terminated") });

      await expect(
        MessageQueueService.findOrCreateByIdentity(sighting()),
      ).resolves.toEqual({ queue: archived, created: false });
    });

    test("a live row costs no restore statement", async () => {
      findOneBy.mockResolvedValue(queueRow({ messagingSystem: "activemq" }));

      await MessageQueueService.findOrCreateByIdentity(sighting());

      expect(query).not.toHaveBeenCalled();
    });
  });

  test("nothing is created when creation is not allowed - not even a budget query", async () => {
    await expect(
      MessageQueueService.findOrCreateByIdentity(
        sighting({ allowCreate: false }),
      ),
    ).resolves.toEqual({ queue: null, created: false });

    expect(create).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  test("creates the row as root, without hooks, with the sighting's SPECIFIC system", async () => {
    const before: number = Date.now();
    const result: MessageQueueFindOrCreateResult =
      await MessageQueueService.findOrCreateByIdentity(sighting());

    expect(result.created).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    const call: any = create.mock.calls[0]![0];
    expect(call.props).toEqual({ isRoot: true, ignoreHooks: true });

    const row: MessageQueue = call.data;
    expect(result.queue).toBe(row);
    expect(row.projectId).toBe(PROJECT_ID);
    expect(row.queueIdentifier).toBe("jms||orders");
    expect(row.messagingSystem).toBe("activemq");
    // The display destination keeps the sighting's casing.
    expect(row.destinationName).toBe("Orders");
    expect(row.name).toBe("Orders");
    expect(row.brokerScope).toBeUndefined();
    expect(row.brokerAddress).toBe("broker-1.internal:61616");
    expect(row.discoverySource).toBe("broker-metrics");
    expect(row.lastSeenAt!.getTime()).toBeGreaterThanOrEqual(before);
    /*
     * Only the broker-metrics sighting that follows knows when the newest
     * datapoint was taken: it is that column's only writer.
     */
    expect(row.brokerMetricsLastSeenAt).toBeUndefined();
  });

  test("a trace-created row has no broker-metrics timestamp", async () => {
    await MessageQueueService.findOrCreateByIdentity(
      sighting({ source: "traces", system: "jms" }),
    );

    const row: MessageQueue = create.mock.calls[0]![0].data;
    expect(row.discoverySource).toBe("traces");
    expect(row.messagingSystem).toBe("jms");
    expect(row.lastSeenAt).toBeDefined();
    expect(row.brokerMetricsLastSeenAt).toBeUndefined();
  });

  test("an Azure namespace from the identity lands on the row", async () => {
    await MessageQueueService.findOrCreateByIdentity(
      sighting({
        identity: identityOf({
          system: "servicebus",
          brokerScope: "orders-prod",
          destination: "orders",
        }),
        system: "servicebus",
        destination: "orders",
      }),
    );

    const row: MessageQueue = create.mock.calls[0]![0].data;
    expect(row.brokerScope).toBe("orders-prod");
    expect(row.queueIdentifier).toBe("servicebus|orders-prod|orders");
  });

  test("a system outside the identity's family falls back to the family itself", async () => {
    await MessageQueueService.findOrCreateByIdentity(
      sighting({ system: "kafka" }),
    );

    expect(create.mock.calls[0]![0].data.messagingSystem).toBe("jms");
  });

  test("a destination that is not the identity's is not stored - the canonical one is", async () => {
    await MessageQueueService.findOrCreateByIdentity(
      sighting({ destination: "payments" }),
    );

    const row: MessageQueue = create.mock.calls[0]![0].data;
    expect(row.destinationName).toBe("orders");
    expect(row.name).toBe("orders");
  });

  test("a long destination gets the clamped display name", async () => {
    const destination: string = `Orders-${"x".repeat(200)}`;

    await MessageQueueService.findOrCreateByIdentity(
      sighting({
        identity: identityOf({ system: "kafka", destination }),
        system: "kafka",
        destination,
      }),
    );

    const row: MessageQueue = create.mock.calls[0]![0].data;
    expect(row.destinationName).toBe(destination);
    expect(row.name).toBe(buildMessageQueueDisplayName({ destination }));
    expect(row.name!.length).toBe(100);
  });

  test.each([[null], [""], ["   "], ["broker\u0000:9092"]])(
    "broker address %p is not stored",
    async (brokerAddress: unknown) => {
      await MessageQueueService.findOrCreateByIdentity(
        sighting({ brokerAddress }),
      );

      expect(create.mock.calls[0]![0].data.brokerAddress).toBeUndefined();
    },
  );

  test("an oversized broker address is clamped to its column", async () => {
    await MessageQueueService.findOrCreateByIdentity(
      sighting({ brokerAddress: `  ${"b".repeat(900)}  ` }),
    );

    expect(create.mock.calls[0]![0].data.brokerAddress).toBe("b".repeat(500));
  });

  test("the winner runs the label then owner rules - fire and forget", async () => {
    const result: MessageQueueFindOrCreateResult =
      await MessageQueueService.findOrCreateByIdentity(sighting());
    await flushPromises();

    expect(ruleEngines.labelRules).toHaveBeenCalledWith(result.queue);
    expect(ruleEngines.ownerRules).toHaveBeenCalledWith(result.queue);
    expect(ruleEngines.labelRules.mock.invocationCallOrder[0]!).toBeLessThan(
      ruleEngines.ownerRules.mock.invocationCallOrder[0]!,
    );
  });

  test("a failing rule run never fails the discovery that created the row", async () => {
    ruleEngines.labelRules.mockRejectedValue(new Error("rules exploded"));

    await expect(
      MessageQueueService.findOrCreateByIdentity(sighting()),
    ).resolves.toMatchObject({ created: true });
    await flushPromises();
    expect(logs.error).toHaveBeenCalledWith(
      expect.stringContaining("rules exploded"),
      expect.anything(),
    );
  });

  test("the unique-index race: the winner's row is re-read, sighted, and no rules run", async () => {
    const winner: MessageQueue = queueRow({ messagingSystem: "jms" });
    findOneBy.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
    create.mockRejectedValue(
      new BadDataException(
        'duplicate key value violates unique constraint "IDX_message_queue_identifier"',
      ),
    );
    query = mockRawQueries({
      count: [{ count: 0 }],
      refined: [{ _id: winner.id!.toString() }],
    });

    const result: MessageQueueFindOrCreateResult =
      await MessageQueueService.findOrCreateByIdentity(sighting());

    expect(result).toEqual({ queue: winner, created: false });
    expect(findOneBy).toHaveBeenCalledTimes(2);
    expect(findOneBy.mock.calls[1]![0].query).toEqual({
      projectId: PROJECT_ID,
      queueIdentifier: "jms||orders",
    });
    // The loser's sighting still refines the winner's row.
    expect(winner.messagingSystem).toBe("activemq");
    await flushPromises();
    expect(ruleEngines.labelRules).not.toHaveBeenCalled();
    expect(ruleEngines.ownerRules).not.toHaveBeenCalled();
  });

  test("a create failure that is not a race is surfaced", async () => {
    create.mockRejectedValue(new Error("connection terminated"));

    await expect(
      MessageQueueService.findOrCreateByIdentity(sighting()),
    ).rejects.toThrow("connection terminated");
    await flushPromises();
    expect(ruleEngines.labelRules).not.toHaveBeenCalled();
  });

  describe("the auto-create budget", () => {
    test("under the budget, the queue is created", async () => {
      query = mockRawQueries({ count: [{ count: 499 }] });

      await expect(
        MessageQueueService.findOrCreateByIdentity(sighting()),
      ).resolves.toMatchObject({ created: true });

      const counts: Array<any> = callsMatching(query, "COUNT(*)");
      expect(counts).toHaveLength(1);
      expect(counts[0]![1]).toEqual([PROJECT_ID.toString(), "manual"]);
    });

    test("at the budget, nothing is created, and it is warned about once per ten minutes", async () => {
      mockRawQueries({ count: [{ count: 500 }] });

      for (let attempt: number = 0; attempt < 3; attempt++) {
        await expect(
          MessageQueueService.findOrCreateByIdentity(sighting()),
        ).resolves.toEqual({ queue: null, created: false });
      }

      expect(create).not.toHaveBeenCalled();
      const warnings: Array<any> = logs.warn.mock.calls.filter(
        (call: Array<any>): boolean => {
          return String(call[0]).includes("auto-create budget");
        },
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]![0]).toContain("MESSAGE_QUEUE_AUTO_CREATE_BUDGET=500");
      expect(warnings[0]![0]).toContain("jms||orders");
    });

    test("an existing row is always found, whatever the budget says", async () => {
      mockRawQueries({ count: [{ count: 10_000 }] });
      const existing: MessageQueue = queueRow({ messagingSystem: "activemq" });
      findOneBy.mockResolvedValue(existing);

      await expect(
        MessageQueueService.findOrCreateByIdentity(sighting()),
      ).resolves.toEqual({ queue: existing, created: false });
    });

    test("a count that cannot be read creates nothing (fail closed) and says why", async () => {
      mockRawQueries({ count: new Error("too many connections") });

      await expect(
        MessageQueueService.findOrCreateByIdentity(sighting()),
      ).resolves.toEqual({ queue: null, created: false });

      expect(create).not.toHaveBeenCalled();
      expect(logs.error).toHaveBeenCalledWith(
        expect.stringContaining("too many connections"),
        expect.anything(),
      );
    });

    test("a zero budget turns auto-creation off without a query", async () => {
      const restore: () => void = withEnv(
        "MESSAGE_QUEUE_AUTO_CREATE_BUDGET",
        "0",
      );

      try {
        await expect(
          MessageQueueService.findOrCreateByIdentity(sighting()),
        ).resolves.toEqual({ queue: null, created: false });
        expect(query).not.toHaveBeenCalled();
        expect(create).not.toHaveBeenCalled();
      } finally {
        restore();
      }
    });

    test("a burst stops exactly at the budget: the cached count is bumped by every create", async () => {
      const restore: () => void = withEnv(
        "MESSAGE_QUEUE_AUTO_CREATE_BUDGET",
        "3",
      );
      query = mockRawQueries({ count: [{ count: 1 }] });

      try {
        const results: Array<MessageQueueFindOrCreateResult> = [];

        for (const destination of ["a", "b", "c", "d"]) {
          results.push(
            await MessageQueueService.findOrCreateByIdentity(
              sighting({
                identity: identityOf({ system: "kafka", destination }),
                system: "kafka",
                destination,
              }),
            ),
          );
        }

        expect(
          results.map((result: MessageQueueFindOrCreateResult): boolean => {
            return result.created;
          }),
        ).toEqual([true, true, false, false]);
        // One count read for the whole burst.
        expect(callsMatching(query, "COUNT(*)")).toHaveLength(1);
      } finally {
        restore();
      }
    });
  });
});

/*
 * ---------------------------------------------------------------------------
 * Liveness: two sightings, two namespaces
 * ---------------------------------------------------------------------------
 */
describe("MessageQueueService.recordSighting", () => {
  type WriteCall = { id: ObjectID; data: Record<string, unknown> };

  const QUEUE_ID: ObjectID = ObjectID.generate();
  let writes: Array<WriteCall>;
  let cache: Map<string, string>;

  /** A faithful in-memory Redis for the atomic gate primitives. */
  function mockCache(): void {
    getJestSpyOn(GlobalCache, "setStringIfNotExists").mockImplementation(
      async (ns: string, key: string, value: string) => {
        const full: string = `${ns}:${key}`;
        if (cache.has(full)) {
          return false;
        }
        cache.set(full, value);
        return true;
      },
    );
    getJestSpyOn(GlobalCache, "setStringIfChanged").mockImplementation(
      async (ns: string, key: string, value: string) => {
        const full: string = `${ns}:${key}`;
        if (cache.get(full) === value) {
          return false;
        }
        cache.set(full, value);
        return true;
      },
    );
    getJestSpyOn(GlobalCache, "deleteKey").mockImplementation(
      async (ns: string, key: string) => {
        cache.delete(`${ns}:${key}`);
      },
    );
  }

  function resetWindows(): void {
    SingleFlight.clear();
    ResourceHeartbeat.clearRecentHeartbeatMemo();
  }

  // A new window: the liveness keys expire, the address fingerprints do not.
  function expireLivenessWindows(): void {
    resetWindows();
    for (const key of Array.from(cache.keys())) {
      if (!key.includes("-fingerprint:")) {
        cache.delete(key);
      }
    }
  }

  function lastWrite(): Record<string, unknown> {
    return writes[writes.length - 1]!.data;
  }

  function sighting(overrides: Record<string, unknown> = {}): any {
    return {
      projectId: PROJECT_ID,
      queueId: QUEUE_ID,
      source: "traces",
      ...overrides,
    };
  }

  beforeEach(() => {
    silenceLogs();
    writes = [];
    cache = new Map<string, string>();
    resetWindows();
    mockCache();
    getJestSpyOn(
      service,
      "updateColumnsByIdIfUnlockedWithoutHooks",
    ).mockImplementation(async (input: any) => {
      writes.push({ id: input.id, data: { ...input.data } });
      return true;
    });
  });

  afterEach(() => {
    resetWindows();
  });

  test("a trace sighting moves lastSeenAt only, under the trace namespace", async () => {
    const before: number = Date.now();

    await MessageQueueService.recordSighting(sighting());

    expect(writes).toHaveLength(1);
    expect(writes[0]!.id.toString()).toBe(QUEUE_ID.toString());
    expect(Object.keys(lastWrite())).toEqual(["lastSeenAt"]);
    expect(
      (lastWrite()["lastSeenAt"] as Date).getTime(),
    ).toBeGreaterThanOrEqual(before);
    expect(
      cache.has(`message-queue-trace-sighting:${QUEUE_ID.toString()}`),
    ).toBe(true);
  });

  test("a broker-metrics sighting moves lastSeenAt and brokerMetricsLastSeenAt, under its own namespace", async () => {
    await MessageQueueService.recordSighting(
      sighting({ source: "broker-metrics" }),
    );

    expect(Object.keys(lastWrite()).sort()).toEqual([
      "brokerMetricsLastSeenAt",
      "lastSeenAt",
    ]);
    expect(lastWrite()["brokerMetricsLastSeenAt"]).toEqual(
      lastWrite()["lastSeenAt"],
    );
    expect(
      cache.has(`message-queue-broker-metrics-sighting:${QUEUE_ID.toString()}`),
    ).toBe(true);
  });

  /*
   * Separate namespaces: spans every second must not be able to suppress the
   * heartbeat that says the broker's metrics still arrive.
   */
  test("a trace sighting never suppresses a broker-metrics sighting, nor the reverse", async () => {
    await MessageQueueService.recordSighting(sighting());
    SingleFlight.clear();
    await MessageQueueService.recordSighting(
      sighting({ source: "broker-metrics" }),
    );
    SingleFlight.clear();
    await MessageQueueService.recordSighting(sighting());

    expect(writes).toHaveLength(2);
    expect(lastWrite()["brokerMetricsLastSeenAt"]).toBeDefined();
  });

  test("one sighting per source per window, however many passes report it", async () => {
    for (let pass: number = 0; pass < 5; pass++) {
      SingleFlight.clear();
      await MessageQueueService.recordSighting(sighting());
      SingleFlight.clear();
      await MessageQueueService.recordSighting(
        sighting({ source: "broker-metrics" }),
      );
    }

    expect(writes).toHaveLength(2);
  });

  test("the broker address rides along when it is non-empty, trimmed", async () => {
    await MessageQueueService.recordSighting(
      sighting({ brokerAddress: "  kafka-1.internal:9092  " }),
    );

    expect(lastWrite()).toMatchObject({
      brokerAddress: "kafka-1.internal:9092",
    });
    expect(
      cache.get(
        `message-queue-trace-sighting-fingerprint:${QUEUE_ID.toString()}`,
      ),
    ).toBe(
      crypto.createHash("sha256").update("kafka-1.internal:9092").digest("hex"),
    );
  });

  test.each([[undefined], [null], [""], ["   "], ["kafka\u0007:9092"]])(
    "broker address %p is never written",
    async (brokerAddress: unknown) => {
      await MessageQueueService.recordSighting(sighting({ brokerAddress }));

      expect(writes).toHaveLength(1);
      expect("brokerAddress" in lastWrite()).toBe(false);
    },
  );

  test("an unchanged address is not written again; a changed one is", async () => {
    await MessageQueueService.recordSighting(
      sighting({ brokerAddress: "kafka-1:9092" }),
    );

    expireLivenessWindows();
    await MessageQueueService.recordSighting(
      sighting({ brokerAddress: "kafka-1:9092" }),
    );
    expect(writes).toHaveLength(2);
    expect("brokerAddress" in lastWrite()).toBe(false);

    expireLivenessWindows();
    for (const key of Array.from(cache.keys())) {
      if (key.includes("-write-window:")) {
        cache.delete(key);
      }
    }
    await MessageQueueService.recordSighting(
      sighting({ brokerAddress: "kafka-2:9092" }),
    );
    expect(lastWrite()["brokerAddress"]).toBe("kafka-2:9092");
  });

  test("an oversized address is clamped to its column", async () => {
    await MessageQueueService.recordSighting(
      sighting({ brokerAddress: "a".repeat(2000) }),
    );

    expect((lastWrite()["brokerAddress"] as string).length).toBe(500);
  });

  test("a broker-metrics sighting stores the broker's datapoint time; lastSeenAt is when discovery saw it", async () => {
    const at: Date = new Date(Date.now() - 5 * 60 * 1000);
    const before: number = Date.now();

    await MessageQueueService.recordSighting(
      sighting({ source: "broker-metrics", at }),
    );

    expect(lastWrite()["brokerMetricsLastSeenAt"]).toEqual(at);
    const lastSeenAt: number = (lastWrite()["lastSeenAt"] as Date).getTime();
    expect(lastSeenAt).toBeGreaterThanOrEqual(before);
    expect(lastSeenAt).toBeLessThanOrEqual(Date.now());
  });

  test("a trace sighting's time never reaches a column: lastSeenAt is when discovery saw it", async () => {
    const before: number = Date.now();

    await MessageQueueService.recordSighting(
      sighting({ at: new Date(Date.now() - 14 * 60 * 1000) }),
    );

    expect(Object.keys(lastWrite())).toEqual(["lastSeenAt"]);
    expect(
      (lastWrite()["lastSeenAt"] as Date).getTime(),
    ).toBeGreaterThanOrEqual(before);
  });

  test.each([
    ["a future time", new Date(Date.now() + 24 * 3600 * 1000)],
    ["an invalid date", new Date("not a date")],
    ["something that is not a date", "2026-01-01"],
  ])(
    "%s as the broker's datapoint time is read as now",
    async (_label: string, at: unknown) => {
      const before: number = Date.now();

      await MessageQueueService.recordSighting(
        sighting({ source: "broker-metrics", at }),
      );

      for (const column of ["brokerMetricsLastSeenAt", "lastSeenAt"]) {
        const written: number = (lastWrite()[column] as Date).getTime();
        expect(written).toBeGreaterThanOrEqual(before);
        expect(written).toBeLessThanOrEqual(Date.now());
      }
    },
  );

  /*
   * Both sources write lastSeenAt, one after the other in every discovery
   * pass, through separate heartbeat namespaces - so neither suppresses the
   * other and both land. Their newest data can be far apart: Azure Monitor,
   * CloudWatch and Cloud Monitoring deliver datapoints minutes late. Were
   * lastSeenAt a datapoint's own time, whichever source wrote last would win
   * and the column would move back behind the other source's sighting.
   */
  test.each([
    ["traces, then broker metrics", ["traces", "broker-metrics"]],
    ["broker metrics, then traces", ["broker-metrics", "traces"]],
  ])(
    "lastSeenAt never moves backwards within a pass: %s",
    async (_label: string, order: Array<string>) => {
      const newestSpan: Date = new Date(Date.now() - 60 * 1000);
      const newestDatapoint: Date = new Date(Date.now() - 40 * 60 * 1000);
      const row: Record<string, unknown> = {};

      // A faithful row: every heartbeat write is a plain SET of its columns.
      getJestSpyOn(
        service,
        "updateColumnsByIdIfUnlockedWithoutHooks",
      ).mockImplementation(async (input: any) => {
        Object.assign(row, input.data);
        return true;
      });

      const before: number = Date.now();
      let previous: number = 0;

      for (const source of order) {
        await MessageQueueService.recordSighting(
          sighting({
            source,
            at: source === "traces" ? newestSpan : newestDatapoint,
          }),
        );

        const lastSeenAt: number = (row["lastSeenAt"] as Date).getTime();
        expect(lastSeenAt).toBeGreaterThanOrEqual(previous);
        expect(lastSeenAt).toBeGreaterThanOrEqual(before);
        previous = lastSeenAt;
      }

      expect(row["brokerMetricsLastSeenAt"]).toEqual(newestDatapoint);
      expect(
        (row["brokerMetricsLastSeenAt"] as Date).getTime(),
      ).toBeLessThanOrEqual((row["lastSeenAt"] as Date).getTime());
    },
  );

  test("lastSeenAt never moves backwards across passes, whatever the data times", async () => {
    const row: Record<string, unknown> = {};

    getJestSpyOn(
      service,
      "updateColumnsByIdIfUnlockedWithoutHooks",
    ).mockImplementation(async (input: any) => {
      Object.assign(row, input.data);
      return true;
    });

    /*
     * A queue whose spans stop: pass one saw a span a minute old, pass two
     * sees only late cloud-monitoring datapoints from before it.
     */
    await MessageQueueService.recordSighting(
      sighting({ at: new Date(Date.now() - 60 * 1000) }),
    );
    const afterPassOne: number = (row["lastSeenAt"] as Date).getTime();

    expireLivenessWindows();
    await MessageQueueService.recordSighting(
      sighting({
        source: "broker-metrics",
        at: new Date(Date.now() - 12 * 60 * 1000),
      }),
    );

    expect((row["lastSeenAt"] as Date).getTime()).toBeGreaterThanOrEqual(
      afterPassOne,
    );
  });

  /*
   * A pass creates a row, then records its sighting. The create cannot know
   * when the broker's newest datapoint was taken - only the sighting says -
   * so the create leaves brokerMetricsLastSeenAt to it, and the sighting's
   * lastSeenAt can never land behind the create's.
   */
  test("a row the pass just created: lastSeenAt never drops below the create's, brokerMetricsLastSeenAt comes from the sighting", async () => {
    mockRuleEngines();
    mockRawQueries({ count: [{ count: 0 }] });
    getJestSpyOn(service, "findOneBy").mockResolvedValue(null);

    const row: Record<string, unknown> = {};

    getJestSpyOn(service, "create").mockImplementation(async (input: any) => {
      input.data._id = QUEUE_ID.toString();
      row["lastSeenAt"] = input.data.lastSeenAt;
      row["brokerMetricsLastSeenAt"] = input.data.brokerMetricsLastSeenAt;
      return input.data;
    });
    getJestSpyOn(
      service,
      "updateColumnsByIdIfUnlockedWithoutHooks",
    ).mockImplementation(async (input: any) => {
      Object.assign(row, input.data);
      return true;
    });

    const result: MessageQueueFindOrCreateResult =
      await MessageQueueService.findOrCreateByIdentity({
        projectId: PROJECT_ID,
        identity: identityOf({
          system: "servicebus",
          brokerScope: "orders-prod",
          destination: "orders",
        }),
        system: "servicebus",
        destination: "orders",
        source: "broker-metrics",
        allowCreate: true,
      });

    expect(result.created).toBe(true);
    const createdLastSeenAt: number = (row["lastSeenAt"] as Date).getTime();
    expect(row["brokerMetricsLastSeenAt"]).toBeUndefined();

    // Azure Monitor delivers minutes late: the newest datapoint is older than the create.
    const datapointAt: Date = new Date(Date.now() - 7 * 60 * 1000);

    await MessageQueueService.recordSighting({
      projectId: PROJECT_ID,
      queueId: result.queue!.id!,
      source: "broker-metrics",
      at: datapointAt,
    });

    expect((row["lastSeenAt"] as Date).getTime()).toBeGreaterThanOrEqual(
      createdLastSeenAt,
    );
    expect(row["brokerMetricsLastSeenAt"]).toEqual(datapointAt);
    await flushPromises();
  });

  test("liveness survives a failing enriched write", async () => {
    getJestSpyOn(
      service,
      "updateColumnsByIdIfUnlockedWithoutHooks",
    ).mockImplementation(async (input: any) => {
      const data: Record<string, unknown> = { ...input.data };
      writes.push({ id: input.id, data: data });
      if ("brokerAddress" in data) {
        throw new Error("value too long");
      }
      return true;
    });

    await MessageQueueService.recordSighting(
      sighting({ brokerAddress: "kafka-1:9092" }),
    );

    expect(writes).toHaveLength(2);
    expect(Object.keys(lastWrite())).toEqual(["lastSeenAt"]);
  });

  test("a sighting without a queue id writes nothing", async () => {
    await MessageQueueService.recordSighting(sighting({ queueId: undefined }));
    await MessageQueueService.recordSighting(undefined as any);

    expect(writes).toHaveLength(0);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Sweeps: auto-archive, budget
 * ---------------------------------------------------------------------------
 */
describe("MessageQueueService.autoArchiveStaleMessageQueues", () => {
  beforeEach(() => {
    silenceLogs();
  });

  test("archives in ONE statement that checks every 'untouched' condition itself", async () => {
    const query: jest.Mock = mockRawQueries({ other: [] });
    const restore: () => void = withEnv(
      "MESSAGE_QUEUE_AUTO_ARCHIVE_DAYS",
      undefined,
    );

    try {
      const before: number = Date.now();
      await MessageQueueService.autoArchiveStaleMessageQueues();

      expect(query).toHaveBeenCalledTimes(1);
      const [sql, params] = query.mock.calls[0] as [string, Array<unknown>];

      // Discovered, live, not yet archived, unseen since the cutoff.
      expect(sql).toContain(`mq."deletedAt" IS NULL`);
      expect(sql).toContain(`mq."isArchived" = false`);
      expect(sql).toContain(`mq."discoverySource" IS NOT NULL`);
      expect(sql).toContain(`mq."discoverySource" <> $3`);
      expect(params[2]).toBe("manual");
      expect(sql).toContain(`COALESCE(mq."lastSeenAt", mq."createdAt") < $1`);
      const cutoff: Date = params[0] as Date;
      const sevenDays: number = 7 * 24 * 3600 * 1000;
      expect(before - cutoff.getTime()).toBeGreaterThanOrEqual(
        sevenDays - 1000,
      );
      expect(before - cutoff.getTime()).toBeLessThanOrEqual(sevenDays + 5000);

      // Nobody described or renamed it.
      expect(sql).toContain(
        `(mq."description" IS NULL OR btrim(mq."description") = '')`,
      );
      expect(sql).toContain(`mq."name" = mq."destinationName"`);
      expect(sql).toContain(`char_length(mq."destinationName") > 100`);
      expect(sql).toContain(
        `mq."name" = rtrim(left(mq."destinationName", 99)) || '…'`,
      );

      // Nobody invested in it: every join is scoped to the row's project and live rows.
      for (const table of [
        "MessageQueueLabel",
        "MessageQueueOwnerUser",
        "MessageQueueOwnerTeam",
      ]) {
        expect(sql).toMatch(
          new RegExp(`NOT EXISTS \\(\\s*SELECT 1 FROM "${table}"`),
        );
      }
      expect((sql.match(/"projectId" = mq\."projectId"/g) || []).length).toBe(
        3,
      );
      // The row and its three investment joins.
      expect((sql.match(/"deletedAt" IS NULL/g) || []).length).toBe(4);

      /*
       * Only a PERSON's labels and owners count: the ones rules attached
       * (automaticAssignments) are excluded inside each join.
       */
      expect(sql).toContain(
        `NOT (COALESCE(mq."automaticAssignments" -> 'labelIds', '[]'::jsonb) @> jsonb_build_array(l."labelId"::text))`,
      );
      expect(sql).toContain(
        `NOT (COALESCE(mq."automaticAssignments" -> 'ownerUserIds', '[]'::jsonb) @> jsonb_build_array(ou."userId"::text))`,
      );
      expect(sql).toContain(
        `NOT (COALESCE(mq."automaticAssignments" -> 'ownerTeamIds', '[]'::jsonb) @> jsonb_build_array(ot."teamId"::text))`,
      );

      /*
       * A person's Restore holds until the row is seen again or the grace
       * period (30 days, or the archive window if longer) passes.
       */
      expect(sql).toContain(`mq."manuallyRestoredAt" IS NULL`);
      expect(sql).toContain(`mq."manuallyRestoredAt" < $5`);
      expect(sql).toContain(
        `COALESCE(mq."lastSeenAt", mq."createdAt") > mq."manuallyRestoredAt"`,
      );
      const graceCutoff: Date = params[4] as Date;
      const thirtyDays: number = 30 * 24 * 3600 * 1000;
      expect(before - graceCutoff.getTime()).toBeGreaterThanOrEqual(
        thirtyDays - 1000,
      );
      expect(before - graceCutoff.getTime()).toBeLessThanOrEqual(
        thirtyDays + 5000,
      );

      // Marked as discovery's own archive, oldest first, bounded, never re-archiving.
      expect(sql).toContain(`"autoArchivedAt" = $2`);
      expect(sql).toContain(`"archivedAt" = $2`);
      expect(sql).toContain(`"archivedByUserId" = NULL`);
      expect(sql).toContain(`"isArchived" = true`);
      expect(sql).toContain(`stale."isArchived" = false`);
      expect(sql).toContain(
        `ORDER BY COALESCE(mq."lastSeenAt", mq."createdAt") ASC`,
      );
      expect(sql).toContain("LIMIT $4");
      expect(params[3]).toBe(500);
      expect(params).toHaveLength(5);
    } finally {
      restore();
    }
  });

  test("returns how many rows were archived", async () => {
    mockRawQueries({
      other: [
        {
          _id: ObjectID.generate().toString(),
          projectId: PROJECT_ID.toString(),
        },
        {
          _id: ObjectID.generate().toString(),
          projectId: PROJECT_ID.toString(),
        },
      ],
    });

    await expect(
      MessageQueueService.autoArchiveStaleMessageQueues(),
    ).resolves.toBe(2);
  });

  test("an unexpected driver answer is 0", async () => {
    mockRawQueries({ other: { rowCount: 3 } });

    await expect(
      MessageQueueService.autoArchiveStaleMessageQueues(),
    ).resolves.toBe(0);
  });

  test("the window follows MESSAGE_QUEUE_AUTO_ARCHIVE_DAYS, and a long window stretches the restore hold", async () => {
    const query: jest.Mock = mockRawQueries({ other: [] });
    const restore: () => void = withEnv(
      "MESSAGE_QUEUE_AUTO_ARCHIVE_DAYS",
      "45",
    );

    try {
      const before: number = Date.now();
      await MessageQueueService.autoArchiveStaleMessageQueues();

      const params: Array<unknown> = query.mock.calls[0]![1] as Array<unknown>;
      const day: number = 24 * 3600 * 1000;
      expect(before - (params[0] as Date).getTime()).toBeGreaterThanOrEqual(
        45 * day - 1000,
      );
      expect(before - (params[4] as Date).getTime()).toBeGreaterThanOrEqual(
        45 * day - 1000,
      );
    } finally {
      restore();
    }
  });

  test("a failing statement is thrown to the cron, which logs it", async () => {
    mockRawQueries({ other: new Error("statement timeout") });

    await expect(
      MessageQueueService.autoArchiveStaleMessageQueues(),
    ).rejects.toThrow("statement timeout");
  });
});

describe("MessageQueueService.getAutoArchiveDays", () => {
  test.each([
    [undefined, 7],
    ["", 7],
    ["14", 14],
    [" 3 ", 3],
    ["1", 1],
    ["0", 1],
    ["-5", 1],
    ["2.5", 7],
    ["nope", 7],
  ])("%p -> %p days", (value: string | undefined, expected: number) => {
    const restore: () => void = withEnv(
      "MESSAGE_QUEUE_AUTO_ARCHIVE_DAYS",
      value,
    );
    try {
      expect(MessageQueueService.getAutoArchiveDays()).toBe(expected);
    } finally {
      restore();
    }
  });
});

describe("MessageQueueService auto-create budget", () => {
  test.each([
    [undefined, 500],
    ["50", 50],
    ["0", 0],
    ["-1", 0],
    ["x", 500],
  ])("budget %p -> %p", (value: string | undefined, expected: number) => {
    const restore: () => void = withEnv(
      "MESSAGE_QUEUE_AUTO_CREATE_BUDGET",
      value,
    );
    try {
      expect(MessageQueueService.getAutoCreateBudget()).toBe(expected);
    } finally {
      restore();
    }
  });

  test("counts live, non-archived DISCOVERED rows of this project only", async () => {
    const query: jest.Mock = mockRawQueries({ count: [{ count: 499 }] });

    await expect(
      MessageQueueService.isUnderAutoCreateBudget(PROJECT_ID),
    ).resolves.toBe(true);

    const [sql, params] = query.mock.calls[0] as [string, Array<unknown>];
    expect(sql).toContain(`FROM "MessageQueue"`);
    expect(sql).toContain(`"projectId" = $1`);
    expect(sql).toContain(`"deletedAt" IS NULL`);
    expect(sql).toContain(`"isArchived" = false`);
    // A person's rows never count against discovery's budget.
    expect(sql).toContain(`COALESCE("discoverySource", '') <> $2`);
    expect(params).toEqual([PROJECT_ID.toString(), "manual"]);
  });

  test("at the budget, discovery stops creating (a string count too)", async () => {
    mockRawQueries({ count: [{ count: "500" }] });

    await expect(
      MessageQueueService.isUnderAutoCreateBudget(PROJECT_ID),
    ).resolves.toBe(false);
  });

  test("an empty answer counts as none", async () => {
    mockRawQueries({ count: [] });

    await expect(
      MessageQueueService.countAutoCreatedMessageQueues(PROJECT_ID),
    ).resolves.toBe(0);
  });

  test("a zero budget turns auto-creation off without a query", async () => {
    const query: jest.Mock = mockRawQueries({ count: [{ count: 0 }] });
    const restore: () => void = withEnv(
      "MESSAGE_QUEUE_AUTO_CREATE_BUDGET",
      "0",
    );

    try {
      await expect(
        MessageQueueService.isUnderAutoCreateBudget(PROJECT_ID),
      ).resolves.toBe(false);
      await expect(
        MessageQueueService.isUnderAutoCreateBudgetCached(PROJECT_ID),
      ).resolves.toBe(false);
      expect(query).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  test("the cached check reads the count once a minute per project", async () => {
    const query: jest.Mock = mockRawQueries({ count: [{ count: 10 }] });
    const other: ObjectID = ObjectID.generate();

    for (let i: number = 0; i < 3; i++) {
      await MessageQueueService.isUnderAutoCreateBudgetCached(PROJECT_ID);
    }
    await MessageQueueService.isUnderAutoCreateBudgetCached(other);

    expect(query).toHaveBeenCalledTimes(2);

    MessageQueueService.clearAutoCreateBudgetMemo();
    await MessageQueueService.isUnderAutoCreateBudgetCached(PROJECT_ID);
    expect(query).toHaveBeenCalledTimes(3);
  });
});

/*
 * ---------------------------------------------------------------------------
 * A person's edits
 * ---------------------------------------------------------------------------
 */
describe("MessageQueueService.onUpdateSuccess", () => {
  let clearWrites: jest.SpyInstance;
  let forget: jest.SpyInstance;

  function onUpdate(data: Record<string, unknown>): any {
    return {
      updateBy: {
        query: {},
        data: data,
        props: { userId: USER_ID },
      },
      carryForward: null,
    };
  }

  beforeEach(() => {
    silenceLogs();
    clearWrites = getJestSpyOn(
      service,
      "updateColumnsByIdWithoutHooks",
    ).mockResolvedValue(undefined);
    forget = getJestSpyOn(
      service,
      "forgetAutomaticAssignments",
    ).mockResolvedValue(undefined);
  });

  /*
   * A person archiving (or restoring) a row takes it out of discovery's
   * hands: from then on only a person restores it.
   */
  test.each([[true], [false]])(
    "a person setting isArchived=%s clears autoArchivedAt on every row",
    async (isArchived: boolean) => {
      const ids: Array<ObjectID> = [ObjectID.generate(), ObjectID.generate()];
      const before: number = Date.now();

      await service.onUpdateSuccess(onUpdate({ isArchived }), ids);

      expect(clearWrites).toHaveBeenCalledTimes(2);
      for (const [index, id] of ids.entries()) {
        const write: any = clearWrites.mock.calls[index]![0];
        expect(write.id).toBe(id);
        expect(write.skipUpdateDateColumn).toBe(true);
        expect(write.data.autoArchivedAt).toBeNull();
        /*
         * A Restore is stamped so the sweep leaves the row alone; an archive
         * clears the stamp.
         */
        if (isArchived) {
          expect(write.data.manuallyRestoredAt).toBeNull();
        } else {
          expect(
            (write.data.manuallyRestoredAt as Date).getTime(),
          ).toBeGreaterThanOrEqual(before);
        }
      }
    },
  );

  test("an archive write that carries autoArchivedAt is not a person's", async () => {
    await service.onUpdateSuccess(
      onUpdate({ isArchived: true, autoArchivedAt: new Date() }),
      [ObjectID.generate()],
    );

    expect(clearWrites).not.toHaveBeenCalled();
  });

  test("an edit that is not an archive change leaves the archive columns alone", async () => {
    await service.onUpdateSuccess(onUpdate({ name: "Orders" }), [
      ObjectID.generate(),
    ]);

    expect(clearWrites).not.toHaveBeenCalled();
    expect(forget).not.toHaveBeenCalled();
  });

  test("labels a person saves become theirs on every updated row", async () => {
    const a: ObjectID = ObjectID.generate();
    const b: ObjectID = ObjectID.generate();
    const label: ObjectID = ObjectID.generate();

    await service.onUpdateSuccess(
      onUpdate({ labels: [{ _id: label.toString() }, label, "not-an-id"] }),
      [a, b],
    );

    expect(forget).toHaveBeenCalledTimes(2);
    expect(forget.mock.calls[0]![0]).toEqual({
      messageQueueId: a,
      kind: "labelIds",
      ids: [label.toString(), label.toString(), "not-an-id"],
    });
    expect(forget.mock.calls[1]![0].messageQueueId).toBe(b);
  });

  test("a failing clear is logged, not thrown", async () => {
    clearWrites.mockRejectedValue(new Error("connection terminated"));

    await expect(
      service.onUpdateSuccess(onUpdate({ isArchived: true }), [
        ObjectID.generate(),
      ]),
    ).resolves.toBeDefined();
  });
});

describe("MessageQueueService automatic assignments", () => {
  let logs: LoggerSpies;

  beforeEach(() => {
    logs = silenceLogs();
  });

  test("records rule-made labels in one atomic statement, ids normalized and deduped", async () => {
    const query: jest.Mock = mockRawQueries({ other: [] });
    const queueId: ObjectID = ObjectID.generate();
    const label: string = "AAAAAAAA-1111-4111-8111-111111111111";

    await MessageQueueService.recordAutomaticAssignments({
      messageQueueId: queueId,
      kind: "labelIds",
      ids: [label, label.toLowerCase(), "not-a-uuid"],
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, Array<unknown>];
    expect(sql).toContain(`UPDATE "MessageQueue"`);
    expect(sql).toContain(`jsonb_agg(DISTINCT assigned.id)`);
    expect(sql).toContain(`WHERE "_id" = $1`);
    expect(params).toEqual([
      queueId.toString(),
      "labelIds",
      JSON.stringify([label.toLowerCase()]),
    ]);
  });

  test("forgets what a person re-added, only where a list exists", async () => {
    const query: jest.Mock = mockRawQueries({ other: [] });
    const queueId: ObjectID = ObjectID.generate();
    const team: ObjectID = ObjectID.generate();

    await MessageQueueService.forgetAutomaticAssignments({
      messageQueueId: queueId,
      kind: "ownerTeamIds",
      ids: [team],
    });

    const [sql, params] = query.mock.calls[0] as [string, Array<unknown>];
    expect(sql).toContain(`NOT (assigned.id = ANY($3::text[]))`);
    expect(sql).toContain(
      `jsonb_typeof("automaticAssignments" -> $2::text) = 'array'`,
    );
    expect(params).toEqual([
      queueId.toString(),
      "ownerTeamIds",
      [team.toString()],
    ]);
  });

  test("nothing valid to record, or an unknown kind, is a no-op", async () => {
    const query: jest.Mock = mockRawQueries({ other: [] });

    await MessageQueueService.recordAutomaticAssignments({
      messageQueueId: ObjectID.generate(),
      kind: "labelIds",
      ids: ["nope"],
    });
    await MessageQueueService.forgetAutomaticAssignments({
      messageQueueId: ObjectID.generate(),
      kind: "somethingElse" as any,
      ids: [ObjectID.generate()],
    });

    expect(query).not.toHaveBeenCalled();
  });

  test("a failing write is logged, never thrown - it only annotates a write that happened", async () => {
    mockRawQueries({ other: new Error("deadlock detected") });

    await expect(
      MessageQueueService.recordAutomaticAssignments({
        messageQueueId: ObjectID.generate(),
        kind: "ownerUserIds",
        ids: [ObjectID.generate()],
      }),
    ).resolves.toBeUndefined();
    await expect(
      MessageQueueService.forgetAutomaticAssignments({
        messageQueueId: ObjectID.generate(),
        kind: "ownerUserIds",
        ids: [ObjectID.generate()],
      }),
    ).resolves.toBeUndefined();
    expect(logs.warn).toHaveBeenCalledTimes(2);
  });
});

describe("MessageQueueService names and links", () => {
  test("links to /queues/<id> and names the queue in markdown", async () => {
    const id: ObjectID = ObjectID.generate();
    getJestSpyOn(service, "findOneById").mockResolvedValue(
      queueRow({ name: "orders.created" }),
    );
    getJestSpyOn(DatabaseConfig, "getDashboardUrl").mockResolvedValue(
      URL.fromString("https://oneuptime.example.com/dashboard"),
    );

    const markdown: string =
      await MessageQueueService.getMessageQueueMarkdownLink(PROJECT_ID, id);

    expect(markdown).toBe(
      `[Queue orders.created](https://oneuptime.example.com/dashboard/${PROJECT_ID.toString()}/queues/${id.toString()})`,
    );
  });

  test("a missing row names as an empty string instead of throwing", async () => {
    getJestSpyOn(service, "findOneById").mockResolvedValue(null);

    await expect(
      MessageQueueService.getMessageQueueName({
        messageQueueId: ObjectID.generate(),
      }),
    ).resolves.toBe("");
  });

  test("a name is read with the caller's own permissions, and '' when refused", async () => {
    const findOneBy: jest.SpyInstance = getJestSpyOn(
      service,
      "findOneBy",
    ).mockRejectedValue(new NotAuthorizedException("no"));
    const props: DatabaseCommonInteractionProps = memberProps();

    await expect(
      MessageQueueService.getMessageQueueNameIfReadable({
        messageQueueId: ObjectID.generate(),
        props,
      }),
    ).resolves.toBe("");
    expect(findOneBy.mock.calls[0]![0].props).toBe(props);
  });
});
