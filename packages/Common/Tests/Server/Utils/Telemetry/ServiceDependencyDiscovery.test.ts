import { describe, expect, test } from "@jest/globals";
import {
  CALLER_CLUSTER_ATTRIBUTE,
  CALLER_NAMESPACE_ATTRIBUTE,
  ClientSpanDependencyRow,
  DATABASE_ENDPOINT_DESCRIPTIVE_ATTRIBUTE,
  DATABASE_PORT_DESCRIPTIVE_ATTRIBUTE,
  DatabaseCallerContextSql,
  DependencyDatabaseEndpoint,
  DependencyDatabaseServer,
  DependencyDatabaseTarget,
  DependencyEdgeCollector,
  DependencyQueryWindow,
  DependencyTarget,
  EPHEMERAL_DEFAULT_DATABASE_PORTS,
  MAX_DATABASE_TARGETS_PER_ROW,
  NON_BLANK_TEXT_PATTERN,
  ORDINAL_SUFFIX_PATTERN,
  PARENT_LOOKBACK_MINUTES,
  PLAIN_HOST_ADDRESS_PATTERN,
  PORT_ATTRIBUTE_PATTERN,
  PRIVATE_IP_ADDRESS_PATTERN,
  SERVICE_GRAPH_REQUEST_FAILED_METRIC,
  SERVICE_GRAPH_REQUEST_TOTAL_METRIC,
  buildClientSpanDependencySql,
  buildServiceGraphMetricSql,
  buildTraceLinkedDependencySql,
  clientSocketPortSql,
  databaseCallerContextSql,
  databaseInstanceSql,
  describeDependencyDatabaseServer,
  escapeSql,
  firstNonEmptyAttributeSql,
  isClientSocketDependencyRow,
  isClientSocketDependencyTarget,
  isUuid,
  mergeDependencyEntityDescriptions,
  mergeDependencySources,
  readDependencyDatabaseTargets,
  resolveClientSpanTarget,
  resolveDependencyDatabaseEndpoint,
  resolveServiceGraphPeer,
  serviceNameCandidatesForHost,
  toEdgeMetrics,
  toExtractedDependencyEntity,
} from "../../../../Server/Utils/Telemetry/ServiceDependencyDiscovery";
import {
  CALLER_CLUSTER_ATTRIBUTE as DISCOVERY_CALLER_CLUSTER,
  CALLER_NAMESPACE_ATTRIBUTE as DISCOVERY_CALLER_NAMESPACE,
  NON_BLANK_TEXT_PATTERN as DISCOVERY_NON_BLANK_TEXT_PATTERN,
  ORDINAL_SUFFIX_PATTERN as DISCOVERY_ORDINAL_SUFFIX_PATTERN,
  PLAIN_HOST_ADDRESS_PATTERN as DISCOVERY_PLAIN_HOST_ADDRESS_PATTERN,
  PRIVATE_IP_ADDRESS_PATTERN as DISCOVERY_PRIVATE_IP_ADDRESS_PATTERN,
  buildDatabaseEndpointSql,
  databaseCallerContextSql as discoveryDatabaseCallerContextSql,
  databaseInstanceSql as discoveryDatabaseInstanceSql,
  firstNonEmptyAttributeSql as discoveryFirstNonEmptyAttributeSql,
  getDatabaseEndpointCallerContextNeeds,
} from "../../../../Server/Utils/Telemetry/DatabaseEndpointDiscovery";
import {
  DatabaseEndpoint,
  EPHEMERAL_PORT_RANGE_START,
  buildDatabaseCallerContext,
  formatDatabaseEndpoint,
  isClientSocketDatabaseEndpoint,
} from "../../../../Types/DatabaseServer/DatabaseEndpoint";
import {
  DATABASE_SYSTEMS,
  DatabaseSystemDescriptor,
} from "../../../../Types/DatabaseServer/DatabaseSystem";
import {
  DATABASE_ADDRESS_ATTRIBUTES,
  DATABASE_PORT_ATTRIBUTES,
  resolveDatabaseCallTarget,
} from "../../../../Types/DatabaseServer/DatabaseTelemetryResolver";
import EntityRelationshipType from "../../../../Types/Telemetry/EntityRelationshipType";
import EntityType from "../../../../Types/Telemetry/EntityType";
import { EntityRelationshipEdge } from "../../../../Utils/Telemetry/EntityRelationship";
import { computeEntityKey } from "../../../../Utils/Telemetry/EntityKey";
import { ExtractedEntity } from "../../../../Server/Utils/Telemetry/TelemetryEntity";

/*
 * The dependency job turns the recent telemetry window into Service Map
 * edges. These tests pin the three things that decide whether a map is right:
 * which spans the SQL may pair, what an unanswered client span is resolved
 * to, and how overlapping sources combine without double counting.
 */

const PROJECT_ID: string = "8a4c5b1e-2b3f-4c1d-9e8f-1a2b3c4d5e6f";

const WINDOW: DependencyQueryWindow = {
  projectId: PROJECT_ID,
  startSql: "toDateTime64('2026-09-07 09:45:00.000000000', 9)",
  endSql: "toDateTime64('2026-09-07 10:00:00.000000000', 9)",
  maxEntrySpans: 1234,
  maxRows: 77,
};

const KNOWN: ReadonlySet<string> = new Set<string>([
  "api",
  "payments",
  "checkout",
]);

function collapse(sql: string): string {
  return sql.replace(/\s+/g, " ");
}

function row(
  overrides: Partial<ClientSpanDependencyRow>,
): ClientSpanDependencyRow {
  return {
    callerServiceId: "11111111-1111-4111-8111-111111111111",
    callCount: "10",
    errorCount: "1",
    avgDurationNano: "5000000",
    ...overrides,
  };
}

describe("trace-linked dependency SQL", () => {
  const sql: string = collapse(buildTraceLinkedDependencySql(WINDOW));

  test("pairs only SERVER / CONSUMER entry spans with their parents", () => {
    expect(sql).toContain("kind IN ('SPAN_KIND_SERVER', 'SPAN_KIND_CONSUMER')");
    expect(sql).toContain(
      "ON caller.traceId = callee.traceId AND caller.spanId = callee.parentSpanId",
    );
    expect(sql).toContain(
      "WHERE caller.primaryEntityId != callee.primaryEntityId",
    );
  });

  test("reduces the parent side to the spans the entries point at", () => {
    expect(sql).toContain(
      "AND (traceId, spanId) IN ( SELECT traceId, parentSpanId FROM (",
    );
  });

  test("looks back on the parent side so boundary edges survive", () => {
    expect(sql).toContain(
      `startTime >= ${WINDOW.startSql} - INTERVAL ${PARENT_LOOKBACK_MINUTES} MINUTE`,
    );
  });

  test("is project scoped, service scoped and bounded", () => {
    expect(sql).toContain(`projectId = '${PROJECT_ID}'`);
    expect(sql).toContain("primaryEntityType = 'OpenTelemetry'");
    expect(sql).toContain("LIMIT 1234");
    expect(sql).toContain("LIMIT 77");
    expect(sql).toContain("max_execution_time = 60");
  });

  test("measures the call on the callee side", () => {
    expect(sql).toContain("countIf(callee.statusCode = 2) AS errorCount");
    expect(sql).toContain("avg(callee.durationUnixNano) AS avgDurationNano");
  });

  test("escapes a hostile project id instead of breaking out of the literal", () => {
    const hostile: string = collapse(
      buildTraceLinkedDependencySql({ ...WINDOW, projectId: "x' OR 1=1 --" }),
    );
    expect(hostile).toContain("projectId = 'x\\' OR 1=1 --'");
  });
});

describe("client span dependency SQL", () => {
  const sql: string = collapse(buildClientSpanDependencySql(WINDOW));

  test("reads outbound CLIENT / PRODUCER spans", () => {
    expect(sql).toContain("kind IN ('SPAN_KIND_CLIENT', 'SPAN_KIND_PRODUCER')");
  });

  test("excludes spans that have any client or server child", () => {
    expect(sql).toContain("AND (traceId, spanId) NOT IN (");
    expect(sql).toContain(
      "kind IN ('SPAN_KIND_SERVER', 'SPAN_KIND_CONSUMER', 'SPAN_KIND_CLIENT', 'SPAN_KIND_PRODUCER')",
    );
  });

  test("accepts both current and legacy semconv attribute names", () => {
    expect(sql).toContain("attributes['db.system.name']");
    expect(sql).toContain("attributes['db.system']");
    expect(sql).toContain("attributes['db.namespace']");
    expect(sql).toContain("attributes['db.name']");
    expect(sql).toContain("attributes['server.address']");
    expect(sql).toContain("attributes['net.peer.name']");
    expect(sql).toContain("attributes['http.request.method']");
    expect(sql).toContain("attributes['http.method']");
  });

  test("groups URLs by host, never by the full URL", () => {
    expect(sql).toContain("domain(attributes['url.full'])");
    expect(sql).toContain("domain(attributes['http.url'])");
    expect(sql).not.toMatch(/GROUP BY[^)]*url\.full/);
  });

  test("returns the busiest dependencies first within the row cap", () => {
    expect(sql).toContain("ORDER BY callCount DESC LIMIT 77");
  });
});

describe("service graph metric SQL", () => {
  const sql: string = collapse(
    buildServiceGraphMetricSql({
      projectId: PROJECT_ID,
      startSql: WINDOW.startSql,
      endSql: WINDOW.endSql,
      maxRows: 50,
    }),
  );

  test("reads only the eBPF service graph counters", () => {
    expect(sql).toContain(
      `name IN ('${SERVICE_GRAPH_REQUEST_TOTAL_METRIC}', '${SERVICE_GRAPH_REQUEST_FAILED_METRIC}')`,
    );
    expect(sql).toContain("attributes['client'] != ''");
    expect(sql).toContain("attributes['server'] != ''");
  });

  test("uses the increase of cumulative series and the sum of delta series", () => {
    expect(sql).toContain("anyLast(aggregationTemporality) = 'Delta'");
    expect(sql).toContain("greatest(max(value) - min(value), 0)");
    expect(sql).toContain(
      "GROUP BY metricName, client, server, clientNamespace, serverNamespace, seriesId",
    );
  });

  test("splits requests and failures", () => {
    expect(sql).toContain(
      `sumIf(increase, metricName = '${SERVICE_GRAPH_REQUEST_TOTAL_METRIC}') AS requestCount`,
    );
    expect(sql).toContain(
      `sumIf(increase, metricName = '${SERVICE_GRAPH_REQUEST_FAILED_METRIC}') AS failedCount`,
    );
    expect(sql).toContain("LIMIT 50");
  });
});

describe("resolveClientSpanTarget", () => {
  test("a database span becomes a Database keyed by engine, host and namespace", () => {
    const target: DependencyTarget | null = resolveClientSpanTarget(
      row({
        dbSystem: "PostgreSQL",
        dbNamespace: "Orders",
        serverAddress: "db.internal:5432",
      }),
      KNOWN,
    );
    expect(target).toEqual({
      kind: "dependency",
      entity: {
        entityType: EntityType.Database,
        identifyingAttributes: {
          "db.system.name": "postgresql",
          "server.address": "db.internal",
          "db.namespace": "orders",
        },
        descriptiveAttributes: { "db.system.name": "postgresql" },
      },
    });
  });

  test("a database on loopback drops the host from its identity", () => {
    const target: DependencyTarget | null = resolveClientSpanTarget(
      row({ dbSystem: "redis", serverAddress: "127.0.0.1:6379" }),
      KNOWN,
    );
    expect(target).toEqual({
      kind: "dependency",
      entity: {
        entityType: EntityType.Database,
        identifyingAttributes: { "db.system.name": "redis" },
        descriptiveAttributes: { "db.system.name": "redis" },
      },
    });
  });

  test("peer.service naming a known service links to that service", () => {
    expect(
      resolveClientSpanTarget(row({ peerService: " Payments " }), KNOWN),
    ).toEqual({ kind: "service", serviceName: "payments" });
  });

  test("an unknown peer.service becomes a remote service with its protocol", () => {
    expect(
      resolveClientSpanTarget(
        row({
          peerService: "stripe",
          serverAddress: "api.stripe.com",
          isHttp: "1",
        }),
        KNOWN,
      ),
    ).toEqual({
      kind: "dependency",
      entity: {
        entityType: EntityType.RemoteService,
        identifyingAttributes: { "peer.service": "stripe" },
        descriptiveAttributes: { "network.protocol.name": "http" },
      },
    });
  });

  test("a messaging span names the broker, not the destination", () => {
    expect(
      resolveClientSpanTarget(
        row({ messagingSystem: "Kafka", serverAddress: "kafka-0.kafka:9092" }),
        KNOWN,
      ),
    ).toEqual({
      kind: "dependency",
      entity: {
        entityType: EntityType.RemoteService,
        identifyingAttributes: {
          "messaging.system": "kafka",
          "server.address": "kafka-0.kafka",
        },
        descriptiveAttributes: { "network.protocol.name": "kafka" },
      },
    });
  });

  test("a cluster-internal host links to the service it names", () => {
    expect(
      resolveClientSpanTarget(
        row({ serverAddress: "checkout.shop.svc.cluster.local:8080" }),
        KNOWN,
      ),
    ).toEqual({ kind: "service", serviceName: "checkout" });
    expect(
      resolveClientSpanTarget(row({ serverAddress: "api:3002" }), KNOWN),
    ).toEqual({ kind: "service", serviceName: "api" });
  });

  test("a public host never links to a service by its first label", () => {
    expect(
      resolveClientSpanTarget(
        row({ serverAddress: "api.stripe.com", isHttp: 1 }),
        KNOWN,
      ),
    ).toEqual({
      kind: "dependency",
      entity: {
        entityType: EntityType.RemoteService,
        identifyingAttributes: { "server.address": "api.stripe.com" },
        descriptiveAttributes: { "network.protocol.name": "http" },
      },
    });
  });

  test("an rpc call without an address resolves by rpc.service", () => {
    expect(
      resolveClientSpanTarget(
        row({ rpcSystem: "grpc", rpcService: "acme.ledger.v1.Ledger" }),
        KNOWN,
      ),
    ).toEqual({
      kind: "dependency",
      entity: {
        entityType: EntityType.RemoteService,
        identifyingAttributes: { "rpc.service": "acme.ledger.v1.ledger" },
        descriptiveAttributes: { "network.protocol.name": "grpc" },
      },
    });
    expect(
      resolveClientSpanTarget(
        row({ rpcSystem: "grpc", rpcService: "acme.Checkout" }),
        KNOWN,
      ),
    ).toEqual({ kind: "service", serviceName: "checkout" });
  });

  test("loopback-only and attribute-less spans resolve to nothing", () => {
    expect(
      resolveClientSpanTarget(row({ serverAddress: "localhost:4318" }), KNOWN),
    ).toBeNull();
    expect(resolveClientSpanTarget(row({}), KNOWN)).toBeNull();
  });
});

describe("serviceNameCandidatesForHost", () => {
  test("offers the first label only for cluster-internal names", () => {
    expect(serviceNameCandidatesForHost("payments")).toEqual(["payments"]);
    expect(
      serviceNameCandidatesForHost("payments.prod.svc.cluster.local"),
    ).toEqual(["payments.prod.svc.cluster.local", "payments"]);
    expect(serviceNameCandidatesForHost("payments.prod.svc")).toEqual([
      "payments.prod.svc",
      "payments",
    ]);
    expect(serviceNameCandidatesForHost("payments.example.com")).toEqual([
      "payments.example.com",
    ]);
  });
});

describe("resolveServiceGraphPeer", () => {
  test("a known name is a service", () => {
    expect(resolveServiceGraphPeer("API", KNOWN)).toEqual({
      kind: "service",
      serviceName: "api",
    });
  });

  test("an unknown name is a remote service named by the peer", () => {
    expect(resolveServiceGraphPeer("legacy-billing", KNOWN)).toEqual({
      kind: "dependency",
      entity: {
        entityType: EntityType.RemoteService,
        identifyingAttributes: { "peer.service": "legacy-billing" },
        descriptiveAttributes: {},
      },
    });
  });

  test("an unattributed IP is a remote service keyed by address", () => {
    expect(resolveServiceGraphPeer("10.4.2.17", KNOWN)).toEqual({
      kind: "dependency",
      entity: {
        entityType: EntityType.RemoteService,
        identifyingAttributes: { "server.address": "10.4.2.17" },
        descriptiveAttributes: {},
      },
    });
  });

  test("blank and loopback peers are ignored", () => {
    expect(resolveServiceGraphPeer("  ", KNOWN)).toBeNull();
    expect(resolveServiceGraphPeer("127.0.0.1", KNOWN)).toBeNull();
  });
});

describe("toEdgeMetrics", () => {
  test("coerces ClickHouse string aggregates and converts nanoseconds", () => {
    expect(
      toEdgeMetrics({
        callCount: "1200",
        errorCount: "12",
        avgDurationNano: "45600000.7",
      }),
    ).toEqual({ callCount: 1200, errorCount: 12, avgDurationMs: 46 });
  });

  test("never reports more errors than calls or negative numbers", () => {
    expect(
      toEdgeMetrics({ callCount: 3, errorCount: 9, avgDurationNano: -5 }),
    ).toEqual({ callCount: 3, errorCount: 3, avgDurationMs: 0 });
    expect(toEdgeMetrics({ callCount: "nan", errorCount: undefined })).toEqual({
      callCount: 0,
      errorCount: 0,
      avgDurationMs: 0,
    });
  });
});

describe("DependencyEdgeCollector", () => {
  test("merges rows for one edge with call-weighted latency", () => {
    const collector: DependencyEdgeCollector = new DependencyEdgeCollector();
    collector.add({
      fromEntityKey: "a",
      toEntityKey: "b",
      metrics: { callCount: 100, errorCount: 1, avgDurationMs: 10 },
    });
    collector.add({
      fromEntityKey: "a",
      toEntityKey: "b",
      metrics: { callCount: 300, errorCount: 3, avgDurationMs: 30 },
    });
    expect(collector.edges()).toEqual([
      {
        fromEntityKey: "a",
        toEntityKey: "b",
        relationshipType: EntityRelationshipType.DependsOn,
        metrics: { callCount: 400, errorCount: 4, avgDurationMs: 25 },
      },
    ]);
  });

  test("drops self edges and empty keys", () => {
    const collector: DependencyEdgeCollector = new DependencyEdgeCollector();
    const metrics: {
      callCount: number;
      errorCount: number;
      avgDurationMs: number;
    } = { callCount: 1, errorCount: 0, avgDurationMs: 1 };
    collector.add({ fromEntityKey: "a", toEntityKey: "a", metrics });
    collector.add({ fromEntityKey: "", toEntityKey: "b", metrics });
    expect(collector.edges()).toEqual([]);
  });
});

describe("mergeDependencySources", () => {
  const edge: (
    from: string,
    to: string,
    calls: number,
  ) => EntityRelationshipEdge = (
    from: string,
    to: string,
    calls: number,
  ): EntityRelationshipEdge => {
    return {
      fromEntityKey: from,
      toEntityKey: to,
      relationshipType: EntityRelationshipType.DependsOn,
      metrics: { callCount: calls, errorCount: 0, avgDurationMs: 1 },
    };
  };

  test("the first source to see an edge wins; sources never add up", () => {
    const merged: Array<EntityRelationshipEdge> = mergeDependencySources([
      [edge("web", "api", 10)],
      [edge("web", "api", 999), edge("api", "db", 5)],
      [edge("api", "db", 7), edge("api", "cache", 2)],
    ]);
    expect(
      merged.map((item: EntityRelationshipEdge) => {
        return [item.fromEntityKey, item.toEntityKey, item.metrics?.callCount];
      }),
    ).toEqual([
      ["api", "cache", 2],
      ["api", "db", 5],
      ["web", "api", 10],
    ]);
  });
});

describe("toExtractedDependencyEntity", () => {
  test("keys the entity exactly like the registry would", () => {
    const entity: ExtractedEntity = toExtractedDependencyEntity({
      projectId: PROJECT_ID,
      entity: {
        entityType: EntityType.Database,
        identifyingAttributes: { "db.system.name": "redis" },
        descriptiveAttributes: {},
      },
    });
    expect(entity).toEqual({
      entityType: EntityType.Database,
      entityKey: computeEntityKey({
        projectId: PROJECT_ID,
        entityType: EntityType.Database,
        identifyingAttributes: { "db.system.name": "redis" },
      }),
      identifyingAttributes: { "db.system.name": "redis" },
    });
  });

  test("the same dependency in two projects never shares a key", () => {
    const build: (projectId: string) => string = (
      projectId: string,
    ): string => {
      return toExtractedDependencyEntity({
        projectId,
        entity: {
          entityType: EntityType.RemoteService,
          identifyingAttributes: { "server.address": "api.stripe.com" },
          descriptiveAttributes: { "network.protocol.name": "http" },
        },
      }).entityKey;
    };
    expect(build(PROJECT_ID)).not.toEqual(
      build("00000000-0000-4000-8000-000000000000"),
    );
  });
});

describe("helpers", () => {
  test("isUuid accepts ids and rejects everything else", () => {
    expect(isUuid(PROJECT_ID)).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });

  test("escapeSql escapes quotes and backslashes", () => {
    expect(escapeSql("a'b\\c")).toBe("a\\'b\\\\c");
  });
});

/*
 * The database SERVER a Database node's calls reached, for the Service
 * Map's "Open database" link. The node itself stays keyed by what its spans
 * said (engine, host, logical database); the server is described beside
 * it, resolved exactly as ingest keyed the spans.
 */

// A stored CLIENT span: its own attributes plus the `resource.`-prefixed ones.
type StoredAttributes = Record<string, string>;

/*
 * The client-span dependency query's per-span columns for ONE stored span,
 * computed the way its inner SELECT computes them (ClickHouse maps answer
 * '' for a missing key, and the caller's placement is kept only where
 * getDatabaseEndpointCallerContextNeeds — the TypeScript twin of
 * databaseCallerContextSql — says it can change the endpoint).
 */
type SpanColumns = Record<string, string>;

function spanColumns(attributes: StoredAttributes): SpanColumns {
  const read: (key: string) => string = (key: string): string => {
    return attributes[key] ?? "";
  };
  const firstNonEmpty: (keys: ReadonlyArray<string>) => string = (
    keys: ReadonlyArray<string>,
  ): string => {
    for (const key of keys) {
      if (read(key) !== "") {
        return read(key);
      }
    }
    return "";
  };

  const dbSystem: string =
    read("db.system.name") !== "" ? read("db.system.name") : read("db.system");
  const namespace: string = read("db.namespace");
  const instance: string =
    read("db.mssql.instance_name") !== ""
      ? read("db.mssql.instance_name")
      : namespace.includes("|")
        ? namespace.split("|")[0]!
        : "";
  const address: string = firstNonEmpty(DATABASE_ADDRESS_ATTRIBUTES);
  const needs: { namespace: boolean; kubernetes: boolean; cluster: boolean } =
    getDatabaseEndpointCallerContextNeeds(address);
  const callerNamespace: string = read(CALLER_NAMESPACE_ATTRIBUTE);
  const isDatabase: boolean = dbSystem !== "";

  return {
    dbSystem: dbSystem,
    dbNamespace: namespace !== "" ? namespace : read("db.name"),
    messagingSystem: read("messaging.system"),
    peerService: read("peer.service"),
    rpcSystem: read("rpc.system"),
    rpcService: read("rpc.service"),
    serverAddress: firstNonEmpty([
      "server.address",
      "net.peer.name",
      "http.host",
    ]),
    isHttp:
      read("http.request.method") !== "" || read("http.method") !== ""
        ? "1"
        : "0",
    dbServerAddress: isDatabase ? address : "",
    serverPort: isDatabase ? firstNonEmpty(DATABASE_PORT_ATTRIBUTES) : "",
    dbInstance: isDatabase ? instance : "",
    callerNamespace: isDatabase && needs.namespace ? callerNamespace : "",
    callerInKubernetes:
      isDatabase && needs.kubernetes && callerNamespace.trim() !== ""
        ? "1"
        : "0",
    callerCluster:
      isDatabase && needs.cluster ? read(CALLER_CLUSTER_ATTRIBUTE) : "",
  };
}

// The span's entry of its row's dbTargets, in the query's column order.
function targetColumns(columns: SpanColumns): Array<string> {
  return [
    columns["dbServerAddress"]!,
    columns["serverPort"]!,
    columns["dbInstance"]!,
    columns["callerNamespace"]!,
    columns["callerInKubernetes"]!,
    columns["callerCluster"]!,
  ];
}

/*
 * clientSocketPortSql over a span's `serverPort`, evaluated the way
 * ClickHouse evaluates it: trimBoth removes spaces only, and toUInt32OrZero
 * reads the digits that are left.
 */
const PORT_ATTRIBUTE_REGEX: RegExp = new RegExp(PORT_ATTRIBUTE_PATTERN);

function isClientSocketPortInSql(port: string): boolean {
  if (!PORT_ATTRIBUTE_REGEX.test(port)) {
    return false;
  }
  const value: number = Number(port.replace(/^ +| +$/g, ""));
  return (
    value >= EPHEMERAL_PORT_RANGE_START &&
    value <= 65535 &&
    !EPHEMERAL_DEFAULT_DATABASE_PORTS.includes(value)
  );
}

// The dependency row ONE stored span would group into on its own.
function dependencyRowForSpan(
  attributes: StoredAttributes,
): ClientSpanDependencyRow {
  const columns: SpanColumns = spanColumns(attributes);
  return row({
    dbSystem: columns["dbSystem"],
    dbNamespace: columns["dbNamespace"],
    messagingSystem: columns["messagingSystem"],
    peerService: columns["peerService"],
    rpcSystem: columns["rpcSystem"],
    rpcService: columns["rpcService"],
    serverAddress: columns["serverAddress"],
    isHttp: columns["isHttp"],
    dbTargets: columns["dbSystem"] !== "" ? [targetColumns(columns)] : [],
  });
}

// What ingest keys the same span with (DatabaseCallEntityKeys).
function ingestEndpoint(attributes: StoredAttributes): string | null {
  const resource: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (key.startsWith("resource.")) {
      resource[key.substring("resource.".length)] = value;
    }
  }
  const target: { endpoint: DatabaseEndpoint } | null =
    resolveDatabaseCallTarget({
      getAttribute: (key: string): unknown => {
        return attributes[key];
      },
      caller: buildDatabaseCallerContext(resource),
    });
  return target ? formatDatabaseEndpoint(target.endpoint) : null;
}

// A database server target, as a row's dbTargets carries it.
function target(
  overrides: Partial<{
    address: string;
    port: string;
    instance: string;
    namespace: string;
    inKubernetes: string;
    cluster: string;
  }>,
): Array<string> {
  return [
    overrides.address ?? "",
    overrides.port ?? "",
    overrides.instance ?? "",
    overrides.namespace ?? "",
    overrides.inKubernetes ?? "0",
    overrides.cluster ?? "",
  ];
}

const CALLERS: Record<string, StoredAttributes> = {
  vm: { "resource.host.name": "vm-7", "resource.os.type": "linux" },
  podProd: {
    "resource.k8s.pod.name": "api-7d9f-x",
    [CALLER_NAMESPACE_ATTRIBUTE]: "shop",
    [CALLER_CLUSTER_ATTRIBUTE]: "prod-eu",
  },
  podOtherNamespace: {
    "resource.k8s.pod.name": "billing-5c-y",
    [CALLER_NAMESPACE_ATTRIBUTE]: "billing",
    [CALLER_CLUSTER_ATTRIBUTE]: "prod-eu",
  },
  podOtherCluster: {
    "resource.k8s.pod.name": "api-7d9f-z",
    [CALLER_NAMESPACE_ATTRIBUTE]: "shop",
    [CALLER_CLUSTER_ATTRIBUTE]: "prod-us",
  },
  podNoCluster: {
    "resource.k8s.pod.name": "api-7d9f-x",
    [CALLER_NAMESPACE_ATTRIBUTE]: "shop",
  },
};

const DATABASE_SPANS: Array<StoredAttributes> = [
  { "db.system.name": "postgresql", "server.address": "orders.example.com" },
  {
    "db.system.name": "postgresql",
    "server.address": "orders.example.com",
    "server.port": "6432",
  },
  {
    "db.system": "postgres",
    "net.peer.name": "db.prod",
    "net.peer.port": "5433",
  },
  {
    "db.system.name": "postgresql",
    "server.address": "Orders.Example.COM.:5439",
  },
  { "db.system.name": "postgresql", "server.address": "postgres" },
  { "db.system.name": "postgresql", "server.address": "postgres.data" },
  { "db.system.name": "mongodb", "server.address": "mongo-0.mongo-headless" },
  {
    "db.system.name": "redis",
    "server.address": "redis-master.cache.svc.cluster.local",
  },
  { "db.system.name": "mysql", "server.address": "10.0.0.5" },
  { "db.system.name": "mysql", "server.address": "db.internal" },
  { "db.system.name": "mysql", "network.peer.address": "10.0.4.7" },
  { "db.system.name": "mysql", "server.address": "[fd00::5]:3307" },
  {
    "db.system.name": "microsoft.sql_server",
    "server.address": "sql1.corp.example.com",
    "db.mssql.instance_name": "INST01",
  },
  {
    "db.system.name": "microsoft.sql_server",
    "server.address": "sql1.corp.example.com",
    "db.namespace": "inst02|orders",
  },
  {
    "db.system.name": "microsoft.sql_server",
    "server.address": "sql1.corp.example.com",
    "server.port": "14330",
    "db.mssql.instance_name": "INST01",
  },
  {
    "db.system.name": "postgresql",
    "server.address": "postgresql://app@postgres/orders",
  },
  { "db.system.name": "postgresql", "server.address": "localhost" },
  { "db.system.name": "redis", "server.address": "host.docker.internal" },
  { "db.system.name": "postgresql", "server.address": "[REDACTED]" },
  { "db.system.name": "cockroachdb", "server.address": "crdb.example.com" },
];

describe("client span dependency SQL — the database server a node calls", () => {
  const sql: string = collapse(buildClientSpanDependencySql(WINDOW));
  const context: DatabaseCallerContextSql =
    databaseCallerContextSql("dbServerAddress");

  test("keeps what the ingest resolver reads, with its precedence, for database calls only", () => {
    const only: (expression: string, otherwise?: string) => string = (
      expression: string,
      otherwise: string = "''",
    ): string => {
      return collapse(`if(dbSystem != '', ${expression}, ${otherwise})`);
    };
    expect(sql).toContain(
      `${only(firstNonEmptyAttributeSql(DATABASE_ADDRESS_ATTRIBUTES))} AS dbServerAddress`,
    );
    expect(sql).toContain(
      `${only(firstNonEmptyAttributeSql(DATABASE_PORT_ATTRIBUTES))} AS serverPort`,
    );
    expect(sql).toContain(`${only(databaseInstanceSql())} AS dbInstance`);
    expect(sql).toContain(
      `${only(context.callerNamespace)} AS callerNamespace`,
    );
    expect(sql).toContain(
      `${only(context.callerInKubernetes, "0")} AS callerInKubernetes`,
    );
    expect(sql).toContain(`${only(context.callerCluster)} AS callerCluster`);
  });

  test("keeps the caller's placement with the very predicates database discovery groups by", () => {
    // The endpoint query's columns are the same builder over its own address.
    const discovery: string = collapse(
      buildDatabaseEndpointSql({ ...WINDOW, maxRows: 10 }),
    );
    const own: DatabaseCallerContextSql =
      databaseCallerContextSql("serverAddress");
    expect(discovery).toContain(
      `${collapse(own.callerNamespace)} AS callerNamespace`,
    );
    expect(discovery).toContain(
      `${collapse(own.callerInKubernetes)} AS callerInKubernetes`,
    );
    expect(discovery).toContain(
      `${collapse(own.callerCluster)} AS callerCluster`,
    );
    // …read here over the database call's own address.
    expect(collapse(context.callerCluster)).toContain(
      `match(lower(dbServerAddress), '${PLAIN_HOST_ADDRESS_PATTERN}')`,
    );
    expect(collapse(context.callerNamespace)).toContain(
      `attributes['${CALLER_NAMESPACE_ATTRIBUTE}'], '' )`,
    );
    expect(collapse(context.callerCluster)).toContain(
      `attributes['${CALLER_CLUSTER_ATTRIBUTE}'], '' )`,
    );
  });

  test("aggregates the servers a row's calls named instead of grouping on them", () => {
    expect(sql).toContain(
      `groupUniqArrayIf(${MAX_DATABASE_TARGETS_PER_ROW})([dbServerAddress, serverPort, dbInstance, callerNamespace, toString(callerInKubernetes), callerCluster], dbSystem != '') AS dbTargets`,
    );
    // One row per (caller, node): only the columns a node is keyed by.
    expect(sql).toContain(
      "GROUP BY callerServiceId, dbSystem, dbNamespace, messagingSystem, peerService, rpcSystem, rpcService, serverAddress, isHttp ORDER BY callCount DESC LIMIT 77",
    );
    expect(MAX_DATABASE_TARGETS_PER_ROW).toBeGreaterThan(1);
  });

  test("the columns a node is keyed by are read exactly as before", () => {
    expect(sql).toContain(
      "multiIf(attributes['db.system.name'] != '', attributes['db.system.name'], attributes['db.system']) AS dbSystem",
    );
    expect(sql).toContain(
      "multiIf(attributes['db.namespace'] != '', attributes['db.namespace'], attributes['db.name']) AS dbNamespace",
    );
    expect(sql).toContain(
      "multiIf( attributes['server.address'] != '', attributes['server.address'], attributes['net.peer.name'] != '', attributes['net.peer.name'], attributes['http.host'] != '', attributes['http.host'], attributes['url.full'] != '', domain(attributes['url.full']), attributes['http.url'] != '', domain(attributes['http.url']), '' ) AS serverAddress",
    );
  });

  test("never reads anything that varies per caller instance", () => {
    for (const perInstance of [
      "k8s.pod.name",
      "k8s.node.name",
      "host.name",
      "container.id",
      "service.instance.id",
    ]) {
      expect(sql).not.toContain(perInstance);
    }
  });

  test("the shared SQL helpers are the ones DatabaseEndpointDiscovery re-exports", () => {
    expect(firstNonEmptyAttributeSql).toBe(discoveryFirstNonEmptyAttributeSql);
    expect(databaseInstanceSql).toBe(discoveryDatabaseInstanceSql);
    expect(databaseCallerContextSql).toBe(discoveryDatabaseCallerContextSql);
    expect(CALLER_NAMESPACE_ATTRIBUTE).toBe(DISCOVERY_CALLER_NAMESPACE);
    expect(CALLER_CLUSTER_ATTRIBUTE).toBe(DISCOVERY_CALLER_CLUSTER);
    expect(PLAIN_HOST_ADDRESS_PATTERN).toBe(
      DISCOVERY_PLAIN_HOST_ADDRESS_PATTERN,
    );
    expect(PRIVATE_IP_ADDRESS_PATTERN).toBe(
      DISCOVERY_PRIVATE_IP_ADDRESS_PATTERN,
    );
    expect(ORDINAL_SUFFIX_PATTERN).toBe(DISCOVERY_ORDINAL_SUFFIX_PATTERN);
    expect(NON_BLANK_TEXT_PATTERN).toBe(DISCOVERY_NON_BLANK_TEXT_PATTERN);
  });

  test("keeps a caller's placement only where it can change the server", () => {
    const placements: Array<StoredAttributes> = [
      CALLERS["podProd"]!,
      CALLERS["podOtherNamespace"]!,
      CALLERS["podOtherCluster"]!,
      CALLERS["vm"]!,
    ];
    const distinctTargets: (address: string) => number = (
      address: string,
    ): number => {
      return new Set<string>(
        placements.map((caller: StoredAttributes): string => {
          return JSON.stringify(
            targetColumns(
              spanColumns({
                "db.system.name": "postgresql",
                "server.address": address,
                ...caller,
              }),
            ),
          );
        }),
      ).size;
    };

    // A global name is one server from anywhere: no placement is kept.
    expect(
      targetColumns(
        spanColumns({
          "db.system.name": "postgresql",
          "server.address": "orders.cluster-x.rds.amazonaws.com",
          ...CALLERS["podProd"],
        }),
      ),
    ).toEqual(target({ address: "orders.cluster-x.rds.amazonaws.com" }));
    expect(distinctTargets("orders.cluster-x.rds.amazonaws.com")).toBe(1);
    // A single-label name: namespace and cluster.
    expect(distinctTargets("postgres")).toBe(4);
    // A StatefulSet member: namespace and cluster.
    expect(distinctTargets("mongo-0.mongo-headless")).toBe(4);
    // A Service name or a private IP: the cluster (or none, from the VM).
    expect(distinctTargets("pg.data.svc.cluster.local")).toBe(3);
    expect(distinctTargets("10.0.0.5")).toBe(3);
    // A two-label name: the cluster, and whether the caller runs in one.
    expect(
      targetColumns(
        spanColumns({
          "db.system.name": "postgresql",
          "server.address": "postgres.data",
          ...CALLERS["podProd"],
        }),
      ),
    ).toEqual(
      target({
        address: "postgres.data",
        inKubernetes: "1",
        cluster: "prod-eu",
      }),
    );
  });
});

describe("readDependencyDatabaseTargets", () => {
  test("reads the query's positional targets", () => {
    expect(
      readDependencyDatabaseTargets(
        row({
          dbSystem: "postgresql",
          dbTargets: [
            target({
              address: "postgres.data",
              port: "5432",
              inKubernetes: "1",
              cluster: "prod-eu",
            }),
            ["sql1", "", "INST01", "shop", "0", ""],
          ],
        }),
      ),
    ).toEqual([
      {
        address: "postgres.data",
        port: "5432",
        instance: "",
        callerNamespace: "",
        callerInKubernetes: true,
        callerCluster: "prod-eu",
      },
      {
        address: "sql1",
        port: "",
        instance: "INST01",
        callerNamespace: "shop",
        callerInKubernetes: false,
        callerCluster: "",
      },
    ] as Array<DependencyDatabaseTarget>);
  });

  test("skips what is not a target, and reads a missing column as none", () => {
    expect(
      readDependencyDatabaseTargets(
        row({
          dbSystem: "postgresql",
          dbTargets: [
            null,
            "db.example.com",
            { address: "db.example.com" },
            ["db.example.com", 5432],
          ] as unknown as Array<Array<string>>,
        }),
      ),
    ).toEqual([
      {
        address: "db.example.com",
        port: "5432",
        instance: "",
        callerNamespace: "",
        callerInKubernetes: false,
        callerCluster: "",
      },
    ]);
    for (const dbTargets of [undefined, null, "[]", {}]) {
      expect(
        readDependencyDatabaseTargets(
          row({
            dbSystem: "postgresql",
            dbTargets: dbTargets as unknown as Array<Array<string>>,
          }),
        ),
      ).toEqual([]);
    }
  });
});

describe("resolveDependencyDatabaseEndpoint", () => {
  const resolveSpan: (
    attributes: StoredAttributes,
  ) => DependencyDatabaseEndpoint | null = (
    attributes: StoredAttributes,
  ): DependencyDatabaseEndpoint | null => {
    const spanRow: ClientSpanDependencyRow = dependencyRowForSpan(attributes);
    const targets: Array<DependencyDatabaseTarget> =
      readDependencyDatabaseTargets(spanRow);
    expect(targets.length).toBeLessThanOrEqual(1);
    return targets[0]
      ? resolveDependencyDatabaseEndpoint({
          dbSystem: spanRow.dbSystem,
          target: targets[0],
        })
      : null;
  };

  for (const [callerName, caller] of Object.entries(CALLERS)) {
    for (const span of DATABASE_SPANS) {
      const attributes: StoredAttributes = { ...span, ...caller };
      test(`is the endpoint ingest keyed the span with: ${callerName} → ${JSON.stringify(span)}`, () => {
        expect(resolveSpan(attributes)?.endpoint ?? null).toBe(
          ingestEndpoint(attributes),
        );
        // …and what the span's row describes its node with.
        expect(
          describeDependencyDatabaseServer(dependencyRowForSpan(attributes))
            ?.endpoint ?? null,
        ).toBe(ingestEndpoint(attributes));
      });
    }
  }

  test("a Kubernetes short name is the caller's own Service, qualified with its cluster", () => {
    const shop: DependencyDatabaseEndpoint | null = resolveSpan({
      "db.system.name": "postgresql",
      "server.address": "postgres",
      ...CALLERS["podProd"],
    });
    const billing: DependencyDatabaseEndpoint | null = resolveSpan({
      "db.system.name": "postgresql",
      "server.address": "postgres",
      ...CALLERS["podOtherNamespace"],
    });
    expect(shop).toEqual({
      endpoint: "postgres.shop.svc.cluster.local:5432@prod-eu",
      port: null,
    });
    expect(billing?.endpoint).toBe(
      "postgres.billing.svc.cluster.local:5432@prod-eu",
    );
  });

  test("a two-label name from a pod is the Service it names, with only the 'runs in Kubernetes' flag kept", () => {
    const columns: SpanColumns = spanColumns({
      "db.system.name": "postgresql",
      "server.address": "postgres.data",
      ...CALLERS["podProd"],
    });
    expect(columns["callerNamespace"]).toBe("");
    expect(
      resolveSpan({
        "db.system.name": "postgresql",
        "server.address": "postgres.data",
        ...CALLERS["podProd"],
      })?.endpoint,
    ).toBe("postgres.data.svc.cluster.local:5432@prod-eu");
    // From a VM the same name is an ordinary DNS name.
    expect(
      resolveSpan({
        "db.system.name": "postgresql",
        "server.address": "postgres.data",
        ...CALLERS["vm"],
      })?.endpoint,
    ).toBe("postgres.data:5432");
  });

  test("the port the calls named: the port attribute, else the address's, else none", () => {
    const resolve: (span: StoredAttributes) => number | null | undefined = (
      span: StoredAttributes,
    ): number | null | undefined => {
      return resolveSpan(span)?.port;
    };
    expect(
      resolve({
        "db.system.name": "postgresql",
        "server.address": "db.example.com:6000",
        "server.port": "6432",
      }),
    ).toBe(6432);
    expect(
      resolve({
        "db.system.name": "postgresql",
        "server.address": "db.example.com:6000",
      }),
    ).toBe(6000);
    expect(
      resolve({
        "db.system.name": "postgresql",
        "server.address": "db.example.com",
      }),
    ).toBeNull();
    // An unusable port attribute is ignored, exactly as the resolver ignores it.
    expect(
      resolve({
        "db.system.name": "postgresql",
        "server.address": "db.example.com",
        "server.port": "70000",
      }),
    ).toBeNull();
    expect(
      resolveDependencyDatabaseEndpoint({
        dbSystem: "postgresql",
        target: {
          address: "db.example.com",
          port: "6432",
          instance: "",
          callerNamespace: "",
          callerInKubernetes: false,
          callerCluster: "",
        },
      }),
    ).toEqual({ endpoint: "db.example.com:6432", port: 6432 });
  });

  test("a SQL Server named instance reached without a port is that instance, never port 1433", () => {
    expect(
      resolveSpan({
        "db.system.name": "microsoft.sql_server",
        "server.address": "sql1.corp.example.com",
        "db.mssql.instance_name": "INST01",
      }),
    ).toEqual({ endpoint: "sql1.corp.example.com\\inst01", port: null });
  });

  test("names no server for a call that has none", () => {
    const none: DependencyDatabaseTarget = {
      address: "",
      port: "",
      instance: "",
      callerNamespace: "",
      callerInKubernetes: false,
      callerCluster: "",
    };
    for (const [dbSystem, address] of [
      ["postgresql", "localhost:5432"],
      ["redis", "host.docker.internal"],
      ["postgresql", "[REDACTED]"],
      ["postgresql", ""],
      ["", "db.example.com"],
      [undefined, "db.example.com"],
    ] as Array<[string | undefined, string]>) {
      expect(
        resolveDependencyDatabaseEndpoint({
          dbSystem: dbSystem,
          target: { ...none, address: address },
        }),
      ).toBeNull();
    }
    expect(
      resolveDependencyDatabaseEndpoint(
        null as unknown as {
          dbSystem: string;
          target: DependencyDatabaseTarget;
        },
      ),
    ).toBeNull();
  });
});

describe("describeDependencyDatabaseServer", () => {
  const RDS: string = "orders.cluster-x.rds.amazonaws.com";

  test("one server, however many placements called it", () => {
    expect(
      describeDependencyDatabaseServer(
        row({
          dbSystem: "postgresql",
          dbTargets: [target({ address: RDS, port: "5432" })],
        }),
      ),
    ).toEqual({ endpoint: `${RDS}:5432`, port: "5432" });
    // Targets that differ only in what cannot change the server agree.
    expect(
      describeDependencyDatabaseServer(
        row({
          dbSystem: "postgresql",
          dbTargets: [
            target({ address: RDS, port: "5432" }),
            target({ address: RDS, port: "5432", namespace: "a" }),
            target({ address: RDS, port: "5432", cluster: "c2" }),
          ],
        }),
      ),
    ).toEqual({ endpoint: `${RDS}:5432`, port: "5432" });
  });

  test("targets that reach different servers leave the row ambiguous ('')", () => {
    expect(
      describeDependencyDatabaseServer(
        row({
          dbSystem: "postgresql",
          dbTargets: [
            target({ address: "pg.data.svc.cluster.local", cluster: "eu" }),
            target({ address: "pg.data.svc.cluster.local", cluster: "us" }),
          ],
        }),
      ),
    ).toEqual({ endpoint: "", port: null });
    // A named port and no named port disagree.
    expect(
      describeDependencyDatabaseServer(
        row({
          dbSystem: "postgresql",
          dbTargets: [
            target({ address: RDS, port: "5432" }),
            target({ address: RDS }),
          ],
        }),
      ),
    ).toEqual({ endpoint: `${RDS}:5432`, port: "" });
  });

  test("a target that names no server contradicts nothing", () => {
    expect(
      describeDependencyDatabaseServer(
        row({
          dbSystem: "redis",
          dbTargets: [
            target({ address: "localhost" }),
            target({ address: "10.0.0.9", port: "6380", cluster: "prod-eu" }),
          ],
        }),
      ),
    ).toEqual({ endpoint: "10.0.0.9:6380@prod-eu", port: "6380" });
    expect(
      describeDependencyDatabaseServer(
        row({
          dbSystem: "redis",
          dbTargets: [target({ address: "localhost" })],
        }),
      ),
    ).toBeNull();
  });

  test("a full target list may have been cut short, so it never names one server", () => {
    const agreeing: Array<Array<string>> = [];
    for (let index: number = 0; index < MAX_DATABASE_TARGETS_PER_ROW; index++) {
      agreeing.push(target({ address: RDS, namespace: `ns-${index}` }));
    }
    expect(
      describeDependencyDatabaseServer(
        row({ dbSystem: "postgresql", dbTargets: agreeing }),
      ),
    ).toEqual({ endpoint: "", port: "" });
    expect(
      describeDependencyDatabaseServer(
        row({ dbSystem: "postgresql", dbTargets: agreeing.slice(1) }),
      ),
    ).toEqual({ endpoint: `${RDS}:5432`, port: null });
  });

  test("describes nothing for a row that is not a database call, or has no targets", () => {
    for (const overrides of [
      { dbSystem: "", dbTargets: [target({ address: RDS })] },
      { peerService: "stripe", serverAddress: "api.stripe.com" },
      { dbSystem: "postgresql", dbTargets: [] },
      { dbSystem: "postgresql" },
    ] as Array<Partial<ClientSpanDependencyRow>>) {
      expect(describeDependencyDatabaseServer(row(overrides))).toBeNull();
    }
    expect(
      describeDependencyDatabaseServer(
        null as unknown as ClientSpanDependencyRow,
      ),
    ).toBeNull();
  });
});

describe("resolveClientSpanTarget — the database server a node calls", () => {
  const keyOf: (target: DependencyTarget | null) => string = (
    target: DependencyTarget | null,
  ): string => {
    if (!target || target.kind !== "dependency") {
      throw new Error("expected a dependency");
    }
    return toExtractedDependencyEntity({
      projectId: PROJECT_ID,
      entity: target.entity,
    }).entityKey;
  };

  const describedEndpoint: (
    target: DependencyTarget | null,
  ) => string | undefined = (
    target: DependencyTarget | null,
  ): string | undefined => {
    return target?.kind === "dependency"
      ? target.entity.descriptiveAttributes[
          DATABASE_ENDPOINT_DESCRIPTIVE_ATTRIBUTE
        ]
      : undefined;
  };

  test("a database node describes the server its calls reached, beside its unchanged identity", () => {
    const withServer: DependencyTarget | null = resolveClientSpanTarget(
      row({
        dbSystem: "PostgreSQL",
        dbNamespace: "Orders",
        serverAddress: "postgres.data",
        dbTargets: [
          target({
            address: "postgres.data",
            port: "5432",
            inKubernetes: "1",
            cluster: "Prod-EU",
          }),
        ],
      }),
      KNOWN,
    );
    expect(withServer).toEqual({
      kind: "dependency",
      entity: {
        entityType: EntityType.Database,
        identifyingAttributes: {
          "db.system.name": "postgresql",
          "server.address": "postgres.data",
          "db.namespace": "orders",
        },
        descriptiveAttributes: {
          "db.system.name": "postgresql",
          [DATABASE_ENDPOINT_DESCRIPTIVE_ATTRIBUTE]:
            "postgres.data.svc.cluster.local:5432@prod-eu",
          [DATABASE_PORT_DESCRIPTIVE_ATTRIBUTE]: "5432",
        },
      },
    });

    // The same calls without the server column: the same node.
    const withoutServer: DependencyTarget | null = resolveClientSpanTarget(
      row({
        dbSystem: "PostgreSQL",
        dbNamespace: "Orders",
        serverAddress: "postgres.data",
      }),
      KNOWN,
    );
    expect(keyOf(withServer)).toBe(keyOf(withoutServer));
  });

  test("the attributes are the ones the Service Map's database link reads", () => {
    expect(DATABASE_ENDPOINT_DESCRIPTIVE_ATTRIBUTE).toBe(
      "oneuptime.database.endpoint",
    );
    expect(DATABASE_PORT_DESCRIPTIVE_ATTRIBUTE).toBe("server.port");
  });

  test("callers in two clusters reach two servers through ONE node", () => {
    const fromCluster: (cluster: string) => DependencyTarget | null = (
      cluster: string,
    ): DependencyTarget | null => {
      return resolveClientSpanTarget(
        dependencyRowForSpan({
          "db.system.name": "postgresql",
          "server.address": "postgres.data",
          [CALLER_NAMESPACE_ATTRIBUTE]: "shop",
          [CALLER_CLUSTER_ATTRIBUTE]: cluster,
        }),
        KNOWN,
      );
    };
    const eu: DependencyTarget | null = fromCluster("prod-eu");
    const us: DependencyTarget | null = fromCluster("prod-us");
    expect(keyOf(eu)).toBe(keyOf(us));
    expect(describedEndpoint(eu)).toBe(
      "postgres.data.svc.cluster.local:5432@prod-eu",
    );
    expect(describedEndpoint(us)).toBe(
      "postgres.data.svc.cluster.local:5432@prod-us",
    );

    // One caller in both clusters: one row, two targets — ambiguous.
    const both: DependencyTarget | null = resolveClientSpanTarget(
      row({
        dbSystem: "postgresql",
        serverAddress: "postgres.data",
        dbTargets: [
          target({
            address: "postgres.data",
            inKubernetes: "1",
            cluster: "prod-eu",
          }),
          target({
            address: "postgres.data",
            inKubernetes: "1",
            cluster: "prod-us",
          }),
        ],
      }),
      KNOWN,
    );
    expect(keyOf(both)).toBe(keyOf(eu));
    expect(describedEndpoint(both)).toBe("");
  });

  test("a call whose server cannot be named carries no description of one", () => {
    const unnamed: DependencyTarget | null = resolveClientSpanTarget(
      row({
        dbSystem: "redis",
        serverAddress: "host.docker.internal:6379",
        dbTargets: [target({ address: "host.docker.internal:6379" })],
      }),
      KNOWN,
    );
    expect(unnamed).toEqual({
      kind: "dependency",
      entity: {
        entityType: EntityType.Database,
        identifyingAttributes: {
          "db.system.name": "redis",
          "server.address": "host.docker.internal",
        },
        descriptiveAttributes: { "db.system.name": "redis" },
      },
    });
  });

  test("only database nodes ever describe a database server", () => {
    for (const overrides of [
      { peerService: "stripe", serverAddress: "api.stripe.com" },
      { messagingSystem: "kafka", serverAddress: "kafka-0.kafka:9092" },
      { serverAddress: "api.stripe.com", isHttp: 1 },
      { rpcSystem: "grpc", rpcService: "acme.ledger.v1.Ledger" },
    ] as Array<Partial<ClientSpanDependencyRow>>) {
      const resolved: DependencyTarget | null = resolveClientSpanTarget(
        row({
          ...overrides,
          dbTargets: [target({ address: "x.example", port: "5432" })],
        }),
        KNOWN,
      );
      expect(resolved?.kind).toBe("dependency");
      if (resolved?.kind === "dependency") {
        const attributes: Record<string, string> =
          resolved.entity.descriptiveAttributes;
        expect(DATABASE_ENDPOINT_DESCRIPTIVE_ATTRIBUTE in attributes).toBe(
          false,
        );
        expect(DATABASE_PORT_DESCRIPTIVE_ATTRIBUTE in attributes).toBe(false);
      }
    }
  });
});

/*
 * The client-span query returns its busiest rows up to a cap. A database
 * row must stay ONE row per (caller, node) however many placements, pods,
 * IPs or ports its calls came from — otherwise a busy database's split rows
 * fill the cap and the calls to everything else (HTTP APIs, gRPC peers,
 * brokers) silently fall off the Service Map. This simulates the query
 * over a large estate: its GROUP BY columns are read from the SQL itself,
 * its dbTargets aggregation is groupUniqArrayIf with the same cap.
 */
/*
 * The client-span dependency query, run in TypeScript over simulated calls:
 * the spans it leaves out, its GROUP BY (read from the SQL itself), the
 * servers it aggregates and its row cap.
 */
interface SimulatedCalls {
  service: string;
  attributes: StoredAttributes;
  calls: number;
}

interface SimulatedRow {
  columns: SpanColumns;
  targets: Array<string>;
  callCount: number;
}

function runQuery(
  calls: Array<SimulatedCalls>,
  maxRows: number,
): Array<ClientSpanDependencyRow> {
  const sql: string = collapse(
    buildClientSpanDependencySql({ ...WINDOW, maxRows: maxRows }),
  );
  const groupBy: RegExpMatchArray | null = sql.match(
    /GROUP BY ([A-Za-z, ]+) ORDER BY callCount DESC/,
  );
  expect(groupBy).not.toBeNull();
  const groupColumns: Array<string> = groupBy![1]!.split(", ");

  expect(sql).toContain(
    `AND NOT ${collapse(clientSocketPortSql("serverPort"))}`,
  );

  const groups: Map<string, SimulatedRow> = new Map<string, SimulatedRow>();
  for (const call of calls) {
    const columns: SpanColumns = {
      callerServiceId: call.service,
      ...spanColumns(call.attributes),
    };
    // The WHERE clause: a call on a client's own socket is left out.
    if (isClientSocketPortInSql(columns["serverPort"]!)) {
      continue;
    }
    const key: string = JSON.stringify(
      groupColumns.map((column: string): string => {
        expect(column in columns).toBe(true);
        return columns[column]!;
      }),
    );
    const group: SimulatedRow = groups.get(key) || {
      columns: columns,
      targets: [],
      callCount: 0,
    };
    const entry: string = JSON.stringify(targetColumns(columns));
    if (
      columns["dbSystem"] !== "" &&
      !group.targets.includes(entry) &&
      group.targets.length < MAX_DATABASE_TARGETS_PER_ROW
    ) {
      group.targets.push(entry);
    }
    group.callCount += call.calls;
    groups.set(key, group);
  }

  return Array.from(groups.values())
    .sort((a: SimulatedRow, b: SimulatedRow): number => {
      return b.callCount - a.callCount;
    })
    .slice(0, maxRows)
    .map((group: SimulatedRow): ClientSpanDependencyRow => {
      return {
        callerServiceId: group.columns["callerServiceId"]!,
        dbSystem: group.columns["dbSystem"],
        dbNamespace: group.columns["dbNamespace"],
        messagingSystem: group.columns["messagingSystem"],
        peerService: group.columns["peerService"],
        rpcSystem: group.columns["rpcSystem"],
        rpcService: group.columns["rpcService"],
        serverAddress: group.columns["serverAddress"],
        isHttp: group.columns["isHttp"],
        dbTargets: group.targets.map((entry: string): Array<string> => {
          return JSON.parse(entry) as Array<string>;
        }),
        callCount: group.callCount,
        errorCount: 0,
        avgDurationNano: 1000000,
      };
    });
}

describe("client span dependency rows are bounded by the nodes, not the estate", () => {
  const SERVICES: number = 10;
  const NAMESPACES: number = 100;
  const CLUSTERS: number = 3;
  const RDS: string = "orders.cluster-x.rds.amazonaws.com";

  function service(index: number): string {
    return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  }

  /*
   * Namespace-per-tenant: every service runs in 100 namespaces across 3
   * clusters and calls, from each, a managed Postgres, the namespace's own
   * `redis` and a Postgres pod IP — busy database calls — while once in a
   * while calling Stripe over HTTP and a ledger over gRPC.
   */
  function estate(): Array<SimulatedCalls> {
    const calls: Array<SimulatedCalls> = [];
    for (let s: number = 0; s < SERVICES; s++) {
      for (let n: number = 0; n < NAMESPACES; n++) {
        const placement: StoredAttributes = {
          "resource.k8s.pod.name": `svc-${s}-${n}-pod`,
          [CALLER_NAMESPACE_ATTRIBUTE]: `tenant-${n}`,
          [CALLER_CLUSTER_ATTRIBUTE]: `cluster-${n % CLUSTERS}`,
        };
        calls.push(
          {
            service: service(s),
            attributes: {
              "db.system.name": "postgresql",
              "db.namespace": "orders",
              "server.address": RDS,
              "server.port": "5432",
              ...placement,
            },
            calls: 50,
          },
          {
            service: service(s),
            attributes: {
              "db.system.name": "redis",
              "server.address": "redis",
              ...placement,
            },
            calls: 40,
          },
          {
            service: service(s),
            attributes: {
              "db.system.name": "postgresql",
              "db.namespace": "tenant",
              "network.peer.address": `10.0.${s}.${n}`,
              "network.peer.port": "5432",
              ...placement,
            },
            calls: 30,
          },
        );
      }
      calls.push(
        {
          service: service(s),
          attributes: {
            "server.address": "api.stripe.com",
            "http.request.method": "POST",
          },
          calls: 2,
        },
        {
          service: service(s),
          attributes: {
            "rpc.system": "grpc",
            "rpc.service": "acme.ledger.v1.Ledger",
          },
          calls: 1,
        },
      );
    }
    return calls;
  }

  test("HTTP and RPC peers survive however numerous the database calls' placements", () => {
    const rows: Array<ClientSpanDependencyRow> = runQuery(estate(), 1000);

    for (let s: number = 0; s < SERVICES; s++) {
      const own: Array<ClientSpanDependencyRow> = rows.filter(
        (candidate: ClientSpanDependencyRow): boolean => {
          return candidate.callerServiceId === service(s);
        },
      );
      const targets: Array<DependencyTarget | null> = own.map(
        (candidate: ClientSpanDependencyRow): DependencyTarget | null => {
          return resolveClientSpanTarget(candidate, KNOWN);
        },
      );
      expect(
        targets.some((resolved: DependencyTarget | null): boolean => {
          return (
            resolved?.kind === "dependency" &&
            resolved.entity.identifyingAttributes["server.address"] ===
              "api.stripe.com"
          );
        }),
      ).toBe(true);
      expect(
        targets.some((resolved: DependencyTarget | null): boolean => {
          return (
            resolved?.kind === "dependency" &&
            resolved.entity.identifyingAttributes["rpc.service"] ===
              "acme.ledger.v1.ledger"
          );
        }),
      ).toBe(true);
      // One row per (caller, node): three databases, three rows.
      expect(
        own.filter((candidate: ClientSpanDependencyRow): boolean => {
          return Boolean(candidate.dbSystem);
        }),
      ).toHaveLength(3);
    }
    expect(rows).toHaveLength(SERVICES * 5);
  });

  test("each database row still describes its server — or says it reached several", () => {
    const rows: Array<ClientSpanDependencyRow> = runQuery(estate(), 1000);
    const described: Map<string, DependencyDatabaseServer | null> = new Map<
      string,
      DependencyDatabaseServer | null
    >();
    for (const candidate of rows) {
      if (candidate.callerServiceId === service(0) && candidate.dbSystem) {
        described.set(
          `${candidate.dbSystem} ${candidate.serverAddress}`,
          describeDependencyDatabaseServer(candidate),
        );
      }
    }
    expect(Object.fromEntries(described)).toEqual({
      // Every placement reaches the same managed server.
      [`postgresql ${RDS}`]: { endpoint: `${RDS}:5432`, port: "5432" },
      // Each namespace's own `redis`, and a pod IP per tenant: many servers.
      "redis redis": { endpoint: "", port: "" },
      "postgresql ": { endpoint: "", port: "" },
    });
  });

  test("with a tight cap, the busiest nodes win — never one node's split rows", () => {
    const rows: Array<ClientSpanDependencyRow> = runQuery(estate(), 30);
    expect(rows).toHaveLength(30);
    const nodes: Set<string> = new Set<string>(
      rows.map((candidate: ClientSpanDependencyRow): string => {
        return `${candidate.callerServiceId} ${candidate.dbSystem} ${candidate.serverAddress} ${candidate.dbNamespace}`;
      }),
    );
    expect(nodes.size).toBe(30);
  });
});

/*
 * The bug report: eBPF instrumentation (OBI) joined the worker's long-lived
 * Redis connections mid-stream and swapped their two ends, so the Redis
 * server's own pod emitted CLIENT spans naming the worker — its address and
 * an ephemeral port — as the server. Grouped without the port, they gave the
 * Redis server's service a dependency on a "redis @ oneuptime-worker"
 * Database node.
 */
describe("client span dependencies — a client's own socket", () => {
  const sql: string = collapse(buildClientSpanDependencySql(WINDOW));

  // Every engine by every name it is known by, and one nobody knows.
  const ENGINES: Array<string> = [
    ...DATABASE_SYSTEMS.flatMap(
      (descriptor: DatabaseSystemDescriptor): Array<string> => {
        return [descriptor.system, ...descriptor.aliases];
      },
    ),
    "acme-db",
  ];

  // Ports around every boundary of the rule, and every engine's default.
  const PORTS: Array<number> = Array.from(
    new Set<number>([
      1,
      80,
      1433,
      3306,
      5432,
      6379,
      9042,
      27017,
      32767,
      32768,
      32769,
      40000,
      46482,
      46600,
      49151,
      49152,
      49999,
      50000,
      50001,
      60999,
      61000,
      65534,
      65535,
      ...DATABASE_SYSTEMS.map(
        (descriptor: DatabaseSystemDescriptor): number => {
          return descriptor.defaultPort ?? 1;
        },
      ),
    ]),
  );

  const WORKER: StoredAttributes = {
    "resource.k8s.pod.name": "oneuptime-worker-5d8f-x",
    [CALLER_NAMESPACE_ATTRIBUTE]: "default",
    [CALLER_CLUSTER_ATTRIBUTE]: "gke-test-cluster",
  };
  const REDIS_POD: StoredAttributes = {
    "resource.k8s.pod.name": "oneuptime-redis-master-0",
    [CALLER_NAMESPACE_ATTRIBUTE]: "default",
    [CALLER_CLUSTER_ATTRIBUTE]: "gke-test-cluster",
  };
  const WORKER_SERVICE: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const REDIS_SERVICE: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

  // A target of a swapped Redis row: the worker, as the Redis pod named it.
  function socket(
    overrides: Partial<DependencyDatabaseTarget>,
  ): DependencyDatabaseTarget {
    return {
      address: "oneuptime-worker",
      port: "46600",
      instance: "",
      callerNamespace: "default",
      callerInKubernetes: false,
      callerCluster: "gke-test-cluster",
      ...overrides,
    };
  }

  function socketColumns(
    overrides: Partial<DependencyDatabaseTarget>,
  ): Array<string> {
    const value: DependencyDatabaseTarget = socket(overrides);
    return [
      value.address,
      value.port,
      value.instance,
      value.callerNamespace,
      value.callerInKubernetes ? "1" : "0",
      value.callerCluster,
    ];
  }

  function swappedRow(
    targets: Array<Partial<DependencyDatabaseTarget>>,
    overrides: Partial<ClientSpanDependencyRow> = {},
  ): ClientSpanDependencyRow {
    return row({
      callerServiceId: REDIS_SERVICE,
      dbSystem: "redis",
      serverAddress: "oneuptime-worker",
      dbTargets: targets.map(socketColumns),
      ...overrides,
    });
  }

  describe("the query", () => {
    test("leaves the call out in the span scan, before anything is grouped", () => {
      expect(sql).toContain(
        `AND kind IN ('SPAN_KIND_CLIENT', 'SPAN_KIND_PRODUCER') AND NOT ${collapse(
          clientSocketPortSql("serverPort"),
        )} AND (traceId, spanId) NOT IN (`,
      );
      // The port is still never part of a node's identity.
      expect(sql).toContain(
        "GROUP BY callerServiceId, dbSystem, dbNamespace, messagingSystem, peerService, rpcSystem, rpcService, serverAddress, isHttp ORDER BY",
      );
    });

    test("is exactly the SQL the TypeScript twin evaluates", () => {
      expect(clientSocketPortSql("p")).toBe(
        "(match(p, '^ *0*[0-9]{1,5} *$') AND toUInt32OrZero(trimBoth(p)) >= 32768 AND toUInt32OrZero(trimBoth(p)) <= 65535 AND toUInt32OrZero(trimBoth(p)) NOT IN (50000))",
      );
      expect(PORT_ATTRIBUTE_PATTERN).toBe("^ *0*[0-9]{1,5} *$");
      expect(EPHEMERAL_PORT_RANGE_START).toBe(32768);
    });

    test("the ephemeral ports an engine listens on by default are read from the catalog: Db2's", () => {
      expect(EPHEMERAL_DEFAULT_DATABASE_PORTS).toEqual([50000]);
      for (const descriptor of DATABASE_SYSTEMS) {
        if (
          descriptor.defaultPort !== null &&
          descriptor.defaultPort >= EPHEMERAL_PORT_RANGE_START
        ) {
          expect(EPHEMERAL_DEFAULT_DATABASE_PORTS).toContain(
            descriptor.defaultPort,
          );
        }
      }
    });

    test("reads port attributes as ClickHouse 26.7 evaluated the expression", () => {
      const cases: Array<[string, boolean]> = [
        ["46600", true],
        [" 46600 ", true],
        ["0046600", true],
        ["0000000000046600", true],
        ["32768", true],
        ["65535", true],
        ["32767", false],
        ["6379", false],
        ["50000", false],
        ["65536", false],
        ["99999", false],
        ["", false],
        ["abc", false],
        ["+46600", false],
        ["-46600", false],
        ["4.66e4", false],
        ["46600\t", false],
      ];
      for (const [port, expected] of cases) {
        expect([port, isClientSocketPortInSql(port)]).toEqual([port, expected]);
      }
    });

    test("for every engine, it is isClientSocketDatabaseEndpoint less the ports some engine listens on", () => {
      for (const engine of ENGINES) {
        for (const port of PORTS) {
          const clientSocket: boolean = isClientSocketDatabaseEndpoint({
            system: engine,
            endpoint: { host: "oneuptime-worker.example.com", port: port },
          });
          expect([engine, port, isClientSocketPortInSql(String(port))]).toEqual(
            [
              engine,
              port,
              clientSocket && !EPHEMERAL_DEFAULT_DATABASE_PORTS.includes(port),
            ],
          );
        }
      }
    });

    test("never leaves out a call to a database on its engine's default port", () => {
      for (const descriptor of DATABASE_SYSTEMS) {
        if (descriptor.defaultPort !== null) {
          expect([
            descriptor.system,
            isClientSocketPortInSql(String(descriptor.defaultPort)),
          ]).toEqual([descriptor.system, false]);
        }
      }
    });

    test("leaves a call out only for the very port ingest keys it by", () => {
      for (const port of ["46600", " 46600 ", "046600"]) {
        const attributes: StoredAttributes = {
          "db.system.name": "redis",
          "server.address": "oneuptime-worker.example.com",
          "server.port": port,
        };
        expect(
          isClientSocketPortInSql(spanColumns(attributes)["serverPort"]!),
        ).toBe(true);
        expect(
          resolveDatabaseCallTarget({
            getAttribute: (key: string): unknown => {
              return attributes[key];
            },
            caller: buildDatabaseCallerContext({}),
          })?.endpoint.port,
        ).toBe(46600);
      }
    });

    test("keeps every call that is not a database call, whatever its port", () => {
      const columns: SpanColumns = spanColumns({
        "server.address": "api.example.com",
        "server.port": "46600",
        "http.request.method": "GET",
      });
      expect(columns["serverPort"]).toBe("");
      expect(isClientSocketPortInSql(columns["serverPort"]!)).toBe(false);
    });
  });

  describe("isClientSocketDependencyTarget", () => {
    test("a Redis target on the worker's ephemeral port is a client's socket", () => {
      for (const port of ["46600", "32768", "65535"]) {
        expect(
          isClientSocketDependencyTarget({
            dbSystem: "redis",
            target: socket({ port: port }),
          }),
        ).toBe(true);
      }
    });

    test("including what the query cannot catch: Db2's port, or a port inside the address", () => {
      expect(
        isClientSocketDependencyTarget({
          dbSystem: "redis",
          target: socket({ port: "50000" }),
        }),
      ).toBe(true);
      expect(
        isClientSocketDependencyTarget({
          dbSystem: "redis",
          target: socket({ address: "oneuptime-worker:46600", port: "" }),
        }),
      ).toBe(true);
      expect(isClientSocketPortInSql("")).toBe(false);
    });

    test("a server on its engine's port, its default, or Db2's 50000 is not", () => {
      for (const [dbSystem, port] of [
        ["redis", "6379"],
        ["redis", ""],
        ["redis", "16379"],
        ["ibm.db2", "50000"],
        ["db2", "50000"],
        ["db2", ""],
      ] as Array<[string, string]>) {
        expect([
          dbSystem,
          port,
          isClientSocketDependencyTarget({
            dbSystem: dbSystem,
            target: socket({ port: port }),
          }),
        ]).toEqual([dbSystem, port, false]);
      }
      // …while Db2 on any other ephemeral port is a client's socket.
      expect(
        isClientSocketDependencyTarget({
          dbSystem: "db2",
          target: socket({ port: "50001" }),
        }),
      ).toBe(true);
    });

    test("a target that names no server names no client's socket either", () => {
      for (const [dbSystem, address] of [
        ["redis", "localhost"],
        ["redis", "[REDACTED]"],
        ["redis", ""],
        ["", "oneuptime-worker"],
        [undefined, "oneuptime-worker"],
      ] as Array<[string | undefined, string]>) {
        expect(
          isClientSocketDependencyTarget({
            dbSystem: dbSystem,
            target: socket({ address: address }),
          }),
        ).toBe(false);
      }
      expect(
        isClientSocketDependencyTarget(
          null as unknown as {
            dbSystem: string;
            target: DependencyDatabaseTarget;
          },
        ),
      ).toBe(false);
    });
  });

  describe("isClientSocketDependencyRow", () => {
    test("a database row whose every call named a client's socket", () => {
      expect(
        isClientSocketDependencyRow(
          swappedRow([
            { port: "50000" },
            { address: "oneuptime-worker:46600", port: "" },
            { port: "50000", callerCluster: "gke-other-cluster" },
          ]),
        ),
      ).toBe(true);
    });

    test("not while one call reached a server", () => {
      expect(
        isClientSocketDependencyRow(
          swappedRow([{ port: "50000" }, { port: "6379" }]),
        ),
      ).toBe(false);
      expect(
        isClientSocketDependencyRow(
          swappedRow([{ port: "50000" }, { address: "localhost" }]),
        ),
      ).toBe(false);
    });

    test("not when the target list may have been cut short", () => {
      const full: Array<Partial<DependencyDatabaseTarget>> = [];
      for (
        let index: number = 0;
        index < MAX_DATABASE_TARGETS_PER_ROW;
        index++
      ) {
        full.push({ port: "50000", callerCluster: `cluster-${index}` });
      }
      expect(isClientSocketDependencyRow(swappedRow(full))).toBe(false);
      expect(isClientSocketDependencyRow(swappedRow(full.slice(1)))).toBe(true);
    });

    test("not for a malformed target, a row without any, or a row that is not a database call", () => {
      expect(
        isClientSocketDependencyRow(
          swappedRow([{ port: "50000" }], {
            dbTargets: [
              socketColumns({ port: "50000" }),
              "oneuptime-worker:46600" as unknown as Array<string>,
            ],
          }),
        ),
      ).toBe(false);
      for (const overrides of [
        { dbTargets: [] },
        { dbTargets: undefined },
        { dbSystem: "" },
        { dbSystem: "   " },
      ] as Array<Partial<ClientSpanDependencyRow>>) {
        expect(
          isClientSocketDependencyRow(
            swappedRow([{ port: "50000" }], overrides),
          ),
        ).toBe(false);
      }
      expect(
        isClientSocketDependencyRow(null as unknown as ClientSpanDependencyRow),
      ).toBe(false);
    });
  });

  describe("resolveClientSpanTarget", () => {
    test("a row whose every call named a client's socket draws no Database node", () => {
      expect(
        resolveClientSpanTarget(
          swappedRow([{ port: "50000" }, { port: "49114" }]),
          KNOWN,
        ),
      ).toBeNull();
      // Even when the worker is a service of the project.
      expect(
        resolveClientSpanTarget(
          swappedRow([{ port: "50000" }]),
          new Set<string>(["oneuptime-worker"]),
        ),
      ).toBeNull();
    });

    test("Db2 on its default port 50000 is still a database", () => {
      const resolved: DependencyTarget | null = resolveClientSpanTarget(
        row({
          dbSystem: "ibm.db2",
          serverAddress: "db2.example.com",
          dbTargets: [target({ address: "db2.example.com", port: "50000" })],
        }),
        KNOWN,
      );
      expect(resolved).toMatchObject({
        kind: "dependency",
        entity: {
          entityType: EntityType.Database,
          identifyingAttributes: {
            "db.system.name": "ibm.db2",
            "server.address": "db2.example.com",
          },
          descriptiveAttributes: {
            [DATABASE_ENDPOINT_DESCRIPTIVE_ATTRIBUTE]: "db2.example.com:50000",
            [DATABASE_PORT_DESCRIPTIVE_ATTRIBUTE]: "50000",
          },
        },
      });
    });

    test("a server beside a client's socket keeps the node, described by the server alone", () => {
      const resolved: DependencyTarget | null = resolveClientSpanTarget(
        swappedRow([{ port: "50000" }, { port: "6379" }]),
        KNOWN,
      );
      expect(resolved?.kind).toBe("dependency");
      expect(
        resolved?.kind === "dependency"
          ? resolved.entity.descriptiveAttributes
          : null,
      ).toEqual({
        "db.system.name": "redis",
        [DATABASE_ENDPOINT_DESCRIPTIVE_ATTRIBUTE]:
          "oneuptime-worker.default.svc.cluster.local:6379@gke-test-cluster",
        [DATABASE_PORT_DESCRIPTIVE_ATTRIBUTE]: "6379",
      });
      expect(
        describeDependencyDatabaseServer(swappedRow([{ port: "50000" }])),
      ).toBeNull();
    });

    test("a row whose targets may have been cut short keeps its node, ambiguous", () => {
      const full: Array<Partial<DependencyDatabaseTarget>> = [];
      for (
        let index: number = 0;
        index < MAX_DATABASE_TARGETS_PER_ROW;
        index++
      ) {
        full.push({ port: "50000", callerCluster: `cluster-${index}` });
      }
      const resolved: DependencyTarget | null = resolveClientSpanTarget(
        swappedRow(full),
        KNOWN,
      );
      expect(
        resolved?.kind === "dependency"
          ? resolved.entity.descriptiveAttributes[
              DATABASE_ENDPOINT_DESCRIPTIVE_ATTRIBUTE
            ]
          : null,
      ).toBe("");
    });
  });

  test("end to end: the worker's swapped connections draw nothing, its real Redis stays", () => {
    // More ports than a row keeps targets: no target list could tell.
    const swappedPorts: Array<string> = Array.from(
      { length: 3 * MAX_DATABASE_TARGETS_PER_ROW },
      (_value: unknown, index: number): string => {
        return String(EPHEMERAL_PORT_RANGE_START + 7 + index * 593);
      },
    );
    const calls: Array<SimulatedCalls> = [
      {
        service: WORKER_SERVICE,
        attributes: {
          "db.system.name": "redis",
          "server.address": "oneuptime-redis-master",
          "server.port": "6379",
          ...WORKER,
        },
        calls: 9000,
      },
      ...swappedPorts.map((port: string): SimulatedCalls => {
        return {
          service: REDIS_SERVICE,
          attributes: {
            "db.system.name": "redis",
            "server.address": "oneuptime-worker",
            "server.port": port,
            ...REDIS_POD,
          },
          calls: 300,
        };
      }),
      // Legacy attribute names, as an older instrumentation spells them.
      {
        service: REDIS_SERVICE,
        attributes: {
          "db.system": "redis",
          "net.peer.name": "oneuptime-worker",
          "net.peer.port": "46482",
          ...REDIS_POD,
        },
        calls: 300,
      },
      // The one connection the query keeps: the client got Db2's port.
      {
        service: REDIS_SERVICE,
        attributes: {
          "db.system.name": "redis",
          "server.address": "oneuptime-worker",
          "server.port": "50000",
          ...REDIS_POD,
        },
        calls: 300,
      },
    ];

    const rows: Array<ClientSpanDependencyRow> = runQuery(calls, 1000);
    expect(
      rows.map((candidate: ClientSpanDependencyRow): string => {
        return `${candidate.callerServiceId} ${candidate.serverAddress} ${candidate.callCount}`;
      }),
    ).toEqual([
      `${WORKER_SERVICE} oneuptime-redis-master 9000`,
      `${REDIS_SERVICE} oneuptime-worker 300`,
    ]);

    const nodes: Array<DependencyTarget> = rows
      .map((candidate: ClientSpanDependencyRow): DependencyTarget | null => {
        return resolveClientSpanTarget(
          candidate,
          new Set<string>(["oneuptime-worker", "redis"]),
        );
      })
      .filter((node: DependencyTarget | null): node is DependencyTarget => {
        return node !== null;
      });
    expect(nodes).toEqual([
      {
        kind: "dependency",
        entity: {
          entityType: EntityType.Database,
          identifyingAttributes: {
            "db.system.name": "redis",
            "server.address": "oneuptime-redis-master",
          },
          descriptiveAttributes: {
            "db.system.name": "redis",
            [DATABASE_ENDPOINT_DESCRIPTIVE_ATTRIBUTE]:
              "oneuptime-redis-master.default.svc.cluster.local:6379@gke-test-cluster",
            [DATABASE_PORT_DESCRIPTIVE_ATTRIBUTE]: "6379",
          },
        },
      },
    ]);
  });
});

describe("mergeDependencyEntityDescriptions", () => {
  const ENDPOINT: string = DATABASE_ENDPOINT_DESCRIPTIVE_ATTRIBUTE;
  const PORT: string = DATABASE_PORT_DESCRIPTIVE_ATTRIBUTE;

  function sighting(descriptive?: Record<string, string>): ExtractedEntity {
    const entity: ExtractedEntity = {
      entityType: EntityType.Database,
      entityKey: "0123456789abcdef",
      identifyingAttributes: {
        "db.system.name": "postgresql",
        "server.address": "db.example.com",
      },
    };
    if (descriptive) {
      entity.descriptiveAttributes = descriptive;
    }
    return entity;
  }

  function merged(
    ...sightings: Array<ExtractedEntity>
  ): Record<string, string> | undefined {
    return sightings.reduce(mergeDependencyEntityDescriptions)
      .descriptiveAttributes;
  }

  test("sightings that name the same server keep it", () => {
    const same: ExtractedEntity = sighting({
      "db.system.name": "postgresql",
      [ENDPOINT]: "db.example.com:6432",
      [PORT]: "6432",
    });
    expect(merged(same, same, same)).toEqual({
      "db.system.name": "postgresql",
      [ENDPOINT]: "db.example.com:6432",
      [PORT]: "6432",
    });
  });

  test("sightings that reach different servers leave the node ambiguous ('')", () => {
    expect(
      merged(
        sighting({ [ENDPOINT]: "db.example.com:5432" }),
        sighting({ [ENDPOINT]: "db.example.com:6432", [PORT]: "6432" }),
      ),
    ).toEqual({ [ENDPOINT]: "", [PORT]: "" });
    // Same port, two clusters: the endpoint is ambiguous, the port is not.
    expect(
      merged(
        sighting({
          [ENDPOINT]: "pg.data.svc.cluster.local:5432@eu",
          [PORT]: "5432",
        }),
        sighting({
          [ENDPOINT]: "pg.data.svc.cluster.local:5432@us",
          [PORT]: "5432",
        }),
      ),
    ).toEqual({ [ENDPOINT]: "", [PORT]: "5432" });
  });

  test("a named port and no named port disagree", () => {
    expect(
      merged(
        sighting({ [ENDPOINT]: "db.example.com:5432", [PORT]: "5432" }),
        sighting({ [ENDPOINT]: "db.example.com:5432" }),
      ),
    ).toEqual({ [ENDPOINT]: "db.example.com:5432", [PORT]: "" });
  });

  test("once ambiguous, always ambiguous, in any order", () => {
    const a: ExtractedEntity = sighting({ [ENDPOINT]: "a.example.com:5432" });
    const b: ExtractedEntity = sighting({ [ENDPOINT]: "b.example.com:5432" });
    for (const order of [
      [a, b, a],
      [a, a, b],
      [b, a, a],
      [a, b, b, a],
    ]) {
      expect(merged(...order)?.[ENDPOINT]).toBe("");
    }
  });

  test("a sighting that names no server contradicts nothing", () => {
    const named: ExtractedEntity = sighting({
      "db.system.name": "postgresql",
      [ENDPOINT]: "db.example.com:5432",
    });
    const unnamed: ExtractedEntity = sighting({
      "db.system.name": "postgresql",
    });
    expect(merged(named, unnamed)?.[ENDPOINT]).toBe("db.example.com:5432");
    expect(merged(unnamed, named)?.[ENDPOINT]).toBe("db.example.com:5432");
    expect(merged(unnamed, sighting(), unnamed)).toEqual({
      "db.system.name": "postgresql",
    });
    expect(merged(sighting(), sighting())).toBeUndefined();
  });

  test("every other attribute: the later sighting wins, and the identity is untouched", () => {
    const earlier: ExtractedEntity = sighting({
      "network.protocol.name": "tcp",
      "db.system.name": "postgres",
    });
    const later: ExtractedEntity = sighting({ "db.system.name": "postgresql" });
    const result: ExtractedEntity = mergeDependencyEntityDescriptions(
      earlier,
      later,
    );
    expect(result.descriptiveAttributes).toEqual({
      "network.protocol.name": "tcp",
      "db.system.name": "postgresql",
    });
    expect(result.entityKey).toBe(later.entityKey);
    expect(result.identifyingAttributes).toEqual(later.identifyingAttributes);
    // Neither input is modified.
    expect(earlier.descriptiveAttributes).toEqual({
      "network.protocol.name": "tcp",
      "db.system.name": "postgres",
    });
    expect(later.descriptiveAttributes).toEqual({
      "db.system.name": "postgresql",
    });
  });
});
