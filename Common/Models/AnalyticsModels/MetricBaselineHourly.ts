import AnalyticsBaseModel from "./AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsTableEngine from "../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import AnalyticsTableColumn from "../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";

/**
 * Per-(day, hour-of-week) statistical baseline of `MetricItemV3` value
 * samples — backbone of metric anomaly detection.
 *
 * Populated by `MetricBaselineHourly_mv` (defined in the
 * `AddMetricBaselineHourlyMV` data migration), which fires on every
 * insert into `MetricItemV3` and groups by `(projectId, name,
 * primaryEntityId, day, hourOfWeek)`. Each row holds AggregateFunction
 * states (count/avg/stddevPop/quantile/min/max) — finalize at read
 * time via the matching `*Merge()`.
 *
 * Read access goes through `MetricBaselineService`, which folds across
 * a configurable rolling window (default 14 days, max 90 — capped by
 * the table's `day + INTERVAL 90 DAY` TTL) and per `hourOfWeek`. The
 * 168 hour-of-week buckets capture both daily and weekly seasonality
 * (Mon 09:00 → 8, Sun 23:00 → 167) using ISO week numbering.
 *
 * Cold start: the evaluator refuses to fire when a baseline cell has
 * fewer than `minSamples` samples (default 5). New projects therefore
 * see a "Learning" state for ~14 days after first ingest.
 *
 * Schema notes:
 *   - `median`, `p95`, `min`, `max` states are emitted from day one so
 *     a future Phase E can switch the evaluator to median+MAD without
 *     a migration.
 *   - `hourOfWeek` is a `UInt8` (range 0..167); ClickHouse rejects
 *     values outside the type so we get a built-in invariant guard.
 *
 * No CRUD API is exposed (`crudApiPath` and `enableMCP` are unset);
 * this is read-only baseline storage.
 */
export default class MetricBaselineHourly extends AnalyticsBaseModel {
  public constructor() {
    const projectIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "projectId",
      title: "Project ID",
      description: "ID of project (tenant key, replicated from MetricItemV3)",
      required: true,
      type: TableColumnType.Text,
      isTenantId: true,
    });

    const nameColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "name",
      title: "Metric Name",
      description: "Metric name (replicated from MetricItemV3)",
      required: true,
      type: TableColumnType.Text,
    });

    const primaryEntityIdColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "primaryEntityId",
        title: "Service ID",
        description: "Primary entity ID (replicated from MetricItemV3)",
        required: true,
        type: TableColumnType.Text,
      });

    const dayColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "day",
      title: "Day",
      description:
        "Calendar day this row aggregates (toDate(time)). Drives the table TTL of 28 days.",
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

    const sampleCountStateColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "sampleCountState",
        title: "Sample Count (state)",
        description:
          "AggregateFunction(count, Float64) state for sample count. Read via countMerge(sampleCountState).",
        required: true,
        type: TableColumnType.AggregateFunction,
        aggregateFunctionDefinition: "count, Float64",
      });

    const meanStateColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "meanState",
      title: "Mean (state)",
      description:
        "AggregateFunction(avg, Float64) state. Read via avgMerge(meanState).",
      required: true,
      type: TableColumnType.AggregateFunction,
      aggregateFunctionDefinition: "avg, Float64",
    });

    const stddevStateColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "stddevState",
      title: "Standard Deviation (state)",
      description:
        "AggregateFunction(stddevPop, Float64) state. Read via stddevPopMerge(stddevState).",
      required: true,
      type: TableColumnType.AggregateFunction,
      aggregateFunctionDefinition: "stddevPop, Float64",
    });

    /*
     * quantileBFloat16, not quantile(reservoir sampling): the BFloat16
     * sketch is a fixed-size histogram of bfloat16 buckets, so its state
     * stays small and merges cheaply no matter how many samples fold in,
     * where the default quantile keeps an 8 KB reservoir per cell. The
     * ~0.4% relative precision of bfloat16 is far inside the noise of an
     * anomaly baseline. State types can't be ALTERed in place — switching
     * required the RebuildMetricBaselineHourlyWithBFloat16Quantiles
     * migration to drop + recreate this table and its MV.
     */
    const medianStateColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "medianState",
      title: "Median (state)",
      description:
        "AggregateFunction(quantileBFloat16(0.5), Float64) state. Read via quantileBFloat16Merge(0.5)(medianState). Emitted for the future MedianMad anomaly method.",
      required: true,
      type: TableColumnType.AggregateFunction,
      aggregateFunctionDefinition: "quantileBFloat16(0.5), Float64",
    });

    const p95StateColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "p95State",
      title: "P95 (state)",
      description:
        "AggregateFunction(quantileBFloat16(0.95), Float64) state. Read via quantileBFloat16Merge(0.95)(p95State).",
      required: true,
      type: TableColumnType.AggregateFunction,
      aggregateFunctionDefinition: "quantileBFloat16(0.95), Float64",
    });

    const minObsStateColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "minObsState",
      title: "Min Observed (state)",
      description:
        "AggregateFunction(min, Float64) state. Read via minMerge(minObsState).",
      required: true,
      type: TableColumnType.AggregateFunction,
      aggregateFunctionDefinition: "min, Float64",
    });

    const maxObsStateColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "maxObsState",
      title: "Max Observed (state)",
      description:
        "AggregateFunction(max, Float64) state. Read via maxMerge(maxObsState).",
      required: true,
      type: TableColumnType.AggregateFunction,
      aggregateFunctionDefinition: "max, Float64",
    });

    super({
      tableName: AnalyticsTableName.MetricBaselineHourly,
      tableEngine: AnalyticsTableEngine.AggregatingMergeTree,
      singularName: "Metric Baseline (Hourly)",
      pluralName: "Metric Baselines (Hourly)",
      tableColumns: [
        projectIdColumn,
        nameColumn,
        primaryEntityIdColumn,
        dayColumn,
        hourOfWeekColumn,
        sampleCountStateColumn,
        meanStateColumn,
        stddevStateColumn,
        medianStateColumn,
        p95StateColumn,
        minObsStateColumn,
        maxObsStateColumn,
      ],
      projections: [],
      /*
       * Baseline materialized view. Canonical definition applied
       * idempotently by the analytics schema-sync on every boot (see
       * AnalyticsTableManagement.createMaterializedViews), so a
       * wiped/recreated ClickHouse volume self-heals. Aggregates each
       * sample into a (calendar day, hour-of-week) cell.
       */
      materializedViews: [
        {
          name: "MetricBaselineHourly_mv",
          query: `CREATE MATERIALIZED VIEW IF NOT EXISTS MetricBaselineHourly_mv
TO MetricBaselineHourly
AS
SELECT
  projectId,
  name,
  primaryEntityId,
  toDate(time) AS day,
  toUInt8((toDayOfWeek(time, 1) - 1) * 24 + toHour(time)) AS hourOfWeek,
  countState(toFloat64(coalesce(value, sum, 0))) AS sampleCountState,
  avgState(toFloat64(coalesce(value, sum, 0))) AS meanState,
  stddevPopState(toFloat64(coalesce(value, sum, 0))) AS stddevState,
  quantileBFloat16State(0.5)(toFloat64(coalesce(value, sum, 0))) AS medianState,
  quantileBFloat16State(0.95)(toFloat64(coalesce(value, sum, 0))) AS p95State,
  minState(toFloat64(coalesce(value, sum, 0))) AS minObsState,
  maxState(toFloat64(coalesce(value, sum, 0))) AS maxObsState
FROM MetricItemV3
GROUP BY projectId, name, primaryEntityId, day, hourOfWeek`,
        },
      ],
      /*
       * Sort key prefix matches the read-side WHERE clause of
       * MetricBaselineService.getBaseline so lookups touch a tight
       * granule range.
       */
      sortKeys: ["projectId", "name", "primaryEntityId", "hourOfWeek", "day"],
      primaryKeys: [
        "projectId",
        "name",
        "primaryEntityId",
        "hourOfWeek",
        "day",
      ],
      partitionKey: "toYYYYMM(day)",
      // Match the source Metric sharding (the series) so each series' baseline
      // states stay on a single shard.
      shardingKey: "cityHash64(projectId, name, primaryEntityId)",
      tableSettings:
        "ttl_only_drop_parts = 1, non_replicated_deduplication_window = 10000",
      ttlExpression: "day + INTERVAL 90 DAY",
    });
  }
}
