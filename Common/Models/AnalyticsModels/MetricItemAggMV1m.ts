import AnalyticsBaseModel from "./AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsTableEngine from "../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import AnalyticsTableColumn from "../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import {
  getClickhouseColdTierStoragePolicy,
  getTelemetryColdTierTtlExpression,
} from "../../Utils/Telemetry/ColdTier";

/**
 * Per-minute pre-aggregated rollup of `MetricItemV3` value samples.
 *
 * Populated by the attached materialized view `MetricItemAggMV1m_mv`
 * (declared below in `materializedViews` and applied idempotently by
 * the analytics schema-sync on every boot), which fires on every
 * insert into `MetricItemV3`. Each row holds AggregateFunction
 * *states* — partial intermediate values combined by background merges
 * and finalized at read time via `*Merge()` (e.g.
 * `sumMerge(valueSumState)`).
 *
 * Read access goes through `MetricService.tryBuildMinuteAggregateMVStatement`
 * for chart aggregation queries that span ≥ 1 minute and don't filter
 * by attributes — those paths can serve from this MV instead of
 * scanning raw rows.
 *
 * The table is created on app startup via the auto-create flow
 * (registered through `AnalyticsServices`) AND through the legacy
 * migration. Both run `CREATE TABLE IF NOT EXISTS` so the duplication
 * is harmless and ensures backward compat with existing deployments.
 *
 * No CRUD API is exposed (`crudApiPath` and `enableMCP` are unset);
 * this is read-only infrastructure.
 */
export default class MetricItemAggMV1m extends AnalyticsBaseModel {
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

    const bucketTimeColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "bucketTime",
      title: "Bucket Time",
      description:
        "Start of the 1-minute bucket this row aggregates. Computed by the MV as toStartOfMinute(time).",
      required: true,
      type: TableColumnType.Date,
    });

    const valueSumStateColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "valueSumState",
      title: "Sum (state)",
      description:
        "AggregateFunction(sum, Float64) state for valueSum. Read via sumMerge(valueSumState).",
      required: true,
      type: TableColumnType.AggregateFunction,
      aggregateFunctionDefinition: "sum, Float64",
    });

    const valueCountStateColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "valueCountState",
        title: "Count (state)",
        description:
          "AggregateFunction(count, Float64) state for valueCount. Read via countMerge(valueCountState).",
        required: true,
        type: TableColumnType.AggregateFunction,
        aggregateFunctionDefinition: "count, Float64",
      });

    const valueMinStateColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "valueMinState",
      title: "Min (state)",
      description:
        "AggregateFunction(min, Float64) state. Read via minMerge(valueMinState).",
      required: true,
      type: TableColumnType.AggregateFunction,
      aggregateFunctionDefinition: "min, Float64",
    });

    const valueMaxStateColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "valueMaxState",
      title: "Max (state)",
      description:
        "AggregateFunction(max, Float64) state. Read via maxMerge(valueMaxState).",
      required: true,
      type: TableColumnType.AggregateFunction,
      aggregateFunctionDefinition: "max, Float64",
    });

    const retentionDateColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "retentionDate",
      title: "Retention Date",
      description:
        "Date after which this row is eligible for TTL deletion. Computed by the MV as max(retentionDate) per bucket — inherits from the source MetricItemV3 rows.",
      required: true,
      type: TableColumnType.Date,
    });

    super({
      tableName: AnalyticsTableName.MetricItemAggMV1m,
      tableEngine: AnalyticsTableEngine.AggregatingMergeTree,
      singularName: "Metric 1-Minute Aggregate",
      pluralName: "Metric 1-Minute Aggregates",
      tableColumns: [
        projectIdColumn,
        nameColumn,
        primaryEntityIdColumn,
        bucketTimeColumn,
        valueSumStateColumn,
        valueCountStateColumn,
        valueMinStateColumn,
        valueMaxStateColumn,
        retentionDateColumn,
      ],
      projections: [],
      /*
       * Materialized view that pre-rolls MetricItemV3 value samples into
       * 1-minute buckets. This is the canonical definition: the analytics
       * schema-sync (AnalyticsTableManagement.createMaterializedViews)
       * creates it on every boot if missing, so a wiped/recreated
       * ClickHouse volume self-heals even when the one-time DataMigration
       * is already recorded as executed in Postgres. Kept idempotent with
       * `IF NOT EXISTS`.
       */
      materializedViews: [
        {
          name: "MetricItemAggMV1m_mv",
          query: `CREATE MATERIALIZED VIEW IF NOT EXISTS MetricItemAggMV1m_mv
TO MetricItemAggMV1m
AS
SELECT
  projectId,
  name,
  primaryEntityId,
  toStartOfMinute(time) AS bucketTime,
  sumState(toFloat64(coalesce(value, sum, 0))) AS valueSumState,
  countState(toFloat64(coalesce(value, sum, 0))) AS valueCountState,
  minState(toFloat64(coalesce(value, sum, 0))) AS valueMinState,
  maxState(toFloat64(coalesce(value, sum, 0))) AS valueMaxState,
  max(retentionDate) AS retentionDate
FROM MetricItemV3
GROUP BY projectId, name, primaryEntityId, bucketTime`,
        },
      ],
      sortKeys: ["projectId", "name", "primaryEntityId", "bucketTime"],
      primaryKeys: ["projectId", "name", "primaryEntityId", "bucketTime"],
      partitionKey: "toYYYYMM(bucketTime)",
      /*
       * Match the source Metric sharding (the series) so each series' rollup
       * states stay on a single shard — no cross-shard partial-state merge.
       */
      shardingKey: "cityHash64(projectId, name, primaryEntityId)",
      storagePolicy: getClickhouseColdTierStoragePolicy(),
      tableSettings:
        "ttl_only_drop_parts = 1, non_replicated_deduplication_window = 10000",
      ttlExpression: getTelemetryColdTierTtlExpression({
        signal: "metrics",
        moveAfterExpression: "bucketTime",
      }),
    });
  }
}
