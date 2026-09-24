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
 *
 * A database call also keeps what the ingest resolver
 * (resolveDatabaseCallTarget) reads to find the database SERVER it called —
 * the address, port and SQL Server instance with the resolver's precedence,
 * and the caller's Kubernetes namespace and cluster — so its node can say
 * which server that is (see resolveDependencyDatabaseEndpoint). They are ''
 * for every other span, and none of them is part of a node's identity.
 * They split a database's rows only by what tells servers apart: its
 * address spellings, ports and instances, and the placements (namespace,
 * cluster) of the service calling it — never its pods.
 */
export function buildClientSpanDependencySql(
  window: DependencyQueryWindow,
): string {
  const databaseOnly: (sql: string) => string = (sql: string): string => {
    return `if(dbSystem != '', ${sql}, '')`;
  };

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
      ${databaseOnly(firstNonEmptyAttributeSql(DATABASE_ADDRESS_ATTRIBUTES))} AS dbServerAddress,
      ${databaseOnly(firstNonEmptyAttributeSql(DATABASE_PORT_ATTRIBUTES))} AS serverPort,
      ${databaseOnly(databaseInstanceSql())} AS dbInstance,
      ${databaseOnly(`attributes['${escapeSql(CALLER_NAMESPACE_ATTRIBUTE)}']`)} AS callerNamespace,
      ${databaseOnly(`attributes['${escapeSql(CALLER_CLUSTER_ATTRIBUTE)}']`)} AS callerCluster,
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
    GROUP BY callerServiceId, dbSystem, dbNamespace, messagingSystem, peerService, rpcSystem, rpcService, serverAddress, isHttp, dbServerAddress, serverPort, dbInstance, callerNamespace, callerCluster
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
  /*
   * Database calls only ('' otherwise): what resolveDatabaseCallTarget
   * reads — the address and port with its precedence, the SQL Server
   * instance and the caller's Kubernetes namespace and cluster.
   */
  dbServerAddress?: string | undefined;
  serverPort?: string | number | undefined;
  dbInstance?: string | undefined;
  callerNamespace?: string | undefined;
  callerCluster?: string | undefined;
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
 * '' means the node's calls reached more than one server (see
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

/**
 * The database server a client-span dependency row called — exactly the
 * endpoint ingest keyed its spans with: the row's database columns go
 * through resolveDatabaseCallTarget, the ingest resolver itself, with the
 * caller's namespace and cluster the row kept, as DatabaseEndpointDiscovery
 * does. Null when the row names none: not a database call, or a loopback,
 * host-relative or unreadable address.
 */
export function resolveDependencyDatabaseEndpoint(
  row: ClientSpanDependencyRow,
): DependencyDatabaseEndpoint | null {
  if (!row || typeof row !== "object") {
    return null;
  }

  const attributes: Record<string, unknown> = {
    [DATABASE_SYSTEM_ATTRIBUTES[0]!]: row.dbSystem,
    [DATABASE_ADDRESS_ATTRIBUTES[0]!]: row.dbServerAddress,
    [DATABASE_PORT_ATTRIBUTES[0]!]: row.serverPort,
    [DATABASE_INSTANCE_NAME_ATTRIBUTE]: row.dbInstance,
  };

  const caller: DatabaseCallerContext = {
    kubernetesNamespace: nonEmpty(row.callerNamespace),
    kubernetesClusterName: nonEmpty(row.callerCluster),
    hostName: null,
    // Only the collector purpose reads it; a client call never does.
    isEphemeral: true,
  };

  const target: {
    system: string;
    endpoint: DatabaseEndpoint;
    scope: DatabaseEndpointScope;
  } | null = resolveDatabaseCallTarget({
    getAttribute: (key: string): unknown => {
      return attributes[key];
    },
    caller: caller,
  });

  if (!target) {
    return null;
  }

  // Named exactly as the resolver reads it: the port attribute, else the address's.
  const address: ParsedHostAndPort | null = parseHostAndPort(
    row.dbServerAddress,
  );

  return {
    endpoint: formatDatabaseEndpoint(target.endpoint),
    port: readPort(row.serverPort) ?? address?.port ?? null,
  };
}

interface DatabaseServerDescription {
  endpoint: string;
  port: string | null;
}

function readDatabaseServerDescription(
  attributes: Record<string, string>,
): DatabaseServerDescription | null {
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

  const first: DatabaseServerDescription | null =
    readDatabaseServerDescription(before);
  const second: DatabaseServerDescription | null =
    readDatabaseServerDescription(after);

  let server: DatabaseServerDescription | null = first || second;
  if (first && second) {
    server = {
      endpoint: first.endpoint === second.endpoint ? first.endpoint : "",
      port: first.port === second.port ? first.port : "",
    };
  }

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
    const server: DependencyDatabaseEndpoint | null =
      resolveDependencyDatabaseEndpoint(row);
    if (server) {
      descriptiveAttributes[DATABASE_ENDPOINT_DESCRIPTIVE_ATTRIBUTE] =
        server.endpoint;
      if (server.port !== null) {
        descriptiveAttributes[DATABASE_PORT_DESCRIPTIVE_ATTRIBUTE] = String(
          server.port,
        );
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
