import { describe, expect, jest, test } from "@jest/globals";

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it, and DatabaseService (behind
 * MessageQueueService, whose manual-create resolution the form's preview is
 * pinned to below) imports it.
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

import {
  MESSAGE_QUEUE_DELETE_WARNING,
  MESSAGE_QUEUE_NAME_HELP,
  MESSAGE_QUEUE_NOT_FOUND_MESSAGE,
  MessageQueueManualInput,
  MessageQueueManualPreview,
  MessageQueueOption,
  getMessageQueueBrokerLabel,
  getMessageQueueDestinationHint,
  getMessageQueueDiscoverySourceOptions,
  getMessageQueueLastSeenText,
  getMessageQueueNamespaceHint,
  getMessageQueueSystemLabel,
  getMessagingSystemOptions,
  isMessageQueueFound,
  isNamespaceScopedMessagingSystem,
  previewManualMessageQueue,
  validateMessageQueueDestination,
  validateMessageQueueNamespace,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/Utils/MessageQueuePresentation";
import { getMessageQueueScopeKeys } from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueTelemetryScope";
import {
  ManualMessageQueue,
  resolveManualMessageQueue,
} from "../../../Server/Services/MessageQueueService";
import {
  MESSAGE_QUEUE_DISCOVERY_SOURCES,
  getMessageQueueDiscoverySourceLabel,
} from "../../../Models/DatabaseModels/MessageQueue";
import {
  MESSAGING_SYSTEMS,
  MessagingSystemDescriptor,
} from "../../../Types/MessageQueue/MessagingSystem";
import OneUptimeDate from "../../../Types/Date";

/*
 * How the Queues pages describe a row, and what the create form checks
 * before it sends one. The create form's preview chains the catalog calls
 * the server's manual create chains (resolveManualMessageQueue, which the
 * browser cannot import), so the agreement table below runs BOTH over the
 * same inputs: whatever the form previews is what the server stores, and
 * whatever the form refuses the server refuses too.
 */

describe("messaging system options", () => {
  const options: Array<MessageQueueOption> = getMessagingSystemOptions();

  test("offer every catalog system once, by its canonical value", () => {
    expect(
      options
        .map((option: MessageQueueOption): string => {
          return option.value;
        })
        .sort(),
    ).toEqual(
      MESSAGING_SYSTEMS.map((descriptor: MessagingSystemDescriptor): string => {
        return descriptor.system;
      }).sort(),
    );
  });

  test("label each one with its display name and the value spans carry", () => {
    for (const descriptor of MESSAGING_SYSTEMS) {
      expect(
        options.find((option: MessageQueueOption): boolean => {
          return option.value === descriptor.system;
        })?.label,
      ).toBe(`${descriptor.displayName} (${descriptor.system})`);
    }
  });

  test("are alphabetical by label", () => {
    const labels: Array<string> = options.map(
      (option: MessageQueueOption): string => {
        return option.label;
      },
    );
    expect(labels).toEqual(
      [...labels].sort((a: string, b: string): number => {
        return a.localeCompare(b);
      }),
    );
    expect(labels[0]).toBe("Amazon SNS (aws.sns)");
  });
});

describe("the System cell", () => {
  test.each([
    ["kafka", "Apache Kafka"],
    ["AmazonSQS", "Amazon SQS"],
    ["azure_servicebus", "Azure Service Bus"],
    ["jms", "JMS"],
    ["activemq", "Apache ActiveMQ"],
    ["ibmmq", "ibmmq"],
    [" solace ", "solace"],
    ["", "—"],
    [null, "—"],
    [undefined, "—"],
  ])("%p reads %p", (system: string | null | undefined, label: string) => {
    expect(getMessageQueueSystemLabel(system)).toBe(label);
  });
});

describe("namespace-scoped systems", () => {
  test("are exactly the catalog's azure-namespace systems, aliases included", () => {
    for (const descriptor of MESSAGING_SYSTEMS) {
      const scoped: boolean = descriptor.brokerScope === "azure-namespace";
      expect([
        descriptor.system,
        isNamespaceScopedMessagingSystem(descriptor.system),
      ]).toEqual([descriptor.system, scoped]);
      for (const alias of descriptor.aliases) {
        expect([alias, isNamespaceScopedMessagingSystem(alias)]).toEqual([
          alias,
          scoped,
        ]);
      }
    }
    expect(isNamespaceScopedMessagingSystem("servicebus")).toBe(true);
    expect(isNamespaceScopedMessagingSystem("eventhubs")).toBe(true);
    expect(isNamespaceScopedMessagingSystem("eventgrid")).toBe(false);
  });

  test.each([undefined, null, "", "ibmmq", 42, "constructor"])(
    "%p is not namespace-scoped",
    (system: unknown) => {
      expect(isNamespaceScopedMessagingSystem(system)).toBe(false);
    },
  );
});

describe("discovery source options", () => {
  test("follow the model's sources and labels, in order", () => {
    expect(getMessageQueueDiscoverySourceOptions()).toEqual(
      MESSAGE_QUEUE_DISCOVERY_SOURCES.map((source: string) => {
        return {
          value: source,
          label: getMessageQueueDiscoverySourceLabel(source),
        };
      }),
    );
    expect(
      getMessageQueueDiscoverySourceOptions().map(
        (option: MessageQueueOption): string => {
          return option.label;
        },
      ),
    ).toEqual(["Application traces", "Broker metrics", "Added manually"]);
  });
});

describe("the Broker cell", () => {
  test("names the Azure namespace first: it is part of the identity", () => {
    expect(
      getMessageQueueBrokerLabel({
        brokerScope: "shop-prod",
        brokerAddress: "shop-prod.servicebus.windows.net:5671",
      }),
    ).toEqual({ text: "shop-prod", title: "Azure namespace shop-prod" });
  });

  test("otherwise the address the telemetry reported", () => {
    expect(
      getMessageQueueBrokerLabel({
        brokerScope: "",
        brokerAddress: " kafka-1.internal:9092 ",
      }),
    ).toEqual({
      text: "kafka-1.internal:9092",
      title: "Broker address kafka-1.internal:9092",
    });
  });

  test.each([
    [{}],
    [{ brokerScope: null, brokerAddress: null }],
    [{ brokerScope: "  ", brokerAddress: "" }],
    [null],
    [undefined],
  ])("is empty for %p", (source: unknown) => {
    expect(getMessageQueueBrokerLabel(source as never)).toEqual({
      text: "",
      title: "",
    });
  });
});

describe("the Last seen cell", () => {
  test("says Never for a queue nothing has seen", () => {
    expect(getMessageQueueLastSeenText(null)).toEqual({
      text: "Never",
      title: "",
    });
    expect(getMessageQueueLastSeenText(undefined)).toEqual({
      text: "Never",
      title: "",
    });
  });

  test("shows a dash for a value that is not a date", () => {
    expect(getMessageQueueLastSeenText("not a date")).toEqual({
      text: "—",
      title: "",
    });
  });

  test("is relative, with the full time on hover, for a Date or a string", () => {
    const seen: Date = OneUptimeDate.addRemoveMinutes(
      OneUptimeDate.getCurrentDate(),
      -5,
    );
    const expected: { text: string; title: string } = {
      text: OneUptimeDate.fromNow(seen),
      title: OneUptimeDate.getDateAsLocalFormattedString(seen),
    };

    expect(getMessageQueueLastSeenText(seen)).toEqual(expected);
    expect(getMessageQueueLastSeenText(seen.toISOString())).toEqual(expected);
    expect(expected.text).toContain("minutes ago");
  });
});

describe("the view's not-found guard", () => {
  test.each([
    [null, false],
    [undefined, false],
    [{}, false],
    [{ queueIdentifier: "" }, false],
    [{ queueIdentifier: "   " }, false],
    [{ queueIdentifier: null }, false],
    [{ queueIdentifier: "kafka||orders" }, true],
    [{ queueIdentifier: "servicebus|shop-prod|orders" }, true],
  ])("%p found: %p", (item: unknown, found: boolean) => {
    expect(isMessageQueueFound(item as never)).toBe(found);
  });

  test("names the queue in its message", () => {
    expect(MESSAGE_QUEUE_NOT_FOUND_MESSAGE).toBe("Queue not found.");
  });
});

describe("the copy", () => {
  test("the delete warning points at archiving", () => {
    expect(MESSAGE_QUEUE_DELETE_WARNING).toContain("comes back");
    expect(MESSAGE_QUEUE_DELETE_WARNING).toContain("archive it instead");
    expect(MESSAGE_QUEUE_DELETE_WARNING).toContain("Settings → Archive");
  });

  test("the delete warning keeps the traces and metrics: they follow the queue's identity, not its row", () => {
    expect(MESSAGE_QUEUE_DELETE_WARNING).toContain(
      "without the name, description, labels and owners people gave it",
    );
    expect(MESSAGE_QUEUE_DELETE_WARNING).toContain(
      "its traces and metrics are still there",
    );
    expect(MESSAGE_QUEUE_DELETE_WARNING).not.toContain("history");

    /*
     * Why: the row discovery re-creates has the same identifier, and the
     * tabs scope telemetry by the key of that identifier alone — whatever
     * the new row's id or name.
     */
    const projectId: string = "5f1b0a2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c";
    const deleted: Array<string> = getMessageQueueScopeKeys({
      projectId,
      queueIdentifier: "servicebus|shop-prod|orders",
      name: "Order events",
    });
    const recreated: Array<string> = getMessageQueueScopeKeys({
      projectId,
      queueIdentifier: "servicebus|shop-prod|orders",
      name: "orders",
    });
    expect(deleted).toHaveLength(1);
    expect(recreated).toEqual(deleted);
  });

  test("the name help says renaming is safe", () => {
    expect(MESSAGE_QUEUE_NAME_HELP).toContain("Renaming is safe");
    expect(MESSAGE_QUEUE_NAME_HELP).toContain("never by name");
  });
});

/*
 * The agreement table: every row runs through the form's preview AND the
 * server's resolution. The rows cover each normalization discovery applies
 * to a typed destination, every refusal, and the system / namespace rules.
 */
const UUID: string = "7f1c2a9e-4b1d-4c3e-9f1a-2b3c4d5e6f70";

const AGREEMENT_CASES: Array<[string, MessageQueueManualInput]> = [
  ["a Kafka topic", { messagingSystem: "kafka", destinationName: "orders" }],
  [
    "a padded Kafka topic",
    { messagingSystem: " kafka ", destinationName: "  Orders.Created  " },
  ],
  [
    "an SQS queue URL",
    {
      messagingSystem: "aws_sqs",
      destinationName:
        "https://sqs.us-east-1.amazonaws.com/123456789012/orders",
    },
  ],
  [
    "an SQS queue ARN",
    {
      messagingSystem: "aws_sqs",
      destinationName: "arn:aws:sqs:us-east-1:123456789012:orders",
    },
  ],
  [
    "an SQS alias spelling",
    { messagingSystem: "AmazonSQS", destinationName: "orders" },
  ],
  [
    "an SNS topic ARN",
    {
      messagingSystem: "aws.sns",
      destinationName: "arn:aws:sns:us-east-1:123456789012:order-events",
    },
  ],
  [
    "an SNS phone number",
    { messagingSystem: "aws.sns", destinationName: "+15555550123" },
  ],
  [
    "a Pub/Sub topic path",
    {
      messagingSystem: "gcp_pubsub",
      destinationName: "projects/shop/topics/orders",
    },
  ],
  [
    "a Pub/Sub subscription path",
    {
      messagingSystem: "gcp_pubsub",
      destinationName: "projects/shop/subscriptions/orders-billing",
    },
  ],
  [
    "a Pulsar short name",
    { messagingSystem: "pulsar", destinationName: "orders" },
  ],
  [
    "a Pulsar partition",
    { messagingSystem: "pulsar", destinationName: "orders-partition-3" },
  ],
  [
    "a Pulsar system topic",
    {
      messagingSystem: "pulsar",
      destinationName: "persistent://public/default/__change_events",
    },
  ],
  [
    "an ActiveMQ queue:// name",
    { messagingSystem: "activemq", destinationName: "queue://orders" },
  ],
  [
    "an Artemis alias",
    { messagingSystem: "Artemis", destinationName: "orders" },
  ],
  ["a JMS queue", { messagingSystem: "jms", destinationName: "orders" }],
  [
    "a JMS temporary queue",
    { messagingSystem: "jms", destinationName: "temp-queue://ID:abc-1:1:1" },
  ],
  [
    "a RabbitMQ generated queue",
    {
      messagingSystem: "rabbitmq",
      destinationName: "amq.gen-JzTY20BRgKO-HjmUJj0wLg",
    },
  ],
  [
    "a RabbitMQ reply-to",
    {
      messagingSystem: "rabbitmq",
      destinationName: "amq.rabbitmq.reply-to.g1h2AA",
    },
  ],
  [
    "a RabbitMQ exchange:routing-key:queue name",
    { messagingSystem: "rabbitmq", destinationName: "shop:new-order:orders" },
  ],
  [
    "a NATS inbox",
    { messagingSystem: "nats", destinationName: "_INBOX.abcdef.1" },
  ],
  [
    "a UUID inside a name",
    { messagingSystem: "kafka", destinationName: `reply-${UUID}` },
  ],
  ["a bare UUID", { messagingSystem: "kafka", destinationName: UUID }],
  [
    "a placeholder",
    { messagingSystem: "kafka", destinationName: "(temporary)" },
  ],
  [
    "a list of names",
    { messagingSystem: "kafka", destinationName: '["orders","payments"]' },
  ],
  [
    "a name with a control character",
    { messagingSystem: "kafka", destinationName: "orders\u0007" },
  ],
  [
    "a 256-character name",
    { messagingSystem: "kafka", destinationName: "o".repeat(256) },
  ],
  [
    "a 255-character name",
    { messagingSystem: "kafka", destinationName: "o".repeat(255) },
  ],
  [
    "a Service Bus queue in a namespace",
    {
      messagingSystem: "servicebus",
      destinationName: "orders",
      brokerScope: "shop-prod",
    },
  ],
  [
    "a Service Bus namespace host",
    {
      messagingSystem: "servicebus",
      destinationName: "orders",
      brokerScope: "Shop-Prod.servicebus.windows.net",
    },
  ],
  [
    "a Service Bus dead-letter path",
    {
      messagingSystem: "servicebus",
      destinationName: "orders/$DeadLetterQueue",
      brokerScope: "shop-prod",
    },
  ],
  [
    "a Service Bus subscription path",
    {
      messagingSystem: "azure_servicebus",
      destinationName: "orders/Subscriptions/billing",
      brokerScope: "shop-prod",
    },
  ],
  [
    "an Event Hubs consumer-group path",
    {
      messagingSystem: "eventhubs",
      destinationName: "telemetry/ConsumerGroups/$Default/Partitions/3",
      brokerScope: "shop-prod",
    },
  ],
  [
    "an invalid namespace",
    {
      messagingSystem: "servicebus",
      destinationName: "orders",
      brokerScope: "my namespace",
    },
  ],
  [
    "a Service Bus queue without a namespace",
    { messagingSystem: "servicebus", destinationName: "orders" },
  ],
  [
    "a namespace sent for Kafka (ignored)",
    {
      messagingSystem: "kafka",
      destinationName: "orders",
      brokerScope: "shop-prod",
    },
  ],
  [
    "an invalid namespace sent for Kafka (ignored)",
    {
      messagingSystem: "kafka",
      destinationName: "orders",
      brokerScope: "not a namespace",
    },
  ],
  [
    "a long-tail system",
    { messagingSystem: "ibmmq", destinationName: "DEV.QUEUE.1" },
  ],
  [
    "Spring Integration",
    { messagingSystem: "spring_integration", destinationName: "orders" },
  ],
  [
    "a malformed system",
    { messagingSystem: "My Broker", destinationName: "orders" },
  ],
  ["no system", { messagingSystem: "", destinationName: "orders" }],
  ["no destination", { messagingSystem: "kafka", destinationName: "   " }],
  ["nothing", {}],
  [
    "non-string values",
    { messagingSystem: 42, destinationName: { name: "orders" } },
  ],
];

describe("the create form's preview agrees with the server's manual create", () => {
  test.each(AGREEMENT_CASES)(
    "%s",
    (_name: string, input: MessageQueueManualInput) => {
      let server: ManualMessageQueue | null = null;
      try {
        server = resolveManualMessageQueue({
          messagingSystem: input.messagingSystem,
          destinationName: input.destinationName,
          brokerScope: input.brokerScope,
        });
      } catch {
        server = null;
      }

      const preview: MessageQueueManualPreview | null =
        previewManualMessageQueue(input);

      expect(preview).toEqual(server);
    },
  );

  test("the table exercises both outcomes", () => {
    let accepted: number = 0;
    let refused: number = 0;
    for (const [, input] of AGREEMENT_CASES) {
      if (previewManualMessageQueue(input)) {
        accepted++;
      } else {
        refused++;
      }
    }
    expect(accepted).toBeGreaterThanOrEqual(15);
    expect(refused).toBeGreaterThanOrEqual(12);
  });

  test("an SQS URL is stored by its queue name, keyed on the canonical system", () => {
    expect(
      previewManualMessageQueue({
        messagingSystem: "AmazonSQS",
        destinationName:
          "https://sqs.us-east-1.amazonaws.com/123456789012/Orders",
      }),
    ).toEqual({
      system: "aws_sqs",
      destination: "Orders",
      brokerScope: "",
      queueIdentifier: "aws_sqs||orders",
    });
  });

  test("an ActiveMQ queue is keyed on the JMS family but keeps its own system", () => {
    expect(
      previewManualMessageQueue({
        messagingSystem: "activemq",
        destinationName: "queue://orders",
      }),
    ).toEqual({
      system: "activemq",
      destination: "orders",
      brokerScope: "",
      queueIdentifier: "jms||orders",
    });
  });

  test("a Service Bus namespace host is reduced to its namespace", () => {
    expect(
      previewManualMessageQueue({
        messagingSystem: "servicebus",
        destinationName: "orders",
        brokerScope: "Shop-Prod.servicebus.windows.net",
      }),
    ).toEqual({
      system: "servicebus",
      destination: "orders",
      brokerScope: "shop-prod",
      queueIdentifier: "servicebus|shop-prod|orders",
    });
  });

  test("UUIDs are templated like discovery templates them", () => {
    expect(
      previewManualMessageQueue({
        messagingSystem: "kafka",
        destinationName: `reply-${UUID}`,
      })?.destination,
    ).toBe("reply-{uuid}");
  });
});

describe("the Destination field's check", () => {
  test("says nothing until a system and a destination are filled in", () => {
    expect(validateMessageQueueDestination({})).toBeNull();
    expect(
      validateMessageQueueDestination({ messagingSystem: "kafka" }),
    ).toBeNull();
    expect(
      validateMessageQueueDestination({ destinationName: "amq.gen-abc" }),
    ).toBeNull();
    expect(
      validateMessageQueueDestination({
        messagingSystem: "kafka",
        destinationName: "   ",
      }),
    ).toBeNull();
  });

  test("accepts what the server accepts", () => {
    expect(
      validateMessageQueueDestination({
        messagingSystem: "kafka",
        destinationName: "orders",
      }),
    ).toBeNull();
    expect(
      validateMessageQueueDestination({
        messagingSystem: "aws_sqs",
        destinationName:
          "https://sqs.us-east-1.amazonaws.com/123456789012/orders",
      }),
    ).toBeNull();
  });

  test.each([
    ["rabbitmq", "amq.gen-JzTY20BRgKO-HjmUJj0wLg"],
    ["nats", "_INBOX.abc.1"],
    ["kafka", "(temporary)"],
    ["kafka", UUID],
    ["kafka", "o".repeat(256)],
    ["jms", "temp-queue://ID:abc-1:1:1"],
  ])(
    "refuses a %s destination the server would refuse: %s",
    (system: string, destination: string) => {
      const message: string | null = validateMessageQueueDestination({
        messagingSystem: system,
        destinationName: destination,
      });
      expect(message).toContain("cannot be a queue");
      expect(message).toContain(`"${destination}"`);
      expect(() => {
        resolveManualMessageQueue({
          messagingSystem: system,
          destinationName: destination,
          brokerScope: "",
        });
      }).toThrow();
    },
  );

  test("leaves a bad namespace to the Namespace field", () => {
    expect(
      validateMessageQueueDestination({
        messagingSystem: "servicebus",
        destinationName: "orders",
        brokerScope: "my namespace",
      }),
    ).toBeNull();
  });
});

describe("the Namespace field's check", () => {
  test("is silent for other systems, and for an empty value", () => {
    expect(
      validateMessageQueueNamespace({
        messagingSystem: "kafka",
        brokerScope: "not a namespace",
      }),
    ).toBeNull();
    expect(
      validateMessageQueueNamespace({
        messagingSystem: "servicebus",
        brokerScope: "  ",
      }),
    ).toBeNull();
  });

  test.each([
    "shop-prod",
    "Shop-Prod",
    "shop-prod.servicebus.windows.net",
    "shop-prod.servicebus.usgovcloudapi.net",
  ])("accepts %p", (scope: string) => {
    expect(
      validateMessageQueueNamespace({
        messagingSystem: "eventhubs",
        brokerScope: scope,
      }),
    ).toBeNull();
  });

  test.each(["my namespace", "-shop", "shop_prod", "https://shop.example.com"])(
    "explains %p the way the server does",
    (scope: string) => {
      const message: string | null = validateMessageQueueNamespace({
        messagingSystem: "servicebus",
        brokerScope: scope,
      });
      expect(message).toContain("is not an Azure namespace name");
      expect(message).toContain("<namespace>.servicebus.windows.net");
      expect(() => {
        resolveManualMessageQueue({
          messagingSystem: "servicebus",
          destinationName: "orders",
          brokerScope: scope,
        });
      }).toThrow("is not an Azure namespace name");
    },
  );
});

describe("the fields' hints", () => {
  test("the Destination hint shows what a URL, ARN or path is saved as", () => {
    expect(
      getMessageQueueDestinationHint({
        messagingSystem: "aws_sqs",
        destinationName:
          "https://sqs.us-east-1.amazonaws.com/123456789012/orders",
      }),
    ).toBe(
      'Saved as "orders", the name OneUptime reads from this value in your telemetry.',
    );
    expect(
      getMessageQueueDestinationHint({
        messagingSystem: "pulsar",
        destinationName: "orders",
      }),
    ).toContain('"persistent://public/default/orders"');
  });

  test("the Destination hint says nothing when the value is stored as typed, or cannot be", () => {
    expect(
      getMessageQueueDestinationHint({
        messagingSystem: "kafka",
        destinationName: "orders",
      }),
    ).toBeNull();
    expect(
      getMessageQueueDestinationHint({
        messagingSystem: "kafka",
        destinationName: "  orders  ",
      }),
    ).toBeNull();
    expect(
      getMessageQueueDestinationHint({
        messagingSystem: "rabbitmq",
        destinationName: "amq.gen-JzTY20BRgKO-HjmUJj0wLg",
      }),
    ).toBeNull();
    expect(getMessageQueueDestinationHint({})).toBeNull();
  });

  test("the Namespace hint shows a host reduced to its namespace", () => {
    expect(
      getMessageQueueNamespaceHint({
        messagingSystem: "servicebus",
        brokerScope: "shop-prod.servicebus.windows.net",
      }),
    ).toBe('Saved as "shop-prod".');
    expect(
      getMessageQueueNamespaceHint({
        messagingSystem: "servicebus",
        brokerScope: "Shop-Prod",
      }),
    ).toBe('Saved as "shop-prod".');
  });

  test("the Namespace hint says nothing for a canonical, invalid or unused namespace", () => {
    expect(
      getMessageQueueNamespaceHint({
        messagingSystem: "servicebus",
        brokerScope: "shop-prod",
      }),
    ).toBeNull();
    expect(
      getMessageQueueNamespaceHint({
        messagingSystem: "servicebus",
        brokerScope: "my namespace",
      }),
    ).toBeNull();
    expect(
      getMessageQueueNamespaceHint({
        messagingSystem: "kafka",
        brokerScope: "shop-prod.servicebus.windows.net",
      }),
    ).toBeNull();
  });
});
