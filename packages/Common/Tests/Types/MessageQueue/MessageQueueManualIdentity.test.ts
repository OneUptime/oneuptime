import {
  ManualMessageQueue,
  ManualMessageQueueCheck,
  ManualMessageQueueField,
  ManualMessageQueueInput,
  checkManualMessageQueue,
  quoteManualMessageQueueInput,
  resolveManualMessageQueue,
} from "../../../Types/MessageQueue/MessageQueueManualIdentity";
import {
  MessageQueueIdentity,
  buildMessageQueueIdentifier,
  toMessageQueueIdentity,
} from "../../../Types/MessageQueue/MessageQueueIdentity";
import {
  MESSAGE_QUEUE_DESTINATION_MAX_LENGTH,
  ResolvedMessagingDestination,
  resolveMessagingMetricDatapoint,
  resolveMessagingSpan,
} from "../../../Types/MessageQueue/MessagingTelemetryResolver";
import BadDataException from "../../../Types/Exception/BadDataException";
import { describe, expect, test } from "@jest/globals";

/*
 * The identity of a queue a person adds by hand - the one module the
 * server's manual create and the create form's preview share. Pinned here:
 * what each typed system, destination and namespace is stored as, that it
 * is the identity the queue's own telemetry builds, and every refusal, with
 * the field it is about.
 */

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

/*
 * The identifier the rabbitmq receiver's queue depth for `queue` resolves
 * to - what ingest stamps on the datapoint and discovery creates or sights
 * the queue by - in the stored shape (resource keys prefixed).
 */
function rabbitMqBrokerIdentifier(queue: string): string | null {
  const attributes: Record<string, string> = {
    "resource.rabbitmq.node.name": "rabbit@broker-1",
    "resource.rabbitmq.queue.name": queue,
    "resource.rabbitmq.vhost.name": "/",
    state: "ready",
  };
  const resolved: ResolvedMessagingDestination | null =
    resolveMessagingMetricDatapoint({
      metricName: "rabbitmq.message.current",
      getAttribute: (key: string): unknown => {
        return attributes[key];
      },
    });

  return resolved
    ? buildMessageQueueIdentifier(
        identityOf({
          system: resolved.system,
          brokerScope: resolved.brokerScope,
          destination: resolved.destination,
        }),
      )
    : null;
}

function rabbitMq(destinationName: string): ManualMessageQueue {
  return resolveManualMessageQueue({
    messagingSystem: "rabbitmq",
    destinationName: destinationName,
  });
}

function refusalOf(input: ManualMessageQueueInput | null | undefined): {
  field: ManualMessageQueueField;
  message: string;
} {
  const check: ManualMessageQueueCheck = checkManualMessageQueue(input);

  if (check.refusal === null) {
    throw new Error(`accepted: ${JSON.stringify(check.queue)}`);
  }

  return check.refusal;
}

describe("resolveManualMessageQueue", () => {
  test.each([
    // system, destination, scope -> system, destination, scope, identifier
    [
      "kafka",
      "orders.created",
      undefined,
      "kafka",
      "orders.created",
      "",
      "kafka||orders.created",
    ],
    // Casing is kept for display; the identity is canonical.
    [
      "kafka",
      "  Orders.Created  ",
      undefined,
      "kafka",
      "Orders.Created",
      "",
      "kafka||orders.created",
    ],
    // Aliases fold ("AmazonSQS" is how the Java agent up to 2.3 spells it).
    [
      "AmazonSQS",
      "https://sqs.us-east-1.amazonaws.com/123456789012/orders",
      undefined,
      "aws_sqs",
      "orders",
      "",
      "aws_sqs||orders",
    ],
    [" Kafka ", "orders", undefined, "kafka", "orders", "", "kafka||orders"],
    // An SNS topic ARN keys by its name, like the span that published to it.
    [
      "aws.sns",
      "arn:aws:sns:us-east-1:123456789012:order-events",
      undefined,
      "aws.sns",
      "order-events",
      "",
      "aws.sns||order-events",
    ],
    [
      "gcp_pubsub",
      "projects/acme/topics/orders",
      undefined,
      "gcp_pubsub",
      "orders",
      "",
      "gcp_pubsub||orders",
    ],
    // A Pulsar short name is the default tenant's persistent topic.
    [
      "pulsar",
      "orders",
      undefined,
      "pulsar",
      "persistent://public/default/orders",
      "",
      "pulsar||persistent://public/default/orders",
    ],
    [
      "pulsar",
      "persistent://acme/prod/orders-partition-3",
      undefined,
      "pulsar",
      "persistent://acme/prod/orders",
      "",
      "pulsar||persistent://acme/prod/orders",
    ],
    // ActiveMQ keys on the JMS family, so its JMS clients' spans join it.
    [
      "activemq",
      "queue://orders",
      undefined,
      "activemq",
      "orders",
      "",
      "jms||orders",
    ],
    ["jms", "orders", undefined, "jms", "orders", "", "jms||orders"],
    // A Service Bus namespace host is reduced to its namespace, a path to its entity.
    [
      "servicebus",
      "orders/subscriptions/billing",
      "orders-prod.servicebus.windows.net",
      "servicebus",
      "orders",
      "orders-prod",
      "servicebus|orders-prod|orders",
    ],
    [
      "azure_servicebus",
      "orders",
      " Orders-Prod ",
      "servicebus",
      "orders",
      "orders-prod",
      "servicebus|orders-prod|orders",
    ],
    // A namespace-scoped entity whose namespace nobody named keys without one.
    [
      "servicebus",
      "orders",
      "",
      "servicebus",
      "orders",
      "",
      "servicebus||orders",
    ],
    [
      "eventhubs",
      "telemetry/consumergroups/$default",
      "hub-ns",
      "eventhubs",
      "telemetry",
      "hub-ns",
      "eventhubs|hub-ns|telemetry",
    ],
    // A scope means nothing to Kafka: ignored, never refused.
    [
      "kafka",
      "orders",
      "ignored-scope",
      "kafka",
      "orders",
      "",
      "kafka||orders",
    ],
    [
      "rabbitmq",
      "orders",
      undefined,
      "rabbitmq",
      "orders",
      "",
      "rabbitmq||orders",
    ],
    // UUIDs are templated, so per-request names key one queue.
    [
      "kafka",
      "jobs-550e8400-e29b-41d4-a716-446655440000",
      undefined,
      "kafka",
      "jobs-{uuid}",
      "",
      "kafka||jobs-{uuid}",
    ],
    [
      "rabbitmq",
      "jobs-550e8400-e29b-41d4-a716-446655440000",
      undefined,
      "rabbitmq",
      "jobs-{uuid}",
      "",
      "rabbitmq||jobs-{uuid}",
    ],
    // A long-tail broker is kept as it came.
    [
      "ibmmq",
      "DEV.QUEUE.1",
      undefined,
      "ibmmq",
      "DEV.QUEUE.1",
      "",
      "ibmmq||dev.queue.1",
    ],
    ["bullmq", "emails", undefined, "bullmq", "emails", "", "bullmq||emails"],
  ])(
    "%p %p (scope %p) -> %p %p %p",
    (
      system: string,
      destination: string,
      scope: string | undefined,
      expectedSystem: string,
      expectedDestination: string,
      expectedScope: string,
      expectedIdentifier: string,
    ) => {
      expect(
        resolveManualMessageQueue({
          messagingSystem: system,
          destinationName: destination,
          brokerScope: scope,
        }),
      ).toEqual({
        system: expectedSystem,
        destination: expectedDestination,
        brokerScope: expectedScope,
        queueIdentifier: expectedIdentifier,
      });
    },
  );

  test("builds the identifier the identity module builds for the same queue", () => {
    const manual: ManualMessageQueue = resolveManualMessageQueue({
      messagingSystem: "activemq",
      destinationName: "orders",
      brokerScope: undefined,
    });

    expect(manual.queueIdentifier).toBe(
      buildMessageQueueIdentifier(
        identityOf({ system: "activemq", destination: "orders" }),
      ),
    );
  });

  test.each([
    [undefined, "Messaging system is required"],
    ["", "Messaging system is required"],
    ["   ", "Messaging system is required"],
    [42, "Messaging system is required"],
    ["my broker", `"my broker" is not a messaging system`],
    ["kafka/prod", `"kafka/prod" is not a messaging system`],
    ["spring_integration", "does not name a message broker"],
    ["Spring_Integration", "does not name a message broker"],
  ])("system %p is refused: %s", (system: unknown, message: string) => {
    expect(() => {
      resolveManualMessageQueue({
        messagingSystem: system,
        destinationName: "orders",
        brokerScope: undefined,
      });
    }).toThrow(message);
  });

  test.each([
    [undefined, "Destination is required"],
    ["", "Destination is required"],
    ["  ", "Destination is required"],
    // RabbitMQ's server-named, reply-to and anonymous queues, a bare UUID, placeholders, lists.
    ["amq.gen-JzTY20BRgKO-HjmUJj0wLg", "cannot be a queue"],
    ["amq.rabbitmq.reply-to.g1h2AA", "cannot be a queue"],
    ["orders.anonymous.AbCdEfGhIjKlMnOpQrStUv", "cannot be a queue"],
    ["550e8400-e29b-41d4-a716-446655440000", "cannot be a queue"],
    ["(temporary)", "cannot be a queue"],
    ["<default>", "cannot be a queue"],
    ['["a","b"]', "cannot be a queue"],
    ["orders\u0000", "cannot be a queue"],
    ["x".repeat(256), "cannot be a queue"],
    // The default exchange routes by its routing key: it is never a queue.
    ["amq.default", "is RabbitMQ's default exchange, not a queue"],
    [" AMQ.Default ", "is RabbitMQ's default exchange, not a queue"],
    ["amq.default:", "is RabbitMQ's default exchange, not a queue"],
    ["amq.default: ", "is RabbitMQ's default exchange, not a queue"],
    // A delivery through it to a queue that is never kept.
    ["amq.default:amq.gen-JzTY20BRgKO-HjmUJj0wLg", "cannot be a queue"],
  ])(
    "RabbitMQ destination %p is refused: %s",
    (destination: unknown, message: string) => {
      expect(() => {
        resolveManualMessageQueue({
          messagingSystem: "rabbitmq",
          destinationName: destination,
          brokerScope: undefined,
        });
      }).toThrow(message);
    },
  );

  test("a NATS inbox is refused - an inbox is a reply subject, not a queue", () => {
    expect(() => {
      resolveManualMessageQueue({
        messagingSystem: "nats",
        destinationName: "_INBOX.abc",
        brokerScope: undefined,
      });
    }).toThrow(BadDataException);
  });

  test("a destination of exactly the longest length is kept, one more is refused", () => {
    const longest: string = "x".repeat(MESSAGE_QUEUE_DESTINATION_MAX_LENGTH);

    expect(
      resolveManualMessageQueue({
        messagingSystem: "kafka",
        destinationName: longest,
        brokerScope: undefined,
      }).destination,
    ).toBe(longest);
    expect(
      refusalOf({
        messagingSystem: "kafka",
        destinationName: `${longest}x`,
      }).message,
    ).toContain(
      `a name longer than ${MESSAGE_QUEUE_DESTINATION_MAX_LENGTH} characters`,
    );
  });

  test("an identity whose canonical form outgrows its column is refused, saying to shorten the destination", () => {
    // "İ" lowercases to two UTF-16 units: 250 of them key 500 characters.
    expect(
      refusalOf({ messagingSystem: "kafka", destinationName: "İ".repeat(250) }),
    ).toEqual({
      field: "destinationName",
      message:
        "This queue's identity - its system, namespace and destination together - is too long to store. Shorten the destination.",
    });
  });

  test("a scope that cannot be an Azure namespace is refused for Service Bus", () => {
    expect(() => {
      resolveManualMessageQueue({
        messagingSystem: "servicebus",
        destinationName: "orders",
        brokerScope: "my namespace",
      });
    }).toThrow(`"my namespace" is not an Azure namespace name`);
  });

  test("every refusal is a BadDataException that quotes at most 100 typed characters", () => {
    let caught: unknown = null;

    try {
      resolveManualMessageQueue({
        messagingSystem: "rabbitmq",
        destinationName: `amq.gen-${"y".repeat(300)}`,
        brokerScope: undefined,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BadDataException);
    expect((caught as Error).message).toContain(`"amq.gen-${"y".repeat(92)}…"`);
    expect((caught as Error).message).not.toContain("y".repeat(93));
  });
});

/*
 * The rabbitmq receiver reports each queue under its exact name, and that
 * name is what ingest stamps on the queue's broker metrics and discovery
 * creates the queue by. Real queue names contain the separators a SPAN's
 * RabbitMQ destination joins exchange, routing key and queue with: Hutch
 * names a consumer's queue `<namespace>:<consumer>` from a Ruby
 * `Billing::InvoiceConsumer`, EasyNetQ `<Type>, <Assembly>_<subscription>`.
 * A typed name is taken whole, so a queue added by hand is the queue its
 * broker reports - never a second queue beside it, never another queue
 * that happens to end alike.
 */
describe("a typed RabbitMQ name is the queue's whole name, as its broker reports it", () => {
  test.each([
    ["orders"],
    // Hutch without and with a namespace.
    ["billing:invoice_consumer"],
    ["myapp:billing:invoice_consumer"],
    ["myapp:acme:billing:invoice_consumer"],
    // EasyNetQ's default queue name.
    ["MyApp.Messages.OrderCreated, MyApp.Messages_billing"],
    ["orders,high"],
    // Named like a span's joined exchange:routing-key:queue, but a queue name.
    ["shop:new-order:orders"],
    ["billing:invoice:"],
  ])("%p", (queue: string) => {
    const manual: ManualMessageQueue = rabbitMq(queue);

    expect(manual).toEqual({
      system: "rabbitmq",
      destination: queue,
      brokerScope: "",
      queueIdentifier: `rabbitmq||${queue.toLowerCase()}`,
    });
    expect(manual.queueIdentifier).toBe(rabbitMqBrokerIdentifier(queue));
  });

  test("UUIDs are templated the way its broker metrics are", () => {
    const queue: string = "reply-550e8400-e29b-41d4-a716-446655440000";

    expect(rabbitMq(queue).queueIdentifier).toBe("rabbitmq||reply-{uuid}");
    expect(rabbitMq(queue).queueIdentifier).toBe(
      rabbitMqBrokerIdentifier(queue),
    );
  });

  test.each([
    // Two Hutch queues that only end alike.
    ["app.v2:orders:dlq", "app:payments:dlq"],
    // Two EasyNetQ subscriptions to one message type.
    [
      "MyApp.Messages.OrderCreated, MyApp.Messages_billing",
      "MyApp.Messages.OrderCreated, MyApp.Messages_shipping",
    ],
  ])("%p and %p are two queues", (first: string, second: string) => {
    expect(rabbitMq(first).queueIdentifier).toBe(
      `rabbitmq||${first.toLowerCase()}`,
    );
    expect(rabbitMq(second).queueIdentifier).toBe(
      `rabbitmq||${second.toLowerCase()}`,
    );
  });

  /*
   * Except a delivery through the default exchange, joined the way a span
   * can name it: RabbitMQ refuses to declare a queue whose name starts with
   * "amq.", so `amq.default:orders` can only mean the queue its routing key
   * names.
   */
  test.each([
    ["amq.default:orders", "orders"],
    [" AMQ.Default: Orders ", "Orders"],
    [
      "amq.default:myapp:billing:invoice_consumer",
      "myapp:billing:invoice_consumer",
    ],
  ])("%p is a delivery to the queue %p", (typed: string, queue: string) => {
    const manual: ManualMessageQueue = rabbitMq(typed);

    expect(manual.destination).toBe(queue);
    expect(manual.queueIdentifier).toBe(rabbitMqBrokerIdentifier(queue));
  });

  test("a delivery through the default exchange keys the queue its spans key", () => {
    const attributes: Record<string, string> = {
      "messaging.system": "rabbitmq",
      "messaging.destination.name": "amq.default:orders",
    };
    const span: ResolvedMessagingDestination | null = resolveMessagingSpan({
      getAttribute: (key: string): unknown => {
        return attributes[key];
      },
      kind: "SPAN_KIND_PRODUCER",
    });

    expect(span?.destination).toBe("orders");
    expect(rabbitMq("amq.default:orders").destination).toBe(span?.destination);
  });

  test("another broker's typed name is read like a span's, as before", () => {
    // Kafka never splits a name; an SQS queue URL is still reduced to its name.
    expect(
      resolveManualMessageQueue({
        messagingSystem: "kafka",
        destinationName: "shop:new-order:orders",
      }).queueIdentifier,
    ).toBe("kafka||shop:new-order:orders");
    expect(
      resolveManualMessageQueue({
        messagingSystem: "aws_sqs",
        destinationName: "https://sqs.eu-west-1.amazonaws.com/1/orders",
      }).destination,
    ).toBe("orders");
  });
});

describe("checkManualMessageQueue", () => {
  test.each([
    ["no input at all", undefined, "messagingSystem"],
    ["null", null, "messagingSystem"],
    ["no system", { destinationName: "orders" }, "messagingSystem"],
    [
      "an in-process system",
      { messagingSystem: "spring_integration", destinationName: "orders" },
      "messagingSystem",
    ],
    [
      "a malformed system",
      { messagingSystem: "My Broker", destinationName: "orders" },
      "messagingSystem",
    ],
    [
      "a bad namespace",
      {
        messagingSystem: "servicebus",
        destinationName: "orders",
        brokerScope: "my namespace",
      },
      "brokerScope",
    ],
    ["no destination", { messagingSystem: "kafka" }, "destinationName"],
    [
      "a generated queue",
      { messagingSystem: "rabbitmq", destinationName: "amq.gen-abc" },
      "destinationName",
    ],
    [
      "the default exchange",
      { messagingSystem: "rabbitmq", destinationName: "amq.default" },
      "destinationName",
    ],
    [
      "non-string values",
      { messagingSystem: 42, destinationName: { name: "orders" } },
      "messagingSystem",
    ],
  ] as Array<
    [
      string,
      ManualMessageQueueInput | null | undefined,
      ManualMessageQueueField,
    ]
  >)(
    "%s is refused, naming the field it is about",
    (
      _name: string,
      input: ManualMessageQueueInput | null | undefined,
      field: ManualMessageQueueField,
    ) => {
      expect(refusalOf(input).field).toBe(field);
    },
  );

  test("judges the namespace before the destination, so each field's refusal can show on its own", () => {
    for (const destinationName of ["", "(temporary)", "orders"]) {
      expect(
        refusalOf({
          messagingSystem: "eventhubs",
          destinationName: destinationName,
          brokerScope: "not a namespace",
        }),
      ).toEqual({
        field: "brokerScope",
        message:
          '"not a namespace" is not an Azure namespace name. Enter the namespace - the first part of <namespace>.servicebus.windows.net - or that whole host name.',
      });
    }
  });

  test("the namespace is ignored for a system that has none, however it is spelled", () => {
    const check: ManualMessageQueueCheck = checkManualMessageQueue({
      messagingSystem: "rabbitmq",
      destinationName: "orders",
      brokerScope: "not a namespace",
    });

    expect(check.refusal).toBeNull();
    expect(check.queue?.brokerScope).toBe("");
  });

  test.each([
    [{ messagingSystem: "kafka", destinationName: "orders" }],
    [{ messagingSystem: "rabbitmq", destinationName: "a:b:c" }],
    [
      {
        messagingSystem: "servicebus",
        destinationName: "orders",
        brokerScope: "shop.servicebus.windows.net",
      },
    ],
    [{ messagingSystem: "", destinationName: "orders" }],
    [{ messagingSystem: "rabbitmq", destinationName: "amq.gen-abc" }],
    [
      {
        messagingSystem: "servicebus",
        destinationName: "orders",
        brokerScope: "-bad",
      },
    ],
    [{ messagingSystem: "kafka", destinationName: "İ".repeat(250) }],
  ] as Array<[ManualMessageQueueInput]>)(
    "agrees with resolveManualMessageQueue: %j",
    (input: ManualMessageQueueInput) => {
      const check: ManualMessageQueueCheck = checkManualMessageQueue(input);

      if (check.refusal === null) {
        expect(resolveManualMessageQueue(input)).toEqual(check.queue);
        return;
      }

      let caught: unknown = null;

      try {
        resolveManualMessageQueue(input);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(BadDataException);
      expect((caught as Error).message).toBe(check.refusal.message);
    },
  );
});

describe("quoteManualMessageQueueInput", () => {
  test("quotes a value as typed", () => {
    expect(quoteManualMessageQueueInput("orders")).toBe('"orders"');
    expect(quoteManualMessageQueueInput("")).toBe('""');
  });

  test("clamps a long value to its first 100 characters", () => {
    expect(quoteManualMessageQueueInput("x".repeat(100))).toBe(
      `"${"x".repeat(100)}"`,
    );
    expect(quoteManualMessageQueueInput("x".repeat(101))).toBe(
      `"${"x".repeat(100)}…"`,
    );
  });
});
