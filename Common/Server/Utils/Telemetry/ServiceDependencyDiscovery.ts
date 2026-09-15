import Dictionary from "../../../Types/Dictionary";
import { SpanKind } from "../../../Models/AnalyticsModels/Span";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import EntityRelationshipType from "../../../Types/Telemetry/EntityRelationshipType";
import EntityType from "../../../Types/Telemetry/EntityType";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import {
  EntityRelationshipEdge,
  EntityRelationshipMetrics,
} from "../../../Utils/Telemetry/EntityRelationship";
import {
  canonicalizeEntityValue,
  computeEntityKey,
} from "../../../Utils/Telemetry/EntityKey";
import {
  isLoopbackHost,
  normalizeHost,
} from "../../../Utils/Telemetry/NetworkHost";
import { ExtractedEntity } from "./TelemetryEntity";

export { isLoopbackHost, normalizeHost };

/*
 * Service dependency discovery — the pure half of the
 * "TelemetryEntity:ComputeServiceDependencies" cron.
 *
 * A service map needs an edge for every call one thing makes to another.
 * Pairing a caller's span with its callee's span is the precise way to get
 * one, but it only works when BOTH sides are instrumented AND trace context
 * crossed the wire between them. Real estates rarely look like that end to
 * end: databases and third-party APIs never report spans, browser apps call
 * backends that may not extract `traceparent`, and eBPF instrumentation sees
 * both ends of a call without being able to link them. A map built from
 * span pairs alone is therefore empty for most projects, which is what a
 * self-hosted OneUptime estate showed: eight services, not a single line
 * between them.
 *
 * So edges come from three sources, strongest first:
 *
 *   1. Trace-linked calls. A SERVER / CONSUMER span whose parent belongs to a
 *      different service — the precise, error-and-latency-carrying edge.
 *   2. Client spans nobody answered. A CLIENT / PRODUCER span with no
 *      client/server child is a call into something that did not report
 *      itself. Its semconv attributes say what that was (`db.system.name`,
 *      `peer.service`, `messaging.system`, `server.address`, `rpc.service`),
 *      which resolves either to a known service (an instrumented service that
 *      simply lost the trace context) or to a discovered Database /
 *      RemoteService dependency.
 *   3. Service graph metrics. eBPF instrumentation (OBI, shipped with the
 *      Kubernetes agent) emits `traces_service_graph_request_total{client,
 *      server}` for every connection it observes, without needing any
 *      propagation at all.
 *
 * Everything here is synchronous and side-effect free (SQL strings in, plain
 * rows out) so it can be tested without ClickHouse or Postgres.
 */

export const SERVICE_GRAPH_REQUEST_TOTAL_METRIC: string =
  "traces_service_graph_request_total";
export const SERVICE_GRAPH_REQUEST_FAILED_METRIC: string =
  "traces_service_graph_request_failed_total";

/*
 * A parent span starts before its child. A child at the very start of the
 * window can therefore have its parent just before it; look that far back on
 * the parent side so window boundaries do not drop edges.
 */
export const PARENT_LOOKBACK_MINUTES: number = 5;

export const QUERY_SETTINGS: string =
  "SETTINGS max_execution_time = 60, timeout_overflow_mode = 'break', max_memory_usage = 2000000000, max_bytes_before_external_group_by = 1000000000, max_bytes_before_external_sort = 1000000000";

const UUID_REGEX: RegExp =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const IPV4_REGEX: RegExp = /^\d{1,3}(\.\d{1,3}){3}$/;

export function isUuid(value: unknown): boolean {
  return typeof value === "string" && UUID_REGEX.test(value);
}

export function escapeSql(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export interface DependencyQueryWindow {
  projectId: string;
  /** ClickHouse DateTime64 expressions, e.g. toDateTime64('...', 9). */
  startSql: string;
  endSql: string;
  /** Cap on the entry spans considered per run (bounds memory). */
  maxEntrySpans: number;
  /** Cap on the grouped rows returned per run. */
  maxRows: number;
}

const SPAN_TABLE: string = `oneuptime.${AnalyticsTableName.Span}`;
const METRIC_TABLE: string = `oneuptime.${AnalyticsTableName.Metric}`;

const ENTRY_KINDS_SQL: string = `('${SpanKind.Server}', '${SpanKind.Consumer}')`;
const OUTBOUND_KINDS_SQL: string = `('${SpanKind.Client}', '${SpanKind.Producer}')`;
const CALL_KINDS_SQL: string = `('${SpanKind.Server}', '${SpanKind.Consumer}', '${SpanKind.Client}', '${SpanKind.Producer}')`;

function projectAndServiceFilter(window: DependencyQueryWindow): string {
  return `projectId = '${escapeSql(window.projectId)}'
        AND primaryEntityType = '${escapeSql(ServiceType.OpenTelemetry)}'`;
}

/**
 * Source 1: SERVER / CONSUMER spans whose parent span belongs to another
 * service. The entry spans are the small side (every other span kind —
 * above all the INTERNAL spans a busy service emits by the thousand — is
 * excluded up front), so the parent side is reduced to exactly the spans
 * those entries point at before the join, instead of joining two independent
 * samples of the whole window, which silently dropped most pairs on busy
 * projects. Metrics describe the callee: its status and duration are how the
 * call was answered.
 */
export function buildTraceLinkedDependencySql(
  window: DependencyQueryWindow,
): string {
  const entrySpans: string = `
      SELECT traceId, parentSpanId, primaryEntityId, statusCode, durationUnixNano
      FROM ${SPAN_TABLE}
      WHERE ${projectAndServiceFilter(window)}
        AND startTime >= ${window.startSql}
        AND startTime < ${window.endSql}
        AND kind IN ${ENTRY_KINDS_SQL}
        AND parentSpanId IS NOT NULL
        AND parentSpanId != ''
      LIMIT ${window.maxEntrySpans}`;

  return `
    SELECT
      caller.primaryEntityId AS callerServiceId,
      callee.primaryEntityId AS calleeServiceId,
      count() AS callCount,
      countIf(callee.statusCode = 2) AS errorCount,
      avg(callee.durationUnixNano) AS avgDurationNano
    FROM
    (
      SELECT traceId, spanId, primaryEntityId
      FROM ${SPAN_TABLE}
      WHERE ${projectAndServiceFilter(window)}
        AND startTime >= ${window.startSql} - INTERVAL ${PARENT_LOOKBACK_MINUTES} MINUTE
        AND startTime < ${window.endSql}
        AND (traceId, spanId) IN (
          SELECT traceId, parentSpanId FROM (${entrySpans})
        )
    ) AS caller
    INNER JOIN
    (${entrySpans}
    ) AS callee
    ON caller.traceId = callee.traceId AND caller.spanId = callee.parentSpanId
    WHERE caller.primaryEntityId != callee.primaryEntityId
    GROUP BY callerServiceId, calleeServiceId
    LIMIT ${window.maxRows}
    ${QUERY_SETTINGS}
  `;
}

/**
 * Source 2: CLIENT / PRODUCER spans with no client/server child — calls into
 * something that did not report a span of its own. Requiring the span to be
 * a leaf among call spans (not merely "no SERVER child") keeps a wrapper
 * CLIENT span around an inner, answered CLIENT span from also showing up as
 * a call into the unknown.
 *
 * The target is summarized in SQL to a handful of low-cardinality semconv
 * attributes (old and new names both) so the grouping stays bounded: the
 * address of an HTTP call falls back from `server.address` to the host of
 * the URL, never to the URL itself.
 */
export function buildClientSpanDependencySql(
  window: DependencyQueryWindow,
): string {
  return `
    SELECT
      primaryEntityId AS callerServiceId,
      multiIf(attributes['db.system.name'] != '', attributes['db.system.name'], attributes['db.system']) AS dbSystem,
      multiIf(attributes['db.namespace'] != '', attributes['db.namespace'], attributes['db.name']) AS dbNamespace,
      attributes['messaging.system'] AS messagingSystem,
      attributes['peer.service'] AS peerService,
      attributes['rpc.system'] AS rpcSystem,
      attributes['rpc.service'] AS rpcService,
      multiIf(
        attributes['server.address'] != '', attributes['server.address'],
        attributes['net.peer.name'] != '', attributes['net.peer.name'],
        attributes['http.host'] != '', attributes['http.host'],
        attributes['url.full'] != '', domain(attributes['url.full']),
        attributes['http.url'] != '', domain(attributes['http.url']),
        ''
      ) AS serverAddress,
      if(attributes['http.request.method'] != '' OR attributes['http.method'] != '', 1, 0) AS isHttp,
      count() AS callCount,
      countIf(statusCode = 2) AS errorCount,
      avg(durationUnixNano) AS avgDurationNano
    FROM ${SPAN_TABLE}
    WHERE ${projectAndServiceFilter(window)}
      AND startTime >= ${window.startSql}
      AND startTime < ${window.endSql}
      AND kind IN ${OUTBOUND_KINDS_SQL}
      AND (traceId, spanId) NOT IN (
        SELECT traceId, parentSpanId
        FROM ${SPAN_TABLE}
        WHERE projectId = '${escapeSql(window.projectId)}'
          AND startTime >= ${window.startSql}
          AND startTime < ${window.endSql} + INTERVAL ${PARENT_LOOKBACK_MINUTES} MINUTE
          AND kind IN ${CALL_KINDS_SQL}
          AND parentSpanId IS NOT NULL
          AND parentSpanId != ''
        LIMIT ${window.maxEntrySpans}
      )
    GROUP BY callerServiceId, dbSystem, dbNamespace, messagingSystem, peerService, rpcSystem, rpcService, serverAddress, isHttp
    ORDER BY callCount DESC
    LIMIT ${window.maxRows}
    ${QUERY_SETTINGS}
  `;
}

/**
 * Source 3: eBPF service graph counters. Counters are usually cumulative, so
 * each series (one attribute set) contributes the increase it shows inside
 * the window rather than the sum of its running totals; delta series
 * contribute their sum. A series with a single point contributes 0 calls but
 * still proves the edge exists.
 */
export function buildServiceGraphMetricSql(data: {
  projectId: string;
  startSql: string;
  endSql: string;
  maxRows: number;
}): string {
  return `
    SELECT
      client,
      server,
      clientNamespace,
      serverNamespace,
      sumIf(increase, metricName = '${SERVICE_GRAPH_REQUEST_TOTAL_METRIC}') AS requestCount,
      sumIf(increase, metricName = '${SERVICE_GRAPH_REQUEST_FAILED_METRIC}') AS failedCount
    FROM
    (
      SELECT
        name AS metricName,
        attributes['client'] AS client,
        attributes['server'] AS server,
        attributes['client_service_namespace'] AS clientNamespace,
        attributes['server_service_namespace'] AS serverNamespace,
        cityHash64(mapKeys(attributes), mapValues(attributes)) AS seriesId,
        if(
          anyLast(aggregationTemporality) = 'Delta',
          sum(value),
          greatest(max(value) - min(value), 0)
        ) AS increase
      FROM ${METRIC_TABLE}
      WHERE projectId = '${escapeSql(data.projectId)}'
        AND name IN ('${SERVICE_GRAPH_REQUEST_TOTAL_METRIC}', '${SERVICE_GRAPH_REQUEST_FAILED_METRIC}')
        AND time >= ${data.startSql}
        AND time < ${data.endSql}
        AND attributes['client'] != ''
        AND attributes['server'] != ''
      GROUP BY metricName, client, server, clientNamespace, serverNamespace, seriesId
    )
    GROUP BY client, server, clientNamespace, serverNamespace
    LIMIT ${data.maxRows}
    ${QUERY_SETTINGS}
  `;
}

/*
 * ClickHouse serializes UInt64 / Float64 aggregates as JSON strings, so the
 * numeric fields below can arrive as strings and are Number()-coerced.
 */
export interface TraceLinkedDependencyRow {
  callerServiceId: string;
  calleeServiceId: string;
  callCount: string | number;
  errorCount: string | number;
  avgDurationNano: string | number;
}

export interface ClientSpanDependencyRow {
  callerServiceId: string;
  dbSystem?: string | undefined;
  dbNamespace?: string | undefined;
  messagingSystem?: string | undefined;
  peerService?: string | undefined;
  rpcSystem?: string | undefined;
  rpcService?: string | undefined;
  serverAddress?: string | undefined;
  isHttp?: string | number | boolean | undefined;
  callCount: string | number;
  errorCount: string | number;
  avgDurationNano: string | number;
}

export interface ServiceGraphMetricRow {
  client: string;
  server: string;
  clientNamespace?: string | undefined;
  serverNamespace?: string | undefined;
  requestCount: string | number;
  failedCount: string | number;
}

/** Row metrics → edge metrics, with every malformed number coerced to 0. */
export function toEdgeMetrics(data: {
  callCount: string | number | undefined;
  errorCount: string | number | undefined;
  avgDurationNano?: string | number | undefined;
}): EntityRelationshipMetrics {
  const toCount: (value: string | number | undefined) => number = (
    value: string | number | undefined,
  ): number => {
    const parsed: number = Math.round(Number(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };
  const callCount: number = toCount(data.callCount);
  const avgDurationMs: number = Number(data.avgDurationNano) / 1_000_000;
  return {
    callCount,
    // Errors can never exceed calls, whatever a producer reported.
    errorCount: Math.min(callCount, toCount(data.errorCount)),
    avgDurationMs:
      Number.isFinite(avgDurationMs) && avgDurationMs > 0
        ? Math.round(avgDurationMs)
        : 0,
  };
}

const CLUSTER_LOCAL_SUFFIXES: Array<string> = [
  ".svc.cluster.local",
  ".cluster.local",
  ".svc",
];

/**
 * The names under which a network host could refer to one of the project's
 * own services: the host itself, and — only for cluster-internal names —
 * its first label (`payments.prod.svc.cluster.local` → `payments`). A public
 * name never matches by label: `api.stripe.com` must not become a project
 * service that happens to be called `api`.
 */
export function serviceNameCandidatesForHost(host: string): Array<string> {
  const candidates: Array<string> = [host];
  const isSingleLabel: boolean = !host.includes(".");
  const clusterSuffix: string | undefined = CLUSTER_LOCAL_SUFFIXES.find(
    (suffix: string): boolean => {
      return host.endsWith(suffix);
    },
  );
  if (!isSingleLabel && clusterSuffix) {
    const firstLabel: string = host.split(".")[0] || "";
    if (firstLabel) {
      candidates.push(firstLabel);
    }
  }
  return candidates;
}

/** A dependency entity inferred from a client span or a service graph peer. */
export interface InferredDependencyEntity {
  entityType: EntityType.Database | EntityType.RemoteService;
  identifyingAttributes: Dictionary<string>;
  descriptiveAttributes: Record<string, string>;
}

export type DependencyTarget =
  | { kind: "service"; serviceName: string }
  | { kind: "dependency"; entity: InferredDependencyEntity };

function nonEmpty(value: string | undefined | null): string | null {
  const trimmed: string = (value || "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function matchKnownService(
  names: Array<string>,
  knownServiceNames: ReadonlySet<string>,
): string | null {
  for (const name of names) {
    const canonical: string = canonicalizeEntityValue(name);
    if (canonical && knownServiceNames.has(canonical)) {
      return canonical;
    }
  }
  return null;
}

/**
 * Decide what an unanswered client span called. `knownServiceNames` holds
 * the project's service names, canonicalized (trimmed, lowercase).
 *
 * Precedence follows how specific the evidence is: a database system is
 * unambiguous; `peer.service` is the caller telling us the callee's service
 * name; a messaging system names a broker; a network address is the weakest
 * signal and only maps to a service under the rules in
 * serviceNameCandidatesForHost.
 */
export function resolveClientSpanTarget(
  row: ClientSpanDependencyRow,
  knownServiceNames: ReadonlySet<string>,
): DependencyTarget | null {
  const host: string | null = normalizeHost(row.serverAddress);
  const usableHost: string | null = host && !isLoopbackHost(host) ? host : null;

  const dbSystem: string | null = nonEmpty(row.dbSystem);
  if (dbSystem) {
    const identifyingAttributes: Dictionary<string> = {
      "db.system.name": canonicalizeEntityValue(dbSystem),
    };
    const namespace: string | null = nonEmpty(row.dbNamespace);
    if (usableHost) {
      identifyingAttributes["server.address"] = usableHost;
    }
    if (namespace) {
      identifyingAttributes["db.namespace"] =
        canonicalizeEntityValue(namespace);
    }
    return {
      kind: "dependency",
      entity: {
        entityType: EntityType.Database,
        identifyingAttributes,
        descriptiveAttributes: {
          "db.system.name": canonicalizeEntityValue(dbSystem),
        },
      },
    };
  }

  const peerService: string | null = nonEmpty(row.peerService);
  if (peerService) {
    const known: string | null = matchKnownService(
      [peerService],
      knownServiceNames,
    );
    if (known) {
      return { kind: "service", serviceName: known };
    }
    return {
      kind: "dependency",
      entity: {
        entityType: EntityType.RemoteService,
        identifyingAttributes: {
          "peer.service": canonicalizeEntityValue(peerService),
        },
        descriptiveAttributes: protocolAttributes(row),
      },
    };
  }

  const messagingSystem: string | null = nonEmpty(row.messagingSystem);
  if (messagingSystem) {
    const identifyingAttributes: Dictionary<string> = {
      "messaging.system": canonicalizeEntityValue(messagingSystem),
    };
    if (usableHost) {
      identifyingAttributes["server.address"] = usableHost;
    }
    return {
      kind: "dependency",
      entity: {
        entityType: EntityType.RemoteService,
        identifyingAttributes,
        descriptiveAttributes: {
          "network.protocol.name": canonicalizeEntityValue(messagingSystem),
        },
      },
    };
  }

  if (usableHost) {
    const known: string | null = matchKnownService(
      serviceNameCandidatesForHost(usableHost),
      knownServiceNames,
    );
    if (known) {
      return { kind: "service", serviceName: known };
    }
    return {
      kind: "dependency",
      entity: {
        entityType: EntityType.RemoteService,
        identifyingAttributes: { "server.address": usableHost },
        descriptiveAttributes: protocolAttributes(row),
      },
    };
  }

  const rpcService: string | null = nonEmpty(row.rpcService);
  if (rpcService) {
    const known: string | null = matchKnownService(
      [rpcService, rpcService.split(".").pop() || ""],
      knownServiceNames,
    );
    if (known) {
      return { kind: "service", serviceName: known };
    }
    return {
      kind: "dependency",
      entity: {
        entityType: EntityType.RemoteService,
        identifyingAttributes: {
          "rpc.service": canonicalizeEntityValue(rpcService),
        },
        descriptiveAttributes: protocolAttributes(row),
      },
    };
  }

  return null;
}

function protocolAttributes(
  row: ClientSpanDependencyRow,
): Record<string, string> {
  const rpcSystem: string | null = nonEmpty(row.rpcSystem);
  if (rpcSystem) {
    return { "network.protocol.name": canonicalizeEntityValue(rpcSystem) };
  }
  if (row.isHttp === true || Number(row.isHttp) === 1) {
    return { "network.protocol.name": "http" };
  }
  return {};
}

/**
 * Resolve one side of a service graph metric. OBI reports the peer as a
 * service name when it can attribute the connection, and as an address when
 * it cannot.
 */
export function resolveServiceGraphPeer(
  name: string,
  knownServiceNames: ReadonlySet<string>,
): DependencyTarget | null {
  const trimmed: string | null = nonEmpty(name);
  if (!trimmed) {
    return null;
  }
  const known: string | null = matchKnownService([trimmed], knownServiceNames);
  if (known) {
    return { kind: "service", serviceName: known };
  }
  const host: string | null = normalizeHost(trimmed);
  if (!host || isLoopbackHost(host)) {
    return null;
  }
  const looksLikeAddress: boolean = IPV4_REGEX.test(host) || host.includes(":");
  return {
    kind: "dependency",
    entity: {
      entityType: EntityType.RemoteService,
      identifyingAttributes: looksLikeAddress
        ? { "server.address": host }
        : { "peer.service": canonicalizeEntityValue(trimmed) },
      descriptiveAttributes: {},
    },
  };
}

/** Registry entity for an inferred dependency, keyed like any other entity. */
export function toExtractedDependencyEntity(data: {
  projectId: string;
  entity: InferredDependencyEntity;
}): ExtractedEntity {
  return {
    entityType: data.entity.entityType,
    entityKey: computeEntityKey({
      projectId: data.projectId,
      entityType: data.entity.entityType,
      identifyingAttributes: data.entity.identifyingAttributes,
    }),
    identifyingAttributes: data.entity.identifyingAttributes,
    ...(Object.keys(data.entity.descriptiveAttributes).length > 0
      ? { descriptiveAttributes: data.entity.descriptiveAttributes }
      : {}),
  };
}

/**
 * Collects the edges one source produces, merging rows that fold into the
 * same (from, to) pair: counts add, latency combines call-count-weighted.
 */
export class DependencyEdgeCollector {
  private readonly edgeByKey: Map<string, EntityRelationshipEdge> = new Map<
    string,
    EntityRelationshipEdge
  >();

  public add(data: {
    fromEntityKey: string;
    toEntityKey: string;
    metrics: EntityRelationshipMetrics;
  }): void {
    if (
      !data.fromEntityKey ||
      !data.toEntityKey ||
      data.fromEntityKey === data.toEntityKey
    ) {
      return;
    }
    const key: string = `${data.fromEntityKey}|${data.toEntityKey}`;
    const existing: EntityRelationshipEdge | undefined =
      this.edgeByKey.get(key);
    if (!existing || !existing.metrics) {
      this.edgeByKey.set(key, {
        fromEntityKey: data.fromEntityKey,
        toEntityKey: data.toEntityKey,
        relationshipType: EntityRelationshipType.DependsOn,
        metrics: { ...data.metrics },
      });
      return;
    }
    const calls: number = existing.metrics.callCount + data.metrics.callCount;
    existing.metrics = {
      callCount: calls,
      errorCount: existing.metrics.errorCount + data.metrics.errorCount,
      avgDurationMs:
        calls > 0
          ? Math.round(
              (existing.metrics.avgDurationMs * existing.metrics.callCount +
                data.metrics.avgDurationMs * data.metrics.callCount) /
                calls,
            )
          : Math.max(
              existing.metrics.avgDurationMs,
              data.metrics.avgDurationMs,
            ),
    };
  }

  public edges(): Array<EntityRelationshipEdge> {
    return Array.from(this.edgeByKey.values());
  }
}

/**
 * Combine the sources. The same call can be seen by more than one of them —
 * an eBPF counter and a paired trace describe one request, not two — so
 * sources are never added together: for each edge the first source listed
 * that saw it wins, which puts the precise trace-linked metrics ahead of the
 * inferred ones.
 */
export function mergeDependencySources(
  sources: Array<Array<EntityRelationshipEdge>>,
): Array<EntityRelationshipEdge> {
  const merged: Map<string, EntityRelationshipEdge> = new Map<
    string,
    EntityRelationshipEdge
  >();
  for (const source of sources) {
    for (const edge of source) {
      const key: string = `${edge.fromEntityKey}|${edge.toEntityKey}`;
      if (!merged.has(key)) {
        merged.set(key, edge);
      }
    }
  }
  return Array.from(merged.values()).sort(
    (a: EntityRelationshipEdge, b: EntityRelationshipEdge): number => {
      return (
        a.fromEntityKey.localeCompare(b.fromEntityKey) ||
        a.toEntityKey.localeCompare(b.toEntityKey)
      );
    },
  );
}
