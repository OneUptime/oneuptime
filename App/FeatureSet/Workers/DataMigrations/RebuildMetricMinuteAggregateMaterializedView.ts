import DataMigrationBase from "./DataMigrationBase";
import AnalyticsTableManagement from "../Utils/AnalyticsDatabase/TableManegement";
import MetricService from "Common/Server/Services/MetricService";
import logger from "Common/Server/Utils/Logger";

/*
 * The original AddMetricMinuteAggregateMaterializedView migration
 * created the MV with `FROM MetricItem`, but the metric data lives in
 * MetricItemV2 (AnalyticsTableName.Metric = "MetricItemV2"). The MV
 * creation pointed at the wrong source, so the AggregatingMergeTree
 * stayed empty and every dashboard widget on the MV fast path
 * (Sum/Avg/Min/Max/Count over `value`) rendered as 0.
 *
 * This migration rebuilds the MV against the correct source table.
 * It does NOT backfill historical rows — only minute buckets for
 * data ingested after this migration runs will be present in the
 * MV. Older time ranges fall through to the base MetricItemV2
 * table on read.
 */
export default class RebuildMetricMinuteAggregateMaterializedView extends DataMigrationBase {
  public constructor() {
    super("RebuildMetricMinuteAggregateMaterializedView");
  }

  public override async migrate(): Promise<void> {
    /*
     * MV creation is now owned by the model + analytics schema-sync
     * (AnalyticsTableManagement.createMaterializedViews). This migration
     * remains only to repair installs that created MetricItemAggMV1m_mv
     * against the pre-v2 `MetricItem` table. Skip when the view already
     * exists with the correct source so we never drop a healthy view (and
     * its accumulated rows) on a fresh or already-fixed install.
     */
    const existingDefinition: string | null =
      await AnalyticsTableManagement.getMaterializedViewCreateQuery(
        MetricService,
        "MetricItemAggMV1m_mv",
      );

    if (existingDefinition && existingDefinition.includes("MetricItemV2")) {
      logger.info(
        "MetricItemAggMV1m_mv already exists with the correct source - skipping rebuild.",
      );
      return;
    }

    await MetricService.execute(`DROP VIEW IF EXISTS MetricItemAggMV1m_mv`);
    await MetricService.execute(`DROP TABLE IF EXISTS MetricItemAggMV1m`);

    /*
     * projectId/serviceId are stored as String (not UUID) in
     * MetricItemV2 — TableColumnType.ObjectID maps to ClickHouse String
     * (see StatementGenerator). Mirror that here so MV inserts don't
     * fail with "Cannot parse UUID from String" the moment any row
     * carries a non-UUID-shaped serviceId.
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

    logger.info(
      "Rebuilt MetricItemAggMV1m materialized view against MetricItemV2 (no historical backfill)",
    );
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
