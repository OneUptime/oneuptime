import {
  MESSAGE_QUEUE_METRIC_ADDRESS_ATTRIBUTES,
  MESSAGE_QUEUE_METRIC_EXCLUDED_SERIES_ATTRIBUTES,
  MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES,
  MESSAGING_RESOLVER_INPUT_ATTRIBUTES,
  ResolvedMessagingDestination,
  resolveMessagingMetricDatapoint,
} from "../../../Types/MessageQueue/MessagingTelemetryResolver";
import {
  MESSAGE_QUEUE_METRICS,
  MessageQueueMetricDescriptor,
  MESSAGING_CLIENT_METRIC_NAMES,
  MESSAGING_SDK_METRIC_SYSTEMS,
} from "../../../Types/MessageQueue/MessageQueueMetricCatalog";
import {
  destinationOf,
  FixtureAttributes,
  METRIC_FIXTURES,
  MetricFixture,
  toStoredColumns,
} from "./MessagingTelemetryFixtures";
import { describe, expect, test } from "@jest/globals";

function resolveDatapoint(
  metricName: string,
  attributes: FixtureAttributes,
): ResolvedMessagingDestination | null {
  return resolveMessagingMetricDatapoint({
    metricName,
    getAttribute: (key: string): unknown => {
      return attributes[key];
    },
  });
}

function resolveRecordingReads(
  metricName: string,
  attributes: FixtureAttributes,
  reads: Set<string>,
): ResolvedMessagingDestination | null {
  return resolveMessagingMetricDatapoint({
    metricName,
    getAttribute: (key: string): unknown => {
      reads.add(key);
      return attributes[key];
    },
  });
}

const SERVICE_BUS: FixtureAttributes = {
  "azuremonitor.resource_id":
    "/subscriptions/s/resourceGroups/rg/providers/Microsoft.ServiceBus/namespaces/orders-prod",
  name: "orders-prod",
  type: "Microsoft.ServiceBus/namespaces",
  metadata_entityname: "orders",
};

const SQS_JSON: FixtureAttributes = {
  "resource.cloud.provider": "aws",
  "resource.cloud.region": "us-east-1",
  "resource.service.namespace": "AWS",
  "resource.service.name": "SQS",
  QueueName: "orders",
};

describe("resolveMessagingMetricDatapoint — every curated metric, from a realistic stored datapoint", () => {
  test("the corpus names are unique", () => {
    expect(
      new Set(
        METRIC_FIXTURES.map((fixture: MetricFixture): string => {
          return `${fixture.metricName} — ${fixture.name}`;
        }),
      ).size,
    ).toBe(METRIC_FIXTURES.length);
  });

  test.each(
    METRIC_FIXTURES.map((fixture: MetricFixture): [string, MetricFixture] => {
      return [`${fixture.metricName} — ${fixture.name}`, fixture];
    }),
  )("%s", (_name: string, fixture: MetricFixture) => {
    expect(resolveDatapoint(fixture.metricName, fixture.attributes)).toEqual(
      fixture.expected,
    );
  });

  test.each(
    METRIC_FIXTURES.map((fixture: MetricFixture): [string, MetricFixture] => {
      return [`${fixture.metricName} — ${fixture.name}`, fixture];
    }),
  )(
    "%s — resolves identically read back from ClickHouse",
    (_name: string, fixture: MetricFixture) => {
      const row: Record<string, string> = toStoredColumns(
        fixture.attributes,
        MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES,
      );
      expect(
        resolveMessagingMetricDatapoint({
          metricName: fixture.metricName,
          getAttribute: (key: string): unknown => {
            return row[key];
          },
        }),
      ).toEqual(resolveDatapoint(fixture.metricName, fixture.attributes));
    },
  );

  test("a curated metric's direction follows its signal", () => {
    for (const fixture of METRIC_FIXTURES) {
      const descriptor: MessageQueueMetricDescriptor | undefined =
        MESSAGE_QUEUE_METRICS.find(
          (candidate: MessageQueueMetricDescriptor): boolean => {
            return (
              candidate.metricName === fixture.metricName &&
              candidate.system === fixture.expected?.system
            );
          },
        );
      if (!descriptor || !fixture.expected) {
        continue;
      }
      const expected: string =
        descriptor.signal === "published"
          ? "publish"
          : descriptor.signal === "consumed"
            ? "consume"
            : "unknown";
      expect({
        fixture: fixture.name,
        direction: fixture.expected.direction,
      }).toEqual({ fixture: fixture.name, direction: expected });
    }
  });

  test("the metric name is trimmed and lowercased first", () => {
    expect(
      resolveDatapoint("  Azure_ActiveMessages_Average  ", SERVICE_BUS),
    ).toEqual(resolveDatapoint("azure_activemessages_average", SERVICE_BUS));
    expect(
      resolveDatapoint("  Azure_ActiveMessages_Average  ", SERVICE_BUS),
    ).not.toBeNull();
  });
});

describe("Azure Monitor datapoints", () => {
  test.each([
    ["Microsoft.ServiceBus/namespaces"],
    ["Microsoft.ServiceBus/Namespaces"],
    ["microsoft.servicebus/namespaces"],
    ["MICROSOFT.SERVICEBUS/NAMESPACES"],
    ["  Microsoft.ServiceBus/namespaces  "],
  ])("the resource type %j is compared case-insensitively", (type: string) => {
    expect(
      resolveDatapoint("azure_activemessages_average", {
        ...SERVICE_BUS,
        type,
      }),
    ).toEqual(
      destinationOf({
        system: "servicebus",
        destination: "orders",
        brokerScope: "orders-prod",
      }),
    );
  });

  test("the documented PascalCase dimension key is read too", () => {
    const attributes: FixtureAttributes = { ...SERVICE_BUS };
    delete attributes["metadata_entityname"];
    attributes["metadata_EntityName"] = "orders";
    expect(
      resolveDatapoint("azure_activemessages_average", attributes)?.destination,
    ).toBe("orders");
  });

  test("the lowercase key wins when both spellings are present", () => {
    expect(
      resolveDatapoint("azure_activemessages_average", {
        ...SERVICE_BUS,
        metadata_entityname: "orders",
        metadata_EntityName: "other",
      })?.destination,
    ).toBe("orders");
  });

  test("an entity name keeps its casing; the namespace scope is lowercased", () => {
    expect(
      resolveDatapoint("azure_activemessages_average", {
        ...SERVICE_BUS,
        name: "Orders-Prod",
        metadata_entityname: "Orders",
      }),
    ).toEqual(
      destinationOf({
        system: "servicebus",
        destination: "Orders",
        brokerScope: "orders-prod",
      }),
    );
  });

  test("a namespace host in `name` is reduced to the namespace; anything else is no scope", () => {
    expect(
      resolveDatapoint("azure_activemessages_average", {
        ...SERVICE_BUS,
        name: "orders-prod.servicebus.windows.net",
      })?.brokerScope,
    ).toBe("orders-prod");
    expect(
      resolveDatapoint("azure_activemessages_average", {
        ...SERVICE_BUS,
        name: "not a namespace",
      })?.brokerScope,
    ).toBe("");
    const unnamed: FixtureAttributes = { ...SERVICE_BUS };
    delete unnamed["name"];
    expect(
      resolveDatapoint("azure_activemessages_average", unnamed)?.brokerScope,
    ).toBe("");
  });

  test("the same name resolves to Service Bus or Event Hubs by the resource type", () => {
    expect(
      resolveDatapoint("azure_incomingmessages_total", SERVICE_BUS)?.system,
    ).toBe("servicebus");
    expect(
      resolveDatapoint("azure_incomingmessages_total", {
        ...SERVICE_BUS,
        type: "Microsoft.EventHub/Namespaces",
      })?.system,
    ).toBe("eventhubs");
  });

  test("a metric only Service Bus has does not resolve for an Event Hubs namespace", () => {
    expect(
      resolveDatapoint("azure_activemessages_average", {
        ...SERVICE_BUS,
        type: "Microsoft.EventHub/namespaces",
      }),
    ).toBeNull();
  });

  test.each([
    [{ type: "Microsoft.Storage/storageAccounts/queueServices" }],
    [{ type: "Microsoft.EventGrid/topics" }],
    [{ type: "" }],
    [{ type: undefined }],
    [{ type: "Microsoft.ServiceBus" }],
  ])(
    "a datapoint whose resource type does not match (%j) is rejected",
    (override: FixtureAttributes) => {
      expect(
        resolveDatapoint("azure_incomingmessages_total", {
          ...SERVICE_BUS,
          ...override,
        }),
      ).toBeNull();
    },
  );

  test("a namespace-level value or a missing entity is no queue", () => {
    expect(
      resolveDatapoint("azure_incomingmessages_total", {
        ...SERVICE_BUS,
        metadata_entityname: "-NamespaceOnlyMetric-",
      }),
    ).toBeNull();
    const withoutEntity: FixtureAttributes = { ...SERVICE_BUS };
    delete withoutEntity["metadata_entityname"];
    expect(
      resolveDatapoint("azure_incomingmessages_total", withoutEntity),
    ).toBeNull();
  });
});

describe("CloudWatch datapoints", () => {
  test("the JSON shape needs the SQS service on the resource", () => {
    expect(
      resolveDatapoint("approximatenumberofmessagesvisible", SQS_JSON),
    ).toEqual(destinationOf({ system: "aws_sqs", destination: "orders" }));
    for (const service of ["Sqs", "sqs", " SQS "]) {
      expect(
        resolveDatapoint("approximatenumberofmessagesvisible", {
          ...SQS_JSON,
          "resource.service.name": service,
        })?.system,
      ).toBe("aws_sqs");
    }
    const withoutService: FixtureAttributes = { ...SQS_JSON };
    delete withoutService["resource.service.name"];
    expect(
      resolveDatapoint("approximatenumberofmessagesvisible", withoutService),
    ).toBeNull();
    // Another namespace's metric of the same bare name.
    expect(
      resolveDatapoint("approximatenumberofmessagesvisible", {
        ...SQS_JSON,
        "resource.service.name": "SNS",
      }),
    ).toBeNull();
    // A datapoint key is not the resource key.
    const datapointService: FixtureAttributes = { ...withoutService };
    datapointService["service.name"] = "SQS";
    expect(
      resolveDatapoint("approximatenumberofmessagesvisible", datapointService),
    ).toBeNull();
  });

  test("the namespaced shape reads the flattened Dimensions kvlist key only", () => {
    expect(
      resolveDatapoint(
        "amazonaws.com/aws/sqs/approximatenumberofmessagesvisible",
        { "Dimensions.QueueName": "orders" },
      )?.destination,
    ).toBe("orders");
    expect(
      resolveDatapoint(
        "amazonaws.com/aws/sqs/approximatenumberofmessagesvisible",
        { QueueName: "orders" },
      ),
    ).toBeNull();
    // Stored keys keep their case: the dimension key is case-sensitive.
    expect(
      resolveDatapoint(
        "amazonaws.com/aws/sqs/approximatenumberofmessagesvisible",
        { "dimensions.queuename": "orders" },
      ),
    ).toBeNull();
  });

  test("an SNS datapoint without a TopicName (push, SMS, account-wide) is no queue", () => {
    expect(
      resolveDatapoint("amazonaws.com/aws/sns/numberofmessagespublished", {
        "Dimensions.Application": "my-app",
        "Dimensions.Platform": "APNS",
      }),
    ).toBeNull();
    expect(
      resolveDatapoint("numberofmessagespublished", {
        "resource.service.name": "SNS",
        PhoneNumber: "+15555550100",
      }),
    ).toBeNull();
  });

  test("an SQS queue named like a URL or an ARN is reduced to its name", () => {
    expect(
      resolveDatapoint("amazonaws.com/aws/sqs/numberofmessagessent", {
        "Dimensions.QueueName":
          "https://sqs.us-east-1.amazonaws.com/123456789012/orders",
      })?.destination,
    ).toBe("orders");
  });
});

describe("the other broker sources", () => {
  test("RabbitMQ queue names are taken exactly: no exchange:routing-key parsing", () => {
    expect(
      resolveDatapoint("rabbitmq.message.current", {
        "resource.rabbitmq.queue.name": "tenant:orders",
        state: "ready",
      })?.destination,
    ).toBe("tenant:orders");
    expect(
      resolveDatapoint("rabbitmq.message.current", {
        "resource.rabbitmq.queue.name": "amq.default",
      })?.destination,
    ).toBe("amq.default");
  });

  test("RabbitMQ's generated and reply-to queues are no queues", () => {
    for (const name of [
      "amq.gen-JzTY20BRgKO-HjmUJj0wLg",
      "amq.rabbitmq.reply-to",
      "orders.anonymous.X8o1yfRBQXSp5Bdd09ls7w",
      "5f2b7c1e-8d3a-4b6f-9c0d-1e2f3a4b5c6d",
    ]) {
      expect(
        resolveDatapoint("rabbitmq.message.current", {
          "resource.rabbitmq.queue.name": name,
        }),
      ).toBeNull();
    }
  });

  test("the RabbitMQ queue must be the resource attribute, not a datapoint one", () => {
    expect(
      resolveDatapoint("rabbitmq.message.current", {
        "rabbitmq.queue.name": "orders",
      }),
    ).toBeNull();
  });

  test("a Kafka topic named per tenant is templated", () => {
    expect(
      resolveDatapoint("kafka.consumer_group.lag_sum", {
        group: "billing",
        topic: "events-5f2b7c1e-8d3a-4b6f-9c0d-1e2f3a4b5c6d",
      })?.destination,
    ).toBe("events-{uuid}");
  });

  test("the ActiveMQ scraper's current key wins over the legacy one", () => {
    expect(
      resolveDatapoint("activemq.message.enqueued", {
        "messaging.destination.name": "current",
        destination: "legacy",
      })?.destination,
    ).toBe("current");
  });

  test("a metric whose name spelling belongs to one scraper generation reads only its key", () => {
    expect(
      resolveDatapoint("activemq.message.queue.size", {
        destination: "orders",
      }),
    ).toBeNull();
    expect(
      resolveDatapoint("activemq.message.current", {
        "messaging.destination.name": "orders",
      }),
    ).toBeNull();
  });

  test("a Pub/Sub subscription metric reads the subscription, a topic metric the topic", () => {
    const both: FixtureAttributes = {
      "resource.subscription_id": "billing-sub",
      "resource.topic_id": "orders",
    };
    expect(
      resolveDatapoint(
        "pubsub.googleapis.com/subscription/num_undelivered_messages",
        both,
      )?.destination,
    ).toBe("billing-sub");
    expect(
      resolveDatapoint("pubsub.googleapis.com/topic/send_request_count", both)
        ?.destination,
    ).toBe("orders");
    expect(
      resolveDatapoint(
        "pubsub.googleapis.com/subscription/num_undelivered_messages",
        { "resource.topic_id": "orders" },
      ),
    ).toBeNull();
    // The bare monitored-resource label is a resource attribute once stored.
    expect(
      resolveDatapoint(
        "pubsub.googleapis.com/subscription/num_undelivered_messages",
        { subscription_id: "billing-sub" },
      ),
    ).toBeNull();
  });

  test("Pulsar partitions fold into one topic; short names expand", () => {
    for (const topic of [
      "persistent://public/default/payments",
      "persistent://public/default/payments-partition-0",
      "persistent://public/default/payments-partition-17",
      "payments",
      "payments-partition-3",
    ]) {
      expect(
        resolveDatapoint("pulsar_msg_backlog", { topic })?.destination,
      ).toBe("persistent://public/default/payments");
    }
  });

  test("Pulsar's per-consumer copy of pulsar_out_messages_total belongs to no queue, so the topic's rate is not counted twice", () => {
    const subscriptionSeries: FixtureAttributes = {
      cluster: "standalone",
      namespace: "public/default",
      topic: "persistent://public/default/orders",
      subscription: "billing",
    };
    expect(
      resolveDatapoint("pulsar_out_messages_total", subscriptionSeries),
    ).toEqual(
      destinationOf({
        system: "pulsar",
        destination: "persistent://public/default/orders",
        direction: "consume",
      }),
    );
    // exposeConsumerLevelMetricsInPrometheus=true repeats it per consumer.
    for (const marker of [
      { consumer_name: "billing-worker-7", consumer_id: "3" },
      { consumer_name: "billing-worker-7" },
      { consumer_id: "0" },
    ]) {
      expect(
        resolveDatapoint("pulsar_out_messages_total", {
          ...subscriptionSeries,
          ...marker,
        }),
      ).toBeNull();
    }
    // A blank marker is no marker.
    expect(
      resolveDatapoint("pulsar_out_messages_total", {
        ...subscriptionSeries,
        consumer_name: "  ",
      }),
    ).not.toBeNull();
    // Only the metric that declares the markers drops them.
    expect(
      resolveDatapoint("pulsar_msg_backlog", {
        ...subscriptionSeries,
        consumer_name: "billing-worker-7",
      })?.destination,
    ).toBe("persistent://public/default/orders");
  });

  test("the reporting broker's scrape target is the display address", () => {
    expect(
      resolveDatapoint("pulsar_msg_backlog", {
        topic: "orders",
        "resource.server.address": "pulsar-broker-1",
        "resource.server.port": "8080",
      })?.brokerAddress,
    ).toBe("pulsar-broker-1:8080");
    expect(
      resolveDatapoint("pulsar_msg_backlog", { topic: "orders" })
        ?.brokerAddress,
    ).toBeNull();
    // A datapoint server.address (the scraped app's own label) is not read.
    expect(
      resolveDatapoint("pulsar_msg_backlog", {
        topic: "orders",
        "server.address": "somewhere-else",
      })?.brokerAddress,
    ).toBeNull();
  });

  test("RocketMQ dead-letter topics are flagged", () => {
    expect(
      resolveDatapoint("rocketmq_consumer_lag_messages", {
        topic: "%DLQ%billing-group",
        consumer_group: "billing-group",
      }),
    ).toEqual(
      destinationOf({
        system: "rocketmq",
        destination: "%DLQ%billing-group",
        isDeadLetter: true,
      }),
    );
  });
});

describe("a curated name never falls through to the attribute path", () => {
  test("even with messaging.system on the datapoint, a curated name that none of its entries resolves is null", () => {
    expect(
      resolveDatapoint("azure_incomingmessages_total", {
        "messaging.system": "servicebus",
        "messaging.destination.name": "orders",
        type: "Microsoft.Storage/storageAccounts",
      }),
    ).toBeNull();
    expect(
      resolveDatapoint("rabbitmq.message.current", {
        "messaging.system": "rabbitmq",
        "messaging.destination.name": "orders",
      }),
    ).toBeNull();
  });
});

describe("messaging-client metrics and application gauges (the attribute path)", () => {
  test.each([
    ["messaging.client.sent.messages", "publish"],
    ["messaging.client.published.messages", "publish"],
    ["messaging.publish.duration", "publish"],
    ["messaging.publish.messages", "publish"],
    ["messaging.client.consumed.messages", "consume"],
    ["messaging.process.duration", "consume"],
    ["messaging.receive.duration", "consume"],
    ["messaging.receive.messages", "consume"],
    ["messaging.process.messages", "consume"],
    ["Messaging.Client.Sent.Messages", "publish"],
    ["myapp_messages_sent_total", "publish"],
    ["myapp/jobs/processed", "consume"],
    ["queue.size", "unknown"],
    ["messaging.client.operation.duration", "unknown"],
  ])(
    "%s → direction %s from its name",
    (metricName: string, direction: string) => {
      expect(
        resolveDatapoint(metricName, {
          "messaging.system": "kafka",
          "messaging.destination.name": "orders",
        })?.direction,
      ).toBe(direction);
    },
  );

  test("with no word in the name, the direction comes from the attributes", () => {
    expect(
      resolveDatapoint("messaging.client.operation.duration", {
        "messaging.system": "kafka",
        "messaging.destination.name": "orders",
        "messaging.operation.type": "send",
      })?.direction,
    ).toBe("publish");
    expect(
      resolveDatapoint("messaging.client.operation.duration", {
        "messaging.system": "servicebus",
        "messaging.destination.name": "orders",
        "messaging.operation.name": "complete",
      })?.direction,
    ).toBe("settle");
  });

  test("the name's direction wins over the attributes", () => {
    expect(
      resolveDatapoint("messaging.client.sent.messages", {
        "messaging.system": "kafka",
        "messaging.destination.name": "orders",
        "messaging.operation.type": "receive",
      })?.direction,
    ).toBe("publish");
  });

  test("the name's words are whole words", () => {
    expect(
      resolveDatapoint("messaging.resend_attempts", {
        "messaging.system": "kafka",
        "messaging.destination.name": "orders",
      })?.direction,
    ).toBe("unknown");
  });

  test("no messaging trigger, no queue — whatever the name", () => {
    expect(resolveDatapoint("messaging.client.sent.messages", {})).toBeNull();
    expect(
      resolveDatapoint("queue.size", {
        state: "waiting",
        "resource.messaging.system": "bullmq",
      }),
    ).toBeNull();
  });

  test("the destination template, the Azure namespace and the temporary rules apply as on spans", () => {
    expect(
      resolveDatapoint("messaging.client.sent.messages", {
        "messaging.system": "nats",
        "messaging.destination.template": "orders.{id}",
      })?.destination,
    ).toBe("orders.{id}");
    expect(
      resolveDatapoint("messaging.client.sent.messages", {
        "messaging.system": "rabbitmq",
        "messaging.destination.name": "amq.gen-JzTY20BRgKO-HjmUJj0wLg",
      }),
    ).toBeNull();
    expect(
      resolveDatapoint("messaging.client.sent.messages", {
        "messaging.system": "eventhubs",
        "messaging.destination.name": "telemetry",
        "server.address": "ingest-prod.servicebus.windows.net",
      })?.brokerScope,
    ).toBe("ingest-prod");
  });

  test.each([
    ["messaging.destination.temporary", true],
    ["messaging.destination.temporary", "true"],
    ["messaging.destination.anonymous", true],
    ["messaging.destination.anonymous", "TRUE"],
    ["messaging.source.temporary", "true"],
    ["messaging.source.anonymous", true],
  ])(
    "a datapoint flagged %s = %j is no queue, as a span would not be",
    (flag: string, value: unknown) => {
      for (const metricName of [
        "messaging.client.sent.messages",
        "messaging.process.duration",
        "queue.size",
      ]) {
        expect(
          resolveDatapoint(metricName, {
            "messaging.system": "rabbitmq",
            "messaging.destination.name": "reply",
            [flag]: value,
          }),
        ).toBeNull();
      }
      // The same datapoint without the flag is a queue.
      expect(
        resolveDatapoint("messaging.client.sent.messages", {
          "messaging.system": "rabbitmq",
          "messaging.destination.name": "reply",
          [flag]: false,
        })?.destination,
      ).toBe("reply");
    },
  );

  test("an excluded system is no queue", () => {
    expect(
      resolveDatapoint("messaging.client.sent.messages", {
        "messaging.system": "spring_integration",
        "messaging.destination.name": "inputChannel",
      }),
    ).toBeNull();
  });

  test.each([
    ["messaging.servicebus.messages.sent", "publish"],
    ["messaging.servicebus.receiver.lag", "consume"],
    ["messaging.servicebus.settlement.request.duration", "settle"],
    ["messaging.servicebus.settlement.sequence_number", "settle"],
  ])(
    "the Azure SDK for Java's %s names no system: its name says Service Bus (direction %s)",
    (metricName: string, direction: string) => {
      expect(MESSAGING_SDK_METRIC_SYSTEMS.get(metricName)).toBe("servicebus");
      expect(MESSAGING_CLIENT_METRIC_NAMES.has(metricName)).toBe(true);
      // ServiceBusMeter's attributes, as azure-core-metrics-opentelemetry renames them.
      expect(
        resolveDatapoint(metricName, {
          "server.address": "billing-prod.servicebus.windows.net",
          "messaging.destination.name": "invoices",
          "messaging.servicebus.subscription_name": "audit",
          "messaging.servicebus.disposition_status": "complete",
        }),
      ).toEqual(
        destinationOf({
          system: "servicebus",
          destination: "invoices",
          brokerScope: "billing-prod",
          brokerAddress: "billing-prod.servicebus.windows.net",
          direction: direction as ResolvedMessagingDestination["direction"],
          consumerGroup: "audit",
        }),
      );
    },
  );

  test("a system the datapoint names wins over the one its name implies; an excluded one is kept", () => {
    expect(
      resolveDatapoint("messaging.servicebus.messages.sent", {
        "messaging.system": "eventhubs",
        "messaging.destination.name": "telemetry",
      })?.system,
    ).toBe("eventhubs");
    expect(
      resolveDatapoint("messaging.servicebus.messages.sent", {
        "messaging.system": "spring_integration",
        "messaging.destination.name": "invoices",
      }),
    ).toBeNull();
    // The implied system needs the metric's exact name.
    expect(
      resolveDatapoint("messaging.servicebus.messages.dropped", {
        "messaging.destination.name": "invoices",
      }),
    ).toBeNull();
    // No name, no implied system.
    expect(
      resolveDatapoint("", { "messaging.destination.name": "invoices" }),
    ).toBeNull();
  });

  test.each([
    /*
     * The Java agent's opt-in client metrics carry semconv 1.30's joined
     * RabbitMQ names but never the routing key (no metric attribute): a
     * consumer's names its queue, a producer's its exchange.
     */
    [
      "messaging.client.operation.duration",
      { "messaging.operation.type": "send" },
      "orders.topic:orders.eu.created",
      "orders.topic",
    ],
    [
      "messaging.client.sent.messages",
      { "messaging.operation.type": "send" },
      "orders.topic:orders.eu.created",
      "orders.topic",
    ],
    [
      "messaging.process.duration",
      { "messaging.operation.type": "process" },
      "direct_logs:warning",
      "warning",
    ],
    [
      "messaging.client.consumed.messages",
      { "messaging.operation.type": "receive" },
      "logs:logs-audit",
      "logs-audit",
    ],
    [
      "messaging.client.operation.duration",
      { "messaging.operation.type": "settle" },
      "direct_logs:warning:my_queue",
      "my_queue",
    ],
    // The older conventions' metrics name one exchange, colon and all.
    [
      "messaging.publish.duration",
      { "messaging.operation": "publish" },
      "MyApp.Contracts:OrderSubmitted",
      "MyApp.Contracts:OrderSubmitted",
    ],
    [
      "messaging.process.duration",
      { "messaging.operation": "process" },
      "MyApp.Contracts:OrderSubmitted",
      "MyApp.Contracts:OrderSubmitted",
    ],
  ])(
    "RabbitMQ client metric %s %j of %s names %s",
    (
      metricName: string,
      conventions: FixtureAttributes,
      destination: string,
      expected: string,
    ) => {
      expect(
        resolveDatapoint(metricName, {
          "messaging.system": "rabbitmq",
          "messaging.destination.name": destination,
          ...conventions,
        })?.destination,
      ).toBe(expected);
    },
  );

  test("a destination named phone_number… is a queue for every broker but an SNS SMS placeholder", () => {
    expect(
      resolveDatapoint(
        "amazonaws.com/aws/sqs/approximatenumberofmessagesvisible",
        { "Dimensions.QueueName": "phone_number_updates" },
      )?.destination,
    ).toBe("phone_number_updates");
    expect(
      resolveDatapoint("kafka.consumer_group.lag_sum", {
        group: "billing",
        topic: "phone_numbers",
      })?.destination,
    ).toBe("phone_numbers");
    expect(
      resolveDatapoint("messaging.client.sent.messages", {
        "messaging.system": "aws.sns",
        "messaging.destination.name": "phone_number:**",
      }),
    ).toBeNull();
  });

  test("a broker destination or scrubbed value no queue could hold is no queue", () => {
    expect(
      resolveDatapoint("kafka.consumer_group.lag_sum", {
        group: "billing",
        topic: "orders\u0000x",
      }),
    ).toBeNull();
    expect(
      resolveDatapoint("rabbitmq.message.current", {
        "resource.rabbitmq.queue.name": "orders\u001fx",
        state: "ready",
      }),
    ).toBeNull();
    // A metric pipeline rule's default redaction.
    expect(
      resolveDatapoint("rabbitmq.message.current", {
        "resource.rabbitmq.queue.name": "[REDACTED]",
        state: "ready",
      }),
    ).toBeNull();
    expect(
      resolveDatapoint("pulsar_msg_backlog", { topic: "[REDACTED]" }),
    ).toBeNull();
  });

  test("an empty metric name resolves by the attributes", () => {
    expect(
      resolveDatapoint("", {
        "messaging.system": "kafka",
        "messaging.destination.name": "orders",
      }),
    ).toEqual(destinationOf({ system: "kafka", destination: "orders" }));
  });

  test("every messaging-client metric name takes the attribute path", () => {
    for (const metricName of MESSAGING_CLIENT_METRIC_NAMES) {
      expect(
        resolveDatapoint(metricName, {
          "messaging.system": "kafka",
          "messaging.destination.name": "orders",
        })?.destination,
      ).toBe("orders");
    }
  });
});

describe("MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES", () => {
  test("covers the span keys, every catalog key and the broker address", () => {
    const keys: Set<string> = new Set<string>(
      MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES,
    );
    expect(keys.size).toBe(MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES.length);
    for (const key of MESSAGING_RESOLVER_INPUT_ATTRIBUTES) {
      expect(keys.has(key)).toBe(true);
    }
    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      for (const key of [
        ...descriptor.destinationAttributes,
        ...(descriptor.scopeAttributes || []),
        ...Object.keys(descriptor.requiredAttributes || {}),
      ]) {
        expect({ key, listed: keys.has(key) }).toEqual({ key, listed: true });
      }
    }
    for (const attribute of MESSAGE_QUEUE_METRIC_ADDRESS_ATTRIBUTES) {
      expect(keys.has(attribute.address)).toBe(true);
      if (attribute.port) {
        expect(keys.has(attribute.port)).toBe(true);
      }
    }
  });

  test("series keys are for charts, not identity: none is read", () => {
    const listed: Set<string> = new Set<string>(
      MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES,
    );
    for (const key of [
      "state",
      "group",
      "partition",
      "subscription",
      "consumer_group",
      "is_retry",
      "metadata_operationresult",
      "response_code",
      "delivery_type",
    ]) {
      expect(listed.has(key)).toBe(false);
    }
  });

  test("the resolver never reads a key outside the list, over every fixture", () => {
    /*
     * Besides the list, only the repeat markers, which merely drop a
     * datapoint (see the test below).
     */
    const allowed: Set<string> = new Set<string>([
      ...MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES,
      ...MESSAGE_QUEUE_METRIC_EXCLUDED_SERIES_ATTRIBUTES,
    ]);
    const outside: Array<string> = [];
    for (const fixture of METRIC_FIXTURES) {
      const reads: Set<string> = new Set<string>();
      resolveRecordingReads(fixture.metricName, fixture.attributes, reads);
      for (const key of reads) {
        if (!allowed.has(key)) {
          outside.push(`${fixture.name}: ${key}`);
        }
      }
    }
    expect(outside).toEqual([]);
  });

  test("the repeat markers are per instance, so the discovery cron never groups by them", () => {
    expect(MESSAGE_QUEUE_METRIC_EXCLUDED_SERIES_ATTRIBUTES).toEqual([
      "consumer_name",
      "consumer_id",
    ]);
    for (const key of MESSAGE_QUEUE_METRIC_EXCLUDED_SERIES_ATTRIBUTES) {
      expect(MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES).not.toContain(key);
    }
    /*
     * And leaving them out of the stored row never changes WHICH queue a
     * row finds: the per-consumer copy resolves, from the discovery row, to
     * the queue its subscription's own series already names.
     */
    const subscriptionSeries: FixtureAttributes = {
      cluster: "standalone",
      namespace: "public/default",
      topic: "persistent://public/default/orders-partition-0",
      subscription: "billing",
    };
    const consumerCopy: FixtureAttributes = {
      ...subscriptionSeries,
      consumer_name: "billing-worker-7",
      consumer_id: "3",
    };
    const fromSubscription: ResolvedMessagingDestination | null =
      resolveDatapoint("pulsar_out_messages_total", subscriptionSeries);
    expect(fromSubscription?.destination).toBe(
      "persistent://public/default/orders",
    );
    const storedCopy: Record<string, string> = toStoredColumns(
      consumerCopy,
      MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES,
    );
    expect(
      resolveMessagingMetricDatapoint({
        metricName: "pulsar_out_messages_total",
        getAttribute: (key: string): unknown => {
          return storedCopy[key];
        },
      }),
    ).toEqual(fromSubscription);
  });

  test("every catalog key is read by some fixture", () => {
    const read: Set<string> = new Set<string>();
    for (const fixture of METRIC_FIXTURES) {
      resolveRecordingReads(fixture.metricName, fixture.attributes, read);
    }
    // The second Azure spelling is read only when the first is absent.
    resolveRecordingReads(
      "azure_activemessages_average",
      { type: "Microsoft.ServiceBus/namespaces" },
      read,
    );
    const catalogKeys: Set<string> = new Set<string>();
    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      for (const key of [
        ...descriptor.destinationAttributes,
        ...(descriptor.scopeAttributes || []),
        ...Object.keys(descriptor.requiredAttributes || {}),
      ]) {
        catalogKeys.add(key);
      }
    }
    expect(
      [...catalogKeys].filter((key: string): boolean => {
        return !read.has(key);
      }),
    ).toEqual([]);
  });
});

describe("the metric resolver never throws", () => {
  test("bad input is null", () => {
    expect(
      resolveMessagingMetricDatapoint(
        null as unknown as {
          metricName: string;
          getAttribute: (key: string) => unknown;
        },
      ),
    ).toBeNull();
    expect(
      resolveMessagingMetricDatapoint({
        metricName: "rabbitmq.message.current",
        getAttribute: null as unknown as (key: string) => unknown,
      }),
    ).toBeNull();
    expect(
      resolveMessagingMetricDatapoint({
        metricName: 42 as unknown as string,
        getAttribute: (): unknown => {
          return undefined;
        },
      }),
    ).toBeNull();
  });

  test("odd attribute values on every curated metric resolve or are null", () => {
    const odd: Array<unknown> = [
      null,
      undefined,
      "",
      "   ",
      0,
      true,
      [],
      ["x"],
      {},
      "[]",
      "https://",
      "arn:",
    ];
    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      for (const value of odd) {
        const attributes: FixtureAttributes = {};
        for (const key of [
          ...descriptor.destinationAttributes,
          ...(descriptor.scopeAttributes || []),
          ...Object.keys(descriptor.requiredAttributes || {}),
        ]) {
          attributes[key] = value;
        }
        let threw: boolean = false;
        try {
          resolveDatapoint(descriptor.metricName, attributes);
        } catch {
          threw = true;
        }
        expect({
          metric: descriptor.metricName,
          value: String(value),
          threw,
        }).toEqual({
          metric: descriptor.metricName,
          value: String(value),
          threw: false,
        });
      }
    }
  });
});
