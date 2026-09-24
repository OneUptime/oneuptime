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
 *     `server.port` when it is the default) — except for a SQL Server named
 *     instance, which listens on a port of its own and is identified by its
 *     name instead (`sql1.corp\inst01`);
 *   - loopback and host-relative names are never an identity for application
 *     spans (a sidecar proxy or a laptop), and are the collector's own host
 *     only for a non-ephemeral collector;
 *   - Kubernetes service DNS is expanded to its FQDN, and names that only
 *     resolve inside one cluster or network (cluster-local DNS, the private
 *     DNS zones, private and link-local IPs) are qualified with the caller's
 *     cluster, because every cluster has its own `db.prod.svc.cluster.local`
 *     and its own 10.0.0.5.
 *
 * Isomorphic, dependency-light and total: nothing here throws, every
 * function returns null (or "local") for input it cannot make sense of —
 * scrubbed values such as "[REDACTED]" or "***.***.***.***" included.
 */

export interface DatabaseEndpoint {
  /*
   * Canonical lowercase host; IPv6 without brackets; IPv4-mapped v6
   * unwrapped. A SQL Server named instance reached without a port is part
   * of it — `sql1.corp\inst01` — so it is part of every key and identifier
   * built from the endpoint (see splitDatabaseHostInstance).
   */
  host: string;
  // Null only when unknown AND the engine has no default port (or a named instance).
  port: number | null;
  // Qualifier: only on cluster-local / private-network hosts.
  kubernetesClusterName?: string | undefined;
}

export interface ParsedHostAndPort {
  host: string;
  port: number | null;
  // A SQL Server named instance (`host\instance`), lowercased; absent when none.
  instance?: string | undefined;
}

export interface DatabaseCallerContext {
  kubernetesNamespace?: string | null | undefined;
  kubernetesClusterName?: string | null | undefined;
  hostName?: string | null | undefined;
  // See isEphemeralCaller.
  isEphemeral: boolean;
  /*
   * True when the caller is known to run in Kubernetes although neither
   * its namespace nor its cluster was kept: the client-span discovery query
   * keeps only this flag for the addresses whose endpoint depends on WHETHER
   * the caller runs in Kubernetes but not on which namespace. Ingest leaves
   * it unset — there it is derived from the namespace and cluster
   * (isKubernetesDatabaseCaller).
   */
  runsInKubernetes?: boolean | undefined;
}

export type DatabaseEndpointPurpose = "client-call" | "collector";

export type DatabaseEndpointScope = "global" | "local";

export type DatabaseWorkloadPlatform = "kubernetes" | "docker" | "podman";

/*
 * DNS suffixes that only resolve inside one network: `.local` (mDNS, and the
 * `cluster.local` Kubernetes domain), `.internal` (ICANN's private-use TLD —
 * `ec2.internal`, `compute.internal`, GCE's `c.<project>.internal`),
 * `.home.arpa` (RFC 8375) and `.localdomain` (the placeholder domain of a
 * machine with none). The same name in two VPCs or clusters can be two
 * different servers, so they are qualified like private IPs.
 */
export const NETWORK_SCOPED_NAME_SUFFIXES: ReadonlyArray<string> = [
  ".local",
  ".internal",
  ".home.arpa",
  ".localdomain",
];

/*
 * The attributes a SQL Server client span may name its instance in, most
 * specific first: the legacy `db.mssql.instance_name`, then the instance
 * half of `db.namespace` (`instance|database` for a named instance).
 */
export const DATABASE_INSTANCE_NAME_ATTRIBUTE: string =
  "db.mssql.instance_name";
export const DATABASE_NAMESPACE_ATTRIBUTE: string = "db.namespace";
export const DATABASE_INSTANCE_ATTRIBUTES: ReadonlyArray<string> = [
  DATABASE_INSTANCE_NAME_ATTRIBUTE,
  DATABASE_NAMESPACE_ATTRIBUTE,
];

const SQL_SERVER_SYSTEM: string = "microsoft.sql_server";

// The default instance: reached on the engine's default port, named by none.
const SQL_SERVER_DEFAULT_INSTANCE: string = "mssqlserver";

/*
 * SQL Server instance names: at most 16 letters, digits, "_" and "$"
 * (lowercased here). "#" is refused: it would end the address as a URL
 * fragment, and the name could not round-trip.
 */
const SQL_SERVER_INSTANCE_REGEX: RegExp = /^[a-z0-9_$-]{1,16}$/;

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
 * caller. Besides these, every `*.docker.internal` name and every
 * `host.<tool>.internal` name (minikube, k3d, Lima, OrbStack, Rancher
 * Desktop) is host-relative too (isHostRelativeDatabaseHost).
 */
const HOST_RELATIVE_NAMES: ReadonlySet<string> = new Set<string>([
  "host.docker.internal",
  "host.containers.internal",
  "gateway.docker.internal",
  "docker.for.mac.localhost",
  "kubernetes.docker.internal",
]);

const DOCKER_DESKTOP_SUFFIX: string = ".docker.internal";

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

/*
 * Second labels that make a two-label name a private DNS zone rather than a
 * Kubernetes `<service>.<namespace>`: `db.internal` from a pod is far more
 * likely a VPC name than a Service in a namespace called "internal". Such a
 * name is still network-scoped (NETWORK_SCOPED_NAME_SUFFIXES).
 */
const NON_NAMESPACE_TOP_LABELS: ReadonlySet<string> = new Set<string>([
  "local",
  "internal",
  "localdomain",
]);

// RFC 1123 label, as Kubernetes validates namespace / Service / pod names.
const DNS_LABEL_REGEX: RegExp = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;

const HOSTNAME_LABEL_REGEX: RegExp = /^[a-z0-9_-]{1,63}$/;

const DIGITS_ONLY_REGEX: RegExp = /^\d+$/;

const IPV6_CHARACTERS_REGEX: RegExp = /^[0-9a-f:.]+$/;

const IPV4_REGEX: RegExp = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

const IPV6_GROUP_REGEX: RegExp = /^[0-9a-f]{1,4}$/;

// A character a bare user name never has: a dot, colon, bracket or backslash.
const NOT_A_BARE_WORD_REGEX: RegExp = /[.:[\]\\]/;

// The member number of an Atlas host: `<cluster>-shard-<NN>-<NN>`.
const ATLAS_MEMBER_NUMBER_REGEX: RegExp = /^\d{2}-\d{2}$/;
const ATLAS_MEMBER_MARKER: string = "-shard-";
const ATLAS_DOMAIN: string = "mongodb.net";

const DISPLAY_NAME_MAX_LENGTH: number = 100;

// How much of a rejected value a message repeats back.
const MAX_ECHOED_VALUE_LENGTH: number = 100;

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

function isNonBlankText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/*
 * A SQL Server instance name as it becomes part of an identity: trimmed,
 * lowercased, validated; the default instance (MSSQLSERVER) is no instance.
 * `undefined` for an invalid name, null for none.
 */
function canonicalInstanceName(value: unknown): string | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const instance: string = value.trim().toLowerCase();
  if (!instance) {
    return null;
  }
  if (!SQL_SERVER_INSTANCE_REGEX.test(instance)) {
    return undefined;
  }
  return instance === SQL_SERVER_DEFAULT_INSTANCE ? null : instance;
}

/**
 * A host as stored in a DatabaseEndpoint, split into the network host and
 * the SQL Server named instance it may carry (`sql1.corp\inst01` →
 * `sql1.corp` + `inst01`; everything else → the host + "").
 */
export function splitDatabaseHostInstance(host: string): {
  host: string;
  instance: string;
} {
  const value: string = typeof host === "string" ? host : "";
  const index: number = value.indexOf("\\");
  return index >= 0
    ? { host: value.substring(0, index), instance: value.substring(index + 1) }
    : { host: value, instance: "" };
}

function joinHostInstance(host: string, instance: string | null): string {
  return instance ? `${host}\\${instance}` : host;
}

/*
 * Where the address in a raw value is: the URL authority (scheme, userinfo
 * and path dropped) or the value up to its path / query / JDBC properties,
 * `tcp:` prefix dropped. May still hold a host list. Null for nothing.
 */
function extractAddressText(raw: unknown): string | null {
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
  return value ? value : null;
}

/*
 * One host of an address: `host`, `host:port`, `[v6]:port`, bare IPv6,
 * `host\instance[:port]` and the SQL Server local-machine spellings.
 * `portText` is a port found beside it (the `,1433` of SQL Server); a port
 * outside 1..65535 is dropped, or — with `strictPort` — rejects the value.
 */
function parseSingleHost(
  text: string,
  initialPortText: string | null,
  strictPort: boolean,
): ParsedHostAndPort | null {
  let value: string = text.trim();
  let portText: string | null = initialPortText;

  // "host\instance" (optionally "host\instance:port"): a SQL Server named instance.
  let instance: string | null = null;
  const backslashIndex: number = value.indexOf("\\");
  if (backslashIndex >= 0) {
    let instanceText: string = value.substring(backslashIndex + 1).trim();
    value = value.substring(0, backslashIndex).trim();
    const colonIndex: number = instanceText.indexOf(":");
    if (colonIndex >= 0) {
      if (portText === null) {
        portText = instanceText.substring(colonIndex + 1);
      }
      instanceText = instanceText.substring(0, colonIndex);
    }
    const canonical: string | null | undefined =
      canonicalInstanceName(instanceText);
    if (canonical === undefined) {
      return null;
    }
    instance = canonical;
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
    if (port === null && strictPort) {
      return null;
    }
  }

  return instance ? { host, port, instance } : { host, port };
}

// Canonical order of the hosts of a list: host, then instance, then port.
function compareParsedHosts(
  a: ParsedHostAndPort,
  b: ParsedHostAndPort,
): number {
  if (a.host !== b.host) {
    return a.host < b.host ? -1 : 1;
  }
  const instanceA: string = a.instance || "";
  const instanceB: string = b.instance || "";
  if (instanceA !== instanceB) {
    return instanceA < instanceB ? -1 : 1;
  }
  return (a.port ?? 0) - (b.port ?? 0);
}

function parseAddressHosts(
  raw: unknown,
  strictPort: boolean,
): Array<ParsedHostAndPort> | null {
  const address: string | null = extractAddressText(raw);
  if (address === null) {
    return null;
  }

  const parts: Array<string> = address.split(",");

  // "host,1433": SQL Server's port separator, not a list.
  if (parts.length === 2 && DIGITS_ONLY_REGEX.test(parts[1]!.trim())) {
    const single: ParsedHostAndPort | null = parseSingleHost(
      parts[0]!,
      parts[1]!.trim(),
      strictPort,
    );
    return single ? [single] : null;
  }

  const hosts: Array<ParsedHostAndPort> = [];
  const seen: Set<string> = new Set<string>();
  for (const part of parts) {
    if (!part.trim()) {
      continue;
    }
    const parsed: ParsedHostAndPort | null = parseSingleHost(
      part,
      null,
      strictPort,
    );
    // A list is one logical server only when every host in it is readable.
    if (!parsed) {
      return null;
    }
    const key: string = `${parsed.host}\\${parsed.instance || ""}:${
      parsed.port ?? ""
    }`;
    if (!seen.has(key)) {
      seen.add(key);
      hosts.push(parsed);
    }
  }

  if (hosts.length === 0) {
    return null;
  }

  hosts.sort(compareParsedHosts);
  return hosts;
}

/**
 * Parse a raw address attribute / connection string into a canonical host
 * and an optional port. Accepts `host`, `host:port`, `[v6]:port`, bare IPv6
 * (zone id stripped), URLs (`scheme://user:pw@host:port/db?x` — the userinfo
 * split on the LAST "@" before the first "/"; JDBC `;key=value` properties
 * dropped), host lists and the SQL Server forms `tcp:host,1433`,
 * `host\instance` (the instance returned beside the host; MSSQLSERVER, the
 * default instance, is no instance), `(local)` and `.`.
 *
 * A host list (`m1:27017,m2:27017`) names ONE logical server, so it yields
 * the same host whatever order a client lists the members in: the first in
 * canonical order (see parseHostAndPortList). Every listed host must parse.
 *
 * The host must then be a valid IPv4, IPv6 or RFC 1123 hostname — anything
 * else (scrubbed values, "*", whitespace, a unix socket path) is null. A
 * port outside 1..65535 is dropped (null); a non-numeric port rejects the
 * whole value.
 */
export function parseHostAndPort(raw: unknown): ParsedHostAndPort | null {
  const hosts: Array<ParsedHostAndPort> | null = parseAddressHosts(raw, false);
  return hosts && hosts.length > 0 ? hosts[0]! : null;
}

/**
 * Every host a raw address names, deduplicated and in canonical order —
 * one entry for a single host, several for a host list — or null when the
 * value (or any host in its list) is unparseable. The first entry is what
 * parseHostAndPort returns.
 */
export function parseHostAndPortList(
  raw: unknown,
): Array<ParsedHostAndPort> | null {
  return parseAddressHosts(raw, false);
}

// ---- host classification -------------------------------------------------

/** True for an IPv4 or IPv6 literal (brackets and a `\instance` tolerated). */
export function isIpLiteralHost(host: string): boolean {
  if (typeof host !== "string") {
    return false;
  }
  const value: string = splitDatabaseHostInstance(host.trim())
    .host.trim()
    .replace(/^\[(.*)\]$/, "$1");
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
  let value: string = splitDatabaseHostInstance(
    host.trim().toLowerCase(),
  ).host.trim();
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

/*
 * `host.<tool>.internal`: minikube, k3d, Lima, OrbStack, Rancher Desktop —
 * the per-machine gateway name of each local Kubernetes / container tool.
 * Checked with string operations (the tool label is one RFC 1123 label).
 */
function isHostGatewayName(value: string): boolean {
  const labels: Array<string> = value.split(".");
  return (
    labels.length === 3 &&
    labels[0] === "host" &&
    labels[2] === "internal" &&
    DNS_LABEL_REGEX.test(labels[1]!)
  );
}

/**
 * host.docker.internal and the other "the machine I run on" names: every
 * `*.docker.internal` name, every `host.<tool>.internal` name (minikube,
 * k3d, Lima, OrbStack, Rancher Desktop) and Podman's
 * host.containers.internal.
 */
export function isHostRelativeDatabaseHost(host: string): boolean {
  if (typeof host !== "string") {
    return false;
  }
  const value: string = trimTrailingCharacter(
    splitDatabaseHostInstance(host.trim().toLowerCase()).host.trim(),
    ".",
  );
  return (
    HOST_RELATIVE_NAMES.has(value) ||
    value.endsWith(DOCKER_DESKTOP_SUFFIX) ||
    isHostGatewayName(value)
  );
}

function stripBracketsAndInstance(host: string): string {
  return splitDatabaseHostInstance(host.trim())
    .host.trim()
    .replace(/^\[(.*)\]$/, "$1");
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
  const value: string = stripBracketsAndInstance(host);

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

/**
 * Link-local addresses — IPv4 169.254/16 and IPv6 fe80::/10 (zone id
 * dropped). Every network link has its own, so one never identifies a
 * server on its own (always LOCAL scope, see getDatabaseEndpointScope).
 */
export function isLinkLocalIpHost(host: string): boolean {
  if (typeof host !== "string") {
    return false;
  }
  const value: string = stripBracketsAndInstance(host);

  const octets: Array<number> | null = parseIpv4Octets(value);
  if (octets) {
    return octets[0] === 169 && octets[1] === 254;
  }

  const canonical: string | null = value.includes(":")
    ? canonicalizeIpv6(value)
    : null;
  if (!canonical) {
    return false;
  }
  if (!canonical.includes(":")) {
    return isLinkLocalIpHost(canonical);
  }
  const groups: Array<number> | null = parseIpv6Groups(canonical);
  return groups !== null && (groups[0]! & 0xffc0) === 0xfe80;
}

function isSingleLabelName(host: string): boolean {
  return !host.includes(".") && !isIpLiteralHost(host);
}

/**
 * True for a host that only resolves inside one Kubernetes cluster or
 * private network — cluster-local DNS and the other private DNS zones
 * (NETWORK_SCOPED_NAME_SUFFIXES), private IPs and link-local IPs — and so
 * is qualified with the caller's cluster (`…@<cluster>`), or LOCAL scope
 * without one. A `\instance` is ignored.
 */
export function isClusterScopedDatabaseHost(host: string): boolean {
  if (typeof host !== "string") {
    return false;
  }
  const value: string = trimTrailingCharacter(
    splitDatabaseHostInstance(host.trim().toLowerCase()).host.trim(),
    ".",
  );
  if (!value) {
    return false;
  }
  for (const suffix of NETWORK_SCOPED_NAME_SUFFIXES) {
    if (value.endsWith(suffix)) {
      return true;
    }
  }
  return isPrivateIpHost(value) || isLinkLocalIpHost(value);
}

/**
 * True when the caller runs in Kubernetes as far as its context tells: it
 * has a namespace or a cluster (or the discovery query said so, see
 * DatabaseCallerContext.runsInKubernetes).
 */
export function isKubernetesDatabaseCaller(
  caller: DatabaseCallerContext | null | undefined,
): boolean {
  if (!caller) {
    return false;
  }
  return (
    caller.runsInKubernetes === true ||
    isNonBlankText(caller.kubernetesNamespace) ||
    canonicalClusterName(caller.kubernetesClusterName).length > 0
  );
}

/*
 * `<pod>-<ordinal>.<service>`: a two-label name whose first label is a
 * StatefulSet pod (`mongo-0`, `redis-node-2`) and whose second is the
 * headless Service of the same release (`mongo`, `mongo-headless`,
 * `redis-headless` — the same first dash-separated word) — a member in the
 * caller's own namespace, not a Service in another one.
 */
function isStatefulSetMemberShortName(labels: Array<string>): boolean {
  const pod: string = labels[0]!;
  const dash: number = pod.lastIndexOf("-");
  if (dash <= 0 || dash === pod.length - 1) {
    return false;
  }
  if (!DIGITS_ONLY_REGEX.test(pod.substring(dash + 1))) {
    return false;
  }
  const release: string = pod.split("-")[0]!;
  return release.length > 0 && labels[1]!.split("-")[0] === release;
}

/*
 * Rule 3 (Kubernetes DNS): any `<a>.<b>.svc[.<domain>]` (and the member form
 * `<pod>.<svc>.<ns>.svc[.<domain>]`) becomes `….svc.cluster.local`, so a
 * custom cluster domain and the short `.svc` form key like the FQDN; a
 * single-label name from a caller in a known namespace becomes that
 * namespace's Service FQDN. From a caller that runs in Kubernetes, a
 * two-label name is what the pod's resolver search path makes of it:
 * `<service>.<namespace>` → `<service>.<namespace>.svc.cluster.local`, and
 * a StatefulSet member of the caller's own namespace
 * (`mongo-0.mongo-headless`) → `mongo-0.mongo-headless.<ns>.svc.cluster.local`
 * (or, with no namespace known, the Service reading). Two-label names from
 * anything else — a VM, a laptop — are left alone: there they are domains.
 */
function applyKubernetesDnsRules(
  host: string,
  kubernetesNamespace: string | null | undefined,
  runsInKubernetes: boolean,
): string {
  const serviceMatch: RegExpExecArray | null =
    KUBERNETES_SERVICE_DNS_REGEX.exec(host);
  if (serviceMatch) {
    return `${serviceMatch[1]}${KUBERNETES_CLUSTER_DOMAIN_SUFFIX}`;
  }

  const namespace: string | null = canonicalDnsLabel(kubernetesNamespace);

  if (isSingleLabelName(host)) {
    if (namespace) {
      return `${host}.${namespace}${KUBERNETES_CLUSTER_DOMAIN_SUFFIX}`;
    }
    return host;
  }

  if (!runsInKubernetes) {
    return host;
  }

  const labels: Array<string> = host.split(".");
  if (
    labels.length !== 2 ||
    !DNS_LABEL_REGEX.test(labels[0]!) ||
    !DNS_LABEL_REGEX.test(labels[1]!) ||
    NON_NAMESPACE_TOP_LABELS.has(labels[1]!)
  ) {
    return host;
  }

  if (namespace && isStatefulSetMemberShortName(labels)) {
    return `${host}.${namespace}${KUBERNETES_CLUSTER_DOMAIN_SUFFIX}`;
  }

  return `${host}${KUBERNETES_CLUSTER_DOMAIN_SUFFIX}`;
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

/**
 * The SQL Server named instance a client span names beside its address —
 * `db.mssql.instance_name`, else the instance half of a `db.namespace` of
 * the form `instance|database` — or null. Only for SQL Server: other
 * engines give `db.namespace` other meanings. Returned raw (untrimmed);
 * canonicalizeDatabaseEndpoint validates it. Pass the result as its
 * `instance`, and include DATABASE_INSTANCE_ATTRIBUTES in anything that
 * memoizes on the attributes it reads.
 */
export function readDatabaseInstanceName(input: {
  system: unknown;
  getAttribute: (key: string) => unknown;
}): string | null {
  if (!input || typeof input.getAttribute !== "function") {
    return null;
  }
  if (normalizeDatabaseSystem(input.system) !== SQL_SERVER_SYSTEM) {
    return null;
  }

  const toText: (value: unknown) => string | null = (
    value: unknown,
  ): string | null => {
    if (typeof value === "string") {
      return value === "" ? null : value;
    }
    if (typeof value === "number") {
      return String(value);
    }
    return null;
  };

  const instanceName: string | null = toText(
    input.getAttribute(DATABASE_INSTANCE_NAME_ATTRIBUTE),
  );
  if (instanceName !== null) {
    return instanceName;
  }

  const namespace: string | null = toText(
    input.getAttribute(DATABASE_NAMESPACE_ATTRIBUTE),
  );
  if (namespace !== null) {
    const separator: number = namespace.indexOf("|");
    if (separator >= 0) {
      return namespace.substring(0, separator);
    }
  }

  return null;
}

// ---- canonicalization ----------------------------------------------------

/**
 * Canonicalize what a caller saw into a database endpoint, or null when it
 * names no identifiable server. Rules, in order:
 *
 *   1. parse the address; port = explicit port ?? parsed port ?? engine
 *      default ?? null. A SQL Server named instance (`host\instance` in the
 *      address, else `instance`, see readDatabaseInstanceName) is kept as
 *      part of the host only while no port is known — a port already names
 *      the instance — and then takes no default port;
 *   2. loopback / host-relative: for a client call → null (a per-caller
 *      sidecar, proxy or dev laptop); for a collector → the collector's own
 *      host.name when the collector is not ephemeral, else null;
 *   3. Kubernetes DNS expansion (see applyKubernetesDnsRules);
 *   4. cluster-local / private-network names and private IPs are qualified
 *      with the caller's `k8s.cluster.name` when it has one.
 */
export function canonicalizeDatabaseEndpoint(input: {
  system: string;
  address: string | null | undefined;
  port?: string | number | null | undefined;
  instance?: string | null | undefined;
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
  const knownPort: number | null = toValidPort(input.port) ?? parsed.port;

  let instance: string | null = null;
  if (knownPort === null) {
    const reported: string | null | undefined = canonicalInstanceName(
      input.instance,
    );
    instance = parsed.instance || (reported ? reported : null);
  }

  const port: number | null =
    knownPort ??
    (instance ? null : getDefaultDatabasePort(input.system)) ??
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

  host = applyKubernetesDnsRules(
    host,
    caller?.kubernetesNamespace,
    isKubernetesDatabaseCaller(caller),
  );

  const clusterName: string = isClusterScopedDatabaseHost(host)
    ? canonicalClusterName(caller?.kubernetesClusterName)
    : "";

  return buildEndpoint(joinHostInstance(host, instance), port, clusterName);
}

/**
 * "local" for an endpoint that only resolves inside one network or cluster
 * and carries nothing to say which: a single-label name, cluster-local or
 * private-zone DNS or a private IP without a cluster qualifier, a link-local
 * IP (per link, qualified or not) and loopback / host-relative names,
 * defensively. Local endpoints are still keyed (it is what the span says)
 * but never create a DatabaseServer row and never auto-match an alias.
 */
export function getDatabaseEndpointScope(
  endpoint: DatabaseEndpoint,
): DatabaseEndpointScope {
  const host: string =
    endpoint && typeof endpoint.host === "string"
      ? splitDatabaseHostInstance(endpoint.host.trim().toLowerCase()).host
      : "";

  if (!host) {
    return "local";
  }
  if (isLoopbackDatabaseHost(host) || isHostRelativeDatabaseHost(host)) {
    return "local";
  }
  if (isSingleLabelName(host) || isLinkLocalIpHost(host)) {
    return "local";
  }

  const hasCluster: boolean =
    canonicalClusterName(endpoint.kubernetesClusterName).length > 0;
  if (!hasCluster && isClusterScopedDatabaseHost(host)) {
    return "local";
  }

  return "global";
}

/**
 * "host:port", "host" (unknown port), "[v6]:port", "host\instance"; plus
 * "@cluster" when qualified. The inverse is parseDatabaseEndpointString.
 * The cluster part is kept verbatim apart from trim + lowercase (EKS names
 * are ARNs containing ":" and "/").
 */
export function formatDatabaseEndpoint(endpoint: DatabaseEndpoint): string {
  const value: { host: string; instance: string } = splitDatabaseHostInstance(
    endpoint && typeof endpoint.host === "string"
      ? endpoint.host.trim().toLowerCase()
      : "",
  );
  const hostPart: string = `${
    value.host.includes(":") ? `[${value.host}]` : value.host
  }${value.instance ? `\\${value.instance}` : ""}`;
  const port: number | null = toValidPort(endpoint?.port);
  const portPart: string = port !== null ? `:${port}` : "";
  const clusterName: string = canonicalClusterName(
    endpoint?.kubernetesClusterName,
  );
  return `${hostPart}${portPart}${clusterName ? `@${clusterName}` : ""}`;
}

type EndpointStringProblem =
  | "empty"
  | "invalid"
  | "port-out-of-range"
  | "loopback"
  | "user-info"
  | "qualifier-needs-namespace"
  | "qualifier-not-allowed";

interface InterpretedEndpointString {
  endpoint: DatabaseEndpoint | null;
  problem: EndpointStringProblem | null;
  // The text before an "@", and after it, when the value had one.
  beforeAt: string;
  afterAt: string;
  // The canonical host the qualifier was refused for.
  refusedHost: string;
}

/*
 * `user@host`, not `host@cluster`: the part after the "@" reads as a server
 * (it has a port or a dot, or is an IP) while the part before it does not
 * read as an address that takes a qualifier (one with a port, an IP, a
 * cluster-local or private-zone name, a `.svc` name) — `admin@10.0.0.5:5432`,
 * `john.doe@db.example.com`. Cluster names such as `prod-eu`, and ARNs
 * (which never parse as a host), never look like a server.
 */
function looksLikeUserInfo(beforeAt: string, afterAt: string): boolean {
  if (!beforeAt) {
    return false;
  }

  const server: ParsedHostAndPort | null = parseHostAndPort(afterAt);
  if (
    !server ||
    !(
      server.port !== null ||
      server.host.includes(".") ||
      server.host.includes(":") ||
      isIpLiteralHost(server.host)
    )
  ) {
    return false;
  }

  // A bare word ("admin") is a user name.
  if (!NOT_A_BARE_WORD_REGEX.test(beforeAt)) {
    return true;
  }

  const address: ParsedHostAndPort | null = parseHostAndPort(beforeAt);
  if (!address) {
    return true;
  }
  return (
    address.port === null &&
    !isIpLiteralHost(address.host) &&
    !isClusterScopedDatabaseHost(address.host) &&
    !KUBERNETES_SERVICE_DNS_REGEX.test(address.host)
  );
}

function interpretDatabaseEndpointString(
  value: unknown,
  context: {
    system: string;
    kubernetesClusterName?: string | null | undefined;
    kubernetesNamespace?: string | null | undefined;
    port?: number | null | undefined;
  },
  strictPort: boolean,
): InterpretedEndpointString {
  const result: InterpretedEndpointString = {
    endpoint: null,
    problem: null,
    beforeAt: "",
    afterAt: "",
    refusedHost: "",
  };

  if (typeof value !== "string" || !value.trim()) {
    result.problem = "empty";
    return result;
  }

  const trimmed: string = value.trim();
  let addressPart: string = trimmed;
  let explicitClusterName: string = "";

  if (!URL_SCHEME_REGEX.test(trimmed)) {
    const atIndex: number = trimmed.lastIndexOf("@");
    if (atIndex >= 0) {
      addressPart = trimmed.substring(0, atIndex);
      result.beforeAt = addressPart.trim();
      result.afterAt = trimmed.substring(atIndex + 1).trim();
      explicitClusterName = canonicalClusterName(result.afterAt);
    }
  }

  if (
    explicitClusterName &&
    looksLikeUserInfo(result.beforeAt, result.afterAt)
  ) {
    result.problem = "user-info";
    return result;
  }

  const hosts: Array<ParsedHostAndPort> | null = parseAddressHosts(
    addressPart,
    strictPort,
  );
  const parsed: ParsedHostAndPort | null =
    hosts && hosts.length > 0 ? hosts[0]! : null;
  if (!parsed) {
    result.problem =
      strictPort && parseHostAndPort(addressPart)
        ? "port-out-of-range"
        : "invalid";
    return result;
  }
  if (
    isLoopbackDatabaseHost(parsed.host) ||
    isHostRelativeDatabaseHost(parsed.host)
  ) {
    result.problem = "loopback";
    return result;
  }

  const knownPort: number | null = toValidPort(context?.port) ?? parsed.port;
  const instance: string | null =
    knownPort === null && parsed.instance ? parsed.instance : null;
  const port: number | null =
    knownPort ??
    (instance ? null : getDefaultDatabasePort(context?.system)) ??
    null;

  const rowClusterName: string = canonicalClusterName(
    context?.kubernetesClusterName,
  );

  /*
   * An explicit "@cluster" says the name was seen from inside that
   * cluster, so it is read the way a pod there reads it.
   */
  const runsInKubernetes: boolean =
    explicitClusterName.length > 0 ||
    rowClusterName.length > 0 ||
    isNonBlankText(context?.kubernetesNamespace);

  const host: string = applyKubernetesDnsRules(
    parsed.host,
    context?.kubernetesNamespace,
    runsInKubernetes,
  );

  const clusterScoped: boolean = isClusterScopedDatabaseHost(host);

  if (explicitClusterName && !clusterScoped) {
    result.problem = isSingleLabelName(host)
      ? "qualifier-needs-namespace"
      : "qualifier-not-allowed";
    result.refusedHost = host;
    return result;
  }

  result.endpoint = buildEndpoint(
    joinHostInstance(host, instance),
    port,
    clusterScoped ? explicitClusterName || rowClusterName : "",
  );
  return result;
}

/**
 * Inverse of formatDatabaseEndpoint, for stored values AND user-typed
 * aliases. The cluster qualifier is split on the LAST "@" and is only valid
 * on a host that resolves inside one cluster or network
 * (isClusterScopedDatabaseHost, after the Kubernetes DNS rules): anything
 * else with an "@" — `admin@10.0.0.5:5432`, `db.example.com@prod` — is
 * null, never a silently dropped qualifier or a user name read as a host.
 * URL forms are not split: their "@" is userinfo. Kubernetes DNS rules use
 * the row's namespace for a single-label name, and read a two-label name as
 * `<service>.<namespace>` when the row (or the qualifier) is a Kubernetes
 * one; an unqualified cluster-scoped host takes the row's cluster, and the
 * port defaults from the engine. Loopback and host-relative names are null —
 * an alias must name a server.
 */
export function parseDatabaseEndpointString(
  value: unknown,
  context: {
    system: string;
    kubernetesClusterName?: string | null | undefined;
    kubernetesNamespace?: string | null | undefined;
  },
): DatabaseEndpoint | null {
  return interpretDatabaseEndpointString(value, context, false).endpoint;
}

export interface ManualDatabaseEndpoint {
  // The canonical endpoint, or null when the value was rejected.
  endpoint: DatabaseEndpoint | null;
  // Why it was rejected, worded for the person who typed it; null when accepted.
  error: string | null;
  /*
   * Set when the accepted endpoint only resolves inside one Kubernetes
   * cluster or private network and names no cluster (LOCAL scope):
   * applications whose telemetry reports `k8s.cluster.name` are keyed
   * `<endpoint>@<cluster>` instead and will not match it. Advice — the
   * caller decides whether to show it or to refuse the value.
   */
  clusterQualifierHint: string | null;
}

function echo(value: string): string {
  return value.length > MAX_ECHOED_VALUE_LENGTH
    ? `${value.substring(0, MAX_ECHOED_VALUE_LENGTH)}…`
    : value;
}

const CLUSTER_QUALIFIER_EXAMPLE: string =
  "pg.shop.svc.cluster.local:5432@prod-eu";

/**
 * The endpoint a person typed (the create form of a manually added
 * database, an alias on its Endpoints tab), with a message that says what
 * to change when it cannot be used:
 *
 *   - `user@host` (`admin@10.0.0.5:5432`) is refused — the user name does
 *     not belong in an endpoint;
 *   - `@<cluster>` names the Kubernetes cluster of an address that only
 *     resolves inside one (a cluster-local name, a `<service>.<namespace>`
 *     short name, a private-zone name, a private IP) and is refused on
 *     anything else;
 *   - loopback and host-relative names are refused;
 *   - `port` (the form's own port field) replaces any port in the address,
 *     and must be 1..65535, as must a port typed in the address.
 *
 * Accepted values are canonicalized exactly like parseDatabaseEndpointString.
 * `knownClusterNames` (the project's Kubernetes cluster names) are offered
 * in the hint for an unqualified cluster-scoped endpoint.
 */
export function parseManualDatabaseEndpoint(
  value: unknown,
  context: {
    system: string;
    port?: unknown;
    kubernetesClusterName?: string | null | undefined;
    kubernetesNamespace?: string | null | undefined;
    knownClusterNames?: Array<string> | null | undefined;
  },
): ManualDatabaseEndpoint {
  const rejected: (error: string) => ManualDatabaseEndpoint = (
    error: string,
  ): ManualDatabaseEndpoint => {
    return { endpoint: null, error: error, clusterQualifierHint: null };
  };

  const typed: string = typeof value === "string" ? value.trim() : "";

  const hasPortField: boolean =
    context?.port !== undefined &&
    context?.port !== null &&
    !(typeof context.port === "string" && context.port.trim() === "");
  let portField: number | null = null;
  if (hasPortField) {
    portField = toValidPort(context.port);
    if (portField === null) {
      return rejected(
        "Server port must be a whole number between 1 and 65535.",
      );
    }
  }

  const interpreted: InterpretedEndpointString =
    interpretDatabaseEndpointString(
      value,
      {
        system: context?.system || "",
        kubernetesClusterName: context?.kubernetesClusterName,
        kubernetesNamespace: context?.kubernetesNamespace,
        port: portField,
      },
      !hasPortField,
    );

  switch (interpreted.problem) {
    case "empty":
      return rejected(
        "Server address is required. Enter the host name or IP address applications use to reach this database, for example orders-db.example.com:5432.",
      );
    case "user-info":
      return rejected(
        `"${echo(typed)}" looks like user@host. Remove "${echo(
          interpreted.beforeAt,
        )}@": the database user does not belong in an endpoint. "@" is only used after an address that resolves inside one Kubernetes cluster, to name that cluster, for example ${CLUSTER_QUALIFIER_EXAMPLE}.`,
      );
    case "qualifier-needs-namespace":
      return rejected(
        `"${echo(interpreted.refusedHost)}" is a single-label name, which only means one Service once its namespace is known. Enter it with the namespace, for example ${echo(
          interpreted.refusedHost,
        )}.<namespace>@${echo(interpreted.afterAt)}.`,
      );
    case "qualifier-not-allowed":
      return rejected(
        `"${echo(interpreted.refusedHost)}" resolves the same way everywhere, so it cannot take a Kubernetes cluster qualifier. Remove "@${echo(
          interpreted.afterAt,
        )}". A cluster is only named for an address that resolves inside one cluster or private network: a cluster-local name such as pg.shop.svc.cluster.local, a <service>.<namespace> short name, a .internal or .local name, or a private IP address.`,
      );
    case "loopback":
      return rejected(
        `"${echo(typed)}" is a loopback or host-local address, such as localhost or host.docker.internal. Every application reaches its own, so it cannot identify one database. Enter the host name or IP address the database is reached at from other machines.`,
      );
    case "port-out-of-range":
      return rejected(
        `"${echo(typed)}" has a port outside 1-65535. Enter a port between 1 and 65535.`,
      );
    case "invalid":
      return rejected(
        `"${echo(typed)}" is not a valid host[:port] endpoint. Enter a host name or IP address with an optional port, for example orders-db.example.com:5432. A SQL Server named instance is written host\\instance, and an address that resolves inside one Kubernetes cluster can name that cluster: ${CLUSTER_QUALIFIER_EXAMPLE}.`,
      );
    default:
      break;
  }

  const endpoint: DatabaseEndpoint | null = interpreted.endpoint;
  if (!endpoint) {
    return rejected(`"${echo(typed)}" is not a valid host[:port] endpoint.`);
  }

  let clusterQualifierHint: string | null = null;
  if (
    !endpoint.kubernetesClusterName &&
    isClusterScopedDatabaseHost(endpoint.host)
  ) {
    const formatted: string = formatDatabaseEndpoint(endpoint);
    const clusters: Array<string> = Array.from(
      new Set<string>(
        (Array.isArray(context?.knownClusterNames)
          ? context.knownClusterNames
          : []
        )
          .map(canonicalClusterName)
          .filter((name: string): boolean => {
            return name.length > 0;
          }),
      ),
    );
    clusterQualifierHint = `${formatted} only resolves inside one Kubernetes cluster or private network. Applications that report their cluster (k8s.cluster.name) are matched to ${formatted}@<cluster name> instead, so name the cluster the way they report it${
      clusters.length > 0
        ? `, for example ${formatted}@${clusters[0]} (this project's clusters: ${clusters.join(", ")})`
        : ""
    }.`;
  }

  return {
    endpoint: endpoint,
    error: null,
    clusterQualifierHint: clusterQualifierHint,
  };
}

// ---- managed cluster members ---------------------------------------------

/**
 * The cluster a managed-service MEMBER host belongs to, as a host name, or
 * null for anything else. Drivers of replicated databases report the member
 * that served each call, so without this every member of one cluster would
 * become a database of its own. Today: MongoDB Atlas —
 * `cluster0-shard-00-01.ab1cd.mongodb.net` → `cluster0.ab1cd.mongodb.net`
 * (the cluster's SRV name). A `\instance` or a port plays no part.
 */
export function getDatabaseClusterHost(host: string): string | null {
  if (typeof host !== "string") {
    return null;
  }
  const value: string = splitDatabaseHostInstance(
    host.trim().toLowerCase(),
  ).host;
  const labels: Array<string> = value.split(".");
  if (
    labels.length !== 4 ||
    `${labels[2]}.${labels[3]}` !== ATLAS_DOMAIN ||
    !DNS_LABEL_REGEX.test(labels[1]!)
  ) {
    return null;
  }
  const member: string = labels[0]!;
  const marker: number = member.lastIndexOf(ATLAS_MEMBER_MARKER);
  if (marker <= 0) {
    return null;
  }
  if (
    !ATLAS_MEMBER_NUMBER_REGEX.test(
      member.substring(marker + ATLAS_MEMBER_MARKER.length),
    )
  ) {
    return null;
  }
  const cluster: string = member.substring(0, marker);
  return DNS_LABEL_REGEX.test(cluster)
    ? `${cluster}.${labels[1]}.${ATLAS_DOMAIN}`
    : null;
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
 * two-label `${svc}.${ns}` forms are needed: a pod calling `svc.ns` is
 * canonicalized to the Service FQDN (applyKubernetesDnsRules), which is
 * already here. Invalid DNS labels are skipped. Deduped, in a stable order.
 * With a blank cluster name only the unqualified form can be produced, so
 * it is.
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
