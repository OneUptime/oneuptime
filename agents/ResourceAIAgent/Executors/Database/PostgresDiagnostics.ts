import { SqlConnection, SqlRow } from "./DatabaseDrivers";
import {
  OutputColumn,
  OutputSection,
  formatBytes,
  limitRows,
} from "./DatabaseOutput";
import {
  DATABASE_AI_AGENT_APPLICATION_NAME,
  DiagnosticOutcome,
  DiagnosticRun,
  EngineProbe,
  errorCode,
  errorMessage,
  failed,
  flagInteger,
  flagString,
  argumentString,
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
 * The db catalog on PostgreSQL (10 and later), through pg. Each operation
 * is one or a few statements this file owns; the only values that reach
 * them are the catalog's typed parameters, always as bind parameters ($1),
 * never spliced into the text.
 *
 * Reads run inside `BEGIN READ ONLY`, with `SET LOCAL statement_timeout`
 * and `SET LOCAL lock_timeout` (set_config(..., true): the same setting,
 * with the values as parameters) so no statement outlives the job's
 * budget or waits long behind a lock, and the transaction is rolled back
 * at the end. Nothing a read runs can write.
 *
 * The two writes, cancel-query (pg_cancel_backend) and terminate-session
 * (pg_terminate_backend), first look up the agent's own backend
 * (pg_backend_pid()) and the target in pg_stat_activity, and never signal
 * the agent's own session, another connection of this agent, a pid that
 * is not there, or a process that is not a client session (autovacuum may
 * have its statement cancelled; nothing else background is touched). Then
 * they look at the target once more, so the output says what the signal
 * did.
 */

// Backends a write may signal, by pg_stat_activity.backend_type.
const CANCELLABLE_BACKEND_TYPES: ReadonlyArray<string> = [
  "client backend",
  "autovacuum worker",
];
const TERMINABLE_BACKEND_TYPES: ReadonlyArray<string> = ["client backend"];

/*
 * Server processes that never run a client's statement: left out of db
 * sessions (a SQL list of literals this file owns, not user input).
 */
const POSTGRES_AUXILIARY_BACKENDS: string = [
  "archiver",
  "autovacuum launcher",
  "background writer",
  "checkpointer",
  "io worker",
  "logical replication launcher",
  "startup",
  "walreceiver",
  "walsummarizer",
  "walwriter",
]
  .map((name: string): string => {
    return `'${name}'`;
  })
  .join(", ");

// What pg_stat_activity shows for another role's query without pg_read_all_stats.
const INSUFFICIENT_PRIVILEGE_QUERY: string = "<insufficient privilege>";

// Settings whose value is a connection string (primary_conninfo): shown masked.
const CONNINFO_SETTING_PATTERN: RegExp = /conninfo/i;
const MASKED_CONNINFO: string = "[redacted: a connection string]";

// catalog "idle-in-transaction" and friends -> pg_stat_activity.state values
const SESSION_STATES: Readonly<Record<string, Array<string>>> = {
  active: ["active"],
  idle: ["idle"],
  "idle-in-transaction": [
    "idle in transaction",
    "idle in transaction (aborted)",
  ],
};

const SESSION_COLUMNS: Array<OutputColumn> = [
  { key: "pid" },
  { key: "user_name", header: "user" },
  { key: "database_name", header: "database" },
  { key: "application_name", header: "application" },
  { key: "client_addr", header: "client" },
  { key: "backend_type", header: "backend" },
  { key: "state" },
  { key: "wait" },
  { key: "xact_seconds", header: "xact_s" },
  { key: "query_seconds", header: "query_s" },
  { key: "query", kind: "query" },
];

export const POSTGRES_SQL: Readonly<Record<string, string>> = {
  beginReadOnly: "BEGIN READ ONLY",
  setLocalTimeouts:
    "SELECT set_config('statement_timeout', $1, true) AS statement_timeout, set_config('lock_timeout', $2, true) AS lock_timeout",
  setSessionTimeouts:
    "SELECT set_config('statement_timeout', $1, false) AS statement_timeout, set_config('lock_timeout', $2, false) AS lock_timeout",
  rollback: "ROLLBACK",
  ping: "SELECT 1 AS ok, current_user AS user_name, current_database() AS database_name",
  version:
    "SELECT version() AS version, current_setting('server_version') AS server_version, current_setting('server_version_num') AS server_version_num, pg_postmaster_start_time() AS started_at, (now() - pg_postmaster_start_time())::text AS uptime, pg_is_in_recovery() AS in_recovery",
  sessions: `SELECT pid, usename AS user_name, datname AS database_name, application_name, client_addr::text AS client_addr, backend_type, state, wait_event_type, wait_event,
  EXTRACT(EPOCH FROM now() - xact_start)::bigint AS xact_seconds,
  EXTRACT(EPOCH FROM now() - query_start)::bigint AS query_seconds,
  query
FROM pg_stat_activity
WHERE pid <> pg_backend_pid()
  AND backend_type NOT IN (${POSTGRES_AUXILIARY_BACKENDS})
  AND ($1::text[] IS NULL OR state = ANY($1::text[]))
  AND ($2::text IS NULL OR usename = $2::text)
  AND ($3::text IS NULL OR datname = $3::text)
ORDER BY CASE state WHEN 'active' THEN 0 WHEN 'idle in transaction' THEN 1 WHEN 'idle in transaction (aborted)' THEN 1 WHEN 'idle' THEN 2 ELSE 3 END,
  COALESCE(xact_start, query_start, backend_start) ASC NULLS LAST, pid
LIMIT $4`,
  longQueries: `SELECT pid, usename AS user_name, datname AS database_name, application_name, client_addr::text AS client_addr, backend_type, state, wait_event_type, wait_event,
  EXTRACT(EPOCH FROM now() - xact_start)::bigint AS xact_seconds,
  EXTRACT(EPOCH FROM now() - query_start)::bigint AS query_seconds,
  query
FROM pg_stat_activity
WHERE pid <> pg_backend_pid()
  AND state IS NOT NULL AND state <> 'idle'
  AND query_start IS NOT NULL
  AND now() - query_start >= $1::int * interval '1 second'
ORDER BY query_start ASC, pid
LIMIT $2`,
  blocking: `SELECT blocked.pid AS blocked_pid, blocked.usename AS blocked_user, blocked.datname AS database_name,
  EXTRACT(EPOCH FROM now() - blocked.query_start)::bigint AS blocked_seconds,
  concat_ws(':', blocked.wait_event_type, blocked.wait_event) AS waiting_on,
  blocking.pid AS blocking_pid, blocking.usename AS blocking_user, blocking.state AS blocking_state,
  EXTRACT(EPOCH FROM now() - blocking.xact_start)::bigint AS blocking_xact_seconds,
  blocked.query AS blocked_query, blocking.query AS blocking_query
FROM pg_stat_activity AS blocked
CROSS JOIN LATERAL unnest(pg_blocking_pids(blocked.pid)) AS blocker(pid)
JOIN pg_stat_activity AS blocking ON blocking.pid = blocker.pid
WHERE blocked.pid <> pg_backend_pid()
ORDER BY blocked.query_start ASC NULLS LAST, blocked.pid, blocking.pid
LIMIT $1`,
  locks: `SELECT l.pid, a.usename AS user_name, a.datname AS database_name, l.locktype,
  CASE WHEN l.relation IS NOT NULL THEN l.relation::regclass::text END AS relation,
  l.mode, l.granted,
  EXTRACT(EPOCH FROM now() - a.xact_start)::bigint AS xact_seconds, a.state, a.query
FROM pg_locks AS l LEFT JOIN pg_stat_activity AS a ON a.pid = l.pid
WHERE l.pid IS DISTINCT FROM pg_backend_pid()
  AND NOT (l.locktype = 'virtualxid' AND l.granted)
ORDER BY l.granted ASC, a.xact_start ASC NULLS LAST, l.pid
LIMIT $1`,
  inRecovery: "SELECT pg_is_in_recovery() AS in_recovery",
  primaryReplicas: `SELECT pid, usename AS user_name, application_name, client_addr::text AS client_addr, state, sync_state,
  sent_lsn::text AS sent_lsn, replay_lsn::text AS replay_lsn,
  pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn)::bigint AS replay_lag_bytes,
  write_lag::text AS write_lag, flush_lag::text AS flush_lag, replay_lag::text AS replay_lag
FROM pg_stat_replication
ORDER BY application_name, pid`,
  primarySlots: `SELECT slot_name, slot_type, database, active, active_pid, restart_lsn::text AS restart_lsn,
  pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)::bigint AS retained_wal_bytes
FROM pg_replication_slots
ORDER BY slot_name`,
  standbyStatus: `SELECT pg_last_wal_receive_lsn()::text AS receive_lsn, pg_last_wal_replay_lsn()::text AS replay_lsn,
  pg_last_xact_replay_timestamp() AS last_replayed_at,
  EXTRACT(EPOCH FROM now() - pg_last_xact_replay_timestamp())::bigint AS replay_delay_seconds,
  pg_is_wal_replay_paused() AS replay_paused`,
  standbyReceiver: `SELECT status, sender_host, sender_port, slot_name, latest_end_lsn::text AS latest_end_lsn, latest_end_time, last_msg_receipt_time
FROM pg_stat_wal_receiver`,
  standbySlots: `SELECT slot_name, slot_type, database, active, active_pid, restart_lsn::text AS restart_lsn,
  pg_wal_lsn_diff(pg_last_wal_replay_lsn(), restart_lsn)::bigint AS retained_wal_bytes
FROM pg_replication_slots
ORDER BY slot_name`,
  connectionSummary: `SELECT count(*) FILTER (WHERE backend_type = 'client backend') AS client_connections,
  count(*) FILTER (WHERE backend_type = 'client backend' AND state = 'active') AS active,
  count(*) FILTER (WHERE state IN ('idle in transaction', 'idle in transaction (aborted)')) AS idle_in_transaction,
  current_setting('max_connections')::int AS max_connections,
  current_setting('superuser_reserved_connections')::int AS superuser_reserved_connections
FROM pg_stat_activity`,
  connectionGroups: `SELECT COALESCE(state, '') AS state, usename AS user_name, datname AS database_name, count(*) AS connections
FROM pg_stat_activity
WHERE backend_type = 'client backend'
GROUP BY state, usename, datname
ORDER BY connections DESC, user_name, database_name
LIMIT $1`,
  databaseSizes: `SELECT d.datname AS database_name,
  CASE WHEN has_database_privilege(d.oid, 'CONNECT') OR pg_has_role('pg_read_all_stats', 'MEMBER') THEN pg_database_size(d.oid) END AS size_bytes,
  d.datallowconn AS allows_connections
FROM pg_database AS d
WHERE NOT d.datistemplate
ORDER BY size_bytes DESC NULLS LAST, database_name
LIMIT $1`,
  currentDatabase: "SELECT current_database() AS database_name",
  tableSizes: `SELECT n.nspname AS schema_name, c.relname AS table_name, c.relkind AS kind,
  pg_total_relation_size(c.oid) AS total_bytes, pg_relation_size(c.oid) AS table_bytes, pg_indexes_size(c.oid) AS index_bytes,
  CASE WHEN c.reltuples < 0 THEN NULL ELSE c.reltuples::bigint END AS estimated_rows
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'm', 'p')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg\\_toast%'
ORDER BY total_bytes DESC, schema_name, table_name
LIMIT $1`,
  statementsExtension: `SELECT n.nspname AS schema_name
FROM pg_extension AS e JOIN pg_namespace AS n ON n.oid = e.extnamespace
WHERE e.extname = 'pg_stat_statements'`,
  serverVersionNum:
    "SELECT current_setting('server_version_num')::int AS server_version_num",
  settingByName:
    "SELECT name, setting, unit, source, boot_val, reset_val, pending_restart, context, short_desc FROM pg_settings WHERE lower(name) = lower($1::text)",
  allSettings:
    "SELECT name, setting, unit, source FROM pg_settings ORDER BY name",
  ownPid: "SELECT pg_backend_pid() AS pid",
  sessionByPid: `SELECT pid, usename AS user_name, datname AS database_name, application_name, client_addr::text AS client_addr, backend_type, state,
  EXTRACT(EPOCH FROM now() - query_start)::bigint AS query_seconds, query
FROM pg_stat_activity
WHERE pid = $1::int`,
  cancel: "SELECT pg_cancel_backend($1::int) AS signalled",
  terminate: "SELECT pg_terminate_backend($1::int) AS signalled",
  probe:
    "SELECT current_setting('server_version') AS server_version, pg_is_in_recovery() AS in_recovery",
};

// A double-quoted identifier (for a schema name read from pg_extension).
export function quotePostgresIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

// pg_stat_statements, from the schema its extension lives in.
export function buildTopStatementsSql(data: {
  schema: string;
  serverVersionNum: number;
}): string {
  // PostgreSQL 13 renamed total_time / mean_time to *_exec_time.
  const total: string =
    data.serverVersionNum >= 130000 ? "total_exec_time" : "total_time";
  const mean: string =
    data.serverVersionNum >= 130000 ? "mean_exec_time" : "mean_time";

  return `SELECT s.queryid::text AS query_id, pg_get_userbyid(s.userid) AS user_name, d.datname AS database_name, s.calls,
  round(s.${total}::numeric, 1) AS total_ms, round(s.${mean}::numeric, 2) AS mean_ms, s.rows,
  s.shared_blks_hit, s.shared_blks_read, s.query
FROM ${quotePostgresIdentifier(data.schema)}.pg_stat_statements AS s
LEFT JOIN pg_database AS d ON d.oid = s.dbid
ORDER BY s.${total} DESC
LIMIT $1`;
}

function noop(): void {
  // A rollback that fails leaves nothing behind: the connection is closed next.
}

function withWait(rows: Array<SqlRow>): Array<SqlRow> {
  return rows.map((row: SqlRow): SqlRow => {
    const type: unknown = row["wait_event_type"];
    const event: unknown = row["wait_event"];

    return {
      ...row,
      wait:
        type || event
          ? [type, event].filter(Boolean).map(String).join(":")
          : null,
    };
  });
}

// A note when pg_stat_activity hid other roles' queries from this login.
function privilegeNote(rows: Array<SqlRow>): Array<OutputSection> {
  const hidden: boolean = rows.some((row: SqlRow): boolean => {
    return row["query"] === INSUFFICIENT_PRIVILEGE_QUERY;
  });

  return hidden
    ? [
        {
          kind: "note",
          text: `Some sessions show ${INSUFFICIENT_PRIVILEGE_QUERY}: this login cannot see other roles' queries. Grant it pg_monitor (or pg_read_all_stats) to see them.`,
        },
      ]
    : [];
}

function sessionStates(state: string | null): Array<string> | null {
  if (state === null) {
    return null;
  }

  return SESSION_STATES[state] || [state];
}

// ---- Reads ----------------------------------------------------------------------------

async function runRead(
  connection: SqlConnection,
  run: DiagnosticRun,
): Promise<DiagnosticOutcome> {
  const command: DiagnosticRun["command"] = run.command;
  const limit: number = flagInteger(
    command,
    "limit",
    DATABASE_DEFAULT_ROW_LIMIT,
  );

  switch (command.operation.name) {
    case "ping": {
      const rows: Array<SqlRow> = await connection.query(POSTGRES_SQL["ping"]!);
      const row: SqlRow = rows[0] || {};

      return ok([
        {
          kind: "fields",
          fields: [
            { name: "status", value: "ok (PostgreSQL answered SELECT 1)" },
            { name: "user", value: row["user_name"] },
            { name: "database", value: row["database_name"] },
          ],
        },
      ]);
    }

    case "version": {
      const rows: Array<SqlRow> = await connection.query(
        POSTGRES_SQL["version"]!,
      );
      const row: SqlRow = rows[0] || {};

      return ok([
        {
          kind: "fields",
          fields: [
            { name: "server_version", value: row["server_version"] },
            { name: "server_version_num", value: row["server_version_num"] },
            { name: "version", value: row["version"] },
            { name: "started_at", value: row["started_at"] },
            { name: "uptime", value: row["uptime"] },
            { name: "in_recovery", value: row["in_recovery"] },
          ],
        },
      ]);
    }

    case "sessions": {
      const rows: Array<SqlRow> = await connection.query(
        POSTGRES_SQL["sessions"]!,
        [
          sessionStates(flagString(command, "state")),
          flagString(command, "user"),
          flagString(command, "database"),
          limit + 1,
        ],
      );
      const limited: { rows: Array<SqlRow>; note: OutputSection | null } =
        limitRows(
          withWait(rows),
          limit,
          `Raise --limit (at most ${DATABASE_MAX_ROW_LIMIT}) or narrow with --state, --user or --database.`,
        );

      return ok([
        {
          kind: "table",
          columns: SESSION_COLUMNS,
          rows: limited.rows,
          emptyText:
            "No sessions match (the agent's own session is not listed).",
        },
        ...(limited.note ? [limited.note] : []),
        ...privilegeNote(limited.rows),
      ]);
    }

    case "long-queries": {
      const minSeconds: number = flagInteger(command, "min-seconds", 5);
      const rows: Array<SqlRow> = await connection.query(
        POSTGRES_SQL["longQueries"]!,
        [minSeconds, limit + 1],
      );
      const limited: { rows: Array<SqlRow>; note: OutputSection | null } =
        limitRows(
          withWait(rows),
          limit,
          `Raise --limit (at most ${DATABASE_MAX_ROW_LIMIT}) or --min-seconds.`,
        );

      return ok([
        {
          kind: "table",
          columns: SESSION_COLUMNS.filter((column: OutputColumn): boolean => {
            return column.key !== "backend_type";
          }),
          rows: limited.rows,
          emptyText: `No statement has been running for ${minSeconds} seconds or more.`,
        },
        ...(limited.note ? [limited.note] : []),
        ...privilegeNote(limited.rows),
      ]);
    }

    case "blocking": {
      const rows: Array<SqlRow> = await connection.query(
        POSTGRES_SQL["blocking"]!,
        [limit + 1],
      );
      const limited: { rows: Array<SqlRow>; note: OutputSection | null } =
        limitRows(
          rows,
          limit,
          `Raise --limit (at most ${DATABASE_MAX_ROW_LIMIT}).`,
        );

      return ok([
        {
          kind: "records",
          title: "Blocked sessions and the sessions blocking them",
          columns: [
            { key: "blocked_pid" },
            { key: "blocked_user" },
            { key: "database_name", header: "database" },
            { key: "blocked_seconds" },
            { key: "waiting_on" },
            { key: "blocking_pid" },
            { key: "blocking_user" },
            { key: "blocking_state" },
            { key: "blocking_xact_seconds" },
            { key: "blocked_query", kind: "query" },
            { key: "blocking_query", kind: "query" },
          ],
          rows: limited.rows,
          emptyText: "No session is blocked by another session.",
        },
        ...(limited.note ? [limited.note] : []),
      ]);
    }

    case "locks": {
      const rows: Array<SqlRow> = await connection.query(
        POSTGRES_SQL["locks"]!,
        [limit + 1],
      );
      const limited: { rows: Array<SqlRow>; note: OutputSection | null } =
        limitRows(
          rows,
          limit,
          `Raise --limit (at most ${DATABASE_MAX_ROW_LIMIT}).`,
        );

      return ok([
        {
          kind: "table",
          columns: [
            { key: "pid" },
            { key: "user_name", header: "user" },
            { key: "database_name", header: "database" },
            { key: "locktype" },
            { key: "relation" },
            { key: "mode" },
            { key: "granted" },
            { key: "xact_seconds", header: "xact_s" },
            { key: "state" },
            { key: "query", kind: "query" },
          ],
          rows: limited.rows,
          emptyText:
            "No locks besides each transaction's own (the agent's session is not listed).",
        },
        ...(limited.note ? [limited.note] : []),
      ]);
    }

    case "replication":
      return runReplication(connection);

    case "connections": {
      const summary: Array<SqlRow> = await connection.query(
        POSTGRES_SQL["connectionSummary"]!,
      );
      const groups: Array<SqlRow> = await connection.query(
        POSTGRES_SQL["connectionGroups"]!,
        [DATABASE_MAX_ROW_LIMIT + 1],
      );
      const row: SqlRow = summary[0] || {};
      const limited: { rows: Array<SqlRow>; note: OutputSection | null } =
        limitRows(groups, DATABASE_MAX_ROW_LIMIT, "");
      const used: number | null = toNumber(row["client_connections"]);
      const max: number | null = toNumber(row["max_connections"]);

      return ok([
        {
          kind: "fields",
          fields: [
            { name: "client_connections", value: row["client_connections"] },
            { name: "active", value: row["active"] },
            { name: "idle_in_transaction", value: row["idle_in_transaction"] },
            { name: "max_connections", value: row["max_connections"] },
            {
              name: "superuser_reserved_connections",
              value: row["superuser_reserved_connections"],
            },
            {
              name: "used_percent",
              value:
                used !== null && max
                  ? `${Math.round((used / max) * 100)}%`
                  : null,
            },
          ],
        },
        {
          kind: "table",
          title: "Client connections by state, user and database",
          columns: [
            { key: "state" },
            { key: "user_name", header: "user" },
            { key: "database_name", header: "database" },
            { key: "connections" },
          ],
          rows: limited.rows,
        },
        ...(limited.note ? [limited.note] : []),
      ]);
    }

    case "database-sizes": {
      const rows: Array<SqlRow> = await connection.query(
        POSTGRES_SQL["databaseSizes"]!,
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
            { key: "size_bytes" },
            { key: "allows_connections" },
          ],
          rows: limited.rows.map((row: SqlRow): SqlRow => {
            return {
              ...row,
              size:
                row["size_bytes"] === null
                  ? "(no access)"
                  : formatBytes(row["size_bytes"]),
            };
          }),
        },
        ...(limited.note ? [limited.note] : []),
      ]);
    }

    case "table-sizes": {
      const current: Array<SqlRow> = await connection.query(
        POSTGRES_SQL["currentDatabase"]!,
      );
      const rows: Array<SqlRow> = await connection.query(
        POSTGRES_SQL["tableSizes"]!,
        [limit + 1],
      );
      const limited: { rows: Array<SqlRow>; note: OutputSection | null } =
        limitRows(
          rows,
          limit,
          `Raise --limit (at most ${DATABASE_MAX_ROW_LIMIT}).`,
        );

      return ok([
        {
          kind: "table",
          title: `Largest tables in database ${String(
            (current[0] || {})["database_name"] ?? "",
          )}`,
          columns: [
            { key: "schema_name", header: "schema" },
            { key: "table_name", header: "table" },
            { key: "kind" },
            { key: "total" },
            { key: "table_size", header: "data" },
            { key: "index_size", header: "indexes" },
            { key: "estimated_rows" },
          ],
          rows: limited.rows.map((row: SqlRow): SqlRow => {
            return {
              ...row,
              total: formatBytes(row["total_bytes"]),
              table_size: formatBytes(row["table_bytes"]),
              index_size: formatBytes(row["index_bytes"]),
            };
          }),
          emptyText: "This database has no tables.",
        },
        ...(limited.note ? [limited.note] : []),
      ]);
    }

    case "top-statements":
      return runTopStatements(connection, limit);

    case "settings":
      return runSettings(connection, argumentString(command));

    default:
      return failed(
        `db ${command.operation.name} is not available on PostgreSQL.`,
      );
  }
}

async function runReplication(
  connection: SqlConnection,
): Promise<DiagnosticOutcome> {
  const recovery: Array<SqlRow> = await connection.query(
    POSTGRES_SQL["inRecovery"]!,
  );
  const inRecovery: boolean = (recovery[0] || {})["in_recovery"] === true;

  const slotColumns: Array<OutputColumn> = [
    { key: "slot_name", header: "slot" },
    { key: "slot_type", header: "type" },
    { key: "database" },
    { key: "active" },
    { key: "active_pid" },
    { key: "restart_lsn" },
    { key: "retained_wal", header: "retained_wal" },
  ];
  const withRetained: (rows: Array<SqlRow>) => Array<SqlRow> = (
    rows: Array<SqlRow>,
  ): Array<SqlRow> => {
    return rows.map((row: SqlRow): SqlRow => {
      return { ...row, retained_wal: formatBytes(row["retained_wal_bytes"]) };
    });
  };

  if (!inRecovery) {
    const replicas: Array<SqlRow> = await connection.query(
      POSTGRES_SQL["primaryReplicas"]!,
    );
    const slots: Array<SqlRow> = await connection.query(
      POSTGRES_SQL["primarySlots"]!,
    );

    return ok([
      {
        kind: "fields",
        fields: [{ name: "role", value: "primary (not in recovery)" }],
      },
      {
        kind: "table",
        title: "Replicas streaming from this server (pg_stat_replication)",
        columns: [
          { key: "pid" },
          { key: "application_name", header: "application" },
          { key: "client_addr", header: "client" },
          { key: "state" },
          { key: "sync_state" },
          { key: "sent_lsn" },
          { key: "replay_lsn" },
          { key: "replay_lag_bytes" },
          { key: "write_lag" },
          { key: "flush_lag" },
          { key: "replay_lag" },
        ],
        rows: replicas,
        emptyText: "No replica is connected.",
      },
      {
        kind: "table",
        title: "Replication slots",
        columns: slotColumns,
        rows: withRetained(slots),
        emptyText: "No replication slots.",
      },
    ]);
  }

  const status: Array<SqlRow> = await connection.query(
    POSTGRES_SQL["standbyStatus"]!,
  );
  const receiver: Array<SqlRow> = await connection.query(
    POSTGRES_SQL["standbyReceiver"]!,
  );
  const slots: Array<SqlRow> = await connection.query(
    POSTGRES_SQL["standbySlots"]!,
  );
  const row: SqlRow = status[0] || {};

  return ok([
    {
      kind: "fields",
      fields: [
        { name: "role", value: "standby (in recovery)" },
        { name: "receive_lsn", value: row["receive_lsn"] },
        { name: "replay_lsn", value: row["replay_lsn"] },
        { name: "last_replayed_at", value: row["last_replayed_at"] },
        { name: "replay_delay_seconds", value: row["replay_delay_seconds"] },
        { name: "replay_paused", value: row["replay_paused"] },
      ],
    },
    {
      kind: "table",
      title: "WAL receiver (pg_stat_wal_receiver)",
      columns: [
        { key: "status" },
        { key: "sender_host" },
        { key: "sender_port" },
        { key: "slot_name", header: "slot" },
        { key: "latest_end_lsn" },
        { key: "latest_end_time" },
        { key: "last_msg_receipt_time" },
      ],
      rows: receiver,
      emptyText:
        "No WAL receiver is running: this standby is not streaming (it may be restoring from an archive).",
    },
    {
      kind: "table",
      title: "Replication slots",
      columns: slotColumns,
      rows: withRetained(slots),
      emptyText: "No replication slots.",
    },
  ]);
}

async function runTopStatements(
  connection: SqlConnection,
  limit: number,
): Promise<DiagnosticOutcome> {
  const current: Array<SqlRow> = await connection.query(
    POSTGRES_SQL["currentDatabase"]!,
  );
  const database: string = String((current[0] || {})["database_name"] ?? "");
  const extension: Array<SqlRow> = await connection.query(
    POSTGRES_SQL["statementsExtension"]!,
  );
  const schema: unknown = (extension[0] || {})["schema_name"];

  if (typeof schema !== "string" || !schema) {
    return ok([
      {
        kind: "note",
        text: `pg_stat_statements is not installed in database ${database}, so there are no statement statistics to read. To collect them, add pg_stat_statements to shared_preload_libraries (a restart), then run CREATE EXTENSION pg_stat_statements; in ${database}.`,
      },
    ]);
  }

  const version: Array<SqlRow> = await connection.query(
    POSTGRES_SQL["serverVersionNum"]!,
  );
  const serverVersionNum: number =
    toNumber((version[0] || {})["server_version_num"]) || 0;

  let rows: Array<SqlRow>;

  try {
    rows = await connection.query(
      buildTopStatementsSql({ schema, serverVersionNum }),
      [limit + 1],
    );
  } catch (err: unknown) {
    // 55000: the extension exists but its library was never loaded.
    if (errorCode(err) === "55000") {
      return failed(
        `pg_stat_statements is installed in database ${database} but not loaded: add it to shared_preload_libraries and restart PostgreSQL (${errorMessage(err)}).`,
      );
    }

    throw err;
  }

  const limited: { rows: Array<SqlRow>; note: OutputSection | null } =
    limitRows(
      rows,
      limit,
      `Raise --limit (at most ${DATABASE_MAX_ROW_LIMIT}).`,
    );

  return ok([
    {
      kind: "table",
      title: "Statements by total execution time (pg_stat_statements)",
      columns: [
        { key: "query_id" },
        { key: "user_name", header: "user" },
        { key: "database_name", header: "database" },
        { key: "calls" },
        { key: "total_ms" },
        { key: "mean_ms" },
        { key: "rows" },
        { key: "shared_blks_hit", header: "blks_hit" },
        { key: "shared_blks_read", header: "blks_read" },
        { key: "query", kind: "query" },
      ],
      rows: limited.rows,
      emptyText: "pg_stat_statements has no statements yet.",
    },
    ...(limited.note ? [limited.note] : []),
  ]);
}

function maskSettingValue(name: unknown, value: unknown): unknown {
  return typeof name === "string" &&
    CONNINFO_SETTING_PATTERN.test(name) &&
    value
    ? MASKED_CONNINFO
    : value;
}

async function runSettings(
  connection: SqlConnection,
  name: string | null,
): Promise<DiagnosticOutcome> {
  if (name !== null) {
    const rows: Array<SqlRow> = await connection.query(
      POSTGRES_SQL["settingByName"]!,
      [name],
    );
    const row: SqlRow | undefined = rows.find((candidate: SqlRow): boolean => {
      return !isDatabaseCredentialSettingName(candidate["name"]);
    });

    if (!row) {
      return failed(
        `PostgreSQL has no setting named "${name}" (SHOW ALL lists them; db settings with no name prints every one).`,
      );
    }

    return ok([
      {
        kind: "fields",
        fields: [
          { name: "name", value: row["name"] },
          {
            name: "setting",
            value: maskSettingValue(row["name"], row["setting"]),
          },
          { name: "unit", value: row["unit"] },
          { name: "source", value: row["source"] },
          {
            name: "boot_val",
            value: maskSettingValue(row["name"], row["boot_val"]),
          },
          {
            name: "reset_val",
            value: maskSettingValue(row["name"], row["reset_val"]),
          },
          { name: "pending_restart", value: row["pending_restart"] },
          { name: "context", value: row["context"] },
          { name: "description", value: row["short_desc"] },
        ],
      },
    ]);
  }

  const rows: Array<SqlRow> = await connection.query(
    POSTGRES_SQL["allSettings"]!,
  );
  const shown: Array<SqlRow> = rows
    .filter((row: SqlRow): boolean => {
      return !isDatabaseCredentialSettingName(row["name"]);
    })
    .map((row: SqlRow): SqlRow => {
      return { ...row, setting: maskSettingValue(row["name"], row["setting"]) };
    });

  return ok([
    {
      kind: "table",
      columns: [
        { key: "name" },
        { key: "unit" },
        { key: "source" },
        { key: "setting" },
      ],
      rows: shown,
    },
    {
      kind: "note",
      text: `${rows.length - shown.length} credential setting(s) are not shown.`,
    },
  ]);
}

// ---- Writes ---------------------------------------------------------------------------

async function runWrite(
  connection: SqlConnection,
  run: DiagnosticRun,
): Promise<DiagnosticOutcome> {
  const operation: string = run.command.operation.name;
  const isCancel: boolean = operation === "cancel-query";
  const pid: number | null = sessionIdOf(run.command);

  if (pid === null || pid > 2147483647) {
    return refusedByAgent(
      `"${String(run.command.argument)}" is not a PostgreSQL backend pid.`,
    );
  }

  await connection.query(POSTGRES_SQL["setSessionTimeouts"]!, [
    String(run.statementTimeoutMs),
    String(run.lockTimeoutMs),
  ]);

  const own: Array<SqlRow> = await connection.query(POSTGRES_SQL["ownPid"]!);
  const ownPid: number | null = toNumber((own[0] || {})["pid"]);

  if (ownPid === pid) {
    return refusedByAgent(
      `pid ${pid} is the agent's own connection (session:${pid}); it never signals itself.`,
    );
  }

  const targets: Array<SqlRow> = await connection.query(
    POSTGRES_SQL["sessionByPid"]!,
    [pid],
  );
  const target: SqlRow | undefined = targets[0];

  if (!target) {
    return notRun(
      `PostgreSQL has no session with pid ${pid} (it may have ended already). Run db sessions to see the current ones; nothing was changed.`,
    );
  }

  if (target["application_name"] === DATABASE_AI_AGENT_APPLICATION_NAME) {
    return refusedByAgent(
      `pid ${pid} is another connection of the Database AI agent (${DATABASE_AI_AGENT_APPLICATION_NAME}); it never signals its own sessions.`,
    );
  }

  const backendType: string =
    typeof target["backend_type"] === "string"
      ? target["backend_type"]
      : "client backend";
  const allowed: ReadonlyArray<string> = isCancel
    ? CANCELLABLE_BACKEND_TYPES
    : TERMINABLE_BACKEND_TYPES;

  if (!allowed.includes(backendType)) {
    return refusedByAgent(
      `pid ${pid} is a PostgreSQL ${backendType} process, not a client session; db ${operation} only ${
        isCancel
          ? "cancels client sessions' (and autovacuum's) statements"
          : "disconnects client sessions"
      }.`,
    );
  }

  if (isCancel && target["state"] !== "active") {
    return notRun(
      `Session ${pid} is ${String(
        target["state"] || "not running a statement",
      )}: there is no running statement to cancel, so nothing was changed.${
        String(target["state"] || "").startsWith("idle in transaction")
          ? ` An idle transaction ends only with its session: db terminate-session ${pid}.`
          : ""
      }`,
    );
  }

  const signalled: Array<SqlRow> = await connection.query(
    isCancel ? POSTGRES_SQL["cancel"]! : POSTGRES_SQL["terminate"]!,
    [pid],
  );
  const wasSignalled: boolean = (signalled[0] || {})["signalled"] === true;

  const targetSection: OutputSection = {
    kind: "fields",
    title: "The session, before",
    fields: [
      { name: "pid", value: target["pid"] },
      { name: "user", value: target["user_name"] },
      { name: "database", value: target["database_name"] },
      { name: "application", value: target["application_name"] },
      { name: "client", value: target["client_addr"] },
      { name: "state", value: target["state"] },
      { name: "query_seconds", value: target["query_seconds"] },
      { name: "query", value: target["query"], kind: "query" },
    ],
  };

  if (!wasSignalled) {
    return failed(
      `PostgreSQL did not signal pid ${pid}: the session ended before the signal arrived, or this login may not signal it.`,
      [targetSection],
    );
  }

  await run.sleep(run.settleMs);

  const after: Array<SqlRow> = await connection.query(
    POSTGRES_SQL["sessionByPid"]!,
    [pid],
  );
  const now: SqlRow | undefined = after[0];

  let afterText: string;

  if (!now) {
    afterText = isCancel
      ? `Session ${pid} is gone (its client disconnected after the cancel).`
      : `Session ${pid} is gone.`;
  } else if (isCancel) {
    afterText = `Session ${pid} is now ${String(now["state"] || "unknown")}${
      now["state"] === "active"
        ? " (it may still be finishing the cancel, or already running its next statement)"
        : ""
    }.`;
  } else {
    afterText = `Session ${pid} is still listed (${String(
      now["state"] || "unknown",
    )}); PostgreSQL may take a moment to end it.`;
  }

  return ok([
    {
      kind: "note",
      text: isCancel
        ? `Cancelled the running statement of session ${pid} (pg_cancel_backend). The session stays connected.`
        : `Terminated session ${pid} (pg_terminate_backend): its open transaction is rolled back and its client must reconnect.`,
    },
    targetSection,
    { kind: "note", text: afterText },
  ]);
}

export async function runPostgresDiagnostic(
  connection: SqlConnection,
  run: DiagnosticRun,
): Promise<DiagnosticOutcome> {
  const operation: string = run.command.operation.name;

  if (operation === "cancel-query" || operation === "terminate-session") {
    return runWrite(connection, run);
  }

  await connection.query(POSTGRES_SQL["beginReadOnly"]!);

  try {
    await connection.query(POSTGRES_SQL["setLocalTimeouts"]!, [
      String(run.statementTimeoutMs),
      String(run.lockTimeoutMs),
    ]);

    return await runRead(connection, run);
  } finally {
    await connection.query(POSTGRES_SQL["rollback"]!).catch(noop);
  }
}

export async function probePostgres(
  connection: SqlConnection,
): Promise<EngineProbe> {
  const rows: Array<SqlRow> = await connection.query(POSTGRES_SQL["probe"]!);
  const row: SqlRow = rows[0] || {};
  const version: string =
    typeof row["server_version"] === "string"
      ? row["server_version"].split(" ")[0] || ""
      : "";

  return {
    toolVersion: version ? `PostgreSQL ${version}` : "PostgreSQL",
    details: {
      serverVersion: version || null,
      inRecovery: row["in_recovery"] === true,
    },
  };
}

// SQLSTATE -> what an operator should change.
export function describePostgresError(
  err: unknown,
  data: { username: string; credentialSource: string; database: string },
): string | null {
  const code: string | null = errorCode(err);
  const message: string = errorMessage(err);

  switch (code) {
    case "28P01":
    case "28000":
      return `PostgreSQL refused the login "${data.username}" (${message}). Check ${data.credentialSource}, and that pg_hba.conf lets this user connect from the agent's address.`;
    case "3D000":
      return `PostgreSQL has no database "${data.database}" (${message}). Set ONEUPTIME_AI_DATABASE_NAME to a database the login may connect to (postgres by default).`;
    case "42501":
      return `The login "${data.username}" lacks a privilege this needs (${message}). Grant it pg_monitor for reads, and pg_signal_backend to cancel queries or end sessions.`;
    case "57014":
      return `PostgreSQL cancelled the statement: it ran longer than the command's time budget (${message}).`;
    case "55P03":
      return `The statement waited too long for a lock and was stopped (${message}).`;
    case "53300":
      return `PostgreSQL has no free connection slot (${message}): max_connections is reached, which is itself worth investigating.`;
    case "57P03":
      return `PostgreSQL is not accepting connections yet (${message}): it is starting up, shutting down or in recovery.`;
    case "42P01":
    case "42883":
    case "42703":
      return `This PostgreSQL version lacks something the diagnostic reads (${message}). The Database AI agent supports PostgreSQL 11 and later.`;
    default:
      return null;
  }
}
