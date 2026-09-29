import DataMigrationBase from "./DataMigrationBase";
import AnalyticsTableManagement from "../Utils/AnalyticsDatabase/TableManegement";
import MetricService from "Common/Server/Services/MetricService";
import logger from "Common/Server/Utils/Logger";

/*
 * Per-(day, hour-of-week) baseline of metric values, maintained by a
 * ClickHouse materialized view on every MetricItemV2 ingest. The
 * downstream anomaly evaluator and chart band query both read from the
 * target table.
 *
 * Why an MV instead of a periodic worker:
 *   - No cron to schedule/monitor/recover.
 *   - Baselines stay continuously fresh; the rolling-window query at
 *     read time picks the last N days from the daily rows.
 *   - Backfill is automatic: a new project starts ingesting and once
 *     it has 14 days of data its baseline is "ready".
 *
 * Granularity / windowing:
 *   - Each row aggregates samples falling in one (calendar day,
 *     hour-of-week) cell. There is exactly one (day, hourOfWeek) pair
 *     per concrete clock hour, so storage stays bounded — but querying
 *     `WHERE hourOfWeek = X AND day >= today() - N` collapses across N
 *     equivalent hours-of-week into a single rolling baseline.
 *   - hourOfWeek is materialized 0..167 with `(toDayOfWeek(time, 1)-1)*24
 *     + toHour(time)`, so Mon 09:00 → 8 and Sun 23:00 → 167. The MV
 *     uses ISO week (Monday=1) to match toDayOfWeek's mode 1 semantics.
 *
 * Scope:
 *   - Only scalar value paths (Gauge `value`, Sum `sum`) are aggregated.
 *     Histograms/Summaries/ExponentialHistograms produce 0 here, which
 *     is fine because anomaly detection on them isn't supported in v1
 *     (the MetricService percentile path doesn't go through this MV
 *     either).
 *   - The schema emits mean/stddev plus median/p95/min/max so future
 *     enhancements (median+MAD method, percentile-anomaly) can land
 *     without a migration.
 *
 * TTL / storage:
 *   - 28-day TTL on `day` caps the rolling window query at 28 days.
 *     The default eval-time window is 14 days; users can dial up to 28.
 *   - 168 buckets/week × ~80 bytes × N(metric, service) pairs is small
 *     even at 5k pairs/project (~67 MB).
 *
 * Backfill:
 *   - The MV does NOT use POPULATE — concurrent inserts during a
 *     populate scan would be lost. Cold-start is therefore 14 days,
 *     which the evaluator surfaces via an `is_reliable` flag.
 */
export default class AddMetricBaselineHourlyMV extends DataMigrationBase {
  public constructor() {
    super("AddMetricBaselineHourlyMV");
  }

  public override runsInClusterMode(): boolean {
    return false;
  }

  public override async migrate(): Promise<void> {
    /*
     * MV creation is now owned by the model + analytics schema-sync
     * (AnalyticsTableManagement.createMaterializedViews). Skip if the
     * view already exists so this one-time migration doesn't redo work.
     */
    if (
      await AnalyticsTableManagement.doesMaterializedViewExist(
        MetricService,
        "MetricBaselineHourly_mv",
      )
    ) {
      logger.info(
        "MetricBaselineHourly_mv already exists - skipping migration.",
      );
      return;
    }

    /*
     * Target table that stores AggregateFunction states keyed by
     * (project, metric, service, day, hour-of-week). Read-side merges
     * across `day` rows for a fixed `hourOfWeek` to compute the rolling
     * baseline.
     */
    await this.execute(
      `CREATE TABLE IF NOT EXISTS MetricBaselineHourly
       (
         projectId String,
         name String,
         serviceId String,
         day Date,
         hourOfWeek UInt8,
         sampleCountState AggregateFunction(count, Float64),
         meanState AggregateFunction(avg, Float64),
         stddevState AggregateFunction(stddevPop, Float64),
         medianState AggregateFunction(quantile(0.5), Float64),
         p95State AggregateFunction(quantile(0.95), Float64),
         minObsState AggregateFunction(min, Float64),
         maxObsState AggregateFunction(max, Float64)
       )
       ENGINE = AggregatingMergeTree
       PARTITION BY sipHash64(projectId) % 16
       ORDER BY (projectId, name, serviceId, hourOfWeek, day)
       TTL day + INTERVAL 28 DAY
       SETTINGS index_granularity = 8192`,
      "Create MetricBaselineHourly target table",
    );

    /*
     * MV trigger on MetricItemV2 inserts. coalesce(value, sum, 0)
     * handles Gauge (carries `value`) and Sum (`sum`) consistently;
     * histogram/summary rows contribute 0 and are filtered out at
     * read time by the anomaly evaluator (which only runs against
     * scalar metric criteria).
     */
    await this.execute(
      `CREATE MATERIALIZED VIEW IF NOT EXISTS MetricBaselineHourly_mv
       TO MetricBaselineHourly
       AS
       SELECT
         projectId,
         name,
         serviceId,
         toDate(time) AS day,
         toUInt8((toDayOfWeek(time, 1) - 1) * 24 + toHour(time)) AS hourOfWeek,
         countState(toFloat64(coalesce(value, sum, 0))) AS sampleCountState,
         avgState(toFloat64(coalesce(value, sum, 0))) AS meanState,
         stddevPopState(toFloat64(coalesce(value, sum, 0))) AS stddevState,
         quantileState(0.5)(toFloat64(coalesce(value, sum, 0))) AS medianState,
         quantileState(0.95)(toFloat64(coalesce(value, sum, 0))) AS p95State,
         minState(toFloat64(coalesce(value, sum, 0))) AS minObsState,
         maxState(toFloat64(coalesce(value, sum, 0))) AS maxObsState
       FROM MetricItemV2
       GROUP BY projectId, name, serviceId, day, hourOfWeek`,
      "Create MetricBaselineHourly_mv materialized view",
    );
  }

  private async execute(sql: string, description: string): Promise<void> {
    await MetricService.execute(sql);
    logger.info(`${description} - SUCCESS`);
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
