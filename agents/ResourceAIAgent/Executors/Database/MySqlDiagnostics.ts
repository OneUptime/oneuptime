import { SqlConnection, SqlRow } from "./DatabaseDrivers";
import {
  OutputColumn,
  OutputSection,
  formatBytes,
  limitRows,
  normalizeQueryText,
} from "./DatabaseOutput";
import {
  DiagnosticOutcome,
  DiagnosticRun,
  EngineProbe,
  argumentString,
  errorCode,
  errorMessage,
  errorNumber,
  failed,
  flagInteger,
  flagString,
  notRun,
  ok,
  refusedByAgent,
  sessionIdOf,
  toNumber,
} from "./DiagnosticTypes";
import {
  DATABASE_DEFAULT_ROW_LIMIT,
  DATABASE_MAX_ROW_LIMIT,
  isDatabaseCredentialSettingName,
} from "../../Common/Utils/AiRemediation/Resource/DatabaseDiagnosticCatalog";

/*
 * The db catalog on MySQL (5.7 and later), MariaDB (10.3 and later) and
 * Percona Server, through mysql2. Each operation is one or a few
 * statements this file owns; the catalog's typed parameters reach them as
 * ? placeholders (mysql2 escapes each value), never spliced into the text,
 * and a session id is re-checked as a whole number before a KILL.
 *
 * Reads run with `SET SESSION TRANSACTION READ ONLY` and a statement time
 * limit — max_execution_time (milliseconds) on MySQL, max_statement_time
 * (seconds) on MariaDB — plus short lock waits (lock_wait_timeout,
 * innodb_lock_wait_timeout), so no read outlives the job or waits long
 * behind a lock.
 *
 * The two writes, cancel-query (KILL QUERY) and terminate-session (KILL
 * CONNECTION), first look up the agent's own connection (CONNECTION_ID())
 * and the target in the processlist, and never kill the agent's own
 * connection, one that is not there, a replication or event-scheduler
 * thread, or (for a cancel) a session with nothing running. Then they look
 * at the target once more, so the output says what the KILL did.
 */

// Threads a KILL must never reach: the server's own, not a client's.
const SYSTEM_USERS: ReadonlyArray<string> = ["system user", "event_scheduler"];
const SYSTEM_COMMANDS: ReadonlyArray<string> = [
  "Daemon",
  "Binlog Dump",
  "Binlog Dump GTID",
];

// The smallest lock wait MySQL takes (seconds).
const MIN_LOCK_WAIT_SECONDS: number = 1;

const MARIADB_PATTERN: RegExp = /mariadb/i;
const PERCONA_PATTERN: RegExp = /percona/i;
// A replica-status column that holds statement text (Last_SQL_Error, ...).
const QUERY_COLUMN_PATTERN: RegExp = /query|sql/i;
// log_output = TABLE or FILE,TABLE: the slow log is readable from mysql.slow_log.
const TABLE_LOG_OUTPUT_PATTERN: RegExp = /table/i;

export interface MySqlServer {
  version: string;
  versionComment: string;
  isMariaDb: boolean;
  isPercona: boolean;
  major: number;
  minor: number;
  patch: number;
}

const PROCESSLIST_COLUMNS: string =
  "ID AS id, USER AS user_name, HOST AS host, DB AS database_name, TIME AS seconds, COMMAND AS command, STATE AS state, INFO AS query";

export const MYSQL_SQL: Readonly<Record<string, string>> = {
  version: "SELECT VERSION() AS version, @@version_comment AS version_comment",
  readOnlySession: "SET SESSION TRANSACTION READ ONLY",
  mysqlStatementTimeout: "SET SESSION max_execution_time = ?",
  mariaDbStatementTimeout: "SET SESSION max_statement_time = ?",
  lockWaitTimeout: "SET SESSION lock_wait_timeout = ?",
  innodbLockWaitTimeout: "SET SESSION innodb_lock_wait_timeout = ?",
  ping: "SELECT 1 AS ok, CURRENT_USER() AS user_name",
  versionDetails:
    "SELECT @@version_compile_os AS os, @@version_compile_machine AS machine, @@read_only AS read_only",
  uptime: "SHOW GLOBAL STATUS LIKE 'Uptime'",
  sessionsAll: `SELECT ${PROCESSLIST_COLUMNS}
FROM information_schema.PROCESSLIST
WHERE ID <> CONNECTION_ID() AND (? IS NULL OR USER = ?) AND (? IS NULL OR DB = ?)
ORDER BY (COMMAND = 'Sleep'), TIME DESC, ID
LIMIT ?`,
  sessionsActive: `SELECT ${PROCESSLIST_COLUMNS}
FROM information_schema.PROCESSLIST
WHERE ID <> CONNECTION_ID() AND (? IS NULL OR USER = ?) AND (? IS NULL OR DB = ?)
  AND COMMAND <> 'Sleep'
ORDER BY TIME DESC, ID
LIMIT ?`,
  sessionsIdle: `SELECT ${PROCESSLIST_COLUMNS}
FROM information_schema.PROCESSLIST
WHERE ID <> CONNECTION_ID() AND (? IS NULL OR USER = ?) AND (? IS NULL OR DB = ?)
  AND COMMAND = 'Sleep'
ORDER BY TIME DESC, ID
LIMIT ?`,
  sessionsIdleInTransaction: `SELECT ${PROCESSLIST_COLUMNS}
FROM information_schema.PROCESSLIST
WHERE ID <> CONNECTION_ID() AND (? IS NULL OR USER = ?) AND (? IS NULL OR DB = ?)
  AND COMMAND = 'Sleep'
  AND ID IN (SELECT trx_mysql_thread_id FROM information_schema.INNODB_TRX)
ORDER BY TIME DESC, ID
LIMIT ?`,
  longQueries: `SELECT ${PROCESSLIST_COLUMNS}
FROM information_schema.PROCESSLIST
WHERE ID <> CONNECTION_ID()
  AND COMMAND NOT IN ('Sleep', 'Daemon', 'Binlog Dump', 'Binlog Dump GTID')
  AND TIME >= ?
ORDER BY TIME DESC, ID
LIMIT ?`,
  blockingPerformanceSchema: `SELECT r.trx_mysql_thread_id AS waiting_id,
  TIMESTAMPDIFF(SECOND, r.trx_wait_started, NOW()) AS wait_seconds,
  rl.OBJECT_SCHEMA AS locked_schema, rl.OBJECT_NAME AS locked_table, rl.INDEX_NAME AS locked_index,
  rl.LOCK_MODE AS waiting_lock_mode,
  b.trx_mysql_thread_id AS blocking_id, bl.LOCK_MODE AS blocking_lock_mode,
  TIMESTAMPDIFF(SECOND, b.trx_started, NOW()) AS blocking_trx_seconds,
  r.trx_query AS waiting_query, b.trx_query AS blocking_query
FROM performance_schema.data_lock_waits AS w
JOIN information_schema.INNODB_TRX AS r ON r.trx_id = w.REQUESTING_ENGINE_TRANSACTION_ID
JOIN information_schema.INNODB_TRX AS b ON b.trx_id = w.BLOCKING_ENGINE_TRANSACTION_ID
JOIN performance_schema.data_locks AS rl ON rl.ENGINE_LOCK_ID = w.REQUESTING_ENGINE_LOCK_ID
JOIN performance_schema.data_locks AS bl ON bl.ENGINE_LOCK_ID = w.BLOCKING_ENGINE_LOCK_ID
ORDER BY wait_seconds DESC, waiting_id
LIMIT ?`,
  blockingInformationSchema: `SELECT r.trx_mysql_thread_id AS waiting_id,
  TIMESTAMPDIFF(SECOND, r.trx_wait_started, NOW()) AS wait_seconds,
  rl.lock_table AS locked_table, rl.lock_index AS locked_index,
  rl.lock_mode AS waiting_lock_mode,
  b.trx_mysql_thread_id AS blocking_id, bl.lock_mode AS blocking_lock_mode,
  TIMESTAMPDIFF(SECOND, b.trx_started, NOW()) AS blocking_trx_seconds,
  r.trx_query AS waiting_query, b.trx_query AS blocking_query
FROM information_schema.INNODB_LOCK_WAITS AS w
JOIN information_schema.INNODB_TRX AS r ON r.trx_id = w.requesting_trx_id
JOIN information_schema.INNODB_TRX AS b ON b.trx_id = w.blocking_trx_id
JOIN information_schema.INNODB_LOCKS AS rl ON rl.lock_id = w.requested_lock_id
JOIN information_schema.INNODB_LOCKS AS bl ON bl.lock_id = w.blocking_lock_id
ORDER BY wait_seconds DESC, waiting_id
LIMIT ?`,
  locksPerformanceSchema: `SELECT t.trx_mysql_thread_id AS session_id, l.ENGINE_TRANSACTION_ID AS trx_id,
  l.OBJECT_SCHEMA AS schema_name, l.OBJECT_NAME AS table_name, l.INDEX_NAME AS index_name,
  l.LOCK_TYPE AS lock_type, l.LOCK_MODE AS lock_mode, l.LOCK_STATUS AS lock_status,
  TIMESTAMPDIFF(SECOND, t.trx_started, NOW()) AS trx_seconds
FROM performance_schema.data_locks AS l
LEFT JOIN information_schema.INNODB_TRX AS t ON t.trx_id = l.ENGINE_TRANSACTION_ID
ORDER BY (l.LOCK_STATUS = 'GRANTED'), t.trx_started, l.ENGINE_TRANSACTION_ID
LIMIT ?`,
  locksInformationSchema: `SELECT t.trx_mysql_thread_id AS session_id, l.lock_trx_id AS trx_id,
  l.lock_table AS table_name, l.lock_index AS index_name,
  l.lock_type AS lock_type, l.lock_mode AS lock_mode,
  CASE WHEN t.trx_state = 'LOCK WAIT' THEN 'WAITING' ELSE 'GRANTED' END AS lock_status,
  TIMESTAMPDIFF(SECOND, t.trx_started, NOW()) AS trx_seconds
FROM information_schema.INNODB_LOCKS AS l
LEFT JOIN information_schema.INNODB_TRX AS t ON t.trx_id = l.lock_trx_id
ORDER BY lock_status DESC, t.trx_started, l.lock_trx_id
LIMIT ?`,
  replicaStatus: "SHOW REPLICA STATUS",
  slaveStatus: "SHOW SLAVE STATUS",
  binaryLogStatus: "SHOW BINARY LOG STATUS",
  masterStatus: "SHOW MASTER STATUS",
  mysqlReplicationIdentity:
    "SELECT @@server_id AS server_id, @@read_only AS read_only, @@super_read_only AS super_read_only, @@gtid_mode AS gtid_mode",
  mariaDbReplicationIdentity:
    "SELECT @@server_id AS server_id, @@read_only AS read_only, @@gtid_current_pos AS gtid_current_pos",
  connectedReplicas: `SELECT ${PROCESSLIST_COLUMNS}
FROM information_schema.PROCESSLIST
WHERE COMMAND IN ('Binlog Dump', 'Binlog Dump GTID')
ORDER BY ID`,
  connectionStatus:
    "SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_connected', 'Threads_running', 'Max_used_connections', 'Aborted_connects', 'Connection_errors_max_connections')",
  connectionLimits:
    "SELECT @@max_connections AS max_connections, @@max_user_connections AS max_user_connections",
  connectionGroups: `SELECT USER AS user_name, DB AS database_name, COMMAND AS command, COUNT(*) AS connections
FROM information_schema.PROCESSLIST
GROUP BY USER, DB, COMMAND
ORDER BY connections DESC, user_name, database_name
LIMIT ?`,
  databaseSizes: `SELECT TABLE_SCHEMA AS database_name, SUM(DATA_LENGTH + INDEX_LENGTH) AS size_bytes,
  SUM(DATA_LENGTH) AS data_bytes, SUM(INDEX_LENGTH) AS index_bytes, COUNT(*) AS tables
FROM information_schema.TABLES
GROUP BY TABLE_SCHEMA
ORDER BY size_bytes DESC, database_name
LIMIT ?`,
  tableSizes: `SELECT TABLE_SCHEMA AS schema_name, TABLE_NAME AS table_name, ENGINE AS engine, TABLE_ROWS AS estimated_rows,
  DATA_LENGTH AS data_bytes, INDEX_LENGTH AS index_bytes, DATA_LENGTH + INDEX_LENGTH AS total_bytes, DATA_FREE AS free_bytes
FROM information_schema.TABLES
WHERE TABLE_TYPE = 'BASE TABLE'
  AND ((? IS NOT NULL AND TABLE_SCHEMA = ?) OR (? IS NULL AND TABLE_SCHEMA NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')))
ORDER BY total_bytes DESC, schema_name, table_name
LIMIT ?`,
  performanceSchemaEnabled: "SELECT @@performance_schema AS enabled",
  topStatements: `SELECT SCHEMA_NAME AS schema_name, COUNT_STAR AS calls,
  ROUND(SUM_TIMER_WAIT / 1000000000, 1) AS total_ms, ROUND(AVG_TIMER_WAIT / 1000000000, 2) AS mean_ms,
  SUM_ROWS_EXAMINED AS rows_examined, SUM_ROWS_SENT AS rows_sent, SUM_NO_INDEX_USED AS no_index_used,
  DIGEST_TEXT AS query
FROM performance_schema.events_statements_summary_by_digest
WHERE DIGEST_TEXT IS NOT NULL
ORDER BY SUM_TIMER_WAIT DESC
LIMIT ?`,
  settingByName: "SHOW GLOBAL VARIABLES WHERE Variable_name = ?",
  allSettings: "SHOW GLOBAL VARIABLES",
  slowLogSettings:
    "SELECT @@slow_query_log AS slow_query_log, @@log_output AS log_output, @@long_query_time AS long_query_time",
  slowLog: `SELECT start_time, user_host, query_time, lock_time, rows_sent, rows_examined, db AS database_name,
  CONVERT(sql_text USING utf8mb4) AS query
FROM mysql.slow_log
ORDER BY start_time DESC
LIMIT ?`,
  innodbStatus: "SHOW ENGINE INNODB STATUS",
  ownConnectionId: "SELECT CONNECTION_ID() AS id",
  sessionById: `SELECT ${PROCESSLIST_COLUMNS}
FROM information_schema.PROCESSLIST
WHERE ID = ?`,
  killQuery: "KILL QUERY ?",
  killConnection: "KILL CONNECTION ?",
  probe:
    "SELECT VERSION() AS version, @@version_comment AS version_comment, @@read_only AS read_only",
};

const SESSION_SQL_BY_STATE: Readonly<Record<string, string>> = {
  active: MYSQL_SQL["sessionsActive"]!,
  idle: MYSQL_SQL["sessionsIdle"]!,
  "idle-in-transaction": MYSQL_SQL["sessionsIdleInTransaction"]!,
};

const SESSION_COLUMNS: Array<OutputColumn> = [
  { key: "id" },
  { key: "user_name", header: "user" },
  { key: "host" },
  { key: "database_name", header: "db" },
  { key: "seconds", header: "time_s" },
  { key: "command" },
  { key: "state" },
  { key: "query", kind: "query" },
];

// VERSION() and @@version_comment as the flavour and its version numbers.
export function parseMySqlServer(
  version: unknown,
  versionComment: unknown,
): MySqlServer {
  const text: string = typeof version === "string" ? version : "";
  const comment: string =
    typeof versionComment === "string" ? versionComment : "";
  // Old MariaDB prefixes its version with 5.5.5- for replication clients.
  const bare: string = text.replace(/^5\.5\.5-/, "");
  const numbers: RegExpMatchArray | null = bare.match(/^(\d+)\.(\d+)\.(\d+)/);

  return {
    version: bare,
    versionComment: comment,
    isMariaDb: MARIADB_PATTERN.test(text) || MARIADB_PATTERN.test(comment),
    isPercona: PERCONA_PATTERN.test(comment),
    major: numbers ? Number(numbers[1]) : 0,
    minor: numbers ? Number(numbers[2]) : 0,
    patch: numbers ? Number(numbers[3]) : 0,
  };
}

function atLeast(
  server: MySqlServer,
  major: number,
  minor: number,
  patch: number,
): boolean {
  if (server.major !== major) {
    return server.major > major;
  }

  if (server.minor !== minor) {
    return server.minor > minor;
  }

  return server.patch >= patch;
}

// "MySQL 8.4.2", "MariaDB 11.4.2", "Percona Server 8.0.36-28".
export function describeMySqlServer(server: MySqlServer): string {
  const number: string = server.version.split(/[-\s]/)[0] || server.version;

  if (server.isMariaDb) {
    return `MariaDB ${number}`;
  }

  if (server.isPercona) {
    return `Percona Server ${server.version.split(/\s/)[0] || number}`;
  }

  return `MySQL ${number}`;
}

// performance_schema.data_locks exists from MySQL 8.0; MariaDB keeps INNODB_LOCKS.
function usesPerformanceSchemaLocks(server: MySqlServer): boolean {
  return !server.isMariaDb && server.major >= 8;
}

async function readServer(connection: SqlConnection): Promise<MySqlServer> {
  const rows: Array<SqlRow> = await connection.query(MYSQL_SQL["version"]!);
  const row: SqlRow = rows[0] || {};

  return parseMySqlServer(row["version"], row["version_comment"]);
}

// Session limits: a statement time limit and short lock waits (and read-only for reads).
async function prepareSession(
  connection: SqlConnection,
  server: MySqlServer,
  run: DiagnosticRun,
  readOnly: boolean,
): Promise<void> {
  if (readOnly) {
    await connection.query(MYSQL_SQL["readOnlySession"]!);
  }

  if (server.isMariaDb) {
    await connection.query(MYSQL_SQL["mariaDbStatementTimeout"]!, [
      Math.max(0.001, run.statementTimeoutMs / 1000),
    ]);
  } else {
    await connection.query(MYSQL_SQL["mysqlStatementTimeout"]!, [
      Math.max(1, Math.floor(run.statementTimeoutMs)),
    ]);
  }

  const lockWaitSeconds: number = Math.max(
    MIN_LOCK_WAIT_SECONDS,
    Math.ceil(run.lockTimeoutMs / 1000),
  );

  await connection.query(MYSQL_SQL["lockWaitTimeout"]!, [lockWaitSeconds]);
  await connection.query(MYSQL_SQL["innodbLockWaitTimeout"]!, [
    lockWaitSeconds,
  ]);
}

// A row's non-empty values, in order, for a vertical listing.
function nonEmptyColumns(rows: Array<SqlRow>): Array<OutputColumn> {
  const keys: Array<string> = [];

  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (
        value !== null &&
        value !== undefined &&
        value !== "" &&
        !keys.includes(key)
      ) {
        keys.push(key);
      }
    }
  }

  return keys.map((key: string): OutputColumn => {
    return { key, kind: QUERY_COLUMN_PATTERN.test(key) ? "query" : "text" };
  });
}

// ---- Reads ----------------------------------------------------------------------------

async function runRead(
  connection: SqlConnection,
  server: MySqlServer,
  run: DiagnosticRun,
): Promise<DiagnosticOutcome> {
  const command: DiagnosticRun["command"] = run.command;
  const limit: number = flagInteger(
    command,
    "limit",
    DATABASE_DEFAULT_ROW_LIMIT,
  );
  const more: string = `Raise --limit (at most ${DATABASE_MAX_ROW_LIMIT}).`;

  switch (command.operation.name) {
    case "ping": {
      const rows: Array<SqlRow> = await connection.query(MYSQL_SQL["ping"]!);

      return ok([
        {
          kind: "fields",
          fields: [
            {
              name: "status",
              value: `ok (${describeMySqlServer(server)} answered SELECT 1)`,
            },
            { name: "user", value: (rows[0] || {})["user_name"] },
          ],
        },
      ]);
    }

    case "version": {
      const details: Array<SqlRow> = await connection.query(
        MYSQL_SQL["versionDetails"]!,
      );
      const uptime: Array<SqlRow> = await connection.query(
        MYSQL_SQL["uptime"]!,
      );
      const row: SqlRow = details[0] || {};

      return ok([
        {
          kind: "fields",
          fields: [
            { name: "server", value: describeMySqlServer(server) },
            { name: "version", value: server.version },
            { name: "version_comment", value: server.versionComment },
            { name: "os", value: row["os"] },
            { name: "machine", value: row["machine"] },
            { name: "read_only", value: row["read_only"] },
            {
              name: "uptime_seconds",
              value: (uptime[0] || {})["Value"],
            },
          ],
        },
      ]);
    }

    case "sessions": {
      const state: string | null = flagString(command, "state");
      const user: string | null = flagString(command, "user");
      const database: string | null = flagString(command, "database");
      const rows: Array<SqlRow> = await connection.query(
        state ? SESSION_SQL_BY_STATE[state]! : MYSQL_SQL["sessionsAll"]!,
        [user, user, database, database, limit + 1],
      );
      const limited: { rows: Array<SqlRow>; note: OutputSection | null } =
        limitRows(
          rows,
          limit,
          `Raise --limit (at most ${DATABASE_MAX_ROW_LIMIT}) or narrow with --state, --user or --database.`,
        );

      return ok([
        {
          kind: "table",
          columns: SESSION_COLUMNS,
          rows: limited.rows,
          emptyText:
            "No sessions match (the agent's own connection is not listed; without the PROCESS privilege only the login's own sessions are).",
        },
        ...(limited.note ? [limited.note] : []),
      ]);
    }

    case "long-queries": {
      const minSeconds: number = flagInteger(command, "min-seconds", 5);
      const rows: Array<SqlRow> = await connection.query(
        MYSQL_SQL["longQueries"]!,
        [minSeconds, limit + 1],
      );
      const limited: { rows: Array<SqlRow>; note: OutputSection | null } =
        limitRows(rows, limit, `${more} Or raise --min-seconds.`);

      return ok([
        {
          kind: "table",
          columns: SESSION_COLUMNS,
          rows: limited.rows,
          emptyText: `No statement has been running for ${minSeconds} seconds or more.`,
        },
        ...(limited.note ? [limited.note] : []),
      ]);
    }

    case "blocking": {
      const rows: Array<SqlRow> = await connection.query(
        usesPerformanceSchemaLocks(server)
          ? MYSQL_SQL["blockingPerformanceSchema"]!
          : MYSQL_SQL["blockingInformationSchema"]!,
        [limit + 1],
      );
      const limited: { rows: Array<SqlRow>; note: OutputSection | null } =
        limitRows(rows, limit, more);

      return ok([
        {
          kind: "records",
          title: "InnoDB lock waits: who waits, and who blocks",
          columns: [
            { key: "waiting_id" },
            { key: "wait_seconds" },
            { key: "locked_schema" },
            { key: "locked_table" },
            { key: "locked_index" },
            { key: "waiting_lock_mode" },
            { key: "blocking_id" },
            { key: "blocking_lock_mode" },
            { key: "blocking_trx_seconds" },
            { key: "waiting_query", kind: "query" },
            { key: "blocking_query", kind: "query" },
          ],
          rows: limited.rows,
          emptyText: "No InnoDB transaction is waiting for a lock.",
        },
        ...(limited.note ? [limited.note] : []),
      ]);
    }

    case "locks": {
      const rows: Array<SqlRow> = await connection.query(
        usesPerformanceSchemaLocks(server)
          ? MYSQL_SQL["locksPerformanceSchema"]!
          : MYSQL_SQL["locksInformationSchema"]!,
        [limit + 1],
      );
      const limited: { rows: Array<SqlRow>; note: OutputSection | null } =
        limitRows(rows, limit, more);

      return ok([
        {
          kind: "table",
          columns: [
            { key: "session_id" },
            { key: "trx_id" },
            { key: "schema_name", header: "schema" },
            { key: "table_name", header: "table" },
            { key: "index_name", header: "index" },
            { key: "lock_type" },
            { key: "lock_mode" },
            { key: "trx_seconds" },
            { key: "lock_status" },
          ],
          rows: limited.rows,
          emptyText: usesPerformanceSchemaLocks(server)
            ? "No InnoDB locks are held or awaited."
            : "No InnoDB lock is involved in a wait (this server lists only those).",
        },
        ...(limited.note ? [limited.note] : []),
      ]);
    }

    case "replication":
      return runReplication(connection, server);

    case "connections": {
      const status: Array<SqlRow> = await connection.query(
        MYSQL_SQL["connectionStatus"]!,
      );
      const limits: Array<SqlRow> = await connection.query(
        MYSQL_SQL["connectionLimits"]!,
      );
      const groups: Array<SqlRow> = await connection.query(
        MYSQL_SQL["connectionGroups"]!,
        [DATABASE_MAX_ROW_LIMIT + 1],
      );
      const limited: { rows: Array<SqlRow>; note: OutputSection | null } =
        limitRows(groups, DATABASE_MAX_ROW_LIMIT, "");
      const fields: Array<{ name: string; value: unknown }> = status.map(
        (row: SqlRow): { name: string; value: unknown } => {
          return { name: String(row["Variable_name"]), value: row["Value"] };
        },
      );
      const connected: number | null = toNumber(
        (status.find((row: SqlRow): boolean => {
          return row["Variable_name"] === "Threads_connected";
        }) || {})["Value"],
      );
      const max: number | null = toNumber((limits[0] || {})["max_connections"]);

      return ok([
        {
          kind: "fields",
          fields: [
            ...fields,
            {
              name: "max_connections",
              value: (limits[0] || {})["max_connections"],
            },
            {
              name: "max_user_connections",
              value: (limits[0] || {})["max_user_connections"],
            },
            {
              name: "used_percent",
              value:
                connected !== null && max
                  ? `${Math.round((connected / max) * 100)}%`
                  : null,
            },
          ],
        },
        {
          kind: "table",
          title: "Connections by user, database and command",
          columns: [
            { key: "user_name", header: "user" },
            { key: "database_name", header: "db" },
            { key: "command" },
            { key: "connections" },
          ],
          rows: limited.rows,
        },
        ...(limited.note ? [limited.note] : []),
      ]);
    }

    case "database-sizes": {
      const rows: Array<SqlRow> = await connection.query(
        MYSQL_SQL["databaseSizes"]!,
        [DATABASE_MAX_ROW_LIMIT + 1],
      );
      const limited: { rows: Array<SqlRow>; note: OutputSection | null } =
        limitRows(rows, DATABASE_MAX_ROW_LIMIT, "");

      return ok([
        {
          kind: "table",
          columns: [
            { key: "database_name", header: "database" },
            { key: "size" },
            { key: "data" },
            { key: "indexes" },
            { key: "tables" },
            { key: "size_bytes" },
          ],
          rows: limited.rows.map((row: SqlRow): SqlRow => {
            return {
              ...row,
              size: formatBytes(row["size_bytes"]),
              data: formatBytes(row["data_bytes"]),
              indexes: formatBytes(row["index_bytes"]),
            };
          }),
          emptyText:
            "No schema is visible to this login (information_schema lists only the schemas it has a privilege on).",
        },
        ...(limited.note ? [limited.note] : []),
        ...cachedStatisticsNote(server),
      ]);
    }

    case "table-sizes": {
      const database: string | null = flagString(command, "database");
      const rows: Array<SqlRow> = await connection.query(
        MYSQL_SQL["tableSizes"]!,
        [database, database, database, limit + 1],
      );
      const limited: { rows: Array<SqlRow>; note: OutputSection | null } =
        limitRows(rows, limit, more);

      return ok([
        {
          kind: "table",
          title: database ? `Largest tables in ${database}` : "Largest tables",
          columns: [
            { key: "schema_name", header: "schema" },
            { key: "table_name", header: "table" },
            { key: "engine" },
            { key: "total" },
            { key: "data" },
            { key: "indexes" },
            { key: "free" },
            { key: "estimated_rows" },
          ],
          rows: limited.rows.map((row: SqlRow): SqlRow => {
            return {
              ...row,
              total: formatBytes(row["total_bytes"]),
              data: formatBytes(row["data_bytes"]),
              indexes: formatBytes(row["index_bytes"]),
              free: formatBytes(row["free_bytes"]),
            };
          }),
          emptyText: database
            ? `No table in schema ${database} is visible to this login.`
            : "No table is visible to this login.",
        },
        ...(limited.note ? [limited.note] : []),
        ...cachedStatisticsNote(server),
      ]);
    }

    case "top-statements": {
      const enabled: Array<SqlRow> = await connection.query(
        MYSQL_SQL["performanceSchemaEnabled"]!,
      );

      if (toNumber((enabled[0] || {})["enabled"]) !== 1) {
        return ok([
          {
            kind: "note",
            text: "performance_schema is off on this server, so there are no statement statistics to read. Turn it on with performance_schema=ON in the server's configuration (a restart).",
          },
        ]);
      }

      const rows: Array<SqlRow> = await connection.query(
        MYSQL_SQL["topStatements"]!,
        [limit + 1],
      );
      const limited: { rows: Array<SqlRow>; note: OutputSection | null } =
        limitRows(rows, limit, more);

      return ok([
        {
          kind: "table",
          title:
            "Statements by total time (performance_schema.events_statements_summary_by_digest)",
          columns: [
            { key: "schema_name", header: "schema" },
            { key: "calls" },
            { key: "total_ms" },
            { key: "mean_ms" },
            { key: "rows_examined" },
            { key: "rows_sent" },
            { key: "no_index_used" },
            { key: "query", kind: "query" },
          ],
          rows: limited.rows,
          emptyText: "No statement digests have been recorded yet.",
        },
        ...(limited.note ? [limited.note] : []),
      ]);
    }

    case "settings":
      return runSettings(connection, argumentString(command));

    case "slowlog":
      return runSlowLog(connection, limit);

    case "innodb-status": {
      const rows: Array<SqlRow> = await connection.query(
        MYSQL_SQL["innodbStatus"]!,
      );

      return ok([
        {
          kind: "text",
          text: normalizeInnodbStatusStatements(
            String((rows[0] || {})["Status"] ?? ""),
          ),
        },
      ]);
    }

    default:
      return failed(
        `db ${command.operation.name} is not available on ${describeMySqlServer(server)}.`,
      );
  }
}

/*
 * SHOW ENGINE INNODB STATUS prints each transaction's statement verbatim —
 * newlines, literals and all — on the lines after its "MySQL thread id ..."
 * line (TRANSACTIONS, LATEST DETECTED DEADLOCK, LATEST FOREIGN KEY ERROR).
 * The output redactor reads plain text line by line, and cannot tell a
 * statement's continuation line ("  card = 4111111111111111,") from the
 * monitor's own text, so each statement is normalized here as ONE statement
 * (literals become ?, as a query column is): from the line after the thread
 * line up to the next line the monitor writes itself. A monitor line this
 * list does not know is normalized with the statement — over-masking is
 * accepted, a literal left in place is not.
 */
const INNODB_THREAD_LINE_REGEX: RegExp = /^(?:MySQL|MariaDB) thread id [0-9]+/;
const INNODB_MONITOR_LINE_REGEXES: ReadonlyArray<RegExp> = [
  // ---TRANSACTION, ------- TRX HAS BEEN WAITING, section rules
  /^-{3,}/,
  /^={3,}/,
  // *** (1) TRANSACTION:, *** (1) HOLDS THE LOCK(S):, *** WE ROLL BACK
  /^\*{3}/,
  /^TRANSACTION [0-9]+,/,
  INNODB_THREAD_LINE_REGEX,
  /^Trx read view /,
  /^Trx #rec lock waits /,
  /^RECORD LOCKS /,
  /^TABLE LOCK /,
  /^Record lock, /,
  /^LOCK WAIT /,
  /^mysql tables in use /,
  /^[0-9]+ lock struct\(s\)/,
  /^Foreign key constraint fails /,
  /^Trying to /,
  /^DATA TUPLE: /,
  /^But (?:the parent|in parent) /,
  /^END OF INNODB MONITOR OUTPUT/,
];

function isInnodbMonitorLine(line: string): boolean {
  return INNODB_MONITOR_LINE_REGEXES.some((pattern: RegExp): boolean => {
    return pattern.test(line);
  });
}

// The InnoDB monitor's report with every statement in it normalized.
export function normalizeInnodbStatusStatements(status: string): string {
  const lines: Array<string> = (status || "").split("\n");
  const out: Array<string> = [];
  let index: number = 0;

  while (index < lines.length) {
    const line: string = lines[index] || "";
    out.push(line);
    index++;

    if (!INNODB_THREAD_LINE_REGEX.test(line)) {
      continue;
    }

    const statement: Array<string> = [];

    while (index < lines.length && !isInnodbMonitorLine(lines[index] || "")) {
      statement.push(lines[index] || "");
      index++;
    }

    if (statement.length > 0) {
      out.push(normalizeQueryText(statement.join("\n")));
    }
  }

  return out.join("\n");
}

// MySQL 8 serves table statistics from a cache (a day old at most, by default).
function cachedStatisticsNote(server: MySqlServer): Array<OutputSection> {
  return !server.isMariaDb && server.major >= 8
    ? [
        {
          kind: "note",
          text: "MySQL 8 caches these sizes for information_schema_stats_expiry seconds (a day by default), so a table that just grew may show its earlier size.",
        },
      ]
    : [];
}

async function runReplication(
  connection: SqlConnection,
  server: MySqlServer,
): Promise<DiagnosticOutcome> {
  const identity: Array<SqlRow> = await connection.query(
    server.isMariaDb
      ? MYSQL_SQL["mariaDbReplicationIdentity"]!
      : MYSQL_SQL["mysqlReplicationIdentity"]!,
  );
  // SHOW REPLICA STATUS arrived in MySQL 8.0.22; SHOW BINARY LOG STATUS in 8.2.
  const replica: Array<SqlRow> = await connection.query(
    !server.isMariaDb && atLeast(server, 8, 0, 22)
      ? MYSQL_SQL["replicaStatus"]!
      : MYSQL_SQL["slaveStatus"]!,
  );
  const binlog: Array<SqlRow> = await connection.query(
    !server.isMariaDb && atLeast(server, 8, 2, 0)
      ? MYSQL_SQL["binaryLogStatus"]!
      : MYSQL_SQL["masterStatus"]!,
  );
  const replicas: Array<SqlRow> = await connection.query(
    MYSQL_SQL["connectedReplicas"]!,
  );
  const row: SqlRow = identity[0] || {};

  return ok([
    {
      kind: "fields",
      fields: Object.entries(row).map(
        ([name, value]: [string, unknown]): {
          name: string;
          value: unknown;
        } => {
          return { name, value };
        },
      ),
    },
    {
      kind: "records",
      title: "This server as a replica",
      columns: nonEmptyColumns(replica),
      rows: replica,
      emptyText: "This server is not a replica (replica status is empty).",
    },
    {
      kind: "fields",
      title: "Binary log",
      fields: binlog.length
        ? Object.entries(binlog[0] || {}).map(
            ([name, value]: [string, unknown]): {
              name: string;
              value: unknown;
            } => {
              return { name, value };
            },
          )
        : [{ name: "binary_log", value: "off (no binary log is written)" }],
    },
    {
      kind: "table",
      title: "Replicas reading this server's binary log",
      columns: SESSION_COLUMNS.filter((column: OutputColumn): boolean => {
        return column.key !== "query";
      }),
      rows: replicas,
      emptyText: "No replica is connected.",
    },
  ]);
}

async function runSettings(
  connection: SqlConnection,
  name: string | null,
): Promise<DiagnosticOutcome> {
  const rows: Array<SqlRow> = await connection.query(
    name === null ? MYSQL_SQL["allSettings"]! : MYSQL_SQL["settingByName"]!,
    name === null ? [] : [name],
  );
  const shown: Array<SqlRow> = rows.filter((row: SqlRow): boolean => {
    return !isDatabaseCredentialSettingName(row["Variable_name"]);
  });

  if (name !== null) {
    const row: SqlRow | undefined = shown[0];

    if (!row) {
      return failed(
        `This server has no global variable named "${name}" (db settings with no name prints every one).`,
      );
    }

    return ok([
      {
        kind: "fields",
        fields: [
          { name: "name", value: row["Variable_name"] },
          { name: "value", value: row["Value"] },
        ],
      },
    ]);
  }

  return ok([
    {
      kind: "table",
      columns: [
        { key: "Variable_name", header: "name" },
        { key: "Value", header: "value" },
      ],
      rows: shown,
    },
    {
      kind: "note",
      text: `${rows.length - shown.length} credential variable(s) are not shown.`,
    },
  ]);
}

async function runSlowLog(
  connection: SqlConnection,
  limit: number,
): Promise<DiagnosticOutcome> {
  const settings: Array<SqlRow> = await connection.query(
    MYSQL_SQL["slowLogSettings"]!,
  );
  const row: SqlRow = settings[0] || {};
  const logOutput: string = String(row["log_output"] ?? "");
  const header: OutputSection = {
    kind: "fields",
    fields: [
      { name: "slow_query_log", value: row["slow_query_log"] },
      { name: "log_output", value: row["log_output"] },
      { name: "long_query_time", value: row["long_query_time"] },
    ],
  };

  if (!TABLE_LOG_OUTPUT_PATTERN.test(logOutput)) {
    return ok([
      header,
      {
        kind: "note",
        text: `The slow query log is written to ${
          logOutput || "a file"
        }, not to a table, so db slowlog cannot read it. It reads mysql.slow_log when the server's log_output setting includes TABLE.`,
      },
    ]);
  }

  const rows: Array<SqlRow> = await connection.query(MYSQL_SQL["slowLog"]!, [
    limit + 1,
  ]);
  const limited: { rows: Array<SqlRow>; note: OutputSection | null } =
    limitRows(
      rows,
      limit,
      `Raise --limit (at most ${DATABASE_MAX_ROW_LIMIT}).`,
    );

  return ok([
    header,
    {
      kind: "table",
      title: "Most recent slow statements (mysql.slow_log)",
      columns: [
        { key: "start_time" },
        { key: "user_host" },
        { key: "query_time" },
        { key: "lock_time" },
        { key: "rows_sent" },
        { key: "rows_examined" },
        { key: "database_name", header: "db" },
        { key: "query", kind: "query" },
      ],
      rows: limited.rows,
      emptyText: "The slow query log is empty.",
    },
    ...(limited.note ? [limited.note] : []),
  ]);
}

// ---- Writes ---------------------------------------------------------------------------

async function runWrite(
  connection: SqlConnection,
  run: DiagnosticRun,
): Promise<DiagnosticOutcome> {
  const operation: string = run.command.operation.name;
  const isCancel: boolean = operation === "cancel-query";
  const id: number | null = sessionIdOf(run.command);

  if (id === null) {
    return refusedByAgent(
      `"${String(run.command.argument)}" is not a MySQL connection id.`,
    );
  }

  const own: Array<SqlRow> = await connection.query(
    MYSQL_SQL["ownConnectionId"]!,
  );

  if (toNumber((own[0] || {})["id"]) === id) {
    return refusedByAgent(
      `connection ${id} is the agent's own (session:${id}); it never kills itself.`,
    );
  }

  const targets: Array<SqlRow> = await connection.query(
    MYSQL_SQL["sessionById"]!,
    [id],
  );
  const target: SqlRow | undefined = targets[0];

  if (!target) {
    return notRun(
      `There is no connection ${id} in the processlist (it may have ended already, or this login lacks the PROCESS privilege to see it). Run db sessions to see the current ones; nothing was changed.`,
    );
  }

  const user: string = String(target["user_name"] ?? "");
  const command: string = String(target["command"] ?? "");

  if (SYSTEM_USERS.includes(user) || SYSTEM_COMMANDS.includes(command)) {
    return refusedByAgent(
      `connection ${id} is a server thread (${user || "no user"}, ${command}), not a client session: db ${operation} never kills replication, event-scheduler or other server threads.`,
    );
  }

  if (isCancel && command === "Sleep") {
    return notRun(
      `Connection ${id} is idle (Sleep): there is no running statement to cancel, so nothing was changed. An idle transaction ends only with its connection: db terminate-session ${id}.`,
    );
  }

  const targetSection: OutputSection = {
    kind: "fields",
    title: "The connection, before",
    fields: [
      { name: "id", value: target["id"] },
      { name: "user", value: target["user_name"] },
      { name: "host", value: target["host"] },
      { name: "db", value: target["database_name"] },
      { name: "command", value: target["command"] },
      { name: "time_s", value: target["seconds"] },
      { name: "state", value: target["state"] },
      { name: "query", value: target["query"], kind: "query" },
    ],
  };

  try {
    await connection.query(
      isCancel ? MYSQL_SQL["killQuery"]! : MYSQL_SQL["killConnection"]!,
      [id],
    );
  } catch (err: unknown) {
    // 1094: the connection ended between the lookup and the KILL.
    if (
      errorNumber(err, "errno") === 1094 ||
      errorCode(err) === "ER_NO_SUCH_THREAD"
    ) {
      return failed(
        `Connection ${id} ended before the KILL reached it; nothing else was changed.`,
        [targetSection],
      );
    }

    throw err;
  }

  await run.sleep(run.settleMs);

  const after: Array<SqlRow> = await connection.query(
    MYSQL_SQL["sessionById"]!,
    [id],
  );
  const now: SqlRow | undefined = after[0];

  let afterText: string;

  if (!now) {
    afterText = `Connection ${id} is gone.`;
  } else if (String(now["command"] ?? "") === "Killed") {
    afterText = `Connection ${id} is marked Killed; the server ends it at its next check.`;
  } else {
    afterText = `Connection ${id} is now ${String(now["command"] ?? "unknown")}${
      now["state"] ? ` (${String(now["state"])})` : ""
    }.`;
  }

  return ok([
    {
      kind: "note",
      text: isCancel
        ? `Cancelled the running statement of connection ${id} (KILL QUERY). The connection stays open.`
        : `Terminated connection ${id} (KILL CONNECTION): its open transaction is rolled back and its client must reconnect.`,
    },
    targetSection,
    { kind: "note", text: afterText },
  ]);
}

export async function runMySqlDiagnostic(
  connection: SqlConnection,
  run: DiagnosticRun,
): Promise<DiagnosticOutcome> {
  const server: MySqlServer = await readServer(connection);
  const operation: string = run.command.operation.name;
  const isWrite: boolean =
    operation === "cancel-query" || operation === "terminate-session";

  await prepareSession(connection, server, run, !isWrite);

  return isWrite ? runWrite(connection, run) : runRead(connection, server, run);
}

export async function probeMySql(
  connection: SqlConnection,
): Promise<EngineProbe> {
  const rows: Array<SqlRow> = await connection.query(MYSQL_SQL["probe"]!);
  const row: SqlRow = rows[0] || {};
  const server: MySqlServer = parseMySqlServer(
    row["version"],
    row["version_comment"],
  );

  return {
    toolVersion: server.version ? describeMySqlServer(server) : "MySQL",
    details: {
      serverVersion: server.version || null,
      mariaDb: server.isMariaDb,
      readOnly: toNumber(row["read_only"]) === 1,
    },
  };
}

// errno / mysql2 code -> what an operator should change.
export function describeMySqlError(
  err: unknown,
  data: { username: string; credentialSource: string },
): string | null {
  const errno: number | null = errorNumber(err, "errno");
  const code: string | null = errorCode(err);
  const message: string = errorMessage(err);

  switch (errno) {
    case 1045:
      return `The server refused the login "${data.username}" (${message}). Check ${data.credentialSource}, and that the user may connect from the agent's address ('user'@'%').`;
    case 1044:
      return `The login "${data.username}" may not use that database (${message}).`;
    case 1227:
      return `The login "${data.username}" lacks a privilege this needs (${message}). Grant PROCESS and REPLICATION CLIENT for reads (SLAVE MONITOR on MariaDB 10.5.9+), and CONNECTION_ADMIN (MySQL 8) or CONNECTION ADMIN (MariaDB) to cancel queries or end sessions.`;
    case 1142:
    case 1143:
      return `The login "${data.username}" may not read that table (${message}). Grant SELECT on performance_schema.* (and on mysql.slow_log for db slowlog).`;
    case 1095:
      return `The login "${data.username}" may not kill other users' connections (${message}). Grant it CONNECTION_ADMIN (MySQL 8), CONNECTION ADMIN (MariaDB 10.5+) or SUPER.`;
    case 1094:
      return `That connection no longer exists (${message}).`;
    case 3024:
    case 1969:
      return `The server stopped the statement: it ran longer than the command's time budget (${message}).`;
    case 1205:
      return `The statement waited too long for a lock and was stopped (${message}).`;
    case 1040:
      return `The server has no free connection slot (${message}): max_connections is reached, which is itself worth investigating.`;
    case 1129:
      return `The server blocked the agent's host after too many connection errors (${message}). Run FLUSH HOSTS (or mysqladmin flush-hosts) on the server.`;
    case 3159:
      return `The server requires TLS (${message}). Set DATABASE_TLS_INSECURE=false.`;
    case 1146:
    case 1054:
    case 1064:
      return `This server version lacks something the diagnostic reads (${message}). The Database AI agent supports MySQL 5.7+, MariaDB 10.3+ and Percona Server.`;
    default:
      break;
  }

  if (code === "HANDSHAKE_NO_SSL_SUPPORT") {
    return `The server does not support TLS (${message}). Set DATABASE_TLS_INSECURE=true.`;
  }

  return null;
}
