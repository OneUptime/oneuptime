import DataMigrationBase from "./DataMigrationBase";
import MetricService from "Common/Server/Services/MetricService";
import logger from "Common/Server/Utils/Logger";

/*
 * Per-host 1-minute aggregate of Metric data.
 *
 * Why:
 *   The dashboard's host detail page (Overview + Metrics tabs)
 *   ALWAYS filters metric queries by the host attribute
 *   `resource.host.name`. The original MetricItemAggMV1m is keyed
 *   only by (projectId, name, serviceId, bucketTime) and the
 *   MetricService MV fast path explicitly bypasses it whenever
 *   any attribute filter is present (see
 *   tryBuildMinuteAggregateMVStatement in MetricService.ts).
 *   That means every chart on the host page falls back to the
 *   raw MetricItemV2 table — the very thing the MV was supposed
 *   to avoid.
 *
 *   This migration creates a sibling MV keyed by
 *   (projectId, name, hostIdentifier, bucketTime) so the host
 *   filter can be served directly from a much smaller
 *   pre-aggregated table.
 *
 * Scope:
 *   Same as the original MV: scalar `value` is pre-aggregated
 *   for Sum/Avg/Min/Max/Count. Histograms / Summaries /
 *   ExponentialHistograms keep using the base table because
 *   their percentile path needs bucket-level fanout. Rows where
 *   `attributes['resource.host.name']` is empty are skipped — no
 *   point inflating the per-host MV with non-host data.
 *
 * Backfill:
 *   Backfills the historical aggregate from MetricItemV2 with a
 *   1-second cutoff to avoid double-counting any rows that
 *   land between MV creation and the INSERT.
 */
export default class AddMetricMinuteAggregateByHostMaterializedView extends DataMigrationBase {
  public constructor() {
    super("AddMetricMinuteAggregateByHostMaterializedView");
  }

  public override async migrate(): Promise<void> {
    /*
     * Destination table. Keyed by hostIdentifier directly after
     * (projectId, name) so a query like
     *   WHERE projectId = ? AND name = ? AND hostIdentifier = ?
     * uses the full sort-key prefix and reads only the relevant
     * granules.
     */
    await MetricService.execute(
      `CREATE TABLE IF NOT EXISTS MetricItemAggMV1mByHost
       (
         projectId String,
         name String,
         hostIdentifier String,
         bucketTime DateTime,
         valueSumState AggregateFunction(sum, Float64),
         valueCountState AggregateFunction(count, Float64),
         valueMinState AggregateFunction(min, Float64),
         valueMaxState AggregateFunction(max, Float64),
         retentionDate DateTime
       )
       ENGINE = AggregatingMergeTree
       PARTITION BY sipHash64(projectId) % 16
       ORDER BY (projectId, name, hostIdentifier, bucketTime)
       TTL retentionDate DELETE
       SETTINGS index_granularity = 8192`,
    );
    logger.info("Created MetricItemAggMV1mByHost table");

    /*
     * Materialized view itself. The host attribute is read from
     * the Map column at insert time; rows without a host
     * identifier (most non-hostmetrics rows) are filtered out by
     * the HAVING clause so the per-host MV stays small.
     *
     * `coalesce(value, sum, 0)` matches the existing minute-MV's
     * fallback for scalar metrics — Gauges carry the sample on
     * `value`, Sums on `sum`. Histograms/Summaries have neither;
     * they fall through to zero here and are intentionally not
     * served by this MV (their percentile path uses the base
     * table directly).
     */
    await MetricService.execute(
      `CREATE MATERIALIZED VIEW IF NOT EXISTS MetricItemAggMV1mByHost_mv
       TO MetricItemAggMV1mByHost
       AS
       SELECT
         projectId,
         name,
         attributes['resource.host.name'] AS hostIdentifier,
         toStartOfMinute(time) AS bucketTime,
         sumState(toFloat64(coalesce(value, sum, 0))) AS valueSumState,
         countState(toFloat64(coalesce(value, sum, 0))) AS valueCountState,
         minState(toFloat64(coalesce(value, sum, 0))) AS valueMinState,
         maxState(toFloat64(coalesce(value, sum, 0))) AS valueMaxState,
         max(retentionDate) AS retentionDate
       FROM MetricItemV2
       WHERE attributes['resource.host.name'] != ''
       GROUP BY projectId, name, hostIdentifier, bucketTime`,
    );
    logger.info("Created MetricItemAggMV1mByHost_mv materialized view");

    /*
     * Backfill from raw MetricItemV2. The 1-second cutoff is the
     * race-window guard: any row inserted between the MV
     * creation above and this INSERT is already covered by the
     * MV, so we restrict the backfill to rows that predate it.
     */
    await MetricService.execute(
      `INSERT INTO MetricItemAggMV1mByHost
       SELECT
         projectId,
         name,
         attributes['resource.host.name'] AS hostIdentifier,
         toStartOfMinute(time) AS bucketTime,
         sumState(toFloat64(coalesce(value, sum, 0))) AS valueSumState,
         countState(toFloat64(coalesce(value, sum, 0))) AS valueCountState,
         minState(toFloat64(coalesce(value, sum, 0))) AS valueMinState,
         maxState(toFloat64(coalesce(value, sum, 0))) AS valueMaxState,
         max(retentionDate) AS retentionDate
       FROM MetricItemV2
       WHERE time < (now() - INTERVAL 1 SECOND)
         AND attributes['resource.host.name'] != ''
       GROUP BY projectId, name, hostIdentifier, bucketTime`,
    );
    logger.info("Backfilled MetricItemAggMV1mByHost from MetricItemV2");
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
