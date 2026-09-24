import OnlineCheck from "../../OnlineCheck";
import MonitorRetry from "../MonitorRetry";
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
import SqlServerPlatformUtil from "Common/Types/Monitor/DatabaseMonitor/SqlServerPlatform";
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
 * Retries when the caller passes none: three attempts, the same as before
 * retries were counted after the first attempt.
 */
const DEFAULT_RETRIES_WHEN_UNSET: number = 2;

/*
 * The fields the three drivers put on a failed query that say WHY it
 * failed. mssql: `number` (the SQL Server error number) plus
 * `precedingErrors`, and `code` 'ETIMEOUT' for a request timeout. mysql2:
 * `code` ('ER_TABLEACCESS_DENIED_ERROR'). node-postgres: `code`, the
 * five-character SQLSTATE ('42501').
 */
interface DriverErrorShape {
  code?: unknown;
  number?: unknown;
  precedingErrors?: Array<DriverErrorShape | null | undefined> | undefined;
}

/*
 * SQL Server error numbers that mean "the login lacks a grant":
 *   229 - The %ls permission was denied on the object '%.*ls' ...
 *   230 - The %ls permission was denied on the column '%.*ls' ...
 *   262 - %ls permission denied in database '%.*ls'.
 *   297 - The user does not have permission to perform this action.
 *   300 - %ls permission was denied on object '%.*ls', database '%.*ls'.
 *   916 - The server principal "%.*ls" is not able to access the database
 *         "%.*ls" under the current security context.
 * A DMV read without VIEW SERVER STATE raises 300 then 297 (2017, 2019,
 * 2022 - 2022 names VIEW SERVER PERFORMANCE STATE); a database-scoped one
 * raises 262 then 297.
 */
const SQL_SERVER_PERMISSION_ERROR_NUMBERS: Array<number> = [
  229, 230, 262, 297, 300, 916,
];

/*
 * SQL Server error numbers that mean "this engine does not have that":
 *   195   - '%.*ls' is not a recognized %ls.
 *   207   - Invalid column name '%.*ls'.
 *   208   - Invalid object name '%.*ls'.
 *   40515 - Reference to database and/or server name in '%.*ls' is not
 *           supported in this version of SQL Server. (Azure SQL Database)
 * Msg 102 (Incorrect syntax) is deliberately absent: every statement here
 * parses on every supported version, so a syntax error is a bug in this
 * file, and filing it under "not available on this engine" would hide it.
 */
const SQL_SERVER_NOT_SUPPORTED_ERROR_NUMBERS: Array<number> = [
  195, 207, 208, 40515,
];

const MYSQL_PERMISSION_ERROR_CODES: Array<string> = [
  // 1044: Access denied for user '%s'@'%s' to database '%s'.
  "ER_DBACCESS_DENIED_ERROR",
  // 1142: SELECT command denied to user '%s'@'%s' for table '%s'.
  "ER_TABLEACCESS_DENIED_ERROR",
  // 1143: SELECT command denied to user '%s'@'%s' for column '%s' ...
  "ER_COLUMNACCESS_DENIED_ERROR",
  // 1227: Access denied; you need (at least one of) the %s privilege(s).
  "ER_SPECIFIC_ACCESS_DENIED_ERROR",
  // 1370: execute command denied to user '%s'@'%s' for routine '%s'.
  "ER_PROCACCESS_DENIED_ERROR",
];

const MYSQL_NOT_SUPPORTED_ERROR_CODES: Array<string> = [
  // 1146: Table '%s.%s' doesn't exist.
  "ER_NO_SUCH_TABLE",
  // 1054: Unknown column '%s' in '%s'.
  "ER_BAD_FIELD_ERROR",
  // 1109: Unknown table '%s' in %s.
  "ER_UNKNOWN_TABLE",
  /*
   * 1064: You have an error in your SQL syntax ... Unlike SQL Server's Msg
   * 102, expected here: MySQL before 8.0.22 (and MariaDB before 10.5.1)
   * spell SHOW REPLICA STATUS as SHOW SLAVE STATUS, and the query table
   * documents that as NotSupportedByEngine. The old text rule looked for
   * "syntax error", which MySQL never says, so it fell through to Error.
   */
  "ER_PARSE_ERROR",
];

const MYSQL_TIMEOUT_ERROR_CODES: Array<string> = [
  // 3024: Query execution was interrupted, maximum statement execution time exceeded.
  "ER_QUERY_TIMEOUT",
];

// PostgreSQL SQLSTATEs (Appendix A of the PostgreSQL manual).
const POSTGRES_INSUFFICIENT_PRIVILEGE_SQLSTATE: string = "42501";
// statement_timeout cancels with query_canceled.
const POSTGRES_QUERY_CANCELED_SQLSTATE: string = "57014";
const POSTGRES_NOT_SUPPORTED_SQLSTATES: Array<string> = [
  // undefined_table: relation "pg_stat_checkpointer" does not exist.
  "42P01",
  // undefined_column.
  "42703",
  // undefined_function.
  "42883",
  // undefined_object.
  "42704",
  // syntax_error.
  "42601",
];

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
      const responseReceivedAt: Date = new Date();

      const probeRow: Record<string, unknown> = probeRows[0] || {};

      /*
       * SQL Server only: SERVERPROPERTY('EngineEdition'), which is how an
       * Azure SQL Database tells itself apart from the SQL Server it shares
       * a protocol with. It reports ProductVersion 12.0.2000.8 whatever it
       * actually runs, which reads as SQL Server 2014, and it takes
       * different grants - VIEW SERVER STATE does not exist there.
       */
      const sqlServerEngineEdition: number | null =
        config.databaseType === SqlDatabaseType.MicrosoftSqlServer
          ? this.readNumber(probeRow, "engine_edition")
          : null;

      const engineVersion: string | undefined = this.readString(
        probeRow,
        "engine_version",
      );
      const enginePlatform: string | undefined = this.describeEnginePlatform({
        databaseType: config.databaseType,
        sqlServerEngineEdition,
      });
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
            reason: DatabaseMetricGroupUnavailableReason.MissingPermission,
          });
          continue;
        }

        if (
          !this.shouldRunQuery({
            query,
            serverVersionNum,
            isInRecovery,
            sqlServerEngineEdition,
          })
        ) {
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
          /*
           * The whole message chain, not err.message alone - on SQL Server
           * the permission that is missing is only ever named by a
           * preceding error. Sanitized AFTER joining, so a secret in any
           * link of the chain is redacted.
           */
          const sanitized: string = SqlMonitor.sanitizeError(
            new Error(this.describeQueryError(err)),
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
            remediation: this.resolveRemediation({
              query,
              sqlServerEngineEdition,
            }),
            reason: this.classifyQueryError({
              databaseType: config.databaseType,
              error: err,
              message: sanitized,
            }),
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

      /*
       * Recorded last, once nothing below can throw into the catch and log a
       * second entry for this attempt. Timed at the probe query, which is
       * what decided the database is online.
       */
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
        metrics,
        collectedGroups,
        unavailableGroups,
        engineVersion,
        enginePlatform,
        connectionError: null,
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

      if (
        MonitorRetry.canRetry({
          attemptNumber: options.currentRetryCount,
          retries: options.retry,
          defaultRetries: DEFAULT_RETRIES_WHEN_UNSET,
        })
      ) {
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
   * The text of a failed catalog query, INCLUDING the messages the driver
   * moved aside.
   *
   * SQL Server answers a DMV read without the grant with two messages, and
   * the mssql driver (tedious and msnodesqlv8 alike) keeps only the LAST one
   * as err.message, parking the rest on err.precedingErrors. The last one is
   * always Msg 297, "The user does not have permission to perform this
   * action." - which names no permission at all. The message that does,
   * Msg 300 "VIEW SERVER STATE permission was denied on object 'server'"
   * (or Msg 262 "VIEW DATABASE STATE permission denied in database"), only
   * ever arrives as a preceding error. Verified against SQL Server 2017,
   * 2019 and 2022 with a login holding nothing but db_datareader - issue
   * #3913, where every group read "The user does not have permission to
   * perform this action." and nothing else.
   *
   * So the preceding messages come first (they are the specific cause) and
   * the final one after, each once.
   */
  public static describeQueryError(error: unknown): string {
    const messages: Array<string> = [];

    const addMessage: (candidate: unknown) => void = (
      candidate: unknown,
    ): void => {
      if (typeof candidate !== "string") {
        return;
      }

      const trimmed: string = candidate.trim();

      if (trimmed && !messages.includes(trimmed)) {
        messages.push(trimmed);
      }
    };

    const precedingErrors: unknown = (
      error as { precedingErrors?: unknown } | null | undefined
    )?.precedingErrors;

    if (Array.isArray(precedingErrors)) {
      for (const precedingError of precedingErrors) {
        addMessage((precedingError as Error | null | undefined)?.message);
      }
    }

    addMessage((error as Error | null | undefined)?.message);

    if (messages.length === 0) {
      if (typeof error === "string" && error.trim()) {
        return error.trim();
      }

      return "SQL error";
    }

    return messages.join(" ");
  }

  /**
   * Classify a failed catalog query from the driver's error CODES first and
   * its text second.
   *
   * Codes are what the engines promise; message text is what they happen to
   * say today, in English, in one driver. The text rules below were written
   * against a message SQL Server never returns as err.message (see
   * describeQueryError), so every SQL Server permission failure fell through
   * to Error - and Error is the one reason that never shows the GRANT.
   */
  public static classifyQueryError(input: {
    databaseType: SqlDatabaseType;
    error: unknown;
    message: string;
  }): DatabaseMetricGroupUnavailableReason {
    // Same order as the text rules: a timeout is never a missing grant.
    if (this.isTimeoutMessage(input.message)) {
      return DatabaseMetricGroupUnavailableReason.Timeout;
    }

    const fromCode: DatabaseMetricGroupUnavailableReason | null =
      this.classifyByErrorCode({
        databaseType: input.databaseType,
        error: input.error,
      });

    if (fromCode) {
      return fromCode;
    }

    return this.classifyQueryFailure(input.message);
  }

  private static classifyByErrorCode(input: {
    databaseType: SqlDatabaseType;
    error: unknown;
  }): DatabaseMetricGroupUnavailableReason | null {
    const error: DriverErrorShape | null =
      input.error && typeof input.error === "object"
        ? (input.error as DriverErrorShape)
        : null;

    if (!error) {
      return null;
    }

    if (input.databaseType === SqlDatabaseType.MicrosoftSqlServer) {
      if (error.code === "ETIMEOUT") {
        return DatabaseMetricGroupUnavailableReason.Timeout;
      }

      /*
       * Every error number in the chain counts, not just the last: the
       * number that says "permission" may be a preceding error (it always
       * is for a DMV read - 300 or 262, then 297). Guarded with isArray
       * because this runs inside the per-query catch: anything thrown here
       * would escape to the outer catch and report a database that
       * answered as offline.
       */
      const precedingErrors: Array<DriverErrorShape | null | undefined> =
        Array.isArray(error.precedingErrors) ? error.precedingErrors : [];

      const numbers: Array<number> = [error, ...precedingErrors]
        .map((entry: DriverErrorShape | null | undefined) => {
          return Number(entry?.number);
        })
        .filter((value: number) => {
          return Number.isFinite(value);
        });

      if (
        numbers.some((value: number) => {
          return SQL_SERVER_PERMISSION_ERROR_NUMBERS.includes(value);
        })
      ) {
        return DatabaseMetricGroupUnavailableReason.MissingPermission;
      }

      if (
        numbers.some((value: number) => {
          return SQL_SERVER_NOT_SUPPORTED_ERROR_NUMBERS.includes(value);
        })
      ) {
        return DatabaseMetricGroupUnavailableReason.NotSupportedByEngine;
      }

      return null;
    }

    const code: string = typeof error.code === "string" ? error.code : "";

    if (input.databaseType === SqlDatabaseType.MySQL) {
      if (MYSQL_TIMEOUT_ERROR_CODES.includes(code)) {
        return DatabaseMetricGroupUnavailableReason.Timeout;
      }

      if (MYSQL_PERMISSION_ERROR_CODES.includes(code)) {
        return DatabaseMetricGroupUnavailableReason.MissingPermission;
      }

      if (MYSQL_NOT_SUPPORTED_ERROR_CODES.includes(code)) {
        return DatabaseMetricGroupUnavailableReason.NotSupportedByEngine;
      }

      return null;
    }

    if (input.databaseType === SqlDatabaseType.PostgreSQL) {
      if (code === POSTGRES_QUERY_CANCELED_SQLSTATE) {
        return DatabaseMetricGroupUnavailableReason.Timeout;
      }

      if (code === POSTGRES_INSUFFICIENT_PRIVILEGE_SQLSTATE) {
        return DatabaseMetricGroupUnavailableReason.MissingPermission;
      }

      if (POSTGRES_NOT_SUPPORTED_SQLSTATES.includes(code)) {
        return DatabaseMetricGroupUnavailableReason.NotSupportedByEngine;
      }
    }

    return null;
  }

  /**
   * Turn a failed catalog query into an operator-actionable reason.
   *
   * The distinction that matters is permission versus capability: "you are
   * missing a grant, here is the GRANT statement" and "your engine cannot
   * report this, nothing to do" call for completely different reactions, and
   * both are common enough that collapsing them into "error" would make the
   * summary view useless.
   *
   * This is the TEXT fallback, for an error that carries no code the
   * collector recognises (a driver wrapping, or msnodesqlv8's ODBC-prefixed
   * messages). classifyQueryError tries the codes first.
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
      // SQL Server Msg 300: "VIEW SERVER STATE permission was denied".
      lowerCased.includes("permission was denied") ||
      /*
       * SQL Server Msg 297, the message the mssql driver actually surfaces
       * as err.message for a DMV read without the grant.
       */
      lowerCased.includes("does not have permission") ||
      // MySQL 1142: "SELECT command denied to user 'x'@'y' for table 'z'".
      lowerCased.includes("command denied") ||
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
     * message is ours rather than a driver's, or a failure classified from
     * the driver's error codes.
     */
    reason?: DatabaseMetricGroupUnavailableReason | undefined;
  }): void {
    const { unavailableGroups, group, message } = input;

    const reason: DatabaseMetricGroupUnavailableReason =
      input.reason || this.classifyQueryFailure(message);

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

  /**
   * The grant to show for a failed query, for the platform actually
   * connected. On Azure SQL Database the SQL Server grant is not just
   * unhelpful but impossible - VIEW SERVER STATE does not exist there - so
   * showing it would send the operator to run a statement that errors.
   */
  public static resolveRemediation(input: {
    query: DatabaseHealthQuery;
    sqlServerEngineEdition: number | null;
  }): string | undefined {
    const { query, sqlServerEngineEdition } = input;

    if (
      query.remediationOnAzureSqlDatabase &&
      SqlServerPlatformUtil.isAzureSqlDatabase(sqlServerEngineEdition)
    ) {
      return query.remediationOnAzureSqlDatabase;
    }

    return query.remediation;
  }

  /**
   * The platform named next to the version on the summary. PostgreSQL's
   * version() already names the product; SQL Server's ProductVersion is a
   * bare number, and on Azure SQL Database it is always 12.0.2000.8 - which
   * anyone would read as SQL Server 2014. Naming the platform is what makes
   * the grant shown next to it make sense.
   *
   * A separate field rather than a prefix on engineVersion: criteria
   * expressions and alert templates already read engineVersion, and an
   * expression like engineVersion.startsWith('16.') must keep working.
   */
  public static describeEnginePlatform(input: {
    databaseType: SqlDatabaseType;
    sqlServerEngineEdition: number | null;
  }): string | undefined {
    if (input.databaseType !== SqlDatabaseType.MicrosoftSqlServer) {
      return undefined;
    }

    return SqlServerPlatformUtil.getPlatformName(input.sqlServerEngineEdition);
  }

  public static shouldRunQuery(input: {
    query: DatabaseHealthQuery;
    serverVersionNum: number | null;
    isInRecovery: boolean;
    /*
     * SQL Server only; null for other engines and when the probe row did
     * not carry it, in which case no edition gate applies.
     */
    sqlServerEngineEdition?: number | null | undefined;
  }): boolean {
    const { query, serverVersionNum, isInRecovery } = input;

    if (
      query.runOnlyWhenInRecovery !== undefined &&
      query.runOnlyWhenInRecovery !== isInRecovery
    ) {
      return false;
    }

    /*
     * A platform that does not have the view at all. Skipped silently, like
     * a version gate, rather than run and recorded as a collection issue:
     * no grant fixes it, so the issue would be raised on every check
     * forever and keep a Database Collection Error criterion firing on a
     * monitor that is collecting everything it can.
     */
    if (
      input.sqlServerEngineEdition !== undefined &&
      input.sqlServerEngineEdition !== null &&
      query.skipOnSqlServerEngineEditions?.includes(
        input.sqlServerEngineEdition,
      )
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
