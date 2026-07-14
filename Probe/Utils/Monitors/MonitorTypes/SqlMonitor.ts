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
  FieldPacket as MySqlFieldPacket,
  createConnection as createMySqlConnection,
} from "mysql2/promise";
import * as mssql from "mssql";

export interface SqlQueryOptions {
  timeout?: number | undefined;
  retry?: number | undefined;
  currentRetryCount?: number | undefined;
  monitorId?: ObjectID | undefined;
  isOnlineCheckRequest?: boolean | undefined;
  attempts?: Array<ProbeAttempt> | undefined;
}

/*
 * Minimal, driver-agnostic column descriptor. Every engine driver returns
 * richer column metadata, but the compact projection only needs the column
 * name (to pick the scalar / first-column value), so the executors normalize
 * their driver-specific field types down to this shape.
 */
export interface SqlResultColumn {
  name: string;
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

    /*
     * Redact any connection URIs (postgres://user:pass@host/db,
     * mysql://..., sqlserver://...).
     */
    message = message.replace(/[a-zA-Z]+:\/\/[^\s]*@[^\s]*/g, "[redacted-dsn]");

    /*
     * Redact password / pwd key-value pairs from connection-string style
     * errors (e.g. SQL Server: "...Password=secret;Server=...").
     */
    message = message.replace(/(password|pwd)\s*=\s*[^;\s]+/gi, "$1=***");

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
    fields: Array<SqlResultColumn>;
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
      const { rows, fields } = await SqlMonitor.runQuery({
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
   * Dispatch to the executor for the configured database engine. The caller
   * (execute) has already verified the engine is supported, so the default
   * case (PostgreSQL) is only a safety net.
   */
  private static async runQuery(input: {
    config: MonitorStepSqlMonitor;
    statementTimeoutInMs: number;
    connectionTimeoutInMs: number;
    maxRows: number;
  }): Promise<{
    rows: Array<Record<string, unknown>>;
    fields: Array<SqlResultColumn>;
  }> {
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
  }): Promise<{
    rows: Array<Record<string, unknown>>;
    fields: Array<SqlResultColumn>;
  }> {
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
  }): Promise<{
    rows: Array<Record<string, unknown>>;
    fields: Array<SqlResultColumn>;
  }> {
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

    try {
      /*
       * Best-effort server-side statement timeout (MySQL 5.7.8+; the variable
       * is unknown on some forks/older versions, so a failure here is
       * non-fatal — the hard client-side backstop below is the real bound).
       */
      try {
        await connection.query(
          `SET SESSION MAX_EXECUTION_TIME = ${Math.floor(statementTimeoutInMs)}`,
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
      await connection.query(`SET SESSION SQL_SELECT_LIMIT = ${maxRows + 1}`);

      /*
       * Authoritative read-only guarantee: a read-only transaction rejects any
       * write, regardless of the query text.
       */
      await connection.query("START TRANSACTION READ ONLY");

      return await SqlMonitor.streamMySqlRows({
        connection,
        query,
        maxRows,
        hardTimeoutInMs: statementTimeoutInMs + 2000,
      });
    } finally {
      try {
        await connection.query("ROLLBACK");
      } catch (rollbackErr) {
        logger.debug(`MySQL monitor rollback failed: ${rollbackErr}`);
      }

      try {
        await connection.end();
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
  }): Promise<{
    rows: Array<Record<string, unknown>>;
    fields: Array<SqlResultColumn>;
  }> {
    const { connection, query, maxRows, hardTimeoutInMs } = input;

    return new Promise(
      (
        resolve: (value: {
          rows: Array<Record<string, unknown>>;
          fields: Array<SqlResultColumn>;
        }) => void,
        reject: (reason: Error) => void,
      ) => {
        const rows: Array<Record<string, unknown>> = [];
        let fields: Array<SqlResultColumn> = [];
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
            resolve({ rows, fields });
          }
        }

        try {
          const stream: MySqlQueryStream = coreConnection.query(query);

          stream.on("fields", (rawFields: unknown) => {
            fields = ((rawFields as Array<MySqlFieldPacket>) || []).map(
              (field: MySqlFieldPacket) => {
                return { name: field.name };
              },
            );
          });

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
  }): Promise<{
    rows: Array<Record<string, unknown>>;
    fields: Array<SqlResultColumn>;
  }> {
    const { config, statementTimeoutInMs, connectionTimeoutInMs, maxRows } =
      input;

    const query: string = config.query.replace(/;+\s*$/g, "").trim();

    const poolConfig: mssql.config = {
      server: config.host,
      port: config.port,
      database: config.databaseName,
      user: config.username,
      password: config.password,
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

    const pool: mssql.ConnectionPool = new mssql.ConnectionPool(poolConfig);
    let transaction: mssql.Transaction | undefined;
    let transactionBegun: boolean = false;

    try {
      // Inside the try so a connect failure still hits the finally that closes
      // the pool (no leaked pool on an unreachable / auth-rejected database).
      await pool.connect();

      transaction = new mssql.Transaction(pool);
      await transaction.begin();
      transactionBegun = true;

      /*
       * Hard server-side row cap: SET ROWCOUNT stops the server after the
       * given number of rows (the +1 lets the caller detect truncation) and
       * wins over a larger user-supplied TOP. It is connection-scoped, so it
       * applies to the query request that runs next on this transaction.
       */
      const setRequest: mssql.Request = new mssql.Request(transaction);
      await setRequest.batch(`SET ROWCOUNT ${maxRows + 1}`);

      const request: mssql.Request = new mssql.Request(transaction);

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

      const rows: Array<Record<string, unknown>> = recordset
        ? Array.from(recordset)
        : [];

      const fields: Array<SqlResultColumn> = SqlMonitor.mssqlColumnsInOrder(
        recordset?.columns,
      );

      return { rows, fields };
    } finally {
      if (transactionBegun && transaction) {
        try {
          await transaction.rollback();
        } catch (rollbackErr) {
          logger.debug(`SQL Server monitor rollback failed: ${rollbackErr}`);
        }
      }

      try {
        await pool.close();
      } catch (closeErr) {
        logger.debug(`SQL Server monitor pool close failed: ${closeErr}`);
      }
    }
  }

  /**
   * Order SQL Server column metadata by its declared index so the first column
   * (the scalar target) matches the query's projection order.
   */
  private static mssqlColumnsInOrder(
    columns: mssql.IColumnMetadata | undefined,
  ): Array<SqlResultColumn> {
    if (!columns) {
      return [];
    }

    return Object.values(columns)
      .sort((a: { index: number }, b: { index: number }) => {
        return a.index - b.index;
      })
      .map((column: { name: string }) => {
        return { name: column.name };
      });
  }
}
