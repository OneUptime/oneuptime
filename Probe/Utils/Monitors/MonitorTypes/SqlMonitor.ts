import OnlineCheck from "../../OnlineCheck";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import Sleep from "Common/Types/Sleep";
import { JSONObject } from "Common/Types/JSON";
import MonitorStepSqlMonitor, {
  clampSqlConnectionTimeoutInMs,
  clampSqlMaxRows,
  clampSqlStatementTimeoutInMs,
} from "Common/Types/Monitor/MonitorStepSqlMonitor";
import SqlDatabaseType, {
  SqlDatabaseTypeUtil,
} from "Common/Types/Monitor/SqlDatabaseType";
import SqlMonitorResponse from "Common/Types/Monitor/SqlMonitor/SqlMonitorResponse";
import { Client, ClientConfig, QueryResult } from "pg";
import {
  Connection as MySqlConnection,
  ConnectionOptions as MySqlConnectionOptions,
  createConnection as createMySqlConnection,
} from "mysql2/promise";
import * as mssql from "mssql";
import { createRequire } from "module";
import { execFile } from "child_process";
import { promisify } from "util";

const loadProbeModule: ReturnType<typeof createRequire> =
  createRequire(__filename);

/*
 * Async (non-blocking) child-process runner. Detection must never run on the
 * synchronous path: the probe multiplexes many monitors on one event loop, so
 * a slow/wedged `odbcinst`/`reg` must not freeze unrelated checks.
 */
const execFileAsync: (
  file: string,
  args: Array<string>,
  options: { encoding: "utf8"; timeout: number; windowsHide?: boolean },
) => Promise<{ stdout: string; stderr: string }> = promisify(execFile);

/*
 * The Microsoft ODBC driver bundled in the official probe image and used as the
 * fallback when the installed driver cannot be detected. Do not read this
 * directly to build a connection string — call resolveSqlServerOdbcDriver(),
 * which prefers an operator override or the newest driver actually registered
 * on the host so self-hosted probes with a different version (e.g. Driver 17)
 * work without editing source.
 */
export const SQL_SERVER_ODBC_DRIVER: string = "ODBC Driver 18 for SQL Server";

/*
 * Matches a Microsoft SQL Server ODBC driver registration and captures its
 * major version, e.g. "ODBC Driver 18 for SQL Server" -> 18. Filters unrelated
 * ODBC drivers (PostgreSQL, MySQL, ...) out of the host's list and compares
 * versions.
 */
const SQL_SERVER_ODBC_DRIVER_PATTERN: RegExp =
  /^ODBC Driver (\d+) for SQL Server$/i;

/*
 * Lists the ODBC driver names registered on the host. Injectable so the
 * resolver can be unit-tested without a real ODBC installation. May be sync or
 * async — the resolver awaits the result either way.
 */
export type OdbcDriverLister = () => Array<string> | Promise<Array<string>>;

/*
 * Parse the driver section names printed by `odbcinst -q -d` (unixODBC, used on
 * the Linux/macOS probe). Each installed driver is a line like
 * "[ODBC Driver 18 for SQL Server]".
 */
export const parseUnixOdbcInstDrivers: (output: string) => Array<string> = (
  output: string,
): Array<string> => {
  const names: Array<string> = [];
  for (const line of output.split(/\r?\n/)) {
    const match: RegExpMatchArray | null = line.match(/^\s*\[(.+?)\]\s*$/);
    if (match && match[1]) {
      names.push(match[1].trim());
    }
  }
  return names;
};

/*
 * Parse the value names printed by `reg query` for the ODBC Drivers key
 * (Windows probes). Each installed driver is a line like
 * "    ODBC Driver 18 for SQL Server    REG_SZ    Installed".
 */
export const parseWindowsRegistryOdbcDrivers: (
  output: string,
) => Array<string> = (output: string): Array<string> => {
  const names: Array<string> = [];
  for (const line of output.split(/\r?\n/)) {
    const match: RegExpMatchArray | null = line.match(/^\s+(.+?)\s+REG_\w+\s+/);
    if (match && match[1]) {
      names.push(match[1].trim());
    }
  }
  return names;
};

/*
 * Choose the newest "ODBC Driver N for SQL Server" from a list of registered
 * ODBC driver names, ignoring unrelated drivers. Returns null when none match.
 */
export const pickBestSqlServerOdbcDriver: (
  driverNames: Array<string>,
) => string | null = (driverNames: Array<string>): string | null => {
  let best: { name: string; version: number } | null = null;
  for (const rawName of driverNames) {
    const name: string = rawName.trim();
    const match: RegExpMatchArray | null = name.match(
      SQL_SERVER_ODBC_DRIVER_PATTERN,
    );
    const versionString: string | undefined = match?.[1];
    if (!versionString) {
      continue;
    }
    const version: number = parseInt(versionString, 10);
    if (Number.isNaN(version)) {
      continue;
    }
    if (!best || version > best.version) {
      best = { name, version };
    }
  }
  return best ? best.name : null;
};

/*
 * List the ODBC drivers registered on this host using the platform-native
 * mechanism (the Windows registry, or unixODBC's `odbcinst` elsewhere). Never
 * throws — a missing tool or unreadable registry yields an empty list so
 * resolution falls back to the default driver. Runs the child process
 * asynchronously (never blocking the probe's event loop) and is bounded with a
 * short timeout so a wedged tool cannot stall detection.
 */
const listHostOdbcDrivers: OdbcDriverLister = async (): Promise<
  Array<string>
> => {
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync(
        "reg",
        ["query", "HKLM\\SOFTWARE\\ODBC\\ODBCINST.INI\\ODBC Drivers"],
        { encoding: "utf8", timeout: 3000, windowsHide: true },
      );
      return parseWindowsRegistryOdbcDrivers(stdout.toString());
    }

    const { stdout } = await execFileAsync("odbcinst", ["-q", "-d"], {
      encoding: "utf8",
      timeout: 3000,
    });
    return parseUnixOdbcInstDrivers(stdout.toString());
  } catch (err) {
    logger.debug(`Unable to list installed ODBC drivers: ${err}`);
    return [];
  }
};

let cachedSqlServerOdbcDriver: string | undefined;

/*
 * Resolve the ODBC driver name the probe should use for SQL Server trusted
 * (Windows integrated) connections. Hard-coding a single version breaks on any
 * host that ships a different Microsoft ODBC Driver, so resolution order is:
 *   1. The SQL_SERVER_ODBC_DRIVER environment variable (explicit operator
 *      override — an exact driver name).
 *   2. The newest "ODBC Driver N for SQL Server" registered on the host.
 *   3. SQL_SERVER_ODBC_DRIVER (the version bundled in the official image).
 * A positive detection or an explicit override is memoized (the installed
 * drivers do not change while the probe runs). The default fallback is
 * deliberately NOT cached: an empty driver list can mean a genuinely
 * driver-less host OR a transient failure (odbcinst/reg momentarily
 * unavailable), and caching the default there would defeat the fix for the
 * lifetime of the process — so the next integrated-auth query retries
 * detection. Tests inject the lister/env and can disable the cache.
 */
export const resolveSqlServerOdbcDriver: (options?: {
  envValue?: string | undefined;
  lister?: OdbcDriverLister | undefined;
  useCache?: boolean | undefined;
}) => Promise<string> = async (options?: {
  envValue?: string | undefined;
  lister?: OdbcDriverLister | undefined;
  useCache?: boolean | undefined;
}): Promise<string> => {
  const useCache: boolean = options?.useCache !== false;
  if (useCache && cachedSqlServerOdbcDriver !== undefined) {
    return cachedSqlServerOdbcDriver;
  }

  const envValue: string | undefined =
    options && "envValue" in options
      ? options.envValue
      : process.env["SQL_SERVER_ODBC_DRIVER"];
  const override: string = (envValue || "").trim();

  let resolved: string;
  // Only a real answer (override or detection) is safe to memoize.
  let cacheable: boolean;
  if (override) {
    resolved = override;
    cacheable = true;
  } else {
    const lister: OdbcDriverLister = options?.lister || listHostOdbcDrivers;
    const detected: string | null = pickBestSqlServerOdbcDriver(await lister());
    if (detected) {
      logger.debug(`Using detected SQL Server ODBC driver: ${detected}`);
      resolved = detected;
      cacheable = true;
    } else {
      resolved = SQL_SERVER_ODBC_DRIVER;
      cacheable = false;
    }
  }

  if (useCache && cacheable) {
    cachedSqlServerOdbcDriver = resolved;
  }
  return resolved;
};

/*
 * Reset the memoized driver. Test-only seam so a test that injects a lister is
 * not shadowed by a value cached from an earlier test.
 */
export const resetSqlServerOdbcDriverCache: () => void = (): void => {
  cachedSqlServerOdbcDriver = undefined;
};

/*
 * Escape a value for an ODBC connection string. Braced values can safely
 * contain semicolons; a literal closing brace is represented by two braces.
 */
const escapeOdbcConnectionStringValue: (value: string) => string = (
  value: string,
): string => {
  return `{${value.replace(/}/g, "}}")}}`;
};

/*
 * Build the trusted connection string used by msnodesqlv8. Keeping this
 * separate from the normal Tedious config ensures SQL credentials are never
 * passed when integrated authentication is selected.
 */
export const buildSqlServerIntegratedConnectionString: (
  config: Pick<
    MonitorStepSqlMonitor,
    "host" | "port" | "databaseName" | "useSsl" | "rejectUnauthorizedSsl"
  >,
  odbcDriver?: string,
) => string = (
  config: Pick<
    MonitorStepSqlMonitor,
    "host" | "port" | "databaseName" | "useSsl" | "rejectUnauthorizedSsl"
  >,
  odbcDriver: string = SQL_SERVER_ODBC_DRIVER,
): string => {
  return [
    `Driver=${escapeOdbcConnectionStringValue(odbcDriver)}`,
    `Server=${escapeOdbcConnectionStringValue(`${config.host},${config.port}`)}`,
    `Database=${escapeOdbcConnectionStringValue(config.databaseName)}`,
    "Trusted_Connection=yes",
    `Encrypt=${config.useSsl ? "yes" : "no"}`,
    `TrustServerCertificate=${
      config.useSsl && !config.rejectUnauthorizedSsl ? "yes" : "no"
    }`,
    `APP=${escapeOdbcConnectionStringValue("OneUptimeProbe-SQLMonitor")}`,
  ].join(";");
};

export interface MicrosoftSqlServerPoolConfig extends mssql.config {
  connectionString?: string | undefined;
}

export type SqlServerDriverLoader = (moduleId: string) => unknown;

/*
 * Build the pool configuration independently from opening a connection. This
 * makes the authentication boundary explicit: SQL credentials are present for
 * the normal Tedious driver, while a trusted connection has only an ODBC
 * connection string and cannot accidentally forward a saved username/password.
 */
export const buildMicrosoftSqlServerPoolConfig: (input: {
  config: MonitorStepSqlMonitor;
  statementTimeoutInMs: number;
  connectionTimeoutInMs: number;
  odbcDriver?: string | undefined;
}) => MicrosoftSqlServerPoolConfig = (input: {
  config: MonitorStepSqlMonitor;
  statementTimeoutInMs: number;
  connectionTimeoutInMs: number;
  odbcDriver?: string | undefined;
}): MicrosoftSqlServerPoolConfig => {
  const { config, statementTimeoutInMs, connectionTimeoutInMs } = input;

  const baseConfig: MicrosoftSqlServerPoolConfig = {
    server: config.host,
    port: config.port,
    database: config.databaseName,
    connectionTimeout: connectionTimeoutInMs,
    requestTimeout: statementTimeoutInMs,
    pool: { max: 1, min: 0, idleTimeoutMillis: 30000 },
    options: {
      encrypt: config.useSsl,
      /*
       * When SSL is on, validate the chain unless the user opted out (a
       * self-signed cert). When SSL is off this value is irrelevant.
       */
      trustServerCertificate: config.useSsl
        ? !config.rejectUnauthorizedSsl
        : true,
      appName: "OneUptimeProbe-SQLMonitor",
    },
  };

  if (config.useWindowsIntegratedAuthentication) {
    return {
      ...baseConfig,
      connectionString: buildSqlServerIntegratedConnectionString(
        config,
        input.odbcDriver,
      ),
    };
  }

  return {
    ...baseConfig,
    user: config.username,
    password: config.password,
  };
};

/*
 * Keep the native driver lazy so PostgreSQL, MySQL, and SQL-authenticated SQL
 * Server monitors continue to work on developer probes without unixODBC. The
 * loader parameter makes the selection and failure behavior unit-testable
 * without requiring a native binary in the test environment.
 */
export const loadMicrosoftSqlServerDriver: (
  useWindowsIntegratedAuthentication: boolean,
  moduleLoader?: SqlServerDriverLoader,
) => typeof mssql = (
  useWindowsIntegratedAuthentication: boolean,
  moduleLoader: SqlServerDriverLoader = loadProbeModule,
): typeof mssql => {
  if (!useWindowsIntegratedAuthentication) {
    return mssql;
  }

  try {
    return moduleLoader("mssql/msnodesqlv8") as typeof mssql;
  } catch {
    throw new Error(
      `Windows Integrated Authentication requires a Microsoft ODBC Driver for SQL Server (the official probe image ships ${SQL_SERVER_ODBC_DRIVER}; other versions such as ODBC Driver 17 for SQL Server are detected automatically) and the msnodesqlv8 native driver on the probe. Use the official probe image or install both dependencies, then run the probe under the trusted Windows account or with a valid Kerberos ticket.`,
    );
  }
};

export interface SqlQueryOptions {
  timeout?: number | undefined;
  retry?: number | undefined;
  currentRetryCount?: number | undefined;
  monitorId?: ObjectID | undefined;
  isOnlineCheckRequest?: boolean | undefined;
  attempts?: Array<ProbeAttempt> | undefined;
}

/*
 * The underlying (callback-style) mysql2 connection reached via the promise
 * wrapper's `.connection` property. Only the members the streaming row reader
 * uses are typed here — row streaming is not exposed on the promise API, so
 * the executor drops down to this core connection to enforce a hard row cap.
 */
interface MySqlCoreConnection {
  query: (sql: string) => MySqlQueryStream;
  destroy: () => void;
}

interface MySqlQueryStream {
  on: (event: string, listener: (arg: unknown) => void) => MySqlQueryStream;
}

/*
 * First token that a read-only query is allowed to start with. Restricted to
 * statements Postgres can run inside a DECLARE ... CURSOR (SELECT / WITH /
 * VALUES / TABLE) so an allowed query always executes. WITH is permitted
 * because the authoritative read-only guarantee is the read-only transaction
 * the probe opens (which rejects writable CTEs); this allow-list is a
 * secondary, defense-in-depth control.
 */
const ALLOWED_FIRST_TOKENS: Array<string> = [
  "select",
  "with",
  "values",
  "table",
];

/*
 * Constructs that must never appear anywhere in a read-only monitoring query,
 * checked as whole words on the comment- and string-literal-stripped text.
 *
 * The single-statement check (a `;` search) is NOT sufficient on its own for
 * SQL Server: T-SQL lets multiple statements share one batch separated by
 * whitespace alone (semicolons are optional), so `SELECT 1 EXEC xp_cmdshell …`
 * would otherwise pass the first-token allow-list and be run by mssql as one
 * batch. This denylist rejects a second statement / side-effecting construct
 * regardless of separator, and also blocks read-time file writes that a
 * READ ONLY transaction does not stop (MySQL `SELECT … INTO OUTFILE`). It is
 * defense-in-depth on top of the least-privilege database user.
 *
 * Word boundaries keep these from matching identifiers that merely contain the
 * word (e.g. `created_at`, `updated_at`, `delete_flag`). `REPLACE` is
 * deliberately absent because it is a common read-only string function.
 */
const FORBIDDEN_CONSTRUCTS: Array<RegExp> = [
  /\b(?:insert|update|delete|merge|truncate|drop|alter|create|rename|grant|revoke|call|exec|execute|backup|restore|dbcc|shutdown|reconfigure|waitfor|into|outfile|dumpfile)\b/i,
  // Remote / external data-source access and OS/procedure execution.
  /\b(?:openquery|openrowset|opendatasource|openxml)\b/i,
  // SQL Server system stored procedures / extended procedures.
  /\b(?:xp_|sp_)\w+/i,
];

export class SqlQueryValidator {
  /**
   * Remove SQL line (`-- ...`) and block (`/* ... *\/`) comments so structural
   * checks look at real SQL, not commented-out keywords.
   */
  public static stripComments(query: string): string {
    return query
      .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments
      .replace(/--[^\n]*/g, " "); // line comments
  }

  /**
   * Blank out string literals so a `;` or keyword inside quoted text does not
   * trip the single-statement / keyword checks.
   */
  public static stripStringLiterals(query: string): string {
    return query
      .replace(/'(?:[^'\\]|\\.|'')*'/g, "''")
      .replace(/"(?:[^"\\]|\\.|"")*"/g, '""');
  }

  /**
   * Returns a human-readable reason the query is rejected, or null if it
   * passes the (secondary) static safety checks. The primary read-only
   * guarantee is enforced at execution time by a read-only transaction and a
   * least-privilege database user — these checks are defense-in-depth.
   */
  public static getRejectionReason(query: string): string | null {
    if (!query || !query.trim()) {
      return "SQL query is empty.";
    }

    let normalized: string = this.stripComments(query).trim();

    // Drop trailing semicolons (a single trailing terminator is fine).
    normalized = normalized.replace(/;+\s*$/g, "").trim();

    if (!normalized) {
      return "SQL query is empty.";
    }

    const withoutStrings: string = this.stripStringLiterals(normalized);

    if (withoutStrings.includes(";")) {
      return "Multiple SQL statements are not allowed. Provide a single read-only query.";
    }

    const firstTokenMatch: RegExpMatchArray | null =
      normalized.match(/^[a-zA-Z]+/);
    const firstToken: string = firstTokenMatch
      ? firstTokenMatch[0].toLowerCase()
      : "";

    if (!ALLOWED_FIRST_TOKENS.includes(firstToken)) {
      return "Only read-only queries are allowed (must start with SELECT, WITH, VALUES, or TABLE).";
    }

    for (const forbidden of FORBIDDEN_CONSTRUCTS) {
      const match: RegExpMatchArray | null = withoutStrings.match(forbidden);
      if (match) {
        return `Disallowed SQL keyword "${match[0].trim()}". Writes, DDL, stored-procedure or dynamic execution, remote/file access, and additional statements are not permitted — provide a single read-only query.`;
      }
    }

    return null;
  }
}

export default class SqlMonitor {
  /**
   * Strip anything that could leak connection secrets out of a driver error
   * message before it is stored/returned. Any connection field (password,
   * username, host, databaseName) may be backed by a {{monitorSecrets.*}}
   * reference the user treats as secret, and drivers routinely echo these into
   * connection/auth errors ("Access denied for user '…'@'…'", "Failed to
   * connect to <host>:<port>"), so every non-trivial one is redacted verbatim
   * in addition to the password.
   */
  public static sanitizeError(
    error: unknown,
    password: string | undefined,
    otherSecrets?: Array<string | undefined>,
  ): string {
    let message: string =
      (error as Error)?.message || (error as Error)?.toString() || "SQL error";

    if (password && password.length > 0) {
      message = message.split(password).join("***");
    }

    /*
     * Redact the other secret-backed connection fields. Guard on length so a
     * short, common value (e.g. host "db") does not mangle unrelated parts of
     * the message.
     */
    if (otherSecrets) {
      for (const secret of otherSecrets) {
        if (secret && secret.length >= 4) {
          message = message.split(secret).join("***");
        }
      }
    }

    /*
     * Redact any connection URIs (postgres://user:pass@host/db,
     * mysql://..., sqlserver://...).
     */
    message = message.replace(/[a-zA-Z]+:\/\/[^\s]*@[^\s]*/g, "[redacted-dsn]");

    /*
     * Redact password / pwd key-value pairs from connection-string style
     * errors (e.g. SQL Server: "...Password=secret;Server=..."). Covers `=`
     * and `:` separators and quoted/braced/space-containing values so the
     * redaction is not truncated at the first space.
     */
    message = message.replace(
      /(password|pwd)\s*[=:]\s*(\{[^}]*\}|"[^"]*"|'[^']*'|[^;\r\n]+)/gi,
      "$1=***",
    );

    return message;
  }

  /**
   * Coerce a raw DB cell into a JSON-safe primitive. Dates become ISO
   * strings, binary becomes a placeholder, and structured values are
   * stringified — so the compact result projection is always serializable.
   */
  public static coerceCell(value: unknown): string | number | boolean | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (
      typeof value === "number" ||
      typeof value === "boolean" ||
      typeof value === "string"
    ) {
      return value;
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (Buffer.isBuffer(value)) {
      return "[binary]";
    }

    if (typeof value === "bigint") {
      return value.toString();
    }

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  /**
   * Turn the fetched rows into the compact projection reported to OneUptime:
   * a bounded row count, the first cell (scalar), and the first row. Never
   * returns the full result set.
   */
  public static shapeRows(input: {
    rows: Array<Record<string, unknown>>;
    maxRows: number;
  }): {
    rowCount: number;
    scalarValue: string | number | boolean | null;
    firstRow: JSONObject | null;
    isRowsCapped: boolean;
  } {
    const maxRows: number = input.maxRows;
    const isRowsCapped: boolean = input.rows.length > maxRows;
    const keptRows: Array<Record<string, unknown>> = input.rows.slice(
      0,
      maxRows,
    );
    const rowCount: number = keptRows.length;

    let firstRow: JSONObject | null = null;
    let scalarValue: string | number | boolean | null = null;

    if (keptRows[0]) {
      firstRow = {};
      for (const key of Object.keys(keptRows[0])) {
        firstRow[key] = SqlMonitor.coerceCell(keptRows[0][key]);
      }

      /*
       * Scalar = the first column of the first row. The row object is built by
       * each driver in projection order, so its first own key is the first
       * column — this is engine-agnostic and avoids relying on driver column
       * metadata (which, for SQL Server, is keyed by name and collapses
       * duplicate column names).
       */
      const firstColumnName: string | undefined = Object.keys(keptRows[0])[0];
      if (firstColumnName !== undefined) {
        scalarValue = SqlMonitor.coerceCell(keptRows[0][firstColumnName]);
      }
    }

    return { rowCount, scalarValue, firstRow, isRowsCapped };
  }

  public static async execute(
    config: MonitorStepSqlMonitor,
    options?: SqlQueryOptions,
  ): Promise<SqlMonitorResponse | null> {
    if (!options) {
      options = {};
    }

    if (options.currentRetryCount === undefined) {
      options.currentRetryCount = 1;
    }

    if (!options.attempts) {
      options.attempts = [];
    }

    const statementTimeoutInMs: number = clampSqlStatementTimeoutInMs(
      config.statementTimeoutInMs,
    );
    const connectionTimeoutInMs: number = clampSqlConnectionTimeoutInMs(
      config.connectionTimeoutInMs,
    );
    const maxRows: number = clampSqlMaxRows(config.maxRows);

    // Secondary, defense-in-depth static safety check.
    const rejectionReason: string | null = SqlQueryValidator.getRejectionReason(
      config.query,
    );
    if (rejectionReason) {
      return {
        isOnline: false,
        responseTimeInMs: 0,
        failureCause: rejectionReason,
        rowCount: null,
        scalarValue: null,
        firstRow: null,
        queryError: rejectionReason,
      };
    }

    if (!SqlDatabaseTypeUtil.isSupported(config.databaseType)) {
      const message: string = `Database type "${config.databaseType}" is not supported yet. Supported: ${SqlDatabaseTypeUtil.getSupportedDatabaseTypes().join(
        ", ",
      )}.`;
      return {
        isOnline: false,
        responseTimeInMs: 0,
        failureCause: message,
        rowCount: null,
        scalarValue: null,
        firstRow: null,
        queryError: message,
      };
    }

    if (
      config.useWindowsIntegratedAuthentication &&
      config.databaseType !== SqlDatabaseType.MicrosoftSqlServer
    ) {
      const message: string =
        "Windows Integrated Authentication is only supported for Microsoft SQL Server.";
      return {
        isOnline: false,
        responseTimeInMs: 0,
        failureCause: message,
        rowCount: null,
        scalarValue: null,
        firstRow: null,
        queryError: message,
      };
    }

    logger.debug(
      `SQL Query: ${options?.monitorId?.toString()} ${config.host}:${config.port}/${config.databaseName} - Retry: ${options?.currentRetryCount}`,
    );

    const startTime: [number, number] = process.hrtime();
    const attemptedAt: Date = new Date();

    try {
      const rows: Array<Record<string, unknown>> = await SqlMonitor.runQuery({
        config,
        statementTimeoutInMs,
        connectionTimeoutInMs,
        maxRows,
      });

      const endTime: [number, number] = process.hrtime(startTime);
      const responseTimeInMs: number = Math.ceil(
        (endTime[0] * 1000000000 + endTime[1]) / 1000000,
      );

      const shaped: {
        rowCount: number;
        scalarValue: string | number | boolean | null;
        firstRow: JSONObject | null;
        isRowsCapped: boolean;
      } = SqlMonitor.shapeRows({ rows, maxRows });

      const responseReceivedAt: Date = new Date();
      options.attempts.push({
        attemptNumber: options.currentRetryCount,
        attemptedAt,
        responseReceivedAt,
        responseTimeInMs,
        isOnline: true,
      });

      return {
        isOnline: true,
        responseTimeInMs,
        failureCause: "",
        rowCount: shaped.rowCount,
        scalarValue: shaped.scalarValue,
        firstRow: shaped.firstRow,
        isRowsCapped: shaped.isRowsCapped,
        queryError: null,
        probeAttempts: options.attempts,
        totalAttempts: options.attempts.length,
      };
    } catch (err: unknown) {
      const sanitized: string = SqlMonitor.sanitizeError(err, config.password, [
        config.host,
        config.username,
        config.databaseName,
      ]);
      logger.debug(
        `SQL Query error: ${options?.monitorId?.toString()} ${config.host}:${config.port} - ${sanitized}`,
      );

      const endTime: [number, number] = process.hrtime(startTime);
      const responseTimeInMs: number = Math.ceil(
        (endTime[0] * 1000000000 + endTime[1]) / 1000000,
      );

      const responseReceivedAt: Date = new Date();
      options.attempts.push({
        attemptNumber: options.currentRetryCount || 1,
        attemptedAt,
        responseReceivedAt,
        responseTimeInMs,
        isOnline: false,
        failureCause: sanitized,
      });

      if (options.currentRetryCount < (options.retry || 3)) {
        options.currentRetryCount++;
        await Sleep.sleep(1000);
        return await SqlMonitor.execute(config, options);
      }

      // Distinguish "probe can't reach anything" from "this DB is down".
      if (!options.isOnlineCheckRequest) {
        if (!(await OnlineCheck.canProbeMonitorWebsiteMonitors())) {
          logger.error(
            `SqlMonitor - Probe is not online. Cannot query ${options?.monitorId?.toString()} ${config.host} - ERROR: ${sanitized}`,
          );
          return null;
        }
      }

      const lowerCased: string = sanitized.toLowerCase();
      const isTimeout: boolean =
        lowerCased.includes("timeout") ||
        lowerCased.includes("timed out") ||
        lowerCased.includes("etimedout") ||
        // Postgres statement_timeout.
        lowerCased.includes("canceling statement") ||
        // MySQL MAX_EXECUTION_TIME (ER_QUERY_TIMEOUT).
        lowerCased.includes("maximum statement execution time") ||
        lowerCased.includes("execution was interrupted") ||
        // SQL Server request timeout.
        lowerCased.includes("request timed out");

      return {
        isOnline: false,
        isTimeout,
        responseTimeInMs,
        failureCause: sanitized,
        rowCount: null,
        scalarValue: null,
        firstRow: null,
        queryError: sanitized,
        probeAttempts: options.attempts,
        totalAttempts: options.attempts.length,
      };
    }
  }

  /**
   * Dispatch to the executor for the configured database engine. The caller
   * (execute) has already verified the engine is supported, so the default
   * case (PostgreSQL) is only a safety net.
   */
  private static async runQuery(input: {
    config: MonitorStepSqlMonitor;
    statementTimeoutInMs: number;
    connectionTimeoutInMs: number;
    maxRows: number;
  }): Promise<Array<Record<string, unknown>>> {
    switch (input.config.databaseType) {
      case SqlDatabaseType.MySQL:
        return await SqlMonitor.runMySqlQuery(input);
      case SqlDatabaseType.MicrosoftSqlServer:
        return await SqlMonitor.runMicrosoftSqlServerQuery(input);
      case SqlDatabaseType.PostgreSQL:
      default:
        return await SqlMonitor.runPostgresQuery(input);
    }
  }

  /**
   * Race a query against a hard client-side timeout. When the timeout wins,
   * onTimeout() tears the connection/request down so the abandoned query stops
   * consuming resources, and a late rejection of the raced promise is swallowed
   * (it is already handled by the race).
   */
  private static withHardTimeout<T>(input: {
    promise: Promise<T>;
    timeoutInMs: number;
    onTimeout: () => void;
  }): Promise<T> {
    input.promise.catch(() => {
      /*
       * Handled by the race below; prevents an unhandled rejection once the
       * timeout has already won.
       */
    });

    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise: Promise<never> = new Promise<never>(
      (_resolve: (value: never) => void, reject: (reason: Error) => void) => {
        timer = setTimeout(() => {
          try {
            input.onTimeout();
          } catch {
            // Ignore teardown errors — we are already failing this attempt.
          }
          reject(new Error("SQL query timed out."));
        }, input.timeoutInMs);
      },
    );

    return Promise.race([input.promise, timeoutPromise]).finally(() => {
      if (timer) {
        clearTimeout(timer);
      }
    });
  }

  /**
   * Connect to PostgreSQL and run the user's query inside a READ ONLY
   * transaction with a hard statement timeout, reading at most maxRows+1 rows
   * via a cursor (the +1 lets the caller detect truncation). The transaction
   * is always rolled back and the connection always closed.
   */
  private static async runPostgresQuery(input: {
    config: MonitorStepSqlMonitor;
    statementTimeoutInMs: number;
    connectionTimeoutInMs: number;
    maxRows: number;
  }): Promise<Array<Record<string, unknown>>> {
    const { config, statementTimeoutInMs, connectionTimeoutInMs, maxRows } =
      input;

    const clientConfig: ClientConfig = {
      host: config.host,
      port: config.port,
      database: config.databaseName,
      user: config.username,
      password: config.password,
      connectionTimeoutMillis: connectionTimeoutInMs,
      // Server-side per-statement cap (primary timeout control).
      statement_timeout: statementTimeoutInMs,
      // Client-side backstop in case the server ignores statement_timeout.
      query_timeout: statementTimeoutInMs + 2000,
      application_name: "OneUptimeProbe-SQLMonitor",
      ssl: config.useSsl
        ? { rejectUnauthorized: config.rejectUnauthorizedSsl }
        : false,
    };

    const client: Client = new Client(clientConfig);

    await client.connect();

    const cursorName: string = "oneuptime_sql_monitor_cursor";

    // Strip any trailing terminator so it can be embedded in DECLARE ... CURSOR.
    const cursorQuery: string = config.query.replace(/;+\s*$/g, "").trim();

    try {
      /*
       * Authoritative read-only guarantee: a read-only transaction blocks all
       * writes, including Postgres writable CTEs, regardless of the query text.
       */
      await client.query("START TRANSACTION READ ONLY");
      await client.query(
        `SET LOCAL statement_timeout = ${Math.floor(statementTimeoutInMs)}`,
      );

      await client.query(
        `DECLARE ${cursorName} NO SCROLL CURSOR FOR ${cursorQuery}`,
      );

      const result: QueryResult = await client.query(
        `FETCH FORWARD ${maxRows + 1} FROM ${cursorName}`,
      );

      return (result.rows as Array<Record<string, unknown>>) || [];
    } finally {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackErr) {
        logger.debug(`SQL monitor rollback failed: ${rollbackErr}`);
      }

      try {
        await client.end();
      } catch (endErr) {
        logger.debug(`SQL monitor connection close failed: ${endErr}`);
      }
    }
  }

  /**
   * Connect to MySQL and run the user's query inside a READ ONLY transaction
   * (writes error out) with a best-effort server-side statement timeout, a
   * hard client-side timeout backstop, and a streamed read that stops after
   * maxRows+1 rows (the +1 lets the caller detect truncation). The transaction
   * is always rolled back and the connection always closed.
   */
  private static async runMySqlQuery(input: {
    config: MonitorStepSqlMonitor;
    statementTimeoutInMs: number;
    connectionTimeoutInMs: number;
    maxRows: number;
  }): Promise<Array<Record<string, unknown>>> {
    const { config, statementTimeoutInMs, connectionTimeoutInMs, maxRows } =
      input;

    const connectionOptions: MySqlConnectionOptions = {
      host: config.host,
      port: config.port,
      database: config.databaseName,
      user: config.username,
      password: config.password,
      connectTimeout: connectionTimeoutInMs,
      // Never allow stacked statements at the driver level (defense in depth).
      multipleStatements: false,
    };

    if (config.useSsl) {
      connectionOptions.ssl = {
        rejectUnauthorized: config.rejectUnauthorizedSsl,
      };
    }

    const query: string = config.query.replace(/;+\s*$/g, "").trim();

    const connection: MySqlConnection =
      await createMySqlConnection(connectionOptions);

    /*
     * Every setup/teardown statement is bounded by a client-side timeout that
     * destroys the socket if it stalls, so a wedged-but-connected server can
     * never hang the probe (mysql2 has no global per-connection query timeout).
     */
    const setupTimeoutInMs: number = connectionTimeoutInMs;
    const teardownTimeoutInMs: number = 5000;

    try {
      /*
       * Best-effort server-side statement timeout (MySQL 5.7.8+; the variable
       * is unknown on some forks/older versions, so a failure here is
       * non-fatal — the hard client-side backstop below is the real bound).
       */
      try {
        await SqlMonitor.runMySqlStatement(
          connection,
          `SET SESSION MAX_EXECUTION_TIME = ${Math.floor(statementTimeoutInMs)}`,
          setupTimeoutInMs,
        );
      } catch (setTimeoutErr) {
        logger.debug(`MySQL MAX_EXECUTION_TIME not set: ${setTimeoutErr}`);
      }

      /*
       * Secondary, default-case row bound. An explicit LIMIT in the user's
       * query takes precedence over SQL_SELECT_LIMIT, so the authoritative row
       * cap is the streamed read below — this just trims the common
       * forgot-a-WHERE case at the server.
       */
      await SqlMonitor.runMySqlStatement(
        connection,
        `SET SESSION SQL_SELECT_LIMIT = ${maxRows + 1}`,
        setupTimeoutInMs,
      );

      /*
       * Authoritative read-only guarantee: a read-only transaction rejects any
       * write, regardless of the query text.
       */
      await SqlMonitor.runMySqlStatement(
        connection,
        "START TRANSACTION READ ONLY",
        setupTimeoutInMs,
      );

      return await SqlMonitor.streamMySqlRows({
        connection,
        query,
        maxRows,
        hardTimeoutInMs: statementTimeoutInMs + 2000,
      });
    } finally {
      try {
        await SqlMonitor.runMySqlStatement(
          connection,
          "ROLLBACK",
          teardownTimeoutInMs,
        );
      } catch (rollbackErr) {
        logger.debug(`MySQL monitor rollback failed: ${rollbackErr}`);
      }

      try {
        await SqlMonitor.withHardTimeout({
          promise: connection.end(),
          timeoutInMs: teardownTimeoutInMs,
          onTimeout: (): void => {
            connection.destroy();
          },
        });
      } catch (endErr) {
        logger.debug(`MySQL monitor connection close failed: ${endErr}`);
        try {
          connection.destroy();
        } catch {
          // Best effort — the socket may already be gone.
        }
      }
    }
  }

  /**
   * Run a single MySQL setup/teardown statement bounded by a hard client-side
   * timeout that destroys the connection if it stalls.
   */
  private static async runMySqlStatement(
    connection: MySqlConnection,
    sql: string,
    timeoutInMs: number,
  ): Promise<void> {
    await SqlMonitor.withHardTimeout({
      promise: connection.query(sql).then((): void => {
        return undefined;
      }),
      timeoutInMs,
      onTimeout: (): void => {
        connection.destroy();
      },
    });
  }

  /**
   * Stream rows from an already-open MySQL connection, collecting at most
   * maxRows+1 rows and then hard-stopping (row streaming is not exposed on the
   * mysql2 promise API, so we reach the underlying core connection). A hard
   * timeout tears the connection down if the query stalls.
   */
  private static streamMySqlRows(input: {
    connection: MySqlConnection;
    query: string;
    maxRows: number;
    hardTimeoutInMs: number;
  }): Promise<Array<Record<string, unknown>>> {
    const { connection, query, maxRows, hardTimeoutInMs } = input;

    return new Promise(
      (
        resolve: (value: Array<Record<string, unknown>>) => void,
        reject: (reason: Error) => void,
      ) => {
        const rows: Array<Record<string, unknown>> = [];
        let settled: boolean = false;

        const coreConnection: MySqlCoreConnection = (
          connection as unknown as { connection: MySqlCoreConnection }
        ).connection;

        const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
          try {
            coreConnection.destroy();
          } catch {
            // Best effort.
          }
          finish(new Error("SQL query timed out."));
        }, hardTimeoutInMs);

        function finish(err?: Error): void {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          if (err) {
            reject(err);
          } else {
            resolve(rows);
          }
        }

        try {
          const stream: MySqlQueryStream = coreConnection.query(query);

          stream.on("result", (row: unknown) => {
            rows.push(row as Record<string, unknown>);
            if (rows.length >= maxRows + 1) {
              /*
               * Stop reading once we are one past the cap so shapeRows can
               * flag truncation. Destroying the socket cancels the query.
               */
              try {
                coreConnection.destroy();
              } catch {
                // Best effort.
              }
              finish();
            }
          });

          stream.on("error", (err: unknown) => {
            finish(err as Error);
          });

          stream.on("end", () => {
            finish();
          });
        } catch (err) {
          finish(err as Error);
        }
      },
    );
  }

  /**
   * Connect to Microsoft SQL Server and run the user's query. SQL Server has
   * no READ ONLY transaction, so the primary read-only control is the
   * least-privilege database user; as defense-in-depth we run inside a
   * transaction that is ALWAYS rolled back (undoing any write) on top of the
   * single-statement + allow-list guard applied before connecting. Rows are
   * hard-capped at maxRows+1 server-side with SET ROWCOUNT, with a request
   * timeout plus a hard client-side backstop.
   */
  private static async runMicrosoftSqlServerQuery(input: {
    config: MonitorStepSqlMonitor;
    statementTimeoutInMs: number;
    connectionTimeoutInMs: number;
    maxRows: number;
  }): Promise<Array<Record<string, unknown>>> {
    const { config, statementTimeoutInMs, connectionTimeoutInMs, maxRows } =
      input;

    const query: string = config.query.replace(/;+\s*$/g, "").trim();

    /*
     * Teardown is bounded so a still-in-flight (e.g. cancelled) request can
     * never hang pool.close() — tarn waits for borrowed connections forever.
     */
    const teardownTimeoutInMs: number = 5000;

    /*
     * Only trusted connections use the ODBC connection string, so only resolve
     * (and pay for host driver detection) in that mode.
     */
    const odbcDriver: string | undefined =
      config.useWindowsIntegratedAuthentication
        ? await resolveSqlServerOdbcDriver()
        : undefined;

    const poolConfig: MicrosoftSqlServerPoolConfig =
      buildMicrosoftSqlServerPoolConfig({
        config,
        statementTimeoutInMs,
        connectionTimeoutInMs,
        odbcDriver,
      });

    const sqlServerDriver: typeof mssql = loadMicrosoftSqlServerDriver(
      config.useWindowsIntegratedAuthentication,
    );

    const pool: mssql.ConnectionPool = new sqlServerDriver.ConnectionPool(
      poolConfig,
    );
    let transaction: mssql.Transaction | undefined;
    let transactionBegun: boolean = false;

    try {
      /*
       * Inside the try so a connect failure still hits the finally that closes
       * the pool (no leaked pool on an unreachable / auth-rejected database).
       */
      await pool.connect();

      transaction = new sqlServerDriver.Transaction(pool);
      await transaction.begin();
      transactionBegun = true;

      /*
       * Hard server-side row cap: SET ROWCOUNT stops the server after the
       * given number of rows (the +1 lets the caller detect truncation) and
       * wins over a larger user-supplied TOP. It is connection-scoped, so it
       * applies to the query request that runs next on this transaction.
       */
      const setRequest: mssql.Request = new sqlServerDriver.Request(
        transaction,
      );
      await setRequest.batch(`SET ROWCOUNT ${maxRows + 1}`);

      const request: mssql.Request = new sqlServerDriver.Request(transaction);

      const result: mssql.IResult<Record<string, unknown>> =
        await SqlMonitor.withHardTimeout({
          promise: request.query<Record<string, unknown>>(query),
          timeoutInMs: statementTimeoutInMs + 2000,
          onTimeout: () => {
            request.cancel();
          },
        });

      const recordset: mssql.IRecordSet<Record<string, unknown>> | undefined =
        result.recordset;

      return recordset ? Array.from(recordset) : [];
    } finally {
      if (transactionBegun && transaction) {
        try {
          /*
           * On the timeout path the request may still be cancelling, so
           * rollback can return quickly with EREQINPROG — bound it anyway so
           * teardown can never wait on it.
           */
          await SqlMonitor.withHardTimeout({
            promise: transaction.rollback(),
            timeoutInMs: teardownTimeoutInMs,
            onTimeout: (): void => {
              // No forceful rollback API; fall through to closing the pool.
            },
          });
        } catch (rollbackErr) {
          logger.debug(`SQL Server monitor rollback failed: ${rollbackErr}`);
        }
      }

      try {
        /*
         * pool.close() waits (unbounded) for every borrowed connection to be
         * returned; a stuck/cancelling request would otherwise hang the probe
         * forever. Bound it and move on — the abandoned connection is left to
         * the server's own timeout to reap.
         */
        await SqlMonitor.withHardTimeout({
          promise: pool.close(),
          timeoutInMs: teardownTimeoutInMs,
          onTimeout: (): void => {
            // No forceful destroy API on the pool; stop waiting on close.
          },
        });
      } catch (closeErr) {
        logger.debug(
          `SQL Server monitor pool close did not complete in time: ${closeErr}`,
        );
      }
    }
  }
}
