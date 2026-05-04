import DataMigrationBase from "./DataMigrationBase";
import MetricService from "Common/Server/Services/MetricService";
import logger from "Common/Server/Utils/Logger";

/*
 * The original AddMetricMinuteAggregateMaterializedView migration
 * created the MV with `FROM MetricItem`, but the metric data lives in
 * MetricItemV2 (AnalyticsTableName.Metric = "MetricItemV2"). The MV
 * creation failed silently — the destination table was created but the
 * view was never attached, so the AggregatingMergeTree has been empty
 * since deploy. Every dashboard widget that goes through the MV fast
 * path (Sum/Avg/Min/Max/Count over `value`) renders as 0.
 *
 * This migration rebuilds the MV against the correct source table and
 * backfills historical aggregates. After it runs, the Incident Count
 * widget — and every other scalar metric widget — pulls real numbers
 * out of the MV instead of zero.
 */
export default class RebuildMetricMinuteAggregateMaterializedView extends DataMigrationBase {
  public constructor() {
    super("RebuildMetricMinuteAggregateMaterializedView");
  }

  public override async migrate(): Promise<void> {
    await MetricService.execute(`DROP VIEW IF EXISTS MetricItemAggMV1m_mv`);
    /*
     * Drop the destination table too so a partially-populated MV from a
     * prior fix attempt doesn't double-count when we backfill below.
     */
    await MetricService.execute(`DROP TABLE IF EXISTS MetricItemAggMV1m`);

    /*
     * projectId/serviceId are stored as String (not UUID) in
     * MetricItemV2 — TableColumnType.ObjectID maps to ClickHouse String
     * (see StatementGenerator). Mirror that here so the INSERT INTO …
     * SELECT below doesn't fail with "Cannot parse UUID from String"
     * the moment any row carries a non-UUID-shaped serviceId.
     */
    await MetricService.execute(
      `CREATE TABLE IF NOT EXISTS MetricItemAggMV1m
       (
         projectId String,
         name String,
         serviceId String,
         bucketTime DateTime,
         valueSumState AggregateFunction(sum, Float64),
         valueCountState AggregateFunction(count, Float64),
         valueMinState AggregateFunction(min, Float64),
         valueMaxState AggregateFunction(max, Float64),
         retentionDate DateTime
       )
       ENGINE = AggregatingMergeTree
       PARTITION BY sipHash64(projectId) % 16
       ORDER BY (projectId, name, serviceId, bucketTime)
       TTL retentionDate DELETE
       SETTINGS index_granularity = 8192`,
    );

    /*
     * Create the MV first so any row inserted into MetricItemV2 from
     * this point forward fans out into the MV destination automatically.
     * The backfill below catches everything that was already in
     * MetricItemV2 before this migration ran.
     */
    await MetricService.execute(
      `CREATE MATERIALIZED VIEW IF NOT EXISTS MetricItemAggMV1m_mv
       TO MetricItemAggMV1m
       AS
       SELECT
         projectId,
         name,
         serviceId,
         toStartOfMinute(time) AS bucketTime,
         sumState(toFloat64(coalesce(value, sum, 0))) AS valueSumState,
         countState(toFloat64(coalesce(value, sum, 0))) AS valueCountState,
         minState(toFloat64(coalesce(value, sum, 0))) AS valueMinState,
         maxState(toFloat64(coalesce(value, sum, 0))) AS valueMaxState,
         max(retentionDate) AS retentionDate
       FROM MetricItemV2
       GROUP BY projectId, name, serviceId, bucketTime`,
    );

    /*
     * Backfill historical aggregates. The 1-second cutoff is the
     * race-window guard: any row inserted into MetricItemV2 between the
     * MV creation above and this INSERT is already covered by the MV,
     * so we restrict the backfill to rows that predate it.
     */
    await MetricService.execute(
      `INSERT INTO MetricItemAggMV1m
       SELECT
         projectId,
         name,
         serviceId,
         toStartOfMinute(time) AS bucketTime,
         sumState(toFloat64(coalesce(value, sum, 0))) AS valueSumState,
         countState(toFloat64(coalesce(value, sum, 0))) AS valueCountState,
         minState(toFloat64(coalesce(value, sum, 0))) AS valueMinState,
         maxState(toFloat64(coalesce(value, sum, 0))) AS valueMaxState,
         max(retentionDate) AS retentionDate
       FROM MetricItemV2
       WHERE time < (now() - INTERVAL 1 SECOND)
       GROUP BY projectId, name, serviceId, bucketTime`,
    );

    logger.info(
      "Rebuilt MetricItemAggMV1m materialized view from MetricItemV2 and backfilled historical aggregates",
    );
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
