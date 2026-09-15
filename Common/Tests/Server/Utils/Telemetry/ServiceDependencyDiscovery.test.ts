import { describe, expect, test } from "@jest/globals";
import {
  ClientSpanDependencyRow,
  DependencyEdgeCollector,
  DependencyQueryWindow,
  DependencyTarget,
  PARENT_LOOKBACK_MINUTES,
  SERVICE_GRAPH_REQUEST_FAILED_METRIC,
  SERVICE_GRAPH_REQUEST_TOTAL_METRIC,
  buildClientSpanDependencySql,
  buildServiceGraphMetricSql,
  buildTraceLinkedDependencySql,
  escapeSql,
  isUuid,
  mergeDependencySources,
  resolveClientSpanTarget,
  resolveServiceGraphPeer,
  serviceNameCandidatesForHost,
  toEdgeMetrics,
  toExtractedDependencyEntity,
} from "../../../../Server/Utils/Telemetry/ServiceDependencyDiscovery";
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
