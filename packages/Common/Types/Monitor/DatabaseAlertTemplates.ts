import ObjectID from "../ObjectID";
import MonitorStep from "./MonitorStep";
import MonitorCriteria from "./MonitorCriteria";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import FilterCondition from "../Filter/FilterCondition";
import { EvaluateOverTimeType, FilterType } from "./CriteriaFilter";
import MonitorType from "./MonitorType";
import RollingTime from "../RollingTime/RollingTime";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";
import MetricQueryConfigData from "../Metrics/MetricQueryConfigData";
import MetricFormulaConfigData from "../Metrics/MetricFormulaConfigData";
import {
  DatabaseSystemDescriptor,
  getDatabaseSystemDescriptor,
} from "../DatabaseServer/DatabaseSystem";
import {
  AdditionalCriteriaFilterSpec,
  buildHealthyCriteriaInstance,
  buildUnhealthyCriteriaInstance,
  getRecoveryFilterType,
} from "./Recommendation/RecommendationCriteriaBuilder";

/*
 * The curated alert library for ONE database server (a DatabaseServer row),
 * built from the metrics the OpenTelemetry Collector contrib database
 * receivers emit — the receivers the OneUptime Database Agent runs, pinned
 * to collector-contrib v0.161.0.
 *
 * WHY THESE ARE METRICS MONITORS AND NOT A "DATABASE" MONITOR TYPE
 *
 * `MonitorType.Database` already exists and means something else: the
 * probe-based "Database Health" monitor, which logs in and runs catalog
 * queries. A database's engine telemetry is ordinary OTel metrics, so these
 * templates create plain `MonitorType.Metrics` monitors — the same pattern
 * the Service and RUM libraries use — and get the generic metric evaluator,
 * the monitor-overview preview and the incident root-cause chart for free.
 *
 * WHAT MAKES THEM THIS DATABASE'S MONITORS
 *
 * Every query filters `oneuptime.database.server.id = <row id>`, the stamp
 * ingest adds to every row of a batch it attributed to a DatabaseServer
 * (`TelemetryUtil.getAttributesForDatabaseServerIdAndName`). That one filter
 * does three jobs:
 *
 *   1. It scopes the query to this database. Receivers do not share a
 *      resource attribute that identifies an instance (Redis reports only
 *      its version by default, Memcached nothing at all), so the stamp is the
 *      only key that works for every engine.
 *   2. It links what the monitor opens to the database:
 *      MonitorStepResourceIdentity reads the filter, and the alert or
 *      incident lands on the database's Alerts / Incidents tabs and badges.
 *   3. It is independent of `primaryEntityId`. A user's own collector that
 *      keeps a `service.name` makes that Service the rows' primary entity,
 *      but the stamp is still there — so scoping by `telemetryServiceIds`
 *      would silently match nothing, while this keeps working.
 *
 * WHY THE SET DEPENDS ON THE ENGINE
 *
 * Each engine's receiver emits its own metric names, so a PostgreSQL template
 * on a Redis server queries a metric nobody emits and never fires — a monitor
 * that makes a team believe it is covered while watching nothing. Templates
 * carry the collector RECEIVER whose metric names they read, and
 * `getDatabaseAlertTemplates(engine)` returns the templates of the receivers
 * that monitor that engine (`DatabaseSystemDescriptor.receiverTypes`). So a
 * fork its family's receiver works against gets the family's set — MariaDB
 * the MySQL one, Valkey the Redis one — while a wire-compatible engine the
 * receiver does NOT work against (CockroachDB speaks the PostgreSQL protocol
 * but is not a `postgresql` receiver target) gets nothing rather than
 * monitors that can never fire. There is no engine-agnostic subset: nothing
 * the receivers emit is common to every engine.
 *
 * THE PLATFORM CONSTRAINT THAT SHAPES EVERY TEMPLATE
 *
 * The monitor path has no rate: `AggregationType` stops at Sum / Avg / Min /
 * Max / Count / percentiles, `EvaluateOverTimeType` has no delta, and the
 * per-second transform on `MetricQueryConfigData` is chart-only. A cumulative
 * monotonic counter (slow queries, deadlocks, rejected connections, evicted
 * keys) thresholded raw compares against a since-restart total that only
 * grows: it fires once and never clears. So every template here thresholds a
 * GAUGE (or a non-monotonic sum, which is a gauge in all but name), a ratio of
 * two gauges measured in the SAME scrape of the SAME receiver, or — for
 * restart detection only — an uptime counter whose current value is itself
 * the answer. `DATABASE_ALERT_METRICS` records the instrument of every metric
 * a template reads, `UNALERTABLE_DATABASE_COUNTERS` names the tempting
 * counters that are deliberately absent, and the tests enforce both.
 *
 * AGGREGATION CONTRACT
 *
 * The queries are ungrouped, so the ClickHouse aggregation folds every series
 * AND every scrape inside a one-minute bucket into one number:
 *
 *   - Ratios use Sum over both sides. Numerator and denominator ride the same
 *     scrape, so the scrape count multiplies both and cancels — Σ backends
 *     over three databases and two scrapes, divided by Σ max_connections over
 *     the same two scrapes, is exactly "connections / limit". (MongoDB even
 *     repeats its server-wide connection counts once per database; the
 *     repetition cancels the same way.) That only holds while each side is
 *     recorded the same way on every scrape: the Elasticsearch receiver
 *     records jvm.memory.heap.used once per node AND once more for the whole
 *     cluster, with no matching heap.max, so a Sum/Sum heap ratio reads
 *     double — which is why the heap template reads the per-node
 *     utilization instead.
 *   - A per-server level uses Max (worst replica, fullest log, largest
 *     database, hottest node) or Min (lowest page life expectancy, lowest
 *     uptime) — the aggregation IS the reduction, which is why none of these
 *     needs a group-by and why every alert reads as "this database", not as
 *     a series.
 *   - Averages are used only to smooth a level one server reports once per
 *     scrape (Redis's fragmentation ratio and the memory it is judged
 *     against), where a single noisy reading should not decide.
 *
 * Optional receiver metrics (disabled by default in the receiver) are used
 * only where the OneUptime Database Agent enables them, and every such
 * template names the metric in its description so a team running its own
 * collector knows what to switch on.
 *
 * WHAT ACTUALLY ARRIVES
 *
 * A receiver's metadata says what it CAN emit, not what a given setup
 * returns, so a metric is only used here once it has been seen arriving from
 * the Database Agent's own config on its default setup (collector-contrib
 * 0.161.0), or its receiver's source shows when it is recorded. Five
 * engines differ from their metadata:
 *
 *   - PostgreSQL: the receiver's `postgresqlreceiver.preciselagmetrics`
 *     feature gate is beta — on by default — and under it the replication
 *     time lag is recorded as postgresql.wal.delay INSTEAD of
 *     postgresql.wal.lag. wal.delay is off by default; the agent enables it.
 *   - MongoDB: mongodb.health is recorded from serverStatus's `ok` only
 *     after serverStatus succeeded, so it can only ever read 1 and no
 *     template reads it.
 *   - Elasticsearch records jvm.memory.heap.used twice per scrape (see the
 *     aggregation contract above).
 *   - SQL Server connected directly — the agent's setup, and the only one
 *     off Windows — is read through sys.dm_os_performance_counters. That view
 *     has no transaction-log usage and no average lock wait time (Windows
 *     performance counters only), and its "/sec" counters come through as
 *     since-start totals, so every `sqlserver.*.rate` metric only ever grows
 *     there and is no threshold's input.
 *   - Oracle connected to a pluggable database (FREEPDB1, ORCLPDB1: the usual
 *     setup) returns no SESSIONS / PROCESSES limits, so no
 *     "percent of the limit" template can be built for it.
 *
 * The tests pin all of it: no template reads a metric measured never to
 * arrive or one that can never fire, none sums a metric recorded twice per
 * scrape, and none thresholds a SQL Server rate.
 */

export type DatabaseAlertTemplateCategory =
  | "Availability"
  | "Connections"
  | "Replication"
  | "Memory"
  | "Performance"
  | "Storage";

export type DatabaseAlertTemplateSeverity = "Critical" | "Warning";

export interface DatabaseAlertTemplateArgs {
  // The DatabaseServer row id every query is scoped to.
  databaseServerId: string;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
}

export interface DatabaseAlertTemplate {
  id: string;
  name: string;
  description: string;
  category: DatabaseAlertTemplateCategory;
  severity: DatabaseAlertTemplateSeverity;
  // Always Metrics today; carried per template the way Service / RUM do.
  monitorType: MonitorType;
  /*
   * The engine (semconv `db.system.name`) whose receiver the template was
   * written against — the value that receiver reports.
   */
  engine: string;
  /*
   * The collector-contrib receiver type ("postgresql", "sqlserver") whose
   * metric names the template reads. What `getDatabaseAlertTemplates`
   * matches on: a database gets the templates of the receivers that monitor
   * its engine (DatabaseSystemDescriptor.receiverTypes).
   */
  receiver: string;
  // Every metric name the template's queries read, in query order.
  metricNames: Array<string>;
  getMonitorStep: (args: DatabaseAlertTemplateArgs) => MonitorStep;
}

/*
 * One engine as the builders below see it: the engine the receiver reports,
 * the receiver itself, and the name sentences use.
 */
interface DatabaseTemplateEngine {
  engine: string;
  receiver: string;
  displayName: string;
}

/*
 * The attribute ingest stamps on every row of a database's own telemetry, and
 * the one every template query filters on. Kept as a literal here rather than
 * imported from the server-side ingest code: Types must stay isomorphic.
 */
export const DATABASE_SERVER_ID_SCOPE_ATTRIBUTE: string =
  "oneuptime.database.server.id";

/*
 * How a metric's value behaves over time, which decides whether a static
 * threshold on it means anything:
 *
 *   gauge    a level (OTel Gauge, or a non-monotonic Sum / UpDownCounter).
 *            Thresholdable as-is.
 *   elapsed  a monotonic Sum that counts time since the process started
 *            (uptime). Its current value IS the answer — a low value means a
 *            recent restart — so it is thresholdable, but only as "below".
 *   counter  a cumulative monotonic Sum. Never thresholdable in the monitor
 *            path, which has no rate; listed only so the tests can prove no
 *            template reads one.
 */
export type DatabaseAlertMetricKind = "gauge" | "elapsed" | "counter";

export interface DatabaseAlertMetric {
  engine: string;
  // The collector-contrib receiver type that emits it ("sqlserver").
  receiver: string;
  metricName: string;
  kind: DatabaseAlertMetricKind;
  // The receiver's own unit (UCUM), as ingest stores it.
  unit: string;
  /*
   * Whether the receiver emits it without configuration. An optional metric
   * is only ever used when the Database Agent's config for the receiver
   * (agents/DatabaseAgent/configs/<receiver>.yaml) switches it on — the
   * tests read that config — and the template's description says so, for
   * a team running its own collector.
   */
  enabledByDefault: boolean;
}

/*
 * Every metric a template reads, verified against the v0.161.0
 * `metadata.yaml` of each receiver (name, instrument, monotonicity, unit,
 * default enablement). The datapoint attribute filters the templates use are
 * the receivers' stored attribute names (`kind`, `status`, `type`,
 * `operation`), which is what ingest writes into the row's attribute map.
 */
export const DATABASE_ALERT_METRICS: ReadonlyArray<DatabaseAlertMetric> = [
  // PostgreSQL — postgresqlreceiver.
  {
    engine: "postgresql",
    receiver: "postgresql",
    metricName: "postgresql.backends",
    kind: "gauge",
    unit: "1",
    enabledByDefault: true,
  },
  {
    engine: "postgresql",
    receiver: "postgresql",
    metricName: "postgresql.connection.max",
    kind: "gauge",
    unit: "{connections}",
    enabledByDefault: true,
  },
  {
    engine: "postgresql",
    receiver: "postgresql",
    /*
     * Not postgresql.wal.lag: the `postgresqlreceiver.preciselagmetrics`
     * gate is beta (on by default) in 0.161.0, and under it the receiver
     * records this metric INSTEAD — so wal.lag never arrives (see the
     * module header).
     */
    metricName: "postgresql.wal.delay",
    kind: "gauge",
    unit: "s",
    enabledByDefault: false,
  },
  {
    engine: "postgresql",
    receiver: "postgresql",
    metricName: "postgresql.replication.data_delay",
    kind: "gauge",
    unit: "By",
    enabledByDefault: true,
  },
  {
    engine: "postgresql",
    receiver: "postgresql",
    metricName: "postgresql.db_size",
    kind: "gauge",
    unit: "By",
    enabledByDefault: true,
  },

  // MySQL / MariaDB — mysqlreceiver.
  {
    engine: "mysql",
    receiver: "mysql",
    metricName: "mysql.threads",
    kind: "gauge",
    unit: "1",
    enabledByDefault: true,
  },
  {
    engine: "mysql",
    receiver: "mysql",
    metricName: "mysql.buffer_pool.usage",
    kind: "gauge",
    unit: "By",
    enabledByDefault: true,
  },
  {
    engine: "mysql",
    receiver: "mysql",
    metricName: "mysql.buffer_pool.limit",
    kind: "gauge",
    unit: "By",
    enabledByDefault: true,
  },
  {
    engine: "mysql",
    receiver: "mysql",
    metricName: "mysql.replica.time_behind_source",
    kind: "gauge",
    unit: "s",
    enabledByDefault: false,
  },
  {
    engine: "mysql",
    receiver: "mysql",
    metricName: "mysql.uptime",
    kind: "elapsed",
    unit: "s",
    enabledByDefault: true,
  },

  // Redis / Valkey — redisreceiver.
  {
    engine: "redis",
    receiver: "redis",
    metricName: "redis.memory.used",
    kind: "gauge",
    unit: "By",
    enabledByDefault: true,
  },
  {
    engine: "redis",
    receiver: "redis",
    metricName: "redis.maxmemory",
    kind: "gauge",
    unit: "By",
    enabledByDefault: false,
  },
  {
    engine: "redis",
    receiver: "redis",
    metricName: "redis.memory.fragmentation_ratio",
    kind: "gauge",
    unit: "1",
    enabledByDefault: true,
  },
  {
    engine: "redis",
    receiver: "redis",
    metricName: "redis.clients.connected",
    kind: "gauge",
    unit: "{client}",
    enabledByDefault: true,
  },
  {
    engine: "redis",
    receiver: "redis",
    metricName: "redis.uptime",
    kind: "elapsed",
    unit: "s",
    enabledByDefault: true,
  },

  // MongoDB — mongodbreceiver.
  {
    engine: "mongodb",
    receiver: "mongodb",
    metricName: "mongodb.connection.count",
    kind: "gauge",
    unit: "{connections}",
    enabledByDefault: true,
  },
  {
    engine: "mongodb",
    receiver: "mongodb",
    metricName: "mongodb.uptime",
    kind: "elapsed",
    unit: "ms",
    enabledByDefault: false,
  },
  {
    engine: "mongodb",
    receiver: "mongodb",
    metricName: "mongodb.database.count",
    kind: "gauge",
    unit: "{databases}",
    enabledByDefault: true,
  },

  /*
   * SQL Server — sqlserverreceiver, connected directly. Each of these is a
   * point-in-time value in sys.dm_os_performance_counters (the hit ratio is
   * computed against its base counter), unlike the "/sec" counters, which
   * arrive as since-start totals (see the module header).
   */
  {
    engine: "microsoft.sql_server",
    receiver: "sqlserver",
    metricName: "sqlserver.page.buffer_cache.hit_ratio",
    kind: "gauge",
    unit: "%",
    enabledByDefault: true,
  },
  {
    engine: "microsoft.sql_server",
    receiver: "sqlserver",
    metricName: "sqlserver.page.life_expectancy",
    kind: "gauge",
    unit: "s",
    enabledByDefault: true,
  },
  {
    engine: "microsoft.sql_server",
    receiver: "sqlserver",
    metricName: "sqlserver.processes.blocked",
    kind: "gauge",
    unit: "{processes}",
    enabledByDefault: false,
  },
  {
    engine: "microsoft.sql_server",
    receiver: "sqlserver",
    // A non-monotonic sum: a gauge in all but name.
    metricName: "sqlserver.memory.grants.pending.count",
    kind: "gauge",
    unit: "{grants}",
    enabledByDefault: false,
  },
  {
    engine: "microsoft.sql_server",
    receiver: "sqlserver",
    metricName: "sqlserver.user.connection.count",
    kind: "gauge",
    unit: "{connections}",
    enabledByDefault: true,
  },

  // Oracle — oracledbreceiver.
  {
    engine: "oracle.db",
    receiver: "oracledb",
    metricName: "oracledb.sessions.usage",
    kind: "gauge",
    unit: "{sessions}",
    enabledByDefault: true,
  },
  {
    engine: "oracle.db",
    receiver: "oracledb",
    // A 0..1 share of the tablespace's maximum size.
    metricName: "oracledb.tablespace.utilization",
    kind: "gauge",
    unit: "1",
    enabledByDefault: false,
  },

  // Elasticsearch — elasticsearchreceiver.
  {
    engine: "elasticsearch",
    receiver: "elasticsearch",
    metricName: "elasticsearch.cluster.health",
    kind: "gauge",
    unit: "{status}",
    enabledByDefault: true,
  },
  {
    engine: "elasticsearch",
    receiver: "elasticsearch",
    metricName: "elasticsearch.cluster.pending_tasks",
    kind: "gauge",
    unit: "{tasks}",
    enabledByDefault: true,
  },
  {
    engine: "elasticsearch",
    receiver: "elasticsearch",
    /*
     * A 0..1 share of the node's heap maximum, recorded per node only. Not
     * jvm.memory.heap.used / heap.max: the receiver records heap.used a
     * second time, for the whole cluster, in the same scrape (see the
     * aggregation contract in the module header).
     */
    metricName: "jvm.memory.heap.utilization",
    kind: "gauge",
    unit: "1",
    enabledByDefault: false,
  },

  // Memcached — memcachedreceiver.
  {
    engine: "memcached",
    receiver: "memcached",
    metricName: "memcached.connections.current",
    kind: "gauge",
    unit: "{connections}",
    enabledByDefault: true,
  },
  {
    engine: "memcached",
    receiver: "memcached",
    metricName: "memcached.threads",
    kind: "gauge",
    unit: "{threads}",
    enabledByDefault: true,
  },

  // CouchDB — couchdbreceiver.
  {
    engine: "couchdb",
    receiver: "couchdb",
    metricName: "couchdb.average_request_time",
    kind: "gauge",
    unit: "ms",
    enabledByDefault: true,
  },
  {
    engine: "couchdb",
    receiver: "couchdb",
    metricName: "couchdb.database.open",
    kind: "gauge",
    unit: "{databases}",
    enabledByDefault: true,
  },
];

/*
 * The alert-worthy signals a team will ask for first, and why none of them is
 * a template. Every one is a cumulative monotonic counter (verified against
 * the v0.161.0 receiver metadata) — or, like SQL Server's deadlock "rate",
 * a gauge whose value on the agent's direct connection is the since-start
 * total — so the monitor path, which has no rate, can only compare its
 * since-restart total against a threshold. They remain visible on the
 * database's Metrics tab.
 *
 * The honest workaround for a team that needs one of these alerted today is
 * a `cumulativetodelta` processor in its collector pipeline, which turns the
 * counter into per-interval deltas that a Sum over the window does threshold
 * correctly. That processor only converts sums, so it leaves SQL Server's
 * deadlock total (typed a gauge) as it is.
 */
export const UNALERTABLE_DATABASE_COUNTERS: ReadonlyArray<{
  engine: string;
  metricName: string;
  wouldAlertOn: string;
}> = [
  {
    engine: "postgresql",
    metricName: "postgresql.deadlocks",
    wouldAlertOn: "deadlocks",
  },
  {
    engine: "postgresql",
    metricName: "postgresql.rollbacks",
    wouldAlertOn: "a rollback spike",
  },
  {
    engine: "mysql",
    metricName: "mysql.query.slow.count",
    wouldAlertOn: "slow queries",
  },
  {
    engine: "mysql",
    metricName: "mysql.connection.errors",
    wouldAlertOn: "connections refused at max_connections",
  },
  {
    engine: "redis",
    metricName: "redis.connections.rejected",
    wouldAlertOn: "connections rejected at maxclients",
  },
  {
    engine: "redis",
    metricName: "redis.keys.evicted",
    wouldAlertOn: "evictions",
  },
  {
    engine: "mongodb",
    metricName: "mongodb.lock.deadlock.count",
    wouldAlertOn: "lock deadlocks",
  },
  {
    engine: "microsoft.sql_server",
    metricName: "sqlserver.deadlock.rate",
    wouldAlertOn: "deadlocks",
  },
  {
    engine: "oracle.db",
    metricName: "oracledb.enqueue_deadlocks",
    wouldAlertOn: "enqueue deadlocks",
  },
  {
    engine: "elasticsearch",
    metricName: "elasticsearch.breaker.tripped",
    wouldAlertOn: "circuit breakers tripping",
  },
  {
    engine: "memcached",
    metricName: "memcached.evictions",
    wouldAlertOn: "evictions",
  },
];

export function getDatabaseAlertMetric(
  metricName: string,
): DatabaseAlertMetric | undefined {
  return DATABASE_ALERT_METRICS.find((metric: DatabaseAlertMetric): boolean => {
    return metric.metricName === metricName;
  });
}

// --- builders ---

interface DatabaseQuerySpec {
  alias: string;
  metricName: string;
  aggregationType: MetricsAggregationType;
  // Datapoint attribute filters on top of the database scope.
  attributes?: Record<string, string> | undefined;
  /*
   * The unit the alert and incident text formats the query's values in.
   * Left unset, the evaluator falls back to the metric's native unit, which
   * is right for every metric but a dimensionless one the formatter would
   * misread (see the Redis fragmentation template).
   */
  legendUnit?: string | undefined;
}

interface DatabaseCriteriaSpec {
  // The query or formula alias the criteria compares.
  metricAlias: string;
  filterType: FilterType;
  threshold: number;
  /*
   * The comparison as a phrase that follows "stays" / "reads" — "at or above
   * 90%", "below 300 seconds". Used in the criteria's name and description.
   */
  thresholdLabel: string;
  /*
   * What the criteria compares, in words, when that is not simply the one
   * query's metric name (a formula). Derived from the queries otherwise.
   */
  subject?: string | undefined;
  /*
   * Defaults to sustained (AllValues). Only a genuinely single-event signal —
   * a restart — overrides it, and says why where it does.
   */
  evaluation?: EvaluateOverTimeType | undefined;
  // A strictly 0/1 gauge: no recovery dead band, which it could never cross.
  isBinaryMetric?: boolean | undefined;
  // The metric going silent is the breach (see the "stopped" templates).
  triggerOnNoData?: boolean | undefined;
  /*
   * A second comparison that must ALSO hold for the breach (FilterCondition
   * All), and whose recovery alone clears it (FilterCondition Any). `label`
   * is the clause the description appends, e.g. "redis.memory.used is at or
   * above 256 MB".
   */
  additionalFilter?:
    | (AdditionalCriteriaFilterSpec & { label: string })
    | undefined;
  incidentDescription: string;
}

/*
 * "mysql.threads (kind = running)" — a query as the criteria description
 * names it. The database scope is left out: every query carries it, and it
 * is an id nobody reads.
 */
function describeQuery(query: DatabaseQuerySpec): string {
  const filters: Array<string> = Object.keys(query.attributes || {}).map(
    (key: string): string => {
      return `${key} = ${(query.attributes || {})[key]}`;
    },
  );

  return filters.length > 0
    ? `${query.metricName} (${filters.join(", ")})`
    : query.metricName;
}

function describeCriteria(data: {
  subject: string;
  criteria: DatabaseCriteriaSpec;
}): string {
  if (data.criteria.triggerOnNoData) {
    return `Triggers when ${data.subject} reports no data for the whole evaluation window.`;
  }

  if (data.criteria.evaluation === EvaluateOverTimeType.AnyValue) {
    return `Triggers when ${data.subject} reads ${data.criteria.thresholdLabel} at any point in the evaluation window.`;
  }

  const alsoRequired: string = data.criteria.additionalFilter
    ? `, while ${data.criteria.additionalFilter.label}`
    : "";

  return `Triggers when ${data.subject} stays ${data.criteria.thresholdLabel} for the whole evaluation window${alsoRequired}.`;
}

/*
 * One query of a database template. The database scope is added HERE, to
 * every query, rather than by each template — a template that forgot it would
 * watch the whole project and attach its alerts to nothing.
 */
function buildDatabaseQuery(data: {
  spec: DatabaseQuerySpec;
  databaseServerId: string;
  title: string;
}): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable: data.spec.alias,
      title: data.title,
      description: data.title,
      legend: data.title,
      legendUnit: data.spec.legendUnit,
    },
    metricQueryData: {
      filterData: {
        metricName: data.spec.metricName,
        attributes: {
          ...(data.spec.attributes || {}),
          [DATABASE_SERVER_ID_SCOPE_ATTRIBUTE]: data.databaseServerId,
        },
        aggegationType: data.spec.aggregationType,
        aggregateBy: {},
      },
    },
  };
}

function buildDatabaseCriteria(data: {
  args: DatabaseAlertTemplateArgs;
  templateName: string;
  subject: string;
  criteria: DatabaseCriteriaSpec;
}): MonitorCriteria {
  const criteria: DatabaseCriteriaSpec = data.criteria;

  const incidentTitle: string = `[Database] ${data.templateName} - ${data.args.monitorName}`;

  const additionalFilter: AdditionalCriteriaFilterSpec | undefined =
    criteria.additionalFilter
      ? {
          metricAlias: criteria.additionalFilter.metricAlias,
          filterType: criteria.additionalFilter.filterType,
          value: criteria.additionalFilter.value,
        }
      : undefined;

  const unhealthy: MonitorCriteriaInstance = buildUnhealthyCriteriaInstance({
    offlineMonitorStatusId: data.args.offlineMonitorStatusId,
    incidentSeverityId: data.args.defaultIncidentSeverityId,
    alertSeverityId: data.args.defaultAlertSeverityId,
    monitorName: data.args.monitorName,
    metricAlias: criteria.metricAlias,
    filterType: criteria.filterType,
    value: criteria.threshold,
    incidentTitle: incidentTitle,
    incidentDescription: criteria.incidentDescription,
    criteriaName: `${data.templateName} - ${criteria.thresholdLabel}`,
    criteriaDescription: describeCriteria({
      subject: data.subject,
      criteria: criteria,
    }),
    resourceNoun: "database",
    metricAggregationType: criteria.evaluation,
    triggerOnNoData: criteria.triggerOnNoData,
    additionalFilters: additionalFilter ? [additionalFilter] : undefined,
    filterCondition: additionalFilter ? FilterCondition.All : undefined,
  });

  /*
   * Recovery mirrors the breach: the complementary comparison, the same
   * sustained evaluation, and — for a two-condition breach — Any, so the
   * monitor is healthy again as soon as EITHER condition has cleared.
   */
  const healthy: MonitorCriteriaInstance = buildHealthyCriteriaInstance({
    onlineMonitorStatusId: data.args.onlineMonitorStatusId,
    metricAlias: criteria.metricAlias,
    filterType: getRecoveryFilterType(criteria.filterType),
    value: criteria.threshold,
    isBinaryMetric: criteria.isBinaryMetric,
    metricAggregationType:
      criteria.evaluation === EvaluateOverTimeType.AnyValue
        ? EvaluateOverTimeType.AllValues
        : criteria.evaluation,
    additionalFilters: additionalFilter
      ? [
          {
            metricAlias: additionalFilter.metricAlias,
            filterType: getRecoveryFilterType(additionalFilter.filterType),
            value: additionalFilter.value,
          },
        ]
      : undefined,
    filterCondition: additionalFilter ? FilterCondition.Any : undefined,
  });

  const monitorCriteria: MonitorCriteria = new MonitorCriteria();
  monitorCriteria.data = {
    monitorCriteriaInstanceArray: [unhealthy, healthy],
  };

  return monitorCriteria;
}

interface DatabaseTemplateSpec {
  id: string;
  name: string;
  description: string;
  category: DatabaseAlertTemplateCategory;
  severity: DatabaseAlertTemplateSeverity;
  engine: DatabaseTemplateEngine;
  queries: Array<DatabaseQuerySpec>;
  /*
   * Optional formula over the query aliases; when present the criteria
   * compares `formulaAlias`. Every alias — query and formula — must differ:
   * the evaluator resolves an alias against the queries first and the
   * formulas second, and an alias matching nothing silently falls back to
   * the first query's result.
   */
  formula?:
    | { alias: string; expression: string; legendUnit?: string | undefined }
    | undefined;
  rollingTime?: RollingTime | undefined;
  criteria: DatabaseCriteriaSpec;
}

function buildDatabaseTemplate(
  spec: DatabaseTemplateSpec,
): DatabaseAlertTemplate {
  return {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    category: spec.category,
    severity: spec.severity,
    monitorType: MonitorType.Metrics,
    engine: spec.engine.engine,
    receiver: spec.engine.receiver,
    metricNames: spec.queries.map((query: DatabaseQuerySpec): string => {
      return query.metricName;
    }),
    getMonitorStep: (args: DatabaseAlertTemplateArgs): MonitorStep => {
      const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
        monitorName: args.monitorName,
        monitorType: MonitorType.Metrics,
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        defaultIncidentSeverityId: args.defaultIncidentSeverityId,
        defaultAlertSeverityId: args.defaultAlertSeverityId,
      });

      const formulaConfigs: Array<MetricFormulaConfigData> = spec.formula
        ? [
            {
              metricAliasData: {
                metricVariable: spec.formula.alias,
                title: spec.name,
                description: spec.name,
                legend: spec.name,
                legendUnit: spec.formula.legendUnit,
              },
              metricFormulaData: {
                metricFormula: spec.formula.expression,
              },
            },
          ]
        : [];

      step.setMetricMonitor({
        rollingTime: spec.rollingTime || RollingTime.Past5Minutes,
        metricViewConfig: {
          queryConfigs: spec.queries.map(
            (query: DatabaseQuerySpec): MetricQueryConfigData => {
              return buildDatabaseQuery({
                spec: query,
                databaseServerId: args.databaseServerId,
                title:
                  spec.queries.length > 1
                    ? `${spec.name} (${query.alias})`
                    : spec.name,
              });
            },
          ),
          formulaConfigs: formulaConfigs,
        },
      });

      step.setMonitorCriteria(
        buildDatabaseCriteria({
          args: args,
          templateName: spec.name,
          subject: getCriteriaSubject(spec),
          criteria: spec.criteria,
        }),
      );

      return step;
    },
  };
}

/*
 * What the criteria compares, for its description: the explicit subject when
 * the template gave one, else the query the criteria's alias names.
 */
function getCriteriaSubject(spec: DatabaseTemplateSpec): string {
  if (spec.criteria.subject) {
    return spec.criteria.subject;
  }

  const query: DatabaseQuerySpec | undefined = spec.queries.find(
    (candidate: DatabaseQuerySpec): boolean => {
      return candidate.alias === spec.criteria.metricAlias;
    },
  );

  return query ? describeQuery(query) : spec.name;
}

/*
 * `(numerator / denominator) * 100` over two Sum queries — see the
 * aggregation contract in the module header for why Sum is right for a
 * same-scrape ratio.
 */
function buildPercentOfLimitTemplate(data: {
  id: string;
  name: string;
  description: string;
  category: DatabaseAlertTemplateCategory;
  severity: DatabaseAlertTemplateSeverity;
  engine: DatabaseTemplateEngine;
  numerator: DatabaseQuerySpec;
  denominator: DatabaseQuerySpec;
  resultAlias: string;
  thresholdPercent: number;
  rollingTime?: RollingTime | undefined;
  incidentDescription: string;
}): DatabaseAlertTemplate {
  return buildDatabaseTemplate({
    id: data.id,
    name: data.name,
    description: data.description,
    category: data.category,
    severity: data.severity,
    engine: data.engine,
    queries: [data.numerator, data.denominator],
    formula: {
      alias: data.resultAlias,
      expression: `(${data.numerator.alias} / ${data.denominator.alias}) * 100`,
      legendUnit: "%",
    },
    rollingTime: data.rollingTime,
    criteria: {
      metricAlias: data.resultAlias,
      filterType: FilterType.GreaterThanOrEqualTo,
      threshold: data.thresholdPercent,
      thresholdLabel: `at or above ${data.thresholdPercent}%`,
      subject: `${describeQuery(data.numerator)} as a percentage of ${describeQuery(data.denominator)}`,
      incidentDescription: data.incidentDescription,
    },
  });
}

/*
 * The engine's own metrics stopped arriving.
 *
 * A database receiver that cannot connect — the server is down, refusing
 * logins, or out of connection slots — emits nothing at all, and so does a
 * collector that stopped. The absence is the only telemetry-side signal of
 * either, so this is the closest thing to "database down" engine metrics can
 * express. `metricName` is a metric the receiver emits once per successful
 * scrape; the threshold (`< 0`) is unreachable on purpose, so the criteria
 * only ever fires through its no-data policy.
 *
 * Offered only to a database whose engine metrics have been seen at least
 * once (see MonitorRecommendationContext.databaseEngineMetricsReported) —
 * on a database that has never reported them it would fire the moment it was
 * created.
 */
function buildEngineMetricsStoppedTemplate(data: {
  id: string;
  engine: DatabaseTemplateEngine;
  metricName: string;
  metricAlias: string;
}): DatabaseAlertTemplate {
  return buildDatabaseTemplate({
    id: data.id,
    name: "Engine Metrics Stopped",
    description: `Alert when no ${data.engine.displayName} engine metrics arrive for ten minutes — the server is down or refusing the collector's login, or the Database Agent / collector itself stopped. Reads ${data.metricName}, which the receiver emits on every successful scrape.`,
    category: "Availability",
    severity: "Critical",
    engine: data.engine,
    queries: [
      {
        alias: data.metricAlias,
        metricName: data.metricName,
        aggregationType: MetricsAggregationType.Count,
      },
    ],
    rollingTime: RollingTime.Past10Minutes,
    criteria: {
      metricAlias: data.metricAlias,
      filterType: FilterType.LessThan,
      threshold: 0,
      thresholdLabel: "silent (no data)",
      triggerOnNoData: true,
      incidentDescription: `No ${data.engine.displayName} engine metrics have arrived for ten minutes. Check, in order: whether the database accepts connections at all, whether the collector's login still works (password rotation and connection limits are the usual causes — the collector log names the error), and whether the Database Agent or collector process is running.`,
    },
  });
}

/*
 * A low uptime is a restart. `Min` per bucket, so a bucket spanning the
 * restart reads the post-restart value rather than the pre-restart one.
 *
 * The one family here that overrides the sustained default: a restart is an
 * EVENT, and requiring every sample of the window to be young would never be
 * true once the window is longer than the restart is old. `AnyValue` fires on
 * the first scrape after the restart and clears once the whole window has
 * aged past the threshold.
 */
function buildRestartTemplate(data: {
  id: string;
  engine: DatabaseTemplateEngine;
  metricName: string;
  metricAlias: string;
  // Ten minutes, in the metric's own unit (seconds, or MongoDB's ms).
  threshold: number;
  requiresEnabling?: boolean | undefined;
}): DatabaseAlertTemplate {
  return buildDatabaseTemplate({
    id: data.id,
    name: "Server Restarted",
    description: `Alert when the ${data.engine.displayName} server has been up for less than ten minutes — it restarted, crashed and came back, or failed over. Reads ${data.metricName}${
      data.requiresEnabling
        ? ", which the receiver only emits once it is enabled (the Database Agent enables it)"
        : ""
    }.`,
    category: "Availability",
    severity: "Warning",
    engine: data.engine,
    queries: [
      {
        alias: data.metricAlias,
        metricName: data.metricName,
        aggregationType: MetricsAggregationType.Min,
      },
    ],
    rollingTime: RollingTime.Past5Minutes,
    criteria: {
      metricAlias: data.metricAlias,
      filterType: FilterType.LessThan,
      threshold: data.threshold,
      thresholdLabel: "below ten minutes",
      evaluation: EvaluateOverTimeType.AnyValue,
      incidentDescription: `The ${data.engine.displayName} server restarted in the last ten minutes. If nobody restarted it, look for an out-of-memory kill in the host or container logs, then for a crash in the server's own log. A restart empties caches, so expect slower queries until they warm up.`,
    },
  });
}

// --- PostgreSQL ---

const POSTGRESQL: DatabaseTemplateEngine = {
  engine: "postgresql",
  receiver: "postgresql",
  displayName: "PostgreSQL",
};

const postgresqlTemplates: Array<DatabaseAlertTemplate> = [
  buildEngineMetricsStoppedTemplate({
    id: "database-postgresql-engine-metrics-stopped",
    engine: POSTGRESQL,
    metricName: "postgresql.connection.max",
    metricAlias: "pg_heartbeat",
  }),
  buildPercentOfLimitTemplate({
    id: "database-postgresql-connections-exhausted",
    name: "Connections Nearly Exhausted",
    description:
      'Alert when backends reach 95% of max_connections. Past 100% PostgreSQL refuses every new connection with "too many clients already".',
    category: "Connections",
    severity: "Critical",
    engine: POSTGRESQL,
    numerator: {
      alias: "pg_backends",
      metricName: "postgresql.backends",
      aggregationType: MetricsAggregationType.Sum,
    },
    denominator: {
      alias: "pg_max_connections",
      metricName: "postgresql.connection.max",
      aggregationType: MetricsAggregationType.Sum,
    },
    resultAlias: "pg_connections_percent_critical",
    thresholdPercent: 95,
    incidentDescription:
      "PostgreSQL is about to refuse new connections. Look for idle-in-transaction sessions in pg_stat_activity and for an application whose pool grew; a connection pooler such as PgBouncer is the durable fix, raising max_connections the stopgap.",
  }),
  buildPercentOfLimitTemplate({
    id: "database-postgresql-connections-high",
    name: "Connections Above 80% of max_connections",
    description:
      "Alert when backends stay at 80% of max_connections — the early warning before the connection limit. Backends include autovacuum and parallel workers.",
    category: "Connections",
    severity: "Warning",
    engine: POSTGRESQL,
    numerator: {
      alias: "pg_backends",
      metricName: "postgresql.backends",
      aggregationType: MetricsAggregationType.Sum,
    },
    denominator: {
      alias: "pg_max_connections",
      metricName: "postgresql.connection.max",
      aggregationType: MetricsAggregationType.Sum,
    },
    resultAlias: "pg_connections_percent_warning",
    thresholdPercent: 80,
    rollingTime: RollingTime.Past10Minutes,
    incidentDescription:
      "PostgreSQL connections have stayed above 80% of max_connections. Find the database and client holding them in pg_stat_activity before the limit is reached.",
  }),
  buildDatabaseTemplate({
    id: "database-postgresql-replica-replay-lag",
    name: "Replica Replay Lag",
    description:
      "Alert when the slowest replica stays 30 seconds or more behind this primary in replaying WAL. Reads postgresql.wal.delay (operation = replay), which the primary reports per connected replica and the receiver only emits once it is enabled (the Database Agent enables it).",
    category: "Replication",
    severity: "Warning",
    engine: POSTGRESQL,
    queries: [
      {
        alias: "pg_replay_lag",
        metricName: "postgresql.wal.delay",
        aggregationType: MetricsAggregationType.Max,
        attributes: { operation: "replay" },
      },
    ],
    criteria: {
      metricAlias: "pg_replay_lag",
      filterType: FilterType.GreaterThanOrEqualTo,
      threshold: 30,
      thresholdLabel: "at or above 30 seconds",
      incidentDescription:
        "A replica is 30 seconds or more behind the primary, so reads routed to it return stale data and a failover to it would lose those seconds. Check the replica's I/O and CPU, long-running queries on it that conflict with replay, and network throughput between the two.",
    },
  }),
  buildDatabaseTemplate({
    id: "database-postgresql-replication-byte-lag",
    name: "Replication Falling Behind (bytes)",
    description:
      "Alert when the slowest replica stays 1 GB or more of WAL behind this primary. Catches a replica that is streaming but not keeping up, even while the primary is too idle to report a time lag.",
    category: "Replication",
    severity: "Warning",
    engine: POSTGRESQL,
    queries: [
      {
        alias: "pg_replication_delay",
        metricName: "postgresql.replication.data_delay",
        aggregationType: MetricsAggregationType.Max,
      },
    ],
    criteria: {
      metricAlias: "pg_replication_delay",
      filterType: FilterType.GreaterThanOrEqualTo,
      // Decimal, like the byte ladder the alert text formats with: "1 GB".
      threshold: 1000000000,
      thresholdLabel: "at or above 1 GB",
      incidentDescription:
        "A replica has fallen 1 GB or more of WAL behind. The primary must keep that WAL until the replica catches up, so its disk fills as well; check the replica's disk throughput and the network link.",
    },
  }),
  buildDatabaseTemplate({
    id: "database-postgresql-database-size",
    name: "Database Size Above Budget",
    description:
      "Alert when the largest database on the server grows past 500 GB. An absolute budget — retune it to the disk the server actually has.",
    category: "Storage",
    severity: "Warning",
    engine: POSTGRESQL,
    queries: [
      {
        alias: "pg_database_size",
        metricName: "postgresql.db_size",
        aggregationType: MetricsAggregationType.Max,
      },
    ],
    rollingTime: RollingTime.Past15Minutes,
    criteria: {
      metricAlias: "pg_database_size",
      filterType: FilterType.GreaterThanOrEqualTo,
      // Decimal, like the byte ladder the alert text formats with: "500 GB".
      threshold: 500000000000,
      thresholdLabel: "at or above 500 GB",
      incidentDescription:
        "A database has grown past its size budget. Check for table and index bloat (autovacuum keeping up?), unbounded tables such as event logs, and how much headroom the volume has left.",
    },
  }),
];

// --- MySQL / MariaDB ---

const MYSQL: DatabaseTemplateEngine = {
  engine: "mysql",
  receiver: "mysql",
  displayName: "MySQL",
};

const mysqlTemplates: Array<DatabaseAlertTemplate> = [
  buildEngineMetricsStoppedTemplate({
    id: "database-mysql-engine-metrics-stopped",
    engine: MYSQL,
    metricName: "mysql.uptime",
    metricAlias: "mysql_heartbeat",
  }),
  buildRestartTemplate({
    id: "database-mysql-restarted",
    engine: MYSQL,
    metricName: "mysql.uptime",
    metricAlias: "mysql_uptime",
    threshold: 600,
  }),
  buildDatabaseTemplate({
    id: "database-mysql-connections-high",
    name: "Connections Near max_connections",
    description:
      "Alert when connected threads stay at 136 or more — 90% of the default max_connections of 151. The receiver reports no max_connections value, so retune this to 90% of the server's own setting.",
    category: "Connections",
    severity: "Warning",
    engine: MYSQL,
    queries: [
      {
        alias: "mysql_threads_connected",
        metricName: "mysql.threads",
        aggregationType: MetricsAggregationType.Max,
        attributes: { kind: "connected" },
      },
    ],
    criteria: {
      metricAlias: "mysql_threads_connected",
      filterType: FilterType.GreaterThanOrEqualTo,
      threshold: 136,
      thresholdLabel: "at or above 136 connections",
      incidentDescription:
        'MySQL connections are close to max_connections; past it the server answers every new client with "Too many connections". Look at SHOW PROCESSLIST for sleeping connections an application pool is holding.',
    },
  }),
  buildDatabaseTemplate({
    id: "database-mysql-threads-running-high",
    name: "Too Many Running Threads",
    description:
      "Alert when threads actively executing stay at 50 or more — CPU saturation or lock contention. Retune to about twice the server's vCPU count.",
    category: "Performance",
    severity: "Warning",
    engine: MYSQL,
    queries: [
      {
        alias: "mysql_threads_running",
        metricName: "mysql.threads",
        aggregationType: MetricsAggregationType.Max,
        attributes: { kind: "running" },
      },
    ],
    criteria: {
      metricAlias: "mysql_threads_running",
      filterType: FilterType.GreaterThanOrEqualTo,
      threshold: 50,
      thresholdLabel: "at or above 50 threads",
      incidentDescription:
        "More queries are executing at once than the server can run in parallel, so every one of them slows down. Check for a lock wait chain (SHOW ENGINE INNODB STATUS) and for a query that stopped using its index.",
    },
  }),
  buildPercentOfLimitTemplate({
    id: "database-mysql-buffer-pool-dirty",
    name: "InnoDB Dirty Pages High",
    description:
      "Alert when dirty pages stay at 75% of the InnoDB buffer pool — page flushing is not keeping up with writes, and a checkpoint stall is next. (A FULL buffer pool is normal; a DIRTY one is not.)",
    category: "Performance",
    severity: "Warning",
    engine: MYSQL,
    numerator: {
      alias: "mysql_buffer_pool_dirty",
      metricName: "mysql.buffer_pool.usage",
      aggregationType: MetricsAggregationType.Sum,
      attributes: { status: "dirty" },
    },
    denominator: {
      alias: "mysql_buffer_pool_size",
      metricName: "mysql.buffer_pool.limit",
      aggregationType: MetricsAggregationType.Sum,
    },
    resultAlias: "mysql_buffer_pool_dirty_percent",
    thresholdPercent: 75,
    rollingTime: RollingTime.Past10Minutes,
    incidentDescription:
      "Most of the InnoDB buffer pool is dirty, so InnoDB will soon stall writes to force a checkpoint. Check disk write latency and innodb_io_capacity, and whether a bulk load is running.",
  }),
  buildDatabaseTemplate({
    id: "database-mysql-replica-lag",
    name: "Replica Lag",
    description:
      "Alert when this replica stays 30 seconds or more behind its source. Reads mysql.replica.time_behind_source, which the receiver only emits once it is enabled (the Database Agent enables it).",
    category: "Replication",
    severity: "Warning",
    engine: MYSQL,
    queries: [
      {
        alias: "mysql_replica_lag",
        metricName: "mysql.replica.time_behind_source",
        aggregationType: MetricsAggregationType.Max,
      },
    ],
    criteria: {
      metricAlias: "mysql_replica_lag",
      filterType: FilterType.GreaterThanOrEqualTo,
      threshold: 30,
      thresholdLabel: "at or above 30 seconds",
      incidentDescription:
        "This replica is 30 seconds or more behind its source, so reads from it are stale. Check SHOW REPLICA STATUS for a long-running statement on the SQL thread, and the replica's disk and CPU.",
    },
  }),
];

// --- Redis / Valkey ---

const REDIS: DatabaseTemplateEngine = {
  engine: "redis",
  receiver: "redis",
  displayName: "Redis",
};

const redisTemplates: Array<DatabaseAlertTemplate> = [
  buildEngineMetricsStoppedTemplate({
    id: "database-redis-engine-metrics-stopped",
    engine: REDIS,
    metricName: "redis.uptime",
    metricAlias: "redis_heartbeat",
  }),
  buildRestartTemplate({
    id: "database-redis-restarted",
    engine: REDIS,
    metricName: "redis.uptime",
    metricAlias: "redis_uptime",
    threshold: 600,
  }),
  buildPercentOfLimitTemplate({
    id: "database-redis-memory-near-maxmemory",
    name: "Memory Near maxmemory",
    description:
      "Alert when used memory stays at 90% of maxmemory. Reads redis.maxmemory, which the receiver only emits once it is enabled (the Database Agent enables it); a server with no maxmemory set never fires.",
    category: "Memory",
    severity: "Warning",
    engine: REDIS,
    numerator: {
      alias: "redis_memory_used",
      metricName: "redis.memory.used",
      aggregationType: MetricsAggregationType.Sum,
    },
    denominator: {
      alias: "redis_maxmemory",
      metricName: "redis.maxmemory",
      aggregationType: MetricsAggregationType.Sum,
    },
    resultAlias: "redis_memory_percent",
    thresholdPercent: 90,
    rollingTime: RollingTime.Past10Minutes,
    incidentDescription:
      "Redis is close to maxmemory. With an eviction policy it is about to start evicting keys; with noeviction it is about to reject writes with OOM errors. Check which keys grew (redis-cli --bigkeys) and whether keys are missing a TTL.",
  }),
  buildDatabaseTemplate({
    id: "database-redis-memory-fragmentation",
    name: "Memory Fragmentation High",
    description:
      "Alert when the memory fragmentation ratio stays at 1.5 or more while Redis uses at least 256 MB — the process holds far more RAM than its data needs. Small instances are exempt: their ratio is naturally high and meaningless.",
    category: "Memory",
    severity: "Warning",
    engine: REDIS,
    queries: [
      {
        alias: "redis_fragmentation_ratio",
        metricName: "redis.memory.fragmentation_ratio",
        aggregationType: MetricsAggregationType.Avg,
        /*
         * The receiver's unit is the dimensionless "1", which on a `_ratio`
         * name the alert text reads as a 0..1 fraction and renders ×100
         * ("162.00% ... 150.00%"). This ratio is no fraction — healthy is
         * about 1.0 — so it is labelled with an annotation-only unit, which
         * formats as the bare number.
         */
        legendUnit: "{ratio}",
      },
      {
        alias: "redis_fragmentation_memory_used",
        metricName: "redis.memory.used",
        aggregationType: MetricsAggregationType.Avg,
      },
    ],
    rollingTime: RollingTime.Past15Minutes,
    criteria: {
      metricAlias: "redis_fragmentation_ratio",
      filterType: FilterType.GreaterThanOrEqualTo,
      threshold: 1.5,
      thresholdLabel: "at or above a ratio of 1.5",
      additionalFilter: {
        metricAlias: "redis_fragmentation_memory_used",
        filterType: FilterType.GreaterThanOrEqualTo,
        // Decimal, like the byte ladder the alert text formats with: "256 MB".
        value: 256000000,
        label: "redis.memory.used is at or above 256 MB",
      },
      incidentDescription:
        "Redis holds far more resident memory than its data needs. Enable active defragmentation (activedefrag yes) or plan a restart; if the ratio is BELOW 1 instead, the host is swapping, which is worse.",
    },
  }),
  buildDatabaseTemplate({
    id: "database-redis-clients-high",
    name: "Connected Clients Near maxclients",
    description:
      "Alert when connected clients stay at 9,000 or more — 90% of the default maxclients of 10,000. Retune to 90% of the server's own maxclients setting.",
    category: "Connections",
    severity: "Warning",
    engine: REDIS,
    queries: [
      {
        alias: "redis_clients_connected",
        metricName: "redis.clients.connected",
        aggregationType: MetricsAggregationType.Max,
      },
    ],
    criteria: {
      metricAlias: "redis_clients_connected",
      filterType: FilterType.GreaterThanOrEqualTo,
      threshold: 9000,
      thresholdLabel: "at or above 9,000 clients",
      incidentDescription:
        'Redis is close to maxclients; past it new connections are refused with "max number of clients reached". Look for a client that opens a connection per request instead of reusing a pool (CLIENT LIST, grouped by address).',
    },
  }),
];

// --- MongoDB ---

const MONGODB: DatabaseTemplateEngine = {
  engine: "mongodb",
  receiver: "mongodb",
  displayName: "MongoDB",
};

const mongodbTemplates: Array<DatabaseAlertTemplate> = [
  buildEngineMetricsStoppedTemplate({
    id: "database-mongodb-engine-metrics-stopped",
    engine: MONGODB,
    metricName: "mongodb.database.count",
    metricAlias: "mongodb_heartbeat",
  }),
  buildRestartTemplate({
    id: "database-mongodb-restarted",
    engine: MONGODB,
    metricName: "mongodb.uptime",
    metricAlias: "mongodb_uptime",
    // mongodb.uptime is reported in milliseconds.
    threshold: 600000,
    requiresEnabling: true,
  }),
  buildDatabaseTemplate({
    id: "database-mongodb-connections-exhausted",
    name: "Connections Nearly Exhausted",
    description:
      "Alert when current connections reach 90% of the connections the server can accept (current + available). Past 100% mongod refuses new connections.",
    category: "Connections",
    severity: "Critical",
    engine: MONGODB,
    queries: [
      {
        alias: "mongodb_connections_current",
        metricName: "mongodb.connection.count",
        aggregationType: MetricsAggregationType.Sum,
        attributes: { type: "current" },
      },
      {
        alias: "mongodb_connections_available",
        metricName: "mongodb.connection.count",
        aggregationType: MetricsAggregationType.Sum,
        attributes: { type: "available" },
      },
    ],
    formula: {
      alias: "mongodb_connections_percent",
      expression:
        "(mongodb_connections_current / (mongodb_connections_current + mongodb_connections_available)) * 100",
      legendUnit: "%",
    },
    criteria: {
      metricAlias: "mongodb_connections_percent",
      filterType: FilterType.GreaterThanOrEqualTo,
      threshold: 90,
      thresholdLabel: "at or above 90%",
      subject:
        "mongodb.connection.count (type = current) as a percentage of current + available",
      incidentDescription:
        "mongod is about to refuse new connections. Check which clients hold them (db.currentOp, $currentOp grouped by client) — usually a driver pool sized far above what the application needs, multiplied across every replica of it.",
    },
  }),
  /*
   * No "server reports unhealthy" template on mongodb.health: the receiver
   * records it from serverStatus's `ok` only after serverStatus succeeded,
   * so it can only ever read 1 — a server that is down emits nothing
   * (Engine Metrics Stopped covers that), and a replica-set member in
   * RECOVERING or ROLLBACK still answers ok:1.
   */
];

// --- SQL Server ---

const SQL_SERVER: DatabaseTemplateEngine = {
  engine: "microsoft.sql_server",
  receiver: "sqlserver",
  displayName: "SQL Server",
};

const sqlServerTemplates: Array<DatabaseAlertTemplate> = [
  buildEngineMetricsStoppedTemplate({
    id: "database-sqlserver-engine-metrics-stopped",
    engine: SQL_SERVER,
    metricName: "sqlserver.user.connection.count",
    metricAlias: "sqlserver_heartbeat",
  }),
  buildDatabaseTemplate({
    id: "database-sqlserver-buffer-cache-hit-ratio-low",
    name: "Buffer Cache Hit Ratio Low",
    description:
      "Alert when the buffer cache hit ratio stays below 90% — pages are being read from disk instead of memory.",
    category: "Performance",
    severity: "Warning",
    engine: SQL_SERVER,
    queries: [
      {
        alias: "sqlserver_buffer_cache_hit_ratio",
        metricName: "sqlserver.page.buffer_cache.hit_ratio",
        aggregationType: MetricsAggregationType.Min,
      },
    ],
    rollingTime: RollingTime.Past10Minutes,
    criteria: {
      metricAlias: "sqlserver_buffer_cache_hit_ratio",
      filterType: FilterType.LessThan,
      threshold: 90,
      thresholdLabel: "below 90%",
      incidentDescription:
        "SQL Server is reading pages from disk rather than memory. Check whether max server memory is set too low and whether a scan-heavy query is flushing the buffer pool.",
    },
  }),
  buildDatabaseTemplate({
    id: "database-sqlserver-page-life-expectancy-low",
    name: "Page Life Expectancy Low",
    description:
      "Alert when page life expectancy stays below 300 seconds — the buffer pool is churning under memory pressure.",
    category: "Memory",
    severity: "Warning",
    engine: SQL_SERVER,
    queries: [
      {
        alias: "sqlserver_page_life_expectancy",
        metricName: "sqlserver.page.life_expectancy",
        aggregationType: MetricsAggregationType.Min,
      },
    ],
    rollingTime: RollingTime.Past10Minutes,
    criteria: {
      metricAlias: "sqlserver_page_life_expectancy",
      filterType: FilterType.LessThan,
      threshold: 300,
      thresholdLabel: "below 300 seconds",
      incidentDescription:
        "Pages are leaving the buffer pool within five minutes of being read, so the server is short of memory for its working set. Check memory grants and large scans, then max server memory.",
    },
  }),
  buildDatabaseTemplate({
    id: "database-sqlserver-sessions-blocked",
    name: "Sessions Blocked",
    description:
      "Alert when sessions waiting on another session's lock are seen throughout ten minutes — a blocking chain that is not clearing. Reads sqlserver.processes.blocked, which the receiver only emits once it is enabled (the Database Agent enables it).",
    category: "Performance",
    severity: "Warning",
    engine: SQL_SERVER,
    queries: [
      {
        alias: "sqlserver_processes_blocked",
        metricName: "sqlserver.processes.blocked",
        // The worst scrape of each minute, across every agent reporting it.
        aggregationType: MetricsAggregationType.Max,
      },
    ],
    rollingTime: RollingTime.Past10Minutes,
    criteria: {
      metricAlias: "sqlserver_processes_blocked",
      filterType: FilterType.GreaterThanOrEqualTo,
      threshold: 1,
      thresholdLabel: "at or above 1 blocked session",
      incidentDescription:
        "Sessions have been blocked on locks for ten minutes. Find the head of the blocking chain in sys.dm_exec_requests (blocking_session_id) and what it is waiting on — usually a transaction an application opened and never committed.",
    },
  }),
  buildDatabaseTemplate({
    id: "database-sqlserver-memory-grants-pending",
    name: "Queries Waiting for Memory",
    description:
      "Alert when queries stay queued for a memory grant for five minutes — they cannot start until workspace memory frees up. Reads sqlserver.memory.grants.pending.count, which the receiver only emits once it is enabled (the Database Agent enables it).",
    category: "Memory",
    severity: "Warning",
    engine: SQL_SERVER,
    queries: [
      {
        alias: "sqlserver_memory_grants_pending",
        metricName: "sqlserver.memory.grants.pending.count",
        aggregationType: MetricsAggregationType.Max,
      },
    ],
    criteria: {
      metricAlias: "sqlserver_memory_grants_pending",
      filterType: FilterType.GreaterThanOrEqualTo,
      threshold: 1,
      thresholdLabel: "at or above 1 pending grant",
      incidentDescription:
        "Queries are waiting for workspace memory before they can run. sys.dm_exec_query_memory_grants lists them (grant_time is NULL for the waiters) next to the sorts and hashes holding the memory; then check max server memory.",
    },
  }),
];

// --- Oracle ---

const ORACLE: DatabaseTemplateEngine = {
  engine: "oracle.db",
  receiver: "oracledb",
  displayName: "Oracle",
};

/*
 * No "percent of the SESSIONS / PROCESSES limit" template: a connection to a
 * pluggable database, the usual setup, never returns either limit, so such a
 * monitor would watch nothing (see the module header).
 */
const oracleTemplates: Array<DatabaseAlertTemplate> = [
  buildEngineMetricsStoppedTemplate({
    id: "database-oracle-engine-metrics-stopped",
    engine: ORACLE,
    // One row per session type and status on every scrape: never empty.
    metricName: "oracledb.sessions.usage",
    metricAlias: "oracle_heartbeat",
  }),
  buildDatabaseTemplate({
    id: "database-oracle-tablespace-nearly-full",
    name: "Tablespace Nearly Full",
    description:
      "Alert when the fullest tablespace stays at 90% or more of its maximum size. A full tablespace refuses to extend the segments in it (ORA-01653; ORA-01652 for TEMP). Reads oracledb.tablespace.utilization, which the receiver only emits once it is enabled (the Database Agent enables it).",
    category: "Storage",
    severity: "Critical",
    engine: ORACLE,
    queries: [
      {
        alias: "oracle_tablespace_utilization",
        metricName: "oracledb.tablespace.utilization",
        // The fullest tablespace, of any pluggable database.
        aggregationType: MetricsAggregationType.Max,
      },
    ],
    // The receiver reports a 0..1 share; the monitor compares a percentage.
    formula: {
      alias: "oracle_tablespace_percent",
      expression: "oracle_tablespace_utilization * 100",
      legendUnit: "%",
    },
    rollingTime: RollingTime.Past10Minutes,
    criteria: {
      metricAlias: "oracle_tablespace_percent",
      filterType: FilterType.GreaterThanOrEqualTo,
      threshold: 90,
      thresholdLabel: "at or above 90%",
      subject:
        "oracledb.tablespace.utilization (the fullest tablespace) as a percentage",
      incidentDescription:
        "A tablespace is nearly full. DBA_TABLESPACE_USAGE_METRICS shows which one: add a datafile, raise its datafiles' MAXSIZE, or purge what grew. For TEMP, look for the sort or hash join spilling to disk.",
    },
  }),
];

// --- Elasticsearch ---

const ELASTICSEARCH: DatabaseTemplateEngine = {
  engine: "elasticsearch",
  receiver: "elasticsearch",
  displayName: "Elasticsearch",
};

const elasticsearchTemplates: Array<DatabaseAlertTemplate> = [
  buildEngineMetricsStoppedTemplate({
    id: "database-elasticsearch-engine-metrics-stopped",
    engine: ELASTICSEARCH,
    metricName: "elasticsearch.cluster.health",
    metricAlias: "elasticsearch_heartbeat",
  }),
  buildDatabaseTemplate({
    id: "database-elasticsearch-cluster-red",
    name: "Cluster Health Red",
    description:
      "Alert when cluster health stays red — at least one primary shard is unassigned, so part of the data cannot be searched or written.",
    category: "Availability",
    severity: "Critical",
    engine: ELASTICSEARCH,
    queries: [
      {
        alias: "elasticsearch_health_red",
        metricName: "elasticsearch.cluster.health",
        aggregationType: MetricsAggregationType.Max,
        attributes: { status: "red" },
      },
    ],
    criteria: {
      metricAlias: "elasticsearch_health_red",
      filterType: FilterType.GreaterThanOrEqualTo,
      threshold: 1,
      thresholdLabel: "at 1 (red)",
      isBinaryMetric: true,
      incidentDescription:
        "The cluster is red: a primary shard is unassigned. GET _cluster/allocation/explain says why — usually a lost node, a full disk past the flood-stage watermark, or a corrupted shard.",
    },
  }),
  buildDatabaseTemplate({
    id: "database-elasticsearch-cluster-yellow",
    name: "Cluster Health Yellow",
    description:
      "Alert when cluster health stays yellow for fifteen minutes — replica shards are unassigned, so one more node loss can lose data. Short yellow periods during a rolling restart are normal.",
    category: "Availability",
    severity: "Warning",
    engine: ELASTICSEARCH,
    queries: [
      {
        alias: "elasticsearch_health_yellow",
        metricName: "elasticsearch.cluster.health",
        aggregationType: MetricsAggregationType.Max,
        attributes: { status: "yellow" },
      },
    ],
    rollingTime: RollingTime.Past15Minutes,
    criteria: {
      metricAlias: "elasticsearch_health_yellow",
      filterType: FilterType.GreaterThanOrEqualTo,
      threshold: 1,
      thresholdLabel: "at 1 (yellow)",
      isBinaryMetric: true,
      incidentDescription:
        "The cluster has been yellow for fifteen minutes: replica shards are unassigned. GET _cluster/allocation/explain says why — too few nodes for the replica count, or disk watermarks.",
    },
  }),
  buildDatabaseTemplate({
    id: "database-elasticsearch-pending-tasks",
    name: "Cluster Tasks Backing Up",
    description:
      "Alert when ten or more cluster-state tasks stay pending — the master node cannot keep up with mapping, shard and index changes.",
    category: "Performance",
    severity: "Warning",
    engine: ELASTICSEARCH,
    queries: [
      {
        alias: "elasticsearch_pending_tasks",
        metricName: "elasticsearch.cluster.pending_tasks",
        aggregationType: MetricsAggregationType.Max,
      },
    ],
    rollingTime: RollingTime.Past10Minutes,
    criteria: {
      metricAlias: "elasticsearch_pending_tasks",
      filterType: FilterType.GreaterThanOrEqualTo,
      threshold: 10,
      thresholdLabel: "at or above 10 tasks",
      incidentDescription:
        "Cluster-state updates are queueing on the master. GET _cluster/pending_tasks shows what — dynamic mapping updates from a field explosion and mass index creation are the usual causes.",
    },
  }),
  buildDatabaseTemplate({
    id: "database-elasticsearch-jvm-heap-high",
    name: "JVM Heap Pressure",
    description:
      "Alert when a node's JVM heap stays at 85% of its maximum or more. Sustained pressure means long GC pauses and circuit breakers tripping next. Reads jvm.memory.heap.utilization, which the receiver only emits once it is enabled (the Database Agent enables it).",
    category: "Memory",
    severity: "Warning",
    engine: ELASTICSEARCH,
    queries: [
      {
        alias: "elasticsearch_heap_utilization",
        metricName: "jvm.memory.heap.utilization",
        /*
         * The hottest node: heap pressure is a per-node failure (that
         * node's breakers trip, its GC stalls), which a cluster-wide mean
         * hides. Not a Sum/Sum of jvm.memory.heap.used over heap.max —
         * the receiver records heap.used once per node AND once for the
         * whole cluster in the same scrape, so that ratio reads double.
         */
        aggregationType: MetricsAggregationType.Max,
      },
    ],
    // The receiver reports a 0..1 share; the monitor compares a percentage.
    formula: {
      alias: "elasticsearch_heap_percent",
      expression: "elasticsearch_heap_utilization * 100",
      legendUnit: "%",
    },
    rollingTime: RollingTime.Past10Minutes,
    criteria: {
      metricAlias: "elasticsearch_heap_percent",
      filterType: FilterType.GreaterThanOrEqualTo,
      threshold: 85,
      thresholdLabel: "at or above 85%",
      subject:
        "jvm.memory.heap.utilization (the fullest node's heap) as a percentage",
      incidentDescription:
        "A node's Elasticsearch heap has stayed above 85%. GET _nodes/stats/jvm,breaker shows which node and how close its breakers are; large aggregations, too many shards per node and unbounded fielddata are the usual causes.",
    },
  }),
];

// --- Memcached ---

const MEMCACHED: DatabaseTemplateEngine = {
  engine: "memcached",
  receiver: "memcached",
  displayName: "Memcached",
};

const memcachedTemplates: Array<DatabaseAlertTemplate> = [
  buildEngineMetricsStoppedTemplate({
    id: "database-memcached-engine-metrics-stopped",
    engine: MEMCACHED,
    metricName: "memcached.threads",
    metricAlias: "memcached_heartbeat",
  }),
  buildDatabaseTemplate({
    id: "database-memcached-connections-high",
    name: "Connections Near Limit",
    description:
      "Alert when open connections stay at 900 or more — close to the default connection limit of 1,024 (-c). Retune to 90% of the server's own limit.",
    category: "Connections",
    severity: "Warning",
    engine: MEMCACHED,
    queries: [
      {
        alias: "memcached_connections",
        metricName: "memcached.connections.current",
        aggregationType: MetricsAggregationType.Max,
      },
    ],
    criteria: {
      metricAlias: "memcached_connections",
      filterType: FilterType.GreaterThanOrEqualTo,
      threshold: 900,
      thresholdLabel: "at or above 900 connections",
      incidentDescription:
        "Memcached is close to its connection limit; past it new clients are refused. Look for a client that opens a connection per request instead of pooling.",
    },
  }),
];

// --- CouchDB ---

const COUCHDB: DatabaseTemplateEngine = {
  engine: "couchdb",
  receiver: "couchdb",
  displayName: "CouchDB",
};

const couchdbTemplates: Array<DatabaseAlertTemplate> = [
  buildEngineMetricsStoppedTemplate({
    id: "database-couchdb-engine-metrics-stopped",
    engine: COUCHDB,
    metricName: "couchdb.database.open",
    metricAlias: "couchdb_heartbeat",
  }),
  buildDatabaseTemplate({
    id: "database-couchdb-request-time-high",
    name: "Slow Requests",
    description:
      "Alert when the average request time stays at one second or more.",
    category: "Performance",
    severity: "Warning",
    engine: COUCHDB,
    queries: [
      {
        alias: "couchdb_request_time",
        metricName: "couchdb.average_request_time",
        aggregationType: MetricsAggregationType.Max,
      },
    ],
    criteria: {
      metricAlias: "couchdb_request_time",
      filterType: FilterType.GreaterThanOrEqualTo,
      threshold: 1000,
      thresholdLabel: "at or above 1,000 ms",
      incidentDescription:
        "CouchDB requests are averaging a second or more. Check view indexing (_active_tasks), compaction, and disk latency.",
    },
  }),
];

/*
 * Declaration order is display order within an engine: availability first,
 * because "the database is down" outranks everything else on the page.
 */
const ALL_DATABASE_ALERT_TEMPLATES: Array<DatabaseAlertTemplate> = [
  ...postgresqlTemplates,
  ...mysqlTemplates,
  ...redisTemplates,
  ...mongodbTemplates,
  ...sqlServerTemplates,
  ...oracleTemplates,
  ...elasticsearchTemplates,
  ...memcachedTemplates,
  ...couchdbTemplates,
];

export function getAllDatabaseAlertTemplates(): Array<DatabaseAlertTemplate> {
  return [...ALL_DATABASE_ALERT_TEMPLATES];
}

/*
 * The templates to offer ONE database, given its engine (`dbSystem`, aliases
 * accepted).
 *
 * Matched by RECEIVER: the templates written against the collector receivers
 * that monitor this engine. A fork its family's receiver works against gets
 * that receiver's set (MariaDB → MySQL's, Valkey → Redis's); an engine no
 * receiver here covers (Cassandra, ClickHouse, CockroachDB) and an unknown or
 * empty engine yield an empty list, never a guess — every template reads one
 * receiver's metric names, so nothing applies to a database whose metrics no
 * template's receiver produces.
 */
export function getDatabaseAlertTemplates(
  engine: string | null | undefined,
): Array<DatabaseAlertTemplate> {
  const descriptor: DatabaseSystemDescriptor | null =
    getDatabaseSystemDescriptor(engine);

  if (!descriptor) {
    return [];
  }

  return ALL_DATABASE_ALERT_TEMPLATES.filter(
    (template: DatabaseAlertTemplate): boolean => {
      return descriptor.receiverTypes.includes(template.receiver);
    },
  );
}

export function getDatabaseAlertTemplateById(
  id: string,
): DatabaseAlertTemplate | undefined {
  return ALL_DATABASE_ALERT_TEMPLATES.find(
    (template: DatabaseAlertTemplate): boolean => {
      return template.id === id;
    },
  );
}

/*
 * The engines this module's templates were written for (the engine each
 * receiver reports), in declaration order. Derived rather than hand-listed
 * so it cannot drift from the templates.
 */
export function getDatabaseEnginesWithAlertTemplates(): Array<string> {
  const engines: Array<string> = [];

  for (const template of ALL_DATABASE_ALERT_TEMPLATES) {
    if (!engines.includes(template.engine)) {
      engines.push(template.engine);
    }
  }

  return engines;
}
