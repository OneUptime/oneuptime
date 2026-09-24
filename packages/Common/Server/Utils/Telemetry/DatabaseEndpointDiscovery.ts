import { SpanKind } from "../../../Models/AnalyticsModels/Span";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import {
  DatabaseCallerContext,
  DatabaseEndpoint,
  DatabaseEndpointScope,
  canonicalizeDatabaseEndpoint,
  formatDatabaseEndpoint,
  getDatabaseEndpointScope,
  isIpLiteralHost,
} from "../../../Types/DatabaseServer/DatabaseEndpoint";
import {
  isAutoCreatableDatabaseSystem,
  normalizeDatabaseSystem,
} from "../../../Types/DatabaseServer/DatabaseSystem";
import {
  DATABASE_ADDRESS_ATTRIBUTES,
  DATABASE_PORT_ATTRIBUTES,
  DATABASE_SYSTEM_ATTRIBUTES,
} from "../../../Types/DatabaseServer/DatabaseTelemetryResolver";
import { QUERY_SETTINGS, escapeSql } from "./ServiceDependencyDiscovery";

/*
 * Database endpoint discovery from CLIENT spans — the pure half of the
 * client-spans step of "TelemetryEntity:ComputeServiceDependencies".
 *
 * Ingest already stamps every DB CLIENT span with the entity key of the
 * database endpoint it calls (resolveDatabaseCallTarget, per row). This step
 * turns the same evidence into DatabaseServer rows: one grouped query over
 * the window, then the SAME canonicalization ingest ran, so the endpoint a
 * row is found or created under is byte-for-byte the endpoint whose key the
 * spans carry.
 *
 * The query selects the system / address / port with the precedence the
 * ingest resolver uses (first attribute that is present and not '', stable
 * semconv names first). The caller's Kubernetes namespace and cluster only
 * change the canonical endpoint for some addresses, so the query keeps them
 * ONLY for those and groups on '' otherwise:
 *
 *   - namespace: dotless addresses (a single-label Service name expands to
 *     `<name>.<namespace>.svc.cluster.local`);
 *   - cluster:   dotless addresses (for the same reason), Kubernetes Service
 *     DNS (`.svc`, `.cluster.local`) and private IP addresses — the hosts
 *     every cluster has its own copy of.
 *
 * That is what keeps the grouping bounded: a thousand pods calling
 * `orders.cjd8.eu-west-1.rds.amazonaws.com` are ONE group, not one per pod,
 * namespace or cluster. The address predicates are deliberately a superset
 * of the canonicalization rules (keeping context canonicalization ignores
 * costs a group, dropping context it needs would change the endpoint), and
 * the test suite proves the reduced context canonicalizes identically.
 *
 * Everything here is synchronous and side-effect free apart from reading one
 * environment variable, so it can be tested without ClickHouse or Postgres.
 */

// Unique marker comment, so the query can be told apart in logs and tests.
export const DATABASE_ENDPOINT_SQL_MARKER: string =
  "oneuptime:database-endpoint-discovery";

// Stored span rows carry resource attributes under a `resource.` prefix.
export const CALLER_NAMESPACE_ATTRIBUTE: string = "resource.k8s.namespace.name";
export const CALLER_CLUSTER_ATTRIBUTE: string = "resource.k8s.cluster.name";

export const DATABASE_SERVER_MIN_CALLS_ENV: string =
  "DATABASE_SERVER_MIN_CALLS";
export const DEFAULT_DATABASE_SERVER_MIN_CALLS: number = 10;

/*
 * Private IPv4 ranges (RFC 1918 and CGNAT 100.64/10, leading zeros
 * tolerated), IPv6 unique-local addresses (fc00::/7) and IPv4-mapped IPv6,
 * at the start of the address or after a URL / userinfo / SQL Server
 * `tcp:` / IPv6 bracket boundary. Matched against the LOWERCASED address.
 * Written in the regex subset RE2 (ClickHouse `match`) and JavaScript agree
 * on, so the tests can run the exact pattern the query runs.
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
  "|f[cd][0-9a-f]{0,2}:",
  "|[0:]*:ffff:",
  ")",
].join("");

const SPAN_TABLE: string = `oneuptime.${AnalyticsTableName.Span}`;

export interface DatabaseEndpointQueryWindow {
  projectId: string;
  // ClickHouse DateTime64 expressions, e.g. toDateTime64('...', 9).
  startSql: string;
  endSql: string;
  // Cap on the grouped rows returned per run.
  maxRows: number;
}

/*
 * ClickHouse serializes UInt64 aggregates as JSON strings, so callCount can
 * arrive as a string and is Number()-coerced.
 */
export interface DatabaseEndpointRow {
  dbSystem?: string | undefined;
  serverAddress?: string | undefined;
  serverPort?: string | number | undefined;
  callerNamespace?: string | undefined;
  callerCluster?: string | undefined;
  callCount?: string | number | undefined;
}

export interface DiscoveredDatabaseEndpoint {
  system: string;
  endpoint: DatabaseEndpoint;
  scope: DatabaseEndpointScope;
  // Calls to this endpoint in the window, across every row that resolved to it.
  callCount: number;
}

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
 * Which parts of the caller's context can change the canonical endpoint of
 * this address. The TypeScript twin of the two `if(...)` columns in
 * buildDatabaseEndpointSql — keep them in step.
 */
export function getDatabaseEndpointCallerContextNeeds(address: string): {
  namespace: boolean;
  cluster: boolean;
} {
  const value: string = typeof address === "string" ? address : "";
  const lower: string = value.toLowerCase();
  const dotless: boolean = !value.includes(".");

  return {
    namespace: dotless,
    cluster:
      dotless ||
      lower.includes(".svc") ||
      lower.includes(".cluster.local") ||
      new RegExp(PRIVATE_IP_ADDRESS_PATTERN).test(lower),
  };
}

/**
 * One row per (system, address, port, caller context that matters) with its
 * call count, over the CLIENT spans of the window that name a database
 * system. Ordered by calls so the busiest endpoints survive the row cap.
 */
export function buildDatabaseEndpointSql(
  window: DatabaseEndpointQueryWindow,
): string {
  const maxRows: number =
    Number.isFinite(window.maxRows) && window.maxRows > 0
      ? Math.floor(window.maxRows)
      : 1;

  return `
    /* ${DATABASE_ENDPOINT_SQL_MARKER} */
    SELECT
      ${firstNonEmptyAttributeSql(DATABASE_SYSTEM_ATTRIBUTES)} AS dbSystem,
      ${firstNonEmptyAttributeSql(DATABASE_ADDRESS_ATTRIBUTES)} AS serverAddress,
      ${firstNonEmptyAttributeSql(DATABASE_PORT_ATTRIBUTES)} AS serverPort,
      if(
        position(serverAddress, '.') = 0,
        attributes['${escapeSql(CALLER_NAMESPACE_ATTRIBUTE)}'],
        ''
      ) AS callerNamespace,
      if(
        position(serverAddress, '.') = 0
          OR position(lower(serverAddress), '.svc') > 0
          OR position(lower(serverAddress), '.cluster.local') > 0
          OR match(lower(serverAddress), '${escapeSql(PRIVATE_IP_ADDRESS_PATTERN)}'),
        attributes['${escapeSql(CALLER_CLUSTER_ATTRIBUTE)}'],
        ''
      ) AS callerCluster,
      count() AS callCount
    FROM ${SPAN_TABLE}
    WHERE projectId = '${escapeSql(window.projectId)}'
      AND startTime >= ${window.startSql}
      AND startTime < ${window.endSql}
      AND kind = '${SpanKind.Client}'
      AND dbSystem != ''
      AND serverAddress != ''
    GROUP BY dbSystem, serverAddress, serverPort, callerNamespace, callerCluster
    ORDER BY callCount DESC
    LIMIT ${maxRows}
    ${QUERY_SETTINGS}
  `;
}

function toCount(value: unknown): number {
  const parsed: number = Math.round(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function nonEmptyText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed: string = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

interface EndpointAccumulator {
  endpoint: DatabaseEndpoint;
  scope: DatabaseEndpointScope;
  callCount: number;
  callsBySystem: Map<string, number>;
}

/*
 * The engine an endpoint is recorded under when rows disagree (a CockroachDB
 * reached by some clients as "postgresql", say): an engine that may create a
 * row first, then the most calls, then the name, so the answer is stable.
 */
function pickSystem(callsBySystem: Map<string, number>): string {
  let best: string = "";
  let bestCreatable: boolean = false;
  let bestCalls: number = -1;

  for (const [system, calls] of callsBySystem) {
    const creatable: boolean = isAutoCreatableDatabaseSystem(system);
    const better: boolean =
      best === "" ||
      (creatable && !bestCreatable) ||
      (creatable === bestCreatable &&
        (calls > bestCalls || (calls === bestCalls && system < best)));
    if (better) {
      best = system;
      bestCreatable = creatable;
      bestCalls = calls;
    }
  }

  return best;
}

/**
 * Query rows → the unique database endpoints they name. Each row goes
 * through canonicalizeDatabaseEndpoint (purpose "client-call") with the
 * caller context the row kept, exactly as ingest canonicalized the span:
 * loopback / host-relative / unparseable addresses resolve to nothing, and
 * rows that land on the same formatted endpoint are merged with their calls
 * summed. Busiest first.
 */
export function resolveDatabaseEndpointRows(
  rows: Array<DatabaseEndpointRow>,
): Array<DiscoveredDatabaseEndpoint> {
  const byEndpoint: Map<string, EndpointAccumulator> = new Map<
    string,
    EndpointAccumulator
  >();

  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== "object") {
      continue;
    }

    const system: string | null = normalizeDatabaseSystem(row.dbSystem);
    const address: string | null = nonEmptyText(row.serverAddress);
    if (!system || !address) {
      continue;
    }

    const caller: DatabaseCallerContext = {
      kubernetesNamespace: nonEmptyText(row.callerNamespace),
      kubernetesClusterName: nonEmptyText(row.callerCluster),
      hostName: null,
      // Only the collector purpose reads these; a client call never does.
      isEphemeral: true,
    };

    const port: string | number | undefined =
      typeof row.serverPort === "number" ||
      (typeof row.serverPort === "string" && row.serverPort !== "")
        ? row.serverPort
        : undefined;

    const endpoint: DatabaseEndpoint | null = canonicalizeDatabaseEndpoint({
      system: system,
      address: address,
      port: port,
      caller: caller,
      purpose: "client-call",
    });

    if (!endpoint) {
      continue;
    }

    const key: string = formatDatabaseEndpoint(endpoint);
    const calls: number = toCount(row.callCount);

    let accumulator: EndpointAccumulator | undefined = byEndpoint.get(key);
    if (!accumulator) {
      accumulator = {
        endpoint: endpoint,
        scope: getDatabaseEndpointScope(endpoint),
        callCount: 0,
        callsBySystem: new Map<string, number>(),
      };
      byEndpoint.set(key, accumulator);
    }

    accumulator.callCount += calls;
    accumulator.callsBySystem.set(
      system,
      (accumulator.callsBySystem.get(system) || 0) + calls,
    );
  }

  const discovered: Array<{ key: string; value: DiscoveredDatabaseEndpoint }> =
    [];

  for (const [key, accumulator] of byEndpoint) {
    discovered.push({
      key: key,
      value: {
        system: pickSystem(accumulator.callsBySystem),
        endpoint: accumulator.endpoint,
        scope: accumulator.scope,
        callCount: accumulator.callCount,
      },
    });
  }

  discovered.sort(
    (
      a: { key: string; value: DiscoveredDatabaseEndpoint },
      b: { key: string; value: DiscoveredDatabaseEndpoint },
    ): number => {
      if (a.value.callCount !== b.value.callCount) {
        return b.value.callCount - a.value.callCount;
      }
      if (a.key < b.key) {
        return -1;
      }
      return a.key > b.key ? 1 : 0;
    },
  );

  return discovered.map(
    (entry: {
      key: string;
      value: DiscoveredDatabaseEndpoint;
    }): DiscoveredDatabaseEndpoint => {
      return entry.value;
    },
  );
}

/*
 * Calls an endpoint needs inside one window before client spans may create a
 * row for it on their own (env DATABASE_SERVER_MIN_CALLS, default 10, at
 * least 1). One stray connection string in a trace is not a database worth
 * listing; an existing row is matched and sighted whatever the count.
 */
export function getDatabaseServerMinCalls(): number {
  const raw: string | undefined = process.env[DATABASE_SERVER_MIN_CALLS_ENV];

  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_DATABASE_SERVER_MIN_CALLS;
  }

  const parsed: number = Number(raw.trim());

  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return DEFAULT_DATABASE_SERVER_MIN_CALLS;
  }

  return Math.max(parsed, 1);
}

/**
 * The conservative create policy for client-span discovery, minus the
 * project budget (which needs the database): a GLOBAL-scope endpoint (never
 * a single-label name or an unqualified cluster-local / private address),
 * named by host rather than a bare IP (an IP says nothing stable about which
 * server it is), of a known engine that is not a cloud-API or in-process
 * database, and called at least `minCalls` times in the window.
 */
export function isDatabaseEndpointAutoCreateCandidate(data: {
  discovered: DiscoveredDatabaseEndpoint;
  minCalls: number;
}): boolean {
  const discovered: DiscoveredDatabaseEndpoint = data.discovered;

  return (
    discovered.scope === "global" &&
    !isIpLiteralHost(discovered.endpoint.host) &&
    isAutoCreatableDatabaseSystem(discovered.system) &&
    discovered.callCount >= data.minCalls
  );
}
