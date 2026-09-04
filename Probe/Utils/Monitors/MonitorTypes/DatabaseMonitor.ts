import OnlineCheck from "../../OnlineCheck";
import SqlMonitor, {
  buildMicrosoftSqlServerPoolConfig,
  loadMicrosoftSqlServerDriver,
  MicrosoftSqlServerPoolConfig,
  resolveSqlServerOdbcDriver,
} from "./SqlMonitor";
import DatabaseMonitorResponse, {
  DatabaseMetricGroupStatus,
  DatabaseMetricGroupUnavailableReason,
} from "Common/Types/Monitor/DatabaseMonitor/DatabaseMonitorResponse";
import {
  DatabaseHealthQuery,
  DatabaseQueryColumnMapping,
  getDatabaseHealthQueries,
  getProbeQuery,
} from "./DatabaseMonitor/DatabaseHealthQueries";
import { DatabaseMetricGroup } from "Common/Types/Monitor/DatabaseMetricCatalog";
import MonitorMetricType from "Common/Types/Monitor/MonitorMetricType";
import MonitorStepDatabaseMonitor from "Common/Types/Monitor/MonitorStepDatabaseMonitor";
import ObjectID from "Common/Types/ObjectID";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import Sleep from "Common/Types/Sleep";
import SqlDatabaseType, {
  SqlDatabaseTypeUtil,
} from "Common/Types/Monitor/SqlDatabaseType";
import {
  clampSqlConnectionTimeoutInMs,
  clampSqlStatementTimeoutInMs,
} from "Common/Types/Monitor/MonitorStepSqlMonitor";
import logger from "Common/Server/Utils/Logger";
import * as mssql from "mssql";
import { Client, ClientConfig, QueryResult } from "pg";
import {
  Connection as MySqlConnection,
  ConnectionOptions as MySqlConnectionOptions,
  createConnection as createMySqlConnection,
} from "mysql2/promise";

export interface DatabaseMonitorExecuteOptions {
  monitorId?: ObjectID | undefined;
  retry?: number | undefined;
  currentRetryCount?: number | undefined;
  attempts?: Array<ProbeAttempt> | undefined;
  isOnlineCheckRequest?: boolean | undefined;
  timeout?: number | undefined;
}

/*
 * One connection, opened for the whole check, that can run a statement and
 * be closed. Each engine implements it once; everything above this line is
 * engine-agnostic.
 */
interface DatabaseHealthSession {
  runQuery(sql: string): Promise<Array<Record<string, unknown>>>;
  close(): Promise<void>;
}

/*
 * The Database Health monitor's collector.
 *
 * The shape of this class follows from one rule: A DATABASE THAT ANSWERS IS
 * ONLINE. Only the probe query - a single trivial statement - can set
 * isOnline to false. Every catalog query after it runs inside its own
 * try/catch, and a failure there produces an entry in unavailableGroups
 * instead of an outage. That is what makes it safe to enable every group by
 * default: the worst case for a locked-down monitoring login is a monitor
 * that reports fewer metrics, never one that pages at 3am because it cannot
 * read sys.dm_os_performance_counters.
 */
export default class DatabaseMonitor {
  public static async execute(
    config: MonitorStepDatabaseMonitor,
    options?: DatabaseMonitorExecuteOptions,
  ): Promise<DatabaseMonitorResponse | null> {
    if (!options) {
      options = {};
    }

    if (options.currentRetryCount === undefined) {
      options.currentRetryCount = 1;
    }

    if (!options.attempts) {
      options.attempts = [];
    }

    if (!SqlDatabaseTypeUtil.isSupported(config.databaseType)) {
      const message: string = `Database type "${config.databaseType}" is not supported yet. Supported: ${SqlDatabaseTypeUtil.getSupportedDatabaseTypes().join(
        ", ",
      )}.`;
      return this.buildOfflineResponse(message, 0);
    }

    if (
      config.useWindowsIntegratedAuthentication &&
      config.databaseType !== SqlDatabaseType.MicrosoftSqlServer
    ) {
      const message: string =
        "Windows Integrated Authentication is only supported for Microsoft SQL Server.";
      return this.buildOfflineResponse(message, 0);
    }

    const statementTimeoutInMs: number = clampSqlStatementTimeoutInMs(
      config.statementTimeoutInMs,
    );
    const connectionTimeoutInMs: number = clampSqlConnectionTimeoutInMs(
      config.connectionTimeoutInMs,
    );

    const startTime: [number, number] = process.hrtime();
    const attemptedAt: Date = new Date();

    let session: DatabaseHealthSession | undefined;

    try {
      session = await this.openSession({
        config,
        statementTimeoutInMs,
        connectionTimeoutInMs,
      });

      /*
       * The one statement whose failure means "offline". It doubles as the
       * source of the engine version and, on PostgreSQL, of the recovery
       * state that decides which replication query is valid to run.
       */
      const probeRows: Array<Record<string, unknown>> = await session.runQuery(
        getProbeQuery(config.databaseType),
      );

      const responseTimeInMs: number = this.elapsedMs(startTime);

      const probeRow: Record<string, unknown> = probeRows[0] || {};
      const engineVersion: string | undefined = this.readString(
        probeRow,
        "engine_version",
      );
      const serverVersionNum: number | null = this.readNumber(
        probeRow,
        "server_version_num",
      );
      const isInRecovery: boolean = this.readBoolean(
        probeRow,
        "is_in_recovery",
      );

      /*
       * PostgreSQL only, and absent for other engines - which is why the
       * default is `true` there: only PostgreSQL has the silent
       * under-reporting mode this flag guards against.
       */
      const hasPostgresStatsAccess: boolean =
        config.databaseType === SqlDatabaseType.PostgreSQL
          ? this.readBoolean(probeRow, "has_stats_access")
          : true;

      const metrics: Partial<Record<MonitorMetricType, number>> = {};
      const rawColumns: Record<string, number> = {};
      const collectedGroups: Array<DatabaseMetricGroup> = [];
      const unavailableGroups: Array<DatabaseMetricGroupStatus> = [];

      const enabledGroups: Array<DatabaseMetricGroup> =
        config.enabledMetricGroups || [];

      for (const query of getDatabaseHealthQueries(config.databaseType)) {
        if (!enabledGroups.includes(query.group)) {
          continue;
        }

        /*
         * Refusing to run beats running and believing the answer. A
         * pg_stat_activity query without pg_monitor succeeds and returns
         * the monitoring session alone, so "connections = 1" would be
         * recorded as fact and would never alert.
         */
        if (query.requiresPostgresStatsAccess && !hasPostgresStatsAccess) {
          this.recordUnavailableGroup({
            unavailableGroups,
            group: query.group,
            message:
              "The monitoring role cannot read other sessions' statistics. PostgreSQL does not report this as an error - it silently returns only this connection's own rows - so these metrics are skipped rather than recorded as wrong values.",
            remediation: query.remediation,
            forceReason: DatabaseMetricGroupUnavailableReason.MissingPermission,
          });
          continue;
        }

        if (!this.shouldRunQuery({ query, serverVersionNum, isInRecovery })) {
          continue;
        }

        try {
          const rows: Array<Record<string, unknown>> = await session.runQuery(
            query.sql,
          );

          /*
           * Zero rows is a legitimate answer, not a failure: SHOW REPLICA
           * STATUS returns nothing at all on a server that is not a replica.
           * The group counts as collected and simply contributes no values.
           */
          const row: Record<string, unknown> = rows[0] || {};

          this.applyColumnMappings({
            row,
            mappings: query.columnMappings,
            metrics,
          });

          this.collectRawColumns({ row, rawColumns });

          if (!collectedGroups.includes(query.group)) {
            collectedGroups.push(query.group);
          }
        } catch (err: unknown) {
          const sanitized: string = SqlMonitor.sanitizeError(
            err,
            config.password,
            [config.host, config.username, config.databaseName],
          );

          logger.debug(
            `Database monitor ${options.monitorId?.toString()}: query ${query.id} failed - ${sanitized}`,
          );

          this.recordUnavailableGroup({
            unavailableGroups,
            group: query.group,
            message: sanitized,
            remediation: query.remediation,
          });
        }
      }

      this.applyDerivedMetrics({
        databaseType: config.databaseType,
        rawColumns,
        metrics,
      });

      /*
       * A group that produced values in one query and failed in another is
       * both collected and unavailable - the operator should see the
       * remediation while still getting what did come back. Report the
       * failure count so it can be alerted on.
       */
      metrics[MonitorMetricType.DatabaseMetricGroupsFailed] =
        unavailableGroups.length;

      return {
        isOnline: true,
        responseTimeInMs,
        failureCause: "",
        metrics,
        collectedGroups,
        unavailableGroups,
        engineVersion,
        connectionError: null,
        probeAttempts: options.attempts,
        totalAttempts: options.attempts.length + 1,
      };
    } catch (err: unknown) {
      const sanitized: string = SqlMonitor.sanitizeError(err, config.password, [
        config.host,
        config.username,
        config.databaseName,
      ]);

      logger.debug(
        `Database monitor error: ${options.monitorId?.toString()} ${config.host}:${config.port} - ${sanitized}`,
      );

      const responseTimeInMs: number = this.elapsedMs(startTime);

      options.attempts.push({
        attemptNumber: options.currentRetryCount || 1,
        attemptedAt,
        responseReceivedAt: new Date(),
        responseTimeInMs,
        isOnline: false,
        failureCause: sanitized,
      });

      if (options.currentRetryCount < (options.retry || 3)) {
        options.currentRetryCount++;
        await Sleep.sleep(1000);
        return await DatabaseMonitor.execute(config, options);
      }

      /*
       * Same guard the other probe monitors use: if the probe itself cannot
       * reach anything, returning null suppresses the check rather than
       * reporting every monitored database as down.
       */
      if (!options.isOnlineCheckRequest) {
        if (!(await OnlineCheck.canProbeMonitorWebsiteMonitors())) {
          logger.error(
            `DatabaseMonitor - Probe is not online. Cannot reach ${options.monitorId?.toString()} ${config.host} - ERROR: ${sanitized}`,
          );
          return null;
        }
      }

      return {
        ...this.buildOfflineResponse(sanitized, responseTimeInMs),
        isTimeout: this.isTimeoutMessage(sanitized),
        probeAttempts: options.attempts,
        totalAttempts: options.attempts.length,
      };
    } finally {
      if (session) {
        try {
          await session.close();
        } catch (closeErr) {
          logger.debug(`Database monitor connection close failed: ${closeErr}`);
        }
      }
    }
  }

  private static buildOfflineResponse(
    failureCause: string,
    responseTimeInMs: number,
  ): DatabaseMonitorResponse {
    return {
      isOnline: false,
      responseTimeInMs,
      failureCause,
      metrics: {},
      collectedGroups: [],
      unavailableGroups: [],
      connectionError: failureCause,
    };
  }

  public static isTimeoutMessage(message: string): boolean {
    const lowerCased: string = message.toLowerCase();
    return (
      lowerCased.includes("timeout") ||
      lowerCased.includes("timed out") ||
      lowerCased.includes("etimedout") ||
      // PostgreSQL statement_timeout.
      lowerCased.includes("canceling statement") ||
      // MySQL MAX_EXECUTION_TIME (ER_QUERY_TIMEOUT).
      lowerCased.includes("maximum statement execution time") ||
      lowerCased.includes("execution was interrupted") ||
      // SQL Server request timeout.
      lowerCased.includes("request timed out")
    );
  }

  /**
   * Turn a failed catalog query into an operator-actionable reason.
   *
   * The distinction that matters is permission versus capability: "you are
   * missing a grant, here is the GRANT statement" and "your engine cannot
   * report this, nothing to do" call for completely different reactions, and
   * both are common enough that collapsing them into "error" would make the
   * summary view useless.
   */
  public static classifyQueryFailure(
    message: string,
  ): DatabaseMetricGroupUnavailableReason {
    const lowerCased: string = message.toLowerCase();

    if (this.isTimeoutMessage(message)) {
      return DatabaseMetricGroupUnavailableReason.Timeout;
    }

    if (
      lowerCased.includes("permission denied") ||
      lowerCased.includes("access denied") ||
      lowerCased.includes("must be superuser") ||
      lowerCased.includes("insufficient privilege") ||
      // SQL Server: "VIEW SERVER STATE permission was denied".
      lowerCased.includes("permission was denied") ||
      lowerCased.includes("is not allowed to")
    ) {
      return DatabaseMetricGroupUnavailableReason.MissingPermission;
    }

    if (
      // PostgreSQL: relation "pg_stat_checkpointer" does not exist.
      lowerCased.includes("does not exist") ||
      // MySQL: Table 'performance_schema.x' doesn't exist / Unknown column.
      lowerCased.includes("doesn't exist") ||
      lowerCased.includes("unknown column") ||
      lowerCased.includes("unknown table") ||
      // SQL Server: Invalid object name / Invalid column name.
      lowerCased.includes("invalid object name") ||
      lowerCased.includes("invalid column name") ||
      lowerCased.includes("syntax error")
    ) {
      return DatabaseMetricGroupUnavailableReason.NotSupportedByEngine;
    }

    return DatabaseMetricGroupUnavailableReason.Error;
  }

  private static recordUnavailableGroup(input: {
    unavailableGroups: Array<DatabaseMetricGroupStatus>;
    group: DatabaseMetricGroup;
    message: string;
    remediation?: string | undefined;
    /*
     * Set when the caller already knows the reason and must not have it
     * inferred from the message text - the privilege preflight, whose
     * message is ours rather than a driver's.
     */
    forceReason?: DatabaseMetricGroupUnavailableReason | undefined;
  }): void {
    const { unavailableGroups, group, message } = input;

    const reason: DatabaseMetricGroupUnavailableReason =
      input.forceReason || this.classifyQueryFailure(message);

    const existing: DatabaseMetricGroupStatus | undefined =
      unavailableGroups.find((status: DatabaseMetricGroupStatus) => {
        return status.group === group;
      });

    if (existing) {
      // One entry per group; the first failure is the one worth showing.
      return;
    }

    const status: DatabaseMetricGroupStatus = {
      group,
      reason,
      message,
    };

    /*
     * The GRANT is only useful advice when a grant is actually the problem.
     * Showing it next to "relation does not exist" would send an operator
     * off to change permissions that are already correct.
     */
    if (
      input.remediation &&
      reason === DatabaseMetricGroupUnavailableReason.MissingPermission
    ) {
      status.remediation = input.remediation;
    }

    unavailableGroups.push(status);
  }

  public static shouldRunQuery(input: {
    query: DatabaseHealthQuery;
    serverVersionNum: number | null;
    isInRecovery: boolean;
  }): boolean {
    const { query, serverVersionNum, isInRecovery } = input;

    if (
      query.runOnlyWhenInRecovery !== undefined &&
      query.runOnlyWhenInRecovery !== isInRecovery
    ) {
      return false;
    }

    /*
     * An unknown server version runs the query rather than skipping it. A
     * version gate exists to avoid a KNOWN incompatibility; when we do not
     * know the version, attempting and reporting the failure tells the
     * operator more than silently collecting nothing.
     */
    if (serverVersionNum === null) {
      return true;
    }

    if (
      query.minServerVersionNum !== undefined &&
      serverVersionNum < query.minServerVersionNum
    ) {
      return false;
    }

    if (
      query.maxServerVersionNum !== undefined &&
      serverVersionNum > query.maxServerVersionNum
    ) {
      return false;
    }

    return true;
  }

  public static applyColumnMappings(input: {
    row: Record<string, unknown>;
    mappings: Array<DatabaseQueryColumnMapping>;
    metrics: Partial<Record<MonitorMetricType, number>>;
  }): void {
    for (const mapping of input.mappings) {
      const value: number | null = this.readNumber(input.row, mapping.column);

      /*
       * Absent stays absent. Zero-filling would make "no replication
       * configured" indistinguishable from "replication lag is zero", which
       * is the difference between a healthy replica and no replica at all.
       */
      if (value === null) {
        continue;
      }

      input.metrics[mapping.metricType] = mapping.multiplier
        ? value * mapping.multiplier
        : value;
    }
  }

  private static collectRawColumns(input: {
    row: Record<string, unknown>;
    rawColumns: Record<string, number>;
  }): void {
    for (const key of Object.keys(input.row)) {
      const value: number | null = this.readNumber(input.row, key);
      if (value !== null) {
        input.rawColumns[key.toLowerCase()] = value;
      }
    }
  }

  /**
   * Ratios the engines do not hand us directly.
   *
   * These are computed here rather than in SQL so the arithmetic is testable
   * without a database, and so a divide-by-zero on an idle server yields "no
   * value" rather than NaN written into a metric series.
   */
  public static applyDerivedMetrics(input: {
    databaseType: SqlDatabaseType;
    rawColumns: Record<string, number>;
    metrics: Partial<Record<MonitorMetricType, number>>;
  }): void {
    const { databaseType, rawColumns, metrics } = input;

    const connectionsTotal: number | undefined =
      metrics[MonitorMetricType.DatabaseConnectionsTotal];
    const connectionsMax: number | undefined =
      metrics[MonitorMetricType.DatabaseConnectionsMax];

    if (
      connectionsTotal !== undefined &&
      connectionsMax !== undefined &&
      connectionsMax > 0
    ) {
      metrics[MonitorMetricType.DatabaseConnectionsUsedPercent] =
        (connectionsTotal / connectionsMax) * 100;
    }

    if (databaseType === SqlDatabaseType.PostgreSQL) {
      const hit: number | undefined = rawColumns["blks_hit"];
      const read: number | undefined = rawColumns["blks_read"];

      if (hit !== undefined && read !== undefined && hit + read > 0) {
        metrics[MonitorMetricType.DatabaseCacheHitPercent] =
          (hit / (hit + read)) * 100;
      }

      const commit: number | undefined = rawColumns["xact_commit"];
      const rollback: number | undefined = rawColumns["xact_rollback"];

      if (
        commit !== undefined &&
        rollback !== undefined &&
        commit + rollback > 0
      ) {
        metrics[MonitorMetricType.DatabaseTransactionsTotal] =
          commit + rollback;
        metrics[MonitorMetricType.DatabaseRollbackPercent] =
          (rollback / (commit + rollback)) * 100;
      }
    }

    if (databaseType === SqlDatabaseType.MySQL) {
      const requests: number | undefined = rawColumns["bp_read_requests"];
      const diskReads: number | undefined = rawColumns["bp_disk_reads"];

      if (requests !== undefined && diskReads !== undefined && requests > 0) {
        metrics[MonitorMetricType.DatabaseCacheHitPercent] =
          (1 - diskReads / requests) * 100;
      }
    }

    if (databaseType === SqlDatabaseType.MicrosoftSqlServer) {
      const raw: number | undefined = rawColumns["buffer_cache_hit_ratio_raw"];
      const base: number | undefined =
        rawColumns["buffer_cache_hit_ratio_base"];

      /*
       * SQL Server's buffer cache hit ratio is a raw counter that is only
       * meaningful divided by its companion base counter - reading the raw
       * value alone reports a "hit ratio" of 108.
       */
      if (raw !== undefined && base !== undefined && base > 0) {
        metrics[MonitorMetricType.DatabaseCacheHitPercent] = (raw / base) * 100;
      }
    }
  }

  // ------------------------------------------------------------- value readers

  public static readNumber(
    row: Record<string, unknown>,
    column: string,
  ): number | null {
    const value: unknown = this.readColumn(row, column);

    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === "number") {
      return isFinite(value) ? value : null;
    }

    if (typeof value === "bigint") {
      return Number(value);
    }

    /*
     * PostgreSQL returns bigint and numeric as strings (node-postgres will
     * not silently lose precision), and MySQL returns global_status values
     * as strings too, so this branch is the common case rather than the
     * exception.
     */
    if (typeof value === "string") {
      const trimmed: string = value.trim();
      if (trimmed === "") {
        return null;
      }
      const parsed: number = Number(trimmed);
      return isNaN(parsed) ? null : parsed;
    }

    if (typeof value === "boolean") {
      return value ? 1 : 0;
    }

    return null;
  }

  private static readString(
    row: Record<string, unknown>,
    column: string,
  ): string | undefined {
    const value: unknown = this.readColumn(row, column);

    if (value === null || value === undefined) {
      return undefined;
    }

    return String(value);
  }

  private static readBoolean(
    row: Record<string, unknown>,
    column: string,
  ): boolean {
    const value: unknown = this.readColumn(row, column);

    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "string") {
      const lowerCased: string = value.trim().toLowerCase();
      return lowerCased === "t" || lowerCased === "true" || lowerCased === "1";
    }

    return value === 1;
  }

  /*
   * Case-insensitive column lookup. Engines disagree: PostgreSQL folds
   * unquoted identifiers to lower case, MySQL's information_schema returns
   * upper case, and SHOW REPLICA STATUS returns mixed case.
   */
  private static readColumn(
    row: Record<string, unknown>,
    column: string,
  ): unknown {
    if (column in row) {
      return row[column];
    }

    const target: string = column.toLowerCase();

    for (const key of Object.keys(row)) {
      if (key.toLowerCase() === target) {
        return row[key];
      }
    }

    return undefined;
  }

  private static elapsedMs(startTime: [number, number]): number {
    const endTime: [number, number] = process.hrtime(startTime);
    return Math.ceil((endTime[0] * 1000000000 + endTime[1]) / 1000000);
  }

  // ---------------------------------------------------------------- sessions

  private static async openSession(input: {
    config: MonitorStepDatabaseMonitor;
    statementTimeoutInMs: number;
    connectionTimeoutInMs: number;
  }): Promise<DatabaseHealthSession> {
    switch (input.config.databaseType) {
      case SqlDatabaseType.MySQL:
        return await this.openMySqlSession(input);
      case SqlDatabaseType.MicrosoftSqlServer:
        return await this.openSqlServerSession(input);
      case SqlDatabaseType.PostgreSQL:
      default:
        return await this.openPostgresSession(input);
    }
  }

  private static async openPostgresSession(input: {
    config: MonitorStepDatabaseMonitor;
    statementTimeoutInMs: number;
    connectionTimeoutInMs: number;
  }): Promise<DatabaseHealthSession> {
    const { config, statementTimeoutInMs, connectionTimeoutInMs } = input;

    const clientConfig: ClientConfig = {
      host: config.host,
      port: config.port,
      database: config.databaseName,
      user: config.username,
      password: config.password,
      connectionTimeoutMillis: connectionTimeoutInMs,
      statement_timeout: statementTimeoutInMs,
      query_timeout: statementTimeoutInMs + 2000,
      application_name: "OneUptimeProbe-DatabaseMonitor",
      ssl: config.useSsl
        ? { rejectUnauthorized: config.rejectUnauthorizedSsl }
        : false,
    };

    const client: Client = new Client(clientConfig);
    await client.connect();

    /*
     * Read-only for the whole check. The statements here are ours and are
     * all SELECTs, but a read-only transaction is a guarantee rather than a
     * convention - and it is what lets a reviewer confirm this monitor
     * cannot write without reading every query in the catalog.
     */
    await client.query("START TRANSACTION READ ONLY");

    return {
      runQuery: async (
        sql: string,
      ): Promise<Array<Record<string, unknown>>> => {
        const result: QueryResult = await client.query(sql);
        return (result.rows as Array<Record<string, unknown>>) || [];
      },
      close: async (): Promise<void> => {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackErr) {
          logger.debug(`Database monitor rollback failed: ${rollbackErr}`);
        }
        await client.end();
      },
    };
  }

  private static async openMySqlSession(input: {
    config: MonitorStepDatabaseMonitor;
    statementTimeoutInMs: number;
    connectionTimeoutInMs: number;
  }): Promise<DatabaseHealthSession> {
    const { config, statementTimeoutInMs, connectionTimeoutInMs } = input;

    const connectionOptions: MySqlConnectionOptions = {
      host: config.host,
      port: config.port,
      database: config.databaseName,
      user: config.username,
      password: config.password,
      connectTimeout: connectionTimeoutInMs,
      // One statement per call, never a multi-statement batch.
      multipleStatements: false,
    };

    /*
     * Assigned conditionally rather than set to undefined: the project
     * compiles with exactOptionalPropertyTypes, so an explicit undefined is
     * not the same as an absent property.
     */
    if (config.useSsl) {
      connectionOptions.ssl = {
        rejectUnauthorized: config.rejectUnauthorizedSsl,
      };
    }

    const connection: MySqlConnection =
      await createMySqlConnection(connectionOptions);

    try {
      await connection.query("SET SESSION TRANSACTION READ ONLY");
      await connection.query(
        `SET SESSION MAX_EXECUTION_TIME = ${Math.floor(statementTimeoutInMs)}`,
      );
    } catch (err) {
      /*
       * Best effort. Neither statement is available on every MySQL-compatible
       * server (MariaDB names the timeout differently), and failing the whole
       * check because a hardening statement was rejected would be worse than
       * running without it - every query we issue is a SELECT regardless.
       */
      logger.debug(`Database monitor MySQL session setup failed: ${err}`);
    }

    return {
      runQuery: async (
        sql: string,
      ): Promise<Array<Record<string, unknown>>> => {
        const [rows] = await connection.query(sql);
        if (!Array.isArray(rows)) {
          return [];
        }
        return rows as Array<Record<string, unknown>>;
      },
      close: async (): Promise<void> => {
        await connection.end();
      },
    };
  }

  private static async openSqlServerSession(input: {
    config: MonitorStepDatabaseMonitor;
    statementTimeoutInMs: number;
    connectionTimeoutInMs: number;
  }): Promise<DatabaseHealthSession> {
    const { config, statementTimeoutInMs, connectionTimeoutInMs } = input;

    /*
     * Only trusted connections need the ODBC connection string, so only pay
     * for host driver detection in that mode - same rule the SQL Query
     * monitor follows, using the same shared builder.
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

    await pool.connect();

    return {
      runQuery: async (
        sql: string,
      ): Promise<Array<Record<string, unknown>>> => {
        const request: mssql.Request = new sqlServerDriver.Request(pool);
        const result: mssql.IResult<Record<string, unknown>> =
          await request.query<Record<string, unknown>>(sql);
        return result.recordset || [];
      },
      close: async (): Promise<void> => {
        await pool.close();
      },
    };
  }
}
