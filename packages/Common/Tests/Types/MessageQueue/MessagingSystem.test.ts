import {
  getMessagingBrokerMetricsReceivers,
  getMessagingBrokerMetricsSource,
  getMessagingBrokerScope,
  getMessagingIdentitySystem,
  getMessagingSystemDescriptor,
  getMessagingSystemDisplayName,
  getMoreSpecificMessagingSystem,
  isExcludedMessagingSystem,
  isKnownMessagingSystem,
  MESSAGING_SYSTEMS,
  MessagingBrokerMetricsSource,
  MessagingSystemDescriptor,
  normalizeMessagingSystem,
} from "../../../Types/MessageQueue/MessagingSystem";
import markdownSlugify from "../../../Server/Types/MarkdownSlugify";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The semconv registry's well-known `messaging.system` values
 * (model/messaging/registry.yaml, semantic-conventions v1.44.0). Note the
 * mixed separators: `aws.sns` has a dot, `aws_sqs` an underscore. Every
 * one of them is what some instrumentation puts on a span, so each must be
 * a catalog system, flagged as a semconv value.
 */
const SEMCONV_MESSAGING_SYSTEMS: ReadonlyArray<string> = [
  "activemq",
  "aws.sns",
  "aws_sqs",
  "eventgrid",
  "eventhubs",
  "servicebus",
  "gcp_pubsub",
  "jms",
  "kafka",
  "rabbitmq",
  "rocketmq",
  "pulsar",
];

/*
 * Every `messaging.system` spelling the research saw instrumentations emit
 * (messaging-semconv.md, "MESSAGING.SYSTEM SPELLINGS SEEN"), as they emit
 * it, and the system each must land on.
 */
const SPELLINGS_SEEN: ReadonlyArray<[string, string]> = [
  ["kafka", "kafka"],
  ["rabbitmq", "rabbitmq"],
  ["jms", "jms"],
  ["activemq", "activemq"],
  ["aws_sqs", "aws_sqs"],
  // Spec 1.16 example; Java agent up to 2.3.0; Go otelaws up to 0.61.0.
  ["AmazonSQS", "aws_sqs"],
  // JS aws-sdk up to 0.57.0; Python boto3sqs and botocore.
  ["aws.sqs", "aws_sqs"],
  ["aws.sns", "aws.sns"],
  // Go otelaws.
  ["aws_sns", "aws.sns"],
  // Semconv 1.24.0, renamed in 1.25.0.
  ["azure_servicebus", "servicebus"],
  ["azure_eventhubs", "eventhubs"],
  ["azure_eventgrid", "eventgrid"],
  ["servicebus", "servicebus"],
  ["eventhubs", "eventhubs"],
  ["eventgrid", "eventgrid"],
  ["gcp_pubsub", "gcp_pubsub"],
  ["rocketmq", "rocketmq"],
  ["pulsar", "pulsar"],
  // Java agent; not a spec value.
  ["nats", "nats"],
  // BullMQ, OneUptime's own workers included.
  ["bullmq", "bullmq"],
];

/*
 * The catalog the design fixes (DESIGN.md §2.1): system, display name,
 * aliases, broker scope and where the broker metrics come from.
 */
const EXPECTED_CATALOG: ReadonlyArray<{
  system: string;
  displayName: string;
  aliases: ReadonlyArray<string>;
  brokerScope: string;
  metricsKind: MessagingBrokerMetricsSource["kind"];
  receivers: ReadonlyArray<string>;
}> = [
  {
    system: "kafka",
    displayName: "Apache Kafka",
    aliases: [],
    brokerScope: "none",
    metricsKind: "receiver",
    receivers: ["kafka_metrics"],
  },
  {
    system: "rabbitmq",
    displayName: "RabbitMQ",
    aliases: [],
    brokerScope: "none",
    metricsKind: "receiver",
    receivers: ["rabbitmq"],
  },
  {
    system: "activemq",
    displayName: "Apache ActiveMQ",
    aliases: ["artemis", "activemq_artemis"],
    brokerScope: "none",
    metricsKind: "external-scraper",
    receivers: ["OpenTelemetry JMX Scraper"],
  },
  {
    system: "jms",
    displayName: "JMS",
    aliases: [],
    brokerScope: "none",
    metricsKind: "none",
    receivers: [],
  },
  {
    system: "aws_sqs",
    displayName: "Amazon SQS",
    aliases: ["aws.sqs", "amazonsqs", "sqs"],
    brokerScope: "none",
    metricsKind: "cloud-monitoring",
    receivers: ["aws_cloudwatch", "awsfirehose"],
  },
  {
    system: "aws.sns",
    displayName: "Amazon SNS",
    aliases: ["aws_sns", "amazonsns", "sns"],
    brokerScope: "none",
    metricsKind: "cloud-monitoring",
    receivers: ["aws_cloudwatch", "awsfirehose"],
  },
  {
    system: "gcp_pubsub",
    displayName: "Google Cloud Pub/Sub",
    aliases: ["gcp.pubsub", "pubsub", "google_pubsub"],
    brokerScope: "none",
    metricsKind: "cloud-monitoring",
    receivers: ["googlecloudmonitoring"],
  },
  {
    system: "servicebus",
    displayName: "Azure Service Bus",
    aliases: ["azure_servicebus", "azure.servicebus", "microsoft.servicebus"],
    brokerScope: "azure-namespace",
    metricsKind: "cloud-monitoring",
    receivers: ["azure_monitor"],
  },
  {
    system: "eventhubs",
    displayName: "Azure Event Hubs",
    aliases: ["azure_eventhubs", "azure.eventhubs", "microsoft.eventhub"],
    brokerScope: "azure-namespace",
    metricsKind: "cloud-monitoring",
    receivers: ["azure_monitor"],
  },
  {
    system: "eventgrid",
    displayName: "Azure Event Grid",
    aliases: ["azure_eventgrid", "azure.eventgrid", "microsoft.eventgrid"],
    brokerScope: "none",
    metricsKind: "cloud-monitoring",
    receivers: ["azure_monitor"],
  },
  {
    system: "pulsar",
    displayName: "Apache Pulsar",
    aliases: ["apache_pulsar"],
    brokerScope: "none",
    metricsKind: "prometheus",
    receivers: ["prometheus"],
  },
  {
    system: "rocketmq",
    displayName: "Apache RocketMQ",
    aliases: [],
    brokerScope: "none",
    metricsKind: "prometheus",
    receivers: ["prometheus"],
  },
  {
    system: "nats",
    displayName: "NATS",
    aliases: ["jetstream"],
    brokerScope: "none",
    metricsKind: "prometheus",
    receivers: ["prometheus"],
  },
  {
    system: "bullmq",
    displayName: "BullMQ",
    aliases: [],
    brokerScope: "none",
    metricsKind: "none",
    receivers: [],
  },
];

/*
 * The receivers of the collector OneUptime pins
 * (`otel/opentelemetry-collector-contrib:0.161.0 components`), read from the
 * one list the Databases catalog test keeps, so there is a single copy to
 * update when the pin moves.
 */
function readPinnedCollectorReceivers(): ReadonlySet<string> {
  const source: string = fs.readFileSync(
    path.join(__dirname, "..", "DatabaseServer", "DatabaseSystem.test.ts"),
    "utf8",
  );
  const start: number = source.indexOf(
    "const PINNED_COLLECTOR_RECEIVERS: ReadonlySet<string>",
  );
  const end: number = source.indexOf("]);", start);
  const names: Set<string> = new Set<string>();
  if (start < 0 || end < start) {
    // The floor test below fails loudly.
    return names;
  }
  const block: string = source.substring(start, end);
  const pattern: RegExp = /"([a-z0-9_]+)"/g;
  let match: RegExpExecArray | null = pattern.exec(block);
  while (match) {
    names.add(match[1]!);
    match = pattern.exec(block);
  }
  return names;
}

const PINNED_COLLECTOR_RECEIVERS: ReadonlySet<string> =
  readPinnedCollectorReceivers();

function descriptorOf(system: string): MessagingSystemDescriptor {
  const descriptor: MessagingSystemDescriptor | null =
    getMessagingSystemDescriptor(system);
  expect({ system, known: descriptor !== null }).toEqual({
    system,
    known: true,
  });
  return descriptor as MessagingSystemDescriptor;
}

function sourceText(source: MessagingBrokerMetricsSource): string {
  return source.kind === "none" ? source.reason : source.note;
}

describe("MESSAGING_SYSTEMS registry integrity", () => {
  test("the pinned collector receiver list was read", () => {
    // A floor, so a parse that silently found nothing cannot pass.
    expect(PINNED_COLLECTOR_RECEIVERS.size).toBeGreaterThan(80);
    for (const receiver of [
      "kafka_metrics",
      "rabbitmq",
      "prometheus",
      "aws_cloudwatch",
      "awsfirehose",
      "azure_monitor",
      "googlecloudmonitoring",
      "otlp",
    ]) {
      expect(PINNED_COLLECTOR_RECEIVERS.has(receiver)).toBe(true);
    }
  });

  test("is exactly the catalog the design fixes, in that order", () => {
    expect(
      MESSAGING_SYSTEMS.map((descriptor: MessagingSystemDescriptor) => {
        return {
          system: descriptor.system,
          displayName: descriptor.displayName,
          aliases: descriptor.aliases,
          brokerScope: descriptor.brokerScope,
          metricsKind: descriptor.brokerMetrics.kind,
          receivers: getMessagingBrokerMetricsReceivers(
            descriptor.brokerMetrics,
          ),
        };
      }),
    ).toEqual(EXPECTED_CATALOG);
  });

  test("systems are unique, lowercase, trimmed and well-formed", () => {
    const systems: Array<string> = MESSAGING_SYSTEMS.map(
      (descriptor: MessagingSystemDescriptor): string => {
        return descriptor.system;
      },
    );
    expect(new Set(systems).size).toBe(systems.length);
    for (const system of systems) {
      expect(system).toBe(system.trim().toLowerCase());
      expect(system).toMatch(/^[a-z0-9][a-z0-9._-]{0,63}$/);
      // A system is its own normal form.
      expect(normalizeMessagingSystem(system)).toBe(system);
    }
  });

  test("display names are non-empty, trimmed and unique", () => {
    const names: Array<string> = MESSAGING_SYSTEMS.map(
      (descriptor: MessagingSystemDescriptor): string => {
        return descriptor.displayName;
      },
    );
    for (const name of names) {
      expect(name.trim().length).toBeGreaterThan(0);
      expect(name).toBe(name.trim());
    }
    expect(new Set(names).size).toBe(names.length);
    // Case-insensitively too: "Nats" and "NATS" would read as one system.
    expect(
      new Set(
        names.map((name: string): string => {
          return name.toLowerCase();
        }),
      ).size,
    ).toBe(names.length);
  });

  test("no alias is claimed by two systems, shadows a system or repeats its own", () => {
    const owners: Map<string, string> = new Map<string, string>();
    for (const descriptor of MESSAGING_SYSTEMS) {
      owners.set(descriptor.system, descriptor.system);
    }
    for (const descriptor of MESSAGING_SYSTEMS) {
      expect(descriptor.aliases).not.toContain(descriptor.system);
      expect(new Set(descriptor.aliases).size).toBe(descriptor.aliases.length);
      for (const alias of descriptor.aliases) {
        expect(alias).toBe(alias.trim().toLowerCase());
        expect(alias.length).toBeGreaterThan(0);
        expect({ alias, claimedBy: owners.get(alias) }).toEqual({
          alias,
          claimedBy: undefined,
        });
        owners.set(alias, descriptor.system);
      }
    }
  });

  test("every alias normalizes to its system and finds its descriptor", () => {
    for (const descriptor of MESSAGING_SYSTEMS) {
      for (const alias of descriptor.aliases) {
        expect({ alias, system: normalizeMessagingSystem(alias) }).toEqual({
          alias,
          system: descriptor.system,
        });
        expect(getMessagingSystemDescriptor(alias)).toBe(descriptor);
        expect(isKnownMessagingSystem(alias)).toBe(true);
        expect(getMessagingSystemDisplayName(alias)).toBe(
          descriptor.displayName,
        );
      }
    }
  });

  test("the semconv flag marks exactly the semconv registry's values", () => {
    const flagged: Array<string> = MESSAGING_SYSTEMS.filter(
      (descriptor: MessagingSystemDescriptor): boolean => {
        return descriptor.isSemconvValue;
      },
    ).map((descriptor: MessagingSystemDescriptor): string => {
      return descriptor.system;
    });
    expect([...flagged].sort()).toEqual([...SEMCONV_MESSAGING_SYSTEMS].sort());
    for (const value of SEMCONV_MESSAGING_SYSTEMS) {
      expect(descriptorOf(value).system).toBe(value);
    }
  });

  test("docs anchors are unique and are the docs renderer's slug of the display name", () => {
    const anchors: Array<string> = MESSAGING_SYSTEMS.map(
      (descriptor: MessagingSystemDescriptor): string => {
        return descriptor.docsAnchor;
      },
    );
    expect(new Set(anchors).size).toBe(anchors.length);
    for (const descriptor of MESSAGING_SYSTEMS) {
      /*
       * The docs page heads each system's section with its display name, so
       * /docs/telemetry/queues#<anchor> lands on it.
       */
      expect({
        system: descriptor.system,
        anchor: descriptor.docsAnchor,
      }).toEqual({
        system: descriptor.system,
        anchor: markdownSlugify(descriptor.displayName),
      });
      expect(descriptor.docsAnchor).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  test("only Service Bus and Event Hubs carry a namespace in their identity", () => {
    const scoped: Array<string> = MESSAGING_SYSTEMS.filter(
      (descriptor: MessagingSystemDescriptor): boolean => {
        return descriptor.brokerScope === "azure-namespace";
      },
    ).map((descriptor: MessagingSystemDescriptor): string => {
      return descriptor.system;
    });
    expect(scoped).toEqual(["servicebus", "eventhubs"]);
    for (const descriptor of MESSAGING_SYSTEMS) {
      expect(["none", "azure-namespace"]).toContain(descriptor.brokerScope);
    }
  });

  test("every collector receiver a source names ships in the pinned collector", () => {
    for (const descriptor of MESSAGING_SYSTEMS) {
      const source: MessagingBrokerMetricsSource = descriptor.brokerMetrics;
      if (source.kind === "receiver") {
        expect({
          system: descriptor.system,
          receiver: source.receiver,
          shipped: PINNED_COLLECTOR_RECEIVERS.has(source.receiver),
        }).toEqual({
          system: descriptor.system,
          receiver: source.receiver,
          shipped: true,
        });
        // A scrape is its own kind, never a "receiver" source.
        expect(source.receiver).not.toBe("prometheus");
      }
      if (source.kind === "cloud-monitoring") {
        for (const receiver of [
          source.receiver,
          ...source.alternativeReceivers,
        ]) {
          expect({
            system: descriptor.system,
            receiver,
            shipped: PINNED_COLLECTOR_RECEIVERS.has(receiver),
          }).toEqual({ system: descriptor.system, receiver, shipped: true });
        }
        expect(source.alternativeReceivers).not.toContain(source.receiver);
        expect(new Set(source.alternativeReceivers).size).toBe(
          source.alternativeReceivers.length,
        );
      }
      if (source.kind === "prometheus") {
        expect(PINNED_COLLECTOR_RECEIVERS.has("prometheus")).toBe(true);
      }
      if (source.kind === "external-scraper") {
        // Runs outside the collector: it must not pose as a receiver.
        expect(PINNED_COLLECTOR_RECEIVERS.has(source.scraper)).toBe(false);
        expect(source.scraper.trim().length).toBeGreaterThan(0);
      }
    }
  });

  test("Prometheus sources name a real port, an absolute path and the exporter", () => {
    for (const descriptor of MESSAGING_SYSTEMS) {
      const source: MessagingBrokerMetricsSource = descriptor.brokerMetrics;
      if (source.kind !== "prometheus") {
        continue;
      }
      expect(Number.isInteger(source.port)).toBe(true);
      expect(source.port).toBeGreaterThanOrEqual(1);
      expect(source.port).toBeLessThanOrEqual(65535);
      expect(source.path.startsWith("/")).toBe(true);
      expect(source.path).not.toMatch(/\s/);
      expect(source.exporter.trim().length).toBeGreaterThan(0);
    }
    // The endpoints the research verified against real brokers.
    expect(descriptorOf("pulsar").brokerMetrics).toMatchObject({
      port: 8080,
      path: "/metrics/",
    });
    expect(descriptorOf("rocketmq").brokerMetrics).toMatchObject({
      port: 5557,
      path: "/metrics",
    });
    expect(descriptorOf("nats").brokerMetrics).toMatchObject({
      exporter: "prometheus-nats-exporter",
      port: 7777,
      path: "/metrics",
    });
  });

  test("every note and reason is a full sentence", () => {
    for (const descriptor of MESSAGING_SYSTEMS) {
      const text: string = sourceText(descriptor.brokerMetrics);
      expect({ system: descriptor.system, text: text.trim() }).toEqual({
        system: descriptor.system,
        text,
      });
      expect(text.length).toBeGreaterThan(20);
      expect(text).toMatch(/^[A-Z`]/);
      expect(text.endsWith(".")).toBe(true);
      // One line: the docs table and the in-app card render it inline.
      expect(text).not.toMatch(/\n/);
    }
  });

  test("NATS' note says its JetStream metrics do not attach to subject-level queues", () => {
    expect(sourceText(descriptorOf("nats").brokerMetrics)).toContain(
      "not per subject",
    );
  });

  test("JMS's reason says ActiveMQ's metrics join the JMS queue and other JMS brokers have no path", () => {
    const reason: string = sourceText(descriptorOf("jms").brokerMetrics);
    expect(reason).toContain("Apache ActiveMQ");
    expect(reason).toContain("join the same queue");
    expect(reason).toContain("shown as an ActiveMQ queue");
    expect(reason).toContain("IBM MQ");
  });
});

describe("normalizeMessagingSystem", () => {
  test.each(SPELLINGS_SEEN)(
    "%s (as instrumentations send it) normalizes to %s",
    (raw: string, system: string) => {
      expect(normalizeMessagingSystem(raw)).toBe(system);
    },
  );

  test("every system and alias normalizes in any casing and with surrounding whitespace", () => {
    for (const descriptor of MESSAGING_SYSTEMS) {
      for (const raw of [descriptor.system, ...descriptor.aliases]) {
        for (const variant of [
          raw,
          raw.toUpperCase(),
          `${raw.charAt(0).toUpperCase()}${raw.substring(1)}`,
          `  ${raw}  `,
          `\t${raw.toUpperCase()}\n`,
        ]) {
          expect({
            variant,
            system: normalizeMessagingSystem(variant),
          }).toEqual({ variant, system: descriptor.system });
        }
      }
    }
  });

  test.each([
    ["ibmmq", "ibmmq"],
    ["IBMMQ", "ibmmq"],
    ["solace", "solace"],
    ["mqtt", "mqtt"],
    ["redis-streams", "redis-streams"],
    ["aws.kinesis", "aws.kinesis"],
    ["  Custom_Broker.v2  ", "custom_broker.v2"],
    ["a", "a"],
    ["9lives", "9lives"],
  ])(
    "an unknown but well-formed value (%s) is kept, lowercased: %s",
    (raw: string, system: string) => {
      expect(normalizeMessagingSystem(raw)).toBe(system);
      expect(isKnownMessagingSystem(raw)).toBe(false);
    },
  );

  test("a long-tail value is capped at 64 characters", () => {
    expect(normalizeMessagingSystem("b".repeat(64))).toBe("b".repeat(64));
    expect(normalizeMessagingSystem("b".repeat(65))).toBeNull();
  });

  test.each([
    "spring_integration",
    "SPRING_INTEGRATION",
    "  Spring_Integration ",
  ])(
    "an excluded value (%s: in-process channels, not a broker) is null",
    (raw: string) => {
      expect(normalizeMessagingSystem(raw)).toBeNull();
      expect(isExcludedMessagingSystem(raw)).toBe(true);
    },
  );

  test("nothing else is excluded", () => {
    for (const descriptor of MESSAGING_SYSTEMS) {
      expect(isExcludedMessagingSystem(descriptor.system)).toBe(false);
    }
    expect(isExcludedMessagingSystem("ibmmq")).toBe(false);
    expect(isExcludedMessagingSystem(undefined)).toBe(false);
    expect(isExcludedMessagingSystem(42)).toBe(false);
  });

  test.each([
    [""],
    ["   "],
    ["Azure Service Bus"],
    ["kafka!"],
    ["-kafka"],
    [".kafka"],
    ["_kafka"],
    ["__proto__"],
    ["https://broker.example.com"],
    ["kafka/rabbitmq"],
    ["kafka|rabbitmq"],
    ["käfka"],
  ])("a malformed value (%j) is null", (raw: string) => {
    expect(normalizeMessagingSystem(raw)).toBeNull();
  });

  test.each([[null], [undefined], [42], [true], [{}], [["kafka"]]])(
    "a non-string value (%j) is null",
    (raw: unknown) => {
      expect(normalizeMessagingSystem(raw)).toBeNull();
      expect(getMessagingSystemDescriptor(raw)).toBeNull();
      expect(isKnownMessagingSystem(raw)).toBe(false);
      expect(getMessagingSystemDisplayName(raw)).toBe("");
    },
  );
});

describe("lookups are own-property safe", () => {
  test.each(["constructor", "toString", "hasOwnProperty", "valueOf"])(
    "%s finds no descriptor, and is kept as the unknown system it spells",
    (raw: string) => {
      expect(getMessagingSystemDescriptor(raw)).toBeNull();
      expect(isKnownMessagingSystem(raw)).toBe(false);
      expect(normalizeMessagingSystem(raw)).toBe(raw.toLowerCase());
      expect(getMessagingSystemDisplayName(raw)).toBe(raw);
      expect(getMessagingBrokerScope(raw)).toBe("none");
      expect(getMessagingBrokerMetricsSource(raw).kind).toBe("none");
    },
  );

  test("__proto__ finds nothing and is not a system", () => {
    expect(getMessagingSystemDescriptor("__proto__")).toBeNull();
    expect(normalizeMessagingSystem("__proto__")).toBeNull();
  });
});

describe("getMessagingSystemDescriptor / display name / isKnown", () => {
  test("a system finds its own descriptor", () => {
    for (const descriptor of MESSAGING_SYSTEMS) {
      expect(getMessagingSystemDescriptor(descriptor.system)).toBe(descriptor);
      expect(getMessagingSystemDescriptor(`  ${descriptor.system}  `)).toBe(
        descriptor,
      );
      expect(
        getMessagingSystemDescriptor(descriptor.system.toUpperCase()),
      ).toBe(descriptor);
    }
  });

  test("display names", () => {
    expect(getMessagingSystemDisplayName("kafka")).toBe("Apache Kafka");
    expect(getMessagingSystemDisplayName("AmazonSQS")).toBe("Amazon SQS");
    expect(getMessagingSystemDisplayName("aws_sns")).toBe("Amazon SNS");
    expect(getMessagingSystemDisplayName("azure_servicebus")).toBe(
      "Azure Service Bus",
    );
    expect(getMessagingSystemDisplayName("gcp_pubsub")).toBe(
      "Google Cloud Pub/Sub",
    );
    expect(getMessagingSystemDisplayName("jetstream")).toBe("NATS");
    // Unknown: the raw value as reported (trimmed, casing kept).
    expect(getMessagingSystemDisplayName("  IBM MQ  ")).toBe("IBM MQ");
    expect(getMessagingSystemDisplayName("ibmmq")).toBe("ibmmq");
    // Nothing to show.
    expect(getMessagingSystemDisplayName("")).toBe("");
    expect(getMessagingSystemDisplayName("   ")).toBe("");
    expect(getMessagingSystemDisplayName(null)).toBe("");
    expect(getMessagingSystemDisplayName(undefined)).toBe("");
  });
});

describe("getMessagingBrokerScope", () => {
  test.each([
    ["servicebus", "azure-namespace"],
    ["azure_servicebus", "azure-namespace"],
    ["Microsoft.ServiceBus", "azure-namespace"],
    ["eventhubs", "azure-namespace"],
    ["azure.eventhubs", "azure-namespace"],
    ["eventgrid", "none"],
    ["kafka", "none"],
    ["aws_sqs", "none"],
    ["ibmmq", "none"],
    ["", "none"],
  ])("%s → %s", (system: string, scope: string) => {
    expect(getMessagingBrokerScope(system)).toBe(scope);
  });

  test("non-string input has no scope", () => {
    expect(getMessagingBrokerScope(null)).toBe("none");
    expect(getMessagingBrokerScope(undefined)).toBe("none");
  });
});

describe("getMessagingBrokerMetricsSource", () => {
  test("a known system (or alias) gets its descriptor's source", () => {
    for (const descriptor of MESSAGING_SYSTEMS) {
      expect(getMessagingBrokerMetricsSource(descriptor.system)).toBe(
        descriptor.brokerMetrics,
      );
      for (const alias of descriptor.aliases) {
        expect(getMessagingBrokerMetricsSource(alias)).toBe(
          descriptor.brokerMetrics,
        );
      }
    }
  });

  test("an unknown system has no known path, with a reason that says what to do", () => {
    for (const raw of ["ibmmq", "", null, undefined]) {
      const source: MessagingBrokerMetricsSource =
        getMessagingBrokerMetricsSource(raw);
      expect(source.kind).toBe("none");
      const reason: string = sourceText(source);
      expect(reason.endsWith(".")).toBe(true);
      expect(reason).toContain("messaging.system");
      expect(reason).toContain("messaging.destination.name");
    }
  });
});

describe("getMessagingBrokerMetricsReceivers", () => {
  test("names the components each kind of source runs", () => {
    expect(
      getMessagingBrokerMetricsReceivers({
        kind: "receiver",
        receiver: "kafka_metrics",
        note: "x.",
      }),
    ).toEqual(["kafka_metrics"]);
    expect(
      getMessagingBrokerMetricsReceivers({
        kind: "prometheus",
        exporter: "Pulsar broker",
        port: 8080,
        path: "/metrics/",
        note: "x.",
      }),
    ).toEqual(["prometheus"]);
    expect(
      getMessagingBrokerMetricsReceivers({
        kind: "cloud-monitoring",
        receiver: "aws_cloudwatch",
        alternativeReceivers: ["awsfirehose"],
        note: "x.",
      }),
    ).toEqual(["aws_cloudwatch", "awsfirehose"]);
    expect(
      getMessagingBrokerMetricsReceivers({
        kind: "external-scraper",
        scraper: "OpenTelemetry JMX Scraper",
        note: "x.",
      }),
    ).toEqual(["OpenTelemetry JMX Scraper"]);
    expect(
      getMessagingBrokerMetricsReceivers({ kind: "none", reason: "x." }),
    ).toEqual([]);
  });
});

describe("identity families", () => {
  test("every identityFamily names a catalog system that is its own family, never the system itself", () => {
    for (const descriptor of MESSAGING_SYSTEMS) {
      if (descriptor.identityFamily === undefined) {
        continue;
      }
      const family: MessagingSystemDescriptor | null =
        getMessagingSystemDescriptor(descriptor.identityFamily);
      expect({ system: descriptor.system, family: family?.system }).toEqual({
        system: descriptor.system,
        family: descriptor.identityFamily,
      });
      expect(descriptor.identityFamily).not.toBe(descriptor.system);
      // A family is never itself a member of another family (no chains).
      expect(family?.identityFamily).toBeUndefined();
      /*
       * A family never spans a namespace-scoped and an unscoped system:
       * the identity's scope is decided by the specific system.
       */
      expect(family?.brokerScope).toBe(descriptor.brokerScope);
    }
  });

  test("ActiveMQ is keyed on the JMS family, and only ActiveMQ has a family", () => {
    const withFamily: Array<string> = MESSAGING_SYSTEMS.filter(
      (descriptor: MessagingSystemDescriptor): boolean => {
        return descriptor.identityFamily !== undefined;
      },
    ).map((descriptor: MessagingSystemDescriptor): string => {
      return descriptor.system;
    });
    expect(withFamily).toEqual(["activemq"]);
    expect(getMessagingSystemDescriptor("activemq")?.identityFamily).toBe(
      "jms",
    );
  });

  test.each([
    ["activemq", "jms"],
    ["ActiveMQ", "jms"],
    ["artemis", "jms"],
    [" activemq_artemis ", "jms"],
    ["jms", "jms"],
    ["kafka", "kafka"],
    ["AmazonSQS", "aws_sqs"],
    ["azure_servicebus", "servicebus"],
    ["ibmmq", "ibmmq"],
  ])("getMessagingIdentitySystem(%j) is %j", (raw: string, family: string) => {
    expect(getMessagingIdentitySystem(raw)).toBe(family);
  });

  test.each([
    [""],
    ["   "],
    [null],
    [undefined],
    [42],
    ["spring_integration"],
    ["constructor x"],
  ])("getMessagingIdentitySystem(%j) is null", (raw: unknown) => {
    expect(getMessagingIdentitySystem(raw)).toBeNull();
  });

  test.each([
    // A JMS queue becomes an ActiveMQ one when the broker's metrics show up.
    ["jms", "activemq", "activemq"],
    ["jms", "artemis", "activemq"],
    // Never back to the family, never across families.
    ["activemq", "jms", "activemq"],
    ["activemq", "activemq", "activemq"],
    ["jms", "kafka", "jms"],
    ["kafka", "activemq", "kafka"],
    ["kafka", "kafka", "kafka"],
    ["AmazonSQS", "aws.sqs", "aws_sqs"],
    // Missing sides.
    [null, "activemq", "activemq"],
    ["activemq", null, "activemq"],
    ["jms", "", "jms"],
  ])(
    "getMoreSpecificMessagingSystem(%j, %j) is %j",
    (current: unknown, candidate: unknown, expected: string) => {
      expect(getMoreSpecificMessagingSystem(current, candidate)).toBe(expected);
    },
  );

  test("getMoreSpecificMessagingSystem is null only when neither side is a system", () => {
    expect(getMoreSpecificMessagingSystem(null, undefined)).toBeNull();
    expect(getMoreSpecificMessagingSystem("", "spring_integration")).toBeNull();
  });
});
