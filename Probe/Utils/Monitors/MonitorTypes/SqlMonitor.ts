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
import { SqlDatabaseTypeUtil } from "Common/Types/Monitor/SqlDatabaseType";
import SqlMonitorResponse from "Common/Types/Monitor/SqlMonitor/SqlMonitorResponse";
import { Client, ClientConfig, FieldDef, QueryResult } from "pg";

export interface SqlQueryOptions {
  timeout?: number | undefined;
  retry?: number | undefined;
  currentRetryCount?: number | undefined;
  monitorId?: ObjectID | undefined;
  isOnlineCheckRequest?: boolean | undefined;
  attempts?: Array<ProbeAttempt> | undefined;
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

    return null;
  }
}

export default class SqlMonitor {
  /**
   * Strip anything that could leak the connection secret out of a driver
   * error message before it is stored/returned. Never let the password or a
   * connection URI escape the probe.
   */
  public static sanitizeError(
    error: unknown,
    password: string | undefined,
  ): string {
    let message: string =
      (error as Error)?.message || (error as Error)?.toString() || "SQL error";

    if (password && password.length > 0) {
      message = message.split(password).join("***");
    }

    // Redact any connection URIs (postgres://user:pass@host/db).
    message = message.replace(/[a-zA-Z]+:\/\/[^\s]*@[^\s]*/g, "[redacted-dsn]");

    return message;
  }

  /**
   * Coerce a raw DB cell into a JSON-safe primitive. Dates become ISO
   * strings, binary becomes a placeholder, and structured values are
   * stringified — so the compact result projection is always serializable.
   */
  public static coerceCell(
    value: unknown,
  ): string | number | boolean | null {
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
    fields: Array<FieldDef>;
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

      const firstColumnName: string | undefined = input.fields[0]?.name;
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

    logger.debug(
      `SQL Query: ${options?.monitorId?.toString()} ${config.host}:${config.port}/${config.databaseName} - Retry: ${options?.currentRetryCount}`,
    );

    const startTime: [number, number] = process.hrtime();
    const attemptedAt: Date = new Date();

    try {
      const { rows, fields } = await SqlMonitor.runPostgresQuery({
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
      } = SqlMonitor.shapeRows({ rows, fields, maxRows });

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
      const sanitized: string = SqlMonitor.sanitizeError(err, config.password);
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

      const isTimeout: boolean =
        sanitized.toLowerCase().includes("timeout") ||
        sanitized.toLowerCase().includes("timed out") ||
        sanitized.toLowerCase().includes("etimedout") ||
        sanitized.toLowerCase().includes("canceling statement");

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
  }): Promise<{ rows: Array<Record<string, unknown>>; fields: Array<FieldDef> }> {
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
      // Authoritative read-only guarantee: a read-only transaction blocks all
      // writes, including Postgres writable CTEs, regardless of the query text.
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

      return {
        rows: (result.rows as Array<Record<string, unknown>>) || [],
        fields: result.fields || [],
      };
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
}
