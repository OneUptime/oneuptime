import AnalyticsBaseModel from "./AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsTableEngine from "../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import AnalyticsTableColumn from "../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";

/**
 * Per-(day, hour-of-week, minute-of-hour) span-volume baseline —
 * backbone of span-count anomaly detection for Traces monitors. Peer of
 * `MetricBaselineHourly` for count-shaped telemetry.
 *
 * Populated by `SpanCountBaseline_mv` (declared below, applied
 * idempotently by the analytics schema-sync on every boot), which fires
 * on every insert into `SpanItemV3` and groups by `(projectId,
 * primaryEntityId, statusCode, day, hourOfWeek, minuteOfHour)`. Each row
 * holds a single AggregateFunction(count) state — finalize at read time
 * via `countMerge()`.
 *
 * Why a minute-of-hour sub-bucket where the metric baseline stops at the
 * hour: a metric baseline cell folds many raw samples per hour, but a
 * count baseline's raw "sample" must itself be a count over a fixed
 * interval. One minute is that interval — so a 14-day window yields
 * ~120 per-minute samples per hour-of-week cell (2 matching days × 60
 * minutes), enough to clear the `minSamples` reliability gate, and the
 * baseline's unit ("spans per minute") matches the Traces monitor's
 * default 60-second evaluation window. Hour-grained cells would give
 * only 2 samples per 14-day window and could never leave Learning.
 *
 * `statusCode` (SpanStatus: 0 Unset / 1 Ok / 2 Error; NULL folded to 0)
 * is part of the key so a monitor scoped to error spans (429/500 spike
 * alerts) baselines error volume only — not total traffic. Read-side
 * queries that don't filter on it simply merge across the values.
 *
 * Read access goes through `SpanCountBaselineService`, which fetches the
 * per-minute counts for one `hourOfWeek` across a rolling window
 * (default 14 days, max 90 — capped by the table's `day + INTERVAL 90
 * DAY` TTL) and computes mean/stddev/median/MAD in app code. The 168
 * hour-of-week buckets capture daily and weekly seasonality (Mon 09:00
 * → 8, Sun 23:00 → 167) using ISO week numbering.
 *
 * Cold start: the evaluator refuses to fire while a baseline cell has
 * fewer than `minSamples` samples (default 5) — the "Learning" state.
 * Minutes with zero spans produce no rows (nothing inserts), so sparse
 * streams stay in Learning rather than fabricating a zero-heavy band.
 *
 * No CRUD API is exposed (`crudApiPath` and `enableMCP` are unset);
 * this is read-only baseline storage.
 */
export default class SpanCountBaseline extends AnalyticsBaseModel {
  public constructor() {
    const projectIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "projectId",
      title: "Project ID",
      description: "ID of project (tenant key, replicated from SpanItemV3)",
      required: true,
      type: TableColumnType.Text,
      isTenantId: true,
    });

    const primaryEntityIdColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "primaryEntityId",
        title: "Service ID",
        description:
          "Telemetry service the spans belong to (replicated from SpanItemV3)",
        required: true,
        type: TableColumnType.Text,
      });

    const statusCodeColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "statusCode",
      title: "Span Status Code",
      description:
        "SpanStatus (0 Unset, 1 Ok, 2 Error; NULL folded to 0). In the key so error-scoped monitors baseline error volume only.",
      required: true,
      type: TableColumnType.UInt8,
    });

    const dayColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "day",
      title: "Day",
      description:
        "Calendar day this row aggregates (toDate(startTime)). Drives the table TTL of 90 days.",
      required: true,
      type: TableColumnType.Date,
    });

    const hourOfWeekColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "hourOfWeek",
      title: "Hour Of Week",
      description:
        "(toDayOfWeek(startTime, 1) - 1) * 24 + toHour(startTime). Range 0..167 with Mon 00:00 = 0.",
      required: true,
      type: TableColumnType.UInt8,
    });

    const minuteOfHourColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "minuteOfHour",
      title: "Minute Of Hour",
      description:
        "toMinute(startTime), 0..59. One cell per minute — a per-minute span count is the baseline's raw sample.",
      required: true,
      type: TableColumnType.UInt8,
    });

    const spanCountStateColumn: AnalyticsTableColumn = new AnalyticsTableColumn(
      {
        key: "spanCountState",
        title: "Span Count (state)",
        description:
          "AggregateFunction(count) state — spans in this minute cell. Read via countMerge(spanCountState).",
        required: true,
        type: TableColumnType.AggregateFunction,
        aggregateFunctionDefinition: "count",
      },
    );

    super({
      tableName: AnalyticsTableName.SpanCountBaseline,
      tableEngine: AnalyticsTableEngine.AggregatingMergeTree,
      singularName: "Span Count Baseline",
      pluralName: "Span Count Baselines",
      tableColumns: [
        projectIdColumn,
        primaryEntityIdColumn,
        statusCodeColumn,
        dayColumn,
        hourOfWeekColumn,
        minuteOfHourColumn,
        spanCountStateColumn,
      ],
      projections: [],
      /*
       * Baseline materialized view. Canonical definition applied
       * idempotently by the analytics schema-sync on every boot (see
       * AnalyticsTableManagement.createMaterializedViews), so a
       * wiped/recreated ClickHouse volume self-heals. Counts each span
       * into its (day, hour-of-week, minute-of-hour, status) cell.
       */
      materializedViews: [
        {
          name: "SpanCountBaseline_mv",
          query: `CREATE MATERIALIZED VIEW IF NOT EXISTS SpanCountBaseline_mv
TO SpanCountBaseline
AS
SELECT
  projectId,
  primaryEntityId,
  toUInt8(coalesce(statusCode, 0)) AS statusCode,
  toDate(startTime) AS day,
  toUInt8((toDayOfWeek(startTime, 1) - 1) * 24 + toHour(startTime)) AS hourOfWeek,
  toUInt8(toMinute(startTime)) AS minuteOfHour,
  countState() AS spanCountState
FROM SpanItemV3
GROUP BY projectId, primaryEntityId, statusCode, day, hourOfWeek, minuteOfHour`,
        },
      ],
      /*
       * Sort key prefix matches the read-side WHERE clause of
       * SpanCountBaselineService.getBaseline (project → service →
       * hourOfWeek → day range) so lookups touch a tight granule range.
       * statusCode sits last: most reads merge across it.
       */
      sortKeys: [
        "projectId",
        "primaryEntityId",
        "hourOfWeek",
        "day",
        "minuteOfHour",
        "statusCode",
      ],
      primaryKeys: [
        "projectId",
        "primaryEntityId",
        "hourOfWeek",
        "day",
        "minuteOfHour",
        "statusCode",
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
