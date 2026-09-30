import { describe, expect, test } from "@jest/globals";
import EntityRelationshipType from "Common/Types/Telemetry/EntityRelationshipType";
import EntitySource from "Common/Types/Telemetry/EntitySource";
import EntityType from "Common/Types/Telemetry/EntityType";
import { canonicalizeEntityValue } from "Common/Utils/Telemetry/EntityKey";
import {
  MESSAGING_SYSTEMS,
  MessagingSystemDescriptor,
  normalizeMessagingSystem,
} from "Common/Types/MessageQueue/MessagingSystem";
import {
  ServiceMapEntry,
  ServiceMapModel,
  ServiceMapVisibility,
  buildServiceMapModel,
  detailLabelForEntity,
  detailValueForEntity,
  resolveServiceMapVisibility,
} from "../../FeatureSet/Dashboard/src/Components/Topology/ServiceMapViewModel";
import {
  TopologyEntity,
  TopologyRelationship,
} from "../../FeatureSet/Dashboard/src/Components/Topology/TopologyData";

/*
 * A message broker on the Service Map is a Remote Service node whose
 * messaging.system the server ships twice — as the identifying
 * `messaging.system` and as the descriptive `network.protocol.name`
 * (ServiceDependencyDiscovery), both lowercased by canonicalizeEntityValue —
 * and the node's subtitle and search text read "Remote Service · <label>".
 * Every broker without a label used to show its raw system value
 * ("servicebus", "eventhubs", "aws.sns"), and a value that happens to name an
 * Object.prototype member ("constructor") showed a function's source.
 *
 * This suite pins a friendly label for every messaging.system value the
 * semantic conventions define and every spelling instrumentations are known
 * to send, that each spelling of one system shares one label (the grouping
 * the Queues catalog uses), that the lookup only ever answers from its own
 * table, and that the labels reach the built map and its search — without
 * the value as reported dropping out of that search: a broker node is named
 * after its host, so "eventhubs" must still find the node its label now
 * calls "Azure Event Hubs".
 */

const NOW: Date = new Date("2026-09-30T10:00:00Z");

interface MessagingLabel {
  // The canonical messaging.system the spellings fold into.
  system: string;
  label: string;
  spellings: ReadonlyArray<string>;
}

/*
 * The canonical system first in every group, then the other spellings seen
 * in the wild: semconv 1.24's azure_* values (renamed in 1.25), AmazonSQS
 * (older Java agents and Go otelaws), aws.sqs (Python, older JS), aws_sns
 * (Go otelaws), nats (Java agent), bullmq (BullMQ queues, OneUptime's own
 * included) and the aliases the Queues catalog normalizes.
 */
const MESSAGING_LABELS: ReadonlyArray<MessagingLabel> = [
  { system: "kafka", label: "Kafka", spellings: ["kafka"] },
  { system: "rabbitmq", label: "RabbitMQ", spellings: ["rabbitmq"] },
  {
    system: "activemq",
    label: "ActiveMQ",
    spellings: ["activemq", "artemis", "activemq_artemis"],
  },
  { system: "jms", label: "JMS", spellings: ["jms"] },
  {
    system: "aws_sqs",
    label: "Amazon SQS",
    spellings: ["aws_sqs", "aws.sqs", "amazonsqs", "sqs"],
  },
  {
    system: "aws.sns",
    label: "Amazon SNS",
    spellings: ["aws.sns", "aws_sns", "amazonsns", "sns"],
  },
  {
    system: "gcp_pubsub",
    label: "Pub/Sub",
    spellings: ["gcp_pubsub", "gcp.pubsub", "google_pubsub", "pubsub"],
  },
  {
    system: "servicebus",
    label: "Azure Service Bus",
    spellings: [
      "servicebus",
      "azure_servicebus",
      "azure.servicebus",
      "microsoft.servicebus",
    ],
  },
  {
    system: "eventhubs",
    label: "Azure Event Hubs",
    spellings: [
      "eventhubs",
      "azure_eventhubs",
      "azure.eventhubs",
      "microsoft.eventhub",
    ],
  },
  {
    system: "eventgrid",
    label: "Azure Event Grid",
    spellings: [
      "eventgrid",
      "azure_eventgrid",
      "azure.eventgrid",
      "microsoft.eventgrid",
    ],
  },
  {
    system: "pulsar",
    label: "Pulsar",
    spellings: ["pulsar", "apache_pulsar"],
  },
  { system: "rocketmq", label: "RocketMQ", spellings: ["rocketmq"] },
  { system: "nats", label: "NATS", spellings: ["nats", "jetstream"] },
  { system: "bullmq", label: "BullMQ", spellings: ["bullmq"] },
];

/*
 * The messaging.system well-known values of the semantic conventions
 * (model/messaging/registry.yaml, v1.44.0), exactly as spelled there.
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

const SPELLING_CASES: Array<[string, string]> = MESSAGING_LABELS.flatMap(
  (group: MessagingLabel): Array<[string, string]> => {
    return group.spellings.map((spelling: string): [string, string] => {
      return [spelling, group.label];
    });
  },
);

function entity(
  key: string,
  type: EntityType | string,
  overrides: Partial<TopologyEntity> = {},
): TopologyEntity {
  return {
    entityKey: key,
    displayName: key,
    entityType: type,
    source: EntitySource.Discovered,
    lastSeenAt: NOW,
    ...overrides,
  };
}

/*
 * A broker node the way ServiceDependencyDiscovery mints it: the system,
 * canonicalized, as both the identifying messaging.system and the
 * descriptive network.protocol.name, plus the broker host when known.
 */
function brokerNode(
  key: string,
  messagingSystem: string,
  serverAddress?: string,
): TopologyEntity {
  const canonical: string = canonicalizeEntityValue(messagingSystem);
  return entity(key, EntityType.RemoteService, {
    displayName: serverAddress || canonical,
    identifyingAttributes: {
      "messaging.system": canonical,
      ...(serverAddress ? { "server.address": serverAddress } : {}),
    },
    descriptiveAttributes: { "network.protocol.name": canonical },
  });
}

function calls(from: string, to: string): TopologyRelationship {
  return {
    fromEntityKey: from,
    toEntityKey: to,
    relationshipType: EntityRelationshipType.DependsOn,
    callCount: 10,
    errorCount: 0,
    avgDurationMs: 5,
  };
}

function visibleMatches(model: ServiceMapModel, search: string): Array<string> {
  const visibility: ServiceMapVisibility = resolveServiceMapVisibility({
    model,
    search,
    focusKey: null,
    attentionOnly: false,
  });
  return Array.from(visibility.matchedKeys).sort();
}

interface ShownDetail {
  label: string | null;
  value: string | null;
}

/*
 * The detail label and value the built Service Map gives a node — a service
 * is drawn in its own right, anything else once a service calls it —
 * checked against detailLabelForEntity and detailValueForEntity. The map
 * builds its entries itself, so every label this suite pins is read off the
 * map: pinning only the helpers would leave what the map shows unpinned.
 */
function shownDetail(node: TopologyEntity): ShownDetail {
  const caller: string = "detail-label-caller";
  const isService: boolean = node.entityType === EntityType.Service;
  const shown: ServiceMapEntry | undefined = buildServiceMapModel(
    isService ? [node] : [entity(caller, EntityType.Service), node],
    isService ? [] : [calls(caller, node.entityKey!)],
    {},
  ).entryByKey.get(node.entityKey!);
  expect(shown).toBeDefined();
  const detail: ShownDetail = {
    label: shown!.detailLabel,
    value: shown!.detailValue,
  };
  expect(detail).toEqual({
    label: detailLabelForEntity(node),
    value: detailValueForEntity(node),
  });
  return detail;
}

function shownLabel(node: TopologyEntity): string | null {
  return shownDetail(node).label;
}

describe("messaging systems get a friendly label on the Service Map", () => {
  test.each(SPELLING_CASES)(
    "%s reads as %s from the descriptive network.protocol.name",
    (spelling: string, label: string) => {
      expect(
        shownLabel(
          entity("broker", EntityType.RemoteService, {
            descriptiveAttributes: { "network.protocol.name": spelling },
          }),
        ),
      ).toBe(label);
    },
  );

  test.each(SPELLING_CASES)(
    "%s reads as %s from the identifying messaging.system alone",
    (spelling: string, label: string) => {
      expect(
        shownLabel(
          entity("broker", EntityType.RemoteService, {
            identifyingAttributes: { "messaging.system": spelling },
          }),
        ),
      ).toBe(label);
    },
  );

  test("every messaging.system value the semantic conventions define has a label", () => {
    const labelled: Set<string> = new Set<string>(
      MESSAGING_LABELS.flatMap(
        (group: MessagingLabel): ReadonlyArray<string> => {
          return group.spellings;
        },
      ),
    );
    for (const system of SEMCONV_MESSAGING_SYSTEMS) {
      expect({ system, labelled: labelled.has(system) }).toEqual({
        system,
        labelled: true,
      });
    }
  });

  test("each system's canonical value leads its group, and every spelling of one system reads the same", () => {
    for (const group of MESSAGING_LABELS) {
      expect(group.spellings[0]).toBe(group.system);
      const labels: Set<string | null> = new Set(
        group.spellings.map((spelling: string): string | null => {
          return shownLabel(
            entity("broker", EntityType.RemoteService, {
              descriptiveAttributes: { "network.protocol.name": spelling },
            }),
          );
        }),
      );
      expect({ system: group.system, labels: Array.from(labels) }).toEqual({
        system: group.system,
        labels: [group.label],
      });
    }

    // One spelling never belongs to two systems.
    const spellings: Array<string> = SPELLING_CASES.map(
      ([spelling]: [string, string]): string => {
        return spelling;
      },
    );
    expect(new Set(spellings).size).toBe(spellings.length);
  });

  test("case and surrounding whitespace do not matter", () => {
    for (const [raw, label] of [
      ["ServiceBus", "Azure Service Bus"],
      ["EVENTHUBS", "Azure Event Hubs"],
      ["AmazonSQS", "Amazon SQS"],
      ["AWS.SNS", "Amazon SNS"],
      ["Azure_EventGrid", "Azure Event Grid"],
      ["  nats  ", "NATS"],
      ["\tBullMQ ", "BullMQ"],
      ["RocketMQ", "RocketMQ"],
      ["Apache_Pulsar", "Pulsar"],
    ] as Array<[string, string]>) {
      expect({
        raw,
        label: shownLabel(
          entity("broker", EntityType.RemoteService, {
            descriptiveAttributes: { "network.protocol.name": raw },
          }),
        ),
      }).toEqual({ raw, label });
    }
  });

  test("an unknown broker still shows its system as reported", () => {
    for (const raw of ["ibmmq", "solace", "mqtt", "Redis-Streams"]) {
      expect(
        shownLabel(
          entity("broker", EntityType.RemoteService, {
            identifyingAttributes: { "messaging.system": raw },
          }),
        ),
      ).toBe(raw);
    }
  });

  test("the descriptive value still wins over the identifying one", () => {
    expect(
      shownLabel(
        entity("broker", EntityType.RemoteService, {
          descriptiveAttributes: { "network.protocol.name": "servicebus" },
          identifyingAttributes: { "messaging.system": "kafka" },
        }),
      ),
    ).toBe("Azure Service Bus");
  });

  /*
   * The label is the reported value under its friendly name; the value
   * itself is kept too, trimmed but in the case it was sent, from the same
   * attribute the label was read from.
   */
  test("the value a label comes from is kept as reported, trimmed", () => {
    for (const [attributes, value, label] of [
      [
        { descriptiveAttributes: { "network.protocol.name": "eventhubs" } },
        "eventhubs",
        "Azure Event Hubs",
      ],
      [
        { identifyingAttributes: { "messaging.system": "aws.sns" } },
        "aws.sns",
        "Amazon SNS",
      ],
      [
        { descriptiveAttributes: { "network.protocol.name": "  ServiceBus " } },
        "ServiceBus",
        "Azure Service Bus",
      ],
      [
        {
          descriptiveAttributes: { "network.protocol.name": "jetstream" },
          identifyingAttributes: { "messaging.system": "kafka" },
        },
        "jetstream",
        "NATS",
      ],
      [
        { identifyingAttributes: { "messaging.system": "ibmmq" } },
        "ibmmq",
        "ibmmq",
      ],
      [
        { descriptiveAttributes: { "network.protocol.name": "  " } },
        null,
        null,
      ],
      [{}, null, null],
    ] as Array<[Partial<TopologyEntity>, string | null, string | null]>) {
      const broker: TopologyEntity = entity(
        "broker",
        EntityType.RemoteService,
        attributes,
      );
      expect({ attributes, ...shownDetail(broker) }).toEqual({
        attributes,
        value,
        label,
      });
    }
  });

  test("the labels that were already there are unchanged", () => {
    for (const [raw, label, key] of [
      ["nodejs", "Node.js", "telemetry.sdk.language"],
      ["dotnet", ".NET", "telemetry.sdk.language"],
      ["postgresql", "PostgreSQL", "db.system.name"],
      ["microsoft.sql_server", "SQL Server", "db.system.name"],
      ["aws.dynamodb", "DynamoDB", "db.system.name"],
      ["http", "HTTP", "network.protocol.name"],
      ["grpc", "gRPC", "network.protocol.name"],
      ["kafka", "Kafka", "messaging.system"],
      ["rabbitmq", "RabbitMQ", "messaging.system"],
      ["activemq", "ActiveMQ", "messaging.system"],
      ["aws.sqs", "Amazon SQS", "messaging.system"],
      ["aws_sqs", "Amazon SQS", "messaging.system"],
      ["gcp_pubsub", "Pub/Sub", "messaging.system"],
    ] as Array<[string, string, string]>) {
      expect({
        raw,
        label: shownLabel(
          entity("x", EntityType.RemoteService, {
            descriptiveAttributes: { [key]: raw },
          }),
        ),
      }).toEqual({ raw, label });
    }
  });
});

describe("the label lookup only answers from its own table", () => {
  /*
   * A plain object lookup hands back Object.prototype members for these
   * names — a function or an object, which the map would then print as the
   * node's subtitle ("Remote Service · function Object() { [native code] }")
   * and make searchable. They are ordinary strings off the wire and must
   * read as sent.
   */
  const PROTOTYPE_NAMES: Array<string> = Object.getOwnPropertyNames(
    Object.prototype,
  );

  test("the sweep covers the names that matter", () => {
    expect(PROTOTYPE_NAMES).toEqual(
      expect.arrayContaining([
        "constructor",
        "__proto__",
        "toString",
        "valueOf",
        "hasOwnProperty",
        "isPrototypeOf",
        "propertyIsEnumerable",
        "toLocaleString",
        "__defineGetter__",
      ]),
    );
  });

  test.each(PROTOTYPE_NAMES)("%s reads as sent", (name: string) => {
    for (const raw of [name, name.toUpperCase(), ` ${name} `]) {
      const label: string | null = shownLabel(
        entity("x", EntityType.RemoteService, {
          descriptiveAttributes: { "network.protocol.name": raw },
        }),
      );
      expect(typeof label).toBe("string");
      expect(label).toBe(raw.trim());
    }
  });

  test("an Object.prototype name never becomes searchable function source", () => {
    const model: ServiceMapModel = buildServiceMapModel(
      [
        entity("api", EntityType.Service),
        brokerNode("odd-broker", "constructor"),
      ],
      [calls("api", "odd-broker")],
      {},
    );

    const broker: ServiceMapEntry = model.entryByKey.get("odd-broker")!;
    expect(broker.detailLabel).toBe("constructor");
    expect(visibleMatches(model, "native code")).toEqual([]);
    expect(visibleMatches(model, "constructor")).toEqual(["odd-broker"]);
  });
});

describe("the built Service Map shows and searches brokers by name", () => {
  const MAP_ENTITIES: Array<TopologyEntity> = [
    entity("orders-api", EntityType.Service, {
      descriptiveAttributes: { "telemetry.sdk.language": "dotnet" },
    }),
    entity("billing", EntityType.Service, {
      descriptiveAttributes: { "telemetry.sdk.language": "nodejs" },
    }),
    brokerNode("bus", "servicebus", "contoso.servicebus.windows.net"),
    brokerNode("hub", "eventhubs", "contoso-ingest.servicebus.windows.net"),
    brokerNode("grid", "eventgrid"),
    brokerNode("topic", "aws.sns", "sns.us-east-1.amazonaws.com"),
    brokerNode("legacy-queue", "AmazonSQS", "sqs.us-east-1.amazonaws.com"),
    brokerNode("jobs", "bullmq", "redis:6379"),
    brokerNode("events", "nats", "nats:4222"),
    brokerNode("legacy-bus", "azure_servicebus", "old.servicebus.windows.net"),
    brokerNode("stream", "jetstream", "nats-js:4222"),
  ];

  const MAP_RELATIONSHIPS: Array<TopologyRelationship> = [
    calls("orders-api", "bus"),
    calls("orders-api", "hub"),
    calls("orders-api", "grid"),
    calls("billing", "topic"),
    calls("billing", "legacy-queue"),
    calls("billing", "jobs"),
    calls("billing", "events"),
    calls("billing", "legacy-bus"),
    calls("billing", "stream"),
  ];

  function model(): ServiceMapModel {
    return buildServiceMapModel(MAP_ENTITIES, MAP_RELATIONSHIPS, {});
  }

  test("every broker node carries its friendly label, and the value it was reported as", () => {
    const result: ServiceMapModel = model();
    // [node, label, the canonical messaging.system the server shipped]
    const expected: Array<[string, string, string]> = [
      ["bus", "Azure Service Bus", "servicebus"],
      ["hub", "Azure Event Hubs", "eventhubs"],
      ["grid", "Azure Event Grid", "eventgrid"],
      ["topic", "Amazon SNS", "aws.sns"],
      ["legacy-queue", "Amazon SQS", "amazonsqs"],
      ["jobs", "BullMQ", "bullmq"],
      ["events", "NATS", "nats"],
      ["legacy-bus", "Azure Service Bus", "azure_servicebus"],
      ["stream", "NATS", "jetstream"],
    ];

    for (const [key, label, value] of expected) {
      const entry: ServiceMapEntry | undefined = result.entryByKey.get(key);
      expect({ key, present: Boolean(entry) }).toEqual({ key, present: true });
      expect({
        key,
        kind: entry!.kind,
        typeLabel: entry!.typeLabel,
        detailLabel: entry!.detailLabel,
        detailValue: entry!.detailValue,
      }).toEqual({
        key,
        kind: "remote",
        typeLabel: "Remote Service",
        detailLabel: label,
        detailValue: value,
      });
    }
  });

  test("searching a broker's product name finds its node", () => {
    const result: ServiceMapModel = model();

    /*
     * "azure" is in no host, key or reported value of bus, grid or hub —
     * only in their friendly labels — so matching those three proves the
     * label is searchable (legacy-bus also reports "azure_servicebus").
     * The other searches are what a person types; some of their words are
     * in a host or a reported value as well ("amazonaws.com", "eventhubs"),
     * and the node must be found whichever field holds them. (An Event Hubs
     * namespace is also a *.servicebus.windows.net host, so "service bus"
     * would rightly match it by address; that is why it is not used here.)
     */
    expect(visibleMatches(result, "azure")).toEqual([
      "bus",
      "grid",
      "hub",
      "legacy-bus",
    ]);
    expect(visibleMatches(result, "event hubs")).toEqual(["hub"]);
    expect(visibleMatches(result, "event grid")).toEqual(["grid"]);
    expect(visibleMatches(result, "amazon sns")).toEqual(["topic"]);
    expect(visibleMatches(result, "Amazon SQS")).toEqual(["legacy-queue"]);
    expect(visibleMatches(result, "bullmq")).toEqual(["jobs"]);
  });

  /*
   * A broker node is named after its host, and its label now reads
   * differently from the messaging.system its telemetry carries, so the
   * reported value is searchable in its own right. Each search below is in
   * no label, host or key of the map — only in that one node's reported
   * value — and found nothing before the value was searchable.
   */
  test("searching the value a broker was reported as still finds its node", () => {
    const result: ServiceMapModel = model();

    for (const [search, keys] of [
      ["eventhubs", ["hub"]],
      ["aws.sns", ["topic"]],
      ["AWS.SNS", ["topic"]],
      ["jetstream", ["stream"]],
      ["amazonsqs", ["legacy-queue"]],
      ["azure_servicebus", ["legacy-bus"]],
      // Languages too: "Node.js" and ".NET" are labels, not what SDKs send.
      ["nodejs", ["billing"]],
      ["dotnet", ["orders-api"]],
    ] as Array<[string, Array<string>]>) {
      expect({ search, matches: visibleMatches(result, search) }).toEqual({
        search,
        matches: keys,
      });
    }
  });
});

describe("the Service Map's messaging labels group spellings exactly as the Queues catalog does", () => {
  /*
   * The map keeps its own short labels ("Kafka", "Pub/Sub") where the
   * catalog carries full product names ("Apache Kafka", "Google Cloud
   * Pub/Sub"), so the strings differ on purpose — but the GROUPING must not:
   * every spelling the catalog folds into one system must get one label
   * here, or a broker would read differently on the map and in Queues.
   */
  test("every catalog system is a label group, with exactly its system and aliases as spellings", () => {
    for (const descriptor of MESSAGING_SYSTEMS) {
      const group: MessagingLabel | undefined = MESSAGING_LABELS.find(
        (candidate: MessagingLabel): boolean => {
          return candidate.system === descriptor.system;
        },
      );
      expect({ system: descriptor.system, grouped: Boolean(group) }).toEqual({
        system: descriptor.system,
        grouped: true,
      });
      expect([...(group?.spellings || [])].sort()).toEqual(
        [descriptor.system, ...descriptor.aliases].sort(),
      );
    }
  });

  test("every label group is a catalog system", () => {
    for (const group of MESSAGING_LABELS) {
      expect({
        system: group.system,
        known: MESSAGING_SYSTEMS.some(
          (descriptor: MessagingSystemDescriptor): boolean => {
            return descriptor.system === group.system;
          },
        ),
      }).toEqual({ system: group.system, known: true });
    }
  });

  test("every spelling the map labels normalizes to its group's system in the catalog", () => {
    for (const group of MESSAGING_LABELS) {
      for (const spelling of group.spellings) {
        expect({
          spelling,
          system: normalizeMessagingSystem(spelling),
        }).toEqual({ spelling, system: group.system });
      }
    }
  });
});
