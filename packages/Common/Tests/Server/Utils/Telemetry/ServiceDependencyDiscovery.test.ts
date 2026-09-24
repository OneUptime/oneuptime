import { describe, expect, test } from "@jest/globals";
import {
  CALLER_CLUSTER_ATTRIBUTE,
  CALLER_NAMESPACE_ATTRIBUTE,
  ClientSpanDependencyRow,
  DATABASE_ENDPOINT_DESCRIPTIVE_ATTRIBUTE,
  DATABASE_PORT_DESCRIPTIVE_ATTRIBUTE,
  DependencyDatabaseEndpoint,
  DependencyEdgeCollector,
  DependencyQueryWindow,
  DependencyTarget,
  PARENT_LOOKBACK_MINUTES,
  SERVICE_GRAPH_REQUEST_FAILED_METRIC,
  SERVICE_GRAPH_REQUEST_TOTAL_METRIC,
  buildClientSpanDependencySql,
  buildServiceGraphMetricSql,
  buildTraceLinkedDependencySql,
  databaseInstanceSql,
  escapeSql,
  firstNonEmptyAttributeSql,
  isUuid,
  mergeDependencyEntityDescriptions,
  mergeDependencySources,
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
  databaseInstanceSql as discoveryDatabaseInstanceSql,
  firstNonEmptyAttributeSql as discoveryFirstNonEmptyAttributeSql,
} from "../../../../Server/Utils/Telemetry/DatabaseEndpointDiscovery";
import {
  DatabaseEndpoint,
  buildDatabaseCallerContext,
  formatDatabaseEndpoint,
} from "../../../../Types/DatabaseServer/DatabaseEndpoint";
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
 * The client-span dependency query's columns for ONE stored span, computed
 * the way the SQL computes them (ClickHouse maps answer '' for a missing
 * key): the TypeScript twin of buildClientSpanDependencySql's SELECT.
 */
function dependencyRowForSpan(
  attributes: StoredAttributes,
): ClientSpanDependencyRow {
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
  const databaseOnly: (value: string) => string = (value: string): string => {
    return dbSystem !== "" ? value : "";
  };
  const namespace: string = read("db.namespace");
  const instance: string =
    read("db.mssql.instance_name") !== ""
      ? read("db.mssql.instance_name")
      : namespace.includes("|")
        ? namespace.split("|")[0]!
        : "";

  return row({
    dbSystem: dbSystem,
    dbNamespace: namespace !== "" ? namespace : read("db.name"),
    serverAddress: firstNonEmpty(["server.address", "net.peer.name"]),
    dbServerAddress: databaseOnly(firstNonEmpty(DATABASE_ADDRESS_ATTRIBUTES)),
    serverPort: databaseOnly(firstNonEmpty(DATABASE_PORT_ATTRIBUTES)),
    dbInstance: databaseOnly(instance),
    callerNamespace: databaseOnly(read(CALLER_NAMESPACE_ATTRIBUTE)),
    callerCluster: databaseOnly(read(CALLER_CLUSTER_ATTRIBUTE)),
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
  { "db.system.name": "postgresql", "server.address": "localhost" },
  { "db.system.name": "redis", "server.address": "host.docker.internal" },
  { "db.system.name": "postgresql", "server.address": "[REDACTED]" },
  { "db.system.name": "cockroachdb", "server.address": "crdb.example.com" },
];

describe("client span dependency SQL — the database server a node calls", () => {
  const sql: string = collapse(buildClientSpanDependencySql(WINDOW));

  test("keeps what the ingest resolver reads, with its precedence, for database calls only", () => {
    const only: (expression: string) => string = (
      expression: string,
    ): string => {
      return `if(dbSystem != '', ${expression}, '')`;
    };
    expect(sql).toContain(
      `${only(firstNonEmptyAttributeSql(DATABASE_ADDRESS_ATTRIBUTES))} AS dbServerAddress`,
    );
    expect(sql).toContain(
      `${only(firstNonEmptyAttributeSql(DATABASE_PORT_ATTRIBUTES))} AS serverPort`,
    );
    expect(sql).toContain(`${only(databaseInstanceSql())} AS dbInstance`);
    expect(sql).toContain(
      `${only(`attributes['${CALLER_NAMESPACE_ATTRIBUTE}']`)} AS callerNamespace`,
    );
    expect(sql).toContain(
      `${only(`attributes['${CALLER_CLUSTER_ATTRIBUTE}']`)} AS callerCluster`,
    );
  });

  test("groups on them, beside the columns a node is keyed by", () => {
    expect(sql).toContain(
      "GROUP BY callerServiceId, dbSystem, dbNamespace, messagingSystem, peerService, rpcSystem, rpcService, serverAddress, isHttp, dbServerAddress, serverPort, dbInstance, callerNamespace, callerCluster ORDER BY",
    );
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

  test("never groups on anything that varies per caller instance", () => {
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
    expect(CALLER_NAMESPACE_ATTRIBUTE).toBe(DISCOVERY_CALLER_NAMESPACE);
    expect(CALLER_CLUSTER_ATTRIBUTE).toBe(DISCOVERY_CALLER_CLUSTER);
  });
});

describe("resolveDependencyDatabaseEndpoint", () => {
  for (const [callerName, caller] of Object.entries(CALLERS)) {
    for (const span of DATABASE_SPANS) {
      const attributes: StoredAttributes = { ...span, ...caller };
      test(`is the endpoint ingest keyed the span with: ${callerName} → ${JSON.stringify(span)}`, () => {
        const resolved: DependencyDatabaseEndpoint | null =
          resolveDependencyDatabaseEndpoint(dependencyRowForSpan(attributes));
        expect(resolved?.endpoint ?? null).toBe(ingestEndpoint(attributes));
      });
    }
  }

  test("a Kubernetes short name is the caller's own Service, qualified with its cluster", () => {
    const shop: DependencyDatabaseEndpoint | null =
      resolveDependencyDatabaseEndpoint(
        dependencyRowForSpan({
          "db.system.name": "postgresql",
          "server.address": "postgres",
          ...CALLERS["podProd"],
        }),
      );
    const billing: DependencyDatabaseEndpoint | null =
      resolveDependencyDatabaseEndpoint(
        dependencyRowForSpan({
          "db.system.name": "postgresql",
          "server.address": "postgres",
          ...CALLERS["podOtherNamespace"],
        }),
      );
    expect(shop).toEqual({
      endpoint: "postgres.shop.svc.cluster.local:5432@prod-eu",
      port: null,
    });
    expect(billing?.endpoint).toBe(
      "postgres.billing.svc.cluster.local:5432@prod-eu",
    );
  });

  test("the port the calls named: the port attribute, else the address's, else none", () => {
    const resolve: (span: StoredAttributes) => number | null | undefined = (
      span: StoredAttributes,
    ): number | null | undefined => {
      return resolveDependencyDatabaseEndpoint(dependencyRowForSpan(span))
        ?.port;
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
      resolveDependencyDatabaseEndpoint(
        row({
          dbSystem: "postgresql",
          dbServerAddress: "db.example.com",
          serverPort: 6432,
        }),
      ),
    ).toEqual({ endpoint: "db.example.com:6432", port: 6432 });
  });

  test("a SQL Server named instance reached without a port is that instance, never port 1433", () => {
    expect(
      resolveDependencyDatabaseEndpoint(
        dependencyRowForSpan({
          "db.system.name": "microsoft.sql_server",
          "server.address": "sql1.corp.example.com",
          "db.mssql.instance_name": "INST01",
        }),
      ),
    ).toEqual({ endpoint: "sql1.corp.example.com\\inst01", port: null });
  });

  test("names no server for a call that has none", () => {
    for (const overrides of [
      { dbSystem: "postgresql", dbServerAddress: "localhost:5432" },
      { dbSystem: "redis", dbServerAddress: "host.docker.internal" },
      { dbSystem: "postgresql", dbServerAddress: "[REDACTED]" },
      { dbSystem: "postgresql", dbServerAddress: "" },
      { dbSystem: "", dbServerAddress: "db.example.com" },
      { serverAddress: "db.example.com" },
    ] as Array<Partial<ClientSpanDependencyRow>>) {
      expect(resolveDependencyDatabaseEndpoint(row(overrides))).toBeNull();
    }
    expect(
      resolveDependencyDatabaseEndpoint(
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
        dbServerAddress: "postgres.data",
        serverPort: "5432",
        callerNamespace: "shop",
        callerCluster: "Prod-EU",
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

    // The same calls without the database columns: the same node.
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
  });

  test("a call whose server cannot be named carries no description of one", () => {
    const target: DependencyTarget | null = resolveClientSpanTarget(
      row({
        dbSystem: "redis",
        serverAddress: "host.docker.internal:6379",
        dbServerAddress: "host.docker.internal:6379",
      }),
      KNOWN,
    );
    expect(target).toEqual({
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
      const target: DependencyTarget | null = resolveClientSpanTarget(
        row({ ...overrides, serverPort: "5432", dbServerAddress: "x.example" }),
        KNOWN,
      );
      expect(target?.kind).toBe("dependency");
      if (target?.kind === "dependency") {
        const attributes: Record<string, string> =
          target.entity.descriptiveAttributes;
        expect(DATABASE_ENDPOINT_DESCRIPTIVE_ATTRIBUTE in attributes).toBe(
          false,
        );
        expect(DATABASE_PORT_DESCRIPTIVE_ATTRIBUTE in attributes).toBe(false);
      }
    }
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
