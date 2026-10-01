import {
  AZURE_SERVICE_BUS_HOST_SUFFIXES,
  buildMessageQueueDisplayName,
  buildMessageQueueIdentifier,
  canonicalizeMessageQueueBrokerScope,
  getAzureNamespaceFromHost,
  MESSAGE_QUEUE_DISPLAY_NAME_MAX_LENGTH,
  MESSAGE_QUEUE_IDENTIFIER_MAX_LENGTH,
  MessageQueueIdentity,
  parseMessageQueueIdentifier,
  toMessageQueueIdentity,
} from "../../../Types/MessageQueue/MessageQueueIdentity";
import {
  ResolvedMessagingDestination,
  resolveMessagingSpan,
} from "../../../Types/MessageQueue/MessagingTelemetryResolver";
import { SPAN_FIXTURES, SpanFixture } from "./MessagingTelemetryFixtures";
import { describe, expect, test } from "@jest/globals";

describe("toMessageQueueIdentity", () => {
  test("trims and lowercases every part", () => {
    expect(
      toMessageQueueIdentity({ system: " Kafka ", destination: "  Orders  " }),
    ).toEqual({ system: "kafka", brokerScope: "", destination: "orders" });
  });

  test("folds system aliases, so every spelling of one queue is one identity", () => {
    expect(
      toMessageQueueIdentity({ system: "AmazonSQS", destination: "orders" }),
    ).toEqual(
      toMessageQueueIdentity({ system: "aws_sqs", destination: "orders" }),
    );
    expect(
      toMessageQueueIdentity({
        system: "azure_servicebus",
        brokerScope: "ns1",
        destination: "orders",
      }),
    ).toEqual({
      system: "servicebus",
      brokerScope: "ns1",
      destination: "orders",
    });
    expect(
      toMessageQueueIdentity({ system: "aws_sns", destination: "t" })?.system,
    ).toBe("aws.sns");
  });

  test("keeps a long-tail system as it came", () => {
    expect(
      toMessageQueueIdentity({ system: "IBMMQ", destination: "DEV.QUEUE.1" }),
    ).toEqual({ system: "ibmmq", brokerScope: "", destination: "dev.queue.1" });
  });

  test.each([
    [{ system: "", destination: "orders" }],
    [{ system: "   ", destination: "orders" }],
    [{ system: "spring_integration", destination: "orders" }],
    [{ system: "Not A System", destination: "orders" }],
    [{ system: "kafka", destination: "" }],
    [{ system: "kafka", destination: "   " }],
    [{ system: "kafka", destination: 42 as unknown as string }],
    [{ system: 42 as unknown as string, destination: "orders" }],
    [{ system: null as unknown as string, destination: "orders" }],
  ])("%j is no identity", (value: { system: string; destination: string }) => {
    expect(toMessageQueueIdentity(value)).toBeNull();
  });

  test.each([
    ["NUL", "orders\u0000x"],
    ["tab", "orders\tx"],
    ["line feed", "orders\nx"],
    ["unit separator", "orders\u001fx"],
    ["DEL", "orders\u007fx"],
  ])(
    "a destination holding a control character (%s) is no identity: Postgres could never store it",
    (_name: string, destination: string) => {
      expect(
        toMessageQueueIdentity({ system: "kafka", destination }),
      ).toBeNull();
      expect(
        buildMessageQueueIdentifier({
          system: "kafka",
          brokerScope: "",
          destination,
        }),
      ).toBeNull();
      expect(parseMessageQueueIdentifier(`kafka||${destination}`)).toBeNull();
    },
  );

  test("surrounding whitespace is trimmed, and other characters are kept", () => {
    expect(
      toMessageQueueIdentity({ system: "kafka", destination: "\tOrders\n" }),
    ).toEqual({ system: "kafka", brokerScope: "", destination: "orders" });
    expect(
      toMessageQueueIdentity({ system: "kafka", destination: "commandes-é" })
        ?.destination,
    ).toBe("commandes-é");
  });

  test("a non-object is no identity", () => {
    expect(
      toMessageQueueIdentity(
        null as unknown as { system: string; destination: string },
      ),
    ).toBeNull();
    expect(
      toMessageQueueIdentity(
        "kafka|orders" as unknown as { system: string; destination: string },
      ),
    ).toBeNull();
  });

  test.each([
    ["servicebus", "orders-prod", "orders-prod"],
    ["servicebus", "Orders-Prod", "orders-prod"],
    ["servicebus", "  orders-prod  ", "orders-prod"],
    ["servicebus", "orders-prod.servicebus.windows.net", "orders-prod"],
    ["eventhubs", "INGEST.servicebus.chinacloudapi.cn", "ingest"],
    ["servicebus", "", ""],
    ["servicebus", null, ""],
    ["servicebus", undefined, ""],
    ["servicebus", "   ", ""],
    // A system without a namespace in its identity drops any scope.
    ["kafka", "orders-prod", ""],
    ["eventgrid", "orders-prod", ""],
    ["ibmmq", "qmgr1", ""],
  ])(
    "%s with scope %j → %j",
    (
      system: string,
      brokerScope: string | null | undefined,
      expected: string,
    ) => {
      expect(
        toMessageQueueIdentity({ system, brokerScope, destination: "orders" })
          ?.brokerScope,
      ).toBe(expected);
    },
  );

  test.each([
    ["my namespace"],
    ["-orders"],
    ["orders-"],
    ["orders_prod"],
    ["orders.prod"],
    ["a".repeat(64)],
    ["https://orders-prod.servicebus.windows.net"],
  ])(
    "a namespace-scoped system given a scope that cannot be a namespace (%j) is no identity",
    (brokerScope: string) => {
      expect(
        toMessageQueueIdentity({
          system: "servicebus",
          brokerScope,
          destination: "orders",
        }),
      ).toBeNull();
    },
  );

  test("the longest namespace label is 63 characters", () => {
    expect(
      toMessageQueueIdentity({
        system: "servicebus",
        brokerScope: "a".repeat(63),
        destination: "orders",
      })?.brokerScope,
    ).toBe("a".repeat(63));
  });

  test("the destination may contain anything but blank", () => {
    expect(
      toMessageQueueIdentity({
        system: "servicebus",
        destination: "Order-Events/Subscriptions/Billing|x=y",
      })?.destination,
    ).toBe("order-events/subscriptions/billing|x=y");
  });

  test("is idempotent", () => {
    for (const fixture of SPAN_FIXTURES) {
      if (!fixture.expected) {
        continue;
      }
      const identity: MessageQueueIdentity | null = toMessageQueueIdentity(
        fixture.expected,
      );
      expect(identity).not.toBeNull();
      expect(toMessageQueueIdentity(identity!)).toEqual(identity);
    }
  });
});

describe("getAzureNamespaceFromHost", () => {
  test("covers the public and sovereign clouds", () => {
    expect(AZURE_SERVICE_BUS_HOST_SUFFIXES).toEqual([
      ".servicebus.windows.net",
      ".servicebus.usgovcloudapi.net",
      ".servicebus.chinacloudapi.cn",
      ".servicebus.cloudapi.de",
    ]);
  });

  test.each([
    ["orders-prod.servicebus.windows.net", "orders-prod"],
    ["ORDERS-PROD.SERVICEBUS.WINDOWS.NET", "orders-prod"],
    ["orders-prod.servicebus.windows.net.", "orders-prod"],
    ["  orders-prod.servicebus.windows.net  ", "orders-prod"],
    ["gov1.servicebus.usgovcloudapi.net", "gov1"],
    ["cn1.servicebus.chinacloudapi.cn", "cn1"],
    ["de1.servicebus.cloudapi.de", "de1"],
    // The first DNS label.
    ["a.b.servicebus.windows.net", "a"],
    ["servicebus.windows.net", null],
    [".servicebus.windows.net", null],
    ["orders-prod.servicebus.windows.net.evil.com", null],
    ["orders-prod.blob.core.windows.net", null],
    ["-bad-.servicebus.windows.net", null],
    ["under_score.servicebus.windows.net", null],
    ["10.0.0.5", null],
    ["", null],
  ])("%j → %j", (host: string, namespace: string | null) => {
    expect(getAzureNamespaceFromHost(host)).toBe(namespace);
  });

  test("a non-string is no host", () => {
    expect(getAzureNamespaceFromHost(null)).toBeNull();
    expect(getAzureNamespaceFromHost(42)).toBeNull();
    expect(getAzureNamespaceFromHost(undefined)).toBeNull();
  });
});

describe("canonicalizeMessageQueueBrokerScope", () => {
  test.each([
    ["servicebus", "orders-prod", "orders-prod"],
    ["azure_servicebus", "Orders-Prod", "orders-prod"],
    ["Microsoft.EventHub", "ingest", "ingest"],
    ["servicebus", "orders-prod.servicebus.usgovcloudapi.net", "orders-prod"],
    ["servicebus", "", ""],
    ["servicebus", null, ""],
    ["servicebus", 42, ""],
    ["servicebus", "bad namespace", null],
    ["kafka", "anything at all", ""],
    ["", "orders-prod", ""],
    [null, "orders-prod", ""],
  ])(
    "(%j, %j) → %j",
    (system: unknown, scope: unknown, expected: string | null) => {
      expect(canonicalizeMessageQueueBrokerScope(system, scope)).toBe(expected);
    },
  );
});

describe("buildMessageQueueIdentifier", () => {
  test("is `${system}|${brokerScope}|${destination}`", () => {
    expect(
      buildMessageQueueIdentifier({
        system: "kafka",
        brokerScope: "",
        destination: "orders",
      }),
    ).toBe("kafka||orders");
    expect(
      buildMessageQueueIdentifier({
        system: "servicebus",
        brokerScope: "orders-prod",
        destination: "orders",
      }),
    ).toBe("servicebus|orders-prod|orders");
  });

  test("canonicalizes whatever it is handed, so any spelling builds one identifier", () => {
    expect(
      buildMessageQueueIdentifier({
        system: " AmazonSQS ",
        brokerScope: "ignored",
        destination: " Orders ",
      }),
    ).toBe("aws_sqs||orders");
    expect(
      buildMessageQueueIdentifier({
        system: "Azure_ServiceBus",
        brokerScope: "Orders-Prod.ServiceBus.Windows.Net",
        destination: "ORDERS",
      }),
    ).toBe("servicebus|orders-prod|orders");
  });

  test("an invalid identity builds nothing", () => {
    expect(
      buildMessageQueueIdentifier({
        system: "",
        brokerScope: "",
        destination: "orders",
      }),
    ).toBeNull();
    expect(
      buildMessageQueueIdentifier({
        system: "servicebus",
        brokerScope: "not a namespace",
        destination: "orders",
      }),
    ).toBeNull();
  });

  test("is at most MESSAGE_QUEUE_IDENTIFIER_MAX_LENGTH characters", () => {
    expect(MESSAGE_QUEUE_IDENTIFIER_MAX_LENGTH).toBe(500);
    // "kafka||" is 7 characters.
    const longest: string = "d".repeat(500 - 7);
    expect(
      buildMessageQueueIdentifier({
        system: "kafka",
        brokerScope: "",
        destination: longest,
      })?.length,
    ).toBe(500);
    expect(
      buildMessageQueueIdentifier({
        system: "kafka",
        brokerScope: "",
        destination: `${longest}d`,
      }),
    ).toBeNull();
  });

  test("every resolved destination fits (255 + a system + a DNS label)", () => {
    expect(
      buildMessageQueueIdentifier({
        system: "b".repeat(64),
        brokerScope: "",
        destination: "d".repeat(255),
      }),
    ).not.toBeNull();
    expect(
      buildMessageQueueIdentifier({
        system: "servicebus",
        brokerScope: "n".repeat(63),
        destination: "d".repeat(255),
      }),
    ).not.toBeNull();
  });
});

describe("parseMessageQueueIdentifier", () => {
  const IDENTITIES: ReadonlyArray<MessageQueueIdentity> = [
    { system: "kafka", brokerScope: "", destination: "orders" },
    { system: "servicebus", brokerScope: "orders-prod", destination: "orders" },
    { system: "aws.sns", brokerScope: "", destination: "order-events" },
    {
      system: "pulsar",
      brokerScope: "",
      destination: "persistent://public/default/orders",
    },
    // A destination may itself contain "|".
    { system: "kafka", brokerScope: "", destination: "a|b|c" },
    { system: "servicebus", brokerScope: "ns", destination: "|leading" },
    { system: "ibmmq", brokerScope: "", destination: "dev.queue.1" },
  ];

  test.each(
    IDENTITIES.map(
      (identity: MessageQueueIdentity): [string, MessageQueueIdentity] => {
        return [JSON.stringify(identity), identity];
      },
    ),
  )("round-trips %s", (_label: string, identity: MessageQueueIdentity) => {
    const identifier: string | null = buildMessageQueueIdentifier(identity);
    expect(identifier).not.toBeNull();
    expect(parseMessageQueueIdentifier(identifier)).toEqual(identity);
  });

  test("round-trips the identity of every resolved fixture", () => {
    for (const fixture of SPAN_FIXTURES) {
      const resolved: ResolvedMessagingDestination | null =
        resolveMessagingSpan({
          getAttribute: (key: string): unknown => {
            return fixture.attributes[key];
          },
          kind: fixture.kind,
        });
      if (!resolved) {
        continue;
      }
      const identity: MessageQueueIdentity | null =
        toMessageQueueIdentity(resolved);
      expect(identity).not.toBeNull();
      const identifier: string | null = buildMessageQueueIdentifier(identity!);
      expect({
        fixture: fixture.name,
        identifier: identifier !== null,
      }).toEqual({ fixture: fixture.name, identifier: true });
      expect(parseMessageQueueIdentifier(identifier)).toEqual(identity);
    }
  });

  test("canonicalizes a hand-written identifier like toMessageQueueIdentity", () => {
    expect(parseMessageQueueIdentifier(" AmazonSQS |x| Orders ")).toEqual({
      system: "aws_sqs",
      brokerScope: "",
      destination: "orders",
    });
  });

  test.each([
    ["kafka"],
    ["kafka|orders"],
    ["|scope|orders"],
    ["kafka|scope|"],
    ["kafka||   "],
    ["servicebus|bad scope|orders"],
    [""],
  ])("%j is no identifier", (identifier: string) => {
    expect(parseMessageQueueIdentifier(identifier)).toBeNull();
  });

  test("a non-string is no identifier", () => {
    expect(parseMessageQueueIdentifier(null)).toBeNull();
    expect(parseMessageQueueIdentifier(undefined)).toBeNull();
    expect(parseMessageQueueIdentifier(42)).toBeNull();
    expect(
      parseMessageQueueIdentifier({
        system: "kafka",
        brokerScope: "",
        destination: "orders",
      }),
    ).toBeNull();
  });
});

describe("buildMessageQueueDisplayName", () => {
  test("is the destination as resolved, trimmed, casing kept", () => {
    expect(
      buildMessageQueueDisplayName({ destination: "  Orders.Created  " }),
    ).toBe("Orders.Created");
    expect(
      buildMessageQueueDisplayName({
        destination: "persistent://public/default/orders",
      }),
    ).toBe("persistent://public/default/orders");
  });

  test("a name of exactly the limit is kept whole", () => {
    expect(MESSAGE_QUEUE_DISPLAY_NAME_MAX_LENGTH).toBe(100);
    const exact: string = "q".repeat(100);
    expect(buildMessageQueueDisplayName({ destination: exact })).toBe(exact);
  });

  test("a longer one is cut to the limit, ending in an ellipsis", () => {
    const name: string = buildMessageQueueDisplayName({
      destination: "q".repeat(101),
    });
    expect(name.length).toBe(100);
    expect(name).toBe(`${"q".repeat(99)}…`);
    expect(
      buildMessageQueueDisplayName({ destination: "x".repeat(255) }).length,
    ).toBe(100);
  });

  test("never leaves a space before the ellipsis", () => {
    const destination: string = `${"a".repeat(95)}     ${"b".repeat(50)}`;
    expect(buildMessageQueueDisplayName({ destination })).toBe(
      `${"a".repeat(95)}…`,
    );
  });

  test.each([
    ["line separator", 0x2028],
    ["paragraph separator", 0x2029],
    ["byte order mark", 0xfeff],
    ["ogham space mark", 0x1680],
    ["narrow no-break space", 0x202f],
    ["medium mathematical space", 0x205f],
    ["ideographic space", 0x3000],
    ["no-break space", 0x00a0],
    ["tab", 0x0009],
  ])(
    "nor any other whitespace trim() removes: %s",
    (_name: string, code: number) => {
      const whitespace: string = String.fromCharCode(code);
      expect(whitespace.trim()).toBe("");
      const destination: string = `${"a".repeat(98)}${whitespace}${"b".repeat(20)}`;
      expect(buildMessageQueueDisplayName({ destination })).toBe(
        `${"a".repeat(98)}…`,
      );
    },
  );

  test("never cuts through a surrogate pair", () => {
    // The emoji's high surrogate would be the 99th code unit.
    const destination: string = `${"a".repeat(98)}😀${"b".repeat(20)}`;
    const name: string = buildMessageQueueDisplayName({ destination });
    expect(name).toBe(`${"a".repeat(98)}…`);
    expect(name.length).toBeLessThanOrEqual(100);
    const intact: string = buildMessageQueueDisplayName({
      destination: `${"a".repeat(97)}😀${"b".repeat(20)}`,
    });
    expect(intact).toBe(`${"a".repeat(97)}😀…`);
  });

  test("nothing to show is the empty string", () => {
    expect(buildMessageQueueDisplayName({ destination: "" })).toBe("");
    expect(buildMessageQueueDisplayName({ destination: "   " })).toBe("");
    expect(
      buildMessageQueueDisplayName({
        destination: null as unknown as string,
      }),
    ).toBe("");
    expect(
      buildMessageQueueDisplayName(null as unknown as { destination: string }),
    ).toBe("");
  });

  test("every resolved fixture gets a non-empty name within the limit", () => {
    for (const fixture of SPAN_FIXTURES) {
      const expected: SpanFixture["expected"] = fixture.expected;
      if (!expected) {
        continue;
      }
      const name: string = buildMessageQueueDisplayName(expected);
      expect(name.length).toBeGreaterThan(0);
      expect(name.length).toBeLessThanOrEqual(100);
      expect(name).toBe(expected.destination);
    }
  });
});

describe("identity families in the identity", () => {
  test("an ActiveMQ queue is keyed on the JMS family, whatever spelling names it", () => {
    for (const system of ["activemq", "ActiveMQ", "artemis", "jms", "JMS"]) {
      expect({
        system,
        identity: toMessageQueueIdentity({ system, destination: "Orders" }),
      }).toEqual({
        system,
        identity: { system: "jms", brokerScope: "", destination: "orders" },
      });
    }
  });

  test("an ActiveMQ identifier is the JMS family's, and parses back to it", () => {
    const identifier: string | null = buildMessageQueueIdentifier({
      system: "activemq",
      brokerScope: "",
      destination: "orders",
    });
    expect(identifier).toBe("jms||orders");
    expect(parseMessageQueueIdentifier(identifier)).toEqual({
      system: "jms",
      brokerScope: "",
      destination: "orders",
    });
  });

  test("systems without a family keep their own name", () => {
    expect(
      toMessageQueueIdentity({ system: "kafka", destination: "orders" })
        ?.system,
    ).toBe("kafka");
    expect(
      toMessageQueueIdentity({ system: "rabbitmq", destination: "orders" })
        ?.system,
    ).toBe("rabbitmq");
  });
});
