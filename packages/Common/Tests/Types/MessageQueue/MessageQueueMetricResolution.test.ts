import {
  MESSAGE_QUEUE_METRIC_ADDRESS_ATTRIBUTES,
  MESSAGE_QUEUE_METRIC_EXCLUDED_SERIES_ATTRIBUTES,
  MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES,
  MESSAGING_RESOLVER_INPUT_ATTRIBUTES,
  ResolvedMessagingDestination,
  resolveMessagingMetricDatapoint,
  resolveMessagingSpan,
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

  /*
   * Each broker's metrics list every queue it has, MassTransit's per-process
   * endpoints among them: the bus endpoint of every process that uses a
   * request client (`{machine}_{process}_bus_{NewId}`), temporary endpoints,
   * a service's `Instance_{NewId}`. One datapoint of a curated broker metric
   * creates a queue, so each process start would add one.
   */
  test("MassTransit's per-process endpoints are no queues on any broker's metrics; its named endpoints are", () => {
    const podA: string =
      "ordersapi7d9f8c6b5xk2lq_OrdersApi_bus_kd4oyqbeynuojexybdxt7414fx";
    const podB: string =
      "ordersapi7d9f8c6b5mnp4r_OrdersApi_bus_kawyb4raybmxtdeybdxt7hihry";
    const instance: string = "Instance_axhob3yrynqhyacybdxt6jeg8m";
    const brokerSeries: Array<[string, (name: string) => FixtureAttributes]> = [
      [
        "rabbitmq.message.current",
        (name: string): FixtureAttributes => {
          return {
            "resource.rabbitmq.queue.name": name,
            "resource.rabbitmq.vhost.name": "/",
            "resource.rabbitmq.node.name": "rabbit@rabbitmq-0",
            state: "ready",
          };
        },
      ],
      [
        "rabbitmq.consumer.count",
        (name: string): FixtureAttributes => {
          return { "resource.rabbitmq.queue.name": name };
        },
      ],
      [
        "azure_activemessages_average",
        (name: string): FixtureAttributes => {
          return { ...SERVICE_BUS, metadata_entityname: name };
        },
      ],
      [
        "approximatenumberofmessagesvisible",
        (name: string): FixtureAttributes => {
          return { ...SQS_JSON, QueueName: name };
        },
      ],
      [
        "amazonaws.com/aws/sqs/approximatenumberofmessagesvisible",
        (name: string): FixtureAttributes => {
          return { "Dimensions.QueueName": name };
        },
      ],
      [
        "activemq.message.queue.size",
        (name: string): FixtureAttributes => {
          return {
            "activemq.broker.name": "localhost",
            "activemq.destination.type": "queue",
            "messaging.destination.name": name,
          };
        },
      ],
    ];
    for (const [metricName, attributesOf] of brokerSeries) {
      for (const name of [podA, podB, instance]) {
        expect({
          metricName,
          name,
          resolved: resolveDatapoint(metricName, attributesOf(name)),
        }).toEqual({ metricName, name, resolved: null });
      }
      expect({
        metricName,
        destination:
          resolveDatapoint(metricName, attributesOf("submit-order"))
            ?.destination ?? null,
      }).toEqual({ metricName, destination: "submit-order" });
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
     * Client metrics carry semconv 1.30's joined RabbitMQ names but never
     * the routing key (no metric attribute): with a 1.26+ operation key —
     * the type here — a consumer's names its queue, a producer's its
     * exchange.
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
    /*
     * Attributes exactly as the Java agent records its consumer metrics
     * (MessagingMetricsAdvice): the operation name, never the operation
     * type. A consumer's three parts still name its queue — also an
     * exchange named with a colon, its empty routing key left out.
     */
    [
      "messaging.client.consumed.messages",
      { "messaging.operation.name": "process" },
      "direct_logs:warning:my_queue",
      "my_queue",
    ],
    [
      "messaging.process.duration",
      { "messaging.operation.name": "process" },
      "MyApp.Contracts:OrderSubmitted:billing",
      "billing",
    ],
    /*
     * ...and two parts split as its span's do, a producer's too: the
     * operation name is the one 1.26+ key the Java agent keeps on its
     * sent-messages, consumed-messages and process-duration metrics.
     */
    [
      "messaging.client.sent.messages",
      { "messaging.operation.name": "publish" },
      "orders.topic:orders.eu.created",
      "orders.topic",
    ],
    [
      "messaging.process.duration",
      { "messaging.operation.name": "process" },
      "direct_logs:warning",
      "warning",
    ],
    [
      "messaging.client.consumed.messages",
      { "messaging.operation.name": "process" },
      "logs:logs-audit",
      "logs-audit",
    ],
    [
      "messaging.client.consumed.messages",
      { "messaging.operation.name": "receive" },
      "invoices.direct:invoices-audit",
      "invoices-audit",
    ],
    // A blank operation name is none.
    [
      "messaging.client.sent.messages",
      { "messaging.operation.name": "  " },
      "orders.topic:orders.eu.created",
      "orders.topic:orders.eu.created",
    ],
    [
      "messaging.process.duration",
      { "messaging.operation.name": "" },
      "direct_logs:warning",
      "direct_logs:warning",
    ],
    // RabbitMQ.Client for .NET's protocol name: the exchange alone, as on its spans.
    [
      "messaging.client.consumed.messages",
      {
        "messaging.operation.name": "deliver",
        "network.protocol.name": "amqp",
      },
      "MyApp.Contracts:OrderSubmitted",
      "MyApp.Contracts:OrderSubmitted",
    ],
    [
      "messaging.client.consumed.messages",
      {
        "messaging.operation.name": "deliver",
        "network.protocol.name": "amqp",
      },
      "MassTransit:Fault--Sample.Contracts:SubmitOrder--",
      "MassTransit:Fault--Sample.Contracts:SubmitOrder--",
    ],
    /*
     * The one thing a datapoint cannot tell: a producer's two parts are
     * `{exchange}:{routing key}`, as the Java agent names every publish
     * with a routing key, or an exchange named with a colon published to
     * with an empty one — which its span tells apart by the routing-key
     * attribute. A datapoint takes the joined reading, whichever 1.26+ key
     * shows it.
     */
    [
      "messaging.client.sent.messages",
      { "messaging.operation.name": "publish" },
      "MyApp.Contracts:OrderSubmitted",
      "MyApp.Contracts",
    ],
    [
      "messaging.client.operation.duration",
      { "messaging.operation.type": "send" },
      "MyApp.Contracts:OrderSubmitted",
      "MyApp.Contracts",
    ],
    /*
     * Semconv joins three parts on a consumer only: a producer's three are
     * one exchange name, as its span says — MassTransit's Fault<T> exchange,
     * published to with an empty routing key.
     */
    [
      "messaging.client.sent.messages",
      { "messaging.operation.name": "publish" },
      "MassTransit:Fault--Sample.Contracts:SubmitOrder--",
      "MassTransit:Fault--Sample.Contracts:SubmitOrder--",
    ],
    [
      "messaging.client.operation.duration",
      {
        "messaging.operation.name": "publish",
        "messaging.operation.type": "send",
      },
      "MassTransit:Fault--Sample.Contracts:SubmitOrder--",
      "MassTransit:Fault--Sample.Contracts:SubmitOrder--",
    ],
    // An application's gauge states no direction: its three parts are one name.
    [
      "queue.size",
      {},
      "direct_logs:warning:my_queue",
      "direct_logs:warning:my_queue",
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
    /*
     * Three parts too, on a consumer as much as a producer: without a 1.26+
     * operation key a datapoint is read as its span would be — one name,
     * MassTransit's Fault<T> exchange among them.
     */
    [
      "messaging.receive.messages",
      { "messaging.operation": "receive" },
      "MassTransit:Fault--Sample.Contracts:SubmitOrder--",
      "MassTransit:Fault--Sample.Contracts:SubmitOrder--",
    ],
    [
      "messaging.process.duration",
      { "messaging.operation": "process" },
      "direct_logs:warning:my_queue",
      "direct_logs:warning:my_queue",
    ],
    [
      "messaging.client.consumed.messages",
      {},
      "direct_logs:warning:my_queue",
      "direct_logs:warning:my_queue",
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

/*
 * The Java agent is the one instrumentation found recording RabbitMQ client
 * metrics — rabbitmq-2.7 and spring-rabbit-1.0, from 2.31.0 — and only in
 * its opt-in mode, whose names join exchange, routing key and queue. Here
 * it is as its source has it (opentelemetry-java-instrumentation): the name
 * a span and its metrics share (RabbitInstrumenterHelper
 * .producerDestinationName / .consumerDestinationName), what each
 * operation's span carries (MessagingAttributesExtractor; the routing key
 * only when non-empty), the metrics each operation records
 * (RabbitSingletons), and what each metric keeps of the span's attributes
 * (MessagingMetricsAdvice: no destination when it is anonymous, never the
 * routing key, the operation type on messaging.client.operation.duration
 * alone). Whatever the route, a span and every metric of its operation
 * resolve alike, to the queue the research says.
 */
describe("a Java agent RabbitMQ span and the client metrics of its operation", () => {
  // MessagingMetricsAdvice.buildAttributes, instrument by instrument.
  const SENT_MESSAGES_ADVICE: ReadonlyArray<string> = [
    "messaging.operation.name",
    "messaging.system",
    "error.type",
    "messaging.destination.name",
    "messaging.destination.template",
    "messaging.destination.partition.id",
    "server.address",
    "server.port",
  ];
  const CONSUMER_METRIC_ADVICE: ReadonlyArray<string> = [
    ...SENT_MESSAGES_ADVICE,
    "messaging.consumer.group.name",
    "messaging.destination.subscription.name",
  ];
  const METRIC_ADVICE: ReadonlyMap<string, ReadonlyArray<string>> = new Map<
    string,
    ReadonlyArray<string>
  >([
    [
      "messaging.client.operation.duration",
      [...CONSUMER_METRIC_ADVICE, "messaging.operation.type"],
    ],
    ["messaging.client.sent.messages", SENT_MESSAGES_ADVICE],
    ["messaging.client.consumed.messages", CONSUMER_METRIC_ADVICE],
    ["messaging.process.duration", CONSUMER_METRIC_ADVICE],
  ]);

  interface AgentOperation {
    // messaging.operation.name and messaging.operation.type.
    name: string;
    type: string;
    kind: string;
    publishes: boolean;
    // What RabbitSingletons records for it.
    metrics: ReadonlyArray<string>;
  }

  const PUBLISH: AgentOperation = {
    name: "publish",
    type: "send",
    kind: "SPAN_KIND_PRODUCER",
    publishes: true,
    metrics: [
      "messaging.client.operation.duration",
      "messaging.client.sent.messages",
    ],
  };

  const OPERATIONS: ReadonlyArray<AgentOperation> = [
    PUBLISH,
    // basic.get
    {
      name: "receive",
      type: "receive",
      kind: "SPAN_KIND_CLIENT",
      publishes: false,
      metrics: [
        "messaging.client.operation.duration",
        "messaging.client.consumed.messages",
      ],
    },
    // A delivery to a consumer.
    {
      name: "process",
      type: "process",
      kind: "SPAN_KIND_CONSUMER",
      publishes: false,
      metrics: [
        "messaging.process.duration",
        "messaging.client.consumed.messages",
      ],
    },
  ];

  interface Route {
    label: string;
    exchange: string;
    routingKey: string;
    queue: string;
    // The queue the research says a publisher's and a consumer's name.
    publishesTo: string | null;
    consumesFrom: string | null;
  }

  const ROUTES: ReadonlyArray<Route> = [
    {
      label: "the default exchange",
      exchange: "",
      routingKey: "invoices",
      queue: "invoices",
      publishesTo: "invoices",
      consumesFrom: "invoices",
    },
    {
      label: "a topic exchange",
      exchange: "orders.topic",
      routingKey: "orders.eu.created",
      queue: "orders-eu",
      publishesTo: "orders.topic",
      consumesFrom: "orders-eu",
    },
    {
      label: "a direct exchange to the queue named by its key",
      exchange: "direct_logs",
      routingKey: "warning",
      queue: "warning",
      publishesTo: "direct_logs",
      consumesFrom: "warning",
    },
    {
      label: "a fanout exchange",
      exchange: "logs",
      routingKey: "",
      queue: "logs-audit",
      publishesTo: "logs",
      consumesFrom: "logs-audit",
    },
    {
      label: "the default exchange to a server-named queue",
      exchange: "",
      routingKey: "amq.gen-JzTY20BRgKO-HjmUJj0wLg",
      queue: "amq.gen-JzTY20BRgKO-HjmUJj0wLg",
      publishesTo: null,
      consumesFrom: null,
    },
  ];

  /*
   * A MassTransit message type's exchange, named with a colon, bound with
   * an empty routing key. Its consumers are routed above; its publishers
   * are the one case a metric cannot tell apart (see the last test).
   */
  const MASSTRANSIT_ROUTE: Route = {
    label: "a MassTransit message-type exchange",
    exchange: "Contoso.Billing.Contracts:InvoiceIssued",
    routingKey: "",
    queue: "invoice-issued",
    publishesTo: "Contoso.Billing.Contracts:InvoiceIssued",
    consumesFrom: "invoice-issued",
  };

  // appendDestinationPart: the non-empty parts, joined with ":".
  function joinDestination(parts: ReadonlyArray<string>): string {
    return parts
      .filter((part: string): boolean => {
        return part.length > 0;
      })
      .join(":");
  }

  // The part of isGeneratedQueueName these routes need.
  function isGeneratedQueueName(name: string): boolean {
    return name.startsWith("amq.gen-");
  }

  function spanAttributes(
    operation: AgentOperation,
    route: Route,
  ): FixtureAttributes {
    const destination: string = operation.publishes
      ? joinDestination([route.exchange, route.routingKey]) || "amq.default"
      : joinDestination([
          route.exchange,
          route.routingKey,
          route.queue === route.routingKey ? "" : route.queue,
        ]);
    const anonymous: boolean = operation.publishes
      ? route.exchange === "" && isGeneratedQueueName(route.routingKey)
      : isGeneratedQueueName(route.queue);
    return {
      "messaging.system": "rabbitmq",
      ...(destination ? { "messaging.destination.name": destination } : {}),
      ...(anonymous ? { "messaging.destination.anonymous": true } : {}),
      "messaging.operation.name": operation.name,
      "messaging.operation.type": operation.type,
      ...(route.routingKey
        ? { "messaging.rabbitmq.destination.routing_key": route.routingKey }
        : {}),
      ...(operation.publishes
        ? {}
        : { "messaging.rabbitmq.message.delivery_tag": 7 }),
      "server.address": "rabbitmq.internal",
      "server.port": 5672,
      "network.peer.address": "10.0.3.17",
      "network.peer.port": 5672,
    };
  }

  // MessagingMetricsAdvice.filterAttributes, then the instrument's advice.
  function metricAttributes(
    metricName: string,
    span: FixtureAttributes,
  ): FixtureAttributes {
    const dropsName: boolean =
      span["messaging.destination.template"] !== undefined ||
      span["messaging.destination.anonymous"] === true ||
      span["messaging.destination.temporary"] === true;
    const kept: FixtureAttributes = {};
    for (const key of METRIC_ADVICE.get(metricName) || []) {
      if (
        span[key] !== undefined &&
        !(dropsName && key === "messaging.destination.name")
      ) {
        kept[key] = span[key];
      }
    }
    return kept;
  }

  function resolveSpan(
    operation: AgentOperation,
    span: FixtureAttributes,
  ): ResolvedMessagingDestination | null {
    return resolveMessagingSpan({
      getAttribute: (key: string): unknown => {
        return span[key];
      },
      kind: operation.kind,
    });
  }

  const CASES: Array<[string, AgentOperation, Route, string]> = [];
  for (const operation of OPERATIONS) {
    const routes: ReadonlyArray<Route> = operation.publishes
      ? ROUTES
      : [...ROUTES, MASSTRANSIT_ROUTE];
    for (const route of routes) {
      for (const metricName of operation.metrics) {
        CASES.push([
          `${operation.name} through ${route.label}: ${metricName}`,
          operation,
          route,
          metricName,
        ]);
      }
    }
  }

  test("the metrics keep no routing key, and the operation type only on the operation duration", () => {
    for (const [metricName, advice] of METRIC_ADVICE) {
      expect({
        metricName,
        routingKey: advice.includes(
          "messaging.rabbitmq.destination.routing_key",
        ),
        operationName: advice.includes("messaging.operation.name"),
        operationType: advice.includes("messaging.operation.type"),
      }).toEqual({
        metricName,
        routingKey: false,
        operationName: true,
        operationType: metricName === "messaging.client.operation.duration",
      });
    }
  });

  test.each(CASES)(
    "%s names the queue its span does",
    (
      _name: string,
      operation: AgentOperation,
      route: Route,
      metricName: string,
    ) => {
      const span: FixtureAttributes = spanAttributes(operation, route);
      const fromSpan: ResolvedMessagingDestination | null = resolveSpan(
        operation,
        span,
      );
      expect(fromSpan?.destination ?? null).toBe(
        operation.publishes ? route.publishesTo : route.consumesFrom,
      );
      expect(
        resolveDatapoint(metricName, metricAttributes(metricName, span)),
      ).toEqual(fromSpan);
    },
  );

  test("the names are the agent's: joined on both sides, the default exchange and a key equal to the queue left out", () => {
    const names: Array<unknown> = [PUBLISH, OPERATIONS[2]!].map(
      (operation: AgentOperation): unknown => {
        return ROUTES.map((route: Route): unknown => {
          return spanAttributes(operation, route)["messaging.destination.name"];
        });
      },
    );
    expect(names).toEqual([
      [
        "invoices",
        "orders.topic:orders.eu.created",
        "direct_logs:warning",
        "logs",
        "amq.gen-JzTY20BRgKO-HjmUJj0wLg",
      ],
      [
        "invoices",
        "orders.topic:orders.eu.created:orders-eu",
        "direct_logs:warning",
        "logs:logs-audit",
        "amq.gen-JzTY20BRgKO-HjmUJj0wLg",
      ],
    ]);
  });

  /*
   * A publish to an exchange named with a colon, with no routing key: its
   * span knows the key is empty (the attribute is missing), so the name is
   * one exchange; its metrics cannot know, and read `{exchange}:{routing
   * key}` like every other publish's — both of them alike.
   */
  test("a publish to an exchange named with a colon: its metrics agree with each other, not with its span", () => {
    const span: FixtureAttributes = spanAttributes(PUBLISH, MASSTRANSIT_ROUTE);
    expect(resolveSpan(PUBLISH, span)?.destination).toBe(
      "Contoso.Billing.Contracts:InvoiceIssued",
    );
    expect(
      PUBLISH.metrics.map((metricName: string): string | null => {
        return (
          resolveDatapoint(metricName, metricAttributes(metricName, span))
            ?.destination ?? null
        );
      }),
    ).toEqual(["Contoso.Billing.Contracts", "Contoso.Billing.Contracts"]);
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

  /*
   * A RabbitMQ datapoint's joined name splits by the 1.26+ operation key it
   * carries, so the cron must group by both keys, as ingest's memo does.
   */
  test("holds both operation keys that decide how a RabbitMQ name splits", () => {
    for (const key of [
      "messaging.operation.type",
      "messaging.operation.name",
    ]) {
      expect({
        key,
        spans: MESSAGING_RESOLVER_INPUT_ATTRIBUTES.includes(key),
        datapoints: MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES.includes(key),
      }).toEqual({ key, spans: true, datapoints: true });
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

describe("a known limit: a RabbitMQ queue named with a colon, reached through the default exchange", () => {
  /*
   * The OpenTelemetry Java agent (opt-in messaging conventions) names a
   * default-exchange publish and delivery after the routing key, which is
   * the queue — here `app:orders`, colon and all — and its spans carry that
   * key as messaging.rabbitmq.destination.routing_key, so a span resolves to
   * the whole name. Its client metrics drop the routing-key attribute
   * (MessagingMetricsAdvice), and without it `app:orders` reads exactly like
   * the `{exchange}:{routing key}` name the agent gives every other publish,
   * so a datapoint takes the far commoner joined reading. Both readings lose
   * only a client metric's attachment to a queue — client metrics never
   * create queues — and this pins which one is lost, so a change to it is a
   * decision.
   */
  const COMMON: FixtureAttributes = {
    "messaging.system": "rabbitmq",
    "messaging.destination.name": "app:orders",
  };

  test("the spans resolve to the whole queue name", () => {
    const publish: ResolvedMessagingDestination | null = resolveMessagingSpan({
      getAttribute: (key: string): unknown => {
        return {
          ...COMMON,
          "messaging.operation.type": "send",
          "messaging.operation.name": "publish",
          "messaging.rabbitmq.destination.routing_key": "app:orders",
        }[key];
      },
      kind: "SPAN_KIND_PRODUCER",
    });
    const deliver: ResolvedMessagingDestination | null = resolveMessagingSpan({
      getAttribute: (key: string): unknown => {
        return {
          ...COMMON,
          "messaging.operation.type": "process",
          "messaging.operation.name": "process",
          "messaging.rabbitmq.destination.routing_key": "app:orders",
        }[key];
      },
      kind: "SPAN_KIND_CONSUMER",
    });
    expect(publish?.destination).toBe("app:orders");
    expect(deliver?.destination).toBe("app:orders");
  });

  test("the client metrics, which carry no routing key, take the joined reading", () => {
    const sent: ResolvedMessagingDestination | null = resolveDatapoint(
      "messaging.client.sent.messages",
      { ...COMMON, "messaging.operation.name": "publish" },
    );
    const consumed: ResolvedMessagingDestination | null = resolveDatapoint(
      "messaging.client.consumed.messages",
      { ...COMMON, "messaging.operation.name": "receive" },
    );
    // `{exchange}:{routing key}` on the publishing side: the exchange.
    expect(sent?.destination).toBe("app");
    // `{exchange}:{queue}` on the consuming side: the queue part.
    expect(consumed?.destination).toBe("orders");
  });
});
