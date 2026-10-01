import net from "net";
import { DATABASE_SYSTEM_ENV } from "../../Config";
import {
  ALL_DATABASE_ENGINES,
  DATABASE_ENGINE_DISPLAY_NAMES,
  DatabaseEngine,
  parseDatabaseEngine,
} from "../../Common/Utils/AiRemediation/Resource/DatabaseDiagnosticCatalog";

/*
 * How the Database AI agent reaches its database: the engine, the address,
 * the login and TLS, read from the .env it shares with the Database Agent's
 * collector (agents/DatabaseAgent/docker-compose.yml), with the same
 * meaning the collector gives each variable:
 *
 *   DATABASE_SYSTEM                     the engine (postgresql, mysql,
 *                                       mariadb, redis, valkey, mongodb, ...)
 *   DATABASE_ENDPOINT                   host:port to connect to (the
 *                                       collector's endpoint, never the
 *                                       identity DATABASE_SERVER_ADDRESS)
 *   DATABASE_ENDPOINT_HOST / _PORT      the same, apart (install.sh writes
 *                                       both); used when DATABASE_ENDPOINT
 *                                       is empty
 *   DATABASE_USERNAME / _PASSWORD       the collector's monitoring login.
 *                                       The collector expands $ once more,
 *                                       so the .env holds every $ doubled;
 *                                       the agent halves $$ back
 *   DATABASE_TLS_INSECURE               true (the default) connects without
 *                                       TLS; false turns TLS on
 *   DATABASE_TLS_INSECURE_SKIP_VERIFY   true accepts any certificate
 *
 * plus the AI agent's own:
 *
 *   ONEUPTIME_AI_DATABASE_USERNAME / _PASSWORD  a login of the agent's own,
 *                                       used instead of the collector's when
 *                                       either is set (fixes need a login
 *                                       that may signal other sessions).
 *                                       Read verbatim: no $$ halving
 *   ONEUPTIME_AI_DATABASE_NAME          PostgreSQL's database to connect to
 *                                       (postgres by default), MongoDB's
 *                                       authentication database (admin)
 *   ONEUPTIME_AI_DATABASE_CA_FILE       a PEM CA bundle to verify the
 *                                       server's certificate against
 *
 * Only the executor's options.env is read — never process.env directly —
 * and nothing here throws: a missing or malformed value is a problem in
 * words an operator can act on, naming the variable to set.
 */

export const DATABASE_ENDPOINT_ENV: string = "DATABASE_ENDPOINT";
export const DATABASE_ENDPOINT_HOST_ENV: string = "DATABASE_ENDPOINT_HOST";
export const DATABASE_ENDPOINT_PORT_ENV: string = "DATABASE_ENDPOINT_PORT";
export const DATABASE_USERNAME_ENV: string = "DATABASE_USERNAME";
export const DATABASE_PASSWORD_ENV: string = "DATABASE_PASSWORD";
export const DATABASE_TLS_INSECURE_ENV: string = "DATABASE_TLS_INSECURE";
export const DATABASE_TLS_INSECURE_SKIP_VERIFY_ENV: string =
  "DATABASE_TLS_INSECURE_SKIP_VERIFY";
export const AI_DATABASE_USERNAME_ENV: string =
  "ONEUPTIME_AI_DATABASE_USERNAME";
export const AI_DATABASE_PASSWORD_ENV: string =
  "ONEUPTIME_AI_DATABASE_PASSWORD";
export const AI_DATABASE_NAME_ENV: string = "ONEUPTIME_AI_DATABASE_NAME";
export const AI_DATABASE_CA_FILE_ENV: string = "ONEUPTIME_AI_DATABASE_CA_FILE";

export const DEFAULT_DATABASE_PORTS: Readonly<Record<DatabaseEngine, number>> =
  {
    [DatabaseEngine.PostgreSQL]: 5432,
    [DatabaseEngine.MySQL]: 3306,
    [DatabaseEngine.Redis]: 6379,
    [DatabaseEngine.MongoDB]: 27017,
  };

// The database the agent connects to when ONEUPTIME_AI_DATABASE_NAME is empty.
export const DEFAULT_POSTGRES_DATABASE: string = "postgres";
export const DEFAULT_MONGO_AUTH_SOURCE: string = "admin";

const WHERE_TO_SET: string =
  "in the .env file the AI agent shares with the Database Agent (or the agent container's environment)";

/*
 * How the agent speaks TLS: not at all (DATABASE_TLS_INSECURE=true, the
 * collector's default), verifying the certificate, or accepting any.
 */
export enum DatabaseTlsMode {
  Off = "off",
  Verify = "verify",
  NoVerify = "no-verify",
}

export interface DatabaseSettings {
  engine: DatabaseEngine;
  // DATABASE_SYSTEM as configured, trimmed and lowercased ("mariadb", "valkey").
  system: string;
  // The server as an operator names it: "PostgreSQL", "MariaDB", "Valkey".
  serverName: string;
  // What to connect to: a host name or an IP address (IPv6 without brackets).
  host: string;
  port: number;
  // "host:port" for messages (IPv6 in brackets).
  endpoint: string;
  // Which variable(s) the endpoint came from, for messages.
  endpointSource: string;
  // "" when there is none (Redis and MongoDB without authentication).
  username: string;
  // Never logged, printed or reported; "" when there is none.
  password: string;
  // Which variables the login came from.
  credentialSource: string;
  // The login is the AI agent's own (ONEUPTIME_AI_DATABASE_*).
  isAgentLogin: boolean;
  tls: DatabaseTlsMode;
  // ONEUPTIME_AI_DATABASE_CA_FILE, read when the connection is made.
  caFile: string | null;
  // ONEUPTIME_AI_DATABASE_NAME, or null for the engine's default.
  database: string | null;
}

export type DatabaseSettingsResult =
  | { settings: DatabaseSettings; problem: null }
  | { settings: null; problem: string };

// Known DATABASE_SYSTEM spellings, as an operator reads them.
const SYSTEM_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  postgresql: "PostgreSQL",
  postgres: "PostgreSQL",
  pg: "PostgreSQL",
  pgsql: "PostgreSQL",
  mysql: "MySQL",
  mariadb: "MariaDB",
  percona: "Percona Server",
  redis: "Redis",
  valkey: "Valkey",
  keydb: "KeyDB",
  dragonfly: "Dragonfly",
  dragonflydb: "Dragonfly",
  mongodb: "MongoDB",
  mongo: "MongoDB",
  "microsoft.sql_server": "Microsoft SQL Server",
  sqlserver: "Microsoft SQL Server",
  mssql: "Microsoft SQL Server",
  "oracle.db": "Oracle Database",
  oracle: "Oracle Database",
  oracledb: "Oracle Database",
  elasticsearch: "Elasticsearch",
  opensearch: "OpenSearch",
  memcached: "Memcached",
};

const HOST_NAME_PATTERN: RegExp =
  /^[A-Za-z0-9_](?:[A-Za-z0-9_.-]{0,251}[A-Za-z0-9_])?$/;
const PORT_PATTERN: RegExp = /^\d{1,5}$/;
const SCHEME_PATTERN: RegExp = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;
// Printable, no control characters: a database or file name the agent passes on.
// eslint-disable-next-line no-control-regex
const PRINTABLE_PATTERN: RegExp = /^[^\u0000-\u001f\u007f]{1,4096}$/;
// A path, a query, a fragment or whitespace: not host:port.
const NOT_HOST_PORT_PATTERN: RegExp = /[/?#\s]/;
const MAX_DATABASE_NAME_LENGTH: number = 128;

function readRaw(env: NodeJS.ProcessEnv, name: string): string {
  const value: unknown = env[name];
  return typeof value === "string" ? value : "";
}

function readTrimmed(env: NodeJS.ProcessEnv, name: string): string {
  return readRaw(env, name).trim();
}

/*
 * The collector expands the values it reads once more ($$ becomes $), so
 * install.sh — and the docs, for a hand-written .env — write every $ of the
 * login doubled. Undo exactly that one level; a lone $ stays the $ it is.
 */
export function unescapeCollectorValue(value: string): string {
  return value.replace(/\$\$/g, "$");
}

// The server as an operator names it, from DATABASE_SYSTEM.
export function describeDatabaseSystem(system: string): string {
  const folded: string = system.trim().toLowerCase();

  if (Object.prototype.hasOwnProperty.call(SYSTEM_DISPLAY_NAMES, folded)) {
    return SYSTEM_DISPLAY_NAMES[folded] || folded;
  }

  const engine: DatabaseEngine | null = parseDatabaseEngine(folded);
  return engine ? DATABASE_ENGINE_DISPLAY_NAMES[engine] : `"${system.trim()}"`;
}

export function formatDatabaseEndpoint(host: string, port: number): string {
  return `${host.includes(":") ? `[${host}]` : host}:${port}`;
}

function parsePort(value: string): number | null {
  if (!PORT_PATTERN.test(value)) {
    return null;
  }

  const port: number = parseInt(value, 10);
  return port >= 1 && port <= 65535 ? port : null;
}

/*
 * "host:port", "[v6]:port", "host", a bare IPv6 address — what the
 * collector's endpoint takes. Never a URL: the agent connects to the
 * address with its own driver and its own login, and a URL would carry
 * neither safely.
 */
export function parseDatabaseEndpoint(
  raw: string,
  data: { variable: string; defaultPort: number },
): { host: string; port: number } | string {
  const value: string = raw.trim();

  if (!value) {
    return `${data.variable} is not set. Set it ${WHERE_TO_SET} to the host:port the agent connects to, the collector's own endpoint (e.g. db.internal:${data.defaultPort}, or host.docker.internal:${data.defaultPort} for a database on this machine).`;
  }

  // Never echoed: what comes before an "@" may be a password.
  if (value.includes("@")) {
    return `${data.variable} holds an "@", as if it carried a login. Set it to host:port only (e.g. db.internal:${data.defaultPort}); the login goes in DATABASE_USERNAME and DATABASE_PASSWORD.`;
  }

  if (SCHEME_PATTERN.test(value)) {
    return `${data.variable}="${value}" is a URL, but the Database AI agent connects to host:port (e.g. db.internal:${data.defaultPort}). Remove the scheme.`;
  }

  if (NOT_HOST_PORT_PATTERN.test(value)) {
    return `${data.variable}="${value}" is not host:port. Set it to the database's host and port only (e.g. db.internal:${data.defaultPort}).`;
  }

  let host: string;
  let portText: string | null = null;

  const bracketed: RegExpMatchArray | null = value.match(
    /^\[([^\]]+)\](?::([^:]*))?$/,
  );

  if (bracketed) {
    host = bracketed[1] || "";
    portText = bracketed[2] === undefined ? null : bracketed[2];

    if (!net.isIPv6(host)) {
      return `${data.variable}="${value}" has brackets but no IPv6 address inside them.`;
    }
  } else if (net.isIPv6(value)) {
    host = value;
  } else {
    const colon: number = value.lastIndexOf(":");

    host = colon >= 0 ? value.slice(0, colon) : value;
    portText = colon >= 0 ? value.slice(colon + 1) : null;

    if (!HOST_NAME_PATTERN.test(host)) {
      return `${data.variable}="${value}" is not host:port. Set it to the database's host name or address and port (e.g. db.internal:${data.defaultPort}).`;
    }
  }

  if (portText === null) {
    return { host, port: data.defaultPort };
  }

  const port: number | null = parsePort(portText);

  if (port === null) {
    return `${data.variable}="${value}" names a port that is not a number from 1 to 65535.`;
  }

  return { host, port };
}

/*
 * A true/false switch the way the collector's YAML reads it; unset takes
 * the default. Anything else is a problem rather than a guess: a TLS
 * switch must never read a typo as "off".
 */
function readSwitch(
  env: NodeJS.ProcessEnv,
  name: string,
  defaultValue: boolean,
): boolean | string {
  const value: string = readTrimmed(env, name).toLowerCase();

  if (!value) {
    return defaultValue;
  }

  if (value === "true" || value === "1") {
    return true;
  }

  if (value === "false" || value === "0") {
    return false;
  }

  return `${name}="${readTrimmed(env, name)}" is not true or false. Set it ${WHERE_TO_SET} to true or false, as the collector reads it.`;
}

// Why DATABASE_SYSTEM is not an engine the agent can run its catalog on.
export function describeUnsupportedDatabaseSystem(system: string): string {
  return `${DATABASE_SYSTEM_ENV}="${system}": the Database AI agent does not support ${describeDatabaseSystem(
    system,
  )} for AI diagnostics yet. It runs its diagnostics on ${ALL_DATABASE_ENGINES.map(
    (engine: DatabaseEngine): string => {
      return DATABASE_ENGINE_DISPLAY_NAMES[engine];
    },
  ).join(
    ", ",
  )} (Valkey, KeyDB and Dragonfly as Redis). The Database Agent still collects this database's metrics; remove the AI agent's service if you do not want it running.`;
}

function resolveEndpoint(
  env: NodeJS.ProcessEnv,
  defaultPort: number,
): { host: string; port: number; source: string } | string {
  const endpoint: string = readTrimmed(env, DATABASE_ENDPOINT_ENV);

  if (endpoint) {
    const parsed: { host: string; port: number } | string =
      parseDatabaseEndpoint(endpoint, {
        variable: DATABASE_ENDPOINT_ENV,
        defaultPort,
      });

    return typeof parsed === "string"
      ? parsed
      : { ...parsed, source: DATABASE_ENDPOINT_ENV };
  }

  const host: string = readTrimmed(env, DATABASE_ENDPOINT_HOST_ENV);

  if (!host) {
    return parseDatabaseEndpoint("", {
      variable: DATABASE_ENDPOINT_ENV,
      defaultPort,
    }) as string;
  }

  const portSetting: string = readTrimmed(env, DATABASE_ENDPOINT_PORT_ENV);
  const port: number | null = portSetting ? parsePort(portSetting) : null;

  if (portSetting && port === null) {
    return `${DATABASE_ENDPOINT_PORT_ENV}="${portSetting}" is not a port (1-65535).`;
  }

  const parsed: { host: string; port: number } | string = parseDatabaseEndpoint(
    host.includes(":") ? `[${host}]` : host,
    {
      variable: DATABASE_ENDPOINT_HOST_ENV,
      defaultPort,
    },
  );

  return typeof parsed === "string"
    ? parsed
    : {
        host: parsed.host,
        port: port ?? parsed.port,
        source: `${DATABASE_ENDPOINT_HOST_ENV}+${DATABASE_ENDPOINT_PORT_ENV}`,
      };
}

/*
 * Everything the agent needs to reach the database, from its own
 * environment, or the first problem in words an operator can act on.
 */
export function resolveDatabaseSettings(
  env: NodeJS.ProcessEnv,
): DatabaseSettingsResult {
  const fail: (problem: string) => DatabaseSettingsResult = (
    problem: string,
  ): DatabaseSettingsResult => {
    return { settings: null, problem };
  };

  const system: string = readTrimmed(env, DATABASE_SYSTEM_ENV).toLowerCase();

  if (!system) {
    return fail(
      `${DATABASE_SYSTEM_ENV} is not set. Set it ${WHERE_TO_SET} to the database engine (postgresql, mysql, mariadb, redis, valkey, mongodb, ...), the same value the collector uses.`,
    );
  }

  const engine: DatabaseEngine | null = parseDatabaseEngine(system);

  if (!engine) {
    return fail(describeUnsupportedDatabaseSystem(system));
  }

  const serverName: string = describeDatabaseSystem(system);

  const endpoint: { host: string; port: number; source: string } | string =
    resolveEndpoint(env, DEFAULT_DATABASE_PORTS[engine]);

  if (typeof endpoint === "string") {
    return fail(endpoint);
  }

  // ---- The login: the agent's own when either of its variables is set. ----

  const agentUsername: string = readTrimmed(env, AI_DATABASE_USERNAME_ENV);
  const agentPassword: string = readRaw(env, AI_DATABASE_PASSWORD_ENV);
  const isAgentLogin: boolean = agentUsername !== "" || agentPassword !== "";

  const username: string = isAgentLogin
    ? agentUsername
    : unescapeCollectorValue(readTrimmed(env, DATABASE_USERNAME_ENV));
  const password: string = isAgentLogin
    ? agentPassword
    : unescapeCollectorValue(readRaw(env, DATABASE_PASSWORD_ENV));
  const usernameVariable: string = isAgentLogin
    ? AI_DATABASE_USERNAME_ENV
    : DATABASE_USERNAME_ENV;
  const passwordVariable: string = isAgentLogin
    ? AI_DATABASE_PASSWORD_ENV
    : DATABASE_PASSWORD_ENV;

  if (
    (engine === DatabaseEngine.PostgreSQL || engine === DatabaseEngine.MySQL) &&
    !username
  ) {
    return fail(
      `${usernameVariable} is not set. ${serverName} needs a login: set ${DATABASE_USERNAME_ENV} and ${DATABASE_PASSWORD_ENV} (the collector's monitoring login) or ${AI_DATABASE_USERNAME_ENV} and ${AI_DATABASE_PASSWORD_ENV} (a login of the AI agent's own) ${WHERE_TO_SET}.`,
    );
  }

  if (
    (engine === DatabaseEngine.MongoDB || engine === DatabaseEngine.Redis) &&
    username &&
    !password
  ) {
    return fail(
      `${usernameVariable} is set but ${passwordVariable} is empty. ${serverName} needs both for a user login (or neither for a server without authentication${
        engine === DatabaseEngine.Redis
          ? `; a requirepass-only server needs ${passwordVariable} alone`
          : ""
      }).`,
    );
  }

  // ---- TLS, exactly as the collector reads its two switches. ----

  const insecure: boolean | string = readSwitch(
    env,
    DATABASE_TLS_INSECURE_ENV,
    true,
  );

  if (typeof insecure === "string") {
    return fail(insecure);
  }

  const skipVerify: boolean | string = readSwitch(
    env,
    DATABASE_TLS_INSECURE_SKIP_VERIFY_ENV,
    false,
  );

  if (typeof skipVerify === "string") {
    return fail(skipVerify);
  }

  const tls: DatabaseTlsMode = insecure
    ? DatabaseTlsMode.Off
    : skipVerify
      ? DatabaseTlsMode.NoVerify
      : DatabaseTlsMode.Verify;

  const caFile: string = readTrimmed(env, AI_DATABASE_CA_FILE_ENV);

  if (caFile && !PRINTABLE_PATTERN.test(caFile)) {
    return fail(
      `${AI_DATABASE_CA_FILE_ENV} is not a file path. Set it to the path of a PEM CA bundle mounted into the agent's container.`,
    );
  }

  const database: string = readTrimmed(env, AI_DATABASE_NAME_ENV);

  if (
    database &&
    (database.length > MAX_DATABASE_NAME_LENGTH ||
      !PRINTABLE_PATTERN.test(database))
  ) {
    return fail(
      `${AI_DATABASE_NAME_ENV} is not a database name (1-${MAX_DATABASE_NAME_LENGTH} printable characters).`,
    );
  }

  return {
    settings: {
      engine,
      system,
      serverName,
      host: endpoint.host,
      port: endpoint.port,
      endpoint: formatDatabaseEndpoint(endpoint.host, endpoint.port),
      endpointSource: endpoint.source,
      username,
      password,
      credentialSource: `${usernameVariable}/${passwordVariable}`,
      isAgentLogin,
      tls,
      caFile: caFile || null,
      database: database || null,
    },
    problem: null,
  };
}
