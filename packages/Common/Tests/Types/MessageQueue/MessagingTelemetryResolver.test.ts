import {
  AZURE_RESOURCE_PROVIDER_ATTRIBUTES,
  hasMessagingTrigger,
  isTemporaryMessagingDestination,
  MESSAGE_QUEUE_DESTINATION_MAX_LENGTH,
  MESSAGING_ADDRESS_ATTRIBUTES,
  MESSAGING_BROKER_SCOPE_ADDRESS_ATTRIBUTES,
  MESSAGING_CONSUMER_GROUP_ATTRIBUTES,
  MESSAGING_DESTINATION_ATTRIBUTES,
  MESSAGING_DIRECTION_ATTRIBUTES,
  MESSAGING_PROTOCOL_NAME_ATTRIBUTE,
  MESSAGING_RESOLVER_INPUT_ATTRIBUTES,
  MESSAGING_SYSTEM_ATTRIBUTE,
  MESSAGING_TEMPORARY_FLAG_ATTRIBUTES,
  MESSAGING_TRIGGER_ATTRIBUTES,
  MessagingAddressAttribute,
  RABBITMQ_ROUTING_KEY_ATTRIBUTES,
  ResolvedMessagingDestination,
  resolveMessagingSpan,
  RPC_SYSTEM_ATTRIBUTES,
  SNS_TOPIC_ARN_ATTRIBUTES,
  SQS_QUEUE_URL_ATTRIBUTES,
} from "../../../Types/MessageQueue/MessagingTelemetryResolver";
import { SpanKind } from "../../../Models/AnalyticsModels/Span";
import {
  CLIENT,
  CONSUMER,
  destinationOf,
  FixtureAttributes,
  INTERNAL,
  PRODUCER,
  SERVER,
  SPAN_FIXTURES,
  SpanFixture,
  toStoredColumns,
} from "./MessagingTelemetryFixtures";
import { describe, expect, test } from "@jest/globals";

function resolveSpan(
  attributes: FixtureAttributes,
  kind: string | null = null,
): ResolvedMessagingDestination | null {
  return resolveMessagingSpan({
    getAttribute: (key: string): unknown => {
      return attributes[key];
    },
    kind,
  });
}

// Resolve, recording every attribute key the resolver reads.
function resolveRecordingReads(
  attributes: FixtureAttributes,
  kind: string | null,
  reads: Set<string>,
): ResolvedMessagingDestination | null {
  return resolveMessagingSpan({
    getAttribute: (key: string): unknown => {
      reads.add(key);
      return attributes[key];
    },
    kind,
  });
}

function destinationFor(
  system: string,
  destination: string,
  extra: FixtureAttributes = {},
): string | null {
  const resolved: ResolvedMessagingDestination | null = resolveSpan(
    {
      "messaging.system": system,
      "messaging.destination.name": destination,
      ...extra,
    },
    PRODUCER,
  );
  return resolved ? resolved.destination : null;
}

describe("span kinds are the stored SpanKind strings", () => {
  test("the literals the resolver compares with are the Span model's enum values", () => {
    expect(PRODUCER).toBe(SpanKind.Producer);
    expect(CONSUMER).toBe(SpanKind.Consumer);
    expect(CLIENT).toBe(SpanKind.Client);
    expect(INTERNAL).toBe(SpanKind.Internal);
    expect(SERVER).toBe(SpanKind.Server);
  });
});

describe("attribute precedence lists", () => {
  test("triggers", () => {
    expect(MESSAGING_TRIGGER_ATTRIBUTES).toEqual([
      "messaging.system",
      "messaging.destination.name",
      "messaging.destination",
      "message_bus.destination",
      "az.namespace",
      "azure.resource_provider.namespace",
      "aws.sqs.queue.url",
      "aws.queue_url",
      "aws.sns.topic.arn",
    ]);
  });

  test("destination: template, name, the 1.17-1.20 source keys, pre-1.17, Azure legacy", () => {
    expect(MESSAGING_DESTINATION_ATTRIBUTES).toEqual([
      "messaging.destination.template",
      "messaging.destination.name",
      "messaging.source.template",
      "messaging.source.name",
      "messaging.destination",
      "message_bus.destination",
    ]);
  });

  test("temporary flags never include the untrustworthy pre-1.17 key", () => {
    expect(MESSAGING_TEMPORARY_FLAG_ATTRIBUTES).toEqual([
      "messaging.destination.temporary",
      "messaging.destination.anonymous",
      "messaging.source.temporary",
      "messaging.source.anonymous",
    ]);
    expect(MESSAGING_RESOLVER_INPUT_ATTRIBUTES).not.toContain(
      "messaging.temp_destination",
    );
  });

  test("address: current, pre-1.21, 1.22+ peer, sockets, Azure legacy, messaging.url", () => {
    expect(MESSAGING_ADDRESS_ATTRIBUTES).toEqual([
      { address: "server.address", port: "server.port" },
      { address: "net.peer.name", port: "net.peer.port" },
      { address: "network.peer.address", port: "network.peer.port" },
      { address: "net.sock.peer.addr", port: null },
      { address: "server.socket.address", port: null },
      { address: "peer.address", port: null },
      { address: "messaging.url", port: null },
    ]);
    expect(MESSAGING_BROKER_SCOPE_ADDRESS_ATTRIBUTES).toEqual([
      "server.address",
      "net.peer.name",
      "peer.address",
      "network.peer.address",
    ]);
  });

  test("direction, consumer group and system-specific keys", () => {
    expect(MESSAGING_DIRECTION_ATTRIBUTES).toEqual([
      "messaging.operation.type",
      "messaging.operation",
      "messaging.operation.name",
      "rpc.method",
    ]);
    expect(MESSAGING_CONSUMER_GROUP_ATTRIBUTES).toEqual([
      "messaging.consumer.group.name",
      "messaging.destination.subscription.name",
      "messaging.kafka.consumer.group",
      "messaging.kafka.consumer_group",
      "messaging.rocketmq.client_group",
      "messaging.eventhubs.consumer.group",
      "messaging.servicebus.destination.subscription_name",
      // azure-core-metrics-opentelemetry's name for subscriptionName.
      "messaging.servicebus.subscription_name",
    ]);
    expect(RABBITMQ_ROUTING_KEY_ATTRIBUTES).toEqual([
      "messaging.rabbitmq.destination.routing_key",
      "messaging.rabbitmq.routing_key",
    ]);
    expect(MESSAGING_PROTOCOL_NAME_ATTRIBUTE).toBe("network.protocol.name");
    expect(SQS_QUEUE_URL_ATTRIBUTES).toEqual([
      "aws.sqs.queue.url",
      "aws.queue_url",
    ]);
    expect(SNS_TOPIC_ARN_ATTRIBUTES).toEqual(["aws.sns.topic.arn"]);
    expect(AZURE_RESOURCE_PROVIDER_ATTRIBUTES).toEqual([
      "az.namespace",
      "azure.resource_provider.namespace",
    ]);
    expect(RPC_SYSTEM_ATTRIBUTES).toEqual(["rpc.system", "rpc.system.name"]);
    expect(MESSAGING_SYSTEM_ATTRIBUTE).toBe("messaging.system");
  });
});

describe("MESSAGING_RESOLVER_INPUT_ATTRIBUTES", () => {
  test("has no duplicates and no blank keys", () => {
    expect(new Set(MESSAGING_RESOLVER_INPUT_ATTRIBUTES).size).toBe(
      MESSAGING_RESOLVER_INPUT_ATTRIBUTES.length,
    );
    for (const key of MESSAGING_RESOLVER_INPUT_ATTRIBUTES) {
      expect(key).toBe(key.trim());
      expect(key.length).toBeGreaterThan(0);
    }
  });

  test("includes every precedence list", () => {
    const addressKeys: Array<string> = [];
    for (const attribute of MESSAGING_ADDRESS_ATTRIBUTES) {
      addressKeys.push(attribute.address);
      if (attribute.port) {
        addressKeys.push(attribute.port);
      }
    }
    for (const key of [
      ...MESSAGING_TRIGGER_ATTRIBUTES,
      ...MESSAGING_DESTINATION_ATTRIBUTES,
      ...MESSAGING_TEMPORARY_FLAG_ATTRIBUTES,
      ...addressKeys,
      ...MESSAGING_BROKER_SCOPE_ADDRESS_ATTRIBUTES,
      ...MESSAGING_DIRECTION_ATTRIBUTES,
      ...MESSAGING_CONSUMER_GROUP_ATTRIBUTES,
      ...RABBITMQ_ROUTING_KEY_ATTRIBUTES,
      ...SQS_QUEUE_URL_ATTRIBUTES,
      ...SNS_TOPIC_ARN_ATTRIBUTES,
      ...AZURE_RESOURCE_PROVIDER_ATTRIBUTES,
      ...RPC_SYSTEM_ATTRIBUTES,
      MESSAGING_PROTOCOL_NAME_ATTRIBUTE,
      "rpc.service",
      "component",
    ]) {
      expect(MESSAGING_RESOLVER_INPUT_ATTRIBUTES).toContain(key);
    }
  });

  test("never names a per-message or per-instance value (the cron groups by every key)", () => {
    for (const forbidden of [
      "messaging.message.id",
      "messaging.message_id",
      "messaging.message.conversation_id",
      "messaging.conversation_id",
      "messaging.message.body.size",
      "messaging.message.envelope.size",
      "messaging.batch.message_count",
      "messaging.kafka.message.offset",
      "messaging.kafka.offset",
      "messaging.kafka.partition",
      "messaging.kafka.destination.partition",
      "messaging.destination.partition.id",
      "messaging.consumer.id",
      "messaging.consumer_id",
      "messaging.client.id",
      "messaging.client_id",
      "messaging.kafka.client_id",
      "messaging.rocketmq.message.id",
      "messaging.rocketmq.queue_id",
      "messaging.rocketmq.queue_offset",
      "messaging.gcp_pubsub.message.id",
      "messaging.gcp_pubsub.message.ack_id",
      "messaging.servicebus.message.delivery_count",
      "messaging.servicebus.message.enqueued_time",
      "url.full",
      "http.url",
      "gcp.resource.name",
      "service.instance.id",
      "k8s.pod.name",
      "host.name",
      "container.id",
    ]) {
      expect(MESSAGING_RESOLVER_INPUT_ATTRIBUTES).not.toContain(forbidden);
    }
    for (const key of MESSAGING_RESOLVER_INPUT_ATTRIBUTES) {
      // Span attributes only: resource and scope keys never identify a queue.
      expect(key.startsWith("resource.")).toBe(false);
      expect(key.startsWith("scope.")).toBe(false);
    }
  });

  test("the resolver never reads a key outside the list, over every fixture and kind", () => {
    const outside: Set<string> = new Set<string>();
    const allowed: Set<string> = new Set<string>(
      MESSAGING_RESOLVER_INPUT_ATTRIBUTES,
    );
    for (const fixture of SPAN_FIXTURES) {
      for (const kind of [
        fixture.kind,
        PRODUCER,
        CONSUMER,
        CLIENT,
        INTERNAL,
        null,
      ]) {
        const reads: Set<string> = new Set<string>();
        resolveRecordingReads(fixture.attributes, kind, reads);
        for (const key of reads) {
          if (!allowed.has(key)) {
            outside.add(`${fixture.name}: ${key}`);
          }
        }
      }
    }
    expect([...outside]).toEqual([]);
  });

  test("every listed key is read by some fixture (the list has no stale keys)", () => {
    const read: Set<string> = new Set<string>();
    for (const fixture of SPAN_FIXTURES) {
      resolveRecordingReads(fixture.attributes, fixture.kind, read);
    }
    /*
     * The full-attribute probe: every key present, so each precedence list
     * is walked to its end for at least one system.
     */
    const everything: FixtureAttributes = {};
    for (const key of MESSAGING_RESOLVER_INPUT_ATTRIBUTES) {
      everything[key] = "";
    }
    for (const system of ["aws_sqs", "aws.sns", "rabbitmq", "servicebus"]) {
      resolveRecordingReads(
        {
          ...everything,
          "messaging.system": system,
          "rpc.system": "aws-api",
          "rpc.service": "SQS",
          component: "servicebus",
        },
        CLIENT,
        read,
      );
    }
    expect(
      MESSAGING_RESOLVER_INPUT_ATTRIBUTES.filter((key: string): boolean => {
        return !read.has(key);
      }),
    ).toEqual([]);
  });
});

describe("resolveMessagingSpan — real instrumentations across semconv generations", () => {
  test("the corpus is large and its names are unique", () => {
    expect(SPAN_FIXTURES.length).toBeGreaterThanOrEqual(100);
    expect(
      new Set(
        SPAN_FIXTURES.map((fixture: SpanFixture): string => {
          return fixture.name;
        }),
      ).size,
    ).toBe(SPAN_FIXTURES.length);
  });

  test.each(
    SPAN_FIXTURES.map((fixture: SpanFixture): [string, SpanFixture] => {
      return [fixture.name, fixture];
    }),
  )("%s", (_name: string, fixture: SpanFixture) => {
    expect(resolveSpan(fixture.attributes, fixture.kind)).toEqual(
      fixture.expected,
    );
  });

  test.each(
    SPAN_FIXTURES.map((fixture: SpanFixture): [string, SpanFixture] => {
      return [fixture.name, fixture];
    }),
  )(
    "%s — resolves identically read back from ClickHouse (the discovery cron's view)",
    (_name: string, fixture: SpanFixture) => {
      /*
       * The cron selects exactly MESSAGING_RESOLVER_INPUT_ATTRIBUTES from the
       * stored span — every value a string, a missing key '' — and hands
       * the row to the same resolver: it must land on the same destination
       * the ingest-time stamp used.
       */
      const row: Record<string, string> = toStoredColumns(
        fixture.attributes,
        MESSAGING_RESOLVER_INPUT_ATTRIBUTES,
      );
      expect(
        resolveMessagingSpan({
          getAttribute: (key: string): unknown => {
            return row[key];
          },
          kind: fixture.kind,
        }),
      ).toEqual(resolveSpan(fixture.attributes, fixture.kind));
    },
  );
});

describe("span kind", () => {
  const KAFKA_SEND: FixtureAttributes = {
    "messaging.system": "kafka",
    "messaging.destination.name": "orders",
  };

  test.each([
    [SERVER],
    ["SPAN_KIND_SERVER"],
    ["server"],
    ["Server"],
    [" SERVER "],
  ])("a SERVER span (%j) never resolves", (kind: string) => {
    expect(resolveSpan(KAFKA_SEND, kind)).toBeNull();
  });

  test("OTLP's integer 2 is SERVER too", () => {
    expect(
      resolveMessagingSpan({
        getAttribute: (key: string): unknown => {
          return KAFKA_SEND[key];
        },
        kind: 2 as unknown as string,
      }),
    ).toBeNull();
  });

  test.each([
    [PRODUCER, "publish"],
    ["PRODUCER", "publish"],
    ["producer", "publish"],
    [CONSUMER, "consume"],
    ["Consumer", "consume"],
    [CLIENT, "unknown"],
    [INTERNAL, "unknown"],
    ["SPAN_KIND_UNSPECIFIED", "unknown"],
    ["", "unknown"],
    ["nonsense", "unknown"],
  ])(
    "every other kind (%j) resolves, and only decides the direction: %s",
    (kind: string, direction: string) => {
      expect(resolveSpan(KAFKA_SEND, kind)?.direction).toBe(direction);
    },
  );

  test.each([
    [1, "unknown"],
    [3, "unknown"],
    [4, "publish"],
    [5, "consume"],
    [0, "unknown"],
    [9, "unknown"],
  ])("OTLP integer kind %d → %s", (kind: number, direction: string) => {
    expect(
      resolveMessagingSpan({
        getAttribute: (key: string): unknown => {
          return KAFKA_SEND[key];
        },
        kind: kind as unknown as string,
      })?.direction,
    ).toBe(direction);
  });

  test("no kind at all resolves", () => {
    expect(
      resolveMessagingSpan({
        getAttribute: (key: string): unknown => {
          return KAFKA_SEND[key];
        },
      }),
    ).toEqual(destinationOf({ system: "kafka", destination: "orders" }));
  });
});

describe("system precedence", () => {
  test("messaging.system beats every other signal", () => {
    expect(
      resolveSpan(
        {
          "messaging.system": "rabbitmq",
          "az.namespace": "Microsoft.ServiceBus",
          "rpc.system": "aws-api",
          "rpc.service": "SQS",
          "aws.sqs.queue.url": "https://sqs.us-east-1.amazonaws.com/1/q",
          "messaging.destination.name": "orders",
        },
        PRODUCER,
      )?.system,
    ).toBe("rabbitmq");
  });

  test.each([
    ["Microsoft.ServiceBus", "servicebus"],
    ["microsoft.servicebus", "servicebus"],
    ["MICROSOFT.SERVICEBUS", "servicebus"],
    ["Microsoft.EventHub", "eventhubs"],
    ["microsoft.eventhub", "eventhubs"],
  ])("az.namespace %s means %s", (namespace: string, system: string) => {
    expect(
      resolveSpan(
        {
          "az.namespace": namespace,
          "messaging.destination.name": "orders",
        },
        PRODUCER,
      )?.system,
    ).toBe(system);
    expect(
      resolveSpan(
        {
          "azure.resource_provider.namespace": namespace,
          "messaging.destination.name": "orders",
        },
        PRODUCER,
      )?.system,
    ).toBe(system);
  });

  test("the Azure provider namespace beats the legacy component", () => {
    expect(
      resolveSpan(
        {
          "az.namespace": "Microsoft.EventHub",
          component: "servicebus",
          "message_bus.destination": "orders",
        },
        PRODUCER,
      )?.system,
    ).toBe("eventhubs");
  });

  test.each([
    ["servicebus", "message_bus.destination"],
    ["ServiceBus", "peer.address"],
    ["eventhubs", "message_bus.destination"],
    ["EVENTHUBS", "peer.address"],
  ])(
    "component %s counts beside %s",
    (component: string, companion: string) => {
      const attributes: FixtureAttributes = {
        component,
        "messaging.destination.name": "orders",
        [companion]:
          companion === "peer.address"
            ? "sb://ns1.servicebus.windows.net/"
            : "orders",
      };
      expect(resolveSpan(attributes, PRODUCER)?.system).toBe(
        component.toLowerCase(),
      );
    },
  );

  test("a component that is not an Azure messaging service is no evidence", () => {
    expect(
      resolveSpan(
        {
          component: "http",
          "message_bus.destination": "orders",
          "peer.address": "api.example.com",
        },
        PRODUCER,
      ),
    ).toBeNull();
  });

  test.each([
    ["aws-api", "SQS", "aws_sqs"],
    ["aws-api", "AmazonSQS", "aws_sqs"],
    ["AWS-API", "sqs", "aws_sqs"],
    ["aws-api", "Sqs", "aws_sqs"],
    ["aws-api", "SNS", "aws.sns"],
    ["aws-api", "AmazonSNS", "aws.sns"],
    ["aws-api", "Sns", "aws.sns"],
  ])(
    "rpc.system %s + rpc.service %s → %s",
    (rpcSystem: string, rpcService: string, system: string) => {
      for (const systemKey of ["rpc.system", "rpc.system.name"]) {
        expect(
          resolveSpan(
            {
              [systemKey]: rpcSystem,
              "rpc.service": rpcService,
              "messaging.destination.name": "orders",
            },
            PRODUCER,
          )?.system,
        ).toBe(system);
      }
    },
  );

  test("an AWS RPC span for another service is not messaging", () => {
    expect(
      resolveSpan(
        {
          "rpc.system": "aws-api",
          "rpc.service": "DynamoDB",
          "messaging.destination.name": "orders",
        },
        CLIENT,
      ),
    ).toBeNull();
    expect(
      resolveSpan(
        {
          "rpc.system": "grpc",
          "rpc.service": "SQS",
          "messaging.destination.name": "orders",
        },
        CLIENT,
      ),
    ).toBeNull();
  });

  test("the SQS queue URL and SNS topic ARN keys name their systems", () => {
    expect(
      resolveSpan({ "aws.sqs.queue.url": "https://sqs.x/1/q" }, CLIENT),
    ).toEqual(destinationOf({ system: "aws_sqs", destination: "q" }));
    expect(
      resolveSpan({ "aws.queue_url": "https://sqs.x/1/q2" }, CLIENT)?.system,
    ).toBe("aws_sqs");
    expect(
      resolveSpan({ "aws.sns.topic.arn": "arn:aws:sns:us-east-1:1:t" }, CLIENT)
        ?.system,
    ).toBe("aws.sns");
  });

  test("an excluded messaging.system stops, whatever else the span says", () => {
    expect(
      resolveSpan(
        {
          "messaging.system": "spring_integration",
          "az.namespace": "Microsoft.ServiceBus",
          "messaging.destination.name": "orders",
        },
        PRODUCER,
      ),
    ).toBeNull();
  });

  test("a malformed messaging.system with no other evidence is no queue", () => {
    expect(
      resolveSpan(
        {
          "messaging.system": "Some Broker!",
          "messaging.destination.name": "orders",
        },
        PRODUCER,
      ),
    ).toBeNull();
  });

  test("Celery (destination but no system) is not detected", () => {
    expect(
      resolveSpan(
        {
          "messaging.destination": "celery",
          "celery.action": "run",
          "celery.task_name": "tasks.add",
        },
        CONSUMER,
      ),
    ).toBeNull();
  });
});

describe("destination precedence", () => {
  const ALL: FixtureAttributes = {
    "messaging.system": "kafka",
    "messaging.destination.template": "t-template",
    "messaging.destination.name": "t-name",
    "messaging.source.template": "t-source-template",
    "messaging.source.name": "t-source",
    "messaging.destination": "t-legacy",
    "message_bus.destination": "t-azure",
  };

  test("template > name > source.template > source.name > messaging.destination > message_bus.destination", () => {
    const attributes: FixtureAttributes = { ...ALL };
    const order: Array<string> = [];
    for (const key of MESSAGING_DESTINATION_ATTRIBUTES) {
      const resolved: ResolvedMessagingDestination | null = resolveSpan(
        attributes,
        PRODUCER,
      );
      order.push(resolved ? resolved.destination : "(none)");
      delete attributes[key];
    }
    expect(order).toEqual([
      "t-template",
      "t-name",
      "t-source-template",
      "t-source",
      "t-legacy",
      "t-azure",
    ]);
    expect(resolveSpan(attributes, PRODUCER)).toBeNull();
  });

  test("empty and whitespace-only values are absent: the next key is used", () => {
    expect(
      destinationFor("kafka", "", { "messaging.destination": "orders" }),
    ).toBe("orders");
    expect(
      destinationFor("kafka", "   ", { "messaging.destination": "orders" }),
    ).toBe("orders");
  });

  test("a placeholder in the first present key means no queue — never 'try the next key'", () => {
    expect(
      destinationFor("kafka", "unknown", { "messaging.destination": "orders" }),
    ).toBeNull();
    expect(
      destinationFor("jms", "(temporary)", {
        "messaging.destination": "orders",
      }),
    ).toBeNull();
  });

  test("values are trimmed and keep their casing", () => {
    expect(destinationFor("kafka", "  Orders.Created  ")).toBe(
      "Orders.Created",
    );
  });

  test("a number or boolean is read as the text ClickHouse stores", () => {
    expect(destinationFor("kafka", 42 as unknown as string)).toBe("42");
    expect(destinationFor("kafka", true as unknown as string)).toBe("true");
  });

  test("a destination naming several at once (a JSON list) is no queue", () => {
    expect(destinationFor("kafka", '["orders", "payments"]')).toBeNull();
    expect(
      destinationFor("kafka", ["orders", "payments"] as unknown as string),
    ).toBeNull();
  });

  test("objects are not destinations; the next key is used", () => {
    expect(
      destinationFor("kafka", { name: "x" } as unknown as string, {
        "messaging.destination": "orders",
      }),
    ).toBe("orders");
  });

  test("span names are never parsed", () => {
    expect(
      resolveSpan(
        { "messaging.system": "kafka", name: "orders publish" },
        PRODUCER,
      ),
    ).toBeNull();
  });
});

describe("per-system destination normalization", () => {
  test.each([
    ["https://sqs.us-east-1.amazonaws.com/123456789012/orders", "orders"],
    ["https://sqs.us-east-1.amazonaws.com/123456789012/orders/", "orders"],
    ["https://sqs.us-east-1.amazonaws.com/123456789012/orders?x=1", "orders"],
    ["https://us-east-1.queue.amazonaws.com/123456789012/legacy", "legacy"],
    ["http://localhost:4566/000000000000/local-queue", "local-queue"],
    ["http://localhost:9324/queue/elasticmq-queue", "elasticmq-queue"],
    ["arn:aws:sqs:us-east-2:123456789012:my-queue", "my-queue"],
    ["arn:aws-cn:sqs:cn-north-1:123456789012:cn-queue", "cn-queue"],
    ["orders.fifo", "orders.fifo"],
    ["orders", "orders"],
  ])("SQS %s → %s", (raw: string, name: string) => {
    expect(destinationFor("aws_sqs", raw)).toBe(name);
  });

  test("an SQS URL with no queue in its path, or a truncated ARN, is no queue", () => {
    expect(
      destinationFor("aws_sqs", "https://sqs.us-east-1.amazonaws.com"),
    ).toBeNull();
    expect(
      destinationFor("aws_sqs", "https://sqs.us-east-1.amazonaws.com/"),
    ).toBeNull();
    // SQS names cannot contain ":": an ARN cut short names nothing.
    for (const truncated of [
      "arn:aws:sqs:us-east-1",
      "arn:aws:sqs:us-east-1:123456789012",
      "arn:aws:sqs:us-east-1:123456789012:",
      "ARN:aws:sqs",
      "arn:",
    ]) {
      expect({
        truncated,
        queue: destinationFor("aws_sqs", truncated),
      }).toEqual({ truncated, queue: null });
    }
  });

  test("an SNS ARN cut short of its topic is no topic either", () => {
    for (const truncated of [
      "arn:aws:sns:us-east-1",
      "arn:aws:sns:us-east-1:123456789012",
      "arn:aws:sns:us-east-1:123456789012:",
      "arn:",
    ]) {
      expect({
        truncated,
        topic: destinationFor("aws.sns", truncated),
      }).toEqual({ truncated, topic: null });
    }
    // The full ARN still names its topic.
    expect(
      destinationFor("aws.sns", "arn:aws:sns:us-east-1:123456789012:orders"),
    ).toBe("orders");
  });

  test.each([
    ["arn:aws:sns:us-east-1:123456789012:order-events", "order-events"],
    ["arn:aws:sns:us-east-1:123456789012:orders.fifo", "orders.fifo"],
    // A subscription ARN names its topic.
    [
      "arn:aws:sns:us-east-1:123456789012:order-events:6b0e71bd-7e97-4d97-80ce-4a0994e55286",
      "order-events",
    ],
    ["order-events", "order-events"],
  ])("SNS %s → %s", (raw: string, name: string) => {
    expect(destinationFor("aws.sns", raw)).toBe(name);
  });

  test.each([
    ["arn:aws:sns:us-east-1:123456789012:endpoint/GCM/app/5f2b7c1e"],
    ["arn:aws:sns:us-east-1:123456789012:app/APNS/my-app"],
    /*
     * The same, cut after the ARN's last ":" (Go otelaws'
     * extractDestinationName, JS aws-sdk's messaging.destination): an SNS
     * topic name never contains "/".
     */
    ["endpoint/GCM/billing-app/5e3e9847-3183-3f18-a7e8-671c3a57d4b3"],
    ["endpoint/APNS/my-app/0f1e2d3c"],
    ["app/APNS/my-app"],
  ])(
    "an SNS platform endpoint or application (%s) is no queue",
    (raw: string) => {
      expect(destinationFor("aws.sns", raw)).toBeNull();
    },
  );

  test("only SNS reads a '/' as a push endpoint: other systems keep the name", () => {
    expect(destinationFor("kafka", "endpoint/GCM/app/x")).toBe(
      "endpoint/GCM/app/x",
    );
    expect(destinationFor("servicebus", "apps/orders")).toBe("apps/orders");
  });

  test.each([
    ["projects/acme/topics/orders", "orders"],
    ["projects/acme/subscriptions/billing-sub", "billing-sub"],
    ["//pubsub.googleapis.com/projects/acme/topics/orders", "orders"],
    ["orders", "orders"],
    // Not a Pub/Sub resource name: kept.
    ["projects/acme/datasets/x", "projects/acme/datasets/x"],
  ])("Pub/Sub %s → %s", (raw: string, name: string) => {
    expect(destinationFor("gcp_pubsub", raw)).toBe(name);
  });

  test.each([
    ["orders", "orders", null, false],
    ["order-events/Subscriptions/billing", "order-events", "billing", false],
    ["order-events/subscriptions/billing", "order-events", "billing", false],
    ["ORDER-EVENTS/SUBSCRIPTIONS/Billing", "ORDER-EVENTS", "Billing", false],
    ["orders/$DeadLetterQueue", "orders", null, true],
    ["orders/$deadletterqueue", "orders", null, true],
    ["orders/$Transfer/$DeadLetterQueue", "orders", null, true],
    ["orders/$transfer/$deadletterqueue", "orders", null, true],
    [
      "order-events/Subscriptions/billing/$DeadLetterQueue",
      "order-events",
      "billing",
      true,
    ],
    // Service Bus queue names may themselves contain "/".
    ["apps/orders", "apps/orders", null, false],
    ["apps/orders/$DeadLetterQueue", "apps/orders", null, true],
  ])(
    "Service Bus %s → %s (subscription %s, dead letter %s)",
    (
      raw: string,
      destination: string,
      consumerGroup: string | null,
      isDeadLetter: boolean,
    ) => {
      const resolved: ResolvedMessagingDestination | null = resolveSpan(
        {
          "messaging.system": "servicebus",
          "messaging.destination.name": raw,
        },
        CONSUMER,
      );
      expect(resolved).toMatchObject({
        destination,
        consumerGroup,
        isDeadLetter,
      });
    },
  );

  test.each([
    ["telemetry", "telemetry", null],
    ["telemetry/ConsumerGroups/$Default", "telemetry", "$Default"],
    [
      "telemetry/consumergroups/analytics/Partitions/3",
      "telemetry",
      "analytics",
    ],
  ])(
    "Event Hubs %s → %s (consumer group %s)",
    (raw: string, destination: string, consumerGroup: string | null) => {
      expect(
        resolveSpan(
          {
            "messaging.system": "eventhubs",
            "messaging.destination.name": raw,
          },
          CONSUMER,
        ),
      ).toMatchObject({ destination, consumerGroup, isDeadLetter: false });
    },
  );

  test("an entity path with nothing before its marker is no queue", () => {
    expect(destinationFor("servicebus", "/$DeadLetterQueue")).toBeNull();
    expect(destinationFor("servicebus", "/Subscriptions/billing")).toBeNull();
  });

  test.each([
    [
      "persistent://public/default/orders-partition-0",
      "persistent://public/default/orders",
    ],
    [
      "persistent://public/default/orders-partition-12",
      "persistent://public/default/orders",
    ],
    ["persistent://acme/ns/orders", "persistent://acme/ns/orders"],
    ["orders", "persistent://public/default/orders"],
    ["orders-partition-3", "persistent://public/default/orders"],
    ["acme/ns/orders", "persistent://acme/ns/orders"],
    // Not tenant/namespace/topic: left as given.
    ["acme/orders", "acme/orders"],
    ["a/b/c/d", "a/b/c/d"],
    // Only a trailing partition suffix folds.
    [
      "persistent://p/d/orders-partition-x",
      "persistent://p/d/orders-partition-x",
    ],
  ])("Pulsar %s → %s", (raw: string, name: string) => {
    expect(destinationFor("pulsar", raw)).toBe(name);
  });

  test.each([
    ["activemq", "queue://orders", "orders"],
    ["activemq", "topic://prices", "prices"],
    ["activemq", "QUEUE://Orders", "Orders"],
    ["jms", "queue://orders", "orders"],
    ["jms", "orders", "orders"],
    // Only ActiveMQ / JMS strip the prefix.
    ["kafka", "queue://orders", "queue://orders"],
  ])("%s %s → %s", (system: string, raw: string, name: string) => {
    expect(destinationFor(system, raw)).toBe(name);
  });

  test.each([
    // A PRODUCER span: [destination, routing key, queue]
    ["direct_logs:warning", "warning", "direct_logs"],
    ["direct_logs:warning:my_queue", "warning", "my_queue"],
    /*
     * Without its routing key, a producer span's name is ONE exchange name:
     * semconv requires the routing-key attribute whenever the key is
     * non-empty, so a joined {exchange}:{routing key} never comes without
     * it. MassTransit names exchanges `Namespace:Type` and publishes to them
     * with an empty routing key.
     */
    ["direct_logs:warning", null, "direct_logs:warning"],
    ["MyApp.Contracts:OrderSubmitted", null, "MyApp.Contracts:OrderSubmitted"],
    ["direct_logs:warning:my_queue", null, "my_queue"],
    ["amq.default:orders", "orders", "orders"],
    ["<default>:orders", null, "orders"],
    [":orders", null, "orders"],
    ["amq.default", "orders", "orders"],
    ["<default>", "orders", "orders"],
    ["AMQ.DEFAULT", "orders", "orders"],
    ["amq.default", null, null],
    ["<default>", null, null],
    // An empty queue part falls back to the two-part rule.
    ["ex:rk:", "rk", "ex"],
    ["ex:", "rk", "ex"],
    // The routing key contradicts the split: the whole name stands.
    ["Contracts:OrderSubmitted", "order.submitted", "Contracts:OrderSubmitted"],
    ["a:b:c", "x", "a:b:c"],
    // Four parts: not the semconv shape.
    ["a:b:c:d", null, "a:b:c:d"],
    // aio-pika's comma form.
    ["orders,order.created", null, "orders"],
    [",task_queue", null, "task_queue"],
    ["a,b,c", null, "a,b,c"],
    // Built-in exchanges are real destinations.
    ["amq.topic", "sensors.#", "amq.topic"],
    // An empty part names nothing: the default exchange's marker, its key.
    ["amq.default:", "orders", "orders"],
    [":", "orders", "orders"],
    ["amq.default:", null, null],
  ])(
    "RabbitMQ %s (routing key %s) → %s",
    (raw: string, routingKey: string | null, queue: string | null) => {
      const extra: FixtureAttributes =
        routingKey === null
          ? {}
          : { "messaging.rabbitmq.destination.routing_key": routingKey };
      expect(destinationFor("rabbitmq", raw, extra)).toBe(queue);
    },
  );

  /*
   * What a consumer's span says about its name: written to the conventions
   * that join names (the Java agent's opt-in mode: 1.26+ operation keys), to
   * RabbitMQ.Client for .NET's (1.26+ keys, network.protocol.name "amqp",
   * the exchange alone), or to the older ones (the exchange alone, legacy
   * messaging.operation).
   */
  const JOINING: FixtureAttributes = { "messaging.operation.type": "process" };
  const DOTNET_CLIENT: FixtureAttributes = {
    "messaging.operation.type": "process",
    "network.protocol.name": "amqp",
  };
  const OLDER: FixtureAttributes = { "messaging.operation": "process" };

  test.each([
    /*
     * A CONSUMER span: [destination, routing key, conventions, queue]
     * Semconv 1.30: the queue after the exchange...
     */
    ["direct_logs:warning", "warning", JOINING, "warning"],
    ["logs:logs-audit", null, JOINING, "logs-audit"],
    // ...or after the routing key of a default-exchange delivery.
    ["invoices:invoices-audit", "invoices", JOINING, "invoices-audit"],
    ["direct_logs:warning:my_queue", "warning", JOINING, "my_queue"],
    ["direct_logs:warning:my_queue", null, JOINING, "my_queue"],
    // A routing key where the joined form cannot put it: one name.
    [
      "MyApp.Contracts:OrderSubmitted",
      "order.submitted",
      JOINING,
      "MyApp.Contracts:OrderSubmitted",
    ],
    // A routing key where the joined form puts it: split, whoever wrote it.
    ["direct_logs:warning", "warning", OLDER, "warning"],
    // No routing key and no joining conventions: one exchange name.
    [
      "MyApp.Contracts:OrderSubmitted",
      null,
      DOTNET_CLIENT,
      "MyApp.Contracts:OrderSubmitted",
    ],
    [
      "MyApp.Contracts:OrderSubmitted",
      null,
      OLDER,
      "MyApp.Contracts:OrderSubmitted",
    ],
    ["logs:logs-audit", null, {}, "logs:logs-audit"],
    // A blank operation type is none.
    [
      "logs:logs-audit",
      null,
      { "messaging.operation.type": "  " },
      "logs:logs-audit",
    ],
    // Any other protocol name leaves the joining conventions in place.
    [
      "logs:logs-audit",
      null,
      { ...JOINING, "network.protocol.name": "AMQPS" },
      "logs-audit",
    ],
    [
      "logs:logs-audit",
      null,
      { ...JOINING, "network.protocol.name": "AMQP" },
      "logs:logs-audit",
    ],
    // The default exchange first always splits.
    ["amq.default:orders", null, OLDER, "orders"],
    ["<default>:orders", null, DOTNET_CLIENT, "orders"],
    // aio-pika's comma form and a bare name are unchanged on a consumer.
    ["orders,order.created", null, OLDER, "orders"],
    ["orders", "orders", JOINING, "orders"],
  ])(
    "RabbitMQ consumer %s (routing key %s, %j) → %s",
    (
      raw: string,
      routingKey: string | null,
      conventions: FixtureAttributes,
      queue: string | null,
    ) => {
      const resolved: ResolvedMessagingDestination | null = resolveSpan(
        {
          "messaging.system": "rabbitmq",
          "messaging.destination.name": raw,
          ...(routingKey === null
            ? {}
            : { "messaging.rabbitmq.destination.routing_key": routingKey }),
          ...conventions,
        },
        CONSUMER,
      );
      expect(resolved?.destination ?? null).toBe(queue);
      if (resolved) {
        expect(resolved.direction).toBe("consume");
      }
    },
  );

  test("a settle span is on the consuming side: it names the queue too", () => {
    expect(
      resolveSpan(
        {
          "messaging.system": "rabbitmq",
          "messaging.destination.name": "logs:logs-audit",
          "messaging.operation.type": "settle",
          "messaging.operation.name": "ack",
        },
        CLIENT,
      ),
    ).toEqual(
      destinationOf({
        system: "rabbitmq",
        destination: "logs-audit",
        direction: "settle",
      }),
    );
  });

  test.each([
    // A PRODUCER span written to the joining conventions.
    ["orders.topic:orders.eu.created", "orders.eu.created", "orders.topic"],
    /*
     * A joined producer name always carries its routing key: without one,
     * the colon is the exchange's own (the Java agent publishing to a
     * MassTransit exchange).
     */
    ["MyApp.Contracts:OrderSubmitted", null, "MyApp.Contracts:OrderSubmitted"],
    [
      "orders.topic:orders.eu.created",
      "other.key",
      "orders.topic:orders.eu.created",
    ],
    // The routing key as the first part is no producer's joined name.
    ["invoices:x", "invoices", "invoices:x"],
  ])(
    "RabbitMQ joined producer %s (routing key %s) → %s",
    (raw: string, routingKey: string | null, exchange: string) => {
      expect(
        destinationFor("rabbitmq", raw, {
          "messaging.operation.type": "send",
          ...(routingKey === null
            ? {}
            : { "messaging.rabbitmq.destination.routing_key": routingKey }),
        }),
      ).toBe(exchange);
    },
  );

  test("MassTransit: each message type's exchange keys its own queue, never the namespace", () => {
    const destinations: Array<string | null> = [
      "MyApp.Contracts:OrderSubmitted",
      "MyApp.Contracts:OrderCancelled",
    ].map((exchange: string): string | null => {
      return destinationFor("rabbitmq", exchange, {
        "messaging.operation": "send",
      });
    });
    expect(destinations).toEqual([
      "MyApp.Contracts:OrderSubmitted",
      "MyApp.Contracts:OrderCancelled",
    ]);
    // A blank routing key (RabbitMQ.Client v7 always tags it) is none.
    expect(
      destinationFor("rabbitmq", "MyApp.Contracts:OrderSubmitted", {
        "messaging.rabbitmq.destination.routing_key": "",
      }),
    ).toBe("MyApp.Contracts:OrderSubmitted");
  });

  test("the pre-1.17 routing key key is read too", () => {
    expect(
      destinationFor("rabbitmq", "<default>", {
        "messaging.rabbitmq.routing_key": "orders",
      }),
    ).toBe("orders");
  });

  test("with no destination at all, a RabbitMQ span names the routing key (the default exchange)", () => {
    expect(
      resolveSpan(
        {
          "messaging.system": "rabbitmq",
          "messaging.rabbitmq.destination.routing_key": "orders",
        },
        PRODUCER,
      )?.destination,
    ).toBe("orders");
  });

  test("a bare routing key is a queue name: its colons are never split", () => {
    expect(
      resolveSpan(
        {
          "messaging.system": "rabbitmq",
          "messaging.rabbitmq.destination.routing_key": "tenant:orders",
        },
        PRODUCER,
      )?.destination,
    ).toBe("tenant:orders");
  });

  test("other systems never fall back to a routing key", () => {
    expect(
      resolveSpan(
        {
          "messaging.system": "kafka",
          "messaging.rabbitmq.destination.routing_key": "orders",
        },
        PRODUCER,
      ),
    ).toBeNull();
  });

  test.each([
    ["activemq", "ActiveMQ.DLQ", true],
    ["activemq", "activemq.dlq", true],
    ["jms", "DLQ.orders", true],
    ["activemq", "orders", false],
    ["rocketmq", "%DLQ%billing", true],
    ["rocketmq", "%dlq%billing", true],
    ["rocketmq", "orders", false],
    // A DLQ-looking name elsewhere is just a name.
    ["kafka", "DLQ.orders", false],
    ["aws_sqs", "orders-dlq", false],
  ])(
    "%s %s is a dead-letter queue: %s",
    (system: string, raw: string, isDeadLetter: boolean) => {
      expect(
        resolveSpan(
          {
            "messaging.system": system,
            "messaging.destination.name": raw,
          },
          CONSUMER,
        )?.isDeadLetter,
      ).toBe(isDeadLetter);
    },
  );
});

describe("temporary, anonymous and placeholder destinations", () => {
  test.each([
    ["messaging.destination.temporary", true],
    ["messaging.destination.temporary", "true"],
    ["messaging.destination.temporary", "TRUE"],
    ["messaging.destination.temporary", " True "],
    ["messaging.destination.anonymous", true],
    ["messaging.destination.anonymous", "true"],
    ["messaging.source.temporary", true],
    ["messaging.source.anonymous", "true"],
  ])("%s = %j marks no queue", (key: string, value: boolean | string) => {
    expect(destinationFor("kafka", "orders", { [key]: value })).toBeNull();
  });

  test.each([
    ["messaging.destination.temporary", false],
    ["messaging.destination.temporary", "false"],
    ["messaging.destination.anonymous", ""],
    ["messaging.destination.anonymous", "yes"],
    ["messaging.destination.temporary", 1],
    // Pika and aio-pika set it on every publish: never trusted.
    ["messaging.temp_destination", true],
  ])("%s = %j is not a temporary mark", (key: string, value: unknown) => {
    expect(destinationFor("kafka", "orders", { [key]: value })).toBe("orders");
  });

  test.each([
    ["kafka", "(temporary)", true],
    ["kafka", "(Anonymous)", true],
    ["rabbitmq", "<generated>", true],
    ["kafka", "<default>", true],
    ["kafka", "unknown", true],
    ["kafka", "UNKNOWN", true],
    ["aws_sqs", "aws:sqs", true],
    ["aws.sns", "phone_number", true],
    ["aws.sns", "phone_number:**", true],
    ["aws.sns", "PHONE_NUMBER:**", true],
    ["aws.sns", "+15555550100", true],
    ["aws.sns", "+44 20 7946 0958", true],
    ["servicebus", "-NamespaceOnlyMetric-", true],
    ["kafka", "5f2b7c1e-8d3a-4b6f-9c0d-1e2f3a4b5c6d", true],
    ["kafka", "5F2B7C1E-8D3A-4B6F-9C0D-1E2F3A4B5C6D", true],
    ["jms", "temp-queue://ID:host-1-2-3:1:1", true],
    ["activemq", "temp-topic://ID:host-1-2-3:1:1", true],
    ["rabbitmq", "amq.gen-JzTY20BRgKO-HjmUJj0wLg", true],
    ["rabbitmq", "spring.gen-u8IWOpPoQf2a8uJ4mZr1QQ", true],
    ["rabbitmq", "amq.rabbitmq.reply-to", true],
    ["rabbitmq", "amq.rabbitmq.reply-to.g1h2AA5yZXBseS10bw==", true],
    ["rabbitmq", "orders.anonymous.X8o1yfRBQXSp5Bdd09ls7w", true],
    ["jms", "$TMP$.EMS.1", true],
    ["activemq", "$tmp$.x", true],
    ["jms", "ActiveMQ.Advisory.Connection", true],
    ["activemq", "ActiveMQ.Advisory.Producer.Queue.orders", true],
    ["nats", "_INBOX", true],
    ["nats", "_INBOX.abc123", true],
    ["nats", "_INBOX.", true],
    ["nats", "$JS.ACK", true],
    ["nats", "$JS.ACK.ORDERS.billing.1.2.3.4.0", true],
    ["pulsar", "persistent://public/default/__change_events", true],
    ["pulsar", "__change_events", true],
    ["pulsar", "__transaction_log_1", true],
    ["pulsar", "persistent://pulsar/system/__transaction_buffer", true],
    // Real names.
    ["kafka", "orders", false],
    ["kafka", "unknown-orders", false],
    ["rabbitmq", "amq.topic", false],
    ["rabbitmq", "orders.anonymous.short", false],
    ["rabbitmq", "amq.gen", false],
    ["nats", "_INBOXES", false],
    ["nats", "orders._INBOX", false],
    ["pulsar", "persistent://public/default/orders", false],
    ["pulsar", "persistent://public/default/my__topic", false],
    ["aws.sns", "order-events", false],
    ["aws.sns", "+orders", false],
    ["activemq", "ActiveMQ.DLQ", false],
    ["servicebus", "orders", false],
    // Rules are per system: another system's generated name is a name.
    ["kafka", "amq.gen-JzTY20BRgKO-HjmUJj0wLg", false],
    ["kafka", "_INBOX.abc", false],
    ["kafka", "ActiveMQ.Advisory.Connection", false],
    ["rabbitmq", "$TMP$.x", false],
    ["kafka", "__change_events", false],
    ["kafka", "+15555550100", false],
    /*
     * The SMS placeholders are SNS's, and exact: real destinations of any
     * system may start with "phone_number" (an SNS topic name cannot hold
     * the ":" of the censored placeholder).
     */
    ["aws.sns", "phone_numbers", false],
    ["aws.sns", "phone_number_verified", false],
    ["kafka", "phone_number", false],
    ["kafka", "phone_numbers", false],
    ["kafka", "phone_number_verified", false],
    ["rabbitmq", "phone_number.changed", false],
    ["rabbitmq", "phone_number_verification", false],
    ["aws_sqs", "phone_number_updates", false],
    // What a scrubber leaves of a WHOLE value names nothing, for any system.
    ["kafka", "[REDACTED]", true],
    ["aws_sqs", "[redacted]", true],
    ["rabbitmq", "[HASHED:ab12cd34]", true],
    ["servicebus", "[hashed:0F1E2D3C]", true],
    ["kafka", "***", true],
    ["jms", "*", true],
    // A value scrubbed only in part still names its queue.
    ["kafka", "orders-[REDACTED]", false],
    ["kafka", "tenant-[HASHED:ab12cd34]-events", false],
    ["kafka", "orders-***", false],
    ["kafka", "[HASHED:not-hex]", false],
  ])(
    "isTemporaryMessagingDestination(%s, %s) = %s",
    (system: string, destination: string, temporary: boolean) => {
      expect(isTemporaryMessagingDestination(system, destination)).toBe(
        temporary,
      );
    },
  );

  test("system aliases apply their system's rules", () => {
    expect(
      isTemporaryMessagingDestination("artemis", "ActiveMQ.Advisory.Topic"),
    ).toBe(true);
    expect(isTemporaryMessagingDestination("jetstream", "_INBOX.x")).toBe(true);
  });

  test("a blank or non-string name is never a queue", () => {
    expect(isTemporaryMessagingDestination("kafka", "")).toBe(true);
    expect(isTemporaryMessagingDestination("kafka", "   ")).toBe(true);
    expect(
      isTemporaryMessagingDestination("kafka", null as unknown as string),
    ).toBe(true);
    expect(
      isTemporaryMessagingDestination("kafka", 42 as unknown as string),
    ).toBe(true);
  });

  test("an unknown or empty system gets only the general rules", () => {
    expect(isTemporaryMessagingDestination("ibmmq", "unknown")).toBe(true);
    expect(isTemporaryMessagingDestination("ibmmq", "DEV.QUEUE.1")).toBe(false);
    expect(isTemporaryMessagingDestination("", "(temporary)")).toBe(true);
    expect(isTemporaryMessagingDestination("", "orders")).toBe(false);
  });

  test("real destinations named phone_number… resolve on every system but SNS's placeholders", () => {
    expect(
      resolveSpan(
        {
          "messaging.system": "kafka",
          "messaging.destination.name": "phone_numbers",
        },
        PRODUCER,
      ),
    ).toEqual(
      destinationOf({
        system: "kafka",
        destination: "phone_numbers",
        direction: "publish",
      }),
    );
    expect(destinationFor("kafka", "phone_number_verified")).toBe(
      "phone_number_verified",
    );
    expect(destinationFor("aws_sqs", "phone_number_updates")).toBe(
      "phone_number_updates",
    );
    expect(
      destinationFor("rabbitmq", "amq.default", {
        "messaging.rabbitmq.destination.routing_key":
          "phone_number_verification",
      }),
    ).toBe("phone_number_verification");
    expect(destinationFor("aws.sns", "phone_numbers")).toBe("phone_numbers");
    // Python botocore's SMS publish: destination "phone_number:**".
    expect(destinationFor("aws.sns", "phone_number:**")).toBeNull();
    expect(
      resolveSpan(
        {
          "rpc.system": "aws-api",
          "rpc.service": "SNS",
          "messaging.destination": "phone_number:**",
          "messaging.destination.name": "phone_number:**",
        },
        PRODUCER,
      ),
    ).toBeNull();
  });

  test("a scrubbed destination is no queue on any system, whatever its normalizer does", () => {
    for (const system of [
      "kafka",
      "rabbitmq",
      "aws_sqs",
      "aws.sns",
      "gcp_pubsub",
      "servicebus",
      "pulsar",
      "activemq",
      "ibmmq",
    ]) {
      for (const scrubbed of ["[REDACTED]", "[HASHED:5e3e9847]", "***"]) {
        expect({
          system,
          scrubbed,
          queue: destinationFor(system, scrubbed),
        }).toEqual({
          system,
          scrubbed,
          queue: null,
        });
      }
    }
    // Pulsar would otherwise expand it into persistent://public/default/….
    expect(destinationFor("pulsar", "[REDACTED]")).toBeNull();
    // Scrubbed in part, the rest still names the queue.
    expect(destinationFor("kafka", "user-[REDACTED]-events")).toBe(
      "user-[REDACTED]-events",
    );
  });
});

describe("control characters", () => {
  test.each([
    ["NUL", "orders\u0000x"],
    ["tab", "orders\tx"],
    ["newline", "orders\nx"],
    ["escape", "orders\u001bx"],
    ["unit separator", "orders\u001fx"],
    ["DEL", "orders\u007fx"],
  ])(
    "a destination holding %s is no queue (Postgres cannot store U+0000, and none belongs in a name)",
    (_name: string, destination: string) => {
      expect(destinationFor("kafka", destination)).toBeNull();
      expect(destinationFor("rabbitmq", destination)).toBeNull();
    },
  );

  test("surrounding whitespace is trimmed, never rejected; other characters are kept", () => {
    expect(destinationFor("kafka", "\torders\n")).toBe("orders");
    expect(destinationFor("kafka", "orders\u0085x")).toBe("orders\u0085x");
    expect(destinationFor("kafka", "orders é ü")).toBe("orders é ü");
  });

  test("a display-only value holding one is dropped, not the queue", () => {
    const resolved: ResolvedMessagingDestination | null = resolveSpan(
      {
        "messaging.system": "kafka",
        "messaging.destination.name": "orders",
        "server.address": "kafka-1\u0000evil",
        "messaging.kafka.consumer.group": "billing\u0000x",
      },
      CONSUMER,
    );
    expect(resolved).toEqual(
      destinationOf({
        system: "kafka",
        destination: "orders",
        direction: "consume",
      }),
    );
  });
});

describe("blank values", () => {
  test("the allocation-free trigger check treats exactly what String.prototype.trim removes as blank", () => {
    const disagreements: Array<string> = [];
    for (let code: number = 0; code <= 0xffff; code++) {
      const character: string = String.fromCharCode(code);
      const blank: boolean = character.trim() === "";
      const trigger: boolean = hasMessagingTrigger({
        "messaging.system": `${character}${character}`,
      });
      if (trigger === blank) {
        disagreements.push(code.toString(16));
      }
    }
    expect(disagreements).toEqual([]);
  });
});

describe("UUID templating and length", () => {
  test("each UUID becomes {uuid}, so a per-request queue keys one queue", () => {
    expect(
      destinationFor("rabbitmq", "reply-5f2b7c1e-8d3a-4b6f-9c0d-1e2f3a4b5c6d"),
    ).toBe("reply-{uuid}");
    expect(
      destinationFor(
        "kafka",
        "tenant-5F2B7C1E-8D3A-4B6F-9C0D-1E2F3A4B5C6D.orders.0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b",
      ),
    ).toBe("tenant-{uuid}.orders.{uuid}");
    // Different UUIDs land on the same destination.
    expect(
      destinationFor("kafka", "jobs-11111111-2222-3333-4444-555555555555"),
    ).toBe(
      destinationFor("kafka", "jobs-66666666-7777-8888-9999-000000000000"),
    );
  });

  test("a bare UUID is generated, not templated", () => {
    expect(
      destinationFor("kafka", "5f2b7c1e-8d3a-4b6f-9c0d-1e2f3a4b5c6d"),
    ).toBeNull();
  });

  test("something UUID-like but not canonical is kept", () => {
    expect(destinationFor("kafka", "5f2b7c1e8d3a4b6f9c0d1e2f3a4b5c6d")).toBe(
      "5f2b7c1e8d3a4b6f9c0d1e2f3a4b5c6d",
    );
    expect(destinationFor("kafka", "orders-2026-09-30")).toBe(
      "orders-2026-09-30",
    );
  });

  test("a destination may be 255 characters, not 256", () => {
    expect(MESSAGE_QUEUE_DESTINATION_MAX_LENGTH).toBe(255);
    expect(destinationFor("kafka", "a".repeat(255))).toBe("a".repeat(255));
    expect(destinationFor("kafka", "a".repeat(256))).toBeNull();
  });

  test("the length is checked after normalization and templating", () => {
    // 36-character UUIDs shrink to 6 characters each.
    const long: string = `${"q".repeat(200)}${"-5f2b7c1e-8d3a-4b6f-9c0d-1e2f3a4b5c6d".repeat(3)}`;
    expect(long.length).toBeGreaterThan(255);
    expect(destinationFor("kafka", long)).toBe(
      `${"q".repeat(200)}-{uuid}-{uuid}-{uuid}`,
    );
    // An SQS URL longer than 255 whose queue name is short is fine.
    expect(
      destinationFor(
        "aws_sqs",
        `https://sqs.us-east-1.amazonaws.com/${"1".repeat(300)}/orders`,
      ),
    ).toBe("orders");
  });
});

describe("broker scope (Azure namespaces only)", () => {
  function scopeOf(
    system: string,
    address: FixtureAttributes,
  ): string | undefined {
    return resolveSpan(
      {
        "messaging.system": system,
        "messaging.destination.name": "orders",
        ...address,
      },
      PRODUCER,
    )?.brokerScope;
  }

  test.each([
    ["server.address", "orders-prod.servicebus.windows.net", "orders-prod"],
    ["server.address", "ORDERS-PROD.ServiceBus.Windows.Net", "orders-prod"],
    ["server.address", "orders-prod.servicebus.windows.net.", "orders-prod"],
    ["net.peer.name", "orders-prod.servicebus.windows.net", "orders-prod"],
    ["peer.address", "sb://orders-prod.servicebus.windows.net/", "orders-prod"],
    [
      "peer.address",
      "amqps://orders-prod.servicebus.windows.net:5671",
      "orders-prod",
    ],
    [
      "network.peer.address",
      "orders-prod.servicebus.windows.net",
      "orders-prod",
    ],
    ["server.address", "gov.servicebus.usgovcloudapi.net", "gov"],
    ["server.address", "cn.servicebus.chinacloudapi.cn", "cn"],
    ["server.address", "de.servicebus.cloudapi.de", "de"],
    ["server.address", "localhost", ""],
    ["server.address", "10.0.0.5", ""],
    ["server.address", "servicebus.windows.net", ""],
    ["server.address", "orders-prod.servicebus.windows.net.evil.com", ""],
    ["server.address", "orders.custom-domain.com", ""],
  ])(
    "a Service Bus span with %s = %s is scoped %j",
    (key: string, value: string, scope: string) => {
      expect(scopeOf("servicebus", { [key]: value })).toBe(scope);
      expect(scopeOf("eventhubs", { [key]: value })).toBe(scope);
    },
  );

  test("the first key naming a namespace wins, in precedence order", () => {
    expect(
      scopeOf("servicebus", {
        "server.address": "10.0.0.5",
        "net.peer.name": "second.servicebus.windows.net",
        "peer.address": "sb://third.servicebus.windows.net/",
      }),
    ).toBe("second");
    expect(
      scopeOf("servicebus", {
        "server.address": "first.servicebus.windows.net",
        "net.peer.name": "second.servicebus.windows.net",
      }),
    ).toBe("first");
  });

  test("no address at all leaves the scope empty", () => {
    expect(scopeOf("servicebus", {})).toBe("");
  });

  test("every other system has an empty scope, even on a namespace host", () => {
    for (const system of ["kafka", "eventgrid", "rabbitmq", "aws_sqs"]) {
      expect(
        scopeOf(system, {
          "server.address": "orders-prod.servicebus.windows.net",
        }),
      ).toBe("");
    }
  });
});

describe("broker address (display only)", () => {
  function addressOf(attributes: FixtureAttributes): string | null | undefined {
    return resolveSpan(
      {
        "messaging.system": "kafka",
        "messaging.destination.name": "orders",
        ...attributes,
      },
      PRODUCER,
    )?.brokerAddress;
  }

  test.each([
    [{ "server.address": "kafka-1" }, "kafka-1"],
    [{ "server.address": "kafka-1", "server.port": 9092 }, "kafka-1:9092"],
    [{ "server.address": "kafka-1", "server.port": "9092" }, "kafka-1:9092"],
    [{ "server.address": "kafka-1", "server.port": "09092" }, "kafka-1:9092"],
    [{ "server.address": "kafka-1:9093", "server.port": 9092 }, "kafka-1:9093"],
    [{ "server.address": "kafka-1", "server.port": "abc" }, "kafka-1"],
    [{ "server.address": "kafka-1", "server.port": 70000 }, "kafka-1"],
    [{ "server.address": "kafka-1", "server.port": 0 }, "kafka-1"],
    [{ "server.address": "::1", "server.port": 9092 }, "[::1]:9092"],
    [{ "server.address": "[::1]:9092" }, "[::1]:9092"],
    [
      { "server.address": "[2001:db8::1]", "server.port": 9092 },
      "[2001:db8::1]:9092",
    ],
    [{ "server.address": "2001:db8::1" }, "2001:db8::1"],
    [{ "server.address": "kafka-1:9092,kafka-2:9092" }, "kafka-1:9092"],
    [{ "server.address": '["kafka-1:9092", "kafka-2:9092"]' }, "kafka-1:9092"],
    [{ "server.address": "['kafka-1:9092', 'kafka-2:9092']" }, "kafka-1:9092"],
    [{ "server.address": ["kafka-1:9092", "kafka-2:9092"] }, "kafka-1:9092"],
    [{ "server.address": "[]" }, null],
    [{ "server.address": "  " }, null],
    [{ "net.peer.name": "kafka-1", "net.peer.port": 9092 }, "kafka-1:9092"],
    [
      { "network.peer.address": "10.0.0.7", "network.peer.port": 9092 },
      "10.0.0.7:9092",
    ],
    [{ "net.sock.peer.addr": "10.0.0.8" }, "10.0.0.8"],
    [{ "server.socket.address": "10.0.0.9" }, "10.0.0.9"],
    [
      { "peer.address": "sb://ns.servicebus.windows.net/" },
      "ns.servicebus.windows.net",
    ],
    [
      { "messaging.url": "amqp://guest:secret@rabbit.prod:5672/vhost" },
      "rabbit.prod:5672",
    ],
    [{ "messaging.url": "amqps://user:p%40ss@rabbit.prod" }, "rabbit.prod"],
    [{ "messaging.url": "user:secret@rabbit.prod:5672" }, "rabbit.prod:5672"],
    [{ "messaging.url": "rabbit.prod:5672/vhost" }, "rabbit.prod:5672"],
    [
      { "messaging.url": "https://sqs.us-east-1.amazonaws.com/1/q" },
      "sqs.us-east-1.amazonaws.com",
    ],
    [
      { "messaging.url": "https://host.example:8443/path?q=1#f" },
      "host.example:8443",
    ],
  ])("%j → %j", (attributes: FixtureAttributes, address: string | null) => {
    expect(addressOf(attributes)).toBe(address);
  });

  test("server.address wins over every other key; the port pairs with its own address key", () => {
    expect(
      addressOf({
        "server.address": "a",
        "net.peer.name": "b",
        "net.peer.port": 1,
        "network.peer.address": "c",
        "messaging.url": "amqp://d",
      }),
    ).toBe("a");
    expect(
      addressOf({
        "net.peer.name": "b",
        "server.port": 9092,
      }),
    ).toBe("b");
  });

  test("an address is clamped to 255 characters", () => {
    const address: string | null | undefined = addressOf({
      "server.address": `${"h".repeat(300)}.example`,
    });
    expect(address?.length).toBe(255);
  });

  test("no address key leaves it null", () => {
    expect(addressOf({})).toBeNull();
  });
});

describe("direction precedence", () => {
  function directionOf(
    attributes: FixtureAttributes,
    kind: string | null,
    system: string = "kafka",
  ): string | undefined {
    return resolveSpan(
      {
        "messaging.system": system,
        "messaging.destination.name": "orders",
        ...attributes,
      },
      kind,
    )?.direction;
  }

  test.each([
    ["send", "publish"],
    ["publish", "publish"],
    ["create", "publish"],
    ["receive", "consume"],
    ["process", "consume"],
    ["deliver", "consume"],
    ["settle", "settle"],
    ["SEND", "publish"],
    [" Process ", "consume"],
  ])("messaging.operation.type %j → %s", (value: string, direction: string) => {
    expect(directionOf({ "messaging.operation.type": value }, CLIENT)).toBe(
      direction,
    );
    expect(directionOf({ "messaging.operation": value }, CLIENT)).toBe(
      direction,
    );
  });

  test("messaging.operation.type beats the span kind", () => {
    expect(
      directionOf({ "messaging.operation.type": "settle" }, CONSUMER),
    ).toBe("settle");
    expect(
      directionOf({ "messaging.operation.type": "receive" }, PRODUCER),
    ).toBe("consume");
  });

  test("the span kind beats the legacy messaging.operation (confluent-kafka's 'receive' on producers)", () => {
    expect(directionOf({ "messaging.operation": "receive" }, PRODUCER)).toBe(
      "publish",
    );
    expect(directionOf({ "messaging.operation": "publish" }, CONSUMER)).toBe(
      "consume",
    );
  });

  test("the legacy operation beats the operation name", () => {
    expect(
      directionOf(
        {
          "messaging.operation": "settle",
          "messaging.operation.name": "send",
        },
        CLIENT,
      ),
    ).toBe("settle");
  });

  test.each([
    // The Google Cloud Pub/Sub clients' ack RPC spans (OpenTelemetryPubsubTracer).
    ["ack", "settle"],
    ["modack", "settle"],
    ["nack", "settle"],
    ["ACK", "settle"],
    ["subscribe", "consume"],
    ["poll", "consume"],
    ["schedule", "publish"],
  ])(
    "an operation NAME in the legacy messaging.operation key (%s) → %s",
    (operation: string, direction: string) => {
      expect(directionOf({ "messaging.operation": operation }, CLIENT)).toBe(
        direction,
      );
    },
  );

  test("the legacy key's operation name still yields to the span kind and the operation type", () => {
    expect(directionOf({ "messaging.operation": "ack" }, PRODUCER)).toBe(
      "publish",
    );
    expect(
      directionOf(
        {
          "messaging.operation": "ack",
          "messaging.operation.type": "receive",
        },
        CLIENT,
      ),
    ).toBe("consume");
    // ...and beats messaging.operation.name, as the legacy type does.
    expect(
      directionOf(
        {
          "messaging.operation": "ack",
          "messaging.operation.name": "send",
        },
        CLIENT,
      ),
    ).toBe("settle");
  });

  test("a Java Pub/Sub ack span settles its subscription, which is its consumer group", () => {
    expect(
      resolveSpan(
        {
          "messaging.system": "gcp_pubsub",
          "messaging.destination.name": "orders-billing",
          "gcp.project_id": "shop-prod",
          "code.function": "sendAckOperations",
          "messaging.operation": "ack",
          "messaging.batch.message_count": 3,
        },
        CLIENT,
      ),
    ).toEqual(
      destinationOf({
        system: "gcp_pubsub",
        destination: "orders-billing",
        direction: "settle",
        consumerGroup: "orders-billing",
      }),
    );
  });

  test.each([
    ["send", "publish"],
    ["publish", "publish"],
    ["schedule", "publish"],
    ["publish_input", "publish"],
    ["publish_batch_input", "publish"],
    ["create", "publish"],
    ["event", "publish"],
    ["poll", "consume"],
    ["receive", "consume"],
    ["fetch", "consume"],
    ["fetch (empty)", "consume"],
    ["peek", "consume"],
    ["receive_deferred", "consume"],
    ["subscribe", "consume"],
    ["deliver", "consume"],
    ["consume", "consume"],
    ["process", "consume"],
    ["ack", "settle"],
    ["nack", "settle"],
    ["modack", "settle"],
    ["reject", "settle"],
    ["complete", "settle"],
    ["abandon", "settle"],
    ["defer", "settle"],
    ["dead_letter", "settle"],
    ["delete", "settle"],
    ["commit", "settle"],
    ["checkpoint", "settle"],
    ["term", "settle"],
    ["nak", "settle"],
    ["in-progress", "settle"],
    ["Checkpoint", "settle"],
    ["renew_message_lock", "unknown"],
    ["get_partition_properties", "unknown"],
  ])("messaging.operation.name %j → %s", (value: string, direction: string) => {
    expect(directionOf({ "messaging.operation.name": value }, CLIENT)).toBe(
      direction,
    );
  });

  test("the operation name beats the AWS rpc.method", () => {
    expect(
      directionOf(
        {
          "messaging.operation.name": "receive",
          "rpc.method": "SendMessage",
        },
        CLIENT,
        "aws_sqs",
      ),
    ).toBe("consume");
  });

  test.each([
    ["SendMessage", "publish"],
    ["SendMessageBatch", "publish"],
    ["Publish", "publish"],
    ["PublishBatch", "publish"],
    ["ReceiveMessage", "consume"],
    ["DeleteMessage", "settle"],
    ["DeleteMessageBatch", "settle"],
    ["ChangeMessageVisibility", "settle"],
    ["ChangeMessageVisibilityBatch", "settle"],
    ["SQS/SendMessage", "publish"],
    ["SNS/Publish", "publish"],
    ["sqs/receivemessage", "consume"],
    ["GetQueueAttributes", "unknown"],
    ["ListQueues", "unknown"],
  ])("AWS rpc.method %s → %s", (method: string, direction: string) => {
    expect(directionOf({ "rpc.method": method }, CLIENT, "aws_sqs")).toBe(
      direction,
    );
    expect(directionOf({ "rpc.method": method }, CLIENT, "aws.sns")).toBe(
      direction,
    );
  });

  test("rpc.method means nothing outside SQS and SNS", () => {
    expect(directionOf({ "rpc.method": "SendMessage" }, CLIENT)).toBe(
      "unknown",
    );
  });

  test("an unknown value falls through to the next piece of evidence", () => {
    expect(
      directionOf(
        {
          "messaging.operation.type": "custom",
          "messaging.operation": "whatever",
          "messaging.operation.name": "ack",
        },
        CLIENT,
      ),
    ).toBe("settle");
    expect(
      directionOf({ "messaging.operation.type": "custom" }, CONSUMER),
    ).toBe("consume");
  });

  test("a CLIENT or INTERNAL span with no evidence is unknown", () => {
    expect(directionOf({}, CLIENT)).toBe("unknown");
    expect(directionOf({}, INTERNAL)).toBe("unknown");
    expect(directionOf({}, null)).toBe("unknown");
  });
});

describe("consumer group precedence (display only)", () => {
  function groupOf(
    attributes: FixtureAttributes,
    system: string = "kafka",
    kind: string = CONSUMER,
    destination: string = "orders",
  ): string | null | undefined {
    return resolveSpan(
      {
        "messaging.system": system,
        "messaging.destination.name": destination,
        ...attributes,
      },
      kind,
    )?.consumerGroup;
  }

  test("each key in order: 1.27+, Kafka 1.17-1.26, Kafka ≤1.16, RocketMQ, Event Hubs, Service Bus, the Azure Java SDK's metrics", () => {
    const attributes: FixtureAttributes = {};
    MESSAGING_CONSUMER_GROUP_ATTRIBUTES.forEach(
      (key: string, index: number): void => {
        attributes[key] = `g${index}`;
      },
    );
    const seen: Array<string | null | undefined> = [];
    for (const key of MESSAGING_CONSUMER_GROUP_ATTRIBUTES) {
      seen.push(groupOf(attributes));
      delete attributes[key];
    }
    expect(seen).toEqual(["g0", "g1", "g2", "g3", "g4", "g5", "g6", "g7"]);
    expect(groupOf(attributes)).toBeNull();
  });

  test("an attribute beats the Service Bus entity path", () => {
    expect(
      groupOf(
        { "messaging.destination.subscription.name": "from-attribute" },
        "servicebus",
        CONSUMER,
        "order-events/Subscriptions/from-path",
      ),
    ).toBe("from-attribute");
    expect(
      groupOf(
        {},
        "servicebus",
        CONSUMER,
        "order-events/Subscriptions/from-path",
      ),
    ).toBe("from-path");
  });

  test("a Pub/Sub consumer's destination is its subscription; a publisher has none", () => {
    expect(groupOf({}, "gcp_pubsub", CONSUMER, "billing-sub")).toBe(
      "billing-sub",
    );
    expect(
      groupOf(
        { "messaging.operation.name": "modack" },
        "gcp_pubsub",
        CLIENT,
        "billing-sub",
      ),
    ).toBe("billing-sub");
    expect(groupOf({}, "gcp_pubsub", PRODUCER, "orders")).toBeNull();
    expect(groupOf({}, "gcp_pubsub", CLIENT, "orders")).toBeNull();
  });

  test("the per-instance consumer id is never read", () => {
    expect(
      groupOf({
        "messaging.consumer_id": "billing - consumer-1",
        "messaging.consumer.id": "billing - consumer-1",
      }),
    ).toBeNull();
  });

  test("a consumer group is trimmed and clamped to 255 characters", () => {
    expect(groupOf({ "messaging.consumer.group.name": "  billing  " })).toBe(
      "billing",
    );
    expect(
      groupOf({ "messaging.consumer.group.name": "g".repeat(300) })?.length,
    ).toBe(255);
  });
});

describe("hasMessagingTrigger", () => {
  test.each(
    MESSAGING_TRIGGER_ATTRIBUTES.map((key: string): [string] => {
      return [key];
    }),
  )("%s alone makes a candidate", (key: string) => {
    expect(hasMessagingTrigger({ [key]: "x" })).toBe(true);
  });

  test("no trigger key, no candidate", () => {
    expect(
      hasMessagingTrigger({
        "http.request.method": "GET",
        "server.address": "api.example.com",
        "messaging.operation": "publish",
        "messaging.destination.template": "orders.{id}",
        "rpc.system": "aws-api",
        "resource.messaging.system": "kafka",
      }),
    ).toBe(false);
    expect(hasMessagingTrigger({})).toBe(false);
  });

  test.each([
    ["", false],
    ["   ", false],
    ["\t\n", false],
    ["kafka", true],
    [" kafka ", true],
    [0, true],
    [42, true],
    [Number.NaN, false],
    [Number.POSITIVE_INFINITY, false],
    [true, true],
    [false, true],
    [[], true],
    [["kafka"], true],
    [null, false],
    [undefined, false],
    [{ nested: "kafka" }, false],
  ])(
    "a messaging.system value of %j is a trigger: %s",
    (value: unknown, expected: boolean) => {
      expect(hasMessagingTrigger({ "messaging.system": value })).toBe(expected);
    },
  );

  test.each([[null], [undefined], ["messaging.system"], [42], [true]])(
    "a non-object (%j) is never a candidate",
    (value: unknown) => {
      expect(hasMessagingTrigger(value as Record<string, unknown> | null)).toBe(
        false,
      );
    },
  );

  test("only own keys count", () => {
    const inherited: Record<string, unknown> = Object.create({
      "messaging.system": "kafka",
    }) as Record<string, unknown>;
    expect(hasMessagingTrigger(inherited)).toBe(false);
  });

  test("it agrees with the resolver's own gate on every fixture", () => {
    for (const fixture of SPAN_FIXTURES) {
      if (!hasMessagingTrigger(fixture.attributes)) {
        expect({
          name: fixture.name,
          resolved: resolveSpan(fixture.attributes, fixture.kind),
        }).toEqual({ name: fixture.name, resolved: null });
      }
    }
  });

  test("it never enumerates the map, touches only trigger keys, and stops at the first hit", () => {
    const ownKeysCalls: Array<string> = [];
    const touched: Array<string> = [];
    const target: Record<string, unknown> = {
      "messaging.destination.name": "orders",
      "messaging.system": "kafka",
      "http.request.method": "GET",
    };
    const proxy: Record<string, unknown> = new Proxy(target, {
      ownKeys: (object: Record<string, unknown>): Array<string | symbol> => {
        ownKeysCalls.push("ownKeys");
        return Reflect.ownKeys(object);
      },
      get: (object: Record<string, unknown>, key: string | symbol): unknown => {
        touched.push(String(key));
        return Reflect.get(object, key);
      },
      getOwnPropertyDescriptor: (
        object: Record<string, unknown>,
        key: string | symbol,
      ): PropertyDescriptor | undefined => {
        touched.push(String(key));
        return Reflect.getOwnPropertyDescriptor(object, key);
      },
      has: (object: Record<string, unknown>, key: string | symbol): boolean => {
        touched.push(String(key));
        return Reflect.has(object, key);
      },
    });

    expect(hasMessagingTrigger(proxy)).toBe(true);
    expect(ownKeysCalls).toEqual([]);
    for (const key of touched) {
      expect(MESSAGING_TRIGGER_ATTRIBUTES).toContain(key);
    }
    // messaging.system is checked first, and it is a hit.
    expect(new Set(touched)).toEqual(new Set<string>(["messaging.system"]));
  });

  test("a row with thousands of unrelated keys is still a handful of lookups", () => {
    const row: Record<string, unknown> = {};
    for (let index: number = 0; index < 5000; index++) {
      row[`attribute.${index}`] = `value-${index}`;
    }
    let lookups: number = 0;
    const proxy: Record<string, unknown> = new Proxy(row, {
      getOwnPropertyDescriptor: (
        object: Record<string, unknown>,
        key: string | symbol,
      ): PropertyDescriptor | undefined => {
        lookups++;
        return Reflect.getOwnPropertyDescriptor(object, key);
      },
    });
    expect(hasMessagingTrigger(proxy)).toBe(false);
    expect(lookups).toBe(MESSAGING_TRIGGER_ATTRIBUTES.length);
  });
});

describe("the resolver reads cheaply and never throws", () => {
  test("a span with no trigger is rejected after reading only the trigger keys", () => {
    const reads: Set<string> = new Set<string>();
    expect(
      resolveRecordingReads(
        {
          "http.request.method": "GET",
          "server.address": "api.example.com",
          "rpc.system": "aws-api",
          "rpc.service": "SQS",
        },
        CLIENT,
        reads,
      ),
    ).toBeNull();
    expect([...reads]).toEqual([...MESSAGING_TRIGGER_ATTRIBUTES]);
  });

  test("a SERVER span is rejected before any attribute is read", () => {
    const reads: Set<string> = new Set<string>();
    expect(
      resolveRecordingReads(
        { "messaging.system": "kafka", "messaging.destination.name": "x" },
        SERVER,
        reads,
      ),
    ).toBeNull();
    expect(reads.size).toBe(0);
  });

  test("bad input is null, never an exception", () => {
    expect(
      resolveMessagingSpan(
        null as unknown as { getAttribute: (key: string) => unknown },
      ),
    ).toBeNull();
    expect(
      resolveMessagingSpan({
        getAttribute: "nope" as unknown as (key: string) => unknown,
      }),
    ).toBeNull();
  });

  test("any mix of attribute values resolves or is null, without throwing", () => {
    // A deterministic pseudo-random walk over every input key.
    let seed: number = 20260930;
    const next: () => number = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const values: Array<unknown> = [
      "",
      " ",
      "kafka",
      "servicebus",
      "aws_sqs",
      "rabbitmq",
      "<default>",
      "amq.default",
      "orders",
      "a:b:c",
      ",x",
      "[",
      "[]",
      '["a"]',
      "https://",
      "https://x/1/q",
      "arn:",
      "arn:aws:sns:::",
      "sb://",
      "@",
      ":",
      "::",
      "[::",
      "true",
      "Microsoft.ServiceBus",
      "aws-api",
      "SQS",
      0,
      -1,
      Number.NaN,
      true,
      false,
      null,
      undefined,
      [],
      ["a", 1],
      {},
      Symbol("s"),
      (): string => {
        return "fn";
      },
    ];
    const kinds: Array<string | null> = [
      PRODUCER,
      CONSUMER,
      CLIENT,
      INTERNAL,
      null,
    ];
    for (let round: number = 0; round < 2000; round++) {
      const attributes: FixtureAttributes = {};
      for (const key of MESSAGING_RESOLVER_INPUT_ATTRIBUTES) {
        if (next() < 0.3) {
          attributes[key] = values[Math.floor(next() * values.length)];
        }
      }
      const kind: string | null =
        kinds[Math.floor(next() * kinds.length)] ?? null;
      let threw: boolean = false;
      let resolved: ResolvedMessagingDestination | null = null;
      try {
        resolved = resolveSpan(attributes, kind);
      } catch {
        threw = true;
      }
      expect({ round, threw }).toEqual({ round, threw: false });
      if (resolved !== null) {
        const destination: ResolvedMessagingDestination = resolved;
        expect(destination.destination.length).toBeGreaterThan(0);
        expect(destination.destination.length).toBeLessThanOrEqual(
          MESSAGE_QUEUE_DESTINATION_MAX_LENGTH,
        );
        expect(destination.destination).toBe(destination.destination.trim());
        expect(["publish", "consume", "settle", "unknown"]).toContain(
          destination.direction,
        );
      }
    }
  });
});

describe("MESSAGING_ADDRESS_ATTRIBUTES shape", () => {
  test("every port key pairs with its own address generation", () => {
    for (const attribute of MESSAGING_ADDRESS_ATTRIBUTES) {
      const pair: MessagingAddressAttribute = attribute;
      if (pair.port) {
        expect(pair.port.split(".").slice(0, -1).join(".")).toBe(
          pair.address.split(".").slice(0, -1).join("."),
        );
      }
    }
  });
});
