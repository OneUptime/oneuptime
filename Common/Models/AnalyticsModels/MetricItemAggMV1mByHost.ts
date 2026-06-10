import AnalyticsBaseModel from "./AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsTableEngine from "../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import AnalyticsTableColumn from "../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";

/**
 * DEPRECATED — superseded by `MetricItemAggMV1mByHostV2`, which keys the
 * rollup by the stable `hostEntityKey` instead of the raw
 * `attributes['resource.host.name']` spelling. The
 * `RekeyMetricHostRollupToEntityKey` migration dropped this table's MV,
 * backfilled the V2 table from it, and dropped the table itself;
 * `MetricService.tryBuildHostAggregateMVStatement` now reads V2 only.
 *
 * The model (and its service registration) is retained temporarily so the
 * boot-time schema-sync keeps working — `createTables()` will recreate
 * this table empty, which is harmless cruft (no MV feeds it, nothing
 * reads it). Follow-up: remove this model, its service, its
 * AnalyticsTableName entry, and add a migration dropping the empty table.
 */
export default class MetricItemAggMV1mByHost extends AnalyticsBaseModel {
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

    const hostIdentifierColumn: AnalyticsTableColumn = new AnalyticsTableColumn(
      {
        key: "hostIdentifier",
        title: "Host Identifier",
        description:
          "Host name extracted from attributes['resource.host.name'] at insert time. Rows without one are filtered out by the MV's WHERE clause so this column is always populated for rows that exist.",
        required: true,
        type: TableColumnType.Text,
      },
    );

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
      tableName: AnalyticsTableName.MetricItemAggMV1mByHost,
      tableEngine: AnalyticsTableEngine.AggregatingMergeTree,
      singularName: "Metric 1-Minute Aggregate (By Host)",
      pluralName: "Metric 1-Minute Aggregates (By Host)",
      tableColumns: [
        projectIdColumn,
        nameColumn,
        hostIdentifierColumn,
        bucketTimeColumn,
        valueSumStateColumn,
        valueCountStateColumn,
        valueMinStateColumn,
        valueMaxStateColumn,
        retentionDateColumn,
      ],
      projections: [],
      /*
       * No materialized view: `MetricItemAggMV1mByHost_mv` was dropped by
       * the RekeyMetricHostRollupToEntityKey migration (declaring it here
       * would make the boot self-heal recreate it and reintroduce the
       * dropped write path). See MetricItemAggMV1mByHostV2 for the live
       * per-host rollup.
       */
      materializedViews: [],
      sortKeys: ["projectId", "name", "hostIdentifier", "bucketTime"],
      primaryKeys: ["projectId", "name", "hostIdentifier", "bucketTime"],
      partitionKey: "toYYYYMM(bucketTime)",
      tableSettings: "ttl_only_drop_parts = 1",
      ttlExpression: "retentionDate DELETE",
    });
  }
}
