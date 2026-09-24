import { SpanKind } from "../../../Models/AnalyticsModels/Span";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import {
  DATABASE_INSTANCE_NAME_ATTRIBUTE,
  DATABASE_NAMESPACE_ATTRIBUTE,
  DatabaseCallerContext,
  DatabaseEndpoint,
  DatabaseEndpointScope,
  NETWORK_SCOPED_NAME_SUFFIXES,
  buildDatabaseServerDisplayName,
  formatDatabaseEndpoint,
  getDatabaseClusterHost,
  isIpLiteralHost,
} from "../../../Types/DatabaseServer/DatabaseEndpoint";
import { isAutoCreatableDatabaseSystem } from "../../../Types/DatabaseServer/DatabaseSystem";
import {
  DATABASE_ADDRESS_ATTRIBUTES,
  DATABASE_PORT_ATTRIBUTES,
  DATABASE_SYSTEM_ATTRIBUTES,
  resolveDatabaseCallTarget,
} from "../../../Types/DatabaseServer/DatabaseTelemetryResolver";
import { QUERY_SETTINGS, escapeSql } from "./ServiceDependencyDiscovery";

/*
 * Database endpoint discovery from CLIENT spans — the pure half of the
 * client-spans step of "TelemetryEntity:ComputeServiceDependencies".
 *
 * Ingest already stamps every DB CLIENT span with the entity key of the
 * database endpoint it calls (resolveDatabaseCallTarget, per row). This step
 * turns the same evidence into DatabaseServer rows: one grouped query over
 * the window, then the SAME resolver ingest ran (resolveDatabaseCallTarget,
 * fed the row's grouped attributes), so the endpoint a row is found or
 * created under is byte-for-byte the endpoint whose key the spans carry.
 *
 * The query selects the system / address / port / SQL Server instance with
 * the precedence the ingest resolver uses (first attribute that is present
 * and not '', stable semconv names first). The caller's Kubernetes context
 * only changes the canonical endpoint of some addresses, so the query keeps
 * it ONLY for those and groups on '' otherwise. It decides on the raw
 * address, lowercased:
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
 * That is what keeps the grouping bounded: a thousand pods calling
 * `orders.cjd8.eu-west-1.rds.amazonaws.com` are ONE group, not one per pod,
 * namespace or cluster. The predicates are deliberately a superset of the
 * canonicalization rules (keeping context canonicalization ignores costs a
 * group, dropping context it needs would change the endpoint);
 * getDatabaseEndpointCallerContextNeeds is their TypeScript twin, and the
 * test suite proves the reduced context canonicalizes identically — and,
 * against a real ClickHouse, that the SQL and the twin agree.
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

const PLAIN_HOST_ADDRESS_REGEX: RegExp = new RegExp(PLAIN_HOST_ADDRESS_PATTERN);
const PRIVATE_IP_ADDRESS_REGEX: RegExp = new RegExp(PRIVATE_IP_ADDRESS_PATTERN);
const UPPERCASE_ASCII_REGEX: RegExp = /[A-Z]+/g;

const SPAN_TABLE: string = `oneuptime.${AnalyticsTableName.Span}`;

// SQL over the lowercased raw address, shared by the grouping predicates.
const ADDRESS_SQL: string = "lower(serverAddress)";
const HOST_PART_SQL: string = `splitByChar(':', ${ADDRESS_SQL})[1]`;
const LABELS_SQL: string = `splitByChar('.', ${HOST_PART_SQL})`;
const LABEL_COUNT_SQL: string = `length(${LABELS_SQL})`;
const PLAIN_ADDRESS_SQL: string = `match(${ADDRESS_SQL}, '${escapeSql(
  PLAIN_HOST_ADDRESS_PATTERN,
)}')`;

/*
 * An IP-literal address (IPv4 host[:port], bare or bracketed IPv6). Only
 * orders the rows — IP groups never create a database (they can only match
 * one that owns them), so when the row cap bites, host-named groups win.
 */
const IP_LITERAL_ADDRESS_SQL: string = `(isIPv4String(${HOST_PART_SQL}) OR isIPv6String(${ADDRESS_SQL}) OR isIPv6String(extract(${ADDRESS_SQL}, '${escapeSql(
  "^\\[([^\\]]*)\\]",
)}')))`;

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
  // SQL Server instance named beside the address (see readDatabaseInstanceName).
  dbInstance?: string | undefined;
  callerNamespace?: string | undefined;
  // 1 when the caller had a namespace, for the addresses that keep only that.
  callerInKubernetes?: string | number | boolean | undefined;
  callerCluster?: string | undefined;
  callCount?: string | number | undefined;
}

export interface DiscoveredDatabaseEndpoint {
  system: string;
  endpoint: DatabaseEndpoint;
  scope: DatabaseEndpointScope;
  // Calls to this endpoint (and its siblings) in the window, across every row.
  callCount: number;
  /*
   * The other endpoints of the same logical database seen in the window —
   * the members of one managed cluster (getDatabaseClusterHost). They are
   * claimed as aliases of the row `endpoint` resolves to, never rows of
   * their own. Absent when there are none.
   */
  siblings?: Array<DatabaseEndpoint> | undefined;
  // The name a row created for a managed cluster gets (its cluster name).
  displayName?: string | undefined;
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

// Lowercase A-Z only, as ClickHouse `lower` does.
function asciiLowerCase(value: string): string {
  return value.replace(UPPERCASE_ASCII_REGEX, (match: string): string => {
    return match.toLowerCase();
  });
}

function hasOrdinalSuffix(label: string): boolean {
  const dash: number = label.lastIndexOf("-");
  if (dash < 0 || dash === label.length - 1) {
    return false;
  }
  for (let index: number = dash + 1; index < label.length; index++) {
    const code: number = label.charCodeAt(index);
    if (code < 48 || code > 57) {
      return false;
    }
  }
  return true;
}

/**
 * Which parts of the caller's context can change the canonical endpoint of
 * this raw address: its namespace, whether it runs in Kubernetes (the
 * `callerInKubernetes` flag — only for plain two-label hosts, where nothing
 * else of the namespace matters) and its cluster. The TypeScript twin of the
 * three caller columns of buildDatabaseEndpointSql — keep them in step.
 */
export function getDatabaseEndpointCallerContextNeeds(address: string): {
  namespace: boolean;
  kubernetes: boolean;
  cluster: boolean;
} {
  const value: string =
    typeof address === "string" ? asciiLowerCase(address) : "";

  if (!PLAIN_HOST_ADDRESS_REGEX.test(value)) {
    return { namespace: true, kubernetes: false, cluster: true };
  }

  const hostPart: string = value.split(":")[0]!;
  const labels: Array<string> = hostPart.split(".");

  let networkScopedName: boolean = false;
  for (const suffix of NETWORK_SCOPED_NAME_SUFFIXES) {
    if (hostPart.endsWith(suffix)) {
      networkScopedName = true;
    }
  }

  return {
    namespace:
      labels.length === 1 ||
      (labels.length === 2 && hasOrdinalSuffix(labels[0]!)),
    kubernetes: labels.length === 2,
    cluster:
      labels.length <= 2 ||
      labels.includes("svc") ||
      networkScopedName ||
      PRIVATE_IP_ADDRESS_REGEX.test(value),
  };
}

/**
 * One row per (system, address, port, instance, caller context that
 * matters) with its call count, over the CLIENT spans of the window that
 * name a database system and an address. Spans without those attributes are
 * dropped on `attributeKeys` (bloom-indexed, far smaller than the attribute
 * map) before the map is read. Ordered host-named groups first, then by
 * calls, so the endpoints that can create a database survive the row cap.
 */
export function buildDatabaseEndpointSql(
  window: DatabaseEndpointQueryWindow,
): string {
  const maxRows: number =
    Number.isFinite(window.maxRows) && window.maxRows > 0
      ? Math.floor(window.maxRows)
      : 1;

  const keyList: (keys: ReadonlyArray<string>) => string = (
    keys: ReadonlyArray<string>,
  ): string => {
    return `[${keys
      .map((key: string): string => {
        return `'${escapeSql(key)}'`;
      })
      .join(", ")}]`;
  };

  const namespaceAttribute: string = `attributes['${escapeSql(
    CALLER_NAMESPACE_ATTRIBUTE,
  )}']`;
  const clusterAttribute: string = `attributes['${escapeSql(
    CALLER_CLUSTER_ATTRIBUTE,
  )}']`;

  const networkScopedName: string = NETWORK_SCOPED_NAME_SUFFIXES.map(
    (suffix: string): string => {
      return `endsWith(${HOST_PART_SQL}, '${escapeSql(suffix)}')`;
    },
  ).join(" OR ");

  return `
    /* ${DATABASE_ENDPOINT_SQL_MARKER} */
    SELECT
      ${firstNonEmptyAttributeSql(DATABASE_SYSTEM_ATTRIBUTES)} AS dbSystem,
      ${firstNonEmptyAttributeSql(DATABASE_ADDRESS_ATTRIBUTES)} AS serverAddress,
      ${firstNonEmptyAttributeSql(DATABASE_PORT_ATTRIBUTES)} AS serverPort,
      ${databaseInstanceSql()} AS dbInstance,
      if(
        NOT ${PLAIN_ADDRESS_SQL}
          OR ${LABEL_COUNT_SQL} = 1
          OR (${LABEL_COUNT_SQL} = 2 AND match(${LABELS_SQL}[1], '${escapeSql(
            ORDINAL_SUFFIX_PATTERN,
          )}')),
        ${namespaceAttribute},
        ''
      ) AS callerNamespace,
      if(
        ${PLAIN_ADDRESS_SQL} AND ${LABEL_COUNT_SQL} = 2,
        match(${namespaceAttribute}, '${escapeSql(NON_BLANK_TEXT_PATTERN)}'),
        0
      ) AS callerInKubernetes,
      if(
        NOT ${PLAIN_ADDRESS_SQL}
          OR ${LABEL_COUNT_SQL} <= 2
          OR has(${LABELS_SQL}, 'svc')
          OR ${networkScopedName}
          OR match(${ADDRESS_SQL}, '${escapeSql(PRIVATE_IP_ADDRESS_PATTERN)}'),
        ${clusterAttribute},
        ''
      ) AS callerCluster,
      count() AS callCount
    FROM ${SPAN_TABLE}
    WHERE projectId = '${escapeSql(window.projectId)}'
      AND startTime >= ${window.startSql}
      AND startTime < ${window.endSql}
      AND kind = '${SpanKind.Client}'
      AND hasAny(attributeKeys, ${keyList(DATABASE_SYSTEM_ATTRIBUTES)})
      AND hasAny(attributeKeys, ${keyList(DATABASE_ADDRESS_ATTRIBUTES)})
      AND dbSystem != ''
      AND serverAddress != ''
    GROUP BY dbSystem, serverAddress, serverPort, dbInstance, callerNamespace, callerInKubernetes, callerCluster
    ORDER BY ${IP_LITERAL_ADDRESS_SQL} ASC, callCount DESC
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

function isFlagSet(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

interface EndpointAccumulator {
  key: string;
  endpoint: DatabaseEndpoint;
  scope: DatabaseEndpointScope;
  callCount: number;
  callsBySystem: Map<string, number>;
}

interface FamilyAccumulator {
  key: string;
  // The managed cluster's host, for a family of cluster members.
  clusterHost: string | null;
  members: Array<EndpointAccumulator>;
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

function compareByCallsThenKey(
  a: { key: string; callCount: number },
  b: { key: string; callCount: number },
): number {
  if (a.callCount !== b.callCount) {
    return b.callCount - a.callCount;
  }
  if (a.key < b.key) {
    return -1;
  }
  return a.key > b.key ? 1 : 0;
}

/*
 * The member a family is recorded under: the one reached by the cluster's
 * own name when a client used it, else the busiest, then by endpoint.
 */
function pickPrimaryMember(family: FamilyAccumulator): EndpointAccumulator {
  const members: Array<EndpointAccumulator> = [...family.members].sort(
    compareByCallsThenKey,
  );
  if (family.clusterHost) {
    for (const member of members) {
      if (member.endpoint.host === family.clusterHost) {
        return member;
      }
    }
  }
  return members[0]!;
}

/**
 * Query rows → the unique databases they name. Each row goes through
 * resolveDatabaseCallTarget — the ingest resolver itself — with the grouped
 * attributes and the caller context the row kept, exactly as ingest
 * resolved the span: loopback / host-relative / unparseable addresses
 * resolve to nothing, and rows that land on the same formatted endpoint are
 * merged with their calls summed. Endpoints that are members of one managed
 * cluster (getDatabaseClusterHost) are merged into ONE entry for the
 * cluster, recorded under one member with the others as `siblings`.
 * Busiest first.
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

    const attributes: Record<string, unknown> = {
      [DATABASE_SYSTEM_ATTRIBUTES[0]!]: row.dbSystem,
      [DATABASE_ADDRESS_ATTRIBUTES[0]!]: row.serverAddress,
      [DATABASE_PORT_ATTRIBUTES[0]!]: row.serverPort,
      [DATABASE_INSTANCE_NAME_ATTRIBUTE]: row.dbInstance,
    };

    const caller: DatabaseCallerContext = {
      kubernetesNamespace: nonEmptyText(row.callerNamespace),
      kubernetesClusterName: nonEmptyText(row.callerCluster),
      hostName: null,
      // Only the collector purpose reads these; a client call never does.
      isEphemeral: true,
      runsInKubernetes: isFlagSet(row.callerInKubernetes),
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
      continue;
    }

    const key: string = formatDatabaseEndpoint(target.endpoint);
    const calls: number = toCount(row.callCount);

    let accumulator: EndpointAccumulator | undefined = byEndpoint.get(key);
    if (!accumulator) {
      accumulator = {
        key: key,
        endpoint: target.endpoint,
        scope: target.scope,
        callCount: 0,
        callsBySystem: new Map<string, number>(),
      };
      byEndpoint.set(key, accumulator);
    }

    accumulator.callCount += calls;
    accumulator.callsBySystem.set(
      target.system,
      (accumulator.callsBySystem.get(target.system) || 0) + calls,
    );
  }

  const families: Map<string, FamilyAccumulator> = new Map<
    string,
    FamilyAccumulator
  >();

  for (const accumulator of byEndpoint.values()) {
    const clusterHost: string | null = getDatabaseClusterHost(
      accumulator.endpoint.host,
    );
    // The cluster's own name keys like its members, so it joins them.
    const familyKey: string = clusterHost
      ? formatDatabaseEndpoint({
          host: clusterHost,
          port: accumulator.endpoint.port,
          kubernetesClusterName: accumulator.endpoint.kubernetesClusterName,
        })
      : accumulator.key;

    let family: FamilyAccumulator | undefined = families.get(familyKey);
    if (!family) {
      family = { key: familyKey, clusterHost: null, members: [] };
      families.set(familyKey, family);
    }
    if (clusterHost) {
      family.clusterHost = clusterHost;
    }
    family.members.push(accumulator);
  }

  const discovered: Array<{ key: string; value: DiscoveredDatabaseEndpoint }> =
    [];

  for (const family of families.values()) {
    const primary: EndpointAccumulator = pickPrimaryMember(family);

    let callCount: number = 0;
    const callsBySystem: Map<string, number> = new Map<string, number>();
    for (const member of family.members) {
      callCount += member.callCount;
      for (const [system, calls] of member.callsBySystem) {
        callsBySystem.set(system, (callsBySystem.get(system) || 0) + calls);
      }
    }

    const system: string = pickSystem(callsBySystem);
    const value: DiscoveredDatabaseEndpoint = {
      system: system,
      endpoint: primary.endpoint,
      scope: primary.scope,
      callCount: callCount,
    };

    const siblings: Array<EndpointAccumulator> = family.members
      .filter((member: EndpointAccumulator): boolean => {
        return member !== primary;
      })
      .sort((a: EndpointAccumulator, b: EndpointAccumulator): number => {
        return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
      });
    if (siblings.length > 0) {
      value.siblings = siblings.map(
        (member: EndpointAccumulator): DatabaseEndpoint => {
          return member.endpoint;
        },
      );
    }

    if (family.clusterHost) {
      value.displayName = buildDatabaseServerDisplayName({
        system: system,
        endpoint: { host: family.clusterHost, port: primary.endpoint.port },
      });
    }

    discovered.push({ key: family.key, value: value });
  }

  discovered.sort(
    (
      a: { key: string; value: DiscoveredDatabaseEndpoint },
      b: { key: string; value: DiscoveredDatabaseEndpoint },
    ): number => {
      return compareByCallsThenKey(
        { key: a.key, callCount: a.value.callCount },
        { key: b.key, callCount: b.value.callCount },
      );
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

/**
 * Every endpoint of a discovered database: the one it is recorded under,
 * then its siblings.
 */
export function getDiscoveredDatabaseEndpoints(
  discovered: DiscoveredDatabaseEndpoint,
): Array<DatabaseEndpoint> {
  return [
    discovered.endpoint,
    ...(Array.isArray(discovered.siblings) ? discovered.siblings : []),
  ];
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
 * a single-label name, an unqualified cluster-local / private-network
 * address or a link-local one), named by host rather than a bare IP (an IP
 * says nothing stable about which server it is), of a known engine that is
 * not a cloud-API or in-process database, and called at least `minCalls`
 * times in the window (a managed cluster's members counted together).
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
