import AnalyticsBaseModel from "./AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsTableEngine from "../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import AnalyticsTableColumn from "../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";

/**
 * Per-(day, hour-of-week, minute-of-hour) log-volume baseline —
 * backbone of log-count anomaly detection for Logs monitors. Peer of
 * `SpanCountBaseline` (see that model for the full rationale on the
 * minute-of-hour sub-bucket, cold start and read semantics) and of
 * `MetricBaselineHourly` for count-shaped telemetry.
 *
 * Populated by `LogCountBaseline_mv`, which fires on every insert into
 * `LogItemV3` and groups by `(projectId, primaryEntityId, severityText,
 * day, hourOfWeek, minuteOfHour)`. Each row holds a single
 * AggregateFunction(count) state — finalize via `countMerge()`.
 *
 * `severityText` is part of the key so a monitor scoped to Error/Fatal
 * logs baselines error volume only — not total log traffic. Read-side
 * queries that don't filter on it merge across the values.
 *
 * Read access goes through `LogCountBaselineService`. No CRUD API is
 * exposed; this is read-only baseline storage.
 */
export default class LogCountBaseline extends AnalyticsBaseModel {
  public constructor() {
    const projectIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "projectId",
      title: "Project ID",
      description: "ID of project (tenant key, replicated from LogItemV3)",
      required: true,
      type: TableColumnType.Text,
      isTenantId: true,
    });

    const primaryEntityIdColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "primaryEntityId",
        title: "Service ID",
        description:
          "Telemetry service the logs belong to (replicated from LogItemV3)",
        required: true,
        type: TableColumnType.Text,
      });

    const severityTextColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "severityText",
      title: "Severity Text",
      description:
        "Log severity (Information, Error, ...). In the key so error-scoped monitors baseline error volume only.",
      required: true,
      type: TableColumnType.Text,
      isLowCardinality: true,
    });

    const dayColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "day",
      title: "Day",
      description:
        "Calendar day this row aggregates (toDate(time)). Drives the table TTL of 90 days.",
      required: true,
      type: TableColumnType.Date,
    });

    const hourOfWeekColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "hourOfWeek",
      title: "Hour Of Week",
      description:
        "(toDayOfWeek(time, 1) - 1) * 24 + toHour(time). Range 0..167 with Mon 00:00 = 0.",
      required: true,
      type: TableColumnType.UInt8,
    });

    const minuteOfHourColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "minuteOfHour",
      title: "Minute Of Hour",
      description:
        "toMinute(time), 0..59. One cell per minute — a per-minute log count is the baseline's raw sample.",
      required: true,
      type: TableColumnType.UInt8,
    });

    const logCountStateColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "logCountState",
      title: "Log Count (state)",
      description:
        "AggregateFunction(count) state — logs in this minute cell. Read via countMerge(logCountState).",
      required: true,
      type: TableColumnType.AggregateFunction,
      aggregateFunctionDefinition: "count",
    });

    super({
      tableName: AnalyticsTableName.LogCountBaseline,
      tableEngine: AnalyticsTableEngine.AggregatingMergeTree,
      singularName: "Log Count Baseline",
      pluralName: "Log Count Baselines",
      tableColumns: [
        projectIdColumn,
        primaryEntityIdColumn,
        severityTextColumn,
        dayColumn,
        hourOfWeekColumn,
        minuteOfHourColumn,
        logCountStateColumn,
      ],
      projections: [],
      /*
       * Baseline materialized view. Canonical definition applied
       * idempotently by the analytics schema-sync on every boot (see
       * AnalyticsTableManagement.createMaterializedViews), so a
       * wiped/recreated ClickHouse volume self-heals. Counts each log
       * into its (day, hour-of-week, minute-of-hour, severity) cell.
       */
      materializedViews: [
        {
          name: "LogCountBaseline_mv",
          query: `CREATE MATERIALIZED VIEW IF NOT EXISTS LogCountBaseline_mv
TO LogCountBaseline
AS
SELECT
  projectId,
  primaryEntityId,
  severityText,
  toDate(time) AS day,
  toUInt8((toDayOfWeek(time, 1) - 1) * 24 + toHour(time)) AS hourOfWeek,
  toUInt8(toMinute(time)) AS minuteOfHour,
  countState() AS logCountState
FROM LogItemV3
GROUP BY projectId, primaryEntityId, severityText, day, hourOfWeek, minuteOfHour`,
        },
      ],
      /*
       * Sort key prefix matches the read-side WHERE clause of
       * LogCountBaselineService.getBaseline (project → service →
       * hourOfWeek → day range) so lookups touch a tight granule range.
       * severityText sits last: most reads merge across it.
       */
      sortKeys: [
        "projectId",
        "primaryEntityId",
        "hourOfWeek",
        "day",
        "minuteOfHour",
        "severityText",
      ],
      primaryKeys: [
        "projectId",
        "primaryEntityId",
        "hourOfWeek",
        "day",
        "minuteOfHour",
        "severityText",
      ],
      partitionKey: "toYYYYMM(day)",
      /*
       * Shard by (project, service) so each service's baseline states
       * stay on a single shard and countMerge folds locally.
       */
      shardingKey: "cityHash64(projectId, primaryEntityId)",
      tableSettings:
        "ttl_only_drop_parts = 1, non_replicated_deduplication_window = 10000",
      /*
       * Locked to MetricBaselineService.MAX_WINDOW_DAYS (90) — the
       * longest baseline window the criteria form offers. Bump both
       * together or reads will silently truncate caller intent.
       */
      ttlExpression: "day + INTERVAL 90 DAY",
      includeBaseColumns: false,
      defaultSortColumn: "day",
    });
  }
}
