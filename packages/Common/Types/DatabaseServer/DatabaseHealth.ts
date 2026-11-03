import AggregatedResult from "../BaseDatabase/AggregatedResult";
import MetricFormulaEvaluator from "../../Utils/Metrics/MetricFormulaEvaluator";
import MetricQueryConfigData from "../Metrics/MetricQueryConfigData";
import { FilterType } from "../Monitor/CriteriaFilter";
import {
  DatabaseAlertCriteria,
  DatabaseAlertMetric,
  DatabaseAlertQuery,
  DatabaseAlertTemplate,
  DatabaseAlertTemplateCategory,
  getDatabaseAlertMetric,
  getDatabaseAlertTemplates,
} from "../Monitor/DatabaseAlertTemplates";
import {
  DatabaseEngineReadings,
  DatabaseEngineReadingsInstance,
  foldDatabaseEngineReading,
  getDatabaseEngineReadingKey,
  getDatabaseEngineReadingsLatestAt,
  getFreshDatabaseEngineInstances,
  parseDatabaseEngineReadings,
} from "./DatabaseEngineReadings";

/*
 * WHAT ON A DATABASE NEEDS SOMEONE, AND HOW BAD IT IS.
 *
 * One set of rules for every place that says it: the Databases list (its
 * Status column and its Needs attention card), a database's Overview (the
 * health pill in its hero and its Needs attention card) and the server,
 * which stores the verdict with the readings it works out at ingest
 * (DatabaseServerService.recordEngineReadings). They all read what the
 * engine last reported (DatabaseEngineReadings), so none of them can
 * disagree about what is wrong.
 *
 * THE LINES ARE THE ALERTS'. Every rule is one of the engine's recommended
 * alert templates (DatabaseAlertTemplates): its queries, its formula and
 * its criteria, judged against the engine's latest readings - PostgreSQL's
 * backends against max_connections at 80% (a warning) and 95% (critical),
 * a replica 30 seconds behind on replay, Redis's memory at 90% of
 * maxmemory, a server up for less than ten minutes. A template's line
 * moved there moves here; there is no second copy of a number to forget.
 * Where the alert waits for its window (the reading must stay past the
 * line for five or ten minutes) the page says so at once, from the latest
 * reading: the alert is the one that pages someone.
 *
 *   Critical - the templates of Critical severity: connections nearly
 *     exhausted, a tablespace nearly full, cluster health red, and the
 *     engine's metrics stopping altogether (Engine Metrics Stopped).
 *   Warning - every other template's line: connections high, a replica
 *     behind, memory near its limit or fragmented, a restart, dirty
 *     pages, blocked sessions, queries waiting for memory, cluster health
 *     yellow, a JVM heap under pressure, slow requests.
 *
 * WHILE THE ENGINE IS NOT REPORTING, what it reported last is no longer the
 * truth: a database whose engine metrics stopped is "Engine metrics
 * stopped", nothing else, and one that never had any says so. A reading
 * older than fifteen minutes is not judged.
 *
 * The words are English, marked as keys of the Dashboard's locales and
 * looked up where they are drawn (the Dashboard's extractor reads this file
 * as a "keys" root). React-free and server-safe: the ingest, the API and
 * the App tests call it.
 */

/*
 * Marks an English text as a key of the Dashboard's locales - the same
 * marker as Common/Types/Translator's translationKey, kept here so this
 * file stays free of the translator. It returns the text unchanged.
 */
const translationKey: (text: string) => string = (text: string): string => {
  return text;
};

export enum DatabaseHealthSeverity {
  Critical = "critical",
  Warning = "warning",
}

export type DatabaseHealthTone = "positive" | "warning" | "danger" | "neutral";

/*
 * One reason or status word, as an English template and its values. A
 * count-dependent one carries its "one" form and the count; `text` is then
 * its general form.
 */
export interface DatabaseHealthText {
  text: string;
  values?: Record<string, string> | undefined;
  plural?: { one: string; count: number } | undefined;
}

/*
 * Whether the engine's metrics arrive: "connected" while a collector
 * reports, "disconnected" once one that reported stopped, "not-connected"
 * when none ever did - the Engine Metrics status the Databases pages show
 * (DatabaseServerPresentation reads it from here).
 */
export type DatabaseEngineMetricsState =
  | "connected"
  | "disconnected"
  | "not-connected";

export type DatabaseHealthState =
  | "healthy"
  | "degraded"
  | "unhealthy"
  // A collector reported its engine metrics and stopped.
  | "stopped"
  // No collector has ever reported its engine metrics.
  | "no-engine-metrics"
  // Engine metrics arrive, with nothing to judge: no rules for its engine, or no fresh readings.
  | "reporting";

/*
 * The verdict the server stores with the readings (DatabaseServer
 * .engineHealth): what the rules make of the readings alone.
 */
export type DatabaseEngineHealthVerdict = "healthy" | "degraded" | "unhealthy";

export interface DatabaseHealthJudgement {
  template: DatabaseAlertTemplate;
  // What the template's criteria compare, worked out from the readings.
  value: number;
  isBreached: boolean;
  // The reason the page says when it is breached.
  reason: DatabaseHealthText;
}

/*
 * What needs attention, grouped by what it is about - the template
 * categories, in the order the alerts list them.
 */
export interface DatabaseHealthFinding {
  // "connections", "replication": unique within a database's findings.
  key: string;
  category: DatabaseAlertTemplateCategory;
  severity: DatabaseHealthSeverity;
  // The lines crossed in this category, the most urgent first.
  reasons: Array<DatabaseHealthText>;
  // The templates whose lines were crossed.
  templateIds: Array<string>;
  // When the engine last reported, for "Engine metrics stopped".
  lastReportAt?: Date | undefined;
}

export interface DatabaseHealthAssessment {
  state: DatabaseHealthState;
  severity: DatabaseHealthSeverity | null;
  // The word the list and the hero show.
  status: DatabaseHealthText;
  tone: DatabaseHealthTone;
  // What needs attention, the most urgent first. Empty when nothing does.
  findings: Array<DatabaseHealthFinding>;
  // Every finding's reasons, in order, for one line of a list.
  reasons: Array<DatabaseHealthText>;
  engineMetrics: DatabaseEngineMetricsState;
  // Whether the readings are recent enough to judge.
  hasFreshReadings: boolean;
  // The templates the readings could be judged against.
  judgements: Array<DatabaseHealthJudgement>;
  // When the engine's metrics last arrived, as far as the record knows.
  lastReportAt: Date | null;
}

/*
 * A database as the rules read it: the DatabaseServer columns, from
 * Postgres on the server or from ModelAPI in the Dashboard.
 */
export interface DatabaseHealthRow {
  dbSystem?: string | null | undefined;
  otelCollectorStatus?: string | null | undefined;
  collectorLastSeenAt?: Date | string | null | undefined;
  engineReadings?: unknown;
  engineReadingsAt?: Date | string | null | undefined;
}

export interface DatabaseHealthOptions {
  now?: Date | undefined;
}

/*
 * ---------------------------------------------------------------------------
 * Words
 * ---------------------------------------------------------------------------
 */

export const DATABASE_STATUS_HEALTHY: string = translationKey("Healthy");
export const DATABASE_STATUS_DEGRADED: string = translationKey("Degraded");
export const DATABASE_STATUS_UNHEALTHY: string = translationKey("Unhealthy");
export const DATABASE_STATUS_STOPPED: string = translationKey(
  "Engine metrics stopped",
);
export const DATABASE_STATUS_NO_ENGINE_METRICS: string =
  translationKey("No engine metrics");
export const DATABASE_STATUS_REPORTING: string = translationKey("Reporting");

export const REASON_ENGINE_METRICS_STOPPED: string = translationKey(
  "Engine metrics stopped",
);

/*
 * The categories findings are grouped by, in the order a database's Needs
 * attention lists them within a severity - the alerts' own order.
 */
export const DATABASE_HEALTH_CATEGORY_ORDER: ReadonlyArray<DatabaseAlertTemplateCategory> =
  [
    "Availability",
    "Connections",
    "Replication",
    "Memory",
    "Performance",
    "Storage",
  ];

// A category's name, as a row of a database's Needs attention names it.
export const DATABASE_HEALTH_CATEGORY_TITLES: Record<
  DatabaseAlertTemplateCategory,
  string
> = {
  Availability: translationKey("Availability"),
  Connections: translationKey("Connections"),
  Replication: translationKey("Replication"),
  Memory: translationKey("Memory"),
  Performance: translationKey("Performance"),
  Storage: translationKey("Storage"),
};

/*
 * A duration in the unit that reads best, each with its unit inside the
 * template so a language words it its own way.
 */
interface DurationWords {
  seconds: string;
  minutes: string;
  hours: string;
}

const REPLICA_BEHIND: DurationWords = {
  seconds: translationKey("A replica {{seconds}} s behind"),
  minutes: translationKey("A replica {{minutes}} min behind"),
  hours: translationKey("A replica {{hours}} h behind"),
};

const REPLICA_BEHIND_SOURCE: DurationWords = {
  seconds: translationKey("Replica {{seconds}} s behind its source"),
  minutes: translationKey("Replica {{minutes}} min behind its source"),
  hours: translationKey("Replica {{hours}} h behind its source"),
};

const REASON_RESTARTED_MINUTES: string = translationKey(
  "Restarted {{minutes}} min ago",
);
const REASON_RESTARTED_JUST_NOW: string = translationKey(
  "Restarted less than a minute ago",
);

const REASON_PG_CONNECTIONS: string = translationKey(
  "Connections at {{percent}} of max_connections",
);
const REASON_PG_XID_WRAPAROUND: string = translationKey(
  "Transaction IDs at {{percent}} of wraparound",
);
const TRANSACTION_OPEN: DurationWords = {
  seconds: translationKey("A transaction open for {{seconds}} s"),
  minutes: translationKey("A transaction open for {{minutes}} min"),
  hours: translationKey("A transaction open for {{hours}} h"),
};
const REASON_PG_SESSIONS_WAITING_ON_LOCKS: { one: string; other: string } = {
  one: translationKey("{{count}} session waiting on a lock"),
  other: translationKey("{{count}} sessions waiting on locks"),
};
const REASON_PG_WAL_BEHIND: string = translationKey(
  "A replica {{size}} of WAL behind",
);
const REASON_LARGEST_DATABASE: string = translationKey(
  "Largest database {{size}}",
);
const REASON_MYSQL_CONNECTIONS: string = translationKey(
  "{{count}} connections, near max_connections",
);
const REASON_MYSQL_THREADS_RUNNING: { one: string; other: string } = {
  one: translationKey("{{count}} thread running"),
  other: translationKey("{{count}} threads running"),
};
const REASON_MYSQL_DIRTY_PAGES: string = translationKey(
  "{{percent}} of the buffer pool dirty",
);
const REASON_REDIS_MEMORY: string = translationKey(
  "Memory at {{percent}} of maxmemory",
);
const REASON_REDIS_FRAGMENTATION: string = translationKey(
  "Memory fragmentation ratio {{ratio}}",
);
const REASON_REDIS_CLIENTS: { one: string; other: string } = {
  one: translationKey("{{count}} client connected"),
  other: translationKey("{{count}} clients connected"),
};
const REASON_MONGODB_CONNECTIONS: string = translationKey(
  "Connections at {{percent}} of what it accepts",
);
const REASON_SQLSERVER_HIT_RATIO: string = translationKey(
  "Buffer cache hit ratio {{percent}}",
);
const REASON_SQLSERVER_PLE: string = translationKey(
  "Page life expectancy {{seconds}} s",
);
const REASON_SQLSERVER_BLOCKED: { one: string; other: string } = {
  one: translationKey("{{count}} blocked session"),
  other: translationKey("{{count}} blocked sessions"),
};
const REASON_SQLSERVER_GRANTS: { one: string; other: string } = {
  one: translationKey("{{count}} query waiting for memory"),
  other: translationKey("{{count}} queries waiting for memory"),
};
const REASON_ORACLE_TABLESPACE: string = translationKey(
  "Fullest tablespace {{percent}} full",
);
const REASON_ES_RED: string = translationKey("Cluster health red");
const REASON_ES_YELLOW: string = translationKey("Cluster health yellow");
const REASON_ES_PENDING_TASKS: { one: string; other: string } = {
  one: translationKey("{{count}} cluster task pending"),
  other: translationKey("{{count}} cluster tasks pending"),
};
const REASON_ES_HEAP: string = translationKey("JVM heap at {{percent}}");
const REASON_MEMCACHED_CONNECTIONS: string = translationKey(
  "{{count}} connections, near the limit",
);
const REASON_COUCHDB_REQUEST: string = translationKey(
  "Requests averaging {{seconds}} s",
);

/*
 * Where PostgreSQL stops assigning transaction IDs (2^31, about 2.1
 * billion): an age is said as its share of the way there.
 */
export const DATABASE_POSTGRESQL_XID_WRAPAROUND_LIMIT: number = 2147483648;

/*
 * ---------------------------------------------------------------------------
 * Values, as a reason writes them
 * ---------------------------------------------------------------------------
 *
 * Every value is cut down, never rounded up, so a reading under a line can
 * never read as one at it: 94.6% of max_connections reads "94%", not the
 * critical line's "95%".
 */

function floorTo(value: number, decimals: number): number {
  const factor: number = Math.pow(10, decimals);
  return Math.floor(value * factor + 1e-9) / factor;
}

// "96%": whole, cut down.
export function formatDatabaseHealthPercent(percent: number): string {
  return `${Math.max(0, Math.floor(percent + 1e-9))}%`;
}

// "1.8": one decimal, cut down.
export function formatDatabaseHealthRatio(ratio: number): string {
  return floorTo(ratio, 1).toFixed(1);
}

// "1.2 GB", "512 GB", "310 MB": decimal units, as the alerts' lines are.
export function formatDatabaseHealthBytes(bytes: number): string {
  const units: Array<{ size: number; unit: string }> = [
    { size: 1e12, unit: "TB" },
    { size: 1e9, unit: "GB" },
    { size: 1e6, unit: "MB" },
    { size: 1e3, unit: "kB" },
  ];
  for (const { size, unit } of units) {
    if (Math.abs(bytes) >= size) {
      const scaled: number = floorTo(bytes / size, 1);
      return `${Number.isInteger(scaled) ? scaled.toFixed(0) : scaled.toFixed(1)} ${unit}`;
    }
  }
  return `${Math.round(bytes)} B`;
}

function wholeCount(value: number): number {
  return Math.max(0, Math.round(value));
}

function durationReason(
  words: DurationWords,
  seconds: number,
): DatabaseHealthText {
  const whole: number = Math.max(0, seconds);
  if (whole < 60) {
    return {
      text: words.seconds,
      values: { seconds: String(Math.floor(whole)) },
    };
  }
  if (whole < 3600) {
    return {
      text: words.minutes,
      values: { minutes: String(Math.floor(whole / 60)) },
    };
  }
  return {
    text: words.hours,
    values: { hours: String(Math.floor(whole / 3600)) },
  };
}

function countReason(
  words: { one: string; other: string },
  value: number,
): DatabaseHealthText {
  const count: number = wholeCount(value);
  return {
    text: words.other,
    values: { count: String(count) },
    plural: { one: words.one, count: count },
  };
}

/*
 * ---------------------------------------------------------------------------
 * What each template's line says, crossed
 * ---------------------------------------------------------------------------
 */

interface ReasonContext {
  template: DatabaseAlertTemplate;
  // The value the criteria compares.
  value: number;
  // When the readings it was worked out from were taken.
  readAt: Date;
  now: Date;
}

type ReasonBuilder = (context: ReasonContext) => DatabaseHealthText;

const percentReason: (text: string) => ReasonBuilder = (
  text: string,
): ReasonBuilder => {
  return (context: ReasonContext): DatabaseHealthText => {
    return {
      text: text,
      values: { percent: formatDatabaseHealthPercent(context.value) },
    };
  };
};

/*
 * A restart: how long ago the engine started, from its uptime when it was
 * read plus the time since. Uptime is in the metric's own unit (MongoDB's
 * is milliseconds).
 */
const restartReason: ReasonBuilder = (
  context: ReasonContext,
): DatabaseHealthText => {
  const query: DatabaseAlertQuery | undefined = context.template.queries[0];
  const metric: DatabaseAlertMetric | undefined = query
    ? getDatabaseAlertMetric(query.metricName)
    : undefined;
  const uptimeSeconds: number =
    metric?.unit === "ms" ? context.value / 1000 : context.value;
  const sinceRead: number = Math.max(
    0,
    (context.now.getTime() - context.readAt.getTime()) / 1000,
  );
  const ago: number = Math.max(0, uptimeSeconds) + sinceRead;

  if (ago < 60) {
    return { text: REASON_RESTARTED_JUST_NOW };
  }
  return {
    text: REASON_RESTARTED_MINUTES,
    values: { minutes: String(Math.floor(ago / 60)) },
  };
};

/*
 * Every template's reason, by template id. A template added without one
 * is judged all the same and says its own name (and DatabaseHealth's tests
 * fail until it has words of its own).
 */
export const DATABASE_HEALTH_REASONS: Readonly<Record<string, ReasonBuilder>> =
  {
    // PostgreSQL
    "database-postgresql-connections-exhausted": percentReason(
      REASON_PG_CONNECTIONS,
    ),
    "database-postgresql-connections-high": percentReason(
      REASON_PG_CONNECTIONS,
    ),
    "database-postgresql-restarted": restartReason,
    "database-postgresql-xid-wraparound-near": (
      context: ReasonContext,
    ): DatabaseHealthText => {
      return {
        text: REASON_PG_XID_WRAPAROUND,
        values: {
          percent: formatDatabaseHealthPercent(
            (context.value / DATABASE_POSTGRESQL_XID_WRAPAROUND_LIMIT) * 100,
          ),
        },
      };
    },
    "database-postgresql-xid-age-high": (
      context: ReasonContext,
    ): DatabaseHealthText => {
      return {
        text: REASON_PG_XID_WRAPAROUND,
        values: {
          percent: formatDatabaseHealthPercent(
            (context.value / DATABASE_POSTGRESQL_XID_WRAPAROUND_LIMIT) * 100,
          ),
        },
      };
    },
    "database-postgresql-long-running-transaction": (
      context: ReasonContext,
    ): DatabaseHealthText => {
      return durationReason(TRANSACTION_OPEN, context.value);
    },
    "database-postgresql-sessions-waiting-on-locks": (
      context: ReasonContext,
    ): DatabaseHealthText => {
      return countReason(REASON_PG_SESSIONS_WAITING_ON_LOCKS, context.value);
    },
    "database-postgresql-replica-replay-lag": (
      context: ReasonContext,
    ): DatabaseHealthText => {
      return durationReason(REPLICA_BEHIND, context.value);
    },
    "database-postgresql-replication-byte-lag": (
      context: ReasonContext,
    ): DatabaseHealthText => {
      return {
        text: REASON_PG_WAL_BEHIND,
        values: { size: formatDatabaseHealthBytes(context.value) },
      };
    },
    "database-postgresql-database-size": (
      context: ReasonContext,
    ): DatabaseHealthText => {
      return {
        text: REASON_LARGEST_DATABASE,
        values: { size: formatDatabaseHealthBytes(context.value) },
      };
    },

    // MySQL / MariaDB
    "database-mysql-restarted": restartReason,
    "database-mysql-connections-high": (
      context: ReasonContext,
    ): DatabaseHealthText => {
      return {
        text: REASON_MYSQL_CONNECTIONS,
        values: { count: String(wholeCount(context.value)) },
      };
    },
    "database-mysql-threads-running-high": (
      context: ReasonContext,
    ): DatabaseHealthText => {
      return countReason(REASON_MYSQL_THREADS_RUNNING, context.value);
    },
    "database-mysql-buffer-pool-dirty": percentReason(REASON_MYSQL_DIRTY_PAGES),
    "database-mysql-replica-lag": (
      context: ReasonContext,
    ): DatabaseHealthText => {
      return durationReason(REPLICA_BEHIND_SOURCE, context.value);
    },

    // Redis / Valkey
    "database-redis-restarted": restartReason,
    "database-redis-memory-near-maxmemory": percentReason(REASON_REDIS_MEMORY),
    "database-redis-memory-fragmentation": (
      context: ReasonContext,
    ): DatabaseHealthText => {
      return {
        text: REASON_REDIS_FRAGMENTATION,
        values: { ratio: formatDatabaseHealthRatio(context.value) },
      };
    },
    "database-redis-clients-high": (
      context: ReasonContext,
    ): DatabaseHealthText => {
      return countReason(REASON_REDIS_CLIENTS, context.value);
    },

    // MongoDB
    "database-mongodb-restarted": restartReason,
    "database-mongodb-connections-exhausted": percentReason(
      REASON_MONGODB_CONNECTIONS,
    ),

    // SQL Server
    "database-sqlserver-buffer-cache-hit-ratio-low": percentReason(
      REASON_SQLSERVER_HIT_RATIO,
    ),
    "database-sqlserver-page-life-expectancy-low": (
      context: ReasonContext,
    ): DatabaseHealthText => {
      return {
        text: REASON_SQLSERVER_PLE,
        values: { seconds: String(Math.floor(Math.max(0, context.value))) },
      };
    },
    "database-sqlserver-sessions-blocked": (
      context: ReasonContext,
    ): DatabaseHealthText => {
      return countReason(REASON_SQLSERVER_BLOCKED, context.value);
    },
    "database-sqlserver-memory-grants-pending": (
      context: ReasonContext,
    ): DatabaseHealthText => {
      return countReason(REASON_SQLSERVER_GRANTS, context.value);
    },

    // Oracle
    "database-oracle-tablespace-nearly-full": percentReason(
      REASON_ORACLE_TABLESPACE,
    ),

    // Elasticsearch / OpenSearch
    "database-elasticsearch-cluster-red": (): DatabaseHealthText => {
      return { text: REASON_ES_RED };
    },
    "database-elasticsearch-cluster-yellow": (): DatabaseHealthText => {
      return { text: REASON_ES_YELLOW };
    },
    "database-elasticsearch-pending-tasks": (
      context: ReasonContext,
    ): DatabaseHealthText => {
      return countReason(REASON_ES_PENDING_TASKS, context.value);
    },
    "database-elasticsearch-jvm-heap-high": percentReason(REASON_ES_HEAP),

    // Memcached
    "database-memcached-connections-high": (
      context: ReasonContext,
    ): DatabaseHealthText => {
      return {
        text: REASON_MEMCACHED_CONNECTIONS,
        values: { count: String(wholeCount(context.value)) },
      };
    },

    // CouchDB: its line is a second, so a slow average reads in seconds.
    "database-couchdb-request-time-high": (
      context: ReasonContext,
    ): DatabaseHealthText => {
      return {
        text: REASON_COUCHDB_REQUEST,
        values: {
          seconds: floorTo(context.value / 1000, 1).toFixed(1),
        },
      };
    },
  };

/*
 * ---------------------------------------------------------------------------
 * Reading the row
 * ---------------------------------------------------------------------------
 */

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const date: Date =
    value instanceof Date ? value : new Date(String(value as string));
  return Number.isNaN(date.getTime()) ? null : date;
}

/*
 * The engine metrics' status from the row: "connected" when the collector
 * path says so (it writes "connected" with every heartbeat); "disconnected"
 * when a collector did report (collectorLastSeenAt, which only the collector
 * path writes) and has stopped; "not-connected" when none ever did - a row
 * found from traces or containers stores no status, and one written before
 * the column's "disconnected" default was dropped never had a collector.
 */
export function getDatabaseEngineMetricsState(
  row: Pick<
    DatabaseHealthRow,
    "otelCollectorStatus" | "collectorLastSeenAt"
  > | null,
): DatabaseEngineMetricsState {
  const status: string = String(row?.otelCollectorStatus || "")
    .trim()
    .toLowerCase();

  if (status === "connected") {
    return "connected";
  }

  if (toDate(row?.collectorLastSeenAt)) {
    return "disconnected";
  }

  return "not-connected";
}

/*
 * ---------------------------------------------------------------------------
 * Judging the templates
 * ---------------------------------------------------------------------------
 */

function compare(
  value: number,
  filterType: FilterType,
  threshold: number,
): boolean | null {
  switch (filterType) {
    case FilterType.GreaterThan:
      return value > threshold;
    case FilterType.GreaterThanOrEqualTo:
      return value >= threshold;
    case FilterType.LessThan:
      return value < threshold;
    case FilterType.LessThanOrEqualTo:
      return value <= threshold;
    case FilterType.EqualTo:
      return value === threshold;
    case FilterType.NotEqualTo:
      return value !== threshold;
    default:
      // A comparison these rules cannot make is not judged at all.
      return null;
  }
}

/*
 * A formula over the queries' values, through the formula engine the
 * monitor evaluates the template with: one point per query, one time.
 */
function evaluateFormula(
  template: DatabaseAlertTemplate,
  aliasValues: Record<string, number>,
): number | null {
  if (!template.formula) {
    return null;
  }

  const timestamp: Date = new Date(0);
  const queryConfigs: Array<MetricQueryConfigData> = template.queries.map(
    (query: DatabaseAlertQuery): MetricQueryConfigData => {
      return {
        metricAliasData: {
          metricVariable: query.alias,
          title: query.alias,
          description: query.alias,
          legend: query.alias,
          legendUnit: query.legendUnit,
        },
        metricQueryData: {
          filterData: {
            metricName: query.metricName,
            attributes: { ...(query.attributes || {}) },
            aggegationType: query.aggregationType,
            aggregateBy: {},
          },
        },
      };
    },
  );
  const results: Array<AggregatedResult> = template.queries.map(
    (query: DatabaseAlertQuery): AggregatedResult => {
      return {
        data: [{ timestamp: timestamp, value: aliasValues[query.alias]! }],
      };
    },
  );

  try {
    const result: AggregatedResult = MetricFormulaEvaluator.evaluateFormula({
      formula: template.formula.expression,
      queryConfigs: queryConfigs,
      formulaConfigs: [],
      results: results,
    });
    const value: number | undefined = result.data[0]?.value;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function aliasValue(
  template: DatabaseAlertTemplate,
  alias: string,
  aliasValues: Record<string, number>,
): number | null {
  if (template.formula && template.formula.alias === alias) {
    return evaluateFormula(template, aliasValues);
  }
  const value: number | undefined = aliasValues[alias];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/*
 * One template against the fresh readings: what its criteria compare, and
 * whether that crosses its line. Null when it cannot be judged - a query
 * nobody reported, a formula that has no answer (a Redis with no maxmemory
 * divides by zero), or an Engine Metrics Stopped template, whose line is
 * the engine's silence, which the engine metrics' status says.
 */
export function judgeDatabaseAlertTemplate(data: {
  template: DatabaseAlertTemplate;
  instances: Array<DatabaseEngineReadingsInstance>;
}): { value: number; isBreached: boolean } | null {
  const criteria: DatabaseAlertCriteria = data.template.criteria;

  if (criteria.triggerOnNoData) {
    return null;
  }

  const aliasValues: Record<string, number> = {};
  for (const query of data.template.queries) {
    const value: number | null = foldDatabaseEngineReading({
      instances: data.instances,
      key: getDatabaseEngineReadingKey(query),
      aggregationType: query.aggregationType,
    });
    if (value === null) {
      return null;
    }
    aliasValues[query.alias] = value;
  }

  const value: number | null = aliasValue(
    data.template,
    criteria.metricAlias,
    aliasValues,
  );
  if (value === null) {
    return null;
  }

  const crossed: boolean | null = compare(
    value,
    criteria.filterType,
    criteria.threshold,
  );
  if (crossed === null) {
    return null;
  }

  if (!crossed || !criteria.additionalFilter) {
    return { value: value, isBreached: crossed };
  }

  // A two-condition breach: the second must hold too (FilterCondition All).
  const second: number | null = aliasValue(
    data.template,
    criteria.additionalFilter.metricAlias,
    aliasValues,
  );
  const secondCrossed: boolean | null =
    second === null
      ? null
      : compare(
          second,
          criteria.additionalFilter.filterType,
          Number(criteria.additionalFilter.value),
        );

  return { value: value, isBreached: secondCrossed === true };
}

const SEVERITY_ORDER: Record<DatabaseHealthSeverity, number> = {
  [DatabaseHealthSeverity.Critical]: 0,
  [DatabaseHealthSeverity.Warning]: 1,
};

function toSeverity(template: DatabaseAlertTemplate): DatabaseHealthSeverity {
  return template.severity === "Critical"
    ? DatabaseHealthSeverity.Critical
    : DatabaseHealthSeverity.Warning;
}

function worst(
  severities: Array<DatabaseHealthSeverity>,
): DatabaseHealthSeverity {
  return severities.includes(DatabaseHealthSeverity.Critical)
    ? DatabaseHealthSeverity.Critical
    : DatabaseHealthSeverity.Warning;
}

function categoryKey(category: DatabaseAlertTemplateCategory): string {
  return category.toLowerCase();
}

/*
 * The breached templates as findings: one per category, its worst severity,
 * each line's reason once - PostgreSQL's 80% and 95% connection lines both
 * crossed say "Connections at 96% of max_connections" once, critical.
 */
function toFindings(
  judgements: Array<DatabaseHealthJudgement>,
): Array<DatabaseHealthFinding> {
  const byCategory: Map<DatabaseAlertTemplateCategory, DatabaseHealthFinding> =
    new Map<DatabaseAlertTemplateCategory, DatabaseHealthFinding>();

  const breached: Array<DatabaseHealthJudgement> = judgements
    .filter((judgement: DatabaseHealthJudgement): boolean => {
      return judgement.isBreached;
    })
    .sort((a: DatabaseHealthJudgement, b: DatabaseHealthJudgement): number => {
      return (
        SEVERITY_ORDER[toSeverity(a.template)] -
        SEVERITY_ORDER[toSeverity(b.template)]
      );
    });

  for (const judgement of breached) {
    const category: DatabaseAlertTemplateCategory = judgement.template.category;
    const severity: DatabaseHealthSeverity = toSeverity(judgement.template);
    let finding: DatabaseHealthFinding | undefined = byCategory.get(category);
    if (!finding) {
      finding = {
        key: categoryKey(category),
        category: category,
        severity: severity,
        reasons: [],
        templateIds: [],
      };
      byCategory.set(category, finding);
    }
    finding.severity = worst([finding.severity, severity]);
    finding.templateIds.push(judgement.template.id);
    const alreadySaid: boolean = finding.reasons.some(
      (reason: DatabaseHealthText): boolean => {
        return reason.text === judgement.reason.text;
      },
    );
    if (!alreadySaid) {
      finding.reasons.push(judgement.reason);
    }
  }

  return sortDatabaseHealthFindings(Array.from(byCategory.values()));
}

export function sortDatabaseHealthFindings(
  findings: Array<DatabaseHealthFinding>,
): Array<DatabaseHealthFinding> {
  return [...findings].sort(
    (a: DatabaseHealthFinding, b: DatabaseHealthFinding): number => {
      const severity: number =
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      if (severity !== 0) {
        return severity;
      }
      return (
        DATABASE_HEALTH_CATEGORY_ORDER.indexOf(a.category) -
        DATABASE_HEALTH_CATEGORY_ORDER.indexOf(b.category)
      );
    },
  );
}

function getReadAt(instances: Array<DatabaseEngineReadingsInstance>): Date {
  let latest: Date | null = null;
  for (const instance of instances) {
    const at: Date | null = toDate(instance.at);
    if (at && (!latest || at.getTime() > latest.getTime())) {
      latest = at;
    }
  }
  return latest || new Date(0);
}

/*
 * The engine's readings against every template its engine is offered:
 * what could be judged, and what crosses a line. What the server stores as
 * the verdict, and what the assessment below builds on.
 */
export function judgeDatabaseEngineReadings(data: {
  dbSystem: string | null | undefined;
  readings: unknown;
  now: Date;
}): {
  hasFreshReadings: boolean;
  judgements: Array<DatabaseHealthJudgement>;
  findings: Array<DatabaseHealthFinding>;
} {
  const readings: DatabaseEngineReadings | null = parseDatabaseEngineReadings(
    data.readings,
  );
  const instances: Array<DatabaseEngineReadingsInstance> =
    getFreshDatabaseEngineInstances(readings, data.now);

  if (instances.length === 0) {
    return { hasFreshReadings: false, judgements: [], findings: [] };
  }

  const readAt: Date = getReadAt(instances);
  const judgements: Array<DatabaseHealthJudgement> = [];

  for (const template of getDatabaseAlertTemplates(data.dbSystem)) {
    const judged: { value: number; isBreached: boolean } | null =
      judgeDatabaseAlertTemplate({ template: template, instances: instances });
    if (!judged) {
      continue;
    }
    const reasonBuilder: ReasonBuilder | undefined =
      DATABASE_HEALTH_REASONS[template.id];
    judgements.push({
      template: template,
      value: judged.value,
      isBreached: judged.isBreached,
      reason: reasonBuilder
        ? reasonBuilder({
            template: template,
            value: judged.value,
            readAt: readAt,
            now: data.now,
          })
        : { text: template.name },
    });
  }

  return {
    hasFreshReadings: true,
    judgements: judgements,
    findings: toFindings(judgements),
  };
}

/*
 * The verdict stored with the readings: Unhealthy when a Critical line is
 * crossed, Degraded for any other, Healthy when the readings were judged
 * and none was - null when nothing could be judged.
 */
export function getDatabaseEngineHealthVerdict(data: {
  judgements: Array<DatabaseHealthJudgement>;
  findings: Array<DatabaseHealthFinding>;
}): DatabaseEngineHealthVerdict | null {
  if (data.findings.length > 0) {
    return data.findings.some((finding: DatabaseHealthFinding): boolean => {
      return finding.severity === DatabaseHealthSeverity.Critical;
    })
      ? "unhealthy"
      : "degraded";
  }
  return data.judgements.length > 0 ? "healthy" : null;
}

function flattenReasons(
  findings: Array<DatabaseHealthFinding>,
): Array<DatabaseHealthText> {
  const reasons: Array<DatabaseHealthText> = [];
  for (const finding of findings) {
    reasons.push(...finding.reasons);
  }
  return reasons;
}

function latestOf(dates: Array<Date | null>): Date | null {
  let latest: Date | null = null;
  for (const date of dates) {
    if (date && (!latest || date.getTime() > latest.getTime())) {
      latest = date;
    }
  }
  return latest;
}

export function assessDatabase(
  row: DatabaseHealthRow,
  options: DatabaseHealthOptions = {},
): DatabaseHealthAssessment {
  const now: Date = options.now || new Date();
  const engineMetrics: DatabaseEngineMetricsState =
    getDatabaseEngineMetricsState(row);
  const readings: DatabaseEngineReadings | null = parseDatabaseEngineReadings(
    row.engineReadings,
  );
  const lastReportAt: Date | null = latestOf([
    toDate(row.collectorLastSeenAt),
    toDate(row.engineReadingsAt),
    getDatabaseEngineReadingsLatestAt(readings),
  ]);

  if (engineMetrics === "not-connected") {
    return {
      state: "no-engine-metrics",
      severity: null,
      status: { text: DATABASE_STATUS_NO_ENGINE_METRICS },
      tone: "neutral",
      findings: [],
      reasons: [],
      engineMetrics: engineMetrics,
      hasFreshReadings: false,
      judgements: [],
      lastReportAt: lastReportAt,
    };
  }

  // What it reported last is no longer the truth: stopped, nothing else.
  if (engineMetrics === "disconnected") {
    const stopped: DatabaseHealthFinding = {
      key: "engine-metrics",
      category: "Availability",
      severity: DatabaseHealthSeverity.Critical,
      reasons: [{ text: REASON_ENGINE_METRICS_STOPPED }],
      templateIds: getDatabaseAlertTemplates(row.dbSystem)
        .filter((template: DatabaseAlertTemplate): boolean => {
          return Boolean(template.criteria.triggerOnNoData);
        })
        .map((template: DatabaseAlertTemplate): string => {
          return template.id;
        }),
      lastReportAt: lastReportAt || undefined,
    };
    return {
      state: "stopped",
      severity: DatabaseHealthSeverity.Critical,
      status: { text: DATABASE_STATUS_STOPPED },
      tone: "danger",
      findings: [stopped],
      reasons: stopped.reasons,
      engineMetrics: engineMetrics,
      hasFreshReadings: false,
      judgements: [],
      lastReportAt: lastReportAt,
    };
  }

  const judged: {
    hasFreshReadings: boolean;
    judgements: Array<DatabaseHealthJudgement>;
    findings: Array<DatabaseHealthFinding>;
  } = judgeDatabaseEngineReadings({
    dbSystem: row.dbSystem,
    readings: row.engineReadings,
    now: now,
  });

  const severity: DatabaseHealthSeverity | null =
    judged.findings.length > 0
      ? worst(
          judged.findings.map(
            (finding: DatabaseHealthFinding): DatabaseHealthSeverity => {
              return finding.severity;
            },
          ),
        )
      : null;

  const base: Omit<
    DatabaseHealthAssessment,
    "state" | "severity" | "status" | "tone"
  > = {
    findings: judged.findings,
    reasons: flattenReasons(judged.findings),
    engineMetrics: engineMetrics,
    hasFreshReadings: judged.hasFreshReadings,
    judgements: judged.judgements,
    lastReportAt: lastReportAt,
  };

  if (severity === DatabaseHealthSeverity.Critical) {
    return {
      ...base,
      state: "unhealthy",
      severity: severity,
      status: { text: DATABASE_STATUS_UNHEALTHY },
      tone: "danger",
    };
  }

  if (severity === DatabaseHealthSeverity.Warning) {
    return {
      ...base,
      state: "degraded",
      severity: severity,
      status: { text: DATABASE_STATUS_DEGRADED },
      tone: "warning",
    };
  }

  /*
   * Reporting, with nothing to judge: no rules for its engine, or no
   * readings lately. "Healthy" would be a guess.
   */
  if (judged.judgements.length === 0) {
    return {
      ...base,
      state: "reporting",
      severity: null,
      status: { text: DATABASE_STATUS_REPORTING },
      tone: "neutral",
    };
  }

  return {
    ...base,
    state: "healthy",
    severity: null,
    status: { text: DATABASE_STATUS_HEALTHY },
    tone: "positive",
  };
}

/*
 * The order databases are listed in by how urgently they need someone: the
 * critical first, then the ones to look at, each by how many reasons they
 * have, then by name as people number them (db-2 before db-10).
 */
export function compareDatabasesByUrgency(
  a: { assessment: DatabaseHealthAssessment; name: string },
  b: { assessment: DatabaseHealthAssessment; name: string },
): number {
  const rank: (assessment: DatabaseHealthAssessment) => number = (
    assessment: DatabaseHealthAssessment,
  ): number => {
    if (assessment.severity === DatabaseHealthSeverity.Critical) {
      return 0;
    }
    if (assessment.severity === DatabaseHealthSeverity.Warning) {
      return 1;
    }
    return 2;
  };
  const severity: number = rank(a.assessment) - rank(b.assessment);
  if (severity !== 0) {
    return severity;
  }
  const reasons: number =
    b.assessment.reasons.length - a.assessment.reasons.length;
  if (reasons !== 0) {
    return reasons;
  }
  return a.name.localeCompare(b.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}
