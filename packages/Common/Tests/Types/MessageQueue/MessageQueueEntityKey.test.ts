import {
  computeEntityKey,
  keyForDatabaseEndpoint,
  keyForMessageQueue,
  keyForService,
  MESSAGE_QUEUE_BROKER_SCOPE_IDENTITY_ATTRIBUTE,
} from "../../../Utils/Telemetry/EntityKey";
import EntityType from "../../../Types/Telemetry/EntityType";
import {
  buildMessageQueueIdentifier,
  MessageQueueIdentity,
  parseMessageQueueIdentifier,
  toMessageQueueIdentity,
} from "../../../Types/MessageQueue/MessageQueueIdentity";
import {
  ResolvedMessagingDestination,
  resolveMessagingMetricDatapoint,
  resolveMessagingSpan,
} from "../../../Types/MessageQueue/MessagingTelemetryResolver";
import {
  CLIENT,
  CONSUMER,
  FixtureAttributes,
  INTERNAL,
  PRODUCER,
  SPAN_FIXTURES,
} from "./MessagingTelemetryFixtures";
import { describe, expect, test } from "@jest/globals";
import { createHash } from "crypto";

const PROJECT: string = "5f2b7c1e-8d3a-4b6f-9c0d-1e2f3a4b5c6d";

/*
 * Independent reimplementation of the documented preimage, so these tests
 * break if the key construction ever silently changes (a read-side key that
 * does not byte-match the ingest stamp finds nothing).
 */
function expectedKey(
  projectId: string,
  identifyingAttributes: Record<string, string>,
): string {
  const escape: (token: string) => string = (token: string): string => {
    return token.replace(/([\\|=])/g, "\\$1");
  };
  const parts: Array<string> = Object.keys(identifyingAttributes)
    .sort()
    .map((key: string): string => {
      return `${escape(key)}=${escape(
        identifyingAttributes[key]!.trim().toLowerCase(),
      )}`;
    });
  return createHash("sha256")
    .update(`${projectId}|message.queue|${parts.join("|")}`)
    .digest("hex")
    .slice(0, 16);
}

function spanKey(
  attributes: FixtureAttributes,
  kind: string | null,
): string | null {
  const resolved: ResolvedMessagingDestination | null = resolveMessagingSpan({
    getAttribute: (key: string): unknown => {
      return attributes[key];
    },
    kind,
  });
  const identity: MessageQueueIdentity | null = resolved
    ? toMessageQueueIdentity(resolved)
    : null;
  return identity ? keyForMessageQueue(PROJECT, identity) : null;
}

function metricKey(
  metricName: string,
  attributes: FixtureAttributes,
): string | null {
  const resolved: ResolvedMessagingDestination | null =
    resolveMessagingMetricDatapoint({
      metricName,
      getAttribute: (key: string): unknown => {
        return attributes[key];
      },
    });
  const identity: MessageQueueIdentity | null = resolved
    ? toMessageQueueIdentity(resolved)
    : null;
  return identity ? keyForMessageQueue(PROJECT, identity) : null;
}

describe("keyForMessageQueue", () => {
  test("is the message.queue entity type, keyed on system + destination (+ broker scope)", () => {
    expect(EntityType.MessageQueue).toBe("message.queue");
    expect(MESSAGE_QUEUE_BROKER_SCOPE_IDENTITY_ATTRIBUTE).toBe(
      "oneuptime.messaging.broker.scope",
    );
    expect(
      keyForMessageQueue(PROJECT, {
        system: "kafka",
        brokerScope: "",
        destination: "orders",
      }),
    ).toBe(
      expectedKey(PROJECT, {
        "messaging.system": "kafka",
        "messaging.destination.name": "orders",
      }),
    );
    expect(
      keyForMessageQueue(PROJECT, {
        system: "servicebus",
        brokerScope: "orders-prod",
        destination: "orders",
      }),
    ).toBe(
      expectedKey(PROJECT, {
        "messaging.system": "servicebus",
        "messaging.destination.name": "orders",
        "oneuptime.messaging.broker.scope": "orders-prod",
      }),
    );
  });

  test("is the computeEntityKey of those identifying attributes", () => {
    expect(
      keyForMessageQueue(PROJECT, {
        system: "servicebus",
        brokerScope: "orders-prod",
        destination: "orders",
      }),
    ).toBe(
      computeEntityKey({
        projectId: PROJECT,
        entityType: EntityType.MessageQueue,
        identifyingAttributes: {
          "messaging.system": "servicebus",
          "messaging.destination.name": "orders",
          "oneuptime.messaging.broker.scope": "orders-prod",
        },
      }),
    );
  });

  test("golden values: these exact keys are stamped in ClickHouse rows", () => {
    expect(
      keyForMessageQueue(PROJECT, {
        system: "kafka",
        brokerScope: "",
        destination: "orders",
      }),
    ).toBe("b976d4da1c2134e4");
    expect(
      keyForMessageQueue(PROJECT, {
        system: "servicebus",
        brokerScope: "orders-prod",
        destination: "orders",
      }),
    ).toBe("1dfb6b7e121de7e2");
    expect(
      keyForMessageQueue(PROJECT, {
        system: "aws_sqs",
        brokerScope: "",
        destination: "payments",
      }),
    ).toBe("4cc568603ddac9e4");
    expect(
      keyForMessageQueue(PROJECT, {
        system: "pulsar",
        brokerScope: "",
        destination: "persistent://public/default/orders",
      }),
    ).toBe("c84bee99821a56d4");
  });

  test("values are canonicalized: casing and surrounding whitespace never fork a key", () => {
    const key: string = keyForMessageQueue(PROJECT, {
      system: "servicebus",
      brokerScope: "orders-prod",
      destination: "orders",
    });
    expect(
      keyForMessageQueue(PROJECT, {
        system: " ServiceBus ",
        brokerScope: " ORDERS-PROD ",
        destination: "  Orders  ",
      }),
    ).toBe(key);
  });

  test("a blank scope is no scope: the two-attribute key", () => {
    const unscoped: string = keyForMessageQueue(PROJECT, {
      system: "kafka",
      destination: "orders",
    });
    for (const brokerScope of ["", "   ", null, undefined]) {
      expect(
        keyForMessageQueue(PROJECT, {
          system: "kafka",
          brokerScope,
          destination: "orders",
        }),
      ).toBe(unscoped);
    }
    expect(unscoped).toBe("b976d4da1c2134e4");
  });

  test("the scope, the destination, the system and the project each change the key", () => {
    const base: string = keyForMessageQueue(PROJECT, {
      system: "servicebus",
      brokerScope: "ns1",
      destination: "orders",
    });
    for (const other of [
      keyForMessageQueue(PROJECT, {
        system: "servicebus",
        brokerScope: "ns2",
        destination: "orders",
      }),
      keyForMessageQueue(PROJECT, {
        system: "servicebus",
        brokerScope: "",
        destination: "orders",
      }),
      keyForMessageQueue(PROJECT, {
        system: "servicebus",
        brokerScope: "ns1",
        destination: "payments",
      }),
      keyForMessageQueue(PROJECT, {
        system: "eventhubs",
        brokerScope: "ns1",
        destination: "orders",
      }),
      keyForMessageQueue("another-project", {
        system: "servicebus",
        brokerScope: "ns1",
        destination: "orders",
      }),
    ]) {
      expect(other).not.toBe(base);
    }
  });

  test("a destination containing separators cannot smuggle a scope", () => {
    expect(
      keyForMessageQueue(PROJECT, {
        system: "servicebus",
        brokerScope: "",
        destination: "orders|oneuptime.messaging.broker.scope=ns1",
      }),
    ).not.toBe(
      keyForMessageQueue(PROJECT, {
        system: "servicebus",
        brokerScope: "ns1",
        destination: "orders",
      }),
    );
  });

  test("never equals another entity type's key over the same values", () => {
    const key: string = keyForMessageQueue(PROJECT, {
      system: "kafka",
      destination: "orders",
    });
    expect(key).not.toBe(keyForService(PROJECT, "orders"));
    expect(key).not.toBe(
      keyForDatabaseEndpoint(PROJECT, { host: "orders", port: null }),
    );
    expect(key).toMatch(/^[0-9a-f]{16}$/);
  });

  test("takes a canonical identity as is: the identity module folds aliases, the key does not", () => {
    expect(
      keyForMessageQueue(PROJECT, {
        system: "AmazonSQS",
        destination: "payments",
      }),
    ).not.toBe("4cc568603ddac9e4");
    const identity: MessageQueueIdentity = toMessageQueueIdentity({
      system: "AmazonSQS",
      destination: "Payments",
    })!;
    expect(keyForMessageQueue(PROJECT, identity)).toBe("4cc568603ddac9e4");
  });

  test("a row's stored identifier gives back the key ingest stamped", () => {
    for (const fixture of SPAN_FIXTURES) {
      if (!fixture.expected) {
        continue;
      }
      const identity: MessageQueueIdentity = toMessageQueueIdentity(
        fixture.expected,
      )!;
      const parsed: MessageQueueIdentity | null = parseMessageQueueIdentifier(
        buildMessageQueueIdentifier(identity),
      );
      expect(keyForMessageQueue(PROJECT, parsed!)).toBe(
        keyForMessageQueue(PROJECT, identity),
      );
    }
  });
});

/*
 * One queue seen by its broker and by its applications: the broker metric
 * must resolve (two sightings that both resolve to nothing share a "key"
 * too, and prove nothing), and every span must land on its key.
 */
function expectOneQueue(
  fromMetric: string | null,
  fromSpans: ReadonlyArray<string | null>,
): void {
  expect(fromMetric).not.toBeNull();
  expect(fromMetric).toMatch(/^[0-9a-f]{16}$/);
  expect(fromSpans.length).toBeGreaterThan(0);
  for (const fromSpan of fromSpans) {
    expect(fromSpan).toBe(fromMetric);
  }
}

describe("a queue's spans and its broker metrics land on the same key", () => {
  test("Azure Service Bus: the SDK's namespace host joins Azure Monitor's `name`", () => {
    const fromMetric: string | null = metricKey(
      "azure_activemessages_average",
      {
        name: "orders-prod",
        type: "Microsoft.ServiceBus/Namespaces",
        metadata_entityname: "orders",
      },
    );
    expect(fromMetric).toBe("1dfb6b7e121de7e2");
    for (const [attributes, kind] of [
      [
        {
          "messaging.system": "servicebus",
          "messaging.operation": "publish",
          "server.address": "orders-prod.servicebus.windows.net",
          "messaging.destination.name": "orders",
        },
        CLIENT,
      ],
      [
        {
          "messaging.system": "servicebus",
          "messaging.destination.name": "orders/$DeadLetterQueue",
          "server.address": "ORDERS-PROD.servicebus.windows.net",
        },
        CLIENT,
      ],
      [
        {
          component: "servicebus",
          "peer.address": "sb://orders-prod.servicebus.windows.net/",
          "message_bus.destination": "Orders",
        },
        PRODUCER,
      ],
      [
        {
          "messaging.system": "azure_servicebus",
          "messaging.source.name": "orders",
          "net.peer.name": "orders-prod.servicebus.windows.net",
        },
        CONSUMER,
      ],
    ] as Array<[FixtureAttributes, string]>) {
      expect(spanKey(attributes, kind)).toBe(fromMetric);
    }
  });

  test("Azure Service Bus: a subscription's spans join its topic's metrics", () => {
    expectOneQueue(
      metricKey("azure_incomingmessages_total", {
        name: "orders-prod",
        type: "Microsoft.ServiceBus/namespaces",
        metadata_EntityName: "Order-Events",
      }),
      [
        spanKey(
          {
            "messaging.system": "servicebus",
            "messaging.destination.name":
              "order-events/Subscriptions/billing/$DeadLetterQueue",
            "server.address": "orders-prod.servicebus.windows.net",
          },
          CLIENT,
        ),
      ],
    );
  });

  test("Azure Service Bus: the Java SDK's own metric joins the queue, though it names no system", () => {
    expectOneQueue(
      metricKey("messaging.servicebus.messages.sent", {
        "server.address": "orders-prod.servicebus.windows.net",
        "messaging.destination.name": "orders",
      }),
      [
        spanKey(
          {
            "messaging.system": "servicebus",
            "messaging.operation": "publish",
            "server.address": "orders-prod.servicebus.windows.net",
            "messaging.destination.name": "orders",
          },
          CLIENT,
        ),
        metricKey("azure_activemessages_average", {
          name: "orders-prod",
          type: "Microsoft.ServiceBus/namespaces",
          metadata_entityname: "orders",
        }),
      ],
    );
  });

  test("Azure Event Hubs", () => {
    expectOneQueue(
      metricKey("azure_outgoingmessages_total", {
        name: "ingest-prod",
        type: "Microsoft.EventHub/namespaces",
        metadata_entityname: "telemetry",
      }),
      [
        spanKey(
          {
            "messaging.system": "eventhubs",
            "messaging.destination.name":
              "telemetry/ConsumerGroups/$Default/Partitions/0",
            "server.address": "ingest-prod.servicebus.windows.net",
          },
          CONSUMER,
        ),
      ],
    );
  });

  test("RabbitMQ: a default-exchange publish joins the queue's receiver metrics", () => {
    const fromMetric: string | null = metricKey("rabbitmq.message.current", {
      "resource.rabbitmq.queue.name": "orders",
      "resource.rabbitmq.vhost.name": "/",
      state: "ready",
    });
    expect(fromMetric).not.toBeNull();
    for (const [attributes, kind] of [
      [
        {
          "messaging.system": "rabbitmq",
          "messaging.destination.name": "<default>",
          "messaging.rabbitmq.destination.routing_key": "orders",
        },
        PRODUCER,
      ],
      [
        {
          "messaging.system": "rabbitmq",
          "messaging.destination.name": "amq.default",
          "messaging.rabbitmq.destination.routing_key": "orders",
        },
        PRODUCER,
      ],
      [
        {
          "messaging.system": "rabbitmq",
          "messaging.destination": "",
          "messaging.rabbitmq.routing_key": "orders",
        },
        PRODUCER,
      ],
      [
        {
          "messaging.system": "rabbitmq",
          "messaging.destination.name": "direct:orders:orders",
          "messaging.rabbitmq.destination.routing_key": "orders",
        },
        CONSUMER,
      ],
    ] as Array<[FixtureAttributes, string]>) {
      expect(spanKey(attributes, kind)).toBe(fromMetric);
    }
  });

  test("RabbitMQ: a consumer's semconv 1.30 name joins its queue's receiver metrics", () => {
    const queueDepth: (queue: string) => string | null = (
      queue: string,
    ): string | null => {
      return metricKey("rabbitmq.message.current", {
        "resource.rabbitmq.queue.name": queue,
        "resource.rabbitmq.vhost.name": "/",
        state: "ready",
      });
    };
    // The queue equals the routing key, so the name leaves it out.
    expectOneQueue(queueDepth("warning"), [
      spanKey(
        {
          "messaging.system": "rabbitmq",
          "messaging.destination.name": "direct_logs:warning",
          "messaging.rabbitmq.destination.routing_key": "warning",
          "messaging.operation.type": "process",
        },
        CONSUMER,
      ),
      metricKey("messaging.process.duration", {
        "messaging.system": "rabbitmq",
        "messaging.destination.name": "direct_logs:warning",
        "messaging.operation.type": "process",
      }),
    ]);
    // A fanout exchange: the empty routing key is left out.
    expectOneQueue(queueDepth("logs-audit"), [
      spanKey(
        {
          "messaging.system": "rabbitmq",
          "messaging.destination.name": "logs:logs-audit",
          "messaging.operation.type": "process",
        },
        CONSUMER,
      ),
    ]);
  });

  test("RabbitMQ: two MassTransit message types in one namespace are two queues", () => {
    const submitted: string | null = spanKey(
      {
        "messaging.system": "rabbitmq",
        "messaging.operation": "send",
        "messaging.destination.name": "MyApp.Contracts:OrderSubmitted",
      },
      PRODUCER,
    );
    const cancelled: string | null = spanKey(
      {
        "messaging.system": "rabbitmq",
        "messaging.operation": "send",
        "messaging.destination.name": "MyApp.Contracts:OrderCancelled",
      },
      PRODUCER,
    );
    expect(submitted).not.toBeNull();
    expect(cancelled).not.toBeNull();
    expect(submitted).not.toBe(cancelled);
    // ...and RabbitMQ.Client v7's deliver of the first names the same exchange.
    expect(
      spanKey(
        {
          "messaging.system": "rabbitmq",
          "network.protocol.name": "amqp",
          "messaging.operation.type": "process",
          "messaging.destination.name": "MyApp.Contracts:OrderSubmitted",
          "messaging.rabbitmq.destination.routing_key": "",
        },
        CONSUMER,
      ),
    ).toBe(submitted);
  });

  test("RabbitMQ: MassTransit's Fault<T> exchanges are one queue each, never their message type's last segment", () => {
    const send: (exchange: string) => string | null = (
      exchange: string,
    ): string | null => {
      return spanKey(
        {
          "messaging.system": "rabbitmq",
          "messaging.operation": "send",
          "messaging.destination.name": exchange,
        },
        PRODUCER,
      );
    };
    const billing: string | null = send(
      "MassTransit:Fault--Billing.Contracts:SubmitOrder--",
    );
    const sales: string | null = send(
      "MassTransit:Fault--Sales.Contracts:SubmitOrder--",
    );
    const jobCompleted: string | null = send(
      "MassTransit.Contracts.JobService:JobCompleted--MyApp.Jobs:ConvertVideo--",
    );
    const jobFaulted: string | null = send(
      "MassTransit:Fault--MyApp.Jobs:ConvertVideo--",
    );
    for (const key of [billing, sales, jobCompleted, jobFaulted]) {
      expect(key).not.toBeNull();
    }
    expect(new Set([billing, sales, jobCompleted, jobFaulted]).size).toBe(4);
    // Not the phantom queues the last segments would name.
    expect(billing).not.toBe(send("SubmitOrder--"));
    expect(jobFaulted).not.toBe(send("ConvertVideo--"));
    // The .NET client's deliver of the fault names the same exchange.
    expect(
      spanKey(
        {
          "messaging.system": "rabbitmq",
          "network.protocol.name": "amqp",
          "messaging.operation.type": "process",
          "messaging.destination.name":
            "MassTransit:Fault--Billing.Contracts:SubmitOrder--",
          "messaging.rabbitmq.destination.routing_key": "",
        },
        CONSUMER,
      ),
    ).toBe(billing);
  });

  test("Apache Kafka", () => {
    expectOneQueue(
      metricKey("kafka.consumer_group.lag_sum", {
        group: "billing",
        topic: "payments",
      }),
      [
        spanKey(
          {
            "messaging.system": "kafka",
            "messaging.destination.name": "payments",
          },
          PRODUCER,
        ),
      ],
    );
  });

  test("Amazon SQS: a queue URL, an ARN and a name join both CloudWatch shapes", () => {
    const fromPull: string | null = metricKey(
      "amazonaws.com/aws/sqs/approximatenumberofmessagesvisible",
      { "Dimensions.QueueName": "payments" },
    );
    const fromJsonStream: string | null = metricKey(
      "approximatenumberofmessagesvisible",
      { "resource.service.name": "SQS", QueueName: "payments" },
    );
    expect(fromPull).toBe("4cc568603ddac9e4");
    expect(fromJsonStream).toBe(fromPull);
    for (const attributes of [
      {
        "messaging.system": "aws_sqs",
        "server.address":
          "https://sqs.us-west-2.amazonaws.com/123456789012/payments",
        "rpc.method": "SQS/SendMessage",
      },
      {
        "messaging.system": "AmazonSQS",
        "messaging.destination.name": "payments",
      },
      {
        "messaging.system": "aws.sqs",
        "messaging.url":
          "https://sqs.us-west-2.amazonaws.com/123456789012/payments",
      },
      {
        "messaging.system": "aws_sqs",
        "messaging.destination.name":
          "arn:aws:sqs:us-west-2:123456789012:payments",
      },
      {
        "aws.queue_url":
          "https://sqs.us-west-2.amazonaws.com/123456789012/payments",
        "rpc.system": "aws-api",
        "rpc.service": "SQS",
      },
    ] as Array<FixtureAttributes>) {
      expect(spanKey(attributes, CLIENT)).toBe(fromPull);
    }
  });

  test("Amazon SNS: a topic ARN joins CloudWatch's TopicName", () => {
    expectOneQueue(
      metricKey("amazonaws.com/aws/sns/numberofmessagespublished", {
        "Dimensions.TopicName": "order-events",
      }),
      [
        spanKey(
          {
            "rpc.system": "aws-api",
            "rpc.service": "Sns",
            "rpc.method": "Publish",
            "messaging.destination.name":
              "arn:aws:sns:us-east-1:123456789012:order-events",
          },
          CLIENT,
        ),
      ],
    );
  });

  test("Google Cloud Pub/Sub: a subscriber joins its subscription, a publisher its topic", () => {
    expectOneQueue(
      metricKey("pubsub.googleapis.com/subscription/num_undelivered_messages", {
        "resource.subscription_id": "billing-sub",
      }),
      [
        spanKey(
          {
            "messaging.system": "gcp_pubsub",
            "messaging.destination.name": "billing-sub",
          },
          CONSUMER,
        ),
        // The Java client's ack span, direction in the legacy key.
        spanKey(
          {
            "messaging.system": "gcp_pubsub",
            "messaging.destination.name": "billing-sub",
            "messaging.operation": "ack",
          },
          CLIENT,
        ),
      ],
    );
    expectOneQueue(
      metricKey("pubsub.googleapis.com/topic/send_request_count", {
        "resource.topic_id": "orders",
      }),
      [
        spanKey(
          {
            "messaging.system": "gcp_pubsub",
            "messaging.destination.name": "projects/acme/topics/orders",
          },
          PRODUCER,
        ),
      ],
    );
  });

  test("Apache Pulsar: a partition and a short name join the broker's partitioned series", () => {
    const fromMetric: string | null = metricKey("pulsar_msg_backlog", {
      topic: "persistent://public/default/orders-partition-2",
    });
    expect(fromMetric).toBe("c84bee99821a56d4");
    for (const destination of [
      "orders",
      "orders-partition-0",
      "public/default/orders",
      "persistent://public/default/orders",
    ]) {
      expect(
        spanKey(
          {
            "messaging.system": "pulsar",
            "messaging.destination.name": destination,
          },
          PRODUCER,
        ),
      ).toBe(fromMetric);
    }
  });

  test("Apache ActiveMQ: a client naming the activemq system joins the JMX Scraper's", () => {
    expectOneQueue(
      metricKey("activemq.message.queue.size", {
        "messaging.destination.name": "orders",
        "activemq.broker.name": "b",
      }),
      [
        spanKey(
          {
            "messaging.system": "activemq",
            "messaging.destination.name": "queue://orders",
          },
          PRODUCER,
        ),
        metricKey("activemq.message.current", {
          destination: "orders",
          broker: "b",
        }),
      ],
    );
  });

  test("Apache RocketMQ", () => {
    expectOneQueue(
      metricKey("rocketmq_consumer_lag_messages", {
        topic: "orders",
        consumer_group: "billing",
      }),
      [
        spanKey(
          {
            "messaging.system": "rocketmq",
            "messaging.destination.name": "orders",
          },
          CONSUMER,
        ),
      ],
    );
  });

  test("BullMQ: OneUptime's own worker spans join its queue.size gauge", () => {
    expectOneQueue(
      metricKey("queue.size", {
        "messaging.system": "bullmq",
        "messaging.destination.name": "Workers",
        state: "waiting",
      }),
      [
        spanKey(
          {
            "messaging.system": "bullmq",
            "messaging.destination.name": "Workers",
            "messaging.operation.name": "ProcessJob",
          },
          INTERNAL,
        ),
      ],
    );
  });

  test("semconv client metrics join their spans", () => {
    expectOneQueue(
      metricKey("messaging.client.sent.messages", {
        "messaging.system": "kafka",
        "messaging.destination.name": "payments",
      }),
      [
        spanKey(
          {
            "messaging.system": "kafka",
            "messaging.destination.name": "payments",
          },
          PRODUCER,
        ),
      ],
    );
  });

  test("JMS clients and ActiveMQ's JMX Scraper metrics key together through the identity family", () => {
    /*
     * Java clients say "jms" whatever the broker (no instrumentation emits
     * "activemq"), while the JMX Scraper's metrics are ActiveMQ's. ActiveMQ
     * is keyed on the JMS family, so both sightings of one queue — and a
     * client that does say "activemq", and the scraper's legacy names — are
     * one queue.
     */
    expectOneQueue(
      spanKey(
        {
          "messaging.system": "jms",
          "messaging.destination.name": "orders",
        },
        PRODUCER,
      ),
      [
        metricKey("activemq.message.queue.size", {
          "messaging.destination.name": "orders",
        }),
        metricKey("activemq.message.current", { destination: "orders" }),
        spanKey(
          {
            "messaging.system": "activemq",
            "messaging.destination.name": "orders",
          },
          CONSUMER,
        ),
      ],
    );
    // A different destination is still a different queue.
    expect(
      spanKey(
        {
          "messaging.system": "jms",
          "messaging.destination.name": "orders",
        },
        PRODUCER,
      ),
    ).not.toBe(
      metricKey("activemq.message.queue.size", {
        "messaging.destination.name": "payments",
      }),
    );
  });

  test("known limits: no namespace host and Kafka's protocol against Event Hubs key apart", () => {
    const fromMetric: string | null = metricKey(
      "azure_activemessages_average",
      {
        name: "orders-prod",
        type: "Microsoft.ServiceBus/namespaces",
        metadata_entityname: "orders",
      },
    );
    expect(fromMetric).not.toBeNull();
    // The emulator (or a custom domain) names no namespace.
    const fromEmulator: string | null = spanKey(
      {
        "messaging.system": "servicebus",
        "messaging.destination.name": "orders",
        "server.address": "localhost",
      },
      PRODUCER,
    );
    expect(fromEmulator).not.toBeNull();
    expect(fromEmulator).not.toBe(fromMetric);
    // Kafka clients report "kafka" even against Event Hubs.
    const fromKafkaClient: string | null = spanKey(
      {
        "messaging.system": "kafka",
        "messaging.destination.name": "telemetry",
        "server.address": "ingest-prod.servicebus.windows.net",
      },
      PRODUCER,
    );
    const fromEventHubs: string | null = metricKey(
      "azure_incomingmessages_total",
      {
        name: "ingest-prod",
        type: "Microsoft.EventHub/namespaces",
        metadata_entityname: "telemetry",
      },
    );
    expect(fromKafkaClient).not.toBeNull();
    expect(fromEventHubs).not.toBeNull();
    expect(fromKafkaClient).not.toBe(fromEventHubs);
  });
});
