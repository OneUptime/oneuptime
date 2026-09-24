import AggregationType from "../BaseDatabase/AggregationType";
import { getDatabaseSystemMetricsEngine } from "./DatabaseSystem";

/*
 * The curated engine metrics a Database's Overview charts, per engine, from
 * the OpenTelemetry Collector contrib DB receivers. Only metrics that arrive
 * on the Database Agent's default setup are listed: ones the receiver emits
 * by default, plus the few optional ones the agent's config for that
 * receiver switches on (`enabledByDefault: false` — a team running its own
 * collector must switch them on too, and their descriptions say so). Every
 * entry was seen arriving from collector-contrib 0.161.0 against a real
 * server, not just read off the receiver's metadata: SQL Server's
 * performance-counter metrics that only a Windows host reports, and Oracle's
 * session / process limits a pluggable database never returns, are left
 * out, because their tiles would stay empty forever on a default setup.
 * Names are lowercase, exactly as ingest stores them.
 *
 * `kind` decides how a metric is drawn:
 *   - "gauge" — a value at a point in time (Gauge and non-monotonic
 *     UpDownCounter sums, plus `mysql.uptime`, a monotonic sum whose current
 *     value IS the answer). Its latest value is the tile.
 *   - "counter" — a cumulative monotonic sum (commits, commands processed).
 *     Its raw value only ever grows, so the dashboard charts it as a
 *     per-second rate computed client-side from consecutive buckets.
 *
 * Almost no metric here is ONE series. A receiver splits a metric by a
 * datapoint attribute (`mysql.threads` by kind, `mongodb.connection.count`
 * by type), reports it once per database (`postgresql.backends`), and a
 * database can be reported by several agents (one per replica-set member,
 * told apart by `server.address`). Pooling those series into one Avg or Max
 * per bucket gives numbers that mean nothing — the average of the active,
 * available and current connection counts, or the rate of whichever
 * cumulative series happens to have the largest lifetime total. So every
 * entry says how its series combine:
 *
 *   - `attributes` pins ONE value of a breakdown the tile is about
 *     (connections of type "current", threads of kind "connected");
 *   - `seriesKeys` names the attribute keys whose values are separate
 *     PARTS of the answer (one per database, per buffer-pool page status);
 *   - `duplicatedAcross` names attribute keys the receiver repeats the SAME
 *     value across (mongodb reports its server-wide connection count once
 *     per database) — pooled, never added up;
 *   - `aggregation` combines the samples of one series inside a bucket, and
 *     `seriesCombine` then combines the series of that bucket into the one
 *     value a chart point and tile show: "sum" for parts of a whole, "max"
 *     for the worst one (lag, the largest database), "min" for the one
 *     closest to trouble (uptime, page life expectancy), "avg" for ratios.
 *
 * Gauges are grouped by `seriesKeys` plus the reporting instance
 * (DATABASE_SERVER_INSTANCE_ATTRIBUTE_KEYS); a series missing from a bucket
 * (a member that has not scraped yet in the one still filling) keeps its
 * last value there for a couple of buckets rather than dropping out of the
 * total. Counters are grouped by their WHOLE attribute set — every distinct
 * series — and turned into a rate per series before the rates are summed; a
 * cumulative value is never compared across series. See
 * DatabaseServerTelemetryQueries in the dashboard.
 *
 * `seriesCombine` also decides the monitor "Create monitor" seeds from a
 * gauge's chart (DatabaseMetricMonitorLink): an ungrouped monitor query
 * folds every series into one number, which is the chart's only for "max"
 * (its Max), "min" (its Min) and "avg"; a "sum" is grouped like the chart
 * and alerts per series.
 */

export type DatabaseServerMetricKind = "gauge" | "counter";

export type DatabaseServerMetricSeriesCombine = "sum" | "max" | "min" | "avg";

export interface DatabaseServerMetricDefinition {
  system: string;
  metricName: string;
  title: string;
  description: string;
  unit: string;
  // How the samples of ONE series combine inside a time bucket.
  aggregation: AggregationType;
  kind: DatabaseServerMetricKind;
  // How the series of a bucket combine into the value shown (see above).
  seriesCombine: DatabaseServerMetricSeriesCombine;
  // Datapoint-attribute filter pinning one value of a breakdown.
  attributes?: Readonly<Record<string, string>> | undefined;
  // Attribute keys whose values are separate parts of the answer.
  seriesKeys?: ReadonlyArray<string> | undefined;
  // Attribute keys the receiver repeats one value across (pooled).
  duplicatedAcross?: ReadonlyArray<string> | undefined;
  /*
   * False for a metric the receiver only emits once switched on; the
   * Database Agent's config for the receiver switches it on. Absent means
   * the receiver emits it by default.
   */
  enabledByDefault?: boolean | undefined;
}

/*
 * The resource attributes that tell two reporting agents apart: the Database
 * Agent stamps `server.address` / `server.port`, and per-member agents that
 * share one DATABASE_SERVER_ID differ by exactly these (stored with the
 * `resource.` prefix, like every resource attribute).
 */
export const DATABASE_SERVER_INSTANCE_ATTRIBUTE_KEYS: ReadonlyArray<string> = [
  "resource.server.address",
  "resource.server.port",
];

/*
 * Appended to the description of every `enabledByDefault: false` entry, so
 * the tile's (i) tells a team running its own collector what to switch on.
 */
const AGENT_ENABLED_NOTE: string =
  " Off by default in the collector's receiver; the Database Agent switches it on, and your own collector has to enable it too.";

// postgresqlreceiver reports per-database metrics under either spelling.
const POSTGRESQL_DATABASE_KEYS: ReadonlyArray<string> = [
  "db.namespace",
  "resource.postgresql.database.name",
];

export const DATABASE_SERVER_METRICS: ReadonlyArray<DatabaseServerMetricDefinition> =
  [
    // PostgreSQL — postgresqlreceiver (all default-on).
    {
      system: "postgresql",
      metricName: "postgresql.backends",
      title: "Connections",
      description:
        "Open backends (client connections), added up across every database on the server.",
      unit: "connections",
      aggregation: AggregationType.Avg,
      kind: "gauge",
      seriesKeys: POSTGRESQL_DATABASE_KEYS,
      seriesCombine: "sum",
    },
    {
      system: "postgresql",
      metricName: "postgresql.connection.max",
      title: "Max connections",
      description: "The configured max_connections limit.",
      unit: "connections",
      aggregation: AggregationType.Max,
      kind: "gauge",
      seriesCombine: "max",
    },
    {
      system: "postgresql",
      metricName: "postgresql.commits",
      title: "Commits",
      description:
        "Committed transactions per second, added up across every database.",
      unit: "commits",
      aggregation: AggregationType.Max,
      kind: "counter",
      seriesCombine: "sum",
    },
    {
      system: "postgresql",
      metricName: "postgresql.rollbacks",
      title: "Rollbacks",
      description:
        "Rolled-back transactions per second, added up across every database.",
      unit: "rollbacks",
      aggregation: AggregationType.Max,
      kind: "counter",
      seriesCombine: "sum",
    },
    {
      system: "postgresql",
      metricName: "postgresql.db_size",
      title: "Database size",
      description: "Disk space used by the largest database.",
      unit: "bytes",
      aggregation: AggregationType.Max,
      kind: "gauge",
      seriesKeys: POSTGRESQL_DATABASE_KEYS,
      seriesCombine: "max",
    },
    {
      system: "postgresql",
      metricName: "postgresql.database.count",
      title: "Databases",
      description: "Number of user databases on the server.",
      unit: "databases",
      aggregation: AggregationType.Max,
      kind: "gauge",
      // Replicas report the same databases; they are not added up.
      seriesCombine: "max",
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
      seriesKeys: ["replication_client"],
      seriesCombine: "max",
    },
    {
      system: "postgresql",
      metricName: "postgresql.wal.age",
      title: "WAL age",
      description: "Age of the oldest WAL file not yet archived or replayed.",
      unit: "s",
      aggregation: AggregationType.Max,
      kind: "gauge",
      seriesCombine: "max",
    },

    // MySQL / MariaDB — mysqlreceiver (default-on subset).
    {
      system: "mysql",
      metricName: "mysql.threads",
      title: "Connected threads",
      description:
        "Threads with an open client connection (Threads_connected).",
      unit: "threads",
      aggregation: AggregationType.Avg,
      kind: "gauge",
      attributes: { kind: "connected" },
      seriesCombine: "sum",
    },
    {
      system: "mysql",
      metricName: "mysql.threads",
      title: "Running threads",
      description:
        "Threads executing a statement right now (Threads_running) — the server's real concurrency.",
      unit: "threads",
      aggregation: AggregationType.Avg,
      kind: "gauge",
      attributes: { kind: "running" },
      seriesCombine: "sum",
    },
    {
      system: "mysql",
      metricName: "mysql.buffer_pool.usage",
      title: "Buffer pool usage",
      description:
        "Bytes held in the InnoDB buffer pool, clean and dirty pages together.",
      unit: "bytes",
      aggregation: AggregationType.Avg,
      kind: "gauge",
      seriesKeys: ["status"],
      seriesCombine: "sum",
    },
    {
      system: "mysql",
      metricName: "mysql.buffer_pool.limit",
      title: "Buffer pool size",
      description: "The configured InnoDB buffer pool size.",
      unit: "bytes",
      aggregation: AggregationType.Max,
      kind: "gauge",
      seriesCombine: "max",
    },
    {
      system: "mysql",
      metricName: "mysql.handlers",
      title: "Handler operations",
      description:
        "Internal handler calls (reads, writes, commits, …) per second, every kind added up.",
      unit: "operations",
      aggregation: AggregationType.Max,
      kind: "counter",
      seriesCombine: "sum",
    },
    {
      system: "mysql",
      metricName: "mysql.row_operations",
      title: "Row operations",
      description:
        "InnoDB rows read, inserted, updated and deleted per second, added up.",
      unit: "rows",
      aggregation: AggregationType.Max,
      kind: "counter",
      seriesCombine: "sum",
    },
    {
      system: "mysql",
      metricName: "mysql.row_locks",
      title: "Row lock waits",
      description: "InnoDB row lock waits per second.",
      unit: "waits",
      aggregation: AggregationType.Max,
      kind: "counter",
      // The metric also carries kind "time", cumulative milliseconds.
      attributes: { kind: "waits" },
      seriesCombine: "sum",
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
      // The most recently restarted member is the one to show.
      seriesCombine: "min",
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
      seriesCombine: "sum",
    },
    {
      system: "redis",
      metricName: "redis.memory.used",
      title: "Memory used",
      description: "Bytes allocated by Redis.",
      unit: "bytes",
      aggregation: AggregationType.Avg,
      kind: "gauge",
      seriesCombine: "sum",
    },
    {
      system: "redis",
      metricName: "redis.memory.fragmentation_ratio",
      title: "Memory fragmentation",
      description: "Ratio of resident memory to memory allocated by Redis.",
      unit: "ratio",
      aggregation: AggregationType.Avg,
      kind: "gauge",
      seriesCombine: "avg",
    },
    {
      system: "redis",
      metricName: "redis.commands",
      title: "Commands per second",
      description: "Instantaneous commands processed per second.",
      unit: "ops/s",
      aggregation: AggregationType.Avg,
      kind: "gauge",
      seriesCombine: "sum",
    },
    {
      system: "redis",
      metricName: "redis.commands.processed",
      title: "Commands processed",
      description: "Commands processed per second.",
      unit: "commands",
      aggregation: AggregationType.Max,
      kind: "counter",
      seriesCombine: "sum",
    },
    {
      system: "redis",
      metricName: "redis.keyspace.hits",
      title: "Keyspace hits",
      description: "Successful key lookups per second.",
      unit: "hits",
      aggregation: AggregationType.Max,
      kind: "counter",
      seriesCombine: "sum",
    },
    {
      system: "redis",
      metricName: "redis.keyspace.misses",
      title: "Keyspace misses",
      description: "Failed key lookups per second.",
      unit: "misses",
      aggregation: AggregationType.Max,
      kind: "counter",
      seriesCombine: "sum",
    },
    {
      system: "redis",
      metricName: "redis.keys.evicted",
      title: "Evicted keys",
      description: "Keys evicted because of the maxmemory limit, per second.",
      unit: "keys",
      aggregation: AggregationType.Max,
      kind: "counter",
      seriesCombine: "sum",
    },

    /*
     * MongoDB — mongodbreceiver (all default-on). It reads serverStatus once
     * per database, so connection.count and memory.usage repeat the same
     * server-wide number for every database: pooled, never added up.
     */
    {
      system: "mongodb",
      metricName: "mongodb.connection.count",
      title: "Connections",
      description: "Client connections currently open (type current).",
      unit: "connections",
      aggregation: AggregationType.Avg,
      kind: "gauge",
      attributes: { type: "current" },
      duplicatedAcross: ["db.namespace", "resource.database"],
      seriesCombine: "sum",
    },
    {
      system: "mongodb",
      metricName: "mongodb.memory.usage",
      title: "Resident memory",
      description: "Resident memory used by mongod (type resident).",
      unit: "bytes",
      aggregation: AggregationType.Avg,
      kind: "gauge",
      attributes: { type: "resident" },
      duplicatedAcross: ["db.namespace", "resource.database"],
      seriesCombine: "sum",
    },
    {
      system: "mongodb",
      metricName: "mongodb.data.size",
      title: "Data size",
      description: "Size of the data stored (largest database).",
      unit: "bytes",
      aggregation: AggregationType.Max,
      kind: "gauge",
      seriesKeys: ["db.namespace", "resource.database"],
      seriesCombine: "max",
    },
    {
      system: "mongodb",
      metricName: "mongodb.cursor.count",
      title: "Open cursors",
      description: "Number of open cursors.",
      unit: "cursors",
      aggregation: AggregationType.Avg,
      kind: "gauge",
      seriesCombine: "sum",
    },
    {
      system: "mongodb",
      metricName: "mongodb.operation.count",
      title: "Operations",
      description:
        "Operations (insert, query, update, …) per second, every type added up.",
      unit: "operations",
      aggregation: AggregationType.Max,
      kind: "counter",
      seriesCombine: "sum",
    },
    {
      system: "mongodb",
      metricName: "mongodb.operation.time",
      title: "Operation time",
      description:
        "Time spent executing operations, per second, every type added up.",
      unit: "ms",
      aggregation: AggregationType.Max,
      kind: "counter",
      seriesCombine: "sum",
    },
    {
      system: "mongodb",
      metricName: "mongodb.cache.operations",
      title: "Cache operations",
      description: "WiredTiger cache hits and misses per second, added up.",
      unit: "operations",
      aggregation: AggregationType.Max,
      kind: "counter",
      seriesCombine: "sum",
    },

    /*
     * SQL Server — sqlserverreceiver. The *.rate metrics are
     * receiver-computed per-second gauges, not counters. Connected directly
     * (the Database Agent's setup, and the only one off Windows) the
     * receiver reads sys.dm_os_performance_counters, which has no
     * sqlserver.transaction.rate or sqlserver.transaction_log.usage — those
     * come from Windows performance counters only — so compilations,
     * deadlocks and blocked processes stand in for them.
     */
    {
      system: "microsoft.sql_server",
      metricName: "sqlserver.user.connection.count",
      title: "User connections",
      description: "Number of users connected to the server.",
      unit: "connections",
      aggregation: AggregationType.Avg,
      kind: "gauge",
      seriesCombine: "sum",
    },
    {
      system: "microsoft.sql_server",
      metricName: "sqlserver.batch.request.rate",
      title: "Batch requests",
      description:
        "Transact-SQL batches received per second. Over the agent's direct connection SQL Server reports a running total since it started, so the chart shows the per-second rate computed from it.",
      unit: "requests",
      aggregation: AggregationType.Max,
      kind: "counter",
      seriesCombine: "sum",
    },
    {
      system: "microsoft.sql_server",
      metricName: "sqlserver.batch.sql_compilation.rate",
      title: "SQL compilations",
      description:
        "SQL compilations per second. Many compilations next to few batch requests means query plans are not being reused. Over the agent's direct connection SQL Server reports a running total since it started, so the chart shows the per-second rate computed from it.",
      unit: "compilations",
      aggregation: AggregationType.Max,
      kind: "counter",
      seriesCombine: "sum",
    },
    {
      system: "microsoft.sql_server",
      metricName: "sqlserver.page.buffer_cache.hit_ratio",
      title: "Buffer cache hit ratio",
      description: "Percentage of pages found in the buffer cache.",
      unit: "%",
      aggregation: AggregationType.Avg,
      kind: "gauge",
      seriesCombine: "avg",
    },
    {
      system: "microsoft.sql_server",
      metricName: "sqlserver.page.life_expectancy",
      title: "Page life expectancy",
      description:
        "Seconds a page stays in the buffer pool (low = pressure); the lowest buffer node or manager.",
      unit: "s",
      aggregation: AggregationType.Avg,
      kind: "gauge",
      seriesKeys: ["performance_counter.object_name"],
      seriesCombine: "min",
    },
    {
      system: "microsoft.sql_server",
      metricName: "sqlserver.lock.wait.rate",
      title: "Lock waits",
      description:
        "Lock requests per second that had to wait. Over the agent's direct connection SQL Server reports a running total since it started, so the chart shows the per-second rate computed from it.",
      unit: "requests",
      aggregation: AggregationType.Max,
      kind: "counter",
      seriesCombine: "sum",
    },
    {
      system: "microsoft.sql_server",
      metricName: "sqlserver.deadlock.rate",
      title: "Deadlocks",
      description: `Deadlocks per second. Over the agent's direct connection SQL Server reports a running total since it started, so the chart shows the per-second rate computed from it.${AGENT_ENABLED_NOTE}`,
      unit: "deadlocks",
      aggregation: AggregationType.Max,
      kind: "counter",
      seriesCombine: "sum",
      enabledByDefault: false,
    },
    {
      system: "microsoft.sql_server",
      metricName: "sqlserver.processes.blocked",
      title: "Blocked processes",
      description: `Sessions waiting on a lock another session holds (the peak in each interval).${AGENT_ENABLED_NOTE}`,
      unit: "processes",
      aggregation: AggregationType.Max,
      kind: "gauge",
      seriesCombine: "sum",
      enabledByDefault: false,
    },

    /*
     * Oracle — oracledbreceiver. A connection to a pluggable database
     * (FREEPDB1, ORCLPDB1: the usual setup) never returns
     * oracledb.sessions.limit or oracledb.processes.usage, so the Overview
     * reads DB time, the SGA and tablespace fullness instead — all
     * off-by-default metrics the Database Agent switches on.
     */
    {
      system: "oracle.db",
      metricName: "oracledb.sessions.usage",
      title: "Sessions",
      description:
        "Sessions in use, every type, status and pluggable database added up.",
      unit: "sessions",
      aggregation: AggregationType.Avg,
      kind: "gauge",
      seriesKeys: ["session_type", "session_status", "oracle.db.pdb"],
      seriesCombine: "sum",
    },
    {
      system: "oracle.db",
      metricName: "oracledb.db.time",
      title: "DB time",
      description: `Seconds user sessions spent in database calls, per second: the average number of active sessions.${AGENT_ENABLED_NOTE}`,
      unit: "s",
      aggregation: AggregationType.Max,
      kind: "counter",
      // Background processes' time is not the load users put on it.
      attributes: { "oracledb.session.type": "foreground" },
      seriesCombine: "sum",
      enabledByDefault: false,
    },
    {
      system: "oracle.db",
      metricName: "oracledb.sga.usage",
      title: "SGA in use",
      description: `Memory in the System Global Area: the buffer cache, shared pool and every other component added up.${AGENT_ENABLED_NOTE}`,
      unit: "bytes",
      aggregation: AggregationType.Avg,
      kind: "gauge",
      seriesKeys: ["oracledb.sga.component.name"],
      seriesCombine: "sum",
      enabledByDefault: false,
    },
    {
      system: "oracle.db",
      metricName: "oracledb.tablespace.utilization",
      title: "Fullest tablespace",
      description: `How full the fullest tablespace is.${AGENT_ENABLED_NOTE}`,
      unit: "fraction",
      aggregation: AggregationType.Max,
      kind: "gauge",
      seriesKeys: ["tablespace_name", "oracle.db.pdb"],
      seriesCombine: "max",
      enabledByDefault: false,
    },
    {
      system: "oracle.db",
      metricName: "oracledb.tablespace_size.usage",
      title: "Largest tablespace",
      description: "Bytes used in the largest tablespace.",
      unit: "bytes",
      aggregation: AggregationType.Max,
      kind: "gauge",
      seriesKeys: ["tablespace_name", "oracle.db.pdb"],
      seriesCombine: "max",
    },
    {
      system: "oracle.db",
      metricName: "oracledb.executions",
      title: "Executions",
      description:
        "SQL statements executed per second, every pluggable database added up.",
      unit: "executions",
      aggregation: AggregationType.Max,
      kind: "counter",
      seriesCombine: "sum",
    },
    {
      system: "oracle.db",
      metricName: "oracledb.user_commits",
      title: "Commits",
      description:
        "User commits per second, every pluggable database added up.",
      unit: "commits",
      aggregation: AggregationType.Max,
      kind: "counter",
      seriesCombine: "sum",
    },
    {
      system: "oracle.db",
      metricName: "oracledb.physical_reads",
      title: "Physical reads",
      description:
        "Data blocks read from disk per second, every pluggable database added up.",
      unit: "reads",
      aggregation: AggregationType.Max,
      kind: "counter",
      seriesCombine: "sum",
    },
  ];

/**
 * The curated metrics for an engine, in display order. Aliases are accepted
 * ("postgres" → PostgreSQL's), and a fork its family's receiver monitors
 * gets its family's set (Valkey → Redis's, MariaDB → MySQL's: that
 * receiver's metric names are what arrive). Empty for an engine without a
 * curated set — the Overview then shows its "engine metrics not connected"
 * state.
 */
export function getDatabaseServerMetrics(
  system: string | null | undefined,
): Array<DatabaseServerMetricDefinition> {
  const engine: string | null = getDatabaseSystemMetricsEngine(system);
  if (!engine) {
    return [];
  }
  return DATABASE_SERVER_METRICS.filter(
    (metric: DatabaseServerMetricDefinition): boolean => {
      return metric.system === engine;
    },
  );
}

/**
 * A stable id for a catalog entry — the metric name, plus its pinned
 * attributes when it has any ("mysql.threads{kind=running}"). One metric can
 * back several entries, so the name alone is not unique.
 */
export function getDatabaseServerMetricId(
  definition: DatabaseServerMetricDefinition,
): string {
  const pins: Array<string> = Object.keys(definition.attributes || {})
    .sort()
    .map((key: string): string => {
      return `${key}=${definition.attributes![key]}`;
    });
  return pins.length > 0
    ? `${definition.metricName}{${pins.join(",")}}`
    : definition.metricName;
}

/**
 * The attribute keys a gauge is grouped by: its own series keys, then the
 * reporting instance. Deduplicated, in that order.
 */
export function getDatabaseServerMetricGroupKeys(
  definition: DatabaseServerMetricDefinition,
): Array<string> {
  const keys: Array<string> = [];
  for (const key of [
    ...(definition.seriesKeys || []),
    ...DATABASE_SERVER_INSTANCE_ATTRIBUTE_KEYS,
  ]) {
    if (!keys.includes(key)) {
      keys.push(key);
    }
  }
  return keys;
}

/**
 * The catalog entry a metric NAME is charted with on the Metrics tab: the
 * engine's entry for that name, preferring one that pins nothing (an
 * unpinned entry describes the whole metric). Null when the name is not
 * curated for this engine.
 */
export function findDatabaseServerMetricByName(
  system: string | null | undefined,
  metricName: string,
): DatabaseServerMetricDefinition | null {
  const name: string = (metricName || "").trim();
  const matches: Array<DatabaseServerMetricDefinition> =
    getDatabaseServerMetrics(system).filter(
      (candidate: DatabaseServerMetricDefinition): boolean => {
        return candidate.metricName === name;
      },
    );
  return (
    matches.find((candidate: DatabaseServerMetricDefinition): boolean => {
      return Object.keys(candidate.attributes || {}).length === 0;
    }) ||
    matches[0] ||
    null
  );
}
