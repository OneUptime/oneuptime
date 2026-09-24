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
import {
  DATABASE_INSTANCE_NAME_ATTRIBUTE,
  DATABASE_NAMESPACE_ATTRIBUTE,
  DatabaseCallerContext,
  DatabaseEndpoint,
  DatabaseEndpointScope,
  NETWORK_SCOPED_NAME_SUFFIXES,
  formatDatabaseEndpoint,
  parseHostAndPort,
  ParsedHostAndPort,
} from "../../../Types/DatabaseServer/DatabaseEndpoint";
import {
  DATABASE_ADDRESS_ATTRIBUTES,
  DATABASE_PORT_ATTRIBUTES,
  DATABASE_SYSTEM_ATTRIBUTES,
  resolveDatabaseCallTarget,
} from "../../../Types/DatabaseServer/DatabaseTelemetryResolver";
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

/*
 * The SQL both span-table discovery queries read a database call with — the
 * dependency query below and DatabaseEndpointDiscovery's — kept here, the
 * lower of the two modules, so neither imports the other in a cycle.
 * DatabaseEndpointDiscovery re-exports them.
 */

// Stored span rows carry resource attributes under a `resource.` prefix.
export const CALLER_NAMESPACE_ATTRIBUTE: string = "resource.k8s.namespace.name";
export const CALLER_CLUSTER_ATTRIBUTE: string = "resource.k8s.cluster.name";

/**
 * `multiIf(attributes['a'] != '', attributes['a'], …, '')` — the first
 * attribute that is present and not the empty string, exactly the
 * `firstPresent` rule of the ingest resolver.
 */
export function firstNonEmptyAttributeSql(keys: ReadonlyArray<string>): string {
  const branches: Array<string> = keys.map((key: string): string => {
    const attribute: string = `attributes['${escapeSql(key)}']`;
    return `${attribute} != '', ${attribute}`;
  });
  return `multiIf(${[...branches, "''"].join(", ")})`;
}

/**
 * The SQL Server instance a span names beside its address, in SQL — the
 * twin of readDatabaseInstanceName without its engine check (the resolver
 * ignores the value for any other engine): `db.mssql.instance_name`, else
 * the part of `db.namespace` before its first "|", else ''.
 */
export function databaseInstanceSql(): string {
  const instanceName: string = `attributes['${escapeSql(
    DATABASE_INSTANCE_NAME_ATTRIBUTE,
  )}']`;
  const namespace: string = `attributes['${escapeSql(
    DATABASE_NAMESPACE_ATTRIBUTE,
  )}']`;
  return `multiIf(${instanceName} != '', ${instanceName}, position(${namespace}, '|') > 0, splitByChar('|', ${namespace})[1], '')`;
}

/*
 * Private IPv4 ranges (RFC 1918 and CGNAT 100.64/10, leading zeros
 * tolerated), IPv4 link-local 169.254/16, IPv6 unique-local (fc00::/7) and
 * link-local (fe80::/10) addresses and IPv4-mapped IPv6, at the start of the
 * address or after a URL / userinfo / SQL Server `tcp:` / IPv6 bracket
 * boundary. Matched against the LOWERCASED address. Written in the regex
 * subset RE2 (ClickHouse `match`) and JavaScript agree on, so the tests can
 * run the exact pattern the query runs.
 *
 * A superset on purpose: over-matching (a public IPv6 address with an
 * `fc..:` group, say) only keeps the caller's cluster in the grouping,
 * which the canonicalization then ignores.
 */
export const PRIVATE_IP_ADDRESS_PATTERN: string = [
  "(?:^|[/@:]|\\[)",
  "(?:",
  "0*10[.]",
  "|0*192[.]0*168[.]",
  "|0*172[.]0*(?:1[6-9]|2[0-9]|3[01])[.]",
  "|0*100[.]0*(?:6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])[.]",
  "|0*169[.]0*254[.]",
  "|f[cd][0-9a-f]{0,2}:",
  "|fe[89ab][0-9a-f]:",
  "|[0:]*:ffff:",
  ")",
].join("");

/*
 * A plain `host[:port]`: hostname labels and an optional numeric port,
 * nothing else. Only such an address is classified precisely; anything else
 * keeps the whole caller context. RE2 and JavaScript agree on it.
 */
export const PLAIN_HOST_ADDRESS_PATTERN: string =
  "^[a-z0-9_-]+(?:[.][a-z0-9_-]+)*(?::[0-9]*)?$";

// A label ending in `-<digits>`: a StatefulSet pod such as `mongo-0`.
export const ORDINAL_SUFFIX_PATTERN: string = "-[0-9]+$";

/*
 * "Not blank" exactly as JavaScript's String.prototype.trim sees it: any
 * character outside its whitespace set (ASCII whitespace, NBSP, the
 * Unicode space separators, the line / paragraph separators and the BOM).
 * RE2 syntax; the TypeScript side simply trims.
 */
export const NON_BLANK_TEXT_PATTERN: string =
  "[^\\t\\n\\v\\f\\r \\x{A0}\\x{1680}\\x{2000}-\\x{200A}\\x{2028}\\x{2029}\\x{202F}\\x{205F}\\x{3000}\\x{FEFF}]";

// The caller-context columns of a database call, as SQL expressions.
export interface DatabaseCallerContextSql {
  // The caller's Kubernetes namespace, or ''.
  callerNamespace: string;
  // 1 when the caller had a namespace, for the addresses that keep only that.
  callerInKubernetes: string;
  // The caller's Kubernetes cluster, or ''.
  callerCluster: string;
}

/**
 * The caller's Kubernetes context a database call keeps, over `addressSql`
 * — the raw address the call named, decided on lowercased — shared by both
 * span-table discovery queries. The context only changes the canonical
 * endpoint of some addresses, so each column keeps it ONLY for those and is
 * '' (or 0) otherwise — a thousand pods, namespaces or clusters calling one
 * `orders.cjd8.eu-west-1.rds.amazonaws.com` all keep the same nothing:
 *
 *   - anything that is not a plain `host[:port]` (a URL, a host list, JDBC
 *     properties, userinfo, a trailing dot, IPv6, `host\instance`, …) keeps
 *     the namespace AND the cluster: the host inside it could be anything;
 *   - a plain single-label host keeps both (it expands to
 *     `<name>.<namespace>.svc.cluster.local`);
 *   - a plain two-label host keeps the cluster and one flag, "the caller has
 *     a namespace", because from a pod `<service>.<namespace>` resolves
 *     through the cluster's DNS whichever namespace the pod is in — plus the
 *     namespace itself when the first label is a StatefulSet pod
 *     (`mongo-0.mongo-headless`, a member of the caller's own namespace);
 *   - Kubernetes Service DNS (a `svc` label), the private DNS zones
 *     (NETWORK_SCOPED_NAME_SUFFIXES) and private / link-local IPv4 keep the
 *     cluster — the hosts every cluster or network has its own copy of.
 *
 * The predicates are deliberately a superset of the canonicalization rules
 * (keeping context canonicalization ignores costs a group, dropping context
 * it needs would change the endpoint);
 * DatabaseEndpointDiscovery.getDatabaseEndpointCallerContextNeeds is their
 * TypeScript twin — keep them in step.
 */
export function databaseCallerContextSql(
  addressSql: string,
): DatabaseCallerContextSql {
  const address: string = `lower(${addressSql})`;
  const hostPart: string = `splitByChar(':', ${address})[1]`;
  const labels: string = `splitByChar('.', ${hostPart})`;
  const labelCount: string = `length(${labels})`;
  const plainAddress: string = `match(${address}, '${escapeSql(
    PLAIN_HOST_ADDRESS_PATTERN,
  )}')`;

  const namespaceAttribute: string = `attributes['${escapeSql(
    CALLER_NAMESPACE_ATTRIBUTE,
  )}']`;
  const clusterAttribute: string = `attributes['${escapeSql(
    CALLER_CLUSTER_ATTRIBUTE,
  )}']`;

  const networkScopedName: string = NETWORK_SCOPED_NAME_SUFFIXES.map(
    (suffix: string): string => {
      return `endsWith(${hostPart}, '${escapeSql(suffix)}')`;
    },
  ).join(" OR ");

  return {
    callerNamespace: `if(
        NOT ${plainAddress}
          OR ${labelCount} = 1
          OR (${labelCount} = 2 AND match(${labels}[1], '${escapeSql(
            ORDINAL_SUFFIX_PATTERN,
          )}')),
        ${namespaceAttribute},
        ''
      )`,
    callerInKubernetes: `if(
        ${plainAddress} AND ${labelCount} = 2,
        match(${namespaceAttribute}, '${escapeSql(NON_BLANK_TEXT_PATTERN)}'),
        0
      )`,
    callerCluster: `if(
        NOT ${plainAddress}
          OR ${labelCount} <= 2
          OR has(${labels}, 'svc')
          OR ${networkScopedName}
          OR match(${address}, '${escapeSql(PRIVATE_IP_ADDRESS_PATTERN)}'),
        ${clusterAttribute},
        ''
      )`,
  };
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

/*
 * Cap on the distinct database servers (dbTargets) one client-span
 * dependency row keeps. A row whose list is full may have been cut short,
 * so it never names one server (see describeDependencyDatabaseServer).
 */
export const MAX_DATABASE_TARGETS_PER_ROW: number = 16;

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
 * the URL, never to the URL itself. Rows are grouped on exactly the columns
 * a node is keyed by, so there is ONE row per (caller, node), and the row
 * cap is shared fairly between databases, HTTP APIs, brokers and RPC peers.
 *
 * A database call also keeps what the ingest resolver
 * (resolveDatabaseCallTarget) reads to find the database SERVER it called —
 * the address, port and SQL Server instance with the resolver's precedence,
 * and the caller's Kubernetes context where it can change the endpoint
 * (databaseCallerContextSql) — so its node can say which server that is
 * (see describeDependencyDatabaseServer). None of them is part of a node's
 * identity, so they are AGGREGATED, never grouped on: `dbTargets` lists the
 * distinct servers the row's calls named (at most
 * MAX_DATABASE_TARGETS_PER_ROW). A database reached from a hundred
 * namespaces, pods, IPs or ports is still one row.
 */
export function buildClientSpanDependencySql(
  window: DependencyQueryWindow,
): string {
  const databaseOnly: (sql: string, otherwise?: string) => string = (
    sql: string,
    otherwise: string = "''",
  ): string => {
    return `if(dbSystem != '', ${sql}, ${otherwise})`;
  };

  const callerContext: DatabaseCallerContextSql =
    databaseCallerContextSql("dbServerAddress");

  return `
    SELECT
      callerServiceId,
      dbSystem,
      dbNamespace,
      messagingSystem,
      peerService,
      rpcSystem,
      rpcService,
      serverAddress,
      isHttp,
      groupUniqArrayIf(${MAX_DATABASE_TARGETS_PER_ROW})([dbServerAddress, serverPort, dbInstance, callerNamespace, toString(callerInKubernetes), callerCluster], dbSystem != '') AS dbTargets,
      count() AS callCount,
      countIf(statusCode = 2) AS errorCount,
      avg(durationUnixNano) AS avgDurationNano
    FROM
    (
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
        ${databaseOnly(firstNonEmptyAttributeSql(DATABASE_ADDRESS_ATTRIBUTES))} AS dbServerAddress,
        ${databaseOnly(firstNonEmptyAttributeSql(DATABASE_PORT_ATTRIBUTES))} AS serverPort,
        ${databaseOnly(databaseInstanceSql())} AS dbInstance,
        ${databaseOnly(callerContext.callerNamespace)} AS callerNamespace,
        ${databaseOnly(callerContext.callerInKubernetes, "0")} AS callerInKubernetes,
        ${databaseOnly(callerContext.callerCluster)} AS callerCluster,
        statusCode,
        durationUnixNano
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

/*
 * One database server a row's calls named, positionally as the query
 * returns it: [address, port, SQL Server instance, caller namespace,
 * caller-in-Kubernetes flag ("1" / "0"), caller cluster] — see
 * readDependencyDatabaseTargets.
 */
export type DependencyDatabaseTargetColumns = Array<string>;

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
  /*
   * Database calls only (empty otherwise): the distinct servers the row's
   * calls named — what resolveDatabaseCallTarget reads, at most
   * MAX_DATABASE_TARGETS_PER_ROW of them.
   */
  dbTargets?: Array<DependencyDatabaseTargetColumns> | undefined;
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

/*
 * What a Database dependency node says about the database SERVER its calls
 * reached, for the Service Map's "Open database" link (ResolveTypedRowLink
 * prefers these): the canonical endpoint ingest keyed the calls with
 * (formatDatabaseEndpoint, `@cluster` included) and the port the calls
 * named. DESCRIPTIVE only — a node stays keyed by what its spans said
 * (engine, host, logical database), so these never change its identity.
 * '' means the node's calls reached more than one server, or more than
 * could be told apart (see describeDependencyDatabaseServer and
 * mergeDependencyEntityDescriptions).
 */
export const DATABASE_ENDPOINT_DESCRIPTIVE_ATTRIBUTE: string =
  "oneuptime.database.endpoint";
export const DATABASE_PORT_DESCRIPTIVE_ATTRIBUTE: string = "server.port";

const DIGITS_ONLY_REGEX: RegExp = /^\d+$/;

export interface DependencyDatabaseEndpoint {
  // The server the calls reached, formatted (formatDatabaseEndpoint).
  endpoint: string;
  // The port the calls named (the port attribute, else the address's); null for none.
  port: number | null;
}

/*
 * One database server a dependency row's calls named — an entry of its
 * `dbTargets`, read (readDependencyDatabaseTargets): exactly what
 * resolveDatabaseCallTarget reads beside the engine.
 */
export interface DependencyDatabaseTarget {
  // The address, with the resolver's precedence.
  address: string;
  // The port attribute, with the resolver's precedence; '' for none.
  port: string;
  // The SQL Server instance named beside the address; '' for none.
  instance: string;
  // The caller's placement, kept only where it can change the server.
  callerNamespace: string;
  callerInKubernetes: boolean;
  callerCluster: string;
}

/*
 * What a node (or one row of it) says about the server its calls reached:
 * the formatted endpoint and the port the calls named, as the descriptive
 * attributes carry them — null for no port, '' for "not one".
 */
export interface DependencyDatabaseServer {
  endpoint: string;
  port: string | null;
}

function readPort(value: unknown): number | null {
  const text: string =
    typeof value === "number"
      ? String(value)
      : typeof value === "string"
        ? value.trim()
        : "";
  if (!DIGITS_ONLY_REGEX.test(text)) {
    return null;
  }
  const port: number = Number(text);
  return port >= 1 && port <= 65535 ? port : null;
}

function readColumn(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function isFlagSet(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

/**
 * A row's `dbTargets`, read: every entry that is a list of columns, in the
 * query's column order, a missing or malformed column read as none. Empty
 * for a row that is not a database call, or that has no such column.
 */
export function readDependencyDatabaseTargets(
  row: ClientSpanDependencyRow,
): Array<DependencyDatabaseTarget> {
  const entries: unknown = row && typeof row === "object" ? row.dbTargets : [];
  if (!Array.isArray(entries)) {
    return [];
  }

  const targets: Array<DependencyDatabaseTarget> = [];
  for (const entry of entries) {
    if (!Array.isArray(entry)) {
      continue;
    }
    const columns: Array<unknown> = entry as Array<unknown>;
    targets.push({
      address: readColumn(columns[0]),
      port: readColumn(columns[1]),
      instance: readColumn(columns[2]),
      callerNamespace: readColumn(columns[3]),
      callerInKubernetes: isFlagSet(columns[4]),
      callerCluster: readColumn(columns[5]),
    });
  }
  return targets;
}

/**
 * The database server one target of a client-span dependency row named —
 * exactly the endpoint ingest keyed its spans with: the target goes through
 * resolveDatabaseCallTarget, the ingest resolver itself, with the caller
 * context the query kept (the flag included), as DatabaseEndpointDiscovery
 * does. Null when it names none: not a database call, or a loopback,
 * host-relative or unreadable address.
 */
export function resolveDependencyDatabaseEndpoint(data: {
  dbSystem: string | undefined;
  target: DependencyDatabaseTarget;
}): DependencyDatabaseEndpoint | null {
  if (!data || !data.target || typeof data.target !== "object") {
    return null;
  }

  const target: DependencyDatabaseTarget = data.target;

  const attributes: Record<string, unknown> = {
    [DATABASE_SYSTEM_ATTRIBUTES[0]!]: data.dbSystem,
    [DATABASE_ADDRESS_ATTRIBUTES[0]!]: target.address,
    [DATABASE_PORT_ATTRIBUTES[0]!]: target.port,
    [DATABASE_INSTANCE_NAME_ATTRIBUTE]: target.instance,
  };

  const caller: DatabaseCallerContext = {
    kubernetesNamespace: nonEmpty(target.callerNamespace),
    kubernetesClusterName: nonEmpty(target.callerCluster),
    hostName: null,
    // Only the collector purpose reads it; a client call never does.
    isEphemeral: true,
    runsInKubernetes: target.callerInKubernetes === true,
  };

  const resolved: {
    system: string;
    endpoint: DatabaseEndpoint;
    scope: DatabaseEndpointScope;
  } | null = resolveDatabaseCallTarget({
    getAttribute: (key: string): unknown => {
      return attributes[key];
    },
    caller: caller,
  });

  if (!resolved) {
    return null;
  }

  // Named exactly as the resolver reads it: the port attribute, else the address's.
  const address: ParsedHostAndPort | null = parseHostAndPort(target.address);

  return {
    endpoint: formatDatabaseEndpoint(resolved.endpoint),
    port: readPort(target.port) ?? address?.port ?? null,
  };
}

/*
 * Two descriptions of one node → one: the server is kept only while both
 * name the same endpoint (and the same port, "none" included); any
 * disagreement is '' — ambiguous — and stays so.
 */
function combineDatabaseServers(
  first: DependencyDatabaseServer | null,
  second: DependencyDatabaseServer | null,
): DependencyDatabaseServer | null {
  if (!first || !second) {
    return first || second;
  }
  return {
    endpoint: first.endpoint === second.endpoint ? first.endpoint : "",
    port: first.port === second.port ? first.port : "",
  };
}

/**
 * The database server a client-span dependency row's calls reached: each
 * of its targets resolved (resolveDependencyDatabaseEndpoint) and combined
 * like the sightings of a node (mergeDependencyEntityDescriptions) — a
 * target that names no server contradicts nothing, targets that disagree
 * leave '' (ambiguous). A row whose target list is full
 * (MAX_DATABASE_TARGETS_PER_ROW) may have been cut short, so it is
 * ambiguous whatever the targets it kept say. Null when the row names no
 * server at all.
 */
export function describeDependencyDatabaseServer(
  row: ClientSpanDependencyRow,
): DependencyDatabaseServer | null {
  if (!row || typeof row !== "object" || !nonEmpty(row.dbSystem)) {
    return null;
  }

  const targets: Array<DependencyDatabaseTarget> =
    readDependencyDatabaseTargets(row);
  if (targets.length === 0) {
    return null;
  }

  if (
    Array.isArray(row.dbTargets) &&
    row.dbTargets.length >= MAX_DATABASE_TARGETS_PER_ROW
  ) {
    return { endpoint: "", port: "" };
  }

  let server: DependencyDatabaseServer | null = null;
  for (const target of targets) {
    const resolved: DependencyDatabaseEndpoint | null =
      resolveDependencyDatabaseEndpoint({
        dbSystem: row.dbSystem,
        target: target,
      });
    if (resolved) {
      server = combineDatabaseServers(server, {
        endpoint: resolved.endpoint,
        port: resolved.port === null ? null : String(resolved.port),
      });
    }
  }
  return server;
}

function readDatabaseServerDescription(
  attributes: Record<string, string>,
): DependencyDatabaseServer | null {
  const endpoint: string | undefined =
    attributes[DATABASE_ENDPOINT_DESCRIPTIVE_ATTRIBUTE];
  if (typeof endpoint !== "string") {
    return null;
  }
  const port: string | undefined =
    attributes[DATABASE_PORT_DESCRIPTIVE_ATTRIBUTE];
  return { endpoint: endpoint, port: typeof port === "string" ? port : null };
}

/**
 * Two sightings of one dependency node in one run → one description. A
 * node is keyed by what its callers' spans said (engine, host, logical
 * database), so it can stand for more than one database server: two ports
 * on one host, or a short Kubernetes name (`postgres`) that is another
 * Service in each caller's namespace. The server is therefore described
 * only while every sighting that names one names the same endpoint (and
 * the same port, "none" included); sightings that disagree leave '' —
 * ambiguous — which also overwrites what an earlier run stamped, since
 * descriptive attributes merge key by key, last writer wins. The Service
 * Map then never opens one of several databases as if it were the only
 * one. A sighting that names no server (its address did not resolve)
 * contradicts nothing. Every other attribute: the later sighting wins.
 */
export function mergeDependencyEntityDescriptions(
  earlier: ExtractedEntity,
  later: ExtractedEntity,
): ExtractedEntity {
  const before: Record<string, string> = earlier.descriptiveAttributes || {};
  const after: Record<string, string> = later.descriptiveAttributes || {};

  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...before, ...after })) {
    if (
      key !== DATABASE_ENDPOINT_DESCRIPTIVE_ATTRIBUTE &&
      key !== DATABASE_PORT_DESCRIPTIVE_ATTRIBUTE
    ) {
      merged[key] = value;
    }
  }

  const server: DependencyDatabaseServer | null = combineDatabaseServers(
    readDatabaseServerDescription(before),
    readDatabaseServerDescription(after),
  );

  if (server) {
    merged[DATABASE_ENDPOINT_DESCRIPTIVE_ATTRIBUTE] = server.endpoint;
    if (server.port !== null) {
      merged[DATABASE_PORT_DESCRIPTIVE_ATTRIBUTE] = server.port;
    }
  }

  const result: ExtractedEntity = { ...later };
  if (Object.keys(merged).length > 0) {
    result.descriptiveAttributes = merged;
  } else {
    delete result.descriptiveAttributes;
  }
  return result;
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
    const descriptiveAttributes: Record<string, string> = {
      "db.system.name": canonicalizeEntityValue(dbSystem),
    };
    // Which server the calls reached: descriptive, never identifying.
    const server: DependencyDatabaseServer | null =
      describeDependencyDatabaseServer(row);
    if (server) {
      descriptiveAttributes[DATABASE_ENDPOINT_DESCRIPTIVE_ATTRIBUTE] =
        server.endpoint;
      if (server.port !== null) {
        descriptiveAttributes[DATABASE_PORT_DESCRIPTIVE_ATTRIBUTE] =
          server.port;
      }
    }
    return {
      kind: "dependency",
      entity: {
        entityType: EntityType.Database,
        identifyingAttributes,
        descriptiveAttributes,
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
