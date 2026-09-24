import AggregationType from "../BaseDatabase/AggregationType";
import { normalizeDatabaseSystem } from "./DatabaseSystem";

/*
 * The curated engine metrics a Database's Overview charts, per engine, from
 * the OpenTelemetry Collector contrib DB receivers. Only metrics the
 * receiver emits BY DEFAULT are listed, so a stock receiver config fills
 * every chart. Names are lowercase, exactly as ingest stores them.
 *
 * `kind` decides how a metric is drawn:
 *   - "gauge" — a value at a point in time (Gauge and non-monotonic
 *     UpDownCounter sums, plus `mysql.uptime`, a monotonic sum whose current
 *     value IS the answer). Charted with `aggregation`; the only kind the
 *     Overview's summary tiles use.
 *   - "counter" — a cumulative monotonic sum (commits, commands processed).
 *     Its raw value only ever grows, so the dashboard charts it as a
 *     per-second rate computed client-side from consecutive buckets. The
 *     `aggregation` is Max: per bucket that is the latest cumulative value
 *     of a single series, which is what a rate is derived from (summing the
 *     samples of a bucket would multiply the value by the scrape count).
 */

export type DatabaseServerMetricKind = "gauge" | "counter";

export interface DatabaseServerMetricDefinition {
  system: string;
  metricName: string;
  title: string;
  description: string;
  unit: string;
  aggregation: AggregationType;
  kind: DatabaseServerMetricKind;
}

export const DATABASE_SERVER_METRICS: ReadonlyArray<DatabaseServerMetricDefinition> =
  [
    // PostgreSQL — postgresqlreceiver (all default-on).
    {
      system: "postgresql",
      metricName: "postgresql.backends",
      title: "Connections",
      description: "Number of open backends (client connections).",
      unit: "connections",
      aggregation: AggregationType.Avg,
      kind: "gauge",
    },
    {
      system: "postgresql",
      metricName: "postgresql.connection.max",
      title: "Max connections",
      description: "The configured max_connections limit.",
      unit: "connections",
      aggregation: AggregationType.Max,
      kind: "gauge",
    },
    {
      system: "postgresql",
      metricName: "postgresql.commits",
      title: "Commits",
      description: "Committed transactions per second.",
      unit: "commits",
      aggregation: AggregationType.Max,
      kind: "counter",
    },
    {
      system: "postgresql",
      metricName: "postgresql.rollbacks",
      title: "Rollbacks",
      description: "Rolled-back transactions per second.",
      unit: "rollbacks",
      aggregation: AggregationType.Max,
      kind: "counter",
    },
    {
      system: "postgresql",
      metricName: "postgresql.db_size",
      title: "Database size",
      description: "Disk space used by the largest database.",
      unit: "bytes",
      aggregation: AggregationType.Max,
      kind: "gauge",
    },
    {
      system: "postgresql",
      metricName: "postgresql.database.count",
      title: "Databases",
      description: "Number of user databases on the server.",
      unit: "databases",
      aggregation: AggregationType.Max,
      kind: "gauge",
    },
    {
      system: "postgresql",
      metricName: "postgresql.replication.data_delay",
      title: "Replication lag",
      description:
        "Bytes of WAL a replica is behind the primary (worst replica).",
      unit: "bytes",
      aggregation: AggregationType.Max,
      kind: "gauge",
    },
    {
      system: "postgresql",
      metricName: "postgresql.wal.age",
      title: "WAL age",
      description: "Age of the oldest WAL file not yet archived or replayed.",
      unit: "s",
      aggregation: AggregationType.Max,
      kind: "gauge",
    },

    // MySQL / MariaDB — mysqlreceiver (default-on subset).
    {
      system: "mysql",
      metricName: "mysql.threads",
      title: "Threads",
      description:
        "Server threads by state (connected, running, cached, created).",
      unit: "threads",
      aggregation: AggregationType.Avg,
      kind: "gauge",
    },
    {
      system: "mysql",
      metricName: "mysql.buffer_pool.usage",
      title: "Buffer pool usage",
      description: "Bytes held in the InnoDB buffer pool.",
      unit: "bytes",
      aggregation: AggregationType.Avg,
      kind: "gauge",
    },
    {
      system: "mysql",
      metricName: "mysql.buffer_pool.limit",
      title: "Buffer pool size",
      description: "The configured InnoDB buffer pool size.",
      unit: "bytes",
      aggregation: AggregationType.Max,
      kind: "gauge",
    },
    {
      system: "mysql",
      metricName: "mysql.handlers",
      title: "Handler operations",
      description: "Internal handler (read / write / commit) calls per second.",
      unit: "operations",
      aggregation: AggregationType.Max,
      kind: "counter",
    },
    {
      system: "mysql",
      metricName: "mysql.row_operations",
      title: "Row operations",
      description:
        "InnoDB rows read, inserted, updated and deleted per second.",
      unit: "rows",
      aggregation: AggregationType.Max,
      kind: "counter",
    },
    {
      system: "mysql",
      metricName: "mysql.row_locks",
      title: "Row lock waits",
      description: "InnoDB row lock waits per second.",
      unit: "waits",
      aggregation: AggregationType.Max,
      kind: "counter",
    },
    {
      system: "mysql",
      metricName: "mysql.uptime",
      title: "Uptime",
      description:
        "Seconds since the server started; a drop means it restarted.",
      unit: "s",
      aggregation: AggregationType.Max,
      kind: "gauge",
    },

    // Redis / Valkey — redisreceiver (all default-on).
    {
      system: "redis",
      metricName: "redis.clients.connected",
      title: "Connected clients",
      description: "Number of client connections.",
      unit: "clients",
      aggregation: AggregationType.Avg,
      kind: "gauge",
    },
    {
      system: "redis",
      metricName: "redis.memory.used",
      title: "Memory used",
      description: "Bytes allocated by Redis.",
      unit: "bytes",
      aggregation: AggregationType.Avg,
      kind: "gauge",
    },
    {
      system: "redis",
      metricName: "redis.memory.fragmentation_ratio",
      title: "Memory fragmentation",
      description: "Ratio of resident memory to memory allocated by Redis.",
      unit: "ratio",
      aggregation: AggregationType.Avg,
      kind: "gauge",
    },
    {
      system: "redis",
      metricName: "redis.commands",
      title: "Commands per second",
      description: "Instantaneous commands processed per second.",
      unit: "ops/s",
      aggregation: AggregationType.Avg,
      kind: "gauge",
    },
    {
      system: "redis",
      metricName: "redis.commands.processed",
      title: "Commands processed",
      description: "Commands processed per second.",
      unit: "commands",
      aggregation: AggregationType.Max,
      kind: "counter",
    },
    {
      system: "redis",
      metricName: "redis.keyspace.hits",
      title: "Keyspace hits",
      description: "Successful key lookups per second.",
      unit: "hits",
      aggregation: AggregationType.Max,
      kind: "counter",
    },
    {
      system: "redis",
      metricName: "redis.keyspace.misses",
      title: "Keyspace misses",
      description: "Failed key lookups per second.",
      unit: "misses",
      aggregation: AggregationType.Max,
      kind: "counter",
    },
    {
      system: "redis",
      metricName: "redis.keys.evicted",
      title: "Evicted keys",
      description: "Keys evicted because of the maxmemory limit, per second.",
      unit: "keys",
      aggregation: AggregationType.Max,
      kind: "counter",
    },

    // MongoDB — mongodbreceiver (all default-on).
    {
      system: "mongodb",
      metricName: "mongodb.connection.count",
      title: "Connections",
      description: "Connections by type (active, available, current).",
      unit: "connections",
      aggregation: AggregationType.Avg,
      kind: "gauge",
    },
    {
      system: "mongodb",
      metricName: "mongodb.memory.usage",
      title: "Memory usage",
      description: "Resident and virtual memory used by mongod.",
      unit: "bytes",
      aggregation: AggregationType.Avg,
      kind: "gauge",
    },
    {
      system: "mongodb",
      metricName: "mongodb.data.size",
      title: "Data size",
      description: "Size of the data stored (largest database).",
      unit: "bytes",
      aggregation: AggregationType.Max,
      kind: "gauge",
    },
    {
      system: "mongodb",
      metricName: "mongodb.cursor.count",
      title: "Open cursors",
      description: "Number of open cursors.",
      unit: "cursors",
      aggregation: AggregationType.Avg,
      kind: "gauge",
    },
    {
      system: "mongodb",
      metricName: "mongodb.operation.count",
      title: "Operations",
      description: "Operations (insert, query, update, …) per second.",
      unit: "operations",
      aggregation: AggregationType.Max,
      kind: "counter",
    },
    {
      system: "mongodb",
      metricName: "mongodb.operation.time",
      title: "Operation time",
      description: "Time spent executing operations, per second.",
      unit: "ms",
      aggregation: AggregationType.Max,
      kind: "counter",
    },
    {
      system: "mongodb",
      metricName: "mongodb.cache.operations",
      title: "Cache operations",
      description: "WiredTiger cache hits and misses per second.",
      unit: "operations",
      aggregation: AggregationType.Max,
      kind: "counter",
    },

    /*
     * SQL Server — sqlserverreceiver (default-on; the *.rate metrics are
     * receiver-computed per-second gauges, not counters).
     */
    {
      system: "microsoft.sql_server",
      metricName: "sqlserver.user.connection.count",
      title: "User connections",
      description: "Number of users connected to the server.",
      unit: "connections",
      aggregation: AggregationType.Avg,
      kind: "gauge",
    },
    {
      system: "microsoft.sql_server",
      metricName: "sqlserver.batch.request.rate",
      title: "Batch requests",
      description: "Transact-SQL batches received per second.",
      unit: "requests/s",
      aggregation: AggregationType.Avg,
      kind: "gauge",
    },
    {
      system: "microsoft.sql_server",
      metricName: "sqlserver.transaction.rate",
      title: "Transactions",
      description: "Transactions started per second.",
      unit: "transactions/s",
      aggregation: AggregationType.Avg,
      kind: "gauge",
    },
    {
      system: "microsoft.sql_server",
      metricName: "sqlserver.page.buffer_cache.hit_ratio",
      title: "Buffer cache hit ratio",
      description: "Percentage of pages found in the buffer cache.",
      unit: "%",
      aggregation: AggregationType.Avg,
      kind: "gauge",
    },
    {
      system: "microsoft.sql_server",
      metricName: "sqlserver.page.life_expectancy",
      title: "Page life expectancy",
      description: "Seconds a page stays in the buffer pool (low = pressure).",
      unit: "s",
      aggregation: AggregationType.Avg,
      kind: "gauge",
    },
    {
      system: "microsoft.sql_server",
      metricName: "sqlserver.lock.wait.rate",
      title: "Lock waits",
      description: "Lock requests per second that had to wait.",
      unit: "requests/s",
      aggregation: AggregationType.Avg,
      kind: "gauge",
    },
    {
      system: "microsoft.sql_server",
      metricName: "sqlserver.transaction_log.usage",
      title: "Transaction log usage",
      description: "Percentage of the transaction log in use (fullest log).",
      unit: "%",
      aggregation: AggregationType.Max,
      kind: "gauge",
    },

    // Oracle — oracledbreceiver (all default-on).
    {
      system: "oracle.db",
      metricName: "oracledb.sessions.usage",
      title: "Sessions",
      description: "Number of sessions in use.",
      unit: "sessions",
      aggregation: AggregationType.Avg,
      kind: "gauge",
    },
    {
      system: "oracle.db",
      metricName: "oracledb.sessions.limit",
      title: "Session limit",
      description: "Maximum number of sessions allowed.",
      unit: "sessions",
      aggregation: AggregationType.Max,
      kind: "gauge",
    },
    {
      system: "oracle.db",
      metricName: "oracledb.processes.usage",
      title: "Processes",
      description: "Number of processes in use.",
      unit: "processes",
      aggregation: AggregationType.Avg,
      kind: "gauge",
    },
    {
      system: "oracle.db",
      metricName: "oracledb.tablespace_size.usage",
      title: "Tablespace usage",
      description: "Bytes used in the fullest tablespace.",
      unit: "bytes",
      aggregation: AggregationType.Max,
      kind: "gauge",
    },
    {
      system: "oracle.db",
      metricName: "oracledb.executions",
      title: "Executions",
      description: "SQL statements executed per second.",
      unit: "executions",
      aggregation: AggregationType.Max,
      kind: "counter",
    },
    {
      system: "oracle.db",
      metricName: "oracledb.user_commits",
      title: "Commits",
      description: "User commits per second.",
      unit: "commits",
      aggregation: AggregationType.Max,
      kind: "counter",
    },
    {
      system: "oracle.db",
      metricName: "oracledb.user_rollbacks",
      title: "Rollbacks",
      description: "User rollbacks per second.",
      unit: "rollbacks",
      aggregation: AggregationType.Max,
      kind: "counter",
    },
    {
      system: "oracle.db",
      metricName: "oracledb.physical_reads",
      title: "Physical reads",
      description: "Data blocks read from disk per second.",
      unit: "reads",
      aggregation: AggregationType.Max,
      kind: "counter",
    },
  ];

/**
 * The curated metrics for an engine (aliases accepted: "postgres" →
 * PostgreSQL's), in display order. Empty for an engine without a curated
 * set — the Overview then shows its "engine metrics not connected" state.
 */
export function getDatabaseServerMetrics(
  system: string | null | undefined,
): Array<DatabaseServerMetricDefinition> {
  const normalized: string | null = normalizeDatabaseSystem(system);
  if (!normalized) {
    return [];
  }
  return DATABASE_SERVER_METRICS.filter(
    (metric: DatabaseServerMetricDefinition): boolean => {
      return metric.system === normalized;
    },
  );
}
