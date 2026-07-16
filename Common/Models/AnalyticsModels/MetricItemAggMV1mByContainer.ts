import AnalyticsBaseModel from "./AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsTableEngine from "../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import AnalyticsTableColumn from "../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";

/**
 * Per-(container, minute) pre-aggregated rollup of `MetricItemV3` value
 * samples — sibling of `MetricItemAggMV1mByHostV2`, keyed by the stable
 * 16-hex `containerEntityKey` the ingest pipeline stamps on every row
 * whose resource carries a container identity. Container identity is
 * `container.id` ONLY (see the container resolver in
 * Common/Server/Utils/Telemetry/TelemetryEntity), so the read side can
 * derive the key directly from the incoming `resource.container.id`
 * filter via `keyForContainer` — no registry lookup needed (containers
 * are a membership-only entity type that never mints registry rows).
 *
 * Populated by `MetricItemAggMV1mByContainer_mv` (declared below;
 * created idempotently by boot schema-sync — the service is registered
 * in AnalyticsServices — and backfilled from `MetricItemV3` by the
 * AddMetricEntityMinuteAggregateMaterializedViews migration). Rows whose
 * resource carries no container entity (`containerEntityKey = ''`) are
 * filtered out so the rollup stays small.
 *
 * Read access goes through
 * `MetricService.tryBuildEntityAggregateMVStatement` for single
 * `resource.container.id` equality filters.
 *
 * No CRUD API; read-only infrastructure populated entirely by the MV.
 */
export default class MetricItemAggMV1mByContainer extends AnalyticsBaseModel {
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

    const containerEntityKeyColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "containerEntityKey",
        title: "Container Entity Key",
        description:
          "Stable 16-hex container entity key (keyForContainer — container.id only) replicated from MetricItemV3.containerEntityKey at insert time. Rows without one are filtered out by the MV's WHERE clause so this column is always populated for rows that exist.",
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
      tableName: AnalyticsTableName.MetricItemAggMV1mByContainer,
      tableEngine: AnalyticsTableEngine.AggregatingMergeTree,
      singularName: "Metric 1-Minute Aggregate (By Container Entity Key)",
      pluralName: "Metric 1-Minute Aggregates (By Container Entity Key)",
      tableColumns: [
        projectIdColumn,
        nameColumn,
        containerEntityKeyColumn,
        bucketTimeColumn,
        valueSumStateColumn,
        valueCountStateColumn,
        valueMinStateColumn,
        valueMaxStateColumn,
        retentionDateColumn,
      ],
      projections: [],
      /*
       * Per-container materialized view, reading the ingest-stamped
       * `containerEntityKey` scalar column (contract C3) rather than the
       * raw attributes map. Canonical definition; created idempotently by
       * the analytics schema-sync on boot
       * (MetricItemAggMV1mByContainerService is registered in
       * AnalyticsServices, so a wiped ClickHouse volume self-heals) and
       * backfilled by the AddMetricEntityMinuteAggregateMaterializedViews
       * migration. Rows without a container entity are filtered out so
       * the per-container MV stays small.
       */
      materializedViews: [
        {
          name: "MetricItemAggMV1mByContainer_mv",
          query: `CREATE MATERIALIZED VIEW IF NOT EXISTS MetricItemAggMV1mByContainer_mv
TO MetricItemAggMV1mByContainer
AS
SELECT
  projectId,
  name,
  containerEntityKey,
  toStartOfMinute(time) AS bucketTime,
  sumState(toFloat64(coalesce(value, sum, 0))) AS valueSumState,
  countState(toFloat64(coalesce(value, sum, 0))) AS valueCountState,
  minState(toFloat64(coalesce(value, sum, 0))) AS valueMinState,
  maxState(toFloat64(coalesce(value, sum, 0))) AS valueMaxState,
  max(retentionDate) AS retentionDate
FROM MetricItemV3
WHERE containerEntityKey != ''
GROUP BY projectId, name, containerEntityKey, bucketTime`,
        },
      ],
      sortKeys: ["projectId", "name", "containerEntityKey", "bucketTime"],
      primaryKeys: ["projectId", "name", "containerEntityKey", "bucketTime"],
      partitionKey: "toYYYYMM(bucketTime)",
      // Align with this MV's GROUP BY (projectId, name, containerEntityKey).
      shardingKey: "cityHash64(projectId, name, containerEntityKey)",
      tableSettings:
        "ttl_only_drop_parts = 1, non_replicated_deduplication_window = 10000",
      ttlExpression: "retentionDate DELETE",
    });
  }
}
