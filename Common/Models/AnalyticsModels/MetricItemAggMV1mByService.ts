import AnalyticsBaseModel from "./AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsTableEngine from "../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import AnalyticsTableColumn from "../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";

/**
 * Per-(service, minute) pre-aggregated rollup of `MetricItemV3` value
 * samples — sibling of `MetricItemAggMV1mByHostV2`, keyed by the stable
 * 16-hex `serviceEntityKey` the ingest pipeline stamps on every row whose
 * resource carries a service identity (service.name, plus
 * service.namespace when present — see the service resolver in
 * Common/Server/Utils/Telemetry/TelemetryEntity).
 *
 * Because the namespace is folded into the key at ingest, ONE
 * `service.name` can map to SEVERAL serviceEntityKeys (one per
 * namespace variant). The read side therefore never derives a single
 * key from the name: `MetricService.tryBuildEntityAggregateMVStatement`
 * resolves the full key set from the Postgres TelemetryEntity registry
 * and compiles `serviceEntityKey IN (<keys>)`, falling back to the raw
 * table when the registry has no rows for the name.
 *
 * Populated by `MetricItemAggMV1mByService_mv` (declared below; created
 * idempotently by boot schema-sync — the service is registered in
 * AnalyticsServices — and backfilled from `MetricItemV3` by the
 * AddMetricEntityMinuteAggregateMaterializedViews migration). Rows whose
 * resource carries no service entity (`serviceEntityKey = ''`) are
 * filtered out.
 *
 * No CRUD API; read-only infrastructure populated entirely by the MV.
 */
export default class MetricItemAggMV1mByService extends AnalyticsBaseModel {
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

    const serviceEntityKeyColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "serviceEntityKey",
        title: "Service Entity Key",
        description:
          "Stable 16-hex service entity key (EntityKey.keyForService — service.name + optional service.namespace) replicated from MetricItemV3.serviceEntityKey at insert time. Rows without one are filtered out by the MV's WHERE clause so this column is always populated for rows that exist.",
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
      tableName: AnalyticsTableName.MetricItemAggMV1mByService,
      tableEngine: AnalyticsTableEngine.AggregatingMergeTree,
      singularName: "Metric 1-Minute Aggregate (By Service Entity Key)",
      pluralName: "Metric 1-Minute Aggregates (By Service Entity Key)",
      tableColumns: [
        projectIdColumn,
        nameColumn,
        serviceEntityKeyColumn,
        bucketTimeColumn,
        valueSumStateColumn,
        valueCountStateColumn,
        valueMinStateColumn,
        valueMaxStateColumn,
        retentionDateColumn,
      ],
      projections: [],
      /*
       * Per-service materialized view, reading the ingest-stamped
       * `serviceEntityKey` scalar column (contract C3) rather than the
       * raw attributes map. Canonical definition; created idempotently by
       * the analytics schema-sync on boot (MetricItemAggMV1mByServiceService
       * is registered in AnalyticsServices, so a wiped ClickHouse volume
       * self-heals) and backfilled by the
       * AddMetricEntityMinuteAggregateMaterializedViews migration. Rows
       * without a service entity are filtered out so the per-service MV
       * stays smaller than the raw table.
       */
      materializedViews: [
        {
          name: "MetricItemAggMV1mByService_mv",
          query: `CREATE MATERIALIZED VIEW IF NOT EXISTS MetricItemAggMV1mByService_mv
TO MetricItemAggMV1mByService
AS
SELECT
  projectId,
  name,
  serviceEntityKey,
  toStartOfMinute(time) AS bucketTime,
  sumState(toFloat64(coalesce(value, sum, 0))) AS valueSumState,
  countState(toFloat64(coalesce(value, sum, 0))) AS valueCountState,
  minState(toFloat64(coalesce(value, sum, 0))) AS valueMinState,
  maxState(toFloat64(coalesce(value, sum, 0))) AS valueMaxState,
  max(retentionDate) AS retentionDate
FROM MetricItemV3
WHERE serviceEntityKey != ''
GROUP BY projectId, name, serviceEntityKey, bucketTime`,
        },
      ],
      sortKeys: ["projectId", "name", "serviceEntityKey", "bucketTime"],
      primaryKeys: ["projectId", "name", "serviceEntityKey", "bucketTime"],
      partitionKey: "toYYYYMM(bucketTime)",
      // Align with this MV's GROUP BY (projectId, name, serviceEntityKey).
      shardingKey: "cityHash64(projectId, name, serviceEntityKey)",
      tableSettings:
        "ttl_only_drop_parts = 1, non_replicated_deduplication_window = 10000",
      ttlExpression: "retentionDate DELETE",
    });
  }
}
