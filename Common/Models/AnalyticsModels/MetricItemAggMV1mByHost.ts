import AnalyticsBaseModel from "./AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsTableEngine from "../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import AnalyticsTableColumn from "../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";

/**
 * Per-(host, minute) pre-aggregated rollup of `MetricItemV2` value
 * samples — sister table of `MetricItemAggMV1m` keyed by host instead
 * of by service. Powers the host-detail page's chart queries, which
 * filter by `host.name` and need the full sort-key prefix to land on
 * a tight granule range.
 *
 * Populated by `MetricItemAggMV1mByHost_mv` (in
 * `AddMetricMinuteAggregateByHostMaterializedView`), which extracts
 * `attributes['resource.host.name']` from each `MetricItemV2` row at
 * insert time and skips rows without a host identifier — so the table
 * stays much smaller than `MetricItemAggMV1m`, which covers every
 * metric stream regardless of attribute presence.
 *
 * Read access goes through `MetricService.tryBuildHostAggregateMVStatement`,
 * which is the dominant path for host-detail attribute-filtered chart
 * queries. The non-host path falls through to `MetricItemAggMV1m` and
 * then the base table.
 *
 * No CRUD API; read-only infrastructure populated entirely by the MV.
 */
export default class MetricItemAggMV1mByHost extends AnalyticsBaseModel {
  public constructor() {
    const projectIdColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "projectId",
      title: "Project ID",
      description: "ID of project (tenant key, replicated from MetricItemV2)",
      required: true,
      type: TableColumnType.Text,
      isTenantId: true,
    });

    const nameColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "name",
      title: "Metric Name",
      description: "Metric name (replicated from MetricItemV2)",
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
        "Date after which this row is eligible for TTL deletion. Computed by the MV as max(retentionDate) per bucket — inherits from the source MetricItemV2 rows.",
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
       * Per-host materialized view. Canonical definition applied
       * idempotently by the analytics schema-sync on every boot (see
       * AnalyticsTableManagement.createMaterializedViews), so a
       * wiped/recreated ClickHouse volume self-heals. Rows without a
       * host identifier are filtered out so the per-host MV stays small.
       */
      materializedViews: [
        {
          name: "MetricItemAggMV1mByHost_mv",
          query: `CREATE MATERIALIZED VIEW IF NOT EXISTS MetricItemAggMV1mByHost_mv
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
        },
      ],
      sortKeys: ["projectId", "name", "hostIdentifier", "bucketTime"],
      primaryKeys: ["projectId", "name", "hostIdentifier", "bucketTime"],
      partitionKey: "sipHash64(projectId) % 16",
      ttlExpression: "retentionDate DELETE",
    });
  }
}
