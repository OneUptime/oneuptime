import MessagingEntityKeyResolver, {
  MESSAGING_ENTITY_KEY_MAX_MEMO_ENTRIES,
  MESSAGING_ENTITY_KEY_MAX_MEMO_KEY_LENGTH,
  getMessagingMetricMemoAttributes,
} from "../../FeatureSet/Telemetry/Services/MessagingEntityKeys";
import * as MessagingTelemetryResolverModule from "Common/Types/MessageQueue/MessagingTelemetryResolver";
import {
  MESSAGE_QUEUE_METRIC_EXCLUDED_SERIES_ATTRIBUTES,
  MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES,
  MESSAGING_RESOLVER_INPUT_ATTRIBUTES,
  MESSAGING_TEMPORARY_FLAG_ATTRIBUTES,
  MESSAGING_TRIGGER_ATTRIBUTES,
  ResolvedMessagingDestination,
} from "Common/Types/MessageQueue/MessagingTelemetryResolver";
import {
  MESSAGE_QUEUE_BROKER_METRIC_NAMES,
  MESSAGE_QUEUE_METRICS,
  MESSAGING_CLIENT_METRIC_NAMES,
  MESSAGING_SDK_METRIC_SYSTEMS,
  MessageQueueMetricDescriptor,
  getMessageQueueMetricId,
} from "Common/Types/MessageQueue/MessageQueueMetricCatalog";
import {
  MESSAGING_SYSTEMS,
  MessagingSystemDescriptor,
} from "Common/Types/MessageQueue/MessagingSystem";
import {
  MessageQueueIdentity,
  buildMessageQueueIdentifier,
  toMessageQueueIdentity,
} from "Common/Types/MessageQueue/MessageQueueIdentity";
import * as EntityKeyModule from "Common/Utils/Telemetry/EntityKey";
import { keyForMessageQueue } from "Common/Utils/Telemetry/EntityKey";
import { SpanKind } from "Common/Models/AnalyticsModels/Span";
import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import logger from "Common/Server/Utils/Logger";
import {
  FixtureAttributes,
  METRIC_FIXTURES,
  MetricFixture,
  SPAN_FIXTURES,
  SpanFixture,
} from "Common/Tests/Types/MessageQueue/MessagingTelemetryFixtures";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * The per-ROW queue keys: every messaging span that is not a SERVER span,
 * and every curated broker / messaging client datapoint (or datapoint
 * carrying `messaging.system`), gets its queue's key appended to its OWN
 * entityKeys — so the Queues product finds a queue's spans and broker
 * metrics with the same `hasAny(entityKeys, keys)` predicate as everything
 * else. This suite pins the resolver class on its own (the ingest wiring
 * is pinned in MessagingEntityKeysIngest.test.ts, the hot-path cost in
 * MessagingEntityKeysBenchmark.test.ts):
 *
 *   - the gates: which rows are worth resolving, decided without
 *     allocating, and never a SERVER span or a resource-level attribute;
 *   - the key is exactly the core resolver's identity for every fixture of
 *     the core corpus (real instrumentations and live broker captures) and
 *     for a realistic stored row of EVERY curated broker metric — so ingest
 *     and the discovery cron can never disagree;
 *   - a NEW array, never a duplicate, never a sibling row's key;
 *   - the per-request memo is keyed on exactly what the resolver reads: one
 *     resolution per distinct queue, and never a stale answer (a property
 *     test perturbs every input of every fixture);
 *   - huge values cannot grow the memo or produce a key no row can carry;
 *   - nothing here ever throws into ingest.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();

// Resource-level keys the resolver stamped (service, host, …).
const RESOURCE_KEYS: Array<string> = ["0123456789abcdef", "fedcba9876543210"];

type Attributes = Record<string, unknown>;

afterEach(() => {
  jest.restoreAllMocks();
});

function queueKey(
  system: string,
  destination: string,
  brokerScope: string = "",
): string {
  const identity: MessageQueueIdentity | null = toMessageQueueIdentity({
    system: system,
    brokerScope: brokerScope,
    destination: destination,
  });
  if (!identity) {
    throw new Error(
      `Not a queue identity: ${system}|${brokerScope}|${destination}`,
    );
  }
  return keyForMessageQueue(PROJECT_ID.toString(), identity);
}

/*
 * The key a resolution must stamp, by the identity rules alone: its
 * canonical identity, when that identity can be a queue row.
 */
function expectedKeyOf(
  resolved: ResolvedMessagingDestination | null,
): string | null {
  if (!resolved) {
    return null;
  }
  const identity: MessageQueueIdentity | null =
    toMessageQueueIdentity(resolved);
  if (!identity || buildMessageQueueIdentifier(identity) === null) {
    return null;
  }
  return keyForMessageQueue(PROJECT_ID.toString(), identity);
}

function spanRow(
  kind: string | null,
  attributes: Attributes,
  entityKeys: Array<string> = [...RESOURCE_KEYS],
): JSONObject {
  return {
    kind: kind,
    entityKeys: entityKeys,
    attributes: attributes,
  } as JSONObject;
}

function metricRow(
  name: string,
  attributes: Attributes,
  entityKeys: Array<string> = [...RESOURCE_KEYS],
): JSONObject {
  return {
    name: name,
    entityKeys: entityKeys,
    attributes: attributes,
  } as JSONObject;
}

function newResolver(): MessagingEntityKeyResolver {
  return new MessagingEntityKeyResolver(PROJECT_ID);
}

function memoSize(resolver: MessagingEntityKeyResolver): number {
  return resolver["memo"].size;
}

const KAFKA_ORDERS_PUBLISH: Attributes = {
  "messaging.system": "kafka",
  "messaging.destination.name": "orders",
  "messaging.operation.type": "send",
};

const SERVICE_BUS_HOST: string = "orders-prod.servicebus.windows.net";

/*
 * ---- The gates -------------------------------------------------------------
 */

/*
 * The value a trigger key arrives with on a messaging span. The Azure SDKs
 * put the resource provider keys on the spans of EVERY client, so only a
 * messaging provider's value is sure to stay a trigger if the core ever
 * weighs their value (see the non-messaging Azure spans below).
 */
const MESSAGING_TRIGGER_VALUES: Record<string, string> = {
  "az.namespace": "Microsoft.ServiceBus",
  "azure.resource_provider.namespace": "Microsoft.EventHub",
};

/*
 * Non-messaging spans of the Azure SDKs. The Java SDK also writes the newer
 * `azure.resource_provider.namespace` next to `az.namespace`.
 */
const AZURE_SDK_NON_MESSAGING_SPANS: Array<[string, string, Attributes]> = [
  [
    "a Storage blob upload (HTTP CLIENT)",
    SpanKind.Client,
    {
      "az.namespace": "Microsoft.Storage",
      "http.request.method": "PUT",
      "url.full": "https://acct.blob.core.windows.net/container/blob-42",
      "server.address": "acct.blob.core.windows.net",
      "server.port": 443,
      "http.response.status_code": 201,
      "az.client_request_id": "c3f1b0de-0000-4000-8000-000000000042",
      "az.service_request_id": "9a1c-000042",
    },
  ],
  [
    "a Cosmos DB read (CLIENT)",
    SpanKind.Client,
    {
      "az.namespace": "Microsoft.DocumentDB",
      "db.system": "cosmosdb",
      "db.operation.name": "ReadItem",
      "db.namespace": "orders",
      "db.collection.name": "items",
      "server.address": "acct.documents.azure.com",
      "server.port": 443,
    },
  ],
  [
    "a Key Vault secret read (INTERNAL)",
    SpanKind.Internal,
    {
      "az.namespace": "Microsoft.KeyVault",
      "azure.resource_provider.namespace": "Microsoft.KeyVault",
      "code.function.name": "SecretClient.GetSecret",
    },
  ],
];

describe("gates: which rows are worth resolving", () => {
  test.each<[string]>(
    MESSAGING_TRIGGER_ATTRIBUTES.map((key: string): [string] => {
      return [key];
    }),
  )(
    "isMessagingSpan: %s alone makes a non-SERVER span a candidate",
    (key: string) => {
      const attributes: Attributes = {
        [key]: MESSAGING_TRIGGER_VALUES[key] ?? "x",
      };
      for (const kind of [
        SpanKind.Producer,
        SpanKind.Consumer,
        SpanKind.Client,
        SpanKind.Internal,
        null,
      ]) {
        expect(
          MessagingEntityKeyResolver.isMessagingSpan(attributes, kind),
        ).toBe(true);
      }
      expect(
        MessagingEntityKeyResolver.isMessagingSpan(attributes, SpanKind.Server),
      ).toBe(false);
    },
  );

  /*
   * The core's trigger list counts the Azure resource provider keys
   * whatever their value, so these spans may pass the gate today. The gate
   * is the core's, shared with the discovery cron, and this module adds no
   * filter of its own. So whichever way the core decides, such a span must
   * never get a key or touch the shared array, and it must be resolved at
   * most once per request.
   */
  test("Azure SDK spans of non-messaging clients (Storage, Cosmos DB, Key Vault): never keyed, each resolved at most once per request", () => {
    const resolveSpy: jest.SpyInstance = jest.spyOn(
      MessagingTelemetryResolverModule,
      "resolveMessagingSpan",
    );
    const resolver: MessagingEntityKeyResolver = newResolver();
    const shared: Array<string> = [...RESOURCE_KEYS];
    let admitted: number = 0;

    for (const [label, kind, attributes] of AZURE_SDK_NON_MESSAGING_SPANS) {
      if (MessagingEntityKeyResolver.isMessagingSpan(attributes, kind)) {
        admitted++;
      }
      for (let i: number = 0; i < 25; i++) {
        // The client request id changes on every call; the inputs do not.
        const row: JSONObject = spanRow(
          kind,
          {
            ...attributes,
            "az.client_request_id": `c3f1b0de-0000-4000-8000-${String(i).padStart(12, "0")}`,
          },
          shared,
        );
        expect({ label: label, added: resolver.appendToSpanRow(row) }).toEqual({
          label: label,
          added: false,
        });
        expect(row["entityKeys"]).toBe(shared);
      }
    }

    expect(shared).toEqual(RESOURCE_KEYS);
    expect(resolveSpy).toHaveBeenCalledTimes(admitted);
    expect(memoSize(resolver)).toBe(admitted);
  });

  test.each<[string, unknown, unknown, boolean]>([
    ["a PRODUCER span", KAFKA_ORDERS_PUBLISH, SpanKind.Producer, true],
    ["a CONSUMER span", KAFKA_ORDERS_PUBLISH, SpanKind.Consumer, true],
    [
      "a CLIENT span of an SQS call (no messaging.system)",
      {
        "aws.queue_url":
          "https://sqs.us-east-1.amazonaws.com/123456789012/orders",
      },
      SpanKind.Client,
      true,
    ],
    ["an INTERNAL span", KAFKA_ORDERS_PUBLISH, SpanKind.Internal, true],
    ["a span without a kind", KAFKA_ORDERS_PUBLISH, undefined, true],
    [
      "a SERVER span (a messaging operation is never served)",
      KAFKA_ORDERS_PUBLISH,
      SpanKind.Server,
      false,
    ],
    [
      "a blank messaging.system",
      { "messaging.system": "   " },
      SpanKind.Producer,
      false,
    ],
    [
      "an empty destination",
      { "messaging.destination.name": "" },
      SpanKind.Producer,
      false,
    ],
    ["a null system", { "messaging.system": null }, SpanKind.Producer, false],
    [
      "a RESOURCE-level messaging.system (stored resource.-prefixed)",
      { "resource.messaging.system": "kafka" },
      SpanKind.Producer,
      false,
    ],
    [
      "a scope attribute",
      { "scope.messaging.system": "kafka" },
      SpanKind.Producer,
      false,
    ],
    [
      "an HTTP CLIENT span",
      {
        "http.request.method": "GET",
        "server.address": "inventory.example.com",
      },
      SpanKind.Client,
      false,
    ],
    [
      "an inherited key (own keys only)",
      Object.create({ "messaging.system": "kafka" }),
      SpanKind.Producer,
      false,
    ],
    ["no attributes", undefined, SpanKind.Producer, false],
    ["a non-object", "messaging.system", SpanKind.Producer, false],
  ])(
    "isMessagingSpan: %s",
    (_label: string, attributes: unknown, kind: unknown, expected: boolean) => {
      expect(MessagingEntityKeyResolver.isMessagingSpan(attributes, kind)).toBe(
        expected,
      );
    },
  );

  test("every curated broker and messaging client metric name passes the name gate, in any casing a pipeline rule writes", () => {
    const names: Array<string> = [
      ...Array.from(MESSAGE_QUEUE_BROKER_METRIC_NAMES),
      ...Array.from(MESSAGING_CLIENT_METRIC_NAMES),
    ];
    expect(names.length).toBeGreaterThan(60);
    for (const name of names) {
      for (const spelling of [
        name,
        name.toUpperCase(),
        `  ${name}\t`,
        // Padded with spaces alone: nothing else marks it as unstored.
        ` ${name}  `,
        name.charAt(0).toUpperCase() + name.substring(1),
      ]) {
        expect({
          spelling: spelling,
          gate: MessagingEntityKeyResolver.isMessagingMetricName(spelling),
        }).toEqual({ spelling: spelling, gate: true });
      }
    }
  });

  test.each<[unknown]>([
    ["system.cpu.utilization"],
    ["http.client.request.duration"],
    ["db.client.operation.duration"],
    ["queue.size"],
    ["messaging.client"],
    ["kafka.consumer_group"],
    ["azure_activemessages"],
    ["amazonaws.com/aws/sqs/"],
    ["constructor"],
    ["__proto__"],
    ["toString"],
    [""],
    ["   "],
    [undefined],
    [null],
    [42],
    [{}],
    [["kafka.consumer_group.lag_sum"]],
  ])("isMessagingMetricName(%p) is false", (name: unknown) => {
    expect(MessagingEntityKeyResolver.isMessagingMetricName(name)).toBe(false);
  });

  test("the Azure SDK's messaging.servicebus.* metrics pass on their name alone — they carry no messaging.system", () => {
    expect(MESSAGING_SDK_METRIC_SYSTEMS.size).toBeGreaterThan(0);
    for (const name of Array.from(MESSAGING_SDK_METRIC_SYSTEMS.keys())) {
      const attributes: Attributes = {
        "server.address": SERVICE_BUS_HOST,
        "messaging.destination.name": "orders",
      };
      expect(
        MessagingEntityKeyResolver.carriesMessagingSystem(attributes),
      ).toBe(false);
      expect(
        MessagingEntityKeyResolver.isMessagingMetric(name, attributes),
      ).toBe(true);
    }
  });

  test.each<[string, unknown, boolean]>([
    ["a datapoint messaging.system", { "messaging.system": "bullmq" }, true],
    ["a numeric system", { "messaging.system": 7 }, true],
    [
      "a RESOURCE-level messaging.system",
      { "resource.messaging.system": "bullmq" },
      false,
    ],
    ["an empty system", { "messaging.system": "" }, false],
    ["a null system", { "messaging.system": null }, false],
    ["no system", { "messaging.destination.name": "orders" }, false],
    ["no attributes", undefined, false],
    ["a non-object", "messaging.system", false],
  ])(
    "carriesMessagingSystem: %s",
    (_label: string, attributes: unknown, expected: boolean) => {
      expect(
        MessagingEntityKeyResolver.carriesMessagingSystem(attributes),
      ).toBe(expected);
    },
  );

  test("isMessagingMetric: the name sets OR a datapoint messaging.system", () => {
    expect(
      MessagingEntityKeyResolver.isMessagingMetric("queue.size", {
        "messaging.system": "bullmq",
        "messaging.destination.name": "Workers",
      }),
    ).toBe(true);
    expect(
      MessagingEntityKeyResolver.isMessagingMetric("queue.size", {
        "messaging.destination.name": "Workers",
      }),
    ).toBe(false);
    expect(
      MessagingEntityKeyResolver.isMessagingMetric(
        "kafka.consumer_group.lag_sum",
        { topic: "orders" },
      ),
    ).toBe(true);
    expect(
      MessagingEntityKeyResolver.isMessagingMetric("system.cpu.time", {
        state: "user",
      }),
    ).toBe(false);
  });

  test("rows that fail the gates cost no resolver, identity or key work", () => {
    const spanSpy: jest.SpyInstance = jest.spyOn(
      MessagingTelemetryResolverModule,
      "resolveMessagingSpan",
    );
    const metricSpy: jest.SpyInstance = jest.spyOn(
      MessagingTelemetryResolverModule,
      "resolveMessagingMetricDatapoint",
    );
    const keySpy: jest.SpyInstance = jest.spyOn(
      EntityKeyModule,
      "keyForMessageQueue",
    );
    const resolver: MessagingEntityKeyResolver = newResolver();

    expect(
      resolver.appendToSpanRow(
        spanRow(SpanKind.Server, { ...KAFKA_ORDERS_PUBLISH }),
      ),
    ).toBe(false);
    expect(
      resolver.appendToSpanRow(
        spanRow(SpanKind.Client, { "http.request.method": "GET" }),
      ),
    ).toBe(false);
    expect(
      resolver.appendToMetricRow(
        metricRow("system.cpu.utilization", {
          state: "user",
          "resource.host.name": "web-1",
          topic: "orders",
        }),
      ),
    ).toBe(false);

    expect(spanSpy).not.toHaveBeenCalled();
    expect(metricSpy).not.toHaveBeenCalled();
    expect(keySpy).not.toHaveBeenCalled();
    expect(memoSize(resolver)).toBe(0);
  });
});

/*
 * ---- Appending: a NEW array, never a duplicate ------------------------------
 */

describe("appending the key", () => {
  test("PRODUCER, CONSUMER, CLIENT, INTERNAL and kind-less messaging spans are keyed; SERVER spans never", () => {
    const expected: string = queueKey("kafka", "orders");

    for (const kind of [
      SpanKind.Producer,
      SpanKind.Consumer,
      SpanKind.Client,
      SpanKind.Internal,
      null,
    ]) {
      const row: JSONObject = spanRow(kind, { ...KAFKA_ORDERS_PUBLISH });
      expect({ kind: kind, added: newResolver().appendToSpanRow(row) }).toEqual(
        {
          kind: kind,
          added: true,
        },
      );
      expect(row["entityKeys"]).toEqual([...RESOURCE_KEYS, expected]);
    }

    const serverRow: JSONObject = spanRow(SpanKind.Server, {
      ...KAFKA_ORDERS_PUBLISH,
    });
    const serverKeys: unknown = serverRow["entityKeys"];
    expect(newResolver().appendToSpanRow(serverRow)).toBe(false);
    expect(serverRow["entityKeys"]).toBe(serverKeys);
  });

  test("a NEW array: the shared resource array and every sibling row are untouched", () => {
    const resolver: MessagingEntityKeyResolver = newResolver();
    const shared: Array<string> = [...RESOURCE_KEYS];

    const producer: JSONObject = spanRow(
      SpanKind.Producer,
      { ...KAFKA_ORDERS_PUBLISH },
      shared,
    );
    const consumer: JSONObject = spanRow(
      SpanKind.Consumer,
      {
        "messaging.system": "kafka",
        "messaging.destination.name": "payments",
        "messaging.operation.type": "process",
      },
      shared,
    );
    const server: JSONObject = spanRow(
      SpanKind.Server,
      { "http.request.method": "POST" },
      shared,
    );
    const lag: JSONObject = metricRow(
      "kafka.consumer_group.lag_sum",
      { group: "billing", topic: "payments" },
      shared,
    );

    expect(resolver.appendToSpanRow(producer)).toBe(true);
    expect(resolver.appendToSpanRow(consumer)).toBe(true);
    expect(resolver.appendToSpanRow(server)).toBe(false);
    expect(resolver.appendToMetricRow(lag)).toBe(true);

    expect(shared).toEqual(RESOURCE_KEYS);
    expect(producer["entityKeys"]).toEqual([
      ...RESOURCE_KEYS,
      queueKey("kafka", "orders"),
    ]);
    expect(consumer["entityKeys"]).toEqual([
      ...RESOURCE_KEYS,
      queueKey("kafka", "payments"),
    ]);
    expect(lag["entityKeys"]).toEqual([
      ...RESOURCE_KEYS,
      queueKey("kafka", "payments"),
    ]);
    expect(server["entityKeys"]).toBe(shared);

    const arrays: Array<unknown> = [
      producer["entityKeys"],
      consumer["entityKeys"],
      lag["entityKeys"],
      shared,
    ];
    expect(new Set(arrays).size).toBe(4);
  });

  test("idempotent: a row already carrying the key gets nothing added and keeps its array", () => {
    const resolver: MessagingEntityKeyResolver = newResolver();
    const key: string = queueKey("kafka", "orders");

    const row: JSONObject = spanRow(SpanKind.Producer, {
      ...KAFKA_ORDERS_PUBLISH,
    });
    expect(resolver.appendToSpanRow(row)).toBe(true);
    const afterFirst: unknown = row["entityKeys"];
    expect(resolver.appendToSpanRow(row)).toBe(false);
    expect(row["entityKeys"]).toBe(afterFirst);

    // A row that arrived with the key (a replay) is left as it is too.
    const carrying: Array<string> = [key, ...RESOURCE_KEYS];
    const replayed: JSONObject = metricRow(
      "kafka.consumer_group.lag_sum",
      { topic: "orders", group: "billing" },
      carrying,
    );
    expect(resolver.appendToMetricRow(replayed)).toBe(false);
    expect(replayed["entityKeys"]).toBe(carrying);
    expect(carrying).toEqual([key, ...RESOURCE_KEYS]);
  });

  test("a row without entityKeys gets exactly the queue key", () => {
    const row: JSONObject = {
      kind: SpanKind.Producer,
      attributes: { ...KAFKA_ORDERS_PUBLISH },
    } as JSONObject;
    expect(newResolver().appendToSpanRow(row)).toBe(true);
    expect(row["entityKeys"]).toEqual([queueKey("kafka", "orders")]);

    const malformed: JSONObject = {
      kind: SpanKind.Producer,
      entityKeys: "not-an-array",
      attributes: { ...KAFKA_ORDERS_PUBLISH },
    } as JSONObject;
    expect(newResolver().appendToSpanRow(malformed)).toBe(true);
    expect(malformed["entityKeys"]).toEqual([queueKey("kafka", "orders")]);
  });

  test("the row's field order is unchanged by the stamp", () => {
    const row: JSONObject = {
      _id: "x",
      entityKeys: [...RESOURCE_KEYS],
      kind: SpanKind.Producer,
      attributes: { ...KAFKA_ORDERS_PUBLISH },
      name: "orders send",
    } as JSONObject;
    const before: Array<string> = Object.keys(row);
    expect(newResolver().appendToSpanRow(row)).toBe(true);
    expect(Object.keys(row)).toEqual(before);
  });
});

/*
 * ---- The core corpus: ingest stamps exactly the resolver's identity ---------
 */

describe("every fixture of the core corpus", () => {
  test.each<[string, SpanFixture]>(
    SPAN_FIXTURES.map((fixture: SpanFixture): [string, SpanFixture] => {
      return [fixture.name, fixture];
    }),
  )("span: %s", (_name: string, fixture: SpanFixture) => {
    const row: JSONObject = spanRow(fixture.kind, { ...fixture.attributes });
    const expected: string | null = expectedKeyOf(fixture.expected);

    expect(newResolver().appendToSpanRow(row)).toBe(expected !== null);
    expect(row["entityKeys"]).toEqual(
      expected ? [...RESOURCE_KEYS, expected] : RESOURCE_KEYS,
    );
  });

  test.each<[string, MetricFixture]>(
    METRIC_FIXTURES.map((fixture: MetricFixture): [string, MetricFixture] => {
      return [`${fixture.metricName} — ${fixture.name}`, fixture];
    }),
  )("datapoint: %s", (_name: string, fixture: MetricFixture) => {
    const row: JSONObject = metricRow(fixture.metricName, {
      ...fixture.attributes,
    });
    const expected: string | null = expectedKeyOf(fixture.expected);

    expect(newResolver().appendToMetricRow(row)).toBe(expected !== null);
    expect(row["entityKeys"]).toEqual(
      expected ? [...RESOURCE_KEYS, expected] : RESOURCE_KEYS,
    );
  });

  test("one resolver over the WHOLE corpus (a warm memo) stamps what a cold one stamps for every row", () => {
    const warm: MessagingEntityKeyResolver = newResolver();
    for (const fixture of SPAN_FIXTURES) {
      expect({
        fixture: fixture.name,
        key: warm.getSpanEntityKey({ ...fixture.attributes }, fixture.kind),
      }).toEqual({
        fixture: fixture.name,
        key: expectedKeyOf(fixture.expected),
      });
    }
    for (const fixture of METRIC_FIXTURES) {
      expect({
        fixture: fixture.name,
        key: warm.getMetricEntityKey(fixture.metricName, {
          ...fixture.attributes,
        }),
      }).toEqual({
        fixture: fixture.name,
        key: expectedKeyOf(fixture.expected),
      });
    }
  });

  test("the corpus stamps keys for every system of the catalog", () => {
    const stamped: Set<string> = new Set<string>();
    for (const fixture of SPAN_FIXTURES) {
      if (
        fixture.expected &&
        newResolver().appendToSpanRow(
          spanRow(fixture.kind, { ...fixture.attributes }),
        )
      ) {
        stamped.add(fixture.expected.system);
      }
    }
    for (const fixture of METRIC_FIXTURES) {
      if (
        fixture.expected &&
        newResolver().appendToMetricRow(
          metricRow(fixture.metricName, { ...fixture.attributes }),
        )
      ) {
        stamped.add(fixture.expected.system);
      }
    }
    for (const descriptor of MESSAGING_SYSTEMS) {
      expect({
        system: descriptor.system,
        stamped: stamped.has(descriptor.system),
      }).toEqual({
        system: descriptor.system,
        stamped: true,
      });
    }
  });
});

/*
 * ---- Every curated broker metric, from a realistic stored row ----------------
 */

/*
 * The resource a receiver's datapoints arrive with, as stored (resource keys
 * `resource.`-prefixed), per the collector receivers' source and the live
 * captures behind the catalog. A new receiver fails loudly here until it
 * gets its own realistic shape.
 */
const RECEIVER_ROWS: Record<string, Attributes> = {
  kafka_metrics: {
    "resource.kafka.cluster.alias": "prod-kafka",
    "resource.kafka.cluster.id": "5L6g3nShT-eMCtK--X86sw",
  },
  rabbitmq: {
    "resource.rabbitmq.node.name": "rabbit@16c76f2d8aa2",
    "resource.rabbitmq.vhost.name": "/",
  },
  "OpenTelemetry JMX Scraper": {
    "resource.service.name": "activemq-prod",
    "resource.telemetry.sdk.language": "java",
    "activemq.broker.name": "localhost",
    "activemq.destination.type": "queue",
  },
  azure_monitor: {
    "resource.azuremonitor.subscription_id":
      "7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b",
    "resource.azuremonitor.tenant_id": "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b",
    resource_group: "rg-prod",
    location: "westeurope",
  },
  aws_cloudwatch: {
    "resource.cloud.provider": "aws",
    "resource.cloud.account.id": "123456789012",
    "resource.cloud.region": "us-east-1",
  },
  awsfirehose: {
    "resource.cloud.provider": "aws",
    "resource.cloud.account.id": "123456789012",
    "resource.cloud.region": "us-east-1",
    "resource.service.namespace": "AWS",
    "resource.aws.cloudwatch.metric_stream_name": "oneuptime",
  },
  googlecloudmonitoring: {
    "resource.gcp.resource_type": "pubsub_subscription",
    "resource.project_id": "acme-prod",
  },
  prometheus: {
    "resource.server.address": "broker-0",
    "resource.server.port": "8080",
    "resource.service.name": "broker",
    cluster: "standalone",
  },
};

/*
 * How a required value really arrives — Azure's ARM casing, CloudWatch's
 * upper-case service names — so the case-insensitive match is exercised.
 */
const REALISTIC_REQUIRED_VALUES: Record<string, string> = {
  "microsoft.servicebus/namespaces": "Microsoft.ServiceBus/Namespaces",
  "microsoft.eventhub/namespaces": "Microsoft.EventHub/namespaces",
  sqs: "SQS",
  sns: "SNS",
};

// A realistic raw destination per system and what it resolves to.
const REALISTIC_DESTINATIONS: Record<string, { raw: string; queue: string }> = {
  kafka: { raw: "payments", queue: "payments" },
  rabbitmq: { raw: "orders", queue: "orders" },
  activemq: { raw: "orders", queue: "orders" },
  servicebus: { raw: "orders", queue: "orders" },
  eventhubs: { raw: "telemetry", queue: "telemetry" },
  aws_sqs: { raw: "orders", queue: "orders" },
  "aws.sns": { raw: "order-events", queue: "order-events" },
  gcp_pubsub: { raw: "billing-sub", queue: "billing-sub" },
  pulsar: {
    raw: "persistent://public/default/payments-partition-1",
    queue: "persistent://public/default/payments",
  },
  rocketmq: { raw: "OrderTopic", queue: "OrderTopic" },
};

// The Azure namespace, as Azure Monitor's `name` reports it (any casing).
const AZURE_NAMESPACE_AS_REPORTED: string = "Orders-Prod";

interface CuratedRow {
  attributes: Attributes;
  expectedKey: string;
}

function curatedRow(
  descriptor: MessageQueueMetricDescriptor,
  destinationKey: string,
): CuratedRow {
  const base: Attributes | undefined = RECEIVER_ROWS[descriptor.receiver];
  const destination: { raw: string; queue: string } | undefined =
    REALISTIC_DESTINATIONS[descriptor.system];
  if (!base || !destination) {
    throw new Error(
      `No realistic row for ${descriptor.system}:${descriptor.metricName} (receiver ${descriptor.receiver})`,
    );
  }

  const attributes: Attributes = { ...base };
  for (const seriesKey of descriptor.seriesKeys || []) {
    attributes[seriesKey] = "series-a";
  }
  for (const [key, accepted] of Object.entries(
    descriptor.requiredAttributes || {},
  )) {
    const canonical: string | undefined = accepted[0];
    const realistic: string | undefined = canonical
      ? REALISTIC_REQUIRED_VALUES[canonical]
      : undefined;
    if (!realistic) {
      throw new Error(`No realistic spelling for ${key}=${String(canonical)}`);
    }
    attributes[key] = realistic;
  }
  let brokerScope: string = "";
  for (const scopeKey of descriptor.scopeAttributes || []) {
    attributes[scopeKey] = AZURE_NAMESPACE_AS_REPORTED;
    brokerScope = AZURE_NAMESPACE_AS_REPORTED.toLowerCase();
  }

  // Pub/Sub topic metrics come from the topic's monitored resource.
  const isPubSubTopic: boolean = destinationKey === "resource.topic_id";
  if (isPubSubTopic) {
    attributes["resource.gcp.resource_type"] = "pubsub_topic";
  }
  attributes[destinationKey] = isPubSubTopic ? "orders" : destination.raw;

  return {
    attributes: attributes,
    expectedKey: queueKey(
      descriptor.system,
      isPubSubTopic ? "orders" : destination.queue,
      brokerScope,
    ),
  };
}

describe("every curated broker metric, from a realistic stored row", () => {
  const cases: Array<[string, MessageQueueMetricDescriptor, string]> = [];
  for (const descriptor of MESSAGE_QUEUE_METRICS) {
    // Every spelling of the destination key (Azure's two casings, …).
    for (const destinationKey of descriptor.destinationAttributes) {
      cases.push([
        `${descriptor.system}:${descriptor.metricName} via ${destinationKey}`,
        descriptor,
        destinationKey,
      ]);
    }
  }

  test("the sweep covers every curated entry", () => {
    expect(MESSAGE_QUEUE_METRICS.length).toBeGreaterThan(60);
    expect(cases.length).toBeGreaterThanOrEqual(MESSAGE_QUEUE_METRICS.length);
  });

  test.each<[string, MessageQueueMetricDescriptor, string]>(cases)(
    "%s",
    (
      _label: string,
      descriptor: MessageQueueMetricDescriptor,
      destinationKey: string,
    ) => {
      const row: CuratedRow = curatedRow(descriptor, destinationKey);
      const stored: JSONObject = metricRow(
        descriptor.metricName,
        row.attributes,
      );

      expect(newResolver().appendToMetricRow(stored)).toBe(true);
      expect(stored["entityKeys"]).toEqual([...RESOURCE_KEYS, row.expectedKey]);

      // The name is what makes it a queue's: renamed away, no key.
      expect(
        newResolver().getMetricEntityKey("broker.custom.metric", {
          ...row.attributes,
        }),
      ).toBeNull();

      // And the destination: without it, no key.
      const withoutDestination: Attributes = { ...row.attributes };
      for (const key of descriptor.destinationAttributes) {
        delete withoutDestination[key];
      }
      expect(
        newResolver().getMetricEntityKey(
          descriptor.metricName,
          withoutDestination,
        ),
      ).toBeNull();
    },
  );

  test("a metric name upper-cased by a pipeline rule still lands on the queue", () => {
    const descriptor: MessageQueueMetricDescriptor | undefined =
      MESSAGE_QUEUE_METRICS.find(
        (candidate: MessageQueueMetricDescriptor): boolean => {
          return candidate.metricName === "rabbitmq.message.current";
        },
      );
    expect(descriptor).toBeDefined();
    const row: CuratedRow = curatedRow(
      descriptor!,
      descriptor!.destinationAttributes[0]!,
    );
    expect(
      newResolver().getMetricEntityKey(
        " RabbitMQ.Message.Current ",
        row.attributes,
      ),
    ).toBe(row.expectedKey);
  });

  /*
   * A pipeline rule writes a name verbatim (`Kafka.Consumer_Group.Lag_Sum`).
   * The memo must still be keyed on the curated entry's own keys (`topic`,
   * `metadata_entityname`, …), which the span inputs do not include. If the
   * raw spelling picked the list, every datapoint of that name in a request
   * would get the first datapoint's queue.
   */
  test("a curated name in any spelling a pipeline rule writes: two queues in one request, each datapoint keyed by ITS destination", () => {
    const otherDestinations: Record<string, string> = {
      kafka: "refunds",
      rabbitmq: "invoices",
      activemq: "invoices",
      servicebus: "invoices",
      eventhubs: "audit",
      aws_sqs: "invoices",
      "aws.sns": "invoice-events",
      gcp_pubsub: "audit-sub",
      pulsar: "persistent://public/default/refunds-partition-0",
      rocketmq: "RefundTopic",
    };
    // What the core resolver itself makes of a row under the stored name.
    const coldKey: (
      descriptor: MessageQueueMetricDescriptor,
      attributes: Attributes,
    ) => string | null = (
      descriptor: MessageQueueMetricDescriptor,
      attributes: Attributes,
    ): string | null => {
      return expectedKeyOf(
        MessagingTelemetryResolverModule.resolveMessagingMetricDatapoint({
          metricName: descriptor.metricName,
          getAttribute: (key: string): unknown => {
            return attributes[key];
          },
        }),
      );
    };

    let compared: number = 0;
    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      const destinationKey: string = descriptor.destinationAttributes[0]!;
      const first: Attributes = curatedRow(
        descriptor,
        destinationKey,
      ).attributes;
      const other: string | undefined =
        destinationKey === "resource.topic_id"
          ? "refunds"
          : otherDestinations[descriptor.system];
      if (!other) {
        throw new Error(`No second destination for ${descriptor.system}`);
      }
      const second: Attributes = { ...first, [destinationKey]: other };
      const firstKey: string | null = coldKey(descriptor, first);
      const secondKey: string | null = coldKey(descriptor, second);
      expect(firstKey).not.toBeNull();
      expect(secondKey).not.toBeNull();
      expect(secondKey).not.toBe(firstKey);

      const name: string = descriptor.metricName;
      const spellings: Array<string> = [
        name.toUpperCase(),
        `\t${name}\n`,
        // Padded with spaces alone: nothing else marks it as unstored.
        `  ${name} `,
        name.charAt(0).toUpperCase() + name.substring(1),
      ];
      for (const spelling of spellings) {
        const resolver: MessagingEntityKeyResolver = newResolver();
        expect({
          metric: getMessageQueueMetricId(descriptor),
          spelling: spelling,
          keys: [
            resolver.getMetricEntityKey(spelling, { ...first }),
            resolver.getMetricEntityKey(spelling, { ...second }),
            resolver.getMetricEntityKey(spelling, { ...first }),
          ],
        }).toEqual({
          metric: getMessageQueueMetricId(descriptor),
          spelling: spelling,
          keys: [firstKey, secondKey, firstKey],
        });
        compared++;
      }
    }
    expect(compared).toBe(MESSAGE_QUEUE_METRICS.length * 4);
  });
});

/*
 * ---- One queue, whatever reported it --------------------------------------
 */

describe("identity: spellings, casings and signals of one queue share one key", () => {
  test.each<[string, Attributes, string]>([
    [
      "AmazonSQS (semconv ≤1.16, Java agent ≤2.3)",
      {
        "messaging.system": "AmazonSQS",
        "messaging.destination.name": "orders",
      },
      queueKey("aws_sqs", "orders"),
    ],
    [
      "aws.sqs (JS / Python instrumentations)",
      { "messaging.system": "aws.sqs", "messaging.destination.name": "orders" },
      queueKey("aws_sqs", "orders"),
    ],
    [
      "an SQS queue URL and no messaging.system (.NET legacy)",
      {
        "aws.queue_url":
          "https://sqs.us-east-1.amazonaws.com/123456789012/orders",
      },
      queueKey("aws_sqs", "orders"),
    ],
    [
      "aws_sns (Go otelaws) with a topic ARN",
      {
        "messaging.system": "aws_sns",
        "messaging.destination.name":
          "arn:aws:sns:us-east-1:123456789012:order-events",
      },
      queueKey("aws.sns", "order-events"),
    ],
    [
      "azure_servicebus (semconv 1.24) with the namespace host",
      {
        "messaging.system": "azure_servicebus",
        "messaging.destination.name": "orders",
        "server.address": SERVICE_BUS_HOST,
      },
      queueKey("servicebus", "orders", "orders-prod"),
    ],
    [
      "az.namespace Microsoft.ServiceBus and no messaging.system (legacy mode)",
      {
        "az.namespace": "Microsoft.ServiceBus",
        "message_bus.destination": "orders",
        "peer.address": `sb://${SERVICE_BUS_HOST}/`,
      },
      queueKey("servicebus", "orders", "orders-prod"),
    ],
    [
      "an upper-case namespace host",
      {
        "messaging.system": "servicebus",
        "messaging.destination.name": "orders",
        "server.address": "ORDERS-PROD.ServiceBus.Windows.Net",
      },
      queueKey("servicebus", "orders", "orders-prod"),
    ],
    [
      "an entity path with a subscription and the dead-letter sub-queue",
      {
        "messaging.system": "servicebus",
        "messaging.destination.name":
          "orders/Subscriptions/billing/$DeadLetterQueue",
        "server.address": SERVICE_BUS_HOST,
      },
      queueKey("servicebus", "orders", "orders-prod"),
    ],
    [
      "jms with an ActiveMQ queue:// prefix (the JMS family)",
      {
        "messaging.system": "jms",
        "messaging.destination.name": "queue://orders",
      },
      queueKey("jms", "orders"),
    ],
    [
      "activemq keys on its JMS family",
      {
        "messaging.system": "activemq",
        "messaging.destination.name": "orders",
      },
      queueKey("jms", "orders"),
    ],
    [
      "a Pub/Sub full resource name",
      {
        "messaging.system": "gcp_pubsub",
        "messaging.destination.name":
          "projects/acme-prod/subscriptions/billing-sub",
      },
      queueKey("gcp_pubsub", "billing-sub"),
    ],
    [
      "a Pulsar short name (expanded into the default tenant and namespace)",
      {
        "messaging.system": "pulsar",
        "messaging.destination.name": "payments",
      },
      queueKey("pulsar", "persistent://public/default/payments"),
    ],
    [
      "a padded, upper-case system",
      {
        "messaging.system": "  KAFKA ",
        "messaging.destination.name": "orders",
      },
      queueKey("kafka", "orders"),
    ],
    [
      "a destination in another casing",
      { "messaging.system": "kafka", "messaging.destination.name": "ORDERS" },
      queueKey("kafka", "orders"),
    ],
  ])("%s", (_label: string, attributes: Attributes, expected: string) => {
    const row: JSONObject = spanRow(SpanKind.Producer, attributes);
    expect(newResolver().appendToSpanRow(row)).toBe(true);
    expect(row["entityKeys"]).toEqual([...RESOURCE_KEYS, expected]);
  });

  test("the JMS family key is the ActiveMQ key", () => {
    expect(queueKey("activemq", "orders")).toBe(queueKey("jms", "orders"));
  });

  test("every alias of every catalog system, in any casing, keys the canonical system's queue", () => {
    const resolver: MessagingEntityKeyResolver = newResolver();
    let spellings: number = 0;
    for (const descriptor of MESSAGING_SYSTEMS) {
      const canonical: string | null = resolver.getSpanEntityKey(
        {
          "messaging.system": descriptor.system,
          "messaging.destination.name": "orders",
        },
        SpanKind.Producer,
      );
      expect({
        system: descriptor.system,
        keyed: canonical !== null,
      }).toEqual({ system: descriptor.system, keyed: true });

      for (const spelling of [
        descriptor.system.toUpperCase(),
        ...descriptor.aliases,
        ...descriptor.aliases.map((alias: string): string => {
          return ` ${alias.toUpperCase()} `;
        }),
      ]) {
        expect({
          system: descriptor.system,
          spelling: spelling,
          key: resolver.getSpanEntityKey(
            {
              "messaging.system": spelling,
              "messaging.destination.name": "orders",
            },
            SpanKind.Producer,
          ),
        }).toEqual({
          system: descriptor.system,
          spelling: spelling,
          key: canonical,
        });
        spellings++;
      }
    }
    expect(spellings).toBeGreaterThan(MESSAGING_SYSTEMS.length * 2);
  });

  test("a long-tail system the catalog does not know still keys its queue; a malformed one does not", () => {
    const resolver: MessagingEntityKeyResolver = newResolver();
    expect(
      resolver.getSpanEntityKey(
        {
          "messaging.system": "IBMMQ",
          "messaging.destination.name": "DEV.QUEUE.1",
        },
        SpanKind.Producer,
      ),
    ).toBe(queueKey("ibmmq", "DEV.QUEUE.1"));
    expect(
      resolver.getSpanEntityKey(
        {
          "messaging.system": "My Broker",
          "messaging.destination.name": "orders",
        },
        SpanKind.Producer,
      ),
    ).toBeNull();
  });

  test.each<[string, string, Attributes]>([
    [
      "lowercase dimension key, ARM-cased type",
      "azure_activemessages_average",
      {
        type: "Microsoft.ServiceBus/Namespaces",
        name: "orders-prod",
        metadata_entityname: "orders",
      },
    ],
    [
      "PascalCase dimension key, lowercase type",
      "azure_activemessages_average",
      {
        type: "microsoft.servicebus/namespaces",
        name: "orders-prod",
        metadata_EntityName: "orders",
      },
    ],
    [
      "upper-case type and namespace",
      "azure_deadletteredmessages_average",
      {
        type: "MICROSOFT.SERVICEBUS/NAMESPACES",
        name: "ORDERS-PROD",
        metadata_entityname: "Orders",
      },
    ],
  ])(
    "Azure Monitor casing variants land on the span's queue: %s",
    (_label: string, metricName: string, attributes: Attributes) => {
      const expected: string = queueKey("servicebus", "orders", "orders-prod");
      expect(newResolver().getMetricEntityKey(metricName, attributes)).toBe(
        expected,
      );
      // … the queue the .NET Azure SDK's span names.
      expect(
        newResolver().getSpanEntityKey(
          {
            "az.namespace": "Microsoft.ServiceBus",
            "messaging.system": "servicebus",
            "messaging.destination.name": "orders",
            "messaging.operation.type": "send",
            "server.address": SERVICE_BUS_HOST,
          },
          SpanKind.Producer,
        ),
      ).toBe(expected);
    },
  );

  test.each<[string, Attributes, string, string, Attributes]>([
    [
      "Kafka: a Java agent send and kafka_metrics lag",
      KAFKA_ORDERS_PUBLISH,
      SpanKind.Producer,
      "kafka.consumer_group.lag_sum",
      { group: "billing", topic: "orders" },
    ],
    [
      "RabbitMQ: a consumer and the rabbitmq receiver's per-queue resource",
      {
        "messaging.system": "rabbitmq",
        "messaging.destination.name": "orders",
        "messaging.operation": "process",
      },
      SpanKind.Consumer,
      "rabbitmq.message.current",
      {
        "resource.rabbitmq.queue.name": "orders",
        "resource.rabbitmq.vhost.name": "/",
        state: "ready",
      },
    ],
    [
      "ActiveMQ: a JMS consumer and the JMX Scraper's queue size",
      {
        "messaging.system": "jms",
        "messaging.destination.name": "queue://orders",
        "messaging.operation": "process",
      },
      SpanKind.Consumer,
      "activemq.message.queue.size",
      {
        "messaging.destination.name": "orders",
        "activemq.destination.type": "queue",
        "activemq.broker.name": "localhost",
      },
    ],
    [
      "Amazon SQS: a queue URL and CloudWatch's pull shape",
      {
        "messaging.system": "AmazonSQS",
        "aws.queue_url":
          "https://sqs.us-east-1.amazonaws.com/123456789012/orders",
      },
      SpanKind.Client,
      "amazonaws.com/aws/sqs/approximatenumberofmessagesvisible",
      { "Dimensions.QueueName": "orders" },
    ],
    [
      "Amazon SQS: a queue URL and a JSON Metric Stream",
      {
        "rpc.system": "aws-api",
        "rpc.service": "SQS",
        "rpc.method": "SendMessage",
        "aws.sqs.queue.url":
          "https://sqs.us-east-1.amazonaws.com/123456789012/orders",
      },
      SpanKind.Producer,
      "approximatenumberofmessagesvisible",
      { QueueName: "orders", "resource.service.name": "SQS" },
    ],
    [
      "Amazon SNS: a topic ARN and CloudWatch's publish count",
      {
        "messaging.system": "aws.sns",
        "messaging.destination.name":
          "arn:aws:sns:us-east-1:123456789012:order-events",
      },
      SpanKind.Producer,
      "amazonaws.com/aws/sns/numberofmessagespublished",
      { "Dimensions.TopicName": "order-events" },
    ],
    [
      "Pub/Sub: a subscriber and Cloud Monitoring's backlog",
      {
        "messaging.system": "gcp_pubsub",
        "messaging.destination.name":
          "projects/acme-prod/subscriptions/billing-sub",
        "messaging.operation.type": "receive",
      },
      SpanKind.Consumer,
      "pubsub.googleapis.com/subscription/num_undelivered_messages",
      {
        "resource.subscription_id": "billing-sub",
        "resource.project_id": "acme-prod",
      },
    ],
    [
      "Pulsar: a short name and a partitioned broker series",
      {
        "messaging.system": "pulsar",
        "messaging.destination.name": "payments",
      },
      SpanKind.Producer,
      "pulsar_msg_backlog",
      {
        cluster: "standalone",
        namespace: "public/default",
        topic: "persistent://public/default/payments-partition-1",
      },
    ],
    [
      "RocketMQ: a producer and the broker's consumer lag",
      {
        "messaging.system": "rocketmq",
        "messaging.destination.name": "orders",
      },
      SpanKind.Producer,
      "rocketmq_consumer_lag_messages",
      { topic: "orders", consumer_group: "billing", is_retry: "false" },
    ],
    [
      "Event Hubs: an SDK send and Azure Monitor's incoming count",
      {
        "messaging.system": "eventhubs",
        "messaging.destination.name": "telemetry",
        "server.address": "ingest-prod.servicebus.windows.net",
      },
      SpanKind.Producer,
      "azure_incomingmessages_total",
      {
        type: "Microsoft.EventHub/namespaces",
        name: "ingest-prod",
        metadata_entityname: "telemetry",
      },
    ],
    [
      "BullMQ: a job span and OneUptime's own queue.size gauge",
      { "messaging.system": "bullmq", "messaging.destination.name": "Workers" },
      SpanKind.Producer,
      "queue.size",
      {
        "messaging.system": "bullmq",
        "messaging.destination.name": "workers",
        state: "waiting",
      },
    ],
  ])(
    "%s",
    (
      _label: string,
      spanAttributes: Attributes,
      kind: string,
      metricName: string,
      datapointAttributes: Attributes,
    ) => {
      const resolver: MessagingEntityKeyResolver = newResolver();
      const fromSpan: string | null = resolver.getSpanEntityKey(
        spanAttributes,
        kind,
      );
      const fromDatapoint: string | null = resolver.getMetricEntityKey(
        metricName,
        datapointAttributes,
      );
      expect(fromSpan).not.toBeNull();
      expect(fromDatapoint).toBe(fromSpan);
    },
  );
});

/*
 * ---- Nothing temporary, generated or placeholder becomes a queue ------------
 */

describe("temporary, generated and placeholder destinations get no key", () => {
  test.each<[string, Attributes]>([
    [
      "a RabbitMQ server-named queue",
      {
        "messaging.system": "rabbitmq",
        "messaging.destination.name": "amq.gen-JzTY20BRgKO-HjmUJj0wLg",
      },
    ],
    [
      "a Spring AMQP generated queue",
      {
        "messaging.system": "rabbitmq",
        "messaging.destination.name": "spring.gen-8JX6aZcIQpG5rgmn7b1Ivg",
      },
    ],
    [
      "RabbitMQ direct reply-to",
      {
        "messaging.system": "rabbitmq",
        "messaging.destination.name": "amq.rabbitmq.reply-to",
      },
    ],
    [
      "a Spring Cloud Stream anonymous group queue",
      {
        "messaging.system": "rabbitmq",
        "messaging.destination.name": "orders.anonymous.a1B2c3D4e5F6g7H8i9J0kL",
      },
    ],
    [
      "a JMS temporary queue",
      {
        "messaging.system": "jms",
        "messaging.destination.name": "temp-queue://ID:host-39341-1-1:1:1",
      },
    ],
    [
      "the (temporary) placeholder",
      {
        "messaging.system": "jms",
        "messaging.destination.name": "(temporary)",
      },
    ],
    [
      "a TIBCO $TMP$ destination",
      {
        "messaging.system": "jms",
        "messaging.destination.name": "$TMP$.EMS-SERVER.1A2B.1",
      },
    ],
    [
      "an ActiveMQ advisory topic",
      {
        "messaging.system": "activemq",
        "messaging.destination.name": "ActiveMQ.Advisory.Connection",
      },
    ],
    [
      "a NATS reply inbox",
      {
        "messaging.system": "nats",
        "messaging.destination.name": "_INBOX.yFDAAX2BmGLDyH8f6Hx4Kc",
      },
    ],
    [
      "a JetStream ack subject",
      {
        "messaging.system": "nats",
        "messaging.destination.name": "$JS.ACK.ORDERS.billing.1.2.3.4.5",
      },
    ],
    [
      "a Pulsar system topic",
      {
        "messaging.system": "pulsar",
        "messaging.destination.name":
          "persistent://public/default/__change_events",
      },
    ],
    [
      "an SNS SMS publish",
      {
        "messaging.system": "aws.sns",
        "messaging.destination.name": "+15555550123",
      },
    ],
    [
      "a bare UUID",
      {
        "messaging.system": "kafka",
        "messaging.destination.name": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      },
    ],
    [
      "the unknown placeholder",
      { "messaging.system": "kafka", "messaging.destination.name": "unknown" },
    ],
    [
      "a destination a scrub rule replaced whole",
      {
        "messaging.system": "kafka",
        "messaging.destination.name": "[REDACTED]",
      },
    ],
    [
      "a hashed destination",
      {
        "messaging.system": "kafka",
        "messaging.destination.name": "[HASHED:1a2b3c4d]",
      },
    ],
    [
      "a masked destination",
      { "messaging.system": "kafka", "messaging.destination.name": "***" },
    ],
    [
      "messaging.destination.temporary = true",
      {
        "messaging.system": "rabbitmq",
        "messaging.destination.name": "rpc-replies",
        "messaging.destination.temporary": true,
      },
    ],
    [
      'messaging.destination.anonymous = "true"',
      {
        "messaging.system": "rabbitmq",
        "messaging.destination.name": "rpc-replies",
        "messaging.destination.anonymous": "true",
      },
    ],
    [
      "in-process Spring Integration channels",
      {
        "messaging.system": "spring_integration",
        "messaging.destination.name": "inputChannel",
      },
    ],
    [
      "a batch naming several topics (a JSON list)",
      {
        "messaging.system": "kafka",
        "messaging.destination.name": ["orders", "payments"],
      },
    ],
    [
      "a destination with a control character",
      {
        "messaging.system": "kafka",
        "messaging.destination.name": "ord\u0000ers",
      },
    ],
    [
      "a messaging system but no destination at all",
      { "messaging.system": "kafka", "messaging.operation.type": "receive" },
    ],
  ])("%s", (_label: string, attributes: Attributes) => {
    const resolver: MessagingEntityKeyResolver = newResolver();
    const shared: Array<string> = [...RESOURCE_KEYS];
    const row: JSONObject = spanRow(SpanKind.Consumer, attributes, shared);

    expect(resolver.appendToSpanRow(row)).toBe(false);
    expect(row["entityKeys"]).toBe(shared);
    expect(shared).toEqual(RESOURCE_KEYS);
  });

  test("UUIDs inside a name are templated, so a per-request reply topic keys ONE queue", () => {
    const resolver: MessagingEntityKeyResolver = newResolver();
    const first: string | null = resolver.getSpanEntityKey(
      {
        "messaging.system": "kafka",
        "messaging.destination.name":
          "replies-3fa85f64-5717-4562-b3fc-2c963f66afa6",
      },
      SpanKind.Producer,
    );
    const second: string | null = resolver.getSpanEntityKey(
      {
        "messaging.system": "kafka",
        "messaging.destination.name":
          "replies-7D444840-9DC0-11D1-B245-5FFDCE74FAD2",
      },
      SpanKind.Producer,
    );
    expect(first).toBe(queueKey("kafka", "replies-{uuid}"));
    expect(second).toBe(first);
  });
});

/*
 * ---- The per-request memo --------------------------------------------------
 */

describe("the per-request memo", () => {
  test("one resolution and one key per distinct queue — per-message values never split it", () => {
    // Before the spies: queueKey itself goes through keyForMessageQueue.
    const expected: string = queueKey("kafka", "orders");
    const resolveSpy: jest.SpyInstance = jest.spyOn(
      MessagingTelemetryResolverModule,
      "resolveMessagingSpan",
    );
    const keySpy: jest.SpyInstance = jest.spyOn(
      EntityKeyModule,
      "keyForMessageQueue",
    );
    const resolver: MessagingEntityKeyResolver = newResolver();

    for (let i: number = 0; i < 50; i++) {
      const row: JSONObject = spanRow(SpanKind.Producer, {
        ...KAFKA_ORDERS_PUBLISH,
        "messaging.message.id": `message-${i}`,
        "messaging.kafka.message.offset": 1000 + i,
        "messaging.destination.partition.id": String(i % 6),
        "messaging.client.id": `producer-${i % 3}`,
        "messaging.message.body.size": 100 + i,
        "messaging.kafka.message.key": `order-${i}`,
      });
      expect(resolver.appendToSpanRow(row)).toBe(true);
      expect(row["entityKeys"]).toEqual([...RESOURCE_KEYS, expected]);
    }

    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(keySpy).toHaveBeenCalledTimes(1);
  });

  test("two different queues in one request: two keys, each resolved once, never mixed up", () => {
    const resolveSpy: jest.SpyInstance = jest.spyOn(
      MessagingTelemetryResolverModule,
      "resolveMessagingSpan",
    );
    const resolver: MessagingEntityKeyResolver = newResolver();
    const orders: string = queueKey("kafka", "orders");
    const payments: string = queueKey("kafka", "payments");
    expect(orders).not.toBe(payments);

    for (let i: number = 0; i < 40; i++) {
      const topic: string = i % 2 === 0 ? "orders" : "payments";
      const row: JSONObject = spanRow(SpanKind.Producer, {
        "messaging.system": "kafka",
        "messaging.destination.name": topic,
        "messaging.kafka.message.offset": i,
      });
      expect(resolver.appendToSpanRow(row)).toBe(true);
      expect(row["entityKeys"]).toEqual([
        ...RESOURCE_KEYS,
        topic === "orders" ? orders : payments,
      ]);
    }
    expect(resolveSpy).toHaveBeenCalledTimes(2);
  });

  test("two queues of one broker metric in one request: each datapoint keyed by ITS destination", () => {
    const resolveSpy: jest.SpyInstance = jest.spyOn(
      MessagingTelemetryResolverModule,
      "resolveMessagingMetricDatapoint",
    );
    const resolver: MessagingEntityKeyResolver = newResolver();

    for (let i: number = 0; i < 30; i++) {
      const topic: string = ["orders", "payments", "refunds"][i % 3]!;
      const row: JSONObject = metricRow("kafka.consumer_group.lag", {
        group: `group-${i % 2}`,
        topic: topic,
        partition: i % 4,
      });
      expect(resolver.appendToMetricRow(row)).toBe(true);
      expect(row["entityKeys"]).toEqual([
        ...RESOURCE_KEYS,
        queueKey("kafka", topic),
      ]);
    }
    // group and partition are series, not identity: one resolution per topic.
    expect(resolveSpy).toHaveBeenCalledTimes(3);
  });

  test("the span kind is part of the memo key: a RabbitMQ joined name names the exchange to a producer and the queue to a consumer", () => {
    const resolver: MessagingEntityKeyResolver = newResolver();
    const attributes: Attributes = {
      "messaging.system": "rabbitmq",
      "messaging.destination.name": "direct_logs:warning",
      "messaging.rabbitmq.destination.routing_key": "warning",
    };

    const produced: string | null = resolver.getSpanEntityKey(
      { ...attributes },
      SpanKind.Producer,
    );
    const consumed: string | null = resolver.getSpanEntityKey(
      { ...attributes },
      SpanKind.Consumer,
    );
    const producedAgain: string | null = resolver.getSpanEntityKey(
      { ...attributes },
      SpanKind.Producer,
    );

    expect(produced).toBe(queueKey("rabbitmq", "direct_logs"));
    expect(consumed).toBe(queueKey("rabbitmq", "warning"));
    expect(producedAgain).toBe(produced);
  });

  test("the metric name is part of the memo key: the Azure SDK name implies Service Bus, a generic client name does not", () => {
    const resolver: MessagingEntityKeyResolver = newResolver();
    const attributes: Attributes = {
      "server.address": SERVICE_BUS_HOST,
      "messaging.destination.name": "orders",
      "messaging.servicebus.subscription_name": "billing",
    };

    expect(
      resolver.getMetricEntityKey("messaging.servicebus.messages.sent", {
        ...attributes,
      }),
    ).toBe(queueKey("servicebus", "orders", "orders-prod"));
    // No messaging.system, and a name that implies none: no system, no key.
    expect(
      resolver.getMetricEntityKey("messaging.client.sent.messages", {
        ...attributes,
      }),
    ).toBeNull();
    expect(
      resolver.getMetricEntityKey("messaging.servicebus.receiver.lag", {
        ...attributes,
      }),
    ).toBe(queueKey("servicebus", "orders", "orders-prod"));
  });

  test("Service Bus and Event Hubs share Azure Monitor's names: the memo keeps them apart by their resource type", () => {
    const resolver: MessagingEntityKeyResolver = newResolver();
    const serviceBus: string | null = resolver.getMetricEntityKey(
      "azure_incomingmessages_total",
      {
        type: "Microsoft.ServiceBus/Namespaces",
        name: "shared-prod",
        metadata_entityname: "orders",
      },
    );
    const eventHubs: string | null = resolver.getMetricEntityKey(
      "azure_incomingmessages_total",
      {
        type: "Microsoft.EventHub/namespaces",
        name: "shared-prod",
        metadata_entityname: "orders",
      },
    );
    const storage: string | null = resolver.getMetricEntityKey(
      "azure_incomingmessages_total",
      {
        type: "Microsoft.Storage/storageAccounts",
        name: "shared-prod",
        metadata_entityname: "orders",
      },
    );

    expect(serviceBus).toBe(queueKey("servicebus", "orders", "shared-prod"));
    expect(eventHubs).toBe(queueKey("eventhubs", "orders", "shared-prod"));
    expect(serviceBus).not.toBe(eventHubs);
    expect(storage).toBeNull();
  });

  test("Pulsar's per-consumer copies count toward no queue, while the subscription series of the same topic do — in one request", () => {
    const resolver: MessagingEntityKeyResolver = newResolver();
    const topic: string = "persistent://public/default/payments-partition-0";
    const expected: string = queueKey(
      "pulsar",
      "persistent://public/default/payments",
    );

    for (let i: number = 0; i < 3; i++) {
      expect(
        resolver.getMetricEntityKey("pulsar_out_messages_total", {
          topic: topic,
          subscription: "billing",
        }),
      ).toBe(expected);
      expect(
        resolver.getMetricEntityKey("pulsar_out_messages_total", {
          topic: topic,
          subscription: "billing",
          consumer_name: `consumer-${i}`,
          consumer_id: String(i),
        }),
      ).toBeNull();
    }
  });

  test("negative answers are memoized too, and a new request starts cold", () => {
    const resolveSpy: jest.SpyInstance = jest.spyOn(
      MessagingTelemetryResolverModule,
      "resolveMessagingSpan",
    );
    const resolver: MessagingEntityKeyResolver = newResolver();
    const temporary: Attributes = {
      "messaging.system": "rabbitmq",
      "messaging.destination.name": "amq.gen-JzTY20BRgKO-HjmUJj0wLg",
    };

    expect(
      resolver.getSpanEntityKey({ ...temporary }, SpanKind.Consumer),
    ).toBeNull();
    expect(
      resolver.getSpanEntityKey({ ...temporary }, SpanKind.Consumer),
    ).toBeNull();
    expect(resolveSpy).toHaveBeenCalledTimes(1);

    newResolver().getSpanEntityKey({ ...temporary }, SpanKind.Consumer);
    expect(resolveSpy).toHaveBeenCalledTimes(2);
  });

  test("values are type-tagged: a number and its string share an answer, arrays are keyed by their content", () => {
    const resolver: MessagingEntityKeyResolver = newResolver();

    // A port as a number and as a string: the same queue.
    expect(
      resolver.getSpanEntityKey(
        {
          ...KAFKA_ORDERS_PUBLISH,
          "server.address": "kafka-1",
          "server.port": 9092,
        },
        SpanKind.Producer,
      ),
    ).toBe(queueKey("kafka", "orders"));
    expect(
      resolver.getSpanEntityKey(
        {
          ...KAFKA_ORDERS_PUBLISH,
          "server.address": "kafka-1",
          "server.port": "9092",
        },
        SpanKind.Producer,
      ),
    ).toBe(queueKey("kafka", "orders"));

    /*
     * The resolver reads an array as its JSON text: an address LIST names
     * the Azure namespace by its first entry. Two lists, two namespaces,
     * two queues — a memo that keyed every array alike would merge them.
     */
    const fromA: string | null = resolver.getSpanEntityKey(
      {
        "messaging.system": "servicebus",
        "messaging.destination.name": "orders",
        "server.address": ["ns-a.servicebus.windows.net"],
      },
      SpanKind.Producer,
    );
    const fromB: string | null = resolver.getSpanEntityKey(
      {
        "messaging.system": "servicebus",
        "messaging.destination.name": "orders",
        "server.address": ["ns-b.servicebus.windows.net"],
      },
      SpanKind.Producer,
    );
    expect(fromA).toBe(queueKey("servicebus", "orders", "ns-a"));
    expect(fromB).toBe(queueKey("servicebus", "orders", "ns-b"));

    /*
     * An OTLP intValue reaches the row as a number, and the resolver reads
     * it as its text: two numeric destinations are two queues.
     */
    expect(
      resolver.getSpanEntityKey(
        { "messaging.system": "kafka", "messaging.destination.name": 7 },
        SpanKind.Producer,
      ),
    ).toBe(queueKey("kafka", "7"));
    expect(
      resolver.getSpanEntityKey(
        { "messaging.system": "kafka", "messaging.destination.name": 8 },
        SpanKind.Producer,
      ),
    ).toBe(queueKey("kafka", "8"));
  });

  /*
   * An OTLP boolValue reaches the row as a boolean, and a temporary flag's
   * value decides between a key and none. The memo must keep true and false
   * apart, whichever of the two a request sees first.
   */
  test("a temporary flag's value is part of the memo key: false keys the queue, true does not, in either order within one request", () => {
    const expected: string = queueKey("rabbitmq", "rpc-replies");
    const withFlag: (flag: string, value: unknown) => Attributes = (
      flag: string,
      value: unknown,
    ): Attributes => {
      return {
        "messaging.system": "rabbitmq",
        "messaging.destination.name": "rpc-replies",
        [flag]: value,
      };
    };

    expect(MESSAGING_TEMPORARY_FLAG_ATTRIBUTES.length).toBeGreaterThan(0);
    for (const flag of MESSAGING_TEMPORARY_FLAG_ATTRIBUTES) {
      for (const [kept, refused] of [
        [false, true],
        ["false", "true"],
      ] as Array<[unknown, unknown]>) {
        const keptFirst: MessagingEntityKeyResolver = newResolver();
        const keptThenRefused: Array<string | null> = [
          keptFirst.getSpanEntityKey(withFlag(flag, kept), SpanKind.Consumer),
          keptFirst.getSpanEntityKey(
            withFlag(flag, refused),
            SpanKind.Consumer,
          ),
        ];
        const refusedFirst: MessagingEntityKeyResolver = newResolver();
        const refusedThenKept: Array<string | null> = [
          refusedFirst.getSpanEntityKey(
            withFlag(flag, refused),
            SpanKind.Consumer,
          ),
          refusedFirst.getSpanEntityKey(
            withFlag(flag, kept),
            SpanKind.Consumer,
          ),
        ];
        expect({
          flag: flag,
          kept: kept,
          keptThenRefused: keptThenRefused,
          refusedThenKept: refusedThenKept,
        }).toEqual({
          flag: flag,
          kept: kept,
          keptThenRefused: [expected, null],
          refusedThenKept: [null, expected],
        });
      }
    }
  });

  test("absent, empty and amq.default destinations are separate memo slots with the same answer: the routing key's queue", () => {
    const resolveSpy: jest.SpyInstance = jest.spyOn(
      MessagingTelemetryResolverModule,
      "resolveMessagingSpan",
    );
    const resolver: MessagingEntityKeyResolver = newResolver();
    // No destination: RabbitMQ's default exchange names the routing key.
    expect(
      resolver.getSpanEntityKey(
        {
          "messaging.system": "rabbitmq",
          "messaging.rabbitmq.destination.routing_key": "orders",
        },
        SpanKind.Producer,
      ),
    ).toBe(queueKey("rabbitmq", "orders"));
    expect(
      resolver.getSpanEntityKey(
        {
          "messaging.system": "rabbitmq",
          "messaging.destination.name": "",
          "messaging.rabbitmq.destination.routing_key": "orders",
        },
        SpanKind.Producer,
      ),
    ).toBe(queueKey("rabbitmq", "orders"));
    expect(
      resolver.getSpanEntityKey(
        {
          "messaging.system": "rabbitmq",
          "messaging.destination.name": "amq.default",
          "messaging.rabbitmq.destination.routing_key": "orders",
        },
        SpanKind.Producer,
      ),
    ).toBe(queueKey("rabbitmq", "orders"));
    // An empty string is a value, not an absence: three slots, one answer.
    expect(resolveSpy).toHaveBeenCalledTimes(3);
    expect(memoSize(resolver)).toBe(3);

    // A null value IS an absence to the resolver, and shares the absent slot.
    expect(
      resolver.getSpanEntityKey(
        {
          "messaging.system": "rabbitmq",
          "messaging.destination.name": null,
          "messaging.rabbitmq.destination.routing_key": "orders",
        },
        SpanKind.Producer,
      ),
    ).toBe(queueKey("rabbitmq", "orders"));
    expect(resolveSpy).toHaveBeenCalledTimes(3);
  });

  test("bounded: past the cap, rows are still keyed correctly but no longer memoized", () => {
    const resolver: MessagingEntityKeyResolver = newResolver();
    for (let i: number = 0; i < MESSAGING_ENTITY_KEY_MAX_MEMO_ENTRIES; i++) {
      resolver.getMetricEntityKey("kafka.consumer_group.lag_sum", {
        topic: `topic-${i}`,
      });
    }
    expect(memoSize(resolver)).toBe(MESSAGING_ENTITY_KEY_MAX_MEMO_ENTRIES);

    const resolveSpy: jest.SpyInstance = jest.spyOn(
      MessagingTelemetryResolverModule,
      "resolveMessagingMetricDatapoint",
    );
    for (let i: number = 0; i < 3; i++) {
      expect(
        resolver.getMetricEntityKey("kafka.consumer_group.lag_sum", {
          topic: "overflow",
        }),
      ).toBe(queueKey("kafka", "overflow"));
    }
    expect(resolveSpy).toHaveBeenCalledTimes(3);
    expect(memoSize(resolver)).toBe(MESSAGING_ENTITY_KEY_MAX_MEMO_ENTRIES);

    // What is memoized stays memoized.
    expect(
      resolver.getMetricEntityKey("kafka.consumer_group.lag_sum", {
        topic: "topic-0",
      }),
    ).toBe(queueKey("kafka", "topic-0"));
    expect(resolveSpy).toHaveBeenCalledTimes(3);
  });

  test("outsized inputs are resolved without memoizing — the memo cannot be grown by huge values", () => {
    const resolveSpy: jest.SpyInstance = jest.spyOn(
      MessagingTelemetryResolverModule,
      "resolveMessagingSpan",
    );
    const resolver: MessagingEntityKeyResolver = newResolver();
    const longUrl: string = `amqp://broker.example.com:5672/${"v".repeat(
      MESSAGING_ENTITY_KEY_MAX_MEMO_KEY_LENGTH,
    )}`;

    for (let i: number = 0; i < 3; i++) {
      expect(
        resolver.getSpanEntityKey(
          { ...KAFKA_ORDERS_PUBLISH, "messaging.url": longUrl },
          SpanKind.Producer,
        ),
      ).toBe(queueKey("kafka", "orders"));
    }
    expect(resolveSpy).toHaveBeenCalledTimes(3);
    expect(memoSize(resolver)).toBe(0);

    // A value that is not a resolver input never reaches the memo key.
    for (let i: number = 0; i < 3; i++) {
      expect(
        resolver.getSpanEntityKey(
          {
            ...KAFKA_ORDERS_PUBLISH,
            "messaging.message.body": "b".repeat(1_000_000),
          },
          SpanKind.Producer,
        ),
      ).toBe(queueKey("kafka", "orders"));
    }
    expect(resolveSpy).toHaveBeenCalledTimes(4);
    expect(memoSize(resolver)).toBe(1);
  });

  /*
   * JSON escaping writes a control character as six characters and a quote
   * or backslash as two. Each value below fits the bound as raw characters,
   * so a bound counted before escaping let one request's memo hold 10,000
   * keys of up to about 12,000 characters, about 130 MB.
   */
  test("the bound is on the key as the memo holds it: values that JSON escaping inflates are resolved without memoizing", () => {
    const resolveSpy: jest.SpyInstance = jest.spyOn(
      MessagingTelemetryResolverModule,
      "resolveMessagingSpan",
    );
    const resolver: MessagingEntityKeyResolver = newResolver();
    const length: number = MESSAGING_ENTITY_KEY_MAX_MEMO_KEY_LENGTH - 100;
    let rows: number = 0;

    for (const value of [
      "\u0001".repeat(length),
      '"'.repeat(length),
      "\\".repeat(length),
    ]) {
      for (let i: number = 0; i < 3; i++) {
        // As the destination: the resolver refuses it, and says so each time.
        expect(
          resolver.getSpanEntityKey(
            {
              "messaging.system": "kafka",
              "messaging.destination.name": `${value}${i}`,
            },
            SpanKind.Producer,
          ),
        ).toBeNull();
        // As a display-only input: the queue is still keyed.
        expect(
          resolver.getSpanEntityKey(
            { ...KAFKA_ORDERS_PUBLISH, "messaging.url": value },
            SpanKind.Producer,
          ),
        ).toBe(queueKey("kafka", "orders"));
        rows += 2;
      }
    }

    expect(resolveSpy).toHaveBeenCalledTimes(rows);
    expect(memoSize(resolver)).toBe(0);
  });

  test("the bound is exact on the key as the memo holds it: the longest key that fits is memoized, one value character more is not", () => {
    // The memoized key's length for one row, or null when it was not memoized.
    const memoKeyLength: (url: string) => number | null = (
      url: string,
    ): number | null => {
      const resolver: MessagingEntityKeyResolver = newResolver();
      expect(
        resolver.getSpanEntityKey(
          { ...KAFKA_ORDERS_PUBLISH, "messaging.url": url },
          SpanKind.Producer,
        ),
      ).toBe(queueKey("kafka", "orders"));
      const keys: Array<string> = Array.from(resolver["memo"].keys());
      return keys.length === 1 ? keys[0]!.length : null;
    };

    // Each character adds this many to the serialized key.
    for (const [unit, width] of [
      ["u", 1],
      ['"', 2],
      ["\u0001", 6],
    ] as Array<[string, number]>) {
      const base: number | null = memoKeyLength(unit);
      expect(base).not.toBeNull();
      const fitting: number =
        1 +
        Math.floor((MESSAGING_ENTITY_KEY_MAX_MEMO_KEY_LENGTH - base!) / width);
      const longest: number | null = memoKeyLength(unit.repeat(fitting));
      expect({ unit: unit, longest: longest }).toEqual({
        unit: unit,
        longest: base! + (fitting - 1) * width,
      });
      expect(longest!).toBeLessThanOrEqual(
        MESSAGING_ENTITY_KEY_MAX_MEMO_KEY_LENGTH,
      );
      expect(longest!).toBeGreaterThan(
        MESSAGING_ENTITY_KEY_MAX_MEMO_KEY_LENGTH - width,
      );
      expect({
        unit: unit,
        oneMore: memoKeyLength(unit.repeat(fitting + 1)),
      }).toEqual({ unit: unit, oneMore: null });
    }
  });
});

/*
 * ---- The memo is keyed on EXACTLY the resolver's inputs ---------------------
 */

describe("the memo key covers every attribute the resolver reads", () => {
  /*
   * Run the real resolver with an instrumented getter and collect every key
   * it asks for.
   */
  function recordSpanReads(reads: Set<string>): void {
    const real: typeof MessagingTelemetryResolverModule.resolveMessagingSpan =
      MessagingTelemetryResolverModule.resolveMessagingSpan;
    jest
      .spyOn(MessagingTelemetryResolverModule, "resolveMessagingSpan")
      .mockImplementation(
        (
          input: Parameters<
            typeof MessagingTelemetryResolverModule.resolveMessagingSpan
          >[0],
        ): ResolvedMessagingDestination | null => {
          return real({
            ...input,
            getAttribute: (key: string): unknown => {
              reads.add(key);
              return input.getAttribute(key);
            },
          });
        },
      );
  }

  function recordMetricReads(reads: Map<string, Set<string>>): void {
    const real: typeof MessagingTelemetryResolverModule.resolveMessagingMetricDatapoint =
      MessagingTelemetryResolverModule.resolveMessagingMetricDatapoint;
    jest
      .spyOn(
        MessagingTelemetryResolverModule,
        "resolveMessagingMetricDatapoint",
      )
      .mockImplementation(
        (
          input: Parameters<
            typeof MessagingTelemetryResolverModule.resolveMessagingMetricDatapoint
          >[0],
        ): ResolvedMessagingDestination | null => {
          const forName: Set<string> =
            reads.get(input.metricName) || new Set<string>();
          reads.set(input.metricName, forName);
          return real({
            ...input,
            getAttribute: (key: string): unknown => {
              forName.add(key);
              return input.getAttribute(key);
            },
          });
        },
      );
  }

  test("spans: every key read, over the whole span corpus, is a memo input", () => {
    const reads: Set<string> = new Set<string>();
    recordSpanReads(reads);
    for (const fixture of SPAN_FIXTURES) {
      newResolver().getSpanEntityKey({ ...fixture.attributes }, fixture.kind);
    }
    expect(reads.size).toBeGreaterThan(20);
    const inputs: Set<string> = new Set<string>(
      MESSAGING_RESOLVER_INPUT_ATTRIBUTES,
    );
    expect(
      Array.from(reads).filter((key: string): boolean => {
        return !inputs.has(key);
      }),
    ).toEqual([]);
  });

  test("datapoints: every key read, for every corpus fixture and every curated entry, is a memo input for that name", () => {
    const reads: Map<string, Set<string>> = new Map<string, Set<string>>();
    recordMetricReads(reads);
    for (const fixture of METRIC_FIXTURES) {
      newResolver().getMetricEntityKey(fixture.metricName, {
        ...fixture.attributes,
      });
    }
    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      for (const destinationKey of descriptor.destinationAttributes) {
        const row: CuratedRow = curatedRow(descriptor, destinationKey);
        newResolver().getMetricEntityKey(descriptor.metricName, {
          ...row.attributes,
          // Present, so the exclusion check reads them.
          consumer_name: "c-1",
        });
        newResolver().getMetricEntityKey(descriptor.metricName, row.attributes);
      }
    }

    expect(reads.size).toBeGreaterThan(MESSAGE_QUEUE_BROKER_METRIC_NAMES.size);
    const outside: Array<string> = [];
    for (const [name, keys] of Array.from(reads.entries())) {
      const inputs: Set<string> = new Set<string>(
        getMessagingMetricMemoAttributes(name),
      );
      for (const key of Array.from(keys)) {
        if (!inputs.has(key)) {
          outside.push(`${name}: ${key}`);
        }
      }
    }
    expect(outside).toEqual([]);
  });

  test("a curated name's memo inputs are drawn from the core's declared input lists", () => {
    const declared: Set<string> = new Set<string>([
      ...MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES,
      ...MESSAGE_QUEUE_METRIC_EXCLUDED_SERIES_ATTRIBUTES,
    ]);
    for (const name of Array.from(MESSAGE_QUEUE_BROKER_METRIC_NAMES)) {
      const inputs: ReadonlyArray<string> =
        getMessagingMetricMemoAttributes(name);
      expect(inputs.length).toBeGreaterThan(0);
      for (const key of inputs) {
        expect({ name: name, key: key, declared: declared.has(key) }).toEqual({
          name: name,
          key: key,
          declared: true,
        });
      }
    }
    // Anything else resolves like a span.
    expect(getMessagingMetricMemoAttributes("queue.size")).toBe(
      MESSAGING_RESOLVER_INPUT_ATTRIBUTES,
    );
    expect(
      getMessagingMetricMemoAttributes("messaging.client.sent.messages"),
    ).toBe(MESSAGING_RESOLVER_INPUT_ATTRIBUTES);
  });

  /*
   * The property the memo must never break: whatever a warm memo answers,
   * a cold resolver answers too. Every input attribute of every fixture is
   * removed and then replaced, one at a time, with one warm resolver per
   * fixture — an input the memo key missed would surface as a stale key.
   */
  function perturbations(
    attributes: FixtureAttributes,
    inputs: ReadonlyArray<string>,
  ): Array<Attributes> {
    const variants: Array<Attributes> = [];
    for (const key of inputs) {
      const removed: Attributes = { ...attributes };
      delete removed[key];
      variants.push(removed);
      variants.push({ ...attributes, [key]: "perturbed-value" });
      const current: unknown = attributes[key];
      if (typeof current === "string" && current.length > 0) {
        variants.push({ ...attributes, [key]: `${current}-2` });
      }
      /*
       * Two different LISTS: the resolver reads an array as its JSON text
       * (an address list's first entry can name an Azure namespace).
       */
      variants.push({
        ...attributes,
        [key]: ["perturbed-a.servicebus.windows.net"],
      });
      variants.push({
        ...attributes,
        [key]: ["perturbed-b.servicebus.windows.net"],
      });
      /*
       * The other types the resolver tells apart, both ways round in one
       * warm resolver: true and false (a temporary flag decides between a
       * key and none), and two numbers (an OTLP intValue destination).
       */
      for (const value of [true, false, 7, 8]) {
        variants.push({ ...attributes, [key]: value });
      }
    }
    return variants;
  }

  test("spans: a warm memo never answers differently from a cold resolver", () => {
    let compared: number = 0;
    for (const fixture of SPAN_FIXTURES) {
      const warm: MessagingEntityKeyResolver = newResolver();
      warm.getSpanEntityKey({ ...fixture.attributes }, fixture.kind);
      for (const variant of perturbations(
        fixture.attributes,
        MESSAGING_RESOLVER_INPUT_ATTRIBUTES,
      )) {
        const fromWarm: string | null = warm.getSpanEntityKey(
          variant,
          fixture.kind,
        );
        const fromCold: string | null = newResolver().getSpanEntityKey(
          variant,
          fixture.kind,
        );
        if (fromWarm !== fromCold) {
          throw new Error(
            `Stale memo answer for "${fixture.name}" with ${JSON.stringify(variant)}`,
          );
        }
        compared++;
      }
      // The same attributes under every other kind: the kind is an input.
      for (const kind of [
        SpanKind.Producer,
        SpanKind.Consumer,
        SpanKind.Client,
        SpanKind.Internal,
        null,
      ]) {
        const fromWarm: string | null = warm.getSpanEntityKey(
          { ...fixture.attributes },
          kind,
        );
        const fromCold: string | null = newResolver().getSpanEntityKey(
          { ...fixture.attributes },
          kind,
        );
        if (fromWarm !== fromCold) {
          throw new Error(
            `Stale memo answer for "${fixture.name}" as ${String(kind)}`,
          );
        }
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(SPAN_FIXTURES.length * 50);
  });

  /*
   * Also under a name a pipeline rule wrote upper-cased: the memo inputs
   * are picked by the name trimmed and lowercased, so it must pick the same
   * inputs as the stored name. The padded and capitalized spellings of every
   * curated name are swept in "a curated name in any spelling …".
   */
  test("datapoints: a warm memo never answers differently from a cold resolver, under the stored name and an upper-cased one", () => {
    const inputs: ReadonlyArray<string> = [
      ...MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES,
      ...MESSAGE_QUEUE_METRIC_EXCLUDED_SERIES_ATTRIBUTES,
    ];
    let compared: number = 0;
    for (const fixture of METRIC_FIXTURES) {
      for (const metricName of [
        fixture.metricName,
        fixture.metricName.toUpperCase(),
      ]) {
        const warm: MessagingEntityKeyResolver = newResolver();
        warm.getMetricEntityKey(metricName, { ...fixture.attributes });
        for (const variant of perturbations(fixture.attributes, inputs)) {
          const fromWarm: string | null = warm.getMetricEntityKey(
            metricName,
            variant,
          );
          const fromCold: string | null = newResolver().getMetricEntityKey(
            metricName,
            variant,
          );
          if (fromWarm !== fromCold) {
            throw new Error(
              `Stale memo answer for "${fixture.name}" named ${JSON.stringify(metricName)} with ${JSON.stringify(variant)}`,
            );
          }
          compared++;
        }
      }
    }
    expect(compared).toBeGreaterThan(METRIC_FIXTURES.length * 2 * 50);
  });
});

/*
 * ---- Huge values ------------------------------------------------------------
 */

describe("huge attribute values", () => {
  test("a 255-character destination is a queue; one character more is not", () => {
    const resolver: MessagingEntityKeyResolver = newResolver();
    const longest: string = "q".repeat(255);
    expect(
      resolver.getSpanEntityKey(
        { "messaging.system": "kafka", "messaging.destination.name": longest },
        SpanKind.Producer,
      ),
    ).toBe(queueKey("kafka", longest));
    expect(
      resolver.getSpanEntityKey(
        {
          "messaging.system": "kafka",
          "messaging.destination.name": `${longest}q`,
        },
        SpanKind.Producer,
      ),
    ).toBeNull();
  });

  test("a destination whose canonical form cannot be a queue identifier gets no key", () => {
    /*
     * U+0130 lower-cases to two code units: 255 of them pass the resolver's
     * 255-character check but canonicalize to 510, past the identifier the
     * discovery cron stores rows under — so no row could ever carry the key.
     */
    const destination: string = "İ".repeat(255);
    const identity: MessageQueueIdentity | null = toMessageQueueIdentity({
      system: "kafka",
      destination: destination,
    });
    expect(identity).not.toBeNull();
    expect(buildMessageQueueIdentifier(identity!)).toBeNull();

    expect(
      newResolver().getSpanEntityKey(
        {
          "messaging.system": "kafka",
          "messaging.destination.name": destination,
        },
        SpanKind.Producer,
      ),
    ).toBeNull();
  });

  test.each<[string, Attributes]>([
    [
      "a 100 000-character destination",
      {
        "messaging.system": "kafka",
        "messaging.destination.name": "d".repeat(100_000),
      },
    ],
    [
      "a 10 000-entry destination list",
      {
        "messaging.system": "kafka",
        "messaging.destination.name": Array.from(
          { length: 10_000 },
          (_value: unknown, index: number): string => {
            return `topic-${index}`;
          },
        ),
      },
    ],
    [
      "a 1 000-character system",
      {
        "messaging.system": "k".repeat(1_000),
        "messaging.destination.name": "orders",
      },
    ],
    [
      "a 100 000-character whitespace-only trigger",
      { "messaging.system": " ".repeat(100_000) },
    ],
  ])(
    "%s: no key, no memo growth, no throw",
    (_label: string, attributes: Attributes) => {
      const resolver: MessagingEntityKeyResolver = newResolver();
      const row: JSONObject = spanRow(SpanKind.Producer, attributes);
      expect(resolver.appendToSpanRow(row)).toBe(false);
      expect(row["entityKeys"]).toEqual(RESOURCE_KEYS);
      expect(memoSize(resolver)).toBeLessThanOrEqual(1);
    },
  );

  test("a huge unrelated attribute neither blocks the key nor enters the memo", () => {
    const expected: string = queueKey("kafka", "orders");
    const keySpy: jest.SpyInstance = jest.spyOn(
      EntityKeyModule,
      "keyForMessageQueue",
    );
    const resolver: MessagingEntityKeyResolver = newResolver();
    for (let i: number = 0; i < 5; i++) {
      const row: JSONObject = metricRow("kafka.consumer_group.lag_sum", {
        topic: "orders",
        group: "billing",
        "resource.process.command_line": "x".repeat(500_000),
      });
      expect(resolver.appendToMetricRow(row)).toBe(true);
      expect(row["entityKeys"]).toEqual([...RESOURCE_KEYS, expected]);
    }
    expect(keySpy).toHaveBeenCalledTimes(1);
    expect(memoSize(resolver)).toBe(1);
  });
});

/*
 * ---- Never throws ----------------------------------------------------------
 */

describe("never throws into ingest", () => {
  test("a resolver bug costs the row its key, never the row — logged once per request, memoized as no key", () => {
    const warnSpy: jest.SpyInstance = jest
      .spyOn(logger, "warn")
      .mockImplementation((): void => {});
    const resolveSpy: jest.SpyInstance = jest
      .spyOn(MessagingTelemetryResolverModule, "resolveMessagingSpan")
      .mockImplementation((): ResolvedMessagingDestination | null => {
        throw new Error("resolver bug");
      });
    const resolver: MessagingEntityKeyResolver = newResolver();
    const shared: Array<string> = [...RESOURCE_KEYS];

    for (let i: number = 0; i < 10; i++) {
      const row: JSONObject = spanRow(
        SpanKind.Producer,
        { ...KAFKA_ORDERS_PUBLISH },
        shared,
      );
      expect(resolver.appendToSpanRow(row)).toBe(false);
      expect(row["entityKeys"]).toBe(shared);
    }
    expect(shared).toEqual(RESOURCE_KEYS);
    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]![0])).toContain("resolver bug");

    // Another input fails again, but the request has already said so.
    expect(
      resolver.appendToSpanRow(
        spanRow(SpanKind.Producer, {
          "messaging.system": "kafka",
          "messaging.destination.name": "payments",
        }),
      ),
    ).toBe(false);
    expect(resolveSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test("a failing datapoint resolver or key function is contained too", () => {
    jest.spyOn(logger, "warn").mockImplementation((): void => {});
    jest
      .spyOn(
        MessagingTelemetryResolverModule,
        "resolveMessagingMetricDatapoint",
      )
      .mockImplementation((): ResolvedMessagingDestination | null => {
        throw new TypeError("metric resolver bug");
      });
    expect(
      newResolver().appendToMetricRow(
        metricRow("kafka.consumer_group.lag_sum", { topic: "orders" }),
      ),
    ).toBe(false);

    jest.restoreAllMocks();
    jest.spyOn(logger, "warn").mockImplementation((): void => {});
    jest
      .spyOn(EntityKeyModule, "keyForMessageQueue")
      .mockImplementation((): string => {
        throw new Error("hash provider down");
      });
    expect(
      newResolver().appendToSpanRow(
        spanRow(SpanKind.Producer, { ...KAFKA_ORDERS_PUBLISH }),
      ),
    ).toBe(false);
  });

  test("a logger that throws is contained as well", () => {
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      throw new Error("logger down");
    });
    jest
      .spyOn(MessagingTelemetryResolverModule, "resolveMessagingSpan")
      .mockImplementation((): ResolvedMessagingDestination | null => {
        throw new Error("resolver bug");
      });
    expect(
      newResolver().appendToSpanRow(
        spanRow(SpanKind.Producer, { ...KAFKA_ORDERS_PUBLISH }),
      ),
    ).toBe(false);
  });

  test("attributes that throw on every access", () => {
    jest.spyOn(logger, "warn").mockImplementation((): void => {});
    const hostile: Record<string, unknown> = new Proxy(
      {},
      {
        get: (): never => {
          throw new Error("get");
        },
        has: (): never => {
          throw new Error("has");
        },
        getOwnPropertyDescriptor: (): never => {
          throw new Error("getOwnPropertyDescriptor");
        },
        ownKeys: (): never => {
          throw new Error("ownKeys");
        },
      },
    );
    const resolver: MessagingEntityKeyResolver = newResolver();
    expect(
      resolver.appendToSpanRow({
        kind: SpanKind.Producer,
        entityKeys: [],
        attributes: hostile,
      } as unknown as JSONObject),
    ).toBe(false);
    expect(
      resolver.appendToMetricRow({
        name: "kafka.consumer_group.lag_sum",
        entityKeys: [],
        attributes: hostile,
      } as unknown as JSONObject),
    ).toBe(false);
    expect(
      resolver.appendToMetricRow({
        name: "queue.size",
        entityKeys: [],
        attributes: hostile,
      } as unknown as JSONObject),
    ).toBe(false);
  });

  test.each<[string, unknown]>([
    ["undefined", undefined],
    ["null", null],
    ["a number", 42],
    ["a string", "row"],
    ["an empty object", {}],
    [
      "a row with attributes that are a string",
      { kind: SpanKind.Producer, attributes: "messaging.system" },
    ],
  ])(
    "a malformed row (%s) is refused quietly",
    (_label: string, row: unknown) => {
      const resolver: MessagingEntityKeyResolver = newResolver();
      expect(resolver.appendToSpanRow(row as JSONObject)).toBe(false);
      expect(resolver.appendToMetricRow(row as JSONObject)).toBe(false);
    },
  );

  test("values of every JSON-ish type in every input resolve without a single internal failure", () => {
    const warnSpy: jest.SpyInstance = jest
      .spyOn(logger, "warn")
      .mockImplementation((): void => {});
    const resolver: MessagingEntityKeyResolver = newResolver();
    const values: Array<unknown> = [
      "",
      " ",
      "orders",
      0,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      true,
      false,
      BigInt(9092),
      [],
      [1, "a", null],
      [BigInt(1)],
      {},
      { nested: "value" },
      null,
      undefined,
    ];
    const systems: Array<string> = MESSAGING_SYSTEMS.map(
      (descriptor: MessagingSystemDescriptor): string => {
        return descriptor.system;
      },
    );
    let calls: number = 0;
    for (const system of systems) {
      for (const key of MESSAGING_RESOLVER_INPUT_ATTRIBUTES) {
        for (const value of values) {
          const attributes: Attributes = {
            "messaging.system": system,
            "messaging.destination.name": "orders",
            [key]: value,
          };
          resolver.getSpanEntityKey(attributes, SpanKind.Consumer);
          resolver.getMetricEntityKey("messaging.client.consumed.messages", {
            ...attributes,
          });
          calls++;
        }
      }
    }
    expect(calls).toBeGreaterThan(1000);
    // Contained failures are logged: none happened.
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
