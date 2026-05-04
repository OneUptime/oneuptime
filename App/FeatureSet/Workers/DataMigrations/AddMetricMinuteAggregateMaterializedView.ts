import DataMigrationBase from "./DataMigrationBase";
import MetricService from "Common/Server/Services/MetricService";
import logger from "Common/Server/Utils/Logger";

/*
 * Pre-aggregate Metric data into 1-minute buckets to make dashboard
 * chart widgets fast on wide time ranges.
 *
 * Why:
 *   The dashboard's chart/value/gauge/table widgets all compile to
 *   `aggregate-by-time-bucket` queries against MetricItem. For a
 *   time range covering hours or days, ClickHouse has to scan the
 *   raw row stream and bucket it on the fly. With high-cardinality
 *   metric streams this is the dominant query cost.
 *
 *   An AggregatingMergeTree with a 1-minute bucket pre-rolls these
 *   numbers at ingest time, so the dashboard reads from a much
 *   smaller table. For a 24h window over a single metric the row
 *   count drops from `samples_per_minute * 1440` to `1440`.
 *
 * Scope:
 *   Only scalar `value` is pre-aggregated (Sum/Gauge metrics, plus
 *   the per-row aggregates that Sum/Avg/Min/Max/Count over a Metric
 *   row collapse to). Histograms / Summaries / ExponentialHistograms
 *   keep using the base table because their percentile path needs
 *   bucket-level fanout that does not commute with a precomputed
 *   minute-bucket aggregate. The MetricService percentile override
 *   already routes around this MV by using `MetricItem` directly.
 *
 * Backfill:
 *   This migration creates the MV but does NOT backfill historical
 *   data — the table will be populated forward from new ingests.
 *   Backfilling a busy installation can take a long time and is
 *   safer to do as an explicit operational task. The query path
 *   falls back to the base MetricItem table when an MV row is
 *   missing for a bucket.
 */
export default class AddMetricMinuteAggregateMaterializedView extends DataMigrationBase {
  public constructor() {
    super("AddMetricMinuteAggregateMaterializedView");
  }

  public override async migrate(): Promise<void> {
    /*
     * Step 1: target table that holds the per-minute aggregate states.
     *
     * Columns mirror the base Metric table's identity columns
     * (projectId, name, serviceId) plus the bucket time. We store
     * AggregateFunction states for sum/min/max/count so reads can
     * derive avg = sum/count and the four scalar aggregations the
     * dashboard widgets need without re-scanning the raw rows.
     */
    await this.execute(
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
      "Create MetricItemAggMV1m table",
    );

    /*
     * Step 2: the materialized view itself. INSERT INTO MetricItem
     * triggers a row in the MV with the per-minute aggregate states.
     *
     * `coalesce(value, sum, 0)` matches the fanout fallback used by
     * MetricService's percentile path — Gauge metrics carry their
     * sample on `value`, Sum metrics on `sum`. Histograms/Summaries
     * have neither, so they contribute zero into the scalar MV which
     * is harmless because their queries use the base table anyway.
     */
    await this.execute(
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
      "Create MetricItemAggMV1m_mv materialized view",
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
