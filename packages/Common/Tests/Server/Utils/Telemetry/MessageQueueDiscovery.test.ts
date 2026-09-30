import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  AZURE_MESSAGING_PROVIDER_NAMESPACES,
  DEFAULT_MESSAGE_QUEUE_MIN_SPANS,
  DiscoveredMessageQueue,
  MESSAGE_QUEUE_DISCOVERY_EXCLUDED_SPAN_KIND,
  MESSAGE_QUEUE_DISCOVERY_METRIC_NAMES,
  MESSAGE_QUEUE_LATE_METRIC_MINUTES,
  MESSAGE_QUEUE_LATE_METRIC_NAMES,
  MESSAGE_QUEUE_METRIC_PROJECTS_SQL_MARKER,
  MESSAGE_QUEUE_METRIC_SQL_MARKER,
  MESSAGE_QUEUE_MIN_SPANS_ENV,
  MESSAGE_QUEUE_SPAN_SQL_MARKER,
  MessageQueueDiscoveryWindow,
  MessageQueueEvidence,
  MessagingMetricDiscoveryRow,
  MessagingSpanDiscoveryRow,
  buildMessagingMetricDiscoverySql,
  buildMessagingMetricProjectsSql,
  buildMessagingSpanDiscoverySql,
  getDiscoveredMessageQueueBrokerAddress,
  getDiscoveredMessageQueueEvidenceCount,
  getMessageQueueCreationSource,
  getMessageQueueMinSpans,
  getMessagingDiscoveryColumn,
  isMessageQueueAutoCreateCandidate,
  mergeDiscoveredMessageQueues,
  resolveMessagingMetricDiscoveryRows,
  resolveMessagingSpanDiscoveryRows,
} from "../../../../Server/Utils/Telemetry/MessageQueueDiscovery";
import { DATABASE_ENDPOINT_SQL_MARKER } from "../../../../Server/Utils/Telemetry/DatabaseEndpointDiscovery";
import { QUERY_SETTINGS } from "../../../../Server/Utils/Telemetry/ServiceDependencyDiscovery";
import { SpanKind, SpanStatus } from "../../../../Models/AnalyticsModels/Span";
import {
  AZURE_RESOURCE_PROVIDER_ATTRIBUTES,
  MESSAGE_QUEUE_METRIC_EXCLUDED_SERIES_ATTRIBUTES,
  MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES,
  MESSAGING_RESOLVER_INPUT_ATTRIBUTES,
  MESSAGING_TRIGGER_ATTRIBUTES,
  ResolvedMessagingDestination,
  hasMessagingTrigger,
  resolveMessagingMetricDatapoint,
  resolveMessagingSpan,
} from "../../../../Types/MessageQueue/MessagingTelemetryResolver";
import {
  MESSAGE_QUEUE_BROKER_METRIC_NAMES,
  MESSAGE_QUEUE_METRICS,
  MESSAGING_CLIENT_METRIC_NAMES,
  MessageQueueMetricDescriptor,
} from "../../../../Types/MessageQueue/MessageQueueMetricCatalog";
import {
  MessageQueueIdentity,
  buildMessageQueueIdentifier,
  toMessageQueueIdentity,
} from "../../../../Types/MessageQueue/MessageQueueIdentity";
import { getMessagingBrokerMetricsSource } from "../../../../Types/MessageQueue/MessagingSystem";
import {
  FixtureAttributes,
  METRIC_FIXTURES,
  MetricFixture,
  SPAN_FIXTURES,
  SpanFixture,
  toStoredColumns,
} from "../../../Types/MessageQueue/MessagingTelemetryFixtures";

/*
 * Message queue discovery turns the window's messaging spans and broker /
 * client metric datapoints into MessageQueue rows. These tests pin what
 * decides whether it is right:
 *
 *   1. the queries — the core's own attribute lists selected and grouped on,
 *      nothing per message or per instance, the ingest trigger (Azure
 *      provider values included) as a prefilter that can only admit MORE
 *      than ingest, late cloud metrics read further back, bounded, and
 *      recognisable by their markers;
 *   2. that a stored row, read back through those columns, resolves to
 *      exactly the queue ingest keyed its telemetry on — for every fixture of
 *      the core's real-instrumentation corpus;
 *   3. merging (one entry per identity, the most specific system, the
 *      busiest spelling and address) and the create policy.
 *
 * The real-ClickHouse half lives in
 * App/Tests/Workers/Jobs/TelemetryEntity/MessageQueueDiscoveryClickhouse.test.ts.
 */

const PROJECT_ID: string = "8a4c5b1e-2b3f-4c1d-9e8f-1a2b3c4d5e6f";

const WINDOW: MessageQueueDiscoveryWindow = {
  projectId: PROJECT_ID,
  startSql: "toDateTime64('2026-09-24 09:45:00.000000000', 9)",
  endSql: "toDateTime64('2026-09-24 10:00:00.000000000', 9)",
  maxRows: 321,
};

// Keys that vary per message, per partition or per client instance.
const PER_INSTANCE_KEYS: ReadonlyArray<string> = [
  "resource.k8s.pod.name",
  "resource.host.name",
  "resource.service.instance.id",
  "resource.container.id",
  "messaging.message.id",
  "messaging.message.conversation_id",
  "messaging.kafka.message.offset",
  "messaging.kafka.offset",
  "messaging.kafka.message.key",
  "messaging.destination.partition.id",
  "messaging.kafka.destination.partition",
  "messaging.kafka.partition",
  "messaging.client.id",
  "messaging.client_id",
  "messaging.consumer_id",
  "messaging.batch.message_count",
  "messaging.message.body.size",
  "messaging.rabbitmq.delivery_tag",
];

/*
 * Characters String.prototype.trim removes and ClickHouse's trimBoth keeps,
 * built from their code points so no formatter can rewrite them.
 */
const NO_BREAK_SPACE: string = String.fromCharCode(0xa0);
const LINE_SEPARATOR: string = String.fromCharCode(0x2028);
const BYTE_ORDER_MARK: string = String.fromCharCode(0xfeff);
const IDEOGRAPHIC_SPACE: string = String.fromCharCode(0x3000);
// Lowercases to two UTF-16 code units ("i" and a combining dot).
const DOTTED_CAPITAL_I: string = String.fromCharCode(0x130);

function collapse(sql: string): string {
  return sql.replace(/\s+/g, " ");
}

// Every `attributes['<key>'] AS <column>` a query selects, in order.
function selectedColumns(sql: string): Array<[string, string]> {
  return Array.from(sql.matchAll(/attributes\['([^']+)'\] AS (a\d+)/g)).map(
    (match: RegExpMatchArray): [string, string] => {
      return [match[1]!, match[2]!];
    },
  );
}

// Every attribute key a query reads anywhere.
function attributeReads(sql: string): Set<string> {
  return new Set<string>(
    Array.from(sql.matchAll(/attributes\['([^']+)'\]/g)).map(
      (match: RegExpMatchArray): string => {
        return match[1]!;
      },
    ),
  );
}

// The values of one SQL `IN (...)` tuple that follows `prefix`.
function inTuple(sql: string, prefix: string): Array<string> {
  const start: number = sql.indexOf(prefix);
  expect(start).toBeGreaterThanOrEqual(0);
  const open: number = sql.indexOf("(", start + prefix.length - 1);
  const close: number = sql.indexOf(")", open);
  return Array.from(sql.substring(open, close).matchAll(/'([^']*)'/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

/*
 * A span query row for stored attributes: every selected key's value as
 * ClickHouse's Map(String, String) returns it (toStoredColumns), under its
 * column.
 */
function spanRow(
  kind: string | null,
  attributes: FixtureAttributes,
  overrides: Partial<MessagingSpanDiscoveryRow> = {},
): MessagingSpanDiscoveryRow {
  const stored: Record<string, string> = toStoredColumns(
    attributes,
    MESSAGING_RESOLVER_INPUT_ATTRIBUTES,
  );
  const row: MessagingSpanDiscoveryRow = {
    kind: kind,
    spanCount: "5",
    errorCount: "0",
    lastSeenUnixMs: "1790243100123",
  };
  MESSAGING_RESOLVER_INPUT_ATTRIBUTES.forEach(
    (key: string, index: number): void => {
      row[getMessagingDiscoveryColumn(index)] = stored[key];
    },
  );
  return { ...row, ...overrides };
}

function metricRow(
  name: string,
  attributes: FixtureAttributes,
  overrides: Partial<MessagingMetricDiscoveryRow> = {},
): MessagingMetricDiscoveryRow {
  const stored: Record<string, string> = toStoredColumns(
    attributes,
    MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES,
  );
  const row: MessagingMetricDiscoveryRow = {
    name: name,
    pointCount: "12",
    lastSeenUnixMs: "1790243100123",
  };
  MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES.forEach(
    (key: string, index: number): void => {
      row[getMessagingDiscoveryColumn(index)] = stored[key];
    },
  );
  return { ...row, ...overrides };
}

function identifierOf(
  resolved: ResolvedMessagingDestination | null,
): string | null {
  if (!resolved) {
    return null;
  }
  const identity: MessageQueueIdentity | null =
    toMessageQueueIdentity(resolved);
  return identity ? buildMessageQueueIdentifier(identity) : null;
}

function identifiers(queues: Array<DiscoveredMessageQueue>): Array<string> {
  return queues.map((queue: DiscoveredMessageQueue): string => {
    return queue.identifier;
  });
}

function getterOf(attributes: FixtureAttributes): (key: string) => unknown {
  return (key: string): unknown => {
    return Object.prototype.hasOwnProperty.call(attributes, key)
      ? attributes[key]
      : undefined;
  };
}

const KAFKA_ORDERS: FixtureAttributes = {
  "messaging.system": "kafka",
  "messaging.destination.name": "orders",
};

const SERVICE_BUS_HOST: string = "orders-prod.servicebus.windows.net";

function evidence(
  overrides: Partial<MessageQueueEvidence>,
): MessageQueueEvidence {
  return {
    count: 1,
    errorCount: 0,
    directions: { publish: 0, consume: 0, settle: 0, unknown: 1 },
    brokerAddress: null,
    lastSeenAt: null,
    ...overrides,
  };
}

function discovered(
  overrides: Partial<DiscoveredMessageQueue>,
): DiscoveredMessageQueue {
  const identity: MessageQueueIdentity = toMessageQueueIdentity({
    system: "kafka",
    destination: "orders",
  })!;
  return {
    identity: identity,
    identifier: buildMessageQueueIdentifier(identity)!,
    system: "kafka",
    destination: "orders",
    spans: null,
    brokerMetrics: null,
    clientMetrics: null,
    ...overrides,
  };
}

describe("buildMessagingSpanDiscoverySql", () => {
  const raw: string = buildMessagingSpanDiscoverySql(WINDOW);
  const sql: string = collapse(raw);

  test("carries a unique marker comment so the query is recognisable", () => {
    expect(MESSAGE_QUEUE_SPAN_SQL_MARKER).toBe("message-queue-span-discovery");
    expect(sql).toContain(`/* ${MESSAGE_QUEUE_SPAN_SQL_MARKER} */`);
    expect(sql).not.toContain(MESSAGE_QUEUE_METRIC_SQL_MARKER);
    expect(sql).not.toContain(MESSAGE_QUEUE_METRIC_PROJECTS_SQL_MARKER);
    expect(sql).not.toContain(DATABASE_ENDPOINT_SQL_MARKER);
  });

  test("reads one project's spans inside the window, naming the table once", () => {
    expect(sql).toContain(`WHERE projectId = '${PROJECT_ID}'`);
    expect(sql).toContain(`AND startTime >= ${WINDOW.startSql}`);
    expect(sql).toContain(`AND startTime < ${WINDOW.endSql}`);
    // The real-ClickHouse suite redirects the table with one replace.
    expect(sql.split("oneuptime.SpanItemV3").length - 1).toBe(1);
    expect(sql).toContain("FROM oneuptime.SpanItemV3");
    expect(sql).not.toContain("MetricItemV3");
  });

  test("reads every span ingest may key: any stored kind but SERVER, a missing one included", () => {
    expect(MESSAGE_QUEUE_DISCOVERY_EXCLUDED_SPAN_KIND).toBe(SpanKind.Server);
    expect(sql).toContain("AND ifNull(kind, '') != 'SPAN_KIND_SERVER'");
    // No allow-list of kinds: a pipeline can store any kind, or none.
    expect(sql).not.toMatch(/kind IN/i);
    /*
     * Outside string literals the column appears three times: the
     * predicate, the SELECT column and the GROUP BY column.
     */
    expect(sql.replace(/'[^']*'/g, "''").match(/\bkind\b/g)).toEqual([
      "kind",
      "kind",
      "kind",
    ]);
  });

  test("the kinds it reads resolve exactly as ingest resolved them: another SERVER spelling to nothing", () => {
    // ClickHouse's `ifNull(kind, '') != 'SPAN_KIND_SERVER'`, as TypeScript.
    const read: (kind: string | null) => boolean = (
      kind: string | null,
    ): boolean => {
      return (kind ?? "") !== MESSAGE_QUEUE_DISCOVERY_EXCLUDED_SPAN_KIND;
    };

    // Stored kinds a trace pipeline's Span Kind Remapper can write.
    const named: Array<string | null> = [
      SpanKind.Producer,
      SpanKind.Consumer,
      SpanKind.Client,
      SpanKind.Internal,
      "SPAN_KIND_UNSPECIFIED",
      "PRODUCER",
      "consumer",
      "",
      null,
    ];
    for (const kind of named) {
      expect({ kind, read: read(kind) }).toEqual({ kind, read: true });
      expect({
        kind,
        queues: identifiers(
          resolveMessagingSpanDiscoveryRows([spanRow(kind, KAFKA_ORDERS)]),
        ),
      }).toEqual({ kind, queues: ["kafka||orders"] });
    }

    // Other spellings of SERVER are read, and refused by the resolver.
    for (const kind of ["SERVER", "server", " span_kind_server "]) {
      expect(read(kind)).toBe(true);
      expect(
        resolveMessagingSpanDiscoveryRows([spanRow(kind, KAFKA_ORDERS)]),
      ).toEqual([]);
    }

    // The stored SERVER kind is not even read; the resolver refuses it too.
    expect(read(SpanKind.Server)).toBe(false);
    expect(
      resolveMessagingSpan({
        getAttribute: getterOf(KAFKA_ORDERS),
        kind: SpanKind.Server,
      }),
    ).toBeNull();
  });

  test("a span without a kind resolves like one ingest keyed without a kind", () => {
    const attributes: FixtureAttributes = {
      ...KAFKA_ORDERS,
      "messaging.operation": "receive",
    };
    const atIngest: ResolvedMessagingDestination | null = resolveMessagingSpan({
      getAttribute: getterOf(attributes),
      kind: undefined,
    });
    const queues: Array<DiscoveredMessageQueue> =
      resolveMessagingSpanDiscoveryRows([spanRow(null, attributes)]);

    expect(atIngest?.direction).toBe("consume");
    expect(identifiers(queues)).toEqual([identifierOf(atIngest)]);
    expect(queues[0]!.spans?.directions.consume).toBe(5);
  });

  test("selects exactly the attributes resolveMessagingSpan reads, one column each, in list order", () => {
    const columns: Array<[string, string]> = selectedColumns(raw);
    expect(
      columns.map((entry: [string, string]): string => {
        return entry[0];
      }),
    ).toEqual([...MESSAGING_RESOLVER_INPUT_ATTRIBUTES]);
    columns.forEach((entry: [string, string], index: number): void => {
      expect(entry[1]).toBe(getMessagingDiscoveryColumn(index));
    });
  });

  test("reads no attribute the resolver does not", () => {
    for (const key of attributeReads(raw)) {
      expect(MESSAGING_RESOLVER_INPUT_ATTRIBUTES).toContain(key);
    }
  });

  test("groups on the kind and every attribute column, and on nothing else", () => {
    const columns: string = MESSAGING_RESOLVER_INPUT_ATTRIBUTES.map(
      (_key: string, index: number): string => {
        return getMessagingDiscoveryColumn(index);
      },
    ).join(", ");
    expect(sql).toContain(`GROUP BY kind, ${columns} ORDER BY`);
  });

  test("counts the spans, the failed ones and the newest start", () => {
    expect(SpanStatus.Error).toBe(2);
    expect(sql).toContain("count() AS spanCount");
    expect(sql).toContain("countIf(statusCode = 2) AS errorCount");
    expect(sql).toContain(
      "toUnixTimestamp64Milli(max(startTime)) AS lastSeenUnixMs",
    );
  });

  test("drops spans without a messaging trigger on attributeKeys before reading the map", () => {
    const allTriggers: string = `AND hasAny(attributeKeys, [${MESSAGING_TRIGGER_ATTRIBUTES.map(
      (key: string): string => {
        return `'${key}'`;
      },
    ).join(", ")}])`;
    expect(sql).toContain(allTriggers);
    // The bloom-indexed prefilter comes before the map-reading condition.
    expect(sql.indexOf(allTriggers)).toBeLessThan(
      sql.indexOf("multiSearchAnyCaseInsensitive"),
    );
  });

  test("admits an Azure provider key only when it names Service Bus or Event Hubs, like the ingest trigger", () => {
    const presence: Array<string> = MESSAGING_TRIGGER_ATTRIBUTES.filter(
      (key: string): boolean => {
        return !AZURE_RESOURCE_PROVIDER_ATTRIBUTES.includes(key);
      },
    );
    const namespaces: string = `[${AZURE_MESSAGING_PROVIDER_NAMESPACES.map(
      (value: string): string => {
        return `'${value}'`;
      },
    ).join(", ")}]`;

    expect(sql).toContain(
      `AND (hasAny(attributeKeys, [${presence
        .map((key: string): string => {
          return `'${key}'`;
        })
        .join(
          ", ",
        )}]) OR multiSearchAnyCaseInsensitive(attributes['az.namespace'], ${namespaces}) OR multiSearchAnyCaseInsensitive(attributes['azure.resource_provider.namespace'], ${namespaces}))`,
    );
    expect(AZURE_RESOURCE_PROVIDER_ATTRIBUTES).toEqual([
      "az.namespace",
      "azure.resource_provider.namespace",
    ]);
  });

  test("never groups on anything that varies per message or per instance", () => {
    for (const key of PER_INSTANCE_KEYS) {
      expect(sql).not.toContain(key);
    }
    for (const column of ["primaryEntityId", "traceId", "spanId"]) {
      expect(sql).not.toContain(column);
    }
  });

  test("never reads an attribute the corpus shows varies per message or instance", () => {
    const read: Set<string> = attributeReads(raw);
    const corpusKeys: Set<string> = new Set<string>();
    for (const fixture of SPAN_FIXTURES) {
      for (const key of Object.keys(fixture.attributes)) {
        corpusKeys.add(key);
      }
    }
    for (const key of corpusKeys) {
      if (!MESSAGING_RESOLVER_INPUT_ATTRIBUTES.includes(key)) {
        expect({ key, read: read.has(key) }).toEqual({ key, read: false });
      }
    }
    // The corpus does carry such keys: the check above is not vacuous.
    expect(corpusKeys.has("messaging.kafka.message.offset")).toBe(true);
    expect(corpusKeys.has("messaging.client_id")).toBe(true);
  });

  test("is bounded: the busiest groups first, row cap, query settings", () => {
    expect(sql).toContain("ORDER BY spanCount DESC LIMIT 321 ");
    expect(sql.trim().endsWith(QUERY_SETTINGS)).toBe(true);
  });

  test("a nonsensical row cap still yields a bounded query", () => {
    for (const maxRows of [0, 0.5, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        collapse(buildMessagingSpanDiscoverySql({ ...WINDOW, maxRows })),
      ).toContain("LIMIT 1 ");
    }
    expect(
      collapse(buildMessagingSpanDiscoverySql({ ...WINDOW, maxRows: 12.9 })),
    ).toContain("LIMIT 12 ");
  });

  test("escapes the project id", () => {
    expect(
      buildMessagingSpanDiscoverySql({
        ...WINDOW,
        projectId: "x' OR '1'='1",
      }),
    ).toContain("projectId = 'x\\' OR \\'1\\'=\\'1'");
  });

  test("never mentions the dependency queries' routing markers", () => {
    // ComputeServiceDependencies tells its queries apart by these.
    expect(sql).not.toContain("SELECT DISTINCT projectId");
    expect(sql).not.toContain("NOT IN");
    expect(sql).not.toContain("INNER JOIN");
  });
});

describe("the Azure provider values the span query admits", () => {
  // ClickHouse's multiSearchAnyCaseInsensitive: ASCII case folding, substring.
  function sqlAdmits(value: string): boolean {
    const lower: string = value.replace(/[A-Z]/g, (letter: string): string => {
      return letter.toLowerCase();
    });
    return AZURE_MESSAGING_PROVIDER_NAMESPACES.some(
      (namespace: string): boolean => {
        return lower.includes(namespace);
      },
    );
  }

  test("are exactly Service Bus's and Event Hubs' resource provider namespaces", () => {
    expect([...AZURE_MESSAGING_PROVIDER_NAMESPACES]).toEqual([
      "microsoft.eventhub",
      "microsoft.servicebus",
    ]);

    for (const [namespace, system] of [
      ["Microsoft.ServiceBus", "servicebus"],
      ["Microsoft.EventHub", "eventhubs"],
    ] as Array<[string, string]>) {
      for (const key of AZURE_RESOURCE_PROVIDER_ATTRIBUTES) {
        const attributes: FixtureAttributes = {
          [key]: namespace,
          "messaging.destination.name": "orders",
        };
        expect(hasMessagingTrigger({ [key]: namespace })).toBe(true);
        expect(
          resolveMessagingSpan({
            getAttribute: getterOf(attributes),
            kind: SpanKind.Producer,
          })?.system,
        ).toBe(system);
      }
    }
  });

  test("admit every value ingest's trigger admits, whatever whitespace or case surrounds it", () => {
    const probes: Array<string> = [
      "Microsoft.ServiceBus",
      "Microsoft.EventHub",
      "MICROSOFT.SERVICEBUS",
      "microsoft.eventhub",
      " Microsoft.ServiceBus ",
      "\tMicrosoft.EventHub\n",
      `${NO_BREAK_SPACE}Microsoft.ServiceBus${LINE_SEPARATOR}`,
      `${BYTE_ORDER_MARK}microsoft.servicebus${IDEOGRAPHIC_SPACE}`,
      "\u000bMicrosoft.EventHub\u000c",
      "Microsoft.Storage",
      "Microsoft.KeyVault",
      "Microsoft.DocumentDB",
      "Microsoft.EventGrid",
      "Microsoft.ServiceBus/namespaces",
      "",
      "   ",
    ];

    for (const value of probes) {
      for (const key of AZURE_RESOURCE_PROVIDER_ATTRIBUTES) {
        if (hasMessagingTrigger({ [key]: value })) {
          expect({ value, sql: sqlAdmits(value) }).toEqual({
            value,
            sql: true,
          });
        }
      }
    }
  });

  test("keep other Azure services' spans out of the query", () => {
    for (const value of [
      "Microsoft.Storage",
      "Microsoft.KeyVault",
      "Microsoft.DocumentDB",
      "Microsoft.EventGrid",
      "Microsoft.AppConfiguration",
    ]) {
      expect(sqlAdmits(value)).toBe(false);
      expect(hasMessagingTrigger({ "az.namespace": value })).toBe(false);
    }
  });
});

describe("buildMessagingMetricDiscoverySql", () => {
  const raw: string = buildMessagingMetricDiscoverySql(WINDOW);
  const sql: string = collapse(raw);

  test("carries a unique marker comment so the query is recognisable", () => {
    expect(MESSAGE_QUEUE_METRIC_SQL_MARKER).toBe(
      "message-queue-metric-discovery",
    );
    expect(sql).toContain(`/* ${MESSAGE_QUEUE_METRIC_SQL_MARKER} */`);
    expect(sql).not.toContain(`/* ${MESSAGE_QUEUE_SPAN_SQL_MARKER} */`);
    expect(sql).not.toContain(MESSAGE_QUEUE_METRIC_PROJECTS_SQL_MARKER);
  });

  test("reads one project's metric table, naming it once", () => {
    expect(sql).toContain(`WHERE projectId = '${PROJECT_ID}'`);
    expect(sql.split("oneuptime.MetricItemV3").length - 1).toBe(1);
    expect(sql).toContain("FROM oneuptime.MetricItemV3");
    expect(sql).not.toContain("SpanItemV3");
  });

  test("reads exactly the curated broker metrics and the messaging client metrics, as stored", () => {
    const expected: Array<string> = Array.from(
      new Set<string>([
        ...MESSAGE_QUEUE_BROKER_METRIC_NAMES,
        ...MESSAGING_CLIENT_METRIC_NAMES,
      ]),
    ).sort();

    expect([...MESSAGE_QUEUE_DISCOVERY_METRIC_NAMES]).toEqual(expected);
    expect(inTuple(sql, "AND name IN (")).toEqual(expected);
    for (const name of MESSAGE_QUEUE_DISCOVERY_METRIC_NAMES) {
      expect(name).toBe(name.trim().toLowerCase());
    }
  });

  test("never reads an application's own gauge: it attaches to a queue, it never creates one", () => {
    expect(MESSAGE_QUEUE_DISCOVERY_METRIC_NAMES).not.toContain("queue.size");
    expect(sql).not.toContain("'queue.size'");
  });

  test("selects exactly the attributes resolveMessagingMetricDatapoint reads, one column each, in list order", () => {
    const columns: Array<[string, string]> = selectedColumns(raw);
    expect(
      columns.map((entry: [string, string]): string => {
        return entry[0];
      }),
    ).toEqual([...MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES]);
    columns.forEach((entry: [string, string], index: number): void => {
      expect(entry[1]).toBe(getMessagingDiscoveryColumn(index));
    });
    for (const key of attributeReads(raw)) {
      expect(MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES).toContain(key);
    }
  });

  test("covers every catalog entry's destination, scope and required keys, and the span keys", () => {
    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      for (const key of [
        ...descriptor.destinationAttributes,
        ...(descriptor.scopeAttributes || []),
        ...Object.keys(descriptor.requiredAttributes || {}),
      ]) {
        expect(MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES).toContain(key);
      }
    }
    for (const key of MESSAGING_RESOLVER_INPUT_ATTRIBUTES) {
      expect(MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES).toContain(key);
    }
  });

  test("never groups or filters on a per-consumer series key", () => {
    expect(
      MESSAGE_QUEUE_METRIC_EXCLUDED_SERIES_ATTRIBUTES.length,
    ).toBeGreaterThan(0);
    for (const key of MESSAGE_QUEUE_METRIC_EXCLUDED_SERIES_ATTRIBUTES) {
      expect(sql).not.toContain(key);
    }
  });

  test("never groups on a series key or anything per instance", () => {
    const seriesKeys: Set<string> = new Set<string>();
    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      for (const key of descriptor.seriesKeys || []) {
        seriesKeys.add(key);
      }
    }
    for (const key of seriesKeys) {
      if (!MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES.includes(key)) {
        expect(sql).not.toContain(`attributes['${key}']`);
      }
    }
    for (const key of PER_INSTANCE_KEYS) {
      expect(sql).not.toContain(key);
    }
    for (const column of ["primaryEntityId", "traceId", "spanId"]) {
      expect(sql).not.toContain(column);
    }
  });

  test("groups on the name and every attribute column, counting datapoints and the newest time", () => {
    const columns: string = MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES.map(
      (_key: string, index: number): string => {
        return getMessagingDiscoveryColumn(index);
      },
    ).join(", ");
    expect(sql).toContain(`GROUP BY name, ${columns} ORDER BY`);
    expect(sql).toContain("count() AS pointCount");
    expect(sql).toContain(
      "toUnixTimestamp64Milli(max(time)) AS lastSeenUnixMs",
    );
  });

  test("reads cloud-monitoring metrics further back than the window, and the rest inside it", () => {
    expect(MESSAGE_QUEUE_LATE_METRIC_MINUTES).toBe(45);
    expect(sql).toContain(
      `AND time >= ${WINDOW.startSql} - INTERVAL 45 MINUTE AND time < ${WINDOW.endSql} AND (time >= ${WINDOW.startSql} OR name IN (`,
    );
    expect(inTuple(sql, `OR name IN (`)).toEqual([
      ...MESSAGE_QUEUE_LATE_METRIC_NAMES,
    ]);
  });

  test("the late metrics are exactly the curated metrics of the cloud-monitoring systems", () => {
    const cloud: Array<string> = Array.from(
      new Set<string>(
        MESSAGE_QUEUE_METRICS.filter(
          (descriptor: MessageQueueMetricDescriptor): boolean => {
            return [
              "servicebus",
              "eventhubs",
              "eventgrid",
              "aws_sqs",
              "aws.sns",
              "gcp_pubsub",
            ].includes(descriptor.system);
          },
        ).map((descriptor: MessageQueueMetricDescriptor): string => {
          return descriptor.metricName;
        }),
      ),
    ).sort();

    expect([...MESSAGE_QUEUE_LATE_METRIC_NAMES]).toEqual(cloud);
    expect(cloud.length).toBeGreaterThan(10);

    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      const late: boolean = MESSAGE_QUEUE_LATE_METRIC_NAMES.includes(
        descriptor.metricName,
      );
      if (
        getMessagingBrokerMetricsSource(descriptor.system).kind !==
        "cloud-monitoring"
      ) {
        expect({ name: descriptor.metricName, late }).toEqual({
          name: descriptor.metricName,
          late: false,
        });
      }
    }
    for (const name of MESSAGING_CLIENT_METRIC_NAMES) {
      expect(MESSAGE_QUEUE_LATE_METRIC_NAMES).not.toContain(name);
    }
  });

  test("is bounded and escaped, and never mentions another query's routing markers", () => {
    expect(sql).toContain("ORDER BY pointCount DESC LIMIT 321 ");
    expect(sql.trim().endsWith(QUERY_SETTINGS)).toBe(true);
    expect(
      collapse(buildMessagingMetricDiscoverySql({ ...WINDOW, maxRows: -1 })),
    ).toContain("LIMIT 1 ");
    expect(
      buildMessagingMetricDiscoverySql({ ...WINDOW, projectId: "a'b" }),
    ).toContain("projectId = 'a\\'b'");
    expect(sql).not.toContain("SELECT DISTINCT projectId");
    expect(sql).not.toContain("NOT IN");
    expect(sql).not.toContain("INNER JOIN");
    expect(sql).not.toContain(DATABASE_ENDPOINT_SQL_MARKER);
  });
});

describe("buildMessagingMetricProjectsSql", () => {
  const sql: string = collapse(
    buildMessagingMetricProjectsSql({
      startSql: WINDOW.startSql,
      endSql: WINDOW.endSql,
      maxProjects: 1000,
    }),
  );

  test("lists the projects whose broker or client metrics the metric query would read", () => {
    expect(sql).toContain(`/* ${MESSAGE_QUEUE_METRIC_PROJECTS_SQL_MARKER} */`);
    expect(sql).toContain(
      "SELECT DISTINCT projectId FROM oneuptime.MetricItemV3",
    );
    expect(inTuple(sql, "WHERE name IN (")).toEqual([
      ...MESSAGE_QUEUE_DISCOVERY_METRIC_NAMES,
    ]);
    expect(sql).toContain(
      `AND time >= ${WINDOW.startSql} - INTERVAL 45 MINUTE AND time < ${WINDOW.endSql} AND (time >= ${WINDOW.startSql} OR name IN (`,
    );
    expect(sql).toContain("LIMIT 1000 ");
    expect(sql.trim().endsWith(QUERY_SETTINGS)).toBe(true);
    // A project scan reads no attribute at all.
    expect(sql).not.toContain("attributes[");
    expect(sql).not.toContain(MESSAGE_QUEUE_METRIC_SQL_MARKER + " ");
  });
});

describe("a stored row resolves to exactly the queue ingest keyed its telemetry on", () => {
  test.each(
    SPAN_FIXTURES.map((fixture: SpanFixture): [string, SpanFixture] => {
      return [fixture.name, fixture];
    }),
  )("span: %s", (_name: string, fixture: SpanFixture) => {
    const atIngest: ResolvedMessagingDestination | null = resolveMessagingSpan({
      getAttribute: getterOf(fixture.attributes),
      kind: fixture.kind,
    });
    const expected: string | null = identifierOf(atIngest);
    const queues: Array<DiscoveredMessageQueue> =
      resolveMessagingSpanDiscoveryRows([
        spanRow(fixture.kind, fixture.attributes),
      ]);

    expect(identifiers(queues)).toEqual(expected ? [expected] : []);
    if (expected) {
      expect(queues[0]!.system).toBe(atIngest!.system);
      expect(queues[0]!.destination).toBe(atIngest!.destination);
      expect(queues[0]!.spans?.brokerAddress).toBe(atIngest!.brokerAddress);
      expect(queues[0]!.spans?.directions[atIngest!.direction]).toBe(5);
    }
  });

  test.each(
    METRIC_FIXTURES.map((fixture: MetricFixture): [string, MetricFixture] => {
      return [fixture.name, fixture];
    }),
  )("datapoint: %s", (_name: string, fixture: MetricFixture) => {
    const atIngest: ResolvedMessagingDestination | null =
      resolveMessagingMetricDatapoint({
        metricName: fixture.metricName,
        getAttribute: getterOf(fixture.attributes),
      });
    const expected: string | null = identifierOf(atIngest);
    const queues: Array<DiscoveredMessageQueue> =
      resolveMessagingMetricDiscoveryRows([
        metricRow(fixture.metricName, fixture.attributes),
      ]);

    expect(identifiers(queues)).toEqual(expected ? [expected] : []);
    if (expected) {
      const broker: boolean = MESSAGE_QUEUE_BROKER_METRIC_NAMES.has(
        fixture.metricName,
      );
      expect(queues[0]!.system).toBe(atIngest!.system);
      expect(queues[0]!.brokerMetrics !== null).toBe(broker);
      expect(queues[0]!.clientMetrics !== null).toBe(!broker);
      expect(queues[0]!.spans).toBeNull();
    }
  });

  test("the corpus covers every kind of outcome", () => {
    const spanQueues: number = SPAN_FIXTURES.filter(
      (fixture: SpanFixture): boolean => {
        return fixture.expected !== null;
      },
    ).length;
    expect(spanQueues).toBeGreaterThan(60);
    expect(SPAN_FIXTURES.length - spanQueues).toBeGreaterThan(15);
    expect(METRIC_FIXTURES.length).toBeGreaterThan(80);
  });

  test("every key the resolvers read for the corpus is a column the queries select", () => {
    const spanKeys: Set<string> = new Set<string>(
      selectedColumns(buildMessagingSpanDiscoverySql(WINDOW)).map(
        (entry: [string, string]): string => {
          return entry[0];
        },
      ),
    );
    const metricKeys: Set<string> = new Set<string>(
      selectedColumns(buildMessagingMetricDiscoverySql(WINDOW)).map(
        (entry: [string, string]): string => {
          return entry[0];
        },
      ),
    );

    for (const fixture of SPAN_FIXTURES) {
      resolveMessagingSpan({
        getAttribute: (key: string): unknown => {
          expect({
            fixture: fixture.name,
            key,
            selected: spanKeys.has(key),
          }).toEqual({ fixture: fixture.name, key, selected: true });
          return fixture.attributes[key];
        },
        kind: fixture.kind,
      });
    }

    for (const fixture of METRIC_FIXTURES) {
      resolveMessagingMetricDatapoint({
        metricName: fixture.metricName,
        getAttribute: (key: string): unknown => {
          /*
           * A per-consumer marker is read only to DROP a datapoint, and is
           * deliberately not selected (see the metric query).
           */
          const selected: boolean =
            metricKeys.has(key) ||
            MESSAGE_QUEUE_METRIC_EXCLUDED_SERIES_ATTRIBUTES.includes(key);
          expect({ fixture: fixture.name, key, selected }).toEqual({
            fixture: fixture.name,
            key,
            selected: true,
          });
          return fixture.attributes[key];
        },
      });
    }
  });
});

describe("resolveMessagingSpanDiscoveryRows", () => {
  test("rows that name one queue merge: spans, failures and directions summed", () => {
    const queues: Array<DiscoveredMessageQueue> =
      resolveMessagingSpanDiscoveryRows([
        spanRow(
          SpanKind.Producer,
          { ...KAFKA_ORDERS, "messaging.operation": "publish" },
          { spanCount: "40", errorCount: "2" },
        ),
        spanRow(
          SpanKind.Consumer,
          {
            ...KAFKA_ORDERS,
            "messaging.operation.type": "process",
            "messaging.consumer.group.name": "billing",
          },
          { spanCount: "35", errorCount: "1" },
        ),
        spanRow(
          SpanKind.Client,
          {
            ...KAFKA_ORDERS,
            "messaging.operation.type": "receive",
            "messaging.operation.name": "poll",
          },
          { spanCount: 7, errorCount: 0 },
        ),
      ]);

    expect(queues).toHaveLength(1);
    expect(queues[0]!.identifier).toBe("kafka||orders");
    expect(queues[0]!.spans).toEqual({
      count: 82,
      errorCount: 3,
      directions: { publish: 40, consume: 42, settle: 0, unknown: 0 },
      brokerAddress: null,
      lastSeenAt: new Date(1790243100123),
    });
    expect(queues[0]!.brokerMetrics).toBeNull();
    expect(queues[0]!.clientMetrics).toBeNull();
  });

  test("a SERVER span, a span without a trigger and another Azure service's span resolve to nothing", () => {
    expect(
      resolveMessagingSpanDiscoveryRows([
        spanRow(SpanKind.Server, KAFKA_ORDERS),
        spanRow(SpanKind.Client, {
          "server.address": "api.example.com",
          "rpc.system": "grpc",
        }),
        spanRow(SpanKind.Client, {
          "az.namespace": "Microsoft.Storage",
          "server.address": "acct.blob.core.windows.net",
        }),
      ]),
    ).toEqual([]);
  });

  test("temporary, generated and placeholder destinations resolve to nothing", () => {
    expect(
      resolveMessagingSpanDiscoveryRows([
        spanRow(SpanKind.Consumer, {
          "messaging.system": "rabbitmq",
          "messaging.destination.name": "amq.gen-JzTY20BRgKO-HjmUJj0wLg",
        }),
        spanRow(SpanKind.Consumer, {
          "messaging.system": "jms",
          "messaging.destination.name": "(temporary)",
        }),
        spanRow(SpanKind.Producer, {
          ...KAFKA_ORDERS,
          "messaging.destination.temporary": "true",
        }),
        spanRow(SpanKind.Producer, {
          "messaging.system": "nats",
          "messaging.destination.name": "_INBOX.abc123",
        }),
        spanRow(SpanKind.Producer, {
          "messaging.system": "kafka",
          "messaging.destination.name": "7f1c2a9e-4b1d-4c3e-9f1a-2b3c4d5e6f70",
        }),
      ]),
    ).toEqual([]);
  });

  test("per-request names template into one queue", () => {
    const queues: Array<DiscoveredMessageQueue> =
      resolveMessagingSpanDiscoveryRows([
        spanRow(SpanKind.Producer, {
          "messaging.system": "rabbitmq",
          "messaging.destination.name":
            "reply-7f1c2a9e-4b1d-4c3e-9f1a-2b3c4d5e6f70",
        }),
        spanRow(SpanKind.Producer, {
          "messaging.system": "rabbitmq",
          "messaging.destination.name":
            "reply-0b1c2d3e-4f50-4617-8829-3a4b5c6d7e8f",
        }),
      ]);

    expect(identifiers(queues)).toEqual(["rabbitmq||reply-{uuid}"]);
    expect(queues[0]!.spans?.count).toBe(10);
  });

  test("Pulsar partitions fold into their topic, and Service Bus entity paths into their entity", () => {
    const queues: Array<DiscoveredMessageQueue> =
      resolveMessagingSpanDiscoveryRows([
        spanRow(SpanKind.Producer, {
          "messaging.system": "pulsar",
          "messaging.destination.name": "orders-partition-0",
        }),
        spanRow(SpanKind.Producer, {
          "messaging.system": "pulsar",
          "messaging.destination.name": "orders-partition-3",
        }),
        spanRow(SpanKind.Consumer, {
          "messaging.system": "servicebus",
          "messaging.destination.name": "orders/Subscriptions/billing",
          "server.address": SERVICE_BUS_HOST,
        }),
        spanRow(SpanKind.Consumer, {
          "messaging.system": "servicebus",
          "messaging.destination.name": "orders/$DeadLetterQueue",
          "server.address": SERVICE_BUS_HOST,
        }),
      ]);

    expect(identifiers(queues).sort()).toEqual([
      "pulsar||persistent://public/default/orders",
      "servicebus|orders-prod|orders",
    ]);
  });

  test("a destination whose identifier cannot be built is dropped, as ingest stamps no key on it", () => {
    // Lowercasing U+0130 doubles it: 255 characters, 510 once canonical.
    const overlong: string = DOTTED_CAPITAL_I.repeat(255);
    expect(
      resolveMessagingSpan({
        getAttribute: getterOf({
          "messaging.system": "kafka",
          "messaging.destination.name": overlong,
        }),
        kind: SpanKind.Producer,
      })?.destination,
    ).toBe(overlong);

    expect(
      resolveMessagingSpanDiscoveryRows([
        spanRow(SpanKind.Producer, {
          "messaging.system": "kafka",
          "messaging.destination.name": overlong,
        }),
      ]),
    ).toEqual([]);
  });

  test("keeps the busiest spelling of a destination and the busiest broker address", () => {
    const queues: Array<DiscoveredMessageQueue> =
      resolveMessagingSpanDiscoveryRows([
        spanRow(
          SpanKind.Producer,
          {
            "messaging.system": "kafka",
            "messaging.destination.name": "orders",
            "server.address": "kafka-1",
            "server.port": "9092",
          },
          { spanCount: "2" },
        ),
        spanRow(
          SpanKind.Consumer,
          {
            "messaging.system": "kafka",
            "messaging.destination.name": "Orders",
            "server.address": "kafka-2",
            "server.port": "9092",
          },
          { spanCount: "9" },
        ),
      ]);

    expect(queues).toHaveLength(1);
    expect(queues[0]!.destination).toBe("Orders");
    expect(queues[0]!.spans?.brokerAddress).toBe("kafka-2:9092");
  });

  test("ties are broken by value, so the answer never depends on row order", () => {
    const a: MessagingSpanDiscoveryRow = spanRow(SpanKind.Producer, {
      "messaging.system": "kafka",
      "messaging.destination.name": "orders",
      "server.address": "kafka-b",
    });
    const b: MessagingSpanDiscoveryRow = spanRow(SpanKind.Producer, {
      "messaging.system": "kafka",
      "messaging.destination.name": "Orders",
      "server.address": "kafka-a",
    });

    for (const rows of [
      [a, b],
      [b, a],
    ]) {
      const [queue]: Array<DiscoveredMessageQueue> =
        resolveMessagingSpanDiscoveryRows(rows);
      expect(queue!.destination).toBe("Orders");
      expect(queue!.spans?.brokerAddress).toBe("kafka-a");
    }
  });

  test("keeps the newest time; a missing or unreadable one is unknown", () => {
    const [queue]: Array<DiscoveredMessageQueue> =
      resolveMessagingSpanDiscoveryRows([
        spanRow(SpanKind.Producer, KAFKA_ORDERS, {
          lastSeenUnixMs: "1790243000000",
        }),
        spanRow(
          SpanKind.Consumer,
          { ...KAFKA_ORDERS, "messaging.operation.type": "process" },
          { lastSeenUnixMs: 1790243100999 },
        ),
      ]);
    expect(queue!.spans?.lastSeenAt?.getTime()).toBe(1790243100999);

    for (const lastSeenUnixMs of [undefined, "", "yesterday", "-5", 0]) {
      const [unknown]: Array<DiscoveredMessageQueue> =
        resolveMessagingSpanDiscoveryRows([
          spanRow(SpanKind.Producer, KAFKA_ORDERS, { lastSeenUnixMs }),
        ]);
      expect(unknown!.spans?.lastSeenAt).toBeNull();
    }
  });

  test("malformed counts count as zero, never NaN, and the queue is still seen", () => {
    const [queue]: Array<DiscoveredMessageQueue> =
      resolveMessagingSpanDiscoveryRows([
        spanRow(SpanKind.Producer, KAFKA_ORDERS, {
          spanCount: "lots",
          errorCount: undefined,
        }),
      ]);
    expect(queue!.spans?.count).toBe(0);
    expect(queue!.spans?.errorCount).toBe(0);
  });

  test("returns the busiest queues first, then by identifier", () => {
    const queues: Array<DiscoveredMessageQueue> =
      resolveMessagingSpanDiscoveryRows([
        spanRow(
          SpanKind.Producer,
          { "messaging.system": "kafka", "messaging.destination.name": "b" },
          { spanCount: "3" },
        ),
        spanRow(
          SpanKind.Producer,
          { "messaging.system": "kafka", "messaging.destination.name": "c" },
          { spanCount: "30" },
        ),
        spanRow(
          SpanKind.Producer,
          { "messaging.system": "kafka", "messaging.destination.name": "a" },
          { spanCount: "3" },
        ),
      ]);
    expect(identifiers(queues)).toEqual(["kafka||c", "kafka||a", "kafka||b"]);
  });

  test("tolerates junk input", () => {
    expect(resolveMessagingSpanDiscoveryRows([])).toEqual([]);
    expect(
      resolveMessagingSpanDiscoveryRows(
        null as unknown as Array<MessagingSpanDiscoveryRow>,
      ),
    ).toEqual([]);
    expect(
      resolveMessagingSpanDiscoveryRows([
        null as unknown as MessagingSpanDiscoveryRow,
        "row" as unknown as MessagingSpanDiscoveryRow,
        { kind: 5 as unknown as string, a0: "kafka" },
      ]),
    ).toEqual([]);
  });

  test("1000 pods of one queue are one group: nothing selected varies per instance", () => {
    const projections: Set<string> = new Set<string>();
    for (let pod: number = 0; pod < 1000; pod++) {
      const row: MessagingSpanDiscoveryRow = spanRow(SpanKind.Consumer, {
        ...KAFKA_ORDERS,
        "messaging.operation.type": "process",
        "messaging.consumer.group.name": "billing",
        "resource.k8s.pod.name": `billing-${pod}`,
        "resource.service.instance.id": `instance-${pod}`,
        "resource.host.name": `node-${pod % 7}`,
        "messaging.client.id": `consumer-billing-${pod}`,
        "messaging.kafka.offset": pod * 17,
        "messaging.destination.partition.id": String(pod % 12),
        "messaging.message.id": `message-${pod}`,
      });
      delete row["spanCount"];
      delete row["errorCount"];
      delete row["lastSeenUnixMs"];
      projections.add(JSON.stringify(row));
    }
    expect(projections.size).toBe(1);
  });
});

describe("resolveMessagingMetricDiscoveryRows", () => {
  test("a curated broker metric is broker evidence; a messaging client metric is client evidence", () => {
    const queues: Array<DiscoveredMessageQueue> =
      resolveMessagingMetricDiscoveryRows([
        metricRow(
          "kafka.consumer_group.lag_sum",
          { topic: "orders", group: "billing" },
          { pointCount: "60", lastSeenUnixMs: "1790243000000" },
        ),
        metricRow(
          "messaging.client.sent.messages",
          { ...KAFKA_ORDERS, "server.address": "kafka-1" },
          { pointCount: "4", lastSeenUnixMs: "1790243100000" },
        ),
      ]);

    expect(queues).toHaveLength(1);
    expect(queues[0]!.brokerMetrics).toEqual({
      count: 60,
      errorCount: 0,
      directions: { publish: 0, consume: 0, settle: 0, unknown: 60 },
      brokerAddress: null,
      lastSeenAt: new Date(1790243000000),
    });
    expect(queues[0]!.clientMetrics).toEqual({
      count: 4,
      errorCount: 0,
      directions: { publish: 4, consume: 0, settle: 0, unknown: 0 },
      brokerAddress: "kafka-1",
      lastSeenAt: new Date(1790243100000),
    });
    expect(queues[0]!.spans).toBeNull();
  });

  test("an ActiveMQ datapoint keys the JMS family and records ActiveMQ", () => {
    const [queue]: Array<DiscoveredMessageQueue> =
      resolveMessagingMetricDiscoveryRows([
        metricRow("activemq.message.queue.size", {
          "messaging.destination.name": "orders",
          "activemq.destination.type": "queue",
        }),
      ]);
    expect(queue!.identifier).toBe("jms||orders");
    expect(queue!.identity.system).toBe("jms");
    expect(queue!.system).toBe("activemq");
  });

  test("Azure Monitor's shared names tell Service Bus from Event Hubs, scoped to the namespace", () => {
    const queues: Array<DiscoveredMessageQueue> =
      resolveMessagingMetricDiscoveryRows([
        metricRow("azure_incomingmessages_total", {
          type: "Microsoft.ServiceBus/Namespaces",
          name: "orders-prod",
          metadata_entityname: "orders",
        }),
        metricRow("azure_incomingmessages_total", {
          type: "Microsoft.EventHub/namespaces",
          name: "ingest-prod",
          metadata_EntityName: "telemetry",
        }),
        metricRow("azure_incomingmessages_total", {
          type: "Microsoft.Storage/storageAccounts",
          name: "acct",
          metadata_entityname: "orders",
        }),
      ]);
    expect(identifiers(queues).sort()).toEqual([
      "eventhubs|ingest-prod|telemetry",
      "servicebus|orders-prod|orders",
    ]);
  });

  test("both CloudWatch shapes of an SQS metric name one queue", () => {
    const queues: Array<DiscoveredMessageQueue> =
      resolveMessagingMetricDiscoveryRows([
        metricRow(
          "amazonaws.com/aws/sqs/approximatenumberofmessagesvisible",
          { "Dimensions.QueueName": "orders" },
          { pointCount: "3" },
        ),
        metricRow(
          "approximatenumberofmessagesvisible",
          { QueueName: "orders", "resource.service.name": "SQS" },
          { pointCount: "2" },
        ),
        // The JSON shape of another service's metric is not SQS's.
        metricRow("approximatenumberofmessagesvisible", {
          QueueName: "orders",
          "resource.service.name": "Kinesis",
        }),
      ]);
    expect(identifiers(queues)).toEqual(["aws_sqs||orders"]);
    expect(queues[0]!.brokerMetrics?.count).toBe(5);
  });

  test("a Pulsar per-consumer repeat folds into its topic's group: the key that marks it is not selected", () => {
    const repeat: FixtureAttributes = {
      topic: "persistent://public/default/orders-partition-0",
      subscription: "billing",
      consumer_name: "billing-1",
      consumer_id: "0",
    };

    // Ingest drops the repeat itself…
    expect(
      resolveMessagingMetricDatapoint({
        metricName: "pulsar_out_messages_total",
        getAttribute: getterOf(repeat),
      }),
    ).toBeNull();

    // …while its grouped row, which cannot carry the marker, names the topic.
    const [queue]: Array<DiscoveredMessageQueue> =
      resolveMessagingMetricDiscoveryRows([
        metricRow("pulsar_out_messages_total", repeat),
      ]);
    expect(queue!.identifier).toBe(
      "pulsar||persistent://public/default/orders",
    );
  });

  test("anything but a curated broker metric is client evidence, which never creates a queue", () => {
    const [queue]: Array<DiscoveredMessageQueue> =
      resolveMessagingMetricDiscoveryRows([
        metricRow("queue.size", {
          "messaging.system": "bullmq",
          "messaging.destination.name": "orders",
          state: "waiting",
        }),
      ]);
    expect(queue!.clientMetrics?.count).toBe(12);
    expect(queue!.brokerMetrics).toBeNull();
    expect(
      isMessageQueueAutoCreateCandidate({
        discovered: queue!,
        minSpans: DEFAULT_MESSAGE_QUEUE_MIN_SPANS,
      }),
    ).toBe(false);
  });

  test("placeholders and other resources' metrics resolve to nothing", () => {
    expect(
      resolveMessagingMetricDiscoveryRows([
        metricRow("azure_activemessages_average", {
          type: "Microsoft.ServiceBus/Namespaces",
          name: "orders-prod",
          metadata_entityname: "-NamespaceOnlyMetric-",
        }),
        metricRow("pulsar_msg_backlog", {
          topic: "persistent://public/default/__change_events",
        }),
        metricRow("system.cpu.utilization", { state: "user" }),
      ]),
    ).toEqual([]);
  });

  test("tolerates junk input", () => {
    expect(
      resolveMessagingMetricDiscoveryRows(
        undefined as unknown as Array<MessagingMetricDiscoveryRow>,
      ),
    ).toEqual([]);
    expect(
      resolveMessagingMetricDiscoveryRows([
        null as unknown as MessagingMetricDiscoveryRow,
        { name: 42 as unknown as string, a0: "kafka" },
      ]),
    ).toEqual([]);
  });
});

describe("mergeDiscoveredMessageQueues", () => {
  test("JMS spans and ActiveMQ broker metrics are one queue, recorded as ActiveMQ, in either order", () => {
    const spans: Array<DiscoveredMessageQueue> =
      resolveMessagingSpanDiscoveryRows([
        spanRow(
          SpanKind.Producer,
          {
            "messaging.system": "jms",
            "messaging.destination.name": "orders",
          },
          { spanCount: "50" },
        ),
      ]);
    const metrics: Array<DiscoveredMessageQueue> =
      resolveMessagingMetricDiscoveryRows([
        metricRow(
          "activemq.message.current",
          { destination: "orders" },
          { pointCount: "2" },
        ),
      ]);

    for (const merged of [
      mergeDiscoveredMessageQueues(spans, metrics),
      mergeDiscoveredMessageQueues(metrics, spans),
    ]) {
      expect(merged).toHaveLength(1);
      expect(merged[0]!.identifier).toBe("jms||orders");
      expect(merged[0]!.system).toBe("activemq");
      expect(merged[0]!.spans?.count).toBe(50);
      expect(merged[0]!.brokerMetrics?.count).toBe(2);
      expect(merged[0]!.clientMetrics).toBeNull();
    }
  });

  test("Service Bus spans join Azure Monitor's metrics through the namespace; spans without one stay apart", () => {
    const spans: Array<DiscoveredMessageQueue> =
      resolveMessagingSpanDiscoveryRows([
        spanRow(SpanKind.Producer, {
          "messaging.system": "servicebus",
          "messaging.destination.name": "orders",
          "server.address": SERVICE_BUS_HOST,
        }),
        spanRow(SpanKind.Producer, {
          "messaging.system": "servicebus",
          "messaging.destination.name": "orders",
          "server.address": "localhost",
        }),
      ]);
    const metrics: Array<DiscoveredMessageQueue> =
      resolveMessagingMetricDiscoveryRows([
        metricRow("azure_activemessages_average", {
          type: "Microsoft.ServiceBus/Namespaces",
          name: "orders-prod",
          metadata_entityname: "orders",
        }),
      ]);

    const merged: Array<DiscoveredMessageQueue> = mergeDiscoveredMessageQueues(
      spans,
      metrics,
    );
    expect(identifiers(merged).sort()).toEqual(
      ["servicebus||orders", "servicebus|orders-prod|orders"].sort(),
    );
    const scoped: DiscoveredMessageQueue = merged.find(
      (queue: DiscoveredMessageQueue): boolean => {
        return queue.identity.brokerScope === "orders-prod";
      },
    )!;
    expect(scoped.spans?.count).toBe(5);
    expect(scoped.brokerMetrics?.count).toBe(12);
  });

  test("keeps each kind of evidence apart, with the newest time and the busiest address of each", () => {
    const first: DiscoveredMessageQueue = discovered({
      destination: "orders",
      spans: evidence({
        count: 10,
        brokerAddress: "kafka-1:9092",
        lastSeenAt: new Date(1000),
      }),
    });
    const second: DiscoveredMessageQueue = discovered({
      destination: "Orders",
      spans: evidence({
        count: 30,
        errorCount: 2,
        brokerAddress: "kafka-2:9092",
        lastSeenAt: new Date(500),
      }),
      brokerMetrics: evidence({
        count: 4,
        brokerAddress: "exporter:9308",
        lastSeenAt: new Date(2000),
      }),
    });

    const [merged]: Array<DiscoveredMessageQueue> =
      mergeDiscoveredMessageQueues([first], [second]);

    expect(merged!.destination).toBe("Orders");
    expect(merged!.spans).toEqual({
      count: 40,
      errorCount: 2,
      directions: { publish: 0, consume: 0, settle: 0, unknown: 2 },
      brokerAddress: "kafka-2:9092",
      lastSeenAt: new Date(1000),
    });
    expect(merged!.brokerMetrics?.brokerAddress).toBe("exporter:9308");
    expect(merged!.brokerMetrics?.lastSeenAt).toEqual(new Date(2000));
    expect(merged!.clientMetrics).toBeNull();
    expect(getDiscoveredMessageQueueEvidenceCount(merged!)).toBe(44);
  });

  test("tolerates junk input", () => {
    expect(mergeDiscoveredMessageQueues()).toEqual([]);
    expect(
      mergeDiscoveredMessageQueues(
        null as unknown as Array<DiscoveredMessageQueue>,
        [null as unknown as DiscoveredMessageQueue],
        [{} as DiscoveredMessageQueue],
      ),
    ).toEqual([]);
  });
});

describe("isMessageQueueAutoCreateCandidate", () => {
  test("spans at or above the minimum create; fewer do not", () => {
    for (const [count, candidate] of [
      [2, false],
      [3, true],
      [300, true],
    ] as Array<[number, boolean]>) {
      expect(
        isMessageQueueAutoCreateCandidate({
          discovered: discovered({ spans: evidence({ count }) }),
          minSpans: 3,
        }),
      ).toBe(candidate);
    }
  });

  test("one broker metric sighting creates, whatever the spans say", () => {
    expect(
      isMessageQueueAutoCreateCandidate({
        discovered: discovered({
          spans: evidence({ count: 1 }),
          brokerMetrics: evidence({ count: 1 }),
        }),
        minSpans: 3,
      }),
    ).toBe(true);
    expect(
      isMessageQueueAutoCreateCandidate({
        discovered: discovered({ brokerMetrics: evidence({ count: 0 }) }),
        minSpans: 3,
      }),
    ).toBe(true);
  });

  test("messaging client metrics alone never create", () => {
    expect(
      isMessageQueueAutoCreateCandidate({
        discovered: discovered({ clientMetrics: evidence({ count: 5000 }) }),
        minSpans: 1,
      }),
    ).toBe(false);
  });

  test("a minimum below one is one: no spans never create", () => {
    for (const minSpans of [0, -3, Number.NaN]) {
      expect(
        isMessageQueueAutoCreateCandidate({
          discovered: discovered({}),
          minSpans,
        }),
      ).toBe(false);
      expect(
        isMessageQueueAutoCreateCandidate({
          discovered: discovered({ spans: evidence({ count: 0 }) }),
          minSpans,
        }),
      ).toBe(false);
    }
  });
});

describe("getMessageQueueCreationSource", () => {
  test("traces when the spans meet the minimum, else broker metrics when the broker reported it", () => {
    expect(
      getMessageQueueCreationSource({
        discovered: discovered({
          spans: evidence({ count: 3 }),
          brokerMetrics: evidence({}),
        }),
        minSpans: 3,
      }),
    ).toBe("traces");
    expect(
      getMessageQueueCreationSource({
        discovered: discovered({
          spans: evidence({ count: 2 }),
          brokerMetrics: evidence({}),
        }),
        minSpans: 3,
      }),
    ).toBe("broker-metrics");
    expect(
      getMessageQueueCreationSource({
        discovered: discovered({ brokerMetrics: evidence({}) }),
        minSpans: 3,
      }),
    ).toBe("broker-metrics");
    expect(
      getMessageQueueCreationSource({
        discovered: discovered({ clientMetrics: evidence({}) }),
        minSpans: 3,
      }),
    ).toBe("traces");
  });
});

describe("getDiscoveredMessageQueueBrokerAddress", () => {
  test("the application's address — its spans', else its client metrics' — before a broker scrape's target", () => {
    expect(
      getDiscoveredMessageQueueBrokerAddress(
        discovered({
          spans: evidence({ brokerAddress: "pulsar-broker:6650" }),
          brokerMetrics: evidence({ brokerAddress: "pulsar-broker:8080" }),
          clientMetrics: evidence({ brokerAddress: "pulsar-proxy:6650" }),
        }),
      ),
    ).toBe("pulsar-broker:6650");
    // Client metrics name the broker the client connected to, as spans do.
    expect(
      getDiscoveredMessageQueueBrokerAddress(
        discovered({
          spans: evidence({}),
          brokerMetrics: evidence({ brokerAddress: "pulsar-broker:8080" }),
          clientMetrics: evidence({ brokerAddress: "pulsar-proxy:6650" }),
        }),
      ),
    ).toBe("pulsar-proxy:6650");
    expect(
      getDiscoveredMessageQueueBrokerAddress(
        discovered({
          clientMetrics: evidence({ brokerAddress: "pulsar-proxy:6650" }),
        }),
      ),
    ).toBe("pulsar-proxy:6650");
  });

  test("a broker scrape's target only when the application named no address", () => {
    expect(
      getDiscoveredMessageQueueBrokerAddress(
        discovered({
          spans: evidence({}),
          clientMetrics: evidence({}),
          brokerMetrics: evidence({ brokerAddress: "nats-exporter:7777" }),
        }),
      ),
    ).toBe("nats-exporter:7777");
    expect(
      getDiscoveredMessageQueueBrokerAddress(
        discovered({
          brokerMetrics: evidence({ brokerAddress: "nats-exporter:7777" }),
        }),
      ),
    ).toBe("nats-exporter:7777");
    expect(
      getDiscoveredMessageQueueBrokerAddress(
        discovered({ spans: evidence({}), brokerMetrics: evidence({}) }),
      ),
    ).toBeNull();
    expect(getDiscoveredMessageQueueBrokerAddress(discovered({}))).toBeNull();
  });

  test("the broker metrics' address is the scrape target the resolver reads from the resource", () => {
    const [pulsar]: Array<DiscoveredMessageQueue> =
      resolveMessagingMetricDiscoveryRows([
        metricRow("pulsar_msg_backlog", {
          topic: "persistent://public/default/orders",
          "resource.server.address": "pulsar-broker",
          "resource.server.port": "8080",
        }),
      ]);
    const [client]: Array<DiscoveredMessageQueue> =
      resolveMessagingMetricDiscoveryRows([
        metricRow("messaging.client.sent.messages", {
          "messaging.system": "pulsar",
          "messaging.destination.name": "orders",
          "server.address": "pulsar-broker",
          "server.port": 6650,
        }),
      ]);

    expect(pulsar!.brokerMetrics?.brokerAddress).toBe("pulsar-broker:8080");
    expect(client!.clientMetrics?.brokerAddress).toBe("pulsar-broker:6650");
    expect(client!.identifier).toBe(pulsar!.identifier);
    expect(
      getDiscoveredMessageQueueBrokerAddress(
        mergeDiscoveredMessageQueues([pulsar!], [client!])[0]!,
      ),
    ).toBe("pulsar-broker:6650");
  });
});

describe("getMessageQueueMinSpans", () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[MESSAGE_QUEUE_MIN_SPANS_ENV];
    delete process.env[MESSAGE_QUEUE_MIN_SPANS_ENV];
  });

  afterEach(() => {
    if (saved === undefined) {
      delete process.env[MESSAGE_QUEUE_MIN_SPANS_ENV];
    } else {
      process.env[MESSAGE_QUEUE_MIN_SPANS_ENV] = saved;
    }
  });

  test("defaults to 3, read from MESSAGE_QUEUE_MIN_SPANS", () => {
    expect(MESSAGE_QUEUE_MIN_SPANS_ENV).toBe("MESSAGE_QUEUE_MIN_SPANS");
    expect(DEFAULT_MESSAGE_QUEUE_MIN_SPANS).toBe(3);
    expect(getMessageQueueMinSpans()).toBe(3);
  });

  test("reads the environment on every call", () => {
    process.env[MESSAGE_QUEUE_MIN_SPANS_ENV] = "25";
    expect(getMessageQueueMinSpans()).toBe(25);
    process.env[MESSAGE_QUEUE_MIN_SPANS_ENV] = " 7 ";
    expect(getMessageQueueMinSpans()).toBe(7);
  });

  test("is at least 1", () => {
    process.env[MESSAGE_QUEUE_MIN_SPANS_ENV] = "0";
    expect(getMessageQueueMinSpans()).toBe(1);
    process.env[MESSAGE_QUEUE_MIN_SPANS_ENV] = "-4";
    expect(getMessageQueueMinSpans()).toBe(1);
  });

  test("falls back to the default for anything unparseable", () => {
    for (const value of ["", "  ", "many", "2.5", "NaN", "Infinity"]) {
      process.env[MESSAGE_QUEUE_MIN_SPANS_ENV] = value;
      expect(getMessageQueueMinSpans()).toBe(DEFAULT_MESSAGE_QUEUE_MIN_SPANS);
    }
  });
});
