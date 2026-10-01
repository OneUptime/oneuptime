import net from "net";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
  ALL_AI_RESOURCE_TYPES,
  AiResourceTypeInfo,
  isDefaultIdentityPlaceholder,
  parseAiResourceType,
} from "./Common/Types/ResourceAiAgent/AiResourceType";
import {
  MAX_POSTURE_LIST_ENTRIES,
  MAX_POSTURE_STRING_LENGTH,
  RESOURCE_AI_AGENT_API_KEY_ENVS,
  RESOURCE_AI_AGENT_DEFAULT_HEALTH_PORT,
  RESOURCE_AI_AGENT_RESOURCE_NAME_ENV,
  RESOURCE_AI_AGENT_RESOURCE_TYPE_ENV,
  RESOURCE_AI_ALLOW_WRITES_ENV,
  RESOURCE_AI_WRITE_TARGETS_ENV,
} from "./Common/Types/ResourceAiAgent/ResourceAiAccess";

/*
 * The agent's configuration, read from the environment. The agent runs as a
 * sidecar of a resource's telemetry collector and shares its .env, so it
 * reads the collector's own variables (ONEUPTIME_URL, the ingestion key,
 * DOCKER_HOST_NAME, CEPH_CLUSTER_NAME, DATABASE_SERVER_ADDRESS, ...) plus a
 * few of its own (ONEUPTIME_AI_*), all named in
 * Common/Types/ResourceAiAgent.
 *
 * Parsing never throws. A missing URL, key, resource type or identity is
 * reported as a problem instead: the agent logs it, keeps its health server
 * up and does nothing else — it never crash-loops, so a compose stack with
 * `restart: unless-stopped` does not spin, and the reason is one readable
 * line in `docker logs`.
 */

export const ONEUPTIME_URL_ENV: string = "ONEUPTIME_URL";
export const POLL_INTERVAL_ENV: string = "ONEUPTIME_AI_AGENT_POLL_INTERVAL_MS";
export const HEARTBEAT_INTERVAL_ENV: string =
  "ONEUPTIME_AI_AGENT_HEARTBEAT_INTERVAL_MS";
/*
 * The address the health server listens on. Loopback by default: every
 * check (the compose healthcheck, `docker exec ... wget 127.0.0.1`, `curl
 * 127.0.0.1` on a host-network agent) runs on the agent's own network
 * namespace, and /status names the agent, its resource and its write
 * settings — which, for an agent on the host's network (the Host AI agent,
 * or a collector's with network_mode: host), would otherwise be served on
 * every interface of the host. 0.0.0.0 (or ::) serves it everywhere, to
 * publish the port.
 */
export const HEALTH_HOST_ENV: string = "ONEUPTIME_AI_AGENT_HEALTH_HOST";
export const DEFAULT_HEALTH_HOST: string = "127.0.0.1";
/*
 * Extra targets (comma-separated globs) OneUptime AI must never change, on
 * top of the ones the executor finds itself (the agent's own container, the
 * collector next to it, ...). Reported in the posture's protectedTargets.
 */
export const PROTECTED_TARGETS_ENV: string = "ONEUPTIME_AI_PROTECTED_TARGETS";

// The database collector's identity variables (AiResourceTypeInfo.identityEnvVars).
export const DATABASE_SERVER_ID_ENV: string = "DATABASE_SERVER_ID";
export const DATABASE_SYSTEM_ENV: string = "DATABASE_SYSTEM";
export const DATABASE_SERVER_ADDRESS_ENV: string = "DATABASE_SERVER_ADDRESS";
export const DATABASE_SERVER_PORT_ENV: string = "DATABASE_SERVER_PORT";

// How a database endpoint identity names its source, in logs and /status.
export const DATABASE_ENDPOINT_IDENTITY_SOURCE: string = `${DATABASE_SYSTEM_ENV}+${DATABASE_SERVER_ADDRESS_ENV}+${DATABASE_SERVER_PORT_ENV}`;

export const DEFAULT_PORT: number = RESOURCE_AI_AGENT_DEFAULT_HEALTH_PORT;
export const DEFAULT_POLL_INTERVAL_MS: number = 3_000;
export const MIN_POLL_INTERVAL_MS: number = 1_000;
export const DEFAULT_HEARTBEAT_INTERVAL_MS: number = 30_000;
export const MIN_HEARTBEAT_INTERVAL_MS: number = 5_000;

// Facts about the resource's identity the server may use to find its row.
export type IdentityDetails = Record<string, string | number | null>;

export interface AgentConfig {
  // Base URL of OneUptime, without a trailing slash.
  oneuptimeUrl: string;
  // The first non-empty of RESOURCE_AI_AGENT_API_KEY_ENVS: the ingestion key.
  apiKey: string;
  // Which variable the key came from (never the key), or null.
  apiKeySource: string | null;
  // The resource this agent serves; null when unset or unknown (a problem).
  resourceType: AiResourceType | null;
  // RESOURCE_AI_AGENT_RESOURCE_TYPE_ENV exactly as set (null when unset).
  resourceTypeSetting: string | null;
  /*
   * The identity the agent registers with — the one the collector reports,
   * so the agent claims exactly the row the collector's telemetry created.
   * Null for a Host whose HOST_NAME is unset: the agent then asks its
   * executor (the host's own hostname) at start-up and writes the answer
   * here, where the executor, which holds this same object, reads it too.
   */
  resourceIdentifier: string | null;
  // Where the identity came from (an env var name, "executor"), or null.
  identitySource: string | null;
  /*
   * The resource's OneUptime id when the operator pinned it
   * (DATABASE_SERVER_ID), sent on registration; null otherwise.
   */
  resourceId: string | null;
  /*
   * Identity facts reported in the posture's details (databaseSystem,
   * serverAddress, serverPort), so the server can resolve the row.
   */
  identityDetails: IdentityDetails;
  /*
   * Whether AI-composed writes may run. Only "true" allows them; unset,
   * "false" and anything else (a typo, "yes", "readonly") refuse — a
   * security switch must never read a plausible "off" as "on".
   */
  allowWrites: boolean;
  // The switch exactly as set (null when unset), for refusal messages.
  allowWritesSetting: string | null;
  /*
   * RESOURCE_AI_WRITE_TARGETS_ENV as globs: trimmed, without blanks or
   * duplicates, case kept (target globs match case-sensitively). Empty
   * means any target except the protected ones.
   */
  writeTargets: Array<string>;
  // PROTECTED_TARGETS_ENV, parsed the same way.
  protectedTargets: Array<string>;
  port: number;
  // HEALTH_HOST_ENV: an IP address (DEFAULT_HEALTH_HOST when unset or not one).
  healthHost: string;
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  // This build's version (APP_VERSION, set in the image), or null.
  agentVersion: string | null;
}

export interface ParsedConfig {
  config: AgentConfig;
  /*
   * What stops the agent from working at all (a missing required value).
   * Non-empty means: log these, keep the health server up, do nothing else.
   */
  problems: Array<string>;
  // Worth saying once at start-up, but not fatal.
  warnings: Array<string>;
}

export interface ResolvedIdentity {
  identifier: string | null;
  source: string | null;
  resourceId: string | null;
  details: IdentityDetails;
  problems: Array<string>;
  warnings: Array<string>;
}

export interface ParsedTargetList {
  targets: Array<string>;
  /*
   * Why the list breaks the posture's bounds (more than
   * MAX_POSTURE_LIST_ENTRIES entries, or one longer than
   * MAX_POSTURE_STRING_LENGTH), or null. The server reads such a list as
   * malformed and treats the agent as read-only, so the agent does too.
   */
  problem: string | null;
}

// A whole number written in digits only.
const DIGITS_PATTERN: RegExp = /^\d+$/;

// A OneUptime id: a UUID, any case.
const UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Where the operator sets these: the .env the agent shares with the collector.
const WHERE_TO_SET: string =
  "in the .env file the AI agent shares with the collector (or the agent container's environment)";

function readTrimmed(env: NodeJS.ProcessEnv, name: string): string {
  return (env[name] || "").trim();
}

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value.trim());
}

// Only "true" (any case, whitespace ignored) turns a switch on.
export function parseSwitch(value: string | null | undefined): boolean {
  return (value || "").trim().toLowerCase() === "true";
}

/*
 * A comma-separated list of target globs: trimmed, without blanks or
 * duplicates, case kept. A list over the posture's bounds is reported, not
 * silently cut: dropping an entry would change what a write may touch.
 */
export function parseTargetList(
  value: string | null | undefined,
  name: string,
): ParsedTargetList {
  const targets: Array<string> = [];
  let tooLong: string | null = null;

  for (const part of (value || "").split(",")) {
    const target: string = part.trim();

    if (!target) {
      continue;
    }

    if (target.length > MAX_POSTURE_STRING_LENGTH) {
      tooLong = tooLong || target;
      continue;
    }

    if (!targets.includes(target)) {
      targets.push(target);
    }
  }

  if (tooLong !== null) {
    return {
      targets: targets.slice(0, MAX_POSTURE_LIST_ENTRIES),
      problem: `${name} has an entry longer than ${MAX_POSTURE_STRING_LENGTH} characters ("${tooLong.slice(0, 40)}...").`,
    };
  }

  if (targets.length > MAX_POSTURE_LIST_ENTRIES) {
    return {
      targets: targets.slice(0, MAX_POSTURE_LIST_ENTRIES),
      problem: `${name} has ${targets.length} entries; at most ${MAX_POSTURE_LIST_ENTRIES} are allowed.`,
    };
  }

  return { targets, problem: null };
}

/*
 * A whole number of milliseconds, raised to the minimum; anything that is
 * not a positive whole number falls back to the default.
 */
export function parseInterval(data: {
  value: string | undefined;
  defaultValue: number;
  min: number;
}): number {
  const raw: string = (data.value || "").trim();

  if (!DIGITS_PATTERN.test(raw)) {
    return data.defaultValue;
  }

  const parsed: number = parseInt(raw, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return data.defaultValue;
  }

  return Math.max(parsed, data.min);
}

export function parsePort(value: string | undefined): number {
  const raw: string = (value || "").trim();
  const parsed: number = DIGITS_PATTERN.test(raw) ? parseInt(raw, 10) : NaN;

  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536
    ? parsed
    : DEFAULT_PORT;
}

/*
 * HEALTH_HOST_ENV as the address to listen on, and what is wrong with it: an
 * IPv4 or IPv6 address (brackets allowed), else DEFAULT_HEALTH_HOST — a
 * name or a typo must neither stop the health server from starting nor
 * open it wider than asked.
 */
export function parseHealthHost(value: string | undefined): {
  host: string;
  problem: string | null;
} {
  const raw: string = (value || "").trim();

  if (!raw) {
    return { host: DEFAULT_HEALTH_HOST, problem: null };
  }

  const address: string =
    raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1) : raw;

  if (net.isIP(address) !== 0) {
    return { host: address, problem: null };
  }

  return {
    host: DEFAULT_HEALTH_HOST,
    problem: `${HEALTH_HOST_ENV}="${raw}" is not an IP address, so the health server listens on ${DEFAULT_HEALTH_HOST}. Set it to an address such as 0.0.0.0 to serve it on every interface.`,
  };
}

// A TCP port 1-65535 written in digits, or null.
export function parseTcpPort(value: string | undefined): number | null {
  const raw: string = (value || "").trim();

  if (!DIGITS_PATTERN.test(raw)) {
    return null;
  }

  const parsed: number = parseInt(raw, 10);

  return parsed >= 1 && parsed <= 65535 ? parsed : null;
}

export function normalizeOneUptimeUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed: URL = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/*
 * A set switch that is neither "true" nor "false" already refuses; say so
 * once, so nobody has to guess what "yes" or "enabled" did.
 */
function describeUnrecognisedSwitch(data: {
  name: string;
  value: string | null;
  what: string;
}): string | null {
  if (
    data.value === null ||
    data.value.trim() === "" ||
    ["true", "false"].includes(data.value.trim().toLowerCase())
  ) {
    return null;
  }

  return `${data.name}="${data.value}" is not "true" or "false", so ${data.what} stay off. Set it to "true" to allow them.`;
}

function describeResourceTypes(): string {
  return ALL_AI_RESOURCE_TYPES.map((type: AiResourceType): string => {
    return AI_RESOURCE_TYPE_INFO[type].agentAlias;
  }).join(", ");
}

/*
 * The database host as the server's endpoint identity spells it: trimmed,
 * lowercased, without a trailing dot, an IPv6 address in brackets. The
 * server canonicalizes further (engine family, default port, cluster
 * qualification) when it resolves the row.
 */
export function formatDatabaseHost(host: string): string {
  let value: string = host.trim().toLowerCase();

  if (value.startsWith("[") && value.endsWith("]")) {
    value = value.slice(1, -1);
  }

  value = value.replace(/\.+$/, "");

  return value.includes(":") ? `[${value}]` : value;
}

// "host:port" (a host name, IPv4 or SQL Server "host\instance", no IPv6).
const DATABASE_HOST_WITH_PORT_PATTERN: RegExp = /^([^:[\],]+):(\d+)$/;
// "[v6]" or "[v6]:port".
const DATABASE_BRACKETED_HOST_PATTERN: RegExp = /^\[([^\]]+)\](?::(\d+))?$/;
// SQL Server's "host,port".
const DATABASE_HOST_COMMA_PORT_PATTERN: RegExp = /^([^,:[\]]+),\s*(\d+)$/;

/*
 * DATABASE_SERVER_ADDRESS and DATABASE_SERVER_PORT as the endpoint the
 * collector's own telemetry names: the collector stamps them as
 * server.address and server.port, and the server splits a port written in
 * the address ("db.example.com:5433", "[2001:db8::1]:5433", SQL Server's
 * "host,1433") off the host, the explicit port winning over it. The host is
 * then formatted (formatDatabaseHost). A port out of range in the address
 * is dropped, as the server drops it. Any other form (a URL, a host list)
 * is left whole, for the server to read.
 */
export function resolveDatabaseServerEndpoint(data: {
  address: string;
  port: number | null;
}): { host: string; port: number | null } {
  const value: string = data.address.trim();
  const match: RegExpMatchArray | null =
    value.match(DATABASE_BRACKETED_HOST_PATTERN) ||
    value.match(DATABASE_HOST_WITH_PORT_PATTERN) ||
    value.match(DATABASE_HOST_COMMA_PORT_PATTERN);

  if (!match) {
    return { host: formatDatabaseHost(value), port: data.port };
  }

  const addressPort: number | null =
    match[2] === undefined ? null : parseTcpPort(match[2]);

  return {
    host: formatDatabaseHost(match[1] || ""),
    port: data.port ?? addressPort,
  };
}

/*
 * "<system>|<address>[:<port>]", the form DatabaseServer.databaseIdentifier
 * takes for an endpoint row (buildDatabaseServerIdentifier:
 * `${family}|${formatDatabaseEndpoint(endpoint)}`). The system is sent as
 * configured (lowercased); the server maps it to its engine family. The
 * address may carry its own port (resolveDatabaseServerEndpoint).
 */
export function buildDatabaseEndpointIdentifier(data: {
  system: string;
  address: string;
  port: number | null;
}): string {
  const endpoint: { host: string; port: number | null } =
    resolveDatabaseServerEndpoint({ address: data.address, port: data.port });

  return `${data.system.trim().toLowerCase()}|${endpoint.host}${
    endpoint.port !== null ? `:${endpoint.port}` : ""
  }`;
}

function resolveDatabaseIdentity(
  env: NodeJS.ProcessEnv,
  override: string,
): ResolvedIdentity {
  const problems: Array<string> = [];
  const warnings: Array<string> = [];
  const system: string = readTrimmed(env, DATABASE_SYSTEM_ENV).toLowerCase();
  const address: string = readTrimmed(env, DATABASE_SERVER_ADDRESS_ENV);
  const portSetting: string = readTrimmed(env, DATABASE_SERVER_PORT_ENV);
  const port: number | null = parseTcpPort(portSetting);
  const serverId: string = readTrimmed(env, DATABASE_SERVER_ID_ENV);
  // The port may also be written in the address ("db.example.com:5433").
  const endpoint: { host: string; port: number | null } | null = address
    ? resolveDatabaseServerEndpoint({ address, port })
    : null;

  const details: IdentityDetails = {};

  if (system) {
    details["databaseSystem"] = system;
  }

  if (endpoint) {
    details["serverAddress"] = endpoint.host;
  }

  if (endpoint && endpoint.port !== null) {
    details["serverPort"] = endpoint.port;
  }

  if (portSetting && port === null) {
    warnings.push(
      `${DATABASE_SERVER_PORT_ENV}="${portSetting}" is not a port (1-65535), so it is left out of this database's identity.`,
    );
  }

  if (override) {
    return {
      identifier: override,
      source: RESOURCE_AI_AGENT_RESOURCE_NAME_ENV,
      resourceId: isUuid(override) ? override.toLowerCase() : null,
      details,
      problems,
      warnings,
    };
  }

  if (serverId) {
    if (isUuid(serverId)) {
      return {
        identifier: serverId.toLowerCase(),
        source: DATABASE_SERVER_ID_ENV,
        resourceId: serverId.toLowerCase(),
        details,
        problems,
        warnings,
      };
    }

    warnings.push(
      `${DATABASE_SERVER_ID_ENV}="${serverId}" is not a database id (a UUID), so the agent ignores it (like the collector does) and registers the database by its endpoint. Copy the id from the database's Documentation tab in OneUptime.`,
    );
  }

  if (!system) {
    problems.push(
      `${DATABASE_SYSTEM_ENV} is not set. Set it ${WHERE_TO_SET} to the database engine (postgresql, mysql, redis, mongodb, ...), or set ${DATABASE_SERVER_ID_ENV} to the database's id in OneUptime.`,
    );
  }

  if (!address) {
    problems.push(
      `${DATABASE_SERVER_ADDRESS_ENV} is not set. Set it ${WHERE_TO_SET} to the host name your applications use for this database, or set ${DATABASE_SERVER_ID_ENV} to the database's id in OneUptime.`,
    );
  }

  if (!system || !address) {
    return {
      identifier: null,
      source: null,
      resourceId: null,
      details,
      problems,
      warnings,
    };
  }

  return {
    identifier: buildDatabaseEndpointIdentifier({ system, address, port }),
    source: DATABASE_ENDPOINT_IDENTITY_SOURCE,
    resourceId: null,
    details,
    problems,
    warnings,
  };
}

/*
 * Which resource this agent registers as: RESOURCE_AI_AGENT_RESOURCE_NAME_ENV
 * when set, else the type's collector variables (identityEnvVars). A Host
 * without HOST_NAME resolves to null without a problem — the executor reads
 * the host's own hostname at start-up.
 */
export function resolveIdentity(
  env: NodeJS.ProcessEnv,
  type: AiResourceType,
): ResolvedIdentity {
  const info: AiResourceTypeInfo = AI_RESOURCE_TYPE_INFO[type];
  const override: string = readTrimmed(
    env,
    RESOURCE_AI_AGENT_RESOURCE_NAME_ENV,
  );
  let resolved: ResolvedIdentity;

  if (type === AiResourceType.DatabaseServer) {
    resolved = resolveDatabaseIdentity(env, override);
  } else if (override) {
    resolved = {
      identifier: override,
      source: RESOURCE_AI_AGENT_RESOURCE_NAME_ENV,
      resourceId: null,
      details: {},
      problems: [],
      warnings: [],
    };
  } else {
    resolved = {
      identifier: null,
      source: null,
      resourceId: null,
      details: {},
      problems: [],
      warnings: [],
    };

    for (const name of info.identityEnvVars) {
      const value: string = readTrimmed(env, name);

      if (value) {
        resolved.identifier = value;
        resolved.source = name;
        break;
      }
    }

    if (!resolved.identifier && type !== AiResourceType.Host) {
      resolved.problems.push(
        `${info.identityEnvVars.join(" / ")} is not set. Set it ${WHERE_TO_SET} to the name the ${info.displayName}'s collector reports (or set ${RESOURCE_AI_AGENT_RESOURCE_NAME_ENV}), so the agent serves the same ${info.displayName} in OneUptime.`,
      );
    }
  }

  if (
    resolved.identifier &&
    resolved.identifier.length > MAX_POSTURE_STRING_LENGTH
  ) {
    resolved.problems.push(
      `The ${info.displayName} identity from ${resolved.source} is ${resolved.identifier.length} characters long; OneUptime accepts at most ${MAX_POSTURE_STRING_LENGTH}.`,
    );
  }

  const placeholderWarning: string | null = describeDefaultIdentity({
    type,
    identifier: resolved.identifier,
    source: resolved.source,
  });

  if (placeholderWarning) {
    resolved.warnings.push(placeholderWarning);
  }

  return resolved;
}

/*
 * The collectors fall back to a fixed name ("docker-host", "ceph", ...)
 * when the operator never set one, and every resource installed with that
 * default reports into the SAME row. Say so (it is not refused: the agent
 * still serves that row).
 */
export function describeDefaultIdentity(data: {
  type: AiResourceType;
  identifier: string | null;
  source: string | null;
}): string | null {
  if (
    !data.identifier ||
    !isDefaultIdentityPlaceholder(data.type, data.identifier)
  ) {
    return null;
  }

  const info: AiResourceTypeInfo = AI_RESOURCE_TYPE_INFO[data.type];
  const variable: string = data.source || info.identityEnvVars.join(" / ");

  return `This ${info.displayName} is named "${data.identifier}", the collector's default (${variable}). Every ${info.displayName} installed with the default reports into the same OneUptime resource, so commands for it could reach any of them. Set ${variable} to a name unique to this ${info.displayName} on both the collector and the AI agent.`;
}

export function parseConfig(env: NodeJS.ProcessEnv): ParsedConfig {
  const problems: Array<string> = [];
  const warnings: Array<string> = [];

  const oneuptimeUrl: string = normalizeOneUptimeUrl(
    readTrimmed(env, ONEUPTIME_URL_ENV),
  );

  if (!oneuptimeUrl) {
    problems.push(
      `${ONEUPTIME_URL_ENV} is not set. Set it ${WHERE_TO_SET} to your OneUptime address, e.g. https://oneuptime.com.`,
    );
  } else if (!isHttpUrl(oneuptimeUrl)) {
    problems.push(
      `${ONEUPTIME_URL_ENV}="${oneuptimeUrl}" is not an http(s) URL. Set it ${WHERE_TO_SET} to your OneUptime address, e.g. https://oneuptime.com.`,
    );
  }

  let apiKey: string = "";
  let apiKeySource: string | null = null;

  for (const name of RESOURCE_AI_AGENT_API_KEY_ENVS) {
    const value: string = readTrimmed(env, name);

    if (value) {
      apiKey = value;
      apiKeySource = name;
      break;
    }
  }

  if (!apiKey) {
    problems.push(
      `None of ${RESOURCE_AI_AGENT_API_KEY_ENVS.join(", ")} is set. Set one of them ${WHERE_TO_SET} to the telemetry ingestion key the collector uses.`,
    );
  }

  const resourceTypeSetting: string | null =
    env[RESOURCE_AI_AGENT_RESOURCE_TYPE_ENV] ?? null;
  const resourceType: AiResourceType | null =
    parseAiResourceType(resourceTypeSetting);

  if (resourceTypeSetting === null || resourceTypeSetting.trim() === "") {
    problems.push(
      `${RESOURCE_AI_AGENT_RESOURCE_TYPE_ENV} is not set. Set it to the kind of resource this agent serves: ${describeResourceTypes()}.`,
    );
  } else if (resourceType === null) {
    problems.push(
      `${RESOURCE_AI_AGENT_RESOURCE_TYPE_ENV}="${resourceTypeSetting}" is not a resource type this agent knows. Set it to one of: ${describeResourceTypes()}.`,
    );
  }

  const identity: ResolvedIdentity | null = resourceType
    ? resolveIdentity(env, resourceType)
    : null;

  if (identity) {
    problems.push(...identity.problems);
    warnings.push(...identity.warnings);
  }

  const allowWritesSetting: string | null =
    env[RESOURCE_AI_ALLOW_WRITES_ENV] ?? null;
  let allowWrites: boolean = parseSwitch(allowWritesSetting);

  const unrecognised: string | null = describeUnrecognisedSwitch({
    name: RESOURCE_AI_ALLOW_WRITES_ENV,
    value: allowWritesSetting,
    what: "changes (fixes)",
  });

  if (unrecognised) {
    warnings.push(unrecognised);
  }

  const writeTargets: ParsedTargetList = parseTargetList(
    env[RESOURCE_AI_WRITE_TARGETS_ENV],
    RESOURCE_AI_WRITE_TARGETS_ENV,
  );
  const protectedTargets: ParsedTargetList = parseTargetList(
    env[PROTECTED_TARGETS_ENV],
    PROTECTED_TARGETS_ENV,
  );

  for (const listProblem of [writeTargets.problem, protectedTargets.problem]) {
    if (!listProblem) {
      continue;
    }

    /*
     * Fail closed, as the server will: it reads a list over the bounds as
     * malformed and treats the agent as read-only.
     */
    if (allowWrites) {
      warnings.push(
        `${listProblem} The agent stays read-only until it is fixed.`,
      );
    } else {
      warnings.push(listProblem);
    }

    allowWrites = false;
  }

  const agentVersion: string = readTrimmed(env, "APP_VERSION");
  const health: { host: string; problem: string | null } = parseHealthHost(
    env[HEALTH_HOST_ENV],
  );

  if (health.problem) {
    warnings.push(health.problem);
  }

  return {
    config: {
      oneuptimeUrl,
      apiKey,
      apiKeySource,
      resourceType,
      resourceTypeSetting,
      resourceIdentifier: identity ? identity.identifier : null,
      identitySource: identity ? identity.source : null,
      resourceId: identity ? identity.resourceId : null,
      identityDetails: identity ? identity.details : {},
      allowWrites,
      allowWritesSetting,
      writeTargets: writeTargets.targets,
      protectedTargets: protectedTargets.targets,
      port: parsePort(env["PORT"]),
      healthHost: health.host,
      pollIntervalMs: parseInterval({
        value: env[POLL_INTERVAL_ENV],
        defaultValue: DEFAULT_POLL_INTERVAL_MS,
        min: MIN_POLL_INTERVAL_MS,
      }),
      heartbeatIntervalMs: parseInterval({
        value: env[HEARTBEAT_INTERVAL_ENV],
        defaultValue: DEFAULT_HEARTBEAT_INTERVAL_MS,
        min: MIN_HEARTBEAT_INTERVAL_MS,
      }),
      agentVersion: agentVersion || null,
    },
    problems,
    warnings,
  };
}
