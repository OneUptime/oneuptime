import {
  getDatabaseSystemDisplayName,
  getDefaultDatabasePort,
  normalizeDatabaseSystem,
  trimTrailingCharacter,
} from "./DatabaseSystem";

/*
 * Database SERVER endpoints — the identity heart of the Databases product.
 *
 * Every path that sees a database (a DB client span, a `db.client.*`
 * datapoint, a collector DB receiver batch, a Kubernetes workload, a
 * user-typed alias) turns what it saw into one canonical `DatabaseEndpoint`
 * here, and the endpoint (never the engine) is what gets keyed
 * (`EntityKey.keyForDatabaseEndpoint`) and stored (`DatabaseServerEndpoint`).
 * The ingest side and the read side MUST agree byte for byte, so all of the
 * rules live in this one pure module:
 *
 *   - one host spelling: lowercase, no trailing dot, IPv6 without brackets
 *     and compressed, IPv4-mapped IPv6 unwrapped;
 *   - one port: the explicit port, else the engine default (semconv omits
 *     `server.port` when it is the default);
 *   - loopback and host-relative names are never an identity for application
 *     spans (a sidecar proxy or a laptop), and are the collector's own host
 *     only for a non-ephemeral collector;
 *   - Kubernetes service DNS is expanded to its FQDN, and names that only
 *     resolve inside one cluster (cluster-local DNS, private IPs) are
 *     qualified with the caller's cluster, because every cluster has its own
 *     `db.prod.svc.cluster.local` and its own 10.0.0.5.
 *
 * Isomorphic, dependency-light and total: nothing here throws, every
 * function returns null (or "local") for input it cannot make sense of —
 * scrubbed values such as "[REDACTED]" or "***.***.***.***" included.
 */

export interface DatabaseEndpoint {
  // Canonical lowercase host; IPv6 without brackets; IPv4-mapped v6 unwrapped.
  host: string;
  // Null only when unknown AND the engine has no default port.
  port: number | null;
  // Qualifier: only on cluster-local hosts or private IPs.
  kubernetesClusterName?: string | undefined;
}

export interface ParsedHostAndPort {
  host: string;
  port: number | null;
}

export interface DatabaseCallerContext {
  kubernetesNamespace?: string | null | undefined;
  kubernetesClusterName?: string | null | undefined;
  hostName?: string | null | undefined;
  // See isEphemeralCaller.
  isEphemeral: boolean;
}

export type DatabaseEndpointPurpose = "client-call" | "collector";

export type DatabaseEndpointScope = "global" | "local";

export type DatabaseWorkloadPlatform = "kubernetes" | "docker" | "podman";

// `scheme://`, including the JDBC `jdbc:postgresql://` spelling.
const URL_SCHEME_REGEX: RegExp = /^(?:jdbc:)?[a-z][a-z0-9+.-]*:\/\//i;

/*
 * Where the address part of a value ends: a path, a query, a fragment, or
 * the `;property=value` list of JDBC SQL Server URLs.
 */
const ADDRESS_END_REGEX: RegExp = /[/?#;]/;

/*
 * ADO.NET / SQL Server `tcp:host,1433` protocol prefix. Not stripped when
 * what follows is only digits, so a host literally named "tcp" with a port
 * ("tcp:5432") is still read as host:port.
 */
const SQL_SERVER_TCP_PREFIX_REGEX: RegExp = /^tcp:(?!\d+$)/i;

/*
 * SQL Server spellings of "this machine": `(local)`, `.` and LocalDB. They
 * are mapped to "localhost" so the loopback rule treats them like any other
 * loopback address.
 */
const LOCAL_MACHINE_ALIASES: ReadonlySet<string> = new Set<string>([
  "(local)",
  ".",
  "(localdb)",
]);

/*
 * "localhost" and the /etc/hosts names distributions give the loopback
 * address. Not `*.localhost`, but they resolve to 127.0.0.1 / ::1 on the
 * caller's own machine all the same.
 */
const LOOPBACK_HOST_NAMES: ReadonlySet<string> = new Set<string>([
  "localhost",
  "localhost.localdomain",
  "localhost4",
  "localhost4.localdomain4",
  "localhost6",
  "localhost6.localdomain6",
  "ip6-localhost",
  "ip6-loopback",
]);

/*
 * Names that resolve to the machine the caller runs on (Docker Desktop,
 * Podman, kind), so like loopback they mean something different for every
 * caller.
 */
const HOST_RELATIVE_NAMES: ReadonlySet<string> = new Set<string>([
  "host.docker.internal",
  "host.containers.internal",
  "gateway.docker.internal",
  "docker.for.mac.localhost",
  "kubernetes.docker.internal",
]);

const EPHEMERAL_CLOUD_PLATFORMS: ReadonlySet<string> = new Set<string>([
  "aws_ecs",
  "aws_lambda",
  "aws_app_runner",
  "gcp_cloud_run",
  "gcp_cloud_functions",
  "gcp_app_engine",
  "azure_container_apps",
  "azure_container_instances",
  "azure_functions",
]);

const KUBERNETES_IDENTITY_ATTRIBUTES: ReadonlyArray<string> = [
  "k8s.pod.name",
  "k8s.namespace.name",
  "k8s.cluster.name",
  "k8s.node.name",
];

const KUBERNETES_CLUSTER_DOMAIN_SUFFIX: string = ".svc.cluster.local";

/*
 * `<a>.<b>.svc` or `<a>.<b>.svc.<any cluster domain>` (a Service), and the
 * three-label `<pod>.<svc>.<ns>.svc…` form (a StatefulSet member behind a
 * headless Service).
 */
const KUBERNETES_SERVICE_DNS_REGEX: RegExp =
  /^((?:[a-z0-9_-]+\.){1,2}[a-z0-9_-]+)\.svc(?:\..+)?$/;

// RFC 1123 label, as Kubernetes validates namespace / Service / pod names.
const DNS_LABEL_REGEX: RegExp = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;

const HOSTNAME_LABEL_REGEX: RegExp = /^[a-z0-9_-]{1,63}$/;

const DIGITS_ONLY_REGEX: RegExp = /^\d+$/;

const IPV6_CHARACTERS_REGEX: RegExp = /^[0-9a-f:.]+$/;

const IPV4_REGEX: RegExp = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

const IPV6_GROUP_REGEX: RegExp = /^[0-9a-f]{1,4}$/;

const DISPLAY_NAME_MAX_LENGTH: number = 100;

// ---- low-level parsing ---------------------------------------------------

function parseIpv4Octets(text: string): Array<number> | null {
  const match: RegExpExecArray | null = IPV4_REGEX.exec(text);
  if (!match) {
    return null;
  }
  const octets: Array<number> = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
  ];
  for (const octet of octets) {
    if (octet > 255) {
      return null;
    }
  }
  return octets;
}

function parseIpv4(text: string): string | null {
  const octets: Array<number> | null = parseIpv4Octets(text);
  return octets ? octets.join(".") : null;
}

/** The eight 16-bit groups of an IPv6 literal (zone id stripped), or null. */
function parseIpv6Groups(text: string): Array<number> | null {
  let value: string = text.trim().toLowerCase();

  const zoneIndex: number = value.indexOf("%");
  if (zoneIndex >= 0) {
    value = value.substring(0, zoneIndex);
  }

  if (!value.includes(":") || !IPV6_CHARACTERS_REGEX.test(value)) {
    return null;
  }

  // An embedded dotted IPv4 tail ("::ffff:10.0.0.5") becomes two groups.
  const lastColon: number = value.lastIndexOf(":");
  const tail: string = value.substring(lastColon + 1);
  if (tail.includes(".")) {
    const octets: Array<number> | null = parseIpv4Octets(tail);
    if (!octets) {
      return null;
    }
    value = `${value.substring(0, lastColon + 1)}${(
      (octets[0]! << 8) |
      octets[1]!
    ).toString(16)}:${((octets[2]! << 8) | octets[3]!).toString(16)}`;
  }

  const doubleColonCount: number = value.split("::").length - 1;
  if (doubleColonCount > 1) {
    return null;
  }

  let parts: Array<string>;
  if (doubleColonCount === 1) {
    const halves: Array<string> = value.split("::");
    const head: Array<string> = halves[0] ? halves[0].split(":") : [];
    const rest: Array<string> = halves[1] ? halves[1].split(":") : [];
    const missing: number = 8 - head.length - rest.length;
    if (missing < 1) {
      return null;
    }
    parts = [...head, ...new Array<string>(missing).fill("0"), ...rest];
  } else {
    parts = value.split(":");
  }

  if (parts.length !== 8) {
    return null;
  }

  const groups: Array<number> = [];
  for (const part of parts) {
    if (!IPV6_GROUP_REGEX.test(part)) {
      return null;
    }
    groups.push(parseInt(part, 16));
  }
  return groups;
}

/*
 * Canonical text form of an IPv6 literal (RFC 5952: lowercase, no leading
 * zeros, the longest run of two or more zero groups compressed to "::"), or
 * the dotted IPv4 address for an IPv4-mapped one (::ffff:a.b.c.d).
 */
function canonicalizeIpv6(text: string): string | null {
  const groups: Array<number> | null = parseIpv6Groups(text);
  if (!groups) {
    return null;
  }

  const isIpv4Mapped: boolean =
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0xffff;
  if (isIpv4Mapped) {
    return [
      groups[6]! >> 8,
      groups[6]! & 0xff,
      groups[7]! >> 8,
      groups[7]! & 0xff,
    ].join(".");
  }

  let bestStart: number = -1;
  let bestLength: number = 0;
  let runStart: number = -1;
  for (let index: number = 0; index <= groups.length; index++) {
    if (index < groups.length && groups[index] === 0) {
      if (runStart < 0) {
        runStart = index;
      }
      continue;
    }
    if (runStart >= 0) {
      const runLength: number = index - runStart;
      if (runLength > bestLength) {
        bestStart = runStart;
        bestLength = runLength;
      }
      runStart = -1;
    }
  }

  const hex: Array<string> = groups.map((group: number): string => {
    return group.toString(16);
  });

  if (bestLength < 2) {
    return hex.join(":");
  }

  const head: string = hex.slice(0, bestStart).join(":");
  const tail: string = hex.slice(bestStart + bestLength).join(":");
  return `${head}::${tail}`;
}

function isValidHostname(host: string): boolean {
  if (host.length === 0 || host.length > 253) {
    return false;
  }
  const labels: Array<string> = host.split(".");
  for (const label of labels) {
    if (!HOSTNAME_LABEL_REGEX.test(label)) {
      return false;
    }
  }
  /*
   * A top-level label is never all digits (RFC 3696 §2), so "999.1.1.1" or
   * "12345" is a mangled address, not a name.
   */
  return !DIGITS_ONLY_REGEX.test(labels[labels.length - 1]!);
}

function toValidPort(value: unknown): number | null {
  let numeric: number;
  if (typeof value === "number") {
    numeric = value;
  } else if (typeof value === "string") {
    const trimmed: string = value.trim();
    if (!DIGITS_ONLY_REGEX.test(trimmed)) {
      return null;
    }
    numeric = Number(trimmed);
  } else {
    return null;
  }
  return Number.isInteger(numeric) && numeric >= 1 && numeric <= 65535
    ? numeric
    : null;
}

function canonicalClusterName(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function canonicalDnsLabel(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const label: string = value.trim().toLowerCase();
  return DNS_LABEL_REGEX.test(label) ? label : null;
}

/**
 * Parse a raw address attribute / connection string into a canonical host
 * and an optional port. Accepts `host`, `host:port`, `[v6]:port`, bare IPv6
 * (zone id stripped), URLs (`scheme://user:pw@host:port/db?x` — the userinfo
 * split on the LAST "@" before the first "/"; JDBC `;key=value` properties
 * dropped), host lists (the first host wins) and the SQL Server forms
 * `tcp:host,1433`, `host\instance`, `(local)` and `.`. The host must then be
 * a valid IPv4, IPv6 or RFC 1123 hostname — anything else (scrubbed values,
 * "*", whitespace, a unix socket path) is null. A port outside 1..65535 is
 * dropped (null); a non-numeric port rejects the whole value.
 */
export function parseHostAndPort(raw: unknown): ParsedHostAndPort | null {
  if (typeof raw !== "string") {
    return null;
  }

  let value: string = raw.trim();
  if (!value || value.startsWith("/")) {
    return null;
  }

  const schemeMatch: RegExpExecArray | null = URL_SCHEME_REGEX.exec(value);
  if (schemeMatch) {
    const afterScheme: string = value.substring(schemeMatch[0].length);
    const authorityEnd: number = afterScheme.search(ADDRESS_END_REGEX);
    let authority: string =
      authorityEnd >= 0 ? afterScheme.substring(0, authorityEnd) : afterScheme;
    const userInfoEnd: number = authority.lastIndexOf("@");
    if (userInfoEnd >= 0) {
      authority = authority.substring(userInfoEnd + 1);
    }
    value = authority;
  } else {
    value = value.replace(SQL_SERVER_TCP_PREFIX_REGEX, "");
    const pathStart: number = value.search(ADDRESS_END_REGEX);
    if (pathStart >= 0) {
      value = value.substring(0, pathStart);
    }
  }

  value = value.trim();
  if (!value) {
    return null;
  }

  // "host,1433" (SQL Server port) or "h1:27017,h2:27017" (a host list).
  let portText: string | null = null;
  const commaIndex: number = value.indexOf(",");
  if (commaIndex >= 0) {
    const afterComma: string = value.substring(commaIndex + 1).trim();
    value = value.substring(0, commaIndex).trim();
    if (DIGITS_ONLY_REGEX.test(afterComma)) {
      portText = afterComma;
    }
  }

  // "host\instance" — the SQL Server named instance is not part of the host.
  const backslashIndex: number = value.indexOf("\\");
  if (backslashIndex >= 0) {
    value = value.substring(0, backslashIndex).trim();
  }

  if (!value) {
    return null;
  }

  let host: string;

  if (LOCAL_MACHINE_ALIASES.has(value.toLowerCase())) {
    host = "localhost";
  } else if (value.startsWith("[")) {
    const closing: number = value.indexOf("]");
    if (closing < 0) {
      return null;
    }
    const rest: string = value.substring(closing + 1);
    if (rest) {
      if (!rest.startsWith(":")) {
        return null;
      }
      if (portText === null) {
        portText = rest.substring(1);
      }
    }
    const ipv6: string | null = canonicalizeIpv6(value.substring(1, closing));
    if (!ipv6) {
      // "[REDACTED]", "[HASHED:ab12cd34]" and other bracketed non-addresses.
      return null;
    }
    host = ipv6;
  } else {
    const colonCount: number = (value.match(/:/g) || []).length;
    if (colonCount >= 2) {
      const ipv6: string | null = canonicalizeIpv6(value);
      if (!ipv6) {
        return null;
      }
      host = ipv6;
    } else {
      let hostText: string = value;
      if (colonCount === 1) {
        const colonIndex: number = value.indexOf(":");
        hostText = value.substring(0, colonIndex);
        if (portText === null) {
          portText = value.substring(colonIndex + 1);
        }
      }

      hostText = trimTrailingCharacter(hostText.trim().toLowerCase(), ".");
      if (!hostText) {
        return null;
      }

      const ipv4: string | null = parseIpv4(hostText);
      if (ipv4) {
        host = ipv4;
      } else if (isValidHostname(hostText)) {
        host = hostText;
      } else {
        return null;
      }
    }
  }

  let port: number | null = null;
  if (portText !== null && portText.trim() !== "") {
    const trimmedPort: string = portText.trim();
    if (!DIGITS_ONLY_REGEX.test(trimmedPort)) {
      return null;
    }
    port = toValidPort(trimmedPort);
  }

  return { host, port };
}

// ---- host classification -------------------------------------------------

/** True for an IPv4 or IPv6 literal (brackets tolerated). */
export function isIpLiteralHost(host: string): boolean {
  if (typeof host !== "string") {
    return false;
  }
  const value: string = host.trim().replace(/^\[(.*)\]$/, "$1");
  if (!value) {
    return false;
  }
  return parseIpv4(value) !== null || parseIpv6Groups(value) !== null;
}

/**
 * localhost (and the distributions' /etc/hosts aliases such as
 * localhost.localdomain), *.localhost, 127/8, ::1, the unspecified addresses
 * (:: and 0.0.0.0) and their IPv4-mapped IPv6 spellings.
 */
export function isLoopbackDatabaseHost(host: string): boolean {
  if (typeof host !== "string") {
    return false;
  }
  let value: string = host.trim().toLowerCase();
  if (!value) {
    return false;
  }
  if (LOCAL_MACHINE_ALIASES.has(value)) {
    return true;
  }
  if (value.includes(":")) {
    value = canonicalizeIpv6(value.replace(/^\[(.*)\]$/, "$1")) || value;
  }
  value = trimTrailingCharacter(value, ".");
  if (LOOPBACK_HOST_NAMES.has(value) || value.endsWith(".localhost")) {
    return true;
  }
  if (value === "::1" || value === "::" || value === "0.0.0.0") {
    return true;
  }
  const octets: Array<number> | null = parseIpv4Octets(value);
  return octets !== null && octets[0] === 127;
}

/** host.docker.internal and the other "the machine I run on" names. */
export function isHostRelativeDatabaseHost(host: string): boolean {
  if (typeof host !== "string") {
    return false;
  }
  return HOST_RELATIVE_NAMES.has(
    trimTrailingCharacter(host.trim().toLowerCase(), "."),
  );
}

/**
 * RFC 1918 (10/8, 172.16/12, 192.168/16), CGNAT (100.64/10) and IPv6 ULA
 * (fc00::/7) — ranges that are reused by every cluster and VPC, so an
 * address in them only identifies something together with where it was
 * seen from.
 */
export function isPrivateIpHost(host: string): boolean {
  if (typeof host !== "string") {
    return false;
  }
  const value: string = host.trim().replace(/^\[(.*)\]$/, "$1");

  const octets: Array<number> | null = parseIpv4Octets(value);
  if (octets) {
    const first: number = octets[0]!;
    const second: number = octets[1]!;
    return (
      first === 10 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 100 && second >= 64 && second <= 127)
    );
  }

  const canonical: string | null = value.includes(":")
    ? canonicalizeIpv6(value)
    : null;
  if (!canonical) {
    return false;
  }
  if (!canonical.includes(":")) {
    // IPv4-mapped: classify the unwrapped IPv4 address.
    return isPrivateIpHost(canonical);
  }
  const groups: Array<number> | null = parseIpv6Groups(canonical);
  return groups !== null && (groups[0]! & 0xfe00) === 0xfc00;
}

function isSingleLabelName(host: string): boolean {
  return !host.includes(".") && !isIpLiteralHost(host);
}

function isClusterScopedHost(host: string): boolean {
  return host.endsWith(".cluster.local") || isPrivateIpHost(host);
}

/*
 * Rule 3 (Kubernetes DNS): any `<a>.<b>.svc[.<domain>]` (and the member form
 * `<pod>.<svc>.<ns>.svc[.<domain>]`) becomes `….svc.cluster.local`, so a
 * custom cluster domain and the short `.svc` form key like the FQDN; a
 * single-label name from a caller in a known namespace becomes that
 * namespace's Service FQDN.
 */
function applyKubernetesDnsRules(
  host: string,
  kubernetesNamespace: string | null | undefined,
): string {
  const serviceMatch: RegExpExecArray | null =
    KUBERNETES_SERVICE_DNS_REGEX.exec(host);
  if (serviceMatch) {
    return `${serviceMatch[1]}${KUBERNETES_CLUSTER_DOMAIN_SUFFIX}`;
  }

  if (isSingleLabelName(host)) {
    const namespace: string | null = canonicalDnsLabel(kubernetesNamespace);
    if (namespace) {
      return `${host}.${namespace}${KUBERNETES_CLUSTER_DOMAIN_SUFFIX}`;
    }
  }

  return host;
}

function buildEndpoint(
  host: string,
  port: number | null,
  kubernetesClusterName: string,
): DatabaseEndpoint {
  return kubernetesClusterName
    ? { host, port, kubernetesClusterName }
    : { host, port };
}

// ---- caller context ------------------------------------------------------

/*
 * Resource attributes are FLAT semconv keys; the `resource.`-prefixed
 * spelling used by stored telemetry rows is accepted as a fallback so a
 * caller holding a stored attribute map gets the same answer.
 */
function readResourceAttribute(
  attributes: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  if (!attributes || typeof attributes !== "object") {
    return null;
  }
  let value: unknown = attributes[key];
  if (value === undefined || value === null || value === "") {
    value = attributes[`resource.${key}`];
  }
  if (typeof value === "string") {
    const trimmed: string = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

/**
 * True when the resource that made a call is not a stable machine: anything
 * in Kubernetes, in a container, on a FaaS or managed-container platform, or
 * with no `os.type` at all (no `system` resource detector ran, so
 * `host.name` is whatever the SDK guessed — usually a pod or container
 * name). Its `host.name` must never become a database's identity.
 */
export function isEphemeralCaller(
  resourceAttributes: Record<string, unknown>,
): boolean {
  const attributes: Record<string, unknown> =
    resourceAttributes && typeof resourceAttributes === "object"
      ? resourceAttributes
      : {};

  for (const key of KUBERNETES_IDENTITY_ATTRIBUTES) {
    if (readResourceAttribute(attributes, key)) {
      return true;
    }
  }

  if (
    readResourceAttribute(attributes, "container.id") ||
    readResourceAttribute(attributes, "container.runtime")
  ) {
    return true;
  }

  for (const key of Object.keys(attributes)) {
    const bareKey: string = key.startsWith("resource.")
      ? key.substring("resource.".length)
      : key;
    if (bareKey.startsWith("faas.") && readResourceAttribute(attributes, key)) {
      return true;
    }
  }

  const cloudPlatform: string | null = readResourceAttribute(
    attributes,
    "cloud.platform",
  );
  if (
    cloudPlatform &&
    EPHEMERAL_CLOUD_PLATFORMS.has(cloudPlatform.toLowerCase())
  ) {
    return true;
  }

  return readResourceAttribute(attributes, "os.type") === null;
}

/** The parts of a caller's resource that endpoint canonicalization needs. */
export function buildDatabaseCallerContext(
  resourceAttributes: Record<string, unknown>,
): DatabaseCallerContext {
  return {
    kubernetesNamespace: readResourceAttribute(
      resourceAttributes,
      "k8s.namespace.name",
    ),
    kubernetesClusterName: readResourceAttribute(
      resourceAttributes,
      "k8s.cluster.name",
    ),
    hostName: readResourceAttribute(resourceAttributes, "host.name"),
    isEphemeral: isEphemeralCaller(resourceAttributes),
  };
}

// ---- canonicalization ----------------------------------------------------

/**
 * Canonicalize what a caller saw into a database endpoint, or null when it
 * names no identifiable server. Rules, in order:
 *
 *   1. parse the address; port = explicit port ?? parsed port ?? engine
 *      default ?? null;
 *   2. loopback / host-relative: for a client call → null (a per-caller
 *      sidecar, proxy or dev laptop); for a collector → the collector's own
 *      host.name when the collector is not ephemeral, else null;
 *   3. Kubernetes DNS expansion (see applyKubernetesDnsRules);
 *   4. cluster-local names and private IPs are qualified with the caller's
 *      `k8s.cluster.name` when it has one.
 */
export function canonicalizeDatabaseEndpoint(input: {
  system: string;
  address: string | null | undefined;
  port?: string | number | null | undefined;
  caller: DatabaseCallerContext;
  purpose: DatabaseEndpointPurpose;
}): DatabaseEndpoint | null {
  if (!input) {
    return null;
  }

  const parsed: ParsedHostAndPort | null = parseHostAndPort(input.address);
  if (!parsed) {
    return null;
  }

  const caller: DatabaseCallerContext | null = input.caller || null;
  const port: number | null =
    toValidPort(input.port) ??
    parsed.port ??
    getDefaultDatabasePort(input.system) ??
    null;

  let host: string = parsed.host;

  if (isLoopbackDatabaseHost(host) || isHostRelativeDatabaseHost(host)) {
    if (input.purpose !== "collector") {
      return null;
    }
    if (!caller || caller.isEphemeral || !caller.hostName) {
      return null;
    }
    const callerHost: ParsedHostAndPort | null = parseHostAndPort(
      caller.hostName,
    );
    if (
      !callerHost ||
      isLoopbackDatabaseHost(callerHost.host) ||
      isHostRelativeDatabaseHost(callerHost.host)
    ) {
      return null;
    }
    host = callerHost.host;
  }

  host = applyKubernetesDnsRules(host, caller?.kubernetesNamespace);

  const clusterName: string = isClusterScopedHost(host)
    ? canonicalClusterName(caller?.kubernetesClusterName)
    : "";

  return buildEndpoint(host, port, clusterName);
}

/**
 * "local" for an endpoint that only resolves inside one network or cluster
 * and carries nothing to say which: a single-label name, cluster-local DNS
 * or a private IP without a cluster qualifier (and loopback, defensively).
 * Local endpoints are still keyed (it is what the span says) but never
 * create a DatabaseServer row and never auto-match an alias.
 */
export function getDatabaseEndpointScope(
  endpoint: DatabaseEndpoint,
): DatabaseEndpointScope {
  const host: string =
    endpoint && typeof endpoint.host === "string"
      ? endpoint.host.trim().toLowerCase()
      : "";

  if (!host) {
    return "local";
  }
  if (isLoopbackDatabaseHost(host) || isHostRelativeDatabaseHost(host)) {
    return "local";
  }
  if (isSingleLabelName(host)) {
    return "local";
  }

  const hasCluster: boolean =
    canonicalClusterName(endpoint.kubernetesClusterName).length > 0;
  if (!hasCluster && isClusterScopedHost(host)) {
    return "local";
  }

  return "global";
}

/**
 * "host:port", "host" (unknown port), "[v6]:port"; plus "@cluster" when
 * qualified. The inverse is parseDatabaseEndpointString. The cluster part is
 * kept verbatim apart from trim + lowercase (EKS names are ARNs containing
 * ":" and "/").
 */
export function formatDatabaseEndpoint(endpoint: DatabaseEndpoint): string {
  const host: string =
    endpoint && typeof endpoint.host === "string"
      ? endpoint.host.trim().toLowerCase()
      : "";
  const hostPart: string = host.includes(":") ? `[${host}]` : host;
  const port: number | null = toValidPort(endpoint?.port);
  const portPart: string = port !== null ? `:${port}` : "";
  const clusterName: string = canonicalClusterName(
    endpoint?.kubernetesClusterName,
  );
  return `${hostPart}${portPart}${clusterName ? `@${clusterName}` : ""}`;
}

/**
 * Inverse of formatDatabaseEndpoint, for stored values AND user-typed
 * aliases. The cluster qualifier is split on the LAST "@" and kept only when
 * the host is cluster-local or a private IP (a qualifier on any other host
 * is dropped — ingest never produces one). URL forms are not split: their
 * "@" is userinfo. Kubernetes DNS rules use the row's namespace for a
 * single-label name, an unqualified cluster-scoped host takes the row's
 * cluster, and the port defaults from the engine. Loopback and host-relative
 * names are null — an alias must name a server.
 */
export function parseDatabaseEndpointString(
  value: unknown,
  context: {
    system: string;
    kubernetesClusterName?: string | null | undefined;
    kubernetesNamespace?: string | null | undefined;
  },
): DatabaseEndpoint | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed: string = value.trim();
  if (!trimmed) {
    return null;
  }

  let addressPart: string = trimmed;
  let explicitClusterName: string = "";

  if (!URL_SCHEME_REGEX.test(trimmed)) {
    const atIndex: number = trimmed.lastIndexOf("@");
    if (atIndex >= 0) {
      addressPart = trimmed.substring(0, atIndex);
      explicitClusterName = canonicalClusterName(
        trimmed.substring(atIndex + 1),
      );
    }
  }

  const parsed: ParsedHostAndPort | null = parseHostAndPort(addressPart);
  if (!parsed) {
    return null;
  }
  if (
    isLoopbackDatabaseHost(parsed.host) ||
    isHostRelativeDatabaseHost(parsed.host)
  ) {
    return null;
  }

  const port: number | null =
    parsed.port ?? getDefaultDatabasePort(context?.system) ?? null;

  const host: string = applyKubernetesDnsRules(
    parsed.host,
    context?.kubernetesNamespace,
  );

  const clusterName: string = isClusterScopedHost(host)
    ? explicitClusterName ||
      canonicalClusterName(context?.kubernetesClusterName)
    : "";

  return buildEndpoint(host, port, clusterName);
}

// ---- row identity + naming -----------------------------------------------

/** `${system}|${formatted endpoint}` — the identifier of an endpoint row. */
export function buildDatabaseServerIdentifier(
  system: string,
  endpoint: DatabaseEndpoint,
): string {
  return `${normalizeDatabaseSystem(system) || ""}|${formatDatabaseEndpoint(
    endpoint,
  )}`;
}

/**
 * The identifier of a workload-detected row, lowercased:
 *   kubernetes → `${system}|kubernetes:${cluster}/${namespace}/${kind}/${name}`
 *   docker / podman → `${system}|${platform}:${host}/${name}` — no kind, so
 *   compose labels that appear later cannot change the identity.
 */
export function buildWorkloadDatabaseServerIdentifier(input: {
  system: string;
  platform: DatabaseWorkloadPlatform;
  parentName: string;
  namespace?: string | null | undefined;
  workloadKind?: string | null | undefined;
  workloadName: string;
}): string {
  const segment: (value: unknown) => string = (value: unknown): string => {
    return typeof value === "string" ? value.trim() : "";
  };

  const system: string = normalizeDatabaseSystem(input.system) || "";
  const platform: string = segment(input.platform);
  const parentName: string = segment(input.parentName);
  const workloadName: string = segment(input.workloadName);

  if (platform === "kubernetes") {
    return `${system}|kubernetes:${parentName}/${segment(
      input.namespace,
    )}/${segment(input.workloadKind)}/${workloadName}`.toLowerCase();
  }

  return `${system}|${platform}:${parentName}/${workloadName}`.toLowerCase();
}

/**
 * "PostgreSQL db.prod:5432", "Redis cache/redis-master", "MongoDB mongo" —
 * the engine then the endpoint (no "@cluster") or the workload. At most 100
 * characters.
 */
export function buildDatabaseServerDisplayName(input: {
  system: string;
  endpoint?: DatabaseEndpoint | null | undefined;
  namespace?: string | null | undefined;
  workloadName?: string | null | undefined;
}): string {
  const engine: string = getDatabaseSystemDisplayName(input?.system);

  let target: string = "";
  if (input?.endpoint && typeof input.endpoint.host === "string") {
    target = formatDatabaseEndpoint({
      host: input.endpoint.host,
      port: input.endpoint.port,
    });
  } else {
    const workloadName: string =
      typeof input?.workloadName === "string" ? input.workloadName.trim() : "";
    const namespace: string =
      typeof input?.namespace === "string" ? input.namespace.trim() : "";
    if (workloadName) {
      target = namespace ? `${namespace}/${workloadName}` : workloadName;
    }
  }

  const name: string = target ? `${engine} ${target}` : engine;
  return name.length > DISPLAY_NAME_MAX_LENGTH
    ? name.substring(0, DISPLAY_NAME_MAX_LENGTH).trimEnd()
    : name;
}

/**
 * The endpoint aliases of a Kubernetes-detected database, formatted:
 *   - each Service × port: `${svc}.${ns}.svc.cluster.local:${port}@${cluster}`;
 *   - each StatefulSet / operator member behind a headless Service:
 *     `${pod}.${svc}.${ns}.svc.cluster.local:${port}@${cluster}`;
 *   - the unqualified twin of each, ONLY when `includeUnqualified` (the
 *     worker sets it when the project has exactly one Kubernetes cluster, so
 *     an unqualified name cannot belong to anything else).
 * Ports are the engine default plus the declared container ports. No
 * two-label `${svc}.${ns}` forms (indistinguishable from a real domain).
 * Invalid DNS labels are skipped. Deduped, in a stable order. With a blank
 * cluster name only the unqualified form can be produced, so it is.
 */
export function buildKubernetesDatabaseAliases(input: {
  system: string;
  namespace: string;
  clusterName: string;
  serviceNames: Array<string>;
  podServiceNames?:
    | Array<{ podName: string; serviceName: string }>
    | null
    | undefined;
  ports: Array<number>;
  includeUnqualified: boolean;
}): Array<string> {
  if (!input) {
    return [];
  }

  const namespace: string | null = canonicalDnsLabel(input.namespace);
  if (!namespace) {
    return [];
  }

  const clusterName: string = canonicalClusterName(input.clusterName);

  const ports: Array<number | null> = [];
  const candidatePorts: Array<unknown> = [
    getDefaultDatabasePort(input.system),
    ...(Array.isArray(input.ports) ? input.ports : []),
  ];
  for (const candidate of candidatePorts) {
    const port: number | null = toValidPort(candidate);
    if (port !== null && !ports.includes(port)) {
      ports.push(port);
    }
  }
  if (ports.length === 0) {
    ports.push(null);
  }

  const aliases: Array<string> = [];
  const seen: Set<string> = new Set<string>();
  const push: (alias: string) => void = (alias: string): void => {
    if (!seen.has(alias)) {
      seen.add(alias);
      aliases.push(alias);
    }
  };

  const addHost: (host: string) => void = (host: string): void => {
    if (!isValidHostname(host)) {
      return;
    }
    for (const port of ports) {
      if (clusterName) {
        push(formatDatabaseEndpoint(buildEndpoint(host, port, clusterName)));
      }
      if (!clusterName || input.includeUnqualified) {
        push(formatDatabaseEndpoint(buildEndpoint(host, port, "")));
      }
    }
  };

  for (const serviceName of Array.isArray(input.serviceNames)
    ? input.serviceNames
    : []) {
    const service: string | null = canonicalDnsLabel(serviceName);
    if (service) {
      addHost(`${service}.${namespace}${KUBERNETES_CLUSTER_DOMAIN_SUFFIX}`);
    }
  }

  for (const member of Array.isArray(input.podServiceNames)
    ? input.podServiceNames
    : []) {
    const podName: string | null = canonicalDnsLabel(member?.podName);
    const serviceName: string | null = canonicalDnsLabel(member?.serviceName);
    if (podName && serviceName) {
      addHost(
        `${podName}.${serviceName}.${namespace}${KUBERNETES_CLUSTER_DOMAIN_SUFFIX}`,
      );
    }
  }

  return aliases;
}
