import { describe, expect, test } from "@jest/globals";
import {
  MESSAGE_QUEUE_CHIP_KEY,
  MessageQueueScopeSource,
  buildMessageQueueEntityKeyDisplays,
  getMessageQueueChipValue,
  getMessageQueueEntityKeysQueryValue,
  getMessageQueueScopeIdentity,
  getMessageQueueScopeKeys,
  isMessageQueueScoped,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueTelemetryScope";
import { LockedEntityKeyDisplayMap } from "../../../../App/FeatureSet/Dashboard/src/Utils/LockedEntityKeyChips";
import Includes from "../../../Types/BaseDatabase/Includes";
import {
  MessageQueueIdentity,
  buildMessageQueueIdentifier,
  toMessageQueueIdentity,
} from "../../../Types/MessageQueue/MessageQueueIdentity";
import {
  ResolvedMessagingDestination,
  resolveMessagingMetricDatapoint,
  resolveMessagingSpan,
} from "../../../Types/MessageQueue/MessagingTelemetryResolver";
import ObjectID from "../../../Types/ObjectID";
import { keyForMessageQueue } from "../../../Utils/Telemetry/EntityKey";
import {
  FixtureAttributes,
  METRIC_FIXTURES,
  MetricFixture,
  PRODUCER,
  SPAN_FIXTURES,
  SpanFixture,
} from "../../Types/MessageQueue/MessagingTelemetryFixtures";

/*
 * How a Queue page scopes telemetry. Ingest stamps ONE key on every span and
 * datapoint that resolves to a queue — keyForMessageQueue of the queue's
 * canonical, family-keyed identity — and the pages read the queue's
 * telemetry by that key alone. What these pin:
 *
 *   - the page's key is built from the row's queueIdentifier, and is the
 *     key of the core identity rules (resolver → toMessageQueueIdentity →
 *     keyForMessageQueue) for every span and broker datapoint of the shared
 *     fixture corpus that resolves to that queue. That the REAL ingest
 *     stamper (MessagingEntityKeyResolver, with its gates) appends exactly
 *     this key, on the row discovery's own row resolution creates, is pinned
 *     where both run: App/Tests/Dashboard/MessageQueueScopeKeyParity.test.ts;
 *   - an ActiveMQ row (messagingSystem "activemq", identifier "jms||…") is
 *     keyed on the JMS family, never on its specific system — a key built
 *     from the system column would find nothing;
 *   - no project, no identifier or one that does not parse is NO key, and
 *     no key is never an empty Includes (that would read the whole project);
 *   - the viewers' locked chip names the queue, not a hash.
 */

const PROJECT_ID: string = "5f2b7c1e-8d3a-4b6f-9c0d-1e2f3a4b5c6d";

function getter(attributes: FixtureAttributes): (key: string) => unknown {
  return (key: string): unknown => {
    return Object.prototype.hasOwnProperty.call(attributes, key)
      ? attributes[key]
      : undefined;
  };
}

/*
 * The key of the core identity rules: the resolver's destination,
 * canonicalized, hashed. (The ingest stamper's own output is compared in
 * App/Tests/Dashboard/MessageQueueScopeKeyParity.test.ts.)
 */
function ingestKey(resolved: ResolvedMessagingDestination | null): {
  key: string;
  identifier: string;
} | null {
  if (!resolved) {
    return null;
  }
  const identity: MessageQueueIdentity | null = toMessageQueueIdentity({
    system: resolved.system,
    brokerScope: resolved.brokerScope,
    destination: resolved.destination,
  });
  const identifier: string | null = identity
    ? buildMessageQueueIdentifier(identity)
    : null;
  if (!identity || !identifier) {
    return null;
  }
  return {
    key: keyForMessageQueue(PROJECT_ID, identity),
    identifier: identifier,
  };
}

function rowFor(identifier: string): MessageQueueScopeSource {
  return { projectId: new ObjectID(PROJECT_ID), queueIdentifier: identifier };
}

const RESOLVABLE_SPANS: Array<[string, SpanFixture]> = SPAN_FIXTURES.filter(
  (fixture: SpanFixture): boolean => {
    return (
      ingestKey(
        resolveMessagingSpan({
          getAttribute: getter(fixture.attributes),
          kind: fixture.kind,
        }),
      ) !== null
    );
  },
).map((fixture: SpanFixture): [string, SpanFixture] => {
  return [fixture.name, fixture];
});

const RESOLVABLE_DATAPOINTS: Array<[string, MetricFixture]> =
  METRIC_FIXTURES.filter((fixture: MetricFixture): boolean => {
    return (
      ingestKey(
        resolveMessagingMetricDatapoint({
          metricName: fixture.metricName,
          getAttribute: getter(fixture.attributes),
        }),
      ) !== null
    );
  }).map((fixture: MetricFixture): [string, MetricFixture] => {
    return [fixture.name, fixture];
  });

describe("a queue page's entity key is the one ingest stamps", () => {
  test("the corpus has spans and datapoints of queues to check against", () => {
    expect(RESOLVABLE_SPANS.length).toBeGreaterThan(40);
    expect(RESOLVABLE_DATAPOINTS.length).toBeGreaterThan(40);
  });

  test.each(RESOLVABLE_SPANS)(
    "span %s: the row created from its identifier reads it",
    (_name: string, fixture: SpanFixture) => {
      const stamped: { key: string; identifier: string } | null = ingestKey(
        resolveMessagingSpan({
          getAttribute: getter(fixture.attributes),
          kind: fixture.kind,
        }),
      );
      expect(getMessageQueueScopeKeys(rowFor(stamped!.identifier))).toEqual([
        stamped!.key,
      ]);
    },
  );

  test.each(RESOLVABLE_DATAPOINTS)(
    "datapoint %s: the row created from its identifier reads it",
    (_name: string, fixture: MetricFixture) => {
      const stamped: { key: string; identifier: string } | null = ingestKey(
        resolveMessagingMetricDatapoint({
          metricName: fixture.metricName,
          getAttribute: getter(fixture.attributes),
        }),
      );
      expect(getMessageQueueScopeKeys(rowFor(stamped!.identifier))).toEqual([
        stamped!.key,
      ]);
    },
  );

  test("a Kafka topic: its producer span and its consumer-group lag share the page's key", () => {
    const span: { key: string; identifier: string } | null = ingestKey(
      resolveMessagingSpan({
        getAttribute: getter({
          "messaging.system": "kafka",
          "messaging.destination.name": "orders",
          "messaging.operation.type": "send",
        }),
        kind: PRODUCER,
      }),
    );
    const lag: { key: string; identifier: string } | null = ingestKey(
      resolveMessagingMetricDatapoint({
        metricName: "kafka.consumer_group.lag_sum",
        getAttribute: getter({ topic: "orders", group: "billing" }),
      }),
    );

    expect(span!.identifier).toBe("kafka||orders");
    expect(lag!.key).toBe(span!.key);
    expect(getMessageQueueScopeKeys(rowFor("kafka||orders"))).toEqual([
      span!.key,
    ]);
  });

  test("an ActiveMQ queue is keyed on the JMS family: its JMS spans and its broker's metrics, one key", () => {
    const jmsSpan: { key: string; identifier: string } | null = ingestKey(
      resolveMessagingSpan({
        getAttribute: getter({
          "messaging.system": "jms",
          "messaging.destination.name": "orders",
        }),
        kind: PRODUCER,
      }),
    );
    const scraper: { key: string; identifier: string } | null = ingestKey(
      resolveMessagingMetricDatapoint({
        metricName: "activemq.message.queue.size",
        getAttribute: getter({
          "messaging.destination.name": "orders",
          "activemq.destination.type": "queue",
          "activemq.broker.name": "localhost",
        }),
      }),
    );

    expect(jmsSpan!.identifier).toBe("jms||orders");
    expect(scraper!.identifier).toBe("jms||orders");

    // The row keeps the specific system; the key never uses it.
    const row: MessageQueueScopeSource = {
      ...rowFor("jms||orders"),
      messagingSystem: "activemq",
    };
    expect(getMessageQueueScopeKeys(row)).toEqual([jmsSpan!.key]);
    expect(getMessageQueueScopeKeys(row)).toEqual([scraper!.key]);
    expect(getMessageQueueScopeKeys(row)).not.toEqual([
      keyForMessageQueue(PROJECT_ID, {
        system: "activemq",
        brokerScope: "",
        destination: "orders",
      }),
    ]);
  });

  test("a Service Bus queue's key carries its namespace: two namespaces, two queues", () => {
    const prod: Array<string> = getMessageQueueScopeKeys(
      rowFor("servicebus|orders-prod|orders"),
    );
    const staging: Array<string> = getMessageQueueScopeKeys(
      rowFor("servicebus|orders-staging|orders"),
    );

    expect(prod).toEqual([
      keyForMessageQueue(PROJECT_ID, {
        system: "servicebus",
        brokerScope: "orders-prod",
        destination: "orders",
      }),
    ]);
    expect(staging).toHaveLength(1);
    expect(staging[0]).not.toBe(prod[0]);
  });

  test("the identifier is read canonically: casing and spacing do not change the key", () => {
    expect(getMessageQueueScopeKeys(rowFor("  Kafka||Orders "))).toEqual(
      getMessageQueueScopeKeys(rowFor("kafka||orders")),
    );
    expect(getMessageQueueScopeIdentity(rowFor("RabbitMQ||Orders"))).toEqual({
      system: "rabbitmq",
      brokerScope: "",
      destination: "orders",
    });
  });

  test("a destination may itself contain '|': only the first two split", () => {
    expect(getMessageQueueScopeIdentity(rowFor("kafka||a|b|c"))).toEqual({
      system: "kafka",
      brokerScope: "",
      destination: "a|b|c",
    });
  });

  test("the project id may be a string or an ObjectID", () => {
    expect(
      getMessageQueueScopeKeys({
        projectId: PROJECT_ID,
        queueIdentifier: "kafka||orders",
      }),
    ).toEqual(getMessageQueueScopeKeys(rowFor("kafka||orders")));
  });
});

describe("no scope is no key, never the whole project", () => {
  test.each([
    ["no source", null],
    ["no project", { projectId: null, queueIdentifier: "kafka||orders" }],
    ["a blank project", { projectId: "  ", queueIdentifier: "kafka||orders" }],
    ["no identifier", { projectId: PROJECT_ID, queueIdentifier: null }],
    [
      "an identifier without its separators",
      { projectId: PROJECT_ID, queueIdentifier: "orders" },
    ],
    [
      "an identifier with an empty destination",
      { projectId: PROJECT_ID, queueIdentifier: "kafka||" },
    ],
    [
      "an identifier with no system",
      { projectId: PROJECT_ID, queueIdentifier: "||orders" },
    ],
    [
      "a namespace that cannot be one",
      { projectId: PROJECT_ID, queueIdentifier: "servicebus|my namespace|q" },
    ],
  ])("%s", (_name: string, source: MessageQueueScopeSource | null) => {
    const keys: Array<string> = getMessageQueueScopeKeys(source);

    expect(keys).toEqual([]);
    expect(isMessageQueueScoped(keys)).toBe(false);
    expect(getMessageQueueEntityKeysQueryValue(keys)).toBeNull();
    expect(buildMessageQueueEntityKeyDisplays(source)).toEqual({});
  });

  test("the query value is an Includes of exactly the keys", () => {
    const keys: Array<string> = getMessageQueueScopeKeys(
      rowFor("kafka||orders"),
    );
    const value: Includes | null = getMessageQueueEntityKeysQueryValue(keys);

    expect(value).toBeInstanceOf(Includes);
    expect(value!.values).toEqual(keys);
    // A copy: the caller's array is never the query's.
    expect(value!.values).not.toBe(keys);
  });

  test("scoped means a non-empty array, nothing else", () => {
    expect(isMessageQueueScoped(["0123456789abcdef"])).toBe(true);
    expect(isMessageQueueScoped([])).toBe(false);
    expect(isMessageQueueScoped(null)).toBe(false);
    expect(isMessageQueueScoped(undefined)).toBe(false);
    expect(
      isMessageQueueScoped("0123456789abcdef" as unknown as Array<string>),
    ).toBe(false);
    expect(getMessageQueueEntityKeysQueryValue(null)).toBeNull();
  });
});

describe("the viewers' locked chip names the queue", () => {
  test("its name and its system's display name, keyed by the queue key", () => {
    const source: MessageQueueScopeSource = {
      ...rowFor("kafka||orders"),
      name: "Orders topic",
      messagingSystem: "kafka",
    };
    const displays: LockedEntityKeyDisplayMap =
      buildMessageQueueEntityKeyDisplays(source);
    const [key] = getMessageQueueScopeKeys(source);

    expect(Object.keys(displays)).toEqual([key]);
    expect(displays[key!]).toEqual({
      displayKey: MESSAGE_QUEUE_CHIP_KEY,
      displayValue: "Orders topic (Apache Kafka)",
    });
    // No search syntax: no single attribute search reproduces the key.
    expect(displays[key!]!.searchAttributes).toBeUndefined();
  });

  test("without a name, the destination; the specific system, not the family", () => {
    expect(
      getMessageQueueChipValue({
        ...rowFor("jms||orders"),
        messagingSystem: "activemq",
      }),
    ).toBe("orders (Apache ActiveMQ)");
    expect(getMessageQueueChipValue(rowFor("jms||orders"))).toBe(
      "orders (JMS)",
    );
    expect(
      getMessageQueueChipValue({ ...rowFor("kafka||orders"), name: "   " }),
    ).toBe("orders (Apache Kafka)");
  });

  test("a system OneUptime does not know reads as it came", () => {
    expect(
      getMessageQueueChipValue({
        ...rowFor("ibmmq||dev.queue.1"),
        messagingSystem: "ibmmq",
      }),
    ).toBe("dev.queue.1 (ibmmq)");
  });
});
