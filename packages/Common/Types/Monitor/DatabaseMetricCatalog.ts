import AggregationType from "../BaseDatabase/AggregationType";
import { DatabaseMetricGroup } from "./DatabaseMetricGroup";
import MonitorMetricType from "./MonitorMetricType";
import SqlDatabaseType from "./SqlDatabaseType";
import { translationKey } from "../Translator";

/*
 * The single source of truth for the Database Health monitor.
 *
 * Every other database-monitor surface is derived from this catalog rather
 * than repeating the list:
 *
 *   - MonitorMetricTypeUtil consults it for aggregation, title, legend, unit
 *     and description, so a new metric never has to be added to five
 *     switch statements (and can never be added to only four of them).
 *   - The probe collector keys its returned values by MonitorMetricType, and
 *     only emits values for metrics the connected engine supports.
 *   - The criteria UI builds its metric dropdown from getDatabaseMetricsForEngine.
 *   - DatabaseMonitorCriteria resolves CheckOn.DatabaseMetric through it.
 *
 * ENGINE SUPPORT IS NOT DECORATIVE. Each `engines` list records what the
 * engine can actually produce, verified against live servers (PostgreSQL
 * 15.18, MySQL 8.4.11, SQL Server 2022 16.0.4265.3). Notable absences that
 * are real, not oversights:
 *
 *   - Deadlocks: stock MySQL exposes no deadlock counter at all (there is no
 *     `%deadlock%` row in performance_schema.global_status). PostgreSQL and
 *     SQL Server both do.
 *   - Connection ceiling: SQL Server's `user connections` setting defaults to
 *     0, meaning unlimited, so a "used percent" would be meaningless there.
 *   - I/O timing: PostgreSQL only populates blk_read_time / blk_write_time
 *     when track_io_timing is on, so those series can legitimately be absent
 *     on a supported engine. That is reported as a metric-group note, never
 *     as a monitor outage.
 */

export enum DatabaseMetricCategory {
  Availability = "Availability",
  Connections = "Connections",
  Throughput = "Throughput",
  LocksAndBlocking = "Locks and Blocking",
  CacheAndIo = "Cache and I/O",
  Storage = "Storage",
  Replication = "Replication",
  Maintenance = "Maintenance",
}

/*
 * The collection groups the probe's queries map onto live in
 * DatabaseMetricGroup, which imports nothing, so a monitor step that names
 * its groups is read without this catalog. They are exported from here as
 * before.
 */
export { DatabaseMetricGroup } from "./DatabaseMetricGroup";

export interface DatabaseMetricDefinition {
  // Stable identifier used in the UI and in tests. Never reuse or renumber.
  id: string;
  metricType: MonitorMetricType;
  /*
   * A key of the Dashboard's locales (#8354): the criteria's metric
   * dropdown, the summary and the charts look it up where they draw it.
   * The server's own messages say it in English.
   */
  friendlyName: string;
  description: string;
  category: DatabaseMetricCategory;
  group: DatabaseMetricGroup;
  defaultAggregation: AggregationType;
  // Display unit. Empty string for dimensionless counts.
  unit: string;
  // Engines that can actually produce this series.
  engines: Array<SqlDatabaseType>;
}

const ALL_ENGINES: Array<SqlDatabaseType> = [
  SqlDatabaseType.PostgreSQL,
  SqlDatabaseType.MySQL,
  SqlDatabaseType.MicrosoftSqlServer,
];

const databaseMetricCatalog: Array<DatabaseMetricDefinition> = [
  // ---------------------------------------------------------------- Availability
  {
    id: "database-uptime-seconds",
    metricType: MonitorMetricType.DatabaseUptimeSeconds,
    friendlyName: translationKey("Uptime"),
    description: translationKey(
      "Seconds since the database server started. A sudden drop means the server restarted - often the real story behind a burst of connection errors.",
    ),
    category: DatabaseMetricCategory.Availability,
    group: DatabaseMetricGroup.Connections,
    defaultAggregation: AggregationType.Max,
    unit: "s",
    engines: ALL_ENGINES,
  },
  {
    id: "database-metric-groups-failed",
    metricType: MonitorMetricType.DatabaseMetricGroupsFailed,
    friendlyName: translationKey("Metric Groups Failed"),
    description: translationKey(
      "How many collection groups failed on the last check, usually because the monitoring login is missing a grant or an engine feature is off. Alert on this to catch lost visibility - a partial failure never takes the monitor offline.",
    ),
    category: DatabaseMetricCategory.Availability,
    group: DatabaseMetricGroup.Connections,
    defaultAggregation: AggregationType.Max,
    unit: "",
    engines: ALL_ENGINES,
  },

  // ----------------------------------------------------------------- Connections
  {
    id: "database-connections-total",
    metricType: MonitorMetricType.DatabaseConnectionsTotal,
    friendlyName: translationKey("Connections"),
    description: translationKey(
      "Client connections currently open to the server. Compare against the maximum to see how much headroom is left.",
    ),
    category: DatabaseMetricCategory.Connections,
    group: DatabaseMetricGroup.Connections,
    defaultAggregation: AggregationType.Avg,
    unit: "",
    engines: ALL_ENGINES,
  },
  {
    id: "database-connections-active",
    metricType: MonitorMetricType.DatabaseConnectionsActive,
    friendlyName: translationKey("Active Connections"),
    description: translationKey(
      "Connections actually executing a statement right now, as opposed to sitting idle. Sustained growth here is the earliest sign of saturation.",
    ),
    category: DatabaseMetricCategory.Connections,
    group: DatabaseMetricGroup.Connections,
    defaultAggregation: AggregationType.Avg,
    unit: "",
    engines: ALL_ENGINES,
  },
  {
    id: "database-connections-max",
    metricType: MonitorMetricType.DatabaseConnectionsMax,
    friendlyName: translationKey("Maximum Connections"),
    description: translationKey(
      "The server's configured connection ceiling. SQL Server leaves this unlimited by default, so it is not reported there.",
    ),
    category: DatabaseMetricCategory.Connections,
    group: DatabaseMetricGroup.Connections,
    defaultAggregation: AggregationType.Max,
    unit: "",
    engines: [SqlDatabaseType.PostgreSQL, SqlDatabaseType.MySQL],
  },
  {
    id: "database-connections-used-percent",
    metricType: MonitorMetricType.DatabaseConnectionsUsedPercent,
    friendlyName: translationKey("Connections Used"),
    description: translationKey(
      "Open connections as a percentage of the configured ceiling. The single best connection-exhaustion alert: page at 90%, warn at 75%.",
    ),
    category: DatabaseMetricCategory.Connections,
    group: DatabaseMetricGroup.Connections,
    defaultAggregation: AggregationType.Max,
    unit: "%",
    engines: [SqlDatabaseType.PostgreSQL, SqlDatabaseType.MySQL],
  },
  {
    id: "database-connections-idle-in-transaction",
    metricType: MonitorMetricType.DatabaseConnectionsIdleInTransaction,
    friendlyName: translationKey("Idle In Transaction"),
    description: translationKey(
      "PostgreSQL backends holding an open transaction while doing nothing. These pin the xmin horizon, block vacuum, and quietly cause table bloat.",
    ),
    category: DatabaseMetricCategory.Connections,
    group: DatabaseMetricGroup.Connections,
    defaultAggregation: AggregationType.Max,
    unit: "",
    engines: [SqlDatabaseType.PostgreSQL],
  },
  {
    id: "database-connections-aborted-total",
    metricType: MonitorMetricType.DatabaseConnectionsAbortedTotal,
    friendlyName: translationKey("Aborted Connects"),
    description: translationKey(
      "Cumulative failed connection attempts since server start. A rising rate points at bad credentials, TLS problems, or a client pool misconfiguration.",
    ),
    category: DatabaseMetricCategory.Connections,
    group: DatabaseMetricGroup.Connections,
    defaultAggregation: AggregationType.Max,
    unit: "",
    engines: [SqlDatabaseType.MySQL],
  },

  // ------------------------------------------------------------------ Throughput
  {
    id: "database-transactions-total",
    metricType: MonitorMetricType.DatabaseTransactionsTotal,
    friendlyName: translationKey("Transactions"),
    description: translationKey(
      "Cumulative committed plus rolled-back transactions. Difference two points in time to get transactions per second.",
    ),
    category: DatabaseMetricCategory.Throughput,
    group: DatabaseMetricGroup.Throughput,
    defaultAggregation: AggregationType.Max,
    unit: "",
    engines: [SqlDatabaseType.PostgreSQL, SqlDatabaseType.MicrosoftSqlServer],
  },
  {
    id: "database-queries-total",
    metricType: MonitorMetricType.DatabaseQueriesTotal,
    friendlyName: translationKey("Queries"),
    description: translationKey(
      "Cumulative statements (MySQL) or batch requests (SQL Server) executed since server start. Difference it to get throughput.",
    ),
    category: DatabaseMetricCategory.Throughput,
    group: DatabaseMetricGroup.Throughput,
    defaultAggregation: AggregationType.Max,
    unit: "",
    engines: [SqlDatabaseType.MySQL, SqlDatabaseType.MicrosoftSqlServer],
  },
  {
    id: "database-queries-slow-total",
    metricType: MonitorMetricType.DatabaseSlowQueriesTotal,
    friendlyName: translationKey("Slow Queries"),
    description: translationKey(
      "Cumulative statements that exceeded MySQL's long_query_time. Requires the slow query log threshold to be set meaningfully.",
    ),
    category: DatabaseMetricCategory.Throughput,
    group: DatabaseMetricGroup.Throughput,
    defaultAggregation: AggregationType.Max,
    unit: "",
    engines: [SqlDatabaseType.MySQL],
  },
  {
    id: "database-rollback-percent",
    metricType: MonitorMetricType.DatabaseRollbackPercent,
    friendlyName: translationKey("Rollback Ratio"),
    description: translationKey(
      "Share of transactions since the previous check that rolled back rather than committed. A step change usually means the application started throwing where it used to succeed.",
    ),
    category: DatabaseMetricCategory.Throughput,
    group: DatabaseMetricGroup.Throughput,
    defaultAggregation: AggregationType.Avg,
    unit: "%",
    engines: [SqlDatabaseType.PostgreSQL],
  },
  {
    id: "database-query-longest-seconds",
    metricType: MonitorMetricType.DatabaseLongestQuerySeconds,
    friendlyName: translationKey("Longest Running Query"),
    description: translationKey(
      "Age of the oldest statement currently executing. Catches a runaway report holding resources long before it shows up as a timeout somewhere else.",
    ),
    category: DatabaseMetricCategory.Throughput,
    group: DatabaseMetricGroup.Activity,
    defaultAggregation: AggregationType.Max,
    unit: "s",
    engines: ALL_ENGINES,
  },
  {
    id: "database-transaction-longest-seconds",
    metricType: MonitorMetricType.DatabaseLongestTransactionSeconds,
    friendlyName: translationKey("Longest Open Transaction"),
    description: translationKey(
      "Age of the oldest open transaction. Long transactions block vacuum on PostgreSQL and grow the log on MySQL and SQL Server.",
    ),
    category: DatabaseMetricCategory.Throughput,
    group: DatabaseMetricGroup.Activity,
    defaultAggregation: AggregationType.Max,
    unit: "s",
    engines: ALL_ENGINES,
  },
  {
    id: "database-transaction-open-count",
    metricType: MonitorMetricType.DatabaseOpenTransactions,
    friendlyName: translationKey("Open Transactions"),
    description: translationKey(
      "Transactions currently open against the InnoDB engine.",
    ),
    category: DatabaseMetricCategory.Throughput,
    group: DatabaseMetricGroup.Activity,
    defaultAggregation: AggregationType.Max,
    unit: "",
    engines: [SqlDatabaseType.MySQL],
  },

  // ----------------------------------------------------------- Locks and Blocking
  {
    id: "database-sessions-blocked",
    metricType: MonitorMetricType.DatabaseSessionsBlocked,
    friendlyName: translationKey("Blocked Sessions"),
    description: translationKey(
      "Sessions waiting on a lock held by another session. Anything sustained above zero is a user-visible stall.",
    ),
    category: DatabaseMetricCategory.LocksAndBlocking,
    group: DatabaseMetricGroup.Locks,
    defaultAggregation: AggregationType.Max,
    unit: "",
    engines: ALL_ENGINES,
  },
  {
    id: "database-locks-waiting",
    metricType: MonitorMetricType.DatabaseLocksWaiting,
    friendlyName: translationKey("Lock Waits"),
    description: translationKey(
      "Lock requests that have not been granted yet. Rises before blocked sessions does, so it makes a good early warning.",
    ),
    category: DatabaseMetricCategory.LocksAndBlocking,
    group: DatabaseMetricGroup.Locks,
    defaultAggregation: AggregationType.Max,
    unit: "",
    engines: ALL_ENGINES,
  },
  {
    id: "database-deadlocks-total",
    metricType: MonitorMetricType.DatabaseDeadlocksTotal,
    friendlyName: translationKey("Deadlocks"),
    description: translationKey(
      "Cumulative deadlocks detected and broken by the server. Stock MySQL exposes no deadlock counter, so this is PostgreSQL and SQL Server only.",
    ),
    category: DatabaseMetricCategory.LocksAndBlocking,
    group: DatabaseMetricGroup.Locks,
    defaultAggregation: AggregationType.Max,
    unit: "",
    engines: [SqlDatabaseType.PostgreSQL, SqlDatabaseType.MicrosoftSqlServer],
  },
  {
    id: "database-table-locks-waited-total",
    metricType: MonitorMetricType.DatabaseTableLocksWaitedTotal,
    friendlyName: translationKey("Table Lock Waits"),
    description: translationKey(
      "Cumulative table-level lock requests that had to wait. Typically points at MyISAM tables or explicit LOCK TABLES usage.",
    ),
    category: DatabaseMetricCategory.LocksAndBlocking,
    group: DatabaseMetricGroup.Locks,
    defaultAggregation: AggregationType.Max,
    unit: "",
    engines: [SqlDatabaseType.MySQL],
  },

  // ---------------------------------------------------------------- Cache and I/O
  {
    id: "database-cache-hit-percent",
    metricType: MonitorMetricType.DatabaseCacheHitPercent,
    friendlyName: translationKey("Cache Hit Ratio"),
    description: translationKey(
      "Share of block reads since the previous check served from the buffer cache instead of disk. A sustained fall means the working set no longer fits in memory.",
    ),
    category: DatabaseMetricCategory.CacheAndIo,
    group: DatabaseMetricGroup.Throughput,
    defaultAggregation: AggregationType.Avg,
    unit: "%",
    engines: ALL_ENGINES,
  },
  {
    id: "database-disk-reads-total",
    metricType: MonitorMetricType.DatabaseDiskReadsTotal,
    friendlyName: translationKey("Disk Reads"),
    description: translationKey(
      "Cumulative reads that had to go to disk rather than the cache. Difference it to get read rate.",
    ),
    category: DatabaseMetricCategory.CacheAndIo,
    group: DatabaseMetricGroup.Throughput,
    defaultAggregation: AggregationType.Max,
    unit: "",
    engines: ALL_ENGINES,
  },
  {
    id: "database-disk-writes-total",
    metricType: MonitorMetricType.DatabaseDiskWritesTotal,
    friendlyName: translationKey("Disk Writes"),
    description: translationKey(
      "Cumulative physical writes issued by the storage engine.",
    ),
    category: DatabaseMetricCategory.CacheAndIo,
    group: DatabaseMetricGroup.Throughput,
    defaultAggregation: AggregationType.Max,
    unit: "",
    engines: [SqlDatabaseType.MySQL, SqlDatabaseType.MicrosoftSqlServer],
  },
  {
    id: "database-io-read-time-ms",
    metricType: MonitorMetricType.DatabaseIoReadTimeMs,
    friendlyName: translationKey("I/O Read Time"),
    description: translationKey(
      "Cumulative milliseconds spent waiting on read I/O. PostgreSQL only reports this when track_io_timing is on; the series is simply absent otherwise.",
    ),
    category: DatabaseMetricCategory.CacheAndIo,
    group: DatabaseMetricGroup.Throughput,
    defaultAggregation: AggregationType.Max,
    unit: "ms",
    engines: [SqlDatabaseType.PostgreSQL, SqlDatabaseType.MicrosoftSqlServer],
  },
  {
    id: "database-io-write-time-ms",
    metricType: MonitorMetricType.DatabaseIoWriteTimeMs,
    friendlyName: translationKey("I/O Write Time"),
    description: translationKey(
      "Cumulative milliseconds spent waiting on write I/O. Same track_io_timing caveat as read time on PostgreSQL.",
    ),
    category: DatabaseMetricCategory.CacheAndIo,
    group: DatabaseMetricGroup.Throughput,
    defaultAggregation: AggregationType.Max,
    unit: "ms",
    engines: [SqlDatabaseType.PostgreSQL, SqlDatabaseType.MicrosoftSqlServer],
  },
  {
    id: "database-page-life-expectancy-seconds",
    metricType: MonitorMetricType.DatabasePageLifeExpectancySeconds,
    friendlyName: translationKey("Page Life Expectancy"),
    description: translationKey(
      "How long SQL Server expects a page to stay in the buffer pool. Falling PLE is the classic memory-pressure signal.",
    ),
    category: DatabaseMetricCategory.CacheAndIo,
    group: DatabaseMetricGroup.Throughput,
    defaultAggregation: AggregationType.Min,
    unit: "s",
    engines: [SqlDatabaseType.MicrosoftSqlServer],
  },
  {
    id: "database-memory-grants-pending",
    metricType: MonitorMetricType.DatabaseMemoryGrantsPending,
    friendlyName: translationKey("Memory Grants Pending"),
    description: translationKey(
      "Queries waiting for a memory grant before they can run. Anything above zero means queries are queueing on memory.",
    ),
    category: DatabaseMetricCategory.CacheAndIo,
    group: DatabaseMetricGroup.Throughput,
    defaultAggregation: AggregationType.Max,
    unit: "",
    engines: [SqlDatabaseType.MicrosoftSqlServer],
  },

  // --------------------------------------------------------------------- Storage
  {
    id: "database-size-bytes",
    metricType: MonitorMetricType.DatabaseSizeBytes,
    friendlyName: translationKey("Database Size"),
    description: translationKey(
      "On-disk size of the monitored database. Chart it over weeks to turn capacity planning into arithmetic.",
    ),
    category: DatabaseMetricCategory.Storage,
    group: DatabaseMetricGroup.Storage,
    defaultAggregation: AggregationType.Max,
    unit: "bytes",
    engines: ALL_ENGINES,
  },
  {
    id: "database-temp-bytes-total",
    metricType: MonitorMetricType.DatabaseTempBytesTotal,
    friendlyName: translationKey("Temp Bytes Written"),
    description: translationKey(
      "Cumulative bytes PostgreSQL spilled to temporary files because work_mem was too small for a sort or hash.",
    ),
    category: DatabaseMetricCategory.Storage,
    group: DatabaseMetricGroup.Storage,
    defaultAggregation: AggregationType.Max,
    unit: "bytes",
    engines: [SqlDatabaseType.PostgreSQL],
  },
  {
    id: "database-temp-disk-tables-total",
    metricType: MonitorMetricType.DatabaseTempDiskTablesTotal,
    friendlyName: translationKey("Temp Disk Tables"),
    description: translationKey(
      "Cumulative internal temporary tables MySQL had to materialize on disk instead of in memory.",
    ),
    category: DatabaseMetricCategory.Storage,
    group: DatabaseMetricGroup.Storage,
    defaultAggregation: AggregationType.Max,
    unit: "",
    engines: [SqlDatabaseType.MySQL],
  },
  {
    id: "database-log-space-used-percent",
    metricType: MonitorMetricType.DatabaseLogSpaceUsedPercent,
    friendlyName: translationKey("Log Space Used"),
    description: translationKey(
      "Percentage of the SQL Server transaction log in use. A log that fills stops all writes, so this is worth paging on.",
    ),
    category: DatabaseMetricCategory.Storage,
    group: DatabaseMetricGroup.Storage,
    defaultAggregation: AggregationType.Max,
    unit: "%",
    engines: [SqlDatabaseType.MicrosoftSqlServer],
  },
  {
    id: "database-tempdb-free-bytes",
    metricType: MonitorMetricType.DatabaseTempDbFreeBytes,
    friendlyName: translationKey("TempDB Free Space"),
    description: translationKey(
      "Unallocated space left in tempdb. Running tempdb dry takes down every session that needs a spill or a version store.",
    ),
    category: DatabaseMetricCategory.Storage,
    group: DatabaseMetricGroup.Storage,
    defaultAggregation: AggregationType.Min,
    unit: "bytes",
    engines: [SqlDatabaseType.MicrosoftSqlServer],
  },

  // ----------------------------------------------------------------- Replication
  {
    id: "database-replica-count",
    metricType: MonitorMetricType.DatabaseReplicaCount,
    friendlyName: translationKey("Connected Replicas"),
    description: translationKey(
      "Replicas currently streaming from this server. Alert on a drop to catch a replica that detached silently.",
    ),
    category: DatabaseMetricCategory.Replication,
    group: DatabaseMetricGroup.Replication,
    defaultAggregation: AggregationType.Min,
    unit: "",
    engines: [SqlDatabaseType.PostgreSQL, SqlDatabaseType.MicrosoftSqlServer],
  },
  {
    id: "database-replication-lag-seconds",
    metricType: MonitorMetricType.DatabaseReplicationLagSeconds,
    friendlyName: translationKey("Replication Lag"),
    description: translationKey(
      "How far behind the replica is, in seconds. Reported from whichever side of the replication link this monitor is connected to. SQL Server availability groups do not publish a delay in seconds - use Replication Lag (Bytes) there.",
    ),
    category: DatabaseMetricCategory.Replication,
    group: DatabaseMetricGroup.Replication,
    defaultAggregation: AggregationType.Max,
    unit: "s",
    engines: [SqlDatabaseType.PostgreSQL, SqlDatabaseType.MySQL],
  },
  {
    id: "database-replication-lag-bytes",
    metricType: MonitorMetricType.DatabaseReplicationLagBytes,
    friendlyName: translationKey("Replication Lag (Bytes)"),
    description: translationKey(
      "Bytes of WAL sent but not yet replayed, or the SQL Server send and redo queue. Survives an idle primary, where lag in seconds reads as zero.",
    ),
    category: DatabaseMetricCategory.Replication,
    group: DatabaseMetricGroup.Replication,
    defaultAggregation: AggregationType.Max,
    unit: "bytes",
    engines: [SqlDatabaseType.PostgreSQL, SqlDatabaseType.MicrosoftSqlServer],
  },
  {
    id: "database-is-in-recovery",
    metricType: MonitorMetricType.DatabaseIsInRecovery,
    friendlyName: translationKey("Is In Recovery"),
    description: translationKey(
      "1 when this PostgreSQL server is a standby, 0 when it is a primary. Alert on a change to catch an unplanned failover.",
    ),
    category: DatabaseMetricCategory.Replication,
    group: DatabaseMetricGroup.Replication,
    defaultAggregation: AggregationType.Max,
    unit: "",
    engines: [SqlDatabaseType.PostgreSQL],
  },
  {
    id: "database-replication-slots-inactive",
    metricType: MonitorMetricType.DatabaseReplicationSlotsInactive,
    friendlyName: translationKey("Inactive Replication Slots"),
    description: translationKey(
      "PostgreSQL replication slots with no consumer attached. Each one pins WAL forever and will eventually fill the disk.",
    ),
    category: DatabaseMetricCategory.Replication,
    group: DatabaseMetricGroup.Replication,
    defaultAggregation: AggregationType.Max,
    unit: "",
    engines: [SqlDatabaseType.PostgreSQL],
  },

  // ----------------------------------------------------------------- Maintenance
  {
    id: "database-transaction-id-used-percent",
    metricType: MonitorMetricType.DatabaseTransactionIdUsedPercent,
    friendlyName: translationKey("Transaction ID Used"),
    description: translationKey(
      "How far the oldest unfrozen transaction ID has advanced toward wraparound. PostgreSQL shuts down writes if this ever reaches 100%, which makes it the most important PostgreSQL metric almost nobody watches.",
    ),
    category: DatabaseMetricCategory.Maintenance,
    group: DatabaseMetricGroup.Maintenance,
    defaultAggregation: AggregationType.Max,
    unit: "%",
    engines: [SqlDatabaseType.PostgreSQL],
  },
  {
    id: "database-dead-tuples",
    metricType: MonitorMetricType.DatabaseDeadTuples,
    friendlyName: translationKey("Dead Tuples"),
    description: translationKey(
      "Dead rows waiting to be reclaimed by vacuum across user tables. Growth without a matching vacuum means bloat and worsening plans.",
    ),
    category: DatabaseMetricCategory.Maintenance,
    group: DatabaseMetricGroup.Maintenance,
    defaultAggregation: AggregationType.Max,
    unit: "",
    engines: [SqlDatabaseType.PostgreSQL],
  },
  {
    id: "database-tables-never-autovacuumed",
    metricType: MonitorMetricType.DatabaseTablesNeverAutovacuumed,
    friendlyName: translationKey("Tables Never Autovacuumed"),
    description: translationKey(
      "User tables that have dead rows but have never been autovacuumed - usually a sign autovacuum is starved or disabled for them.",
    ),
    category: DatabaseMetricCategory.Maintenance,
    group: DatabaseMetricGroup.Maintenance,
    defaultAggregation: AggregationType.Max,
    unit: "",
    engines: [SqlDatabaseType.PostgreSQL],
  },
  {
    id: "database-checkpoints-requested-total",
    metricType: MonitorMetricType.DatabaseCheckpointsRequestedTotal,
    friendlyName: translationKey("Requested Checkpoints"),
    description: translationKey(
      "Cumulative checkpoints forced by WAL volume rather than by the timer. A high ratio against timed checkpoints means max_wal_size is too small.",
    ),
    category: DatabaseMetricCategory.Maintenance,
    group: DatabaseMetricGroup.Maintenance,
    defaultAggregation: AggregationType.Max,
    unit: "",
    engines: [SqlDatabaseType.PostgreSQL],
  },
  {
    id: "database-checkpoints-timed-total",
    metricType: MonitorMetricType.DatabaseCheckpointsTimedTotal,
    friendlyName: translationKey("Timed Checkpoints"),
    description: translationKey(
      "Cumulative checkpoints triggered on schedule. The healthy counterpart to requested checkpoints.",
    ),
    category: DatabaseMetricCategory.Maintenance,
    group: DatabaseMetricGroup.Maintenance,
    defaultAggregation: AggregationType.Max,
    unit: "",
    engines: [SqlDatabaseType.PostgreSQL],
  },
];

/*
 * Display order of the metric cards on the monitor's metrics tab. Availability
 * first because it answers "is this thing even reporting", then the groups an
 * operator walks in order during an incident.
 */
const categoryOrder: Array<DatabaseMetricCategory> = [
  DatabaseMetricCategory.Availability,
  DatabaseMetricCategory.Connections,
  DatabaseMetricCategory.Throughput,
  DatabaseMetricCategory.LocksAndBlocking,
  DatabaseMetricCategory.CacheAndIo,
  DatabaseMetricCategory.Storage,
  DatabaseMetricCategory.Replication,
  DatabaseMetricCategory.Maintenance,
];

const categoryDescriptions: Record<DatabaseMetricCategory, string> = {
  [DatabaseMetricCategory.Availability]: translationKey(
    "Whether the database is reachable and whether collection is complete.",
  ),
  [DatabaseMetricCategory.Connections]: translationKey(
    "Connection counts, headroom against the configured ceiling, and failed connects.",
  ),
  [DatabaseMetricCategory.Throughput]: translationKey(
    "Transaction and query volume, plus the age of the longest running work.",
  ),
  [DatabaseMetricCategory.LocksAndBlocking]: translationKey(
    "Sessions waiting on each other: lock waits, blocked sessions, and deadlocks.",
  ),
  [DatabaseMetricCategory.CacheAndIo]: translationKey(
    "How much work is served from memory rather than disk, and what the disk costs.",
  ),
  [DatabaseMetricCategory.Storage]: translationKey(
    "Database size, temporary spill, and log or tempdb space.",
  ),
  [DatabaseMetricCategory.Replication]: translationKey(
    "Replica connectivity and how far behind replicas are running.",
  ),
  [DatabaseMetricCategory.Maintenance]: translationKey(
    "Vacuum, bloat, checkpoints, and transaction ID wraparound headroom.",
  ),
};

/*
 * Each group's heading in the summary and on the Metrics tab, a key: a
 * string enum's values cannot be marked for the extractor, so the pages look
 * a group's name up here, once (#8354). Each is the group's English name.
 */
const categoryLabels: Record<DatabaseMetricCategory, string> = {
  [DatabaseMetricCategory.Availability]: translationKey("Availability"),
  [DatabaseMetricCategory.Connections]: translationKey("Connections"),
  [DatabaseMetricCategory.Throughput]: translationKey("Throughput"),
  [DatabaseMetricCategory.LocksAndBlocking]:
    translationKey("Locks and Blocking"),
  [DatabaseMetricCategory.CacheAndIo]: translationKey("Cache and I/O"),
  [DatabaseMetricCategory.Storage]: translationKey("Storage"),
  [DatabaseMetricCategory.Replication]: translationKey("Replication"),
  [DatabaseMetricCategory.Maintenance]: translationKey("Maintenance"),
};

export function getDatabaseMetricCategoryLabel(
  category: DatabaseMetricCategory,
): string {
  return categoryLabels[category] || category;
}

/*
 * Each collection group's name, a key: the monitor form's Metric Groups
 * switches and the summary's collection issues say a group the same way
 * (#8609). Locks reads "Locks and Blocking", as its switch always has. The
 * group's value stays what the probe, the server's Database Collection Error
 * text and a criteria's Contains filter read.
 */
const groupLabels: Record<DatabaseMetricGroup, string> = {
  [DatabaseMetricGroup.Connections]: translationKey("Connections"),
  [DatabaseMetricGroup.Activity]: translationKey("Activity"),
  [DatabaseMetricGroup.Throughput]: translationKey("Throughput"),
  [DatabaseMetricGroup.Locks]: translationKey("Locks and Blocking"),
  [DatabaseMetricGroup.Storage]: translationKey("Storage"),
  [DatabaseMetricGroup.Replication]: translationKey("Replication"),
  [DatabaseMetricGroup.Maintenance]: translationKey("Maintenance"),
};

export function getDatabaseMetricGroupLabel(
  group: DatabaseMetricGroup,
): string {
  return groupLabels[group] || group;
}

export function getAllDatabaseMetrics(): Array<DatabaseMetricDefinition> {
  return [...databaseMetricCatalog];
}

export function getDatabaseMetricCategoryOrder(): Array<DatabaseMetricCategory> {
  return [...categoryOrder];
}

export function getDatabaseMetricCategoryDescription(
  category: DatabaseMetricCategory,
): string {
  return categoryDescriptions[category] || "";
}

export function getDatabaseMetricByMetricType(
  metricType: MonitorMetricType,
): DatabaseMetricDefinition | null {
  return (
    databaseMetricCatalog.find((metric: DatabaseMetricDefinition) => {
      return metric.metricType === metricType;
    }) || null
  );
}

export function getDatabaseMetricById(
  id: string,
): DatabaseMetricDefinition | null {
  return (
    databaseMetricCatalog.find((metric: DatabaseMetricDefinition) => {
      return metric.id === id;
    }) || null
  );
}

export function isDatabaseMetricType(metricType: MonitorMetricType): boolean {
  return getDatabaseMetricByMetricType(metricType) !== null;
}

/**
 * Metrics the given engine can actually produce. The criteria metric picker
 * uses this so an operator is never offered a threshold on a series their
 * engine will never write - a criterion that would sit permanently unmet.
 */
export function getDatabaseMetricsForEngine(
  databaseType: SqlDatabaseType,
): Array<DatabaseMetricDefinition> {
  return databaseMetricCatalog.filter((metric: DatabaseMetricDefinition) => {
    return metric.engines.includes(databaseType);
  });
}

export function getDatabaseMetricsByCategory(
  category: DatabaseMetricCategory,
): Array<DatabaseMetricDefinition> {
  return databaseMetricCatalog.filter((metric: DatabaseMetricDefinition) => {
    return metric.category === category;
  });
}

export function getDatabaseMetricsByGroup(
  group: DatabaseMetricGroup,
): Array<DatabaseMetricDefinition> {
  return databaseMetricCatalog.filter((metric: DatabaseMetricDefinition) => {
    return metric.group === group;
  });
}

export default databaseMetricCatalog;
