import {
  buildDatabaseCallerContext,
  buildDatabaseServerDisplayName,
  canonicalizeDatabaseEndpoint,
  DatabaseCallerContext,
  DatabaseEndpoint,
  DatabaseEndpointScope,
  getDatabaseEndpointScope,
  isHostRelativeDatabaseHost,
  isIpLiteralHost,
  isLoopbackDatabaseHost,
  parseHostAndPort,
  ParsedHostAndPort,
  readDatabaseInstanceName,
} from "./DatabaseEndpoint";
import {
  isAutoCreatableDatabaseSystem,
  isKnownDatabaseSystem,
  normalizeDatabaseSystem,
} from "./DatabaseSystem";

/*
 * Turning telemetry into a database endpoint — the two pure gates ingest and
 * the discovery crons run before anything touches a cache or a table:
 *
 *   - resolveDatabaseCallTarget: "which database server does this CLIENT
 *     span / db.client.* datapoint talk to?" (application side);
 *   - resolveDatabaseFromResourceAttributes: "is this resource batch a
 *     database's own telemetry (a collector DB receiver, the OneUptime
 *     Database Agent), and which server is it?" (server side).
 *
 * Both are conservative on purpose: a wrong identity merges unrelated
 * servers into one row and shows one database's data on another's page,
 * while a missing identity only costs a row — so anything ambiguous is null.
 */

// Attribute precedence, stable semconv name first, legacy names after.
export const DATABASE_SYSTEM_ATTRIBUTES: Array<string> = [
  "db.system.name",
  "db.system",
];

export const DATABASE_ADDRESS_ATTRIBUTES: Array<string> = [
  "server.address",
  "net.peer.name",
  "network.peer.address",
  "net.sock.peer.addr",
];

export const DATABASE_PORT_ATTRIBUTES: Array<string> = [
  "server.port",
  "net.peer.port",
  "network.peer.port",
  "net.sock.peer.port",
];

// Resource attributes (FLAT semconv keys) read by the receiver-side gate.
export const DATABASE_SERVER_ID_ATTRIBUTE: string =
  "oneuptime.database.server.id";
export const DATABASE_AGENT_ATTRIBUTE: string = "oneuptime.database.agent";

const DATABASE_VERSION_ATTRIBUTES: ReadonlyArray<string> = [
  "db.system.version",
  "redis.version",
  "oracle.db.version",
  "elasticsearch.node.version",
  "mongodb.version",
];

const UUID_REGEX: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A Docker short (12) or full (64) container id used as a hostname.
const CONTAINER_ID_HOST_REGEX: RegExp = /^(?:[0-9a-f]{12}|[0-9a-f]{64})$/;

/*
 * Values receivers and SDKs emit when they do NOT know the host. Treated as
 * absent, so a resource carrying only one of these is not a database —
 * otherwise every PostgreSQL receiver whose endpoint failed to resolve would
 * merge into one "unknown:5432" row.
 */
const NON_IDENTITY_HOSTS: ReadonlySet<string> = new Set<string>([
  "unknown",
  "nohost",
  "localhost.localdomain",
]);

/*
 * The first value that is present AND not the empty string, untrimmed. This
 * mirrors the ClickHouse `multiIf(attributes['x'] != '', …)` selection the
 * client-span discovery SQL uses, so the ingest-side key and the cron-side
 * endpoint are derived from the SAME attribute.
 */
function firstPresent(
  getAttribute: (key: string) => unknown,
  keys: ReadonlyArray<string>,
): unknown {
  for (const key of keys) {
    const value: unknown = getAttribute(key);
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value === "string" && value === "") {
      continue;
    }
    if (typeof value === "object") {
      continue;
    }
    return value;
  }
  return null;
}

function toText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed: string = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function readAttribute(
  attributes: Record<string, unknown>,
  key: string,
): string | null {
  if (!attributes || typeof attributes !== "object") {
    return null;
  }
  const direct: string | null = toText(attributes[key]);
  if (direct !== null) {
    return direct;
  }
  // Stored rows prefix resource attributes; accept that spelling too.
  return toText(attributes[`resource.${key}`]);
}

/**
 * The database server a CLIENT span (or a `db.client.*` datapoint) calls, or
 * null. Returns immediately — without allocating — when the span has no
 * `db.system.name` / `db.system`, so it is cheap to run on every span.
 * Endpoint canonicalization uses purpose "client-call": loopback and
 * host-relative addresses are never an identity here.
 */
export function resolveDatabaseCallTarget(input: {
  getAttribute: (key: string) => unknown;
  caller: DatabaseCallerContext;
}): {
  system: string;
  endpoint: DatabaseEndpoint;
  scope: DatabaseEndpointScope;
} | null {
  if (!input || typeof input.getAttribute !== "function") {
    return null;
  }

  const rawSystem: unknown = firstPresent(
    input.getAttribute,
    DATABASE_SYSTEM_ATTRIBUTES,
  );
  if (rawSystem === null) {
    return null;
  }

  const system: string | null = normalizeDatabaseSystem(rawSystem);
  if (!system) {
    return null;
  }

  const address: unknown = firstPresent(
    input.getAttribute,
    DATABASE_ADDRESS_ATTRIBUTES,
  );
  if (address === null) {
    return null;
  }

  const port: unknown = firstPresent(
    input.getAttribute,
    DATABASE_PORT_ATTRIBUTES,
  );

  /*
   * A SQL Server named instance the span names beside its address (null for
   * every other engine): two instances on one host are two servers. The
   * discovery cron hands its grouped instance column back in as
   * `db.mssql.instance_name`, so both read it here, alike.
   */
  const endpoint: DatabaseEndpoint | null = canonicalizeDatabaseEndpoint({
    system,
    address: typeof address === "string" ? address : String(address),
    port:
      typeof port === "string" || typeof port === "number" ? port : undefined,
    instance: readDatabaseInstanceName({
      system,
      getAttribute: input.getAttribute,
    }),
    caller: input.caller || { isEphemeral: true },
    purpose: "client-call",
  });

  if (!endpoint) {
    return null;
  }

  return { system, endpoint, scope: getDatabaseEndpointScope(endpoint) };
}

/*
 * A host that names nothing: an "unknown" placeholder, or — unless our own
 * Database Agent stamped the address — the resource's own pod name or a
 * container id (a collector sidecar reporting loopback as its os.Hostname()).
 */
function isNonIdentityHost(
  host: string,
  attributes: Record<string, unknown>,
): boolean {
  const value: string = host.trim().toLowerCase();

  if (NON_IDENTITY_HOSTS.has(value) || value.startsWith("unknown_service")) {
    return true;
  }

  if (readAttribute(attributes, DATABASE_AGENT_ATTRIBUTE) !== null) {
    return false;
  }

  const podName: string | null = readAttribute(attributes, "k8s.pod.name");
  if (podName && podName.toLowerCase() === value) {
    return true;
  }

  return CONTAINER_ID_HOST_REGEX.test(value);
}

/*
 * Resource attributes that say the batch describes ONE Kubernetes pod — a
 * `receiver_creator` + `k8s_observer` collector stamps the scraped pod's
 * identity on every batch it produces for it.
 */
const POD_IDENTITY_ATTRIBUTES: ReadonlyArray<string> = [
  "k8s.pod.name",
  "k8s.pod.uid",
];

function isSingleLabelHost(host: string): boolean {
  return !host.includes(".") && !isIpLiteralHost(host);
}

/*
 * The network host of an endpoint host: a SQL Server named instance
 * (`sql1.corp\inst01`) is part of the endpoint's identity but says nothing
 * about the address it is reached at.
 */
function networkHostOf(host: string): string {
  const value: string = host.trim().toLowerCase();
  const instanceStart: number = value.indexOf("\\");
  return instanceStart >= 0 ? value.substring(0, instanceStart) : value;
}

/**
 * Whether a collector-reported endpoint names ONE server stably enough to
 * become its identity — to create a DatabaseServer row, or to be claimed as
 * an alias of the row a batch is linked to. Stable means GLOBAL scope and
 * none of the addresses a collector's own context makes up:
 *
 * - a pod IP: an IP literal qualified with a cluster (a pod or ClusterIP
 *   address) or reported for a pod (`k8s.pod.name` / `k8s.pod.uid`, the
 *   `receiver_creator` pattern). Every restart hands the pod a new one, and
 *   each would become another row that never joins the Kubernetes-detected
 *   database, which owns Service DNS names, not pod IPs;
 * - a single-label name expanded into `<name>.<namespace>.svc.cluster.local`
 *   only because the COLLECTOR runs in that namespace: it may be a Service,
 *   or a pod hostname a receiver substituted for `localhost` (a sidecar's
 *   os.Hostname()) — nothing tells them apart.
 *
 * The endpoint still keys the batch's rows either way, so a row that owns it
 * (the Kubernetes-detected workload's Service DNS alias, an alias a person
 * added, a DATABASE_SERVER_ID link) finds the telemetry. `rawHost` is the
 * host as parsed from the attribute, before canonicalization.
 */
export function isStableCollectorEndpoint(input: {
  rawHost: string;
  endpoint: DatabaseEndpoint;
  attributes: Record<string, unknown>;
}): boolean {
  if (!input || !input.endpoint || typeof input.endpoint.host !== "string") {
    return false;
  }

  const endpoint: DatabaseEndpoint = input.endpoint;
  const host: string = networkHostOf(endpoint.host);

  if (getDatabaseEndpointScope(endpoint) !== "global") {
    return false;
  }

  if (isIpLiteralHost(host)) {
    const clusterQualified: boolean = Boolean(
      typeof endpoint.kubernetesClusterName === "string" &&
        endpoint.kubernetesClusterName.trim(),
    );
    const reportedForPod: boolean = POD_IDENTITY_ATTRIBUTES.some(
      (key: string): boolean => {
        return readAttribute(input.attributes || {}, key) !== null;
      },
    );
    if (clusterQualified || reportedForPod) {
      return false;
    }
  }

  const rawHost: string =
    typeof input.rawHost === "string" ? networkHostOf(input.rawHost) : "";
  if (
    rawHost &&
    isSingleLabelHost(rawHost) &&
    !isLoopbackDatabaseHost(rawHost) &&
    !isHostRelativeDatabaseHost(rawHost) &&
    host !== rawHost
  ) {
    return false;
  }

  return true;
}

/**
 * Whether a resource batch is a database's own telemetry, and which server.
 *
 * - `linkedDatabaseServerId`: `oneuptime.database.server.id` when it is a
 *   UUID (the agent config from the in-app docs stamps it; ingest joins that
 *   row deterministically).
 * - `system`: the receiver hint (from the batch's scope names), refined by a
 *   `db.system.name` resource attribute; else an explicit stamp
 *   (`db.system.name` plus `server.address` or the linked id); else nothing
 *   — an application resource is never a database.
 * - `endpoint` (purpose "collector"): the first of `server.address`
 *   (+ `server.port`), `service.instance.id` (UUID-shaped values ignored;
 *   `host:port/service` read as host:port), `mysql.instance.endpoint`,
 *   `mongodb_atlas.host.name` (+ `mongodb_atlas.process.port`) that
 *   canonicalizes to a real host. There is deliberately NO `host.name`
 *   fallback: a central collector scraping N servers would merge them all.
 * - `endpointIsStable`: see isStableCollectorEndpoint — whether the endpoint
 *   may become a server's identity (created, or claimed as an alias).
 * - `allowCreate`: whether the batch may create a DatabaseServer row for its
 *   endpoint by itself — a stable endpoint of an engine that may be
 *   auto-created (known, not a cloud-API or in-process database). Otherwise
 *   it only joins a row that already owns the endpoint.
 *
 * Null when neither an endpoint nor a linked id identifies the server.
 */
export function resolveDatabaseFromResourceAttributes(input: {
  attributes: Record<string, unknown>;
  receiverSystemHint?: string | null | undefined;
}): {
  system: string;
  endpoint: DatabaseEndpoint | null;
  linkedDatabaseServerId: string | null;
  displayName: string | null;
  version: string | null;
  endpointIsStable: boolean;
  allowCreate: boolean;
} | null {
  const attributes: Record<string, unknown> =
    input && input.attributes && typeof input.attributes === "object"
      ? input.attributes
      : {};

  const rawLinkedId: string | null = readAttribute(
    attributes,
    DATABASE_SERVER_ID_ATTRIBUTE,
  );
  const linkedDatabaseServerId: string | null =
    rawLinkedId && UUID_REGEX.test(rawLinkedId)
      ? rawLinkedId.toLowerCase()
      : null;

  const stampedSystem: string | null = normalizeDatabaseSystem(
    readAttribute(attributes, "db.system.name"),
  );
  // Only a known engine is a hint (callers pass getDatabaseReceiverSystemHint).
  const hintSystem: string | null = isKnownDatabaseSystem(
    input?.receiverSystemHint,
  )
    ? normalizeDatabaseSystem(input?.receiverSystemHint)
    : null;
  const stampedAddress: string | null = readAttribute(
    attributes,
    "server.address",
  );

  let system: string;
  if (hintSystem) {
    system = stampedSystem || hintSystem;
  } else if (stampedSystem && (stampedAddress || linkedDatabaseServerId)) {
    system = stampedSystem;
  } else if (linkedDatabaseServerId) {
    system = stampedSystem || "";
  } else {
    return null;
  }

  const caller: DatabaseCallerContext = buildDatabaseCallerContext(attributes);

  const candidates: Array<{ address: string | null; port: string | null }> = [
    {
      address: stampedAddress,
      port: readAttribute(attributes, "server.port"),
    },
    {
      address: ((): string | null => {
        const instanceId: string | null = readAttribute(
          attributes,
          "service.instance.id",
        );
        return instanceId && !UUID_REGEX.test(instanceId) ? instanceId : null;
      })(),
      port: null,
    },
    {
      address: readAttribute(attributes, "mysql.instance.endpoint"),
      port: null,
    },
    {
      address: readAttribute(attributes, "mongodb_atlas.host.name"),
      port: readAttribute(attributes, "mongodb_atlas.process.port"),
    },
  ];

  let endpoint: DatabaseEndpoint | null = null;
  let rawHost: string = "";
  for (const candidate of candidates) {
    if (!candidate.address) {
      continue;
    }
    const parsed: ParsedHostAndPort | null = parseHostAndPort(
      candidate.address,
    );
    if (!parsed || isNonIdentityHost(parsed.host, attributes)) {
      continue;
    }
    const canonical: DatabaseEndpoint | null = canonicalizeDatabaseEndpoint({
      system,
      address: candidate.address,
      port: candidate.port,
      caller,
      purpose: "collector",
    });
    // The loopback rewrite can land on the collector's own name; re-check.
    if (!canonical || isNonIdentityHost(canonical.host, attributes)) {
      continue;
    }
    endpoint = canonical;
    rawHost = parsed.host;
    break;
  }

  if (!endpoint && !linkedDatabaseServerId) {
    return null;
  }

  let version: string | null = null;
  for (const key of DATABASE_VERSION_ATTRIBUTES) {
    version = readAttribute(attributes, key);
    if (version) {
      break;
    }
  }

  const endpointIsStable: boolean = endpoint
    ? isStableCollectorEndpoint({ rawHost, endpoint, attributes })
    : false;

  return {
    system,
    endpoint,
    linkedDatabaseServerId,
    displayName: endpoint
      ? buildDatabaseServerDisplayName({ system, endpoint })
      : null,
    version,
    endpointIsStable,
    allowCreate: endpointIsStable && isAutoCreatableDatabaseSystem(system),
  };
}
