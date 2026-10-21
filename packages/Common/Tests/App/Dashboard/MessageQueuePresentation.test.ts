import { describe, expect, jest, test } from "@jest/globals";

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it, and DatabaseService (behind
 * MessageQueueService, whose manual create the form's refusals are held to
 * below) imports it.
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
  MessageQueueOption,
  canBrokerMetricsReachMessageQueue,
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
import { quoteManualMessageQueueInput } from "../../../Types/MessageQueue/MessageQueueManualIdentity";
import {
  MESSAGE_QUEUE_DISCOVERY_SOURCES,
  getMessageQueueDiscoverySourceLabel,
} from "../../../Models/DatabaseModels/MessageQueue";
import {
  MESSAGING_SYSTEMS,
  MessagingSystemDescriptor,
} from "../../../Types/MessageQueue/MessagingSystem";
import { parseMessageQueueIdentifier } from "../../../Types/MessageQueue/MessageQueueIdentity";
import OneUptimeDate from "../../../Types/Date";

/*
 * How the Queues pages describe a row, and what the create form checks
 * before it sends one. The form's preview and checks read the very check
 * the server's manual create applies (checkManualMessageQueue, shared in
 * Common/Types/MessageQueue/MessageQueueManualIdentity and tested there), so
 * they cannot drift from it. What is pinned here is how the form reads it:
 * which field each refusal belongs to, and that the form says what the
 * server's resolveManualMessageQueue throws, word for word.
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

/*
 * Whether a system's broker metrics can ever name a queue: the ONE rule the
 * Overview's Broker health section and the Documentation tab's guide both
 * follow (MessageQueueBrokerMetricsReach.test pins that they ask it). It is
 * spelled out per catalog system here rather than recomputed from the
 * catalog, so a catalog change that moves a system in or out of Broker
 * health fails this table and gets a look.
 */
describe("whether a system's broker metrics can reach a queue", () => {
  /*
   * [a queue with a namespace, a queue without one, no queue]. Curated
   * metrics that name no namespace reach every queue of their system.
   * Azure Monitor names the namespace of every metric, so Service Bus and
   * Event Hubs metrics reach only a queue with one. JMS names no broker,
   * NATS reports JetStream streams rather than subjects, Event Grid its
   * topics and event subscriptions, and BullMQ's jobs live in Redis: none
   * of their metrics names a queue.
   */
  const EXPECTED: Record<string, [boolean, boolean, boolean]> = {
    kafka: [true, true, true],
    rabbitmq: [true, true, true],
    activemq: [true, true, true],
    jms: [false, false, false],
    aws_sqs: [true, true, true],
    "aws.sns": [true, true, true],
    gcp_pubsub: [true, true, true],
    servicebus: [true, false, true],
    eventhubs: [true, false, true],
    eventgrid: [false, false, false],
    pulsar: [true, true, true],
    rocketmq: [true, true, true],
    nats: [false, false, false],
    bullmq: [false, false, false],
  };

  function reach(system: string): [boolean, boolean, boolean] {
    return [
      canBrokerMetricsReachMessageQueue(system, { brokerScope: "orders-prod" }),
      canBrokerMetricsReachMessageQueue(system, { brokerScope: "" }),
      canBrokerMetricsReachMessageQueue(system),
    ];
  }

  test("the table covers the whole catalog", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(
      MESSAGING_SYSTEMS.map((descriptor: MessagingSystemDescriptor): string => {
        return descriptor.system;
      }).sort(),
    );
  });

  test.each(
    MESSAGING_SYSTEMS.map(
      (
        descriptor: MessagingSystemDescriptor,
      ): [string, MessagingSystemDescriptor] => {
        return [descriptor.system, descriptor];
      },
    ),
  )(
    "%s, and each of its aliases",
    (system: string, descriptor: MessagingSystemDescriptor) => {
      expect(reach(system)).toEqual(EXPECTED[system]);
      for (const alias of descriptor.aliases) {
        expect([alias, ...reach(alias)]).toEqual([alias, ...EXPECTED[system]!]);
      }
    },
  );

  test("a queue without a namespace: an empty, blank or missing brokerScope", () => {
    for (const queue of [
      {},
      { brokerScope: null },
      { brokerScope: undefined },
      { brokerScope: "" },
      { brokerScope: "   " },
    ]) {
      expect(canBrokerMetricsReachMessageQueue("servicebus", queue)).toBe(
        false,
      );
      expect(canBrokerMetricsReachMessageQueue("kafka", queue)).toBe(true);
    }
    expect(
      canBrokerMetricsReachMessageQueue("servicebus", {
        brokerScope: " orders-prod ",
      }),
    ).toBe(true);
  });

  test("no queue at all, null or undefined: only the system decides", () => {
    expect(canBrokerMetricsReachMessageQueue("servicebus", null)).toBe(true);
    expect(canBrokerMetricsReachMessageQueue("servicebus", undefined)).toBe(
      true,
    );
    expect(canBrokerMetricsReachMessageQueue("nats", null)).toBe(false);
  });

  test.each([null, undefined, "", "   ", "ibmmq", "spring_integration"])(
    "%p reaches no queue",
    (system: string | null | undefined) => {
      expect(canBrokerMetricsReachMessageQueue(system)).toBe(false);
      expect(
        canBrokerMetricsReachMessageQueue(system, {
          brokerScope: "orders-prod",
        }),
      ).toBe(false);
    },
  );

  test("Broker health asks with the queue's identity: its namespace decides", () => {
    // The section passes parseMessageQueueIdentifier(row.queueIdentifier).
    expect(
      canBrokerMetricsReachMessageQueue(
        "servicebus",
        parseMessageQueueIdentifier("servicebus|orders-prod|orders"),
      ),
    ).toBe(true);
    expect(
      canBrokerMetricsReachMessageQueue(
        "eventhubs",
        parseMessageQueueIdentifier("eventhubs||telemetry"),
      ),
    ).toBe(false);
    expect(
      canBrokerMetricsReachMessageQueue(
        "activemq",
        parseMessageQueueIdentifier("jms||orders"),
      ),
    ).toBe(true);
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

const UUID: string = "7f1c2a9e-4b1d-4c3e-9f1a-2b3c4d5e6f70";

/*
 * What the form previews for a typed queue: the identity the server's
 * manual create stores for it.
 */
describe("the create form's preview", () => {
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

  test("previews nothing the server would refuse", () => {
    const refused: Array<{
      messagingSystem?: string;
      destinationName?: string;
      brokerScope?: string;
    }> = [
      {},
      { messagingSystem: "kafka", destinationName: "   " },
      { messagingSystem: "spring_integration", destinationName: "orders" },
      { messagingSystem: "kafka", destinationName: "(temporary)" },
      { messagingSystem: "rabbitmq", destinationName: "amq.default" },
      {
        messagingSystem: "servicebus",
        destinationName: "orders",
        brokerScope: "my namespace",
      },
    ];
    for (const input of refused) {
      expect(previewManualMessageQueue(input)).toBeNull();
      expect(() => {
        resolveManualMessageQueue(input);
      }).toThrow();
    }
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
      // The server's refusal, word for word: a long value quoted clipped.
      expect(message).toContain(quoteManualMessageQueueInput(destination));
      expect(() => {
        resolveManualMessageQueue({
          messagingSystem: system,
          destinationName: destination,
          brokerScope: "",
        });
      }).toThrow(message!);
    },
  );

  /*
   * RabbitMQ queue names hold the separators a span's joined destination
   * uses (EasyNetQ's "Namespace.Type, Assembly_subscription", Hutch's
   * "app:billing:invoice_consumer"). The server takes a typed name whole;
   * the form's preview and hint must say the same, never a split name.
   */
  test.each([
    "Namespace.Type, Assembly_subscription",
    "app:billing:invoice_consumer",
  ])(
    "a RabbitMQ queue name is previewed as the server stores it, whole: %s",
    (destination: string) => {
      const values: { messagingSystem: string; destinationName: string } = {
        messagingSystem: "rabbitmq",
        destinationName: destination,
      };
      const server: ManualMessageQueue = resolveManualMessageQueue(values);
      expect(server.destination).toBe(destination);
      expect(previewManualMessageQueue(values)).toEqual({
        system: server.system,
        destination: server.destination,
        brokerScope: server.brokerScope,
        queueIdentifier: server.queueIdentifier,
      });
      expect(validateMessageQueueDestination(values)).toBeNull();
      // Stored as typed: no "Saved as" hint.
      expect(getMessageQueueDestinationHint(values)).toBeNull();
    },
  );

  test("RabbitMQ's default exchange is refused with the server's reason", () => {
    const values: { messagingSystem: string; destinationName: string } = {
      messagingSystem: "rabbitmq",
      destinationName: "amq.default",
    };
    const message: string | null = validateMessageQueueDestination(values);
    expect(message).toContain("is RabbitMQ's default exchange, not a queue");
    expect(() => {
      resolveManualMessageQueue(values);
    }).toThrow(message!);
  });

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
      // The server's refusal, word for word.
      expect(() => {
        resolveManualMessageQueue({
          messagingSystem: "servicebus",
          destinationName: "orders",
          brokerScope: scope,
        });
      }).toThrow(message!);
    },
  );

  test("quotes a long value the way the server does: its first 100 characters", () => {
    const scope: string = "shop-prod-".repeat(15);
    const message: string | null = validateMessageQueueNamespace({
      messagingSystem: "eventhubs",
      brokerScope: scope,
    });
    expect(message).toContain(quoteManualMessageQueueInput(scope));
    expect(message).not.toContain(scope);
    expect(() => {
      resolveManualMessageQueue({
        messagingSystem: "eventhubs",
        destinationName: "telemetry",
        brokerScope: scope,
      });
    }).toThrow(message!);
  });

  test("leaves a refused system or destination to its own field", () => {
    expect(
      validateMessageQueueNamespace({
        messagingSystem: "servicebus",
        destinationName: "(temporary)",
        brokerScope: "shop-prod",
      }),
    ).toBeNull();
    expect(
      validateMessageQueueNamespace({
        messagingSystem: "spring_integration",
        destinationName: "orders",
        brokerScope: "my namespace",
      }),
    ).toBeNull();
  });
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
