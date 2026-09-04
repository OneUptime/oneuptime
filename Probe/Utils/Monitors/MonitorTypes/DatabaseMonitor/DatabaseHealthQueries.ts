import { DatabaseMetricGroup } from "Common/Types/Monitor/DatabaseMetricCatalog";
import MonitorMetricType from "Common/Types/Monitor/MonitorMetricType";
import SqlDatabaseType from "Common/Types/Monitor/SqlDatabaseType";

/*
 * The built-in catalog queries behind the Database Health monitor.
 *
 * EVERY statement in this file has been executed against a real server -
 * PostgreSQL 15.18, MySQL 8.4.11 and SQL Server 2022 (16.0.4265.3) - and its
 * output column names checked against the mapping below. That matters more
 * than it sounds: catalog SQL is exactly the kind of code that looks right
 * and is not. Three examples this validation actually caught, all of which
 * would otherwise have shipped:
 *
 *   - PostgreSQL: FILTER attaches to the AGGREGATE, not to the expression
 *     wrapping it. `EXTRACT(EPOCH FROM max(x)) FILTER (WHERE ...)` is a
 *     syntax error; `EXTRACT(EPOCH FROM max(x) FILTER (WHERE ...))` is not.
 *   - MySQL: there is no deadlock counter at all in stock MySQL, so the
 *     obvious `Innodb_deadlocks` status variable does not exist.
 *   - SQL Server: counting active requests by `session_id > 50` counts
 *     background tasks (42 on a freshly started, idle server). Joining
 *     dm_exec_sessions on is_user_process = 1 gives the 0 you expect.
 *
 * When you add or change a statement here, run it against a live server of
 * that engine before committing. The unit tests assert the SHAPE of this
 * table - they cannot tell you that a column name is wrong.
 */

/*
 * How a returned column becomes a metric. `column` is matched
 * case-insensitively because engines disagree about case (SHOW REPLICA
 * STATUS returns Seconds_Behind_Source, information_schema returns
 * upper-case, PostgreSQL lower-cases everything unquoted).
 */
export interface DatabaseQueryColumnMapping {
  column: string;
  metricType: MonitorMetricType;
  /*
   * Applied to the raw numeric value before it is recorded. Used where the
   * engine's unit differs from the series' unit - SQL Server reports queue
   * sizes in KB, we record bytes.
   */
  multiplier?: number | undefined;
}

export interface DatabaseHealthQuery {
  // Stable identifier, used in logs and in the unavailable-group message.
  id: string;
  /*
   * PostgreSQL only. Marks a query that reads pg_stat_activity or pg_locks,
   * which SILENTLY return only the caller's own rows without pg_monitor -
   * no error, just wrong numbers. The collector refuses to run these unless
   * the probe query proved the role has stats access.
   */
  requiresPostgresStatsAccess?: boolean | undefined;
  group: DatabaseMetricGroup;
  sql: string;
  columnMappings: Array<DatabaseQueryColumnMapping>;
  /*
   * The grant that fixes a permission failure on this query, shown verbatim
   * to the operator. Absent when the query needs no special grant.
   */
  remediation?: string | undefined;
  /*
   * Version gate, compared against the engine's numeric server version
   * (PostgreSQL server_version_num, e.g. 150018). A query outside the range
   * is skipped silently rather than run and failed - the checkpoint counters
   * legitimately live in a different view on PostgreSQL 17.
   */
  minServerVersionNum?: number | undefined;
  maxServerVersionNum?: number | undefined;
  /*
   * PostgreSQL only. `true` runs the query only on a primary, `false` only
   * on a standby. pg_current_wal_lsn() raises an error during recovery, so
   * this is a correctness gate, not an optimization.
   */
  runOnlyWhenInRecovery?: boolean | undefined;
}

/*
 * PostgreSQL. Requires no more than CONNECT plus the pg_monitor role (or
 * pg_read_all_stats) to see other sessions' rows - without it pg_stat_activity
 * shows only the monitoring session's own row, so counts read as 1 rather than
 * failing. That is the one degradation mode that is silent rather than loud,
 * which is why the connection group's remediation names the role explicitly.
 */
const postgresQueries: Array<DatabaseHealthQuery> = [
  {
    id: "pg-connections",
    requiresPostgresStatsAccess: true,
    group: DatabaseMetricGroup.Connections,
    sql: `SELECT
  (SELECT count(*) FROM pg_stat_activity WHERE backend_type = 'client backend')::bigint AS connections_total,
  (SELECT count(*) FROM pg_stat_activity WHERE state = 'active')::bigint AS connections_active,
  (SELECT count(*) FROM pg_stat_activity WHERE state = 'idle in transaction')::bigint AS connections_idle_in_transaction,
  (SELECT setting::bigint FROM pg_settings WHERE name = 'max_connections') AS connections_max,
  EXTRACT(EPOCH FROM (now() - pg_postmaster_start_time()))::float8 AS uptime_seconds`,
    columnMappings: [
      {
        column: "connections_total",
        metricType: MonitorMetricType.DatabaseConnectionsTotal,
      },
      {
        column: "connections_active",
        metricType: MonitorMetricType.DatabaseConnectionsActive,
      },
      {
        column: "connections_idle_in_transaction",
        metricType: MonitorMetricType.DatabaseConnectionsIdleInTransaction,
      },
      {
        column: "connections_max",
        metricType: MonitorMetricType.DatabaseConnectionsMax,
      },
      {
        column: "uptime_seconds",
        metricType: MonitorMetricType.DatabaseUptimeSeconds,
      },
    ],
    remediation:
      "GRANT pg_monitor TO <monitoring_user>; -- without it pg_stat_activity shows only this session and connection counts read as 1",
  },
  {
    id: "pg-activity-age",
    requiresPostgresStatsAccess: true,
    group: DatabaseMetricGroup.Activity,
    sql: `SELECT
  COALESCE(EXTRACT(EPOCH FROM max(now() - query_start) FILTER (WHERE state = 'active')), 0)::float8 AS longest_query_seconds,
  COALESCE(EXTRACT(EPOCH FROM max(now() - xact_start)), 0)::float8 AS longest_transaction_seconds
FROM pg_stat_activity
WHERE backend_type = 'client backend' AND pid <> pg_backend_pid()`,
    columnMappings: [
      {
        column: "longest_query_seconds",
        metricType: MonitorMetricType.DatabaseLongestQuerySeconds,
      },
      {
        column: "longest_transaction_seconds",
        metricType: MonitorMetricType.DatabaseLongestTransactionSeconds,
      },
    ],
    remediation: "GRANT pg_monitor TO <monitoring_user>;",
  },
  {
    /*
     * Split by GROUP, not by convenience. pg_stat_database could serve
     * throughput, storage and deadlocks in one round trip, but a query's
     * group is what an operator disables - so a metric must be produced by
     * the group the catalog files it under, or turning off "Throughput"
     * would silently take database size with it.
     */
    id: "pg-database-stats",
    group: DatabaseMetricGroup.Throughput,
    sql: `SELECT
  xact_commit::bigint,
  xact_rollback::bigint,
  blks_read::bigint,
  blks_hit::bigint,
  blk_read_time::float8,
  blk_write_time::float8
FROM pg_stat_database WHERE datname = current_database()`,
    columnMappings: [
      {
        column: "blks_read",
        metricType: MonitorMetricType.DatabaseDiskReadsTotal,
      },
      {
        column: "blk_read_time",
        metricType: MonitorMetricType.DatabaseIoReadTimeMs,
      },
      {
        column: "blk_write_time",
        metricType: MonitorMetricType.DatabaseIoWriteTimeMs,
      },
    ],
  },
  {
    id: "pg-storage",
    group: DatabaseMetricGroup.Storage,
    sql: `SELECT
  pg_database_size(current_database())::bigint AS database_size_bytes,
  (SELECT temp_bytes FROM pg_stat_database WHERE datname = current_database())::bigint AS temp_bytes`,
    columnMappings: [
      {
        column: "database_size_bytes",
        metricType: MonitorMetricType.DatabaseSizeBytes,
      },
      {
        column: "temp_bytes",
        metricType: MonitorMetricType.DatabaseTempBytesTotal,
      },
    ],
  },
  {
    id: "pg-locks",
    requiresPostgresStatsAccess: true,
    group: DatabaseMetricGroup.Locks,
    sql: `SELECT
  (SELECT count(*) FROM pg_locks WHERE NOT granted)::bigint AS locks_waiting,
  (SELECT count(*) FROM pg_stat_activity WHERE cardinality(pg_blocking_pids(pid)) > 0)::bigint AS blocked_sessions,
  (SELECT deadlocks FROM pg_stat_database WHERE datname = current_database())::bigint AS deadlocks_total`,
    columnMappings: [
      {
        column: "locks_waiting",
        metricType: MonitorMetricType.DatabaseLocksWaiting,
      },
      {
        column: "blocked_sessions",
        metricType: MonitorMetricType.DatabaseSessionsBlocked,
      },
      {
        column: "deadlocks_total",
        metricType: MonitorMetricType.DatabaseDeadlocksTotal,
      },
    ],
    remediation: "GRANT pg_monitor TO <monitoring_user>;",
  },
  {
    id: "pg-replication-primary",
    group: DatabaseMetricGroup.Replication,
    sql: `SELECT
  count(*)::bigint AS replica_count,
  COALESCE(max(pg_wal_lsn_diff(sent_lsn, replay_lsn)), 0)::float8 AS replication_lag_bytes,
  COALESCE(max(EXTRACT(EPOCH FROM replay_lag)), 0)::float8 AS replication_lag_seconds
FROM pg_stat_replication`,
    columnMappings: [
      {
        column: "replica_count",
        metricType: MonitorMetricType.DatabaseReplicaCount,
      },
      {
        column: "replication_lag_bytes",
        metricType: MonitorMetricType.DatabaseReplicationLagBytes,
      },
      {
        column: "replication_lag_seconds",
        metricType: MonitorMetricType.DatabaseReplicationLagSeconds,
      },
    ],
    runOnlyWhenInRecovery: false,
    remediation: "GRANT pg_monitor TO <monitoring_user>;",
  },
  {
    id: "pg-replication-standby",
    group: DatabaseMetricGroup.Replication,
    sql: `SELECT
  1::bigint AS is_in_recovery,
  COALESCE(EXTRACT(EPOCH FROM now() - pg_last_xact_replay_timestamp()), 0)::float8 AS replication_lag_seconds`,
    columnMappings: [
      {
        column: "is_in_recovery",
        metricType: MonitorMetricType.DatabaseIsInRecovery,
      },
      {
        column: "replication_lag_seconds",
        metricType: MonitorMetricType.DatabaseReplicationLagSeconds,
      },
    ],
    runOnlyWhenInRecovery: true,
  },
  {
    id: "pg-replication-slots",
    group: DatabaseMetricGroup.Replication,
    sql: `SELECT count(*) FILTER (WHERE NOT active)::bigint AS inactive_slots
FROM pg_replication_slots`,
    columnMappings: [
      {
        column: "inactive_slots",
        metricType: MonitorMetricType.DatabaseReplicationSlotsInactive,
      },
    ],
    remediation: "GRANT pg_monitor TO <monitoring_user>;",
  },
  {
    id: "pg-wraparound",
    group: DatabaseMetricGroup.Maintenance,
    sql: `SELECT (max(age(datfrozenxid))::float8 / 2147483648.0 * 100.0)::float8 AS transaction_id_used_percent
FROM pg_database`,
    columnMappings: [
      {
        column: "transaction_id_used_percent",
        metricType: MonitorMetricType.DatabaseTransactionIdUsedPercent,
      },
    ],
  },
  {
    id: "pg-vacuum",
    group: DatabaseMetricGroup.Maintenance,
    sql: `SELECT
  COALESCE(sum(n_dead_tup), 0)::bigint AS dead_tuples,
  count(*) FILTER (WHERE last_autovacuum IS NULL AND n_dead_tup > 0)::bigint AS tables_never_autovacuumed
FROM pg_stat_user_tables`,
    columnMappings: [
      {
        column: "dead_tuples",
        metricType: MonitorMetricType.DatabaseDeadTuples,
      },
      {
        column: "tables_never_autovacuumed",
        metricType: MonitorMetricType.DatabaseTablesNeverAutovacuumed,
      },
    ],
  },
  {
    /*
     * Checkpoint counters live in pg_stat_bgwriter up to and including
     * PostgreSQL 16. PostgreSQL 17 moved them to pg_stat_checkpointer and
     * renamed them, so each variant is version-gated and the other is
     * skipped rather than run and reported as a failure.
     */
    id: "pg-checkpoints-legacy",
    group: DatabaseMetricGroup.Maintenance,
    sql: `SELECT checkpoints_timed::bigint, checkpoints_req::bigint FROM pg_stat_bgwriter`,
    columnMappings: [
      {
        column: "checkpoints_timed",
        metricType: MonitorMetricType.DatabaseCheckpointsTimedTotal,
      },
      {
        column: "checkpoints_req",
        metricType: MonitorMetricType.DatabaseCheckpointsRequestedTotal,
      },
    ],
    maxServerVersionNum: 169999,
  },
  {
    id: "pg-checkpoints-modern",
    group: DatabaseMetricGroup.Maintenance,
    sql: `SELECT num_timed::bigint AS checkpoints_timed, num_requested::bigint AS checkpoints_req FROM pg_stat_checkpointer`,
    columnMappings: [
      {
        column: "checkpoints_timed",
        metricType: MonitorMetricType.DatabaseCheckpointsTimedTotal,
      },
      {
        column: "checkpoints_req",
        metricType: MonitorMetricType.DatabaseCheckpointsRequestedTotal,
      },
    ],
    minServerVersionNum: 170000,
  },
];

/*
 * MySQL. The status pivot reads performance_schema.global_status rather than
 * SHOW GLOBAL STATUS so the result arrives as one row of named columns
 * instead of a key/value result set that has to be reshaped client side.
 */
const mySqlQueries: Array<DatabaseHealthQuery> = [
  {
    id: "mysql-status",
    group: DatabaseMetricGroup.Connections,
    sql: `SELECT
  MAX(IF(VARIABLE_NAME='Threads_connected',VARIABLE_VALUE,NULL)) AS connections_total,
  MAX(IF(VARIABLE_NAME='Threads_running',VARIABLE_VALUE,NULL)) AS connections_active,
  MAX(IF(VARIABLE_NAME='Aborted_connects',VARIABLE_VALUE,NULL)) AS aborted_connects,
  MAX(IF(VARIABLE_NAME='Uptime',VARIABLE_VALUE,NULL)) AS uptime_seconds
FROM performance_schema.global_status`,
    columnMappings: [
      {
        column: "connections_total",
        metricType: MonitorMetricType.DatabaseConnectionsTotal,
      },
      {
        column: "connections_active",
        metricType: MonitorMetricType.DatabaseConnectionsActive,
      },
      {
        column: "aborted_connects",
        metricType: MonitorMetricType.DatabaseConnectionsAbortedTotal,
      },
      {
        column: "uptime_seconds",
        metricType: MonitorMetricType.DatabaseUptimeSeconds,
      },
    ],
    remediation:
      "performance_schema must be enabled (performance_schema = ON in my.cnf)",
  },
  {
    id: "mysql-max-connections",
    group: DatabaseMetricGroup.Connections,
    sql: `SELECT VARIABLE_VALUE AS connections_max
FROM performance_schema.global_variables WHERE VARIABLE_NAME='max_connections'`,
    columnMappings: [
      {
        column: "connections_max",
        metricType: MonitorMetricType.DatabaseConnectionsMax,
      },
    ],
  },
  {
    id: "mysql-throughput",
    group: DatabaseMetricGroup.Throughput,
    sql: `SELECT
  MAX(IF(VARIABLE_NAME='Queries',VARIABLE_VALUE,NULL)) AS queries_total,
  MAX(IF(VARIABLE_NAME='Slow_queries',VARIABLE_VALUE,NULL)) AS slow_queries_total,
  MAX(IF(VARIABLE_NAME='Innodb_buffer_pool_read_requests',VARIABLE_VALUE,NULL)) AS bp_read_requests,
  MAX(IF(VARIABLE_NAME='Innodb_buffer_pool_reads',VARIABLE_VALUE,NULL)) AS bp_disk_reads,
  MAX(IF(VARIABLE_NAME='Innodb_data_reads',VARIABLE_VALUE,NULL)) AS disk_reads_total,
  MAX(IF(VARIABLE_NAME='Innodb_data_writes',VARIABLE_VALUE,NULL)) AS disk_writes_total
FROM performance_schema.global_status`,
    columnMappings: [
      {
        column: "queries_total",
        metricType: MonitorMetricType.DatabaseQueriesTotal,
      },
      {
        column: "slow_queries_total",
        metricType: MonitorMetricType.DatabaseSlowQueriesTotal,
      },
      {
        column: "disk_reads_total",
        metricType: MonitorMetricType.DatabaseDiskReadsTotal,
      },
      {
        column: "disk_writes_total",
        metricType: MonitorMetricType.DatabaseDiskWritesTotal,
      },
    ],
  },
  {
    id: "mysql-locks",
    group: DatabaseMetricGroup.Locks,
    sql: `SELECT
  MAX(IF(VARIABLE_NAME='Innodb_row_lock_current_waits',VARIABLE_VALUE,NULL)) AS locks_waiting,
  MAX(IF(VARIABLE_NAME='Table_locks_waited',VARIABLE_VALUE,NULL)) AS table_locks_waited_total
FROM performance_schema.global_status`,
    columnMappings: [
      {
        column: "locks_waiting",
        metricType: MonitorMetricType.DatabaseLocksWaiting,
      },
      {
        column: "table_locks_waited_total",
        metricType: MonitorMetricType.DatabaseTableLocksWaitedTotal,
      },
    ],
  },
  {
    id: "mysql-blocked",
    group: DatabaseMetricGroup.Locks,
    sql: `SELECT COUNT(*) AS blocked_sessions FROM performance_schema.data_lock_waits`,
    columnMappings: [
      {
        column: "blocked_sessions",
        metricType: MonitorMetricType.DatabaseSessionsBlocked,
      },
    ],
    remediation:
      "performance_schema must be enabled, and the monitoring user needs SELECT on performance_schema.*",
  },
  {
    id: "mysql-transactions",
    group: DatabaseMetricGroup.Activity,
    sql: `SELECT
  COUNT(*) AS open_transactions,
  COALESCE(MAX(TIMESTAMPDIFF(SECOND, trx_started, NOW())), 0) AS longest_transaction_seconds,
  COALESCE(MAX(TIMESTAMPDIFF(SECOND, trx_started, NOW())), 0) AS longest_query_seconds
FROM information_schema.INNODB_TRX`,
    columnMappings: [
      {
        column: "open_transactions",
        metricType: MonitorMetricType.DatabaseOpenTransactions,
      },
      {
        column: "longest_transaction_seconds",
        metricType: MonitorMetricType.DatabaseLongestTransactionSeconds,
      },
      {
        column: "longest_query_seconds",
        metricType: MonitorMetricType.DatabaseLongestQuerySeconds,
      },
    ],
    remediation: "GRANT PROCESS ON *.* TO '<monitoring_user>'@'%';",
  },
  {
    /*
     * SHOW REPLICA STATUS rather than a performance_schema view because it
     * is the only place MySQL exposes Seconds_Behind_Source, the number
     * operators actually alert on. On a server that is not a replica it
     * returns ZERO ROWS rather than an error (verified on 8.4.11), so the
     * group counts as collected and simply contributes nothing.
     *
     * MySQL below 8.0.22 spells this SHOW SLAVE STATUS; there the statement
     * fails and the group is reported as NotSupportedByEngine rather than
     * silently producing nothing.
     */
    id: "mysql-replication",
    group: DatabaseMetricGroup.Replication,
    sql: `SHOW REPLICA STATUS`,
    columnMappings: [
      {
        column: "Seconds_Behind_Source",
        metricType: MonitorMetricType.DatabaseReplicationLagSeconds,
      },
    ],
    remediation: "GRANT REPLICATION CLIENT ON *.* TO '<monitoring_user>'@'%';",
  },
  {
    id: "mysql-storage",
    group: DatabaseMetricGroup.Storage,
    /*
     * Scoped to DATABASE() - the database the monitor was configured with -
     * rather than every non-system schema. Summing the whole server would
     * report a number that does not match the monitor's own name, and would
     * move when an unrelated schema grew.
     */
    sql: `SELECT
  (SELECT COALESCE(SUM(data_length + index_length), 0)
     FROM information_schema.TABLES
    WHERE table_schema = DATABASE()) AS database_size_bytes,
  (SELECT VARIABLE_VALUE FROM performance_schema.global_status
    WHERE VARIABLE_NAME = 'Created_tmp_disk_tables') AS temp_disk_tables_total`,
    columnMappings: [
      {
        column: "database_size_bytes",
        metricType: MonitorMetricType.DatabaseSizeBytes,
      },
      {
        column: "temp_disk_tables_total",
        metricType: MonitorMetricType.DatabaseTempDiskTablesTotal,
      },
    ],
  },
];

/*
 * Microsoft SQL Server. Everything here needs VIEW SERVER STATE except the
 * per-database storage and log queries, which is why they are in their own
 * group - a login without VIEW SERVER STATE still gets size and log space.
 */
const sqlServerQueries: Array<DatabaseHealthQuery> = [
  {
    id: "mssql-sessions",
    group: DatabaseMetricGroup.Connections,
    sql: `SELECT
 (SELECT COUNT(*) FROM sys.dm_exec_sessions WHERE is_user_process = 1) AS connections_total,
 (SELECT COUNT(*) FROM sys.dm_exec_requests r
    JOIN sys.dm_exec_sessions s ON r.session_id = s.session_id
   WHERE s.is_user_process = 1 AND r.session_id <> @@SPID) AS connections_active,
 (SELECT DATEDIFF(SECOND, sqlserver_start_time, GETDATE()) FROM sys.dm_os_sys_info) AS uptime_seconds`,
    columnMappings: [
      {
        column: "connections_total",
        metricType: MonitorMetricType.DatabaseConnectionsTotal,
      },
      {
        column: "connections_active",
        metricType: MonitorMetricType.DatabaseConnectionsActive,
      },
      {
        column: "uptime_seconds",
        metricType: MonitorMetricType.DatabaseUptimeSeconds,
      },
    ],
    remediation: "GRANT VIEW SERVER STATE TO [<monitoring_login>];",
  },
  {
    id: "mssql-activity",
    group: DatabaseMetricGroup.Activity,
    sql: `SELECT
 (SELECT ISNULL(MAX(DATEDIFF(SECOND, r.start_time, GETDATE())), 0)
    FROM sys.dm_exec_requests r
    JOIN sys.dm_exec_sessions s ON r.session_id = s.session_id
   WHERE s.is_user_process = 1 AND r.session_id <> @@SPID) AS longest_query_seconds,
 (SELECT ISNULL(MAX(DATEDIFF(SECOND, t.transaction_begin_time, GETDATE())), 0)
    FROM sys.dm_tran_active_transactions t
    JOIN sys.dm_tran_session_transactions st ON t.transaction_id = st.transaction_id) AS longest_transaction_seconds`,
    columnMappings: [
      {
        column: "longest_query_seconds",
        metricType: MonitorMetricType.DatabaseLongestQuerySeconds,
      },
      {
        column: "longest_transaction_seconds",
        metricType: MonitorMetricType.DatabaseLongestTransactionSeconds,
      },
    ],
    remediation: "GRANT VIEW SERVER STATE TO [<monitoring_login>];",
  },
  {
    /*
     * counter_name and instance_name are space-padded CHAR columns, so every
     * comparison has to RTRIM. Buffer cache hit ratio is a raw pair - the
     * ratio is only meaningful divided by its base counter, which the
     * collector derives.
     */
    id: "mssql-perf-counters",
    group: DatabaseMetricGroup.Throughput,
    sql: `SELECT
 MAX(CASE WHEN RTRIM(counter_name)='Page life expectancy' THEN cntr_value END) AS page_life_expectancy,
 MAX(CASE WHEN RTRIM(counter_name)='Batch Requests/sec' THEN cntr_value END) AS queries_total,
 MAX(CASE WHEN RTRIM(counter_name)='Buffer cache hit ratio' THEN cntr_value END) AS buffer_cache_hit_ratio_raw,
 MAX(CASE WHEN RTRIM(counter_name)='Buffer cache hit ratio base' THEN cntr_value END) AS buffer_cache_hit_ratio_base,
 MAX(CASE WHEN RTRIM(counter_name)='Transactions/sec' AND RTRIM(instance_name)='_Total' THEN cntr_value END) AS transactions_total,
 MAX(CASE WHEN RTRIM(counter_name)='Memory Grants Pending' THEN cntr_value END) AS memory_grants_pending
FROM sys.dm_os_performance_counters`,
    columnMappings: [
      {
        column: "page_life_expectancy",
        metricType: MonitorMetricType.DatabasePageLifeExpectancySeconds,
      },
      {
        column: "queries_total",
        metricType: MonitorMetricType.DatabaseQueriesTotal,
      },
      {
        column: "transactions_total",
        metricType: MonitorMetricType.DatabaseTransactionsTotal,
      },
      {
        column: "memory_grants_pending",
        metricType: MonitorMetricType.DatabaseMemoryGrantsPending,
      },
    ],
    remediation: "GRANT VIEW SERVER STATE TO [<monitoring_login>];",
  },
  {
    /*
     * Lock waits comes from dm_os_waiting_tasks, NOT from the "Lock
     * Waits/sec" performance counter. That counter is cumulative since
     * server start, so charting it as the gauge that PostgreSQL and MySQL
     * report would show a number that only ever climbs - on an idle test
     * server it already read 26 while nothing was waiting at all.
     */
    id: "mssql-blocking",
    group: DatabaseMetricGroup.Locks,
    sql: `SELECT
 (SELECT COUNT(*) FROM sys.dm_exec_requests WHERE blocking_session_id <> 0) AS blocked_sessions,
 (SELECT COUNT(*) FROM sys.dm_os_waiting_tasks WHERE blocking_session_id IS NOT NULL) AS locks_waiting,
 (SELECT MAX(CASE WHEN RTRIM(counter_name)='Number of Deadlocks/sec' AND RTRIM(instance_name)='_Total' THEN cntr_value END)
    FROM sys.dm_os_performance_counters) AS deadlocks_total`,
    columnMappings: [
      {
        column: "blocked_sessions",
        metricType: MonitorMetricType.DatabaseSessionsBlocked,
      },
      {
        column: "locks_waiting",
        metricType: MonitorMetricType.DatabaseLocksWaiting,
      },
      {
        column: "deadlocks_total",
        metricType: MonitorMetricType.DatabaseDeadlocksTotal,
      },
    ],
    remediation: "GRANT VIEW SERVER STATE TO [<monitoring_login>];",
  },
  {
    id: "mssql-io",
    group: DatabaseMetricGroup.Throughput,
    sql: `SELECT
 SUM(io_stall_read_ms) AS io_read_time_ms,
 SUM(io_stall_write_ms) AS io_write_time_ms,
 SUM(num_of_reads) AS disk_reads_total,
 SUM(num_of_writes) AS disk_writes_total
FROM sys.dm_io_virtual_file_stats(NULL, NULL)`,
    columnMappings: [
      {
        column: "io_read_time_ms",
        metricType: MonitorMetricType.DatabaseIoReadTimeMs,
      },
      {
        column: "io_write_time_ms",
        metricType: MonitorMetricType.DatabaseIoWriteTimeMs,
      },
      {
        column: "disk_reads_total",
        metricType: MonitorMetricType.DatabaseDiskReadsTotal,
      },
      {
        column: "disk_writes_total",
        metricType: MonitorMetricType.DatabaseDiskWritesTotal,
      },
    ],
    remediation: "GRANT VIEW SERVER STATE TO [<monitoring_login>];",
  },
  {
    id: "mssql-storage",
    group: DatabaseMetricGroup.Storage,
    sql: `SELECT
 (SELECT SUM(CAST(size AS BIGINT)) * 8 * 1024 FROM sys.database_files) AS database_size_bytes,
 (SELECT TOP 1 used_log_space_in_percent FROM sys.dm_db_log_space_usage) AS log_space_used_percent,
 (SELECT SUM(unallocated_extent_page_count) * 8 * 1024 FROM tempdb.sys.dm_db_file_space_usage) AS tempdb_free_bytes`,
    columnMappings: [
      {
        column: "database_size_bytes",
        metricType: MonitorMetricType.DatabaseSizeBytes,
      },
      {
        column: "log_space_used_percent",
        metricType: MonitorMetricType.DatabaseLogSpaceUsedPercent,
      },
      {
        column: "tempdb_free_bytes",
        metricType: MonitorMetricType.DatabaseTempDbFreeBytes,
      },
    ],
  },
  {
    /*
     * Returns a single row of zeroes when no availability group is
     * configured - verified, not assumed - so this needs no gate.
     */
    id: "mssql-replication",
    group: DatabaseMetricGroup.Replication,
    sql: `SELECT
 COUNT(*) AS replica_count,
 ISNULL(MAX(log_send_queue_size), 0) AS log_send_queue_kb,
 ISNULL(MAX(redo_queue_size), 0) AS redo_queue_kb
FROM sys.dm_hadr_database_replica_states`,
    columnMappings: [
      {
        column: "replica_count",
        metricType: MonitorMetricType.DatabaseReplicaCount,
      },
      {
        column: "log_send_queue_kb",
        metricType: MonitorMetricType.DatabaseReplicationLagBytes,
        multiplier: 1024,
      },
    ],
    remediation: "GRANT VIEW SERVER STATE TO [<monitoring_login>];",
  },
];

export function getDatabaseHealthQueries(
  databaseType: SqlDatabaseType,
): Array<DatabaseHealthQuery> {
  switch (databaseType) {
    case SqlDatabaseType.PostgreSQL:
      return postgresQueries;
    case SqlDatabaseType.MySQL:
      return mySqlQueries;
    case SqlDatabaseType.MicrosoftSqlServer:
      return sqlServerQueries;
    default:
      return [];
  }
}

/*
 * The query used to prove the connection works and to time the check. Kept
 * separate from the metric groups on purpose: this is the ONLY statement
 * whose failure can take the monitor offline.
 */
export function getProbeQuery(databaseType: SqlDatabaseType): string {
  switch (databaseType) {
    case SqlDatabaseType.PostgreSQL:
      /*
       * has_stats_access is a PREFLIGHT, not a nicety. Without pg_monitor
       * (or pg_read_all_stats, or superuser) PostgreSQL does not refuse a
       * pg_stat_activity query - it returns only the monitoring session's
       * own backend. Verified on 15.18: the same query returns 1 for an
       * unprivileged role and 3 for a privileged one, with no error either
       * way. A monitor that reports "1 connection" forever and never fires
       * is worse than one that reports nothing, so the collector uses this
       * flag to skip those groups and say why.
       */
      return "SELECT current_setting('server_version_num')::int AS server_version_num, pg_is_in_recovery() AS is_in_recovery, version() AS engine_version, (pg_has_role(current_user,'pg_monitor','member') OR pg_has_role(current_user,'pg_read_all_stats','member') OR COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)) AS has_stats_access";
    case SqlDatabaseType.MySQL:
      return "SELECT VERSION() AS engine_version";
    case SqlDatabaseType.MicrosoftSqlServer:
      return "SELECT CAST(SERVERPROPERTY('ProductVersion') AS NVARCHAR(128)) AS engine_version";
    default:
      return "SELECT 1";
  }
}
