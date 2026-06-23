import AnalyticsBaseModel from "./AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsTableEngine from "../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import AnalyticsTableColumn from "../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";

/**
 * Per-(selected attribute key/value, minute) pre-aggregated rollup of
 * MetricItemV3 scalar values.
 *
 * This intentionally rolls up a small allowlist of operationally useful,
 * low/medium-cardinality telemetry attributes instead of exploding every
 * attribute. It backs dashboard group-by queries like
 * `resource.k8s.cluster.name` or `destination_service` without grouping by the
 * full attributes map or scanning raw MetricItemV3 rows for scalar aggregates.
 *
 * Percentile/histogram queries still use the raw metric table because this MV
 * stores scalar sum/count/min/max states, not histogram bucket states.
 */
export default class MetricItemAttributeAggMV1m extends AnalyticsBaseModel {
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
        description: "Primary entity ID (replicated from MetricItemV3).",
        required: true,
        type: TableColumnType.Text,
      });

    const attributeKeyColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "attributeKey",
      title: "Attribute Key",
      description: "Selected telemetry attribute key used as a series split.",
      required: true,
      type: TableColumnType.Text,
    });

    const attributeValueColumn: AnalyticsTableColumn = new AnalyticsTableColumn(
      {
        key: "attributeValue",
        title: "Attribute Value",
        description: "Value for the selected telemetry attribute key.",
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
        "AggregateFunction(sum, Float64) state. Read via sumMerge(valueSumState).",
      required: true,
      type: TableColumnType.AggregateFunction,
      aggregateFunctionDefinition: "sum, Float64",
    });

    const valueCountStateColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "valueCountState",
        title: "Count (state)",
        description:
          "AggregateFunction(count, Float64) state. Read via countMerge(valueCountState).",
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
        "Date after which this row is eligible for TTL deletion. Computed by the MV as max(retentionDate) per bucket.",
      required: true,
      type: TableColumnType.Date,
    });

    super({
      tableName: AnalyticsTableName.MetricItemAttributeAggMV1m,
      tableEngine: AnalyticsTableEngine.AggregatingMergeTree,
      singularName: "Metric 1-Minute Aggregate (By Attribute)",
      pluralName: "Metric 1-Minute Aggregates (By Attribute)",
      tableColumns: [
        projectIdColumn,
        nameColumn,
        primaryEntityIdColumn,
        attributeKeyColumn,
        attributeValueColumn,
        bucketTimeColumn,
        valueSumStateColumn,
        valueCountStateColumn,
        valueMinStateColumn,
        valueMaxStateColumn,
        retentionDateColumn,
      ],
      projections: [],
      materializedViews: [
        {
          name: "MetricItemAttributeAggMV1m_mv",
          query: `CREATE MATERIALIZED VIEW IF NOT EXISTS MetricItemAttributeAggMV1m_mv
TO MetricItemAttributeAggMV1m
AS
SELECT
  projectId,
  name,
  primaryEntityId,
  attributeKey,
  attributes[attributeKey] AS attributeValue,
  toStartOfMinute(time) AS bucketTime,
  sumState(toFloat64(coalesce(value, sum, 0))) AS valueSumState,
  countState(toFloat64(coalesce(value, sum, 0))) AS valueCountState,
  minState(toFloat64(coalesce(value, sum, 0))) AS valueMinState,
  maxState(toFloat64(coalesce(value, sum, 0))) AS valueMaxState,
  max(retentionDate) AS retentionDate
FROM MetricItemV3
ARRAY JOIN arrayFilter(
  key -> has([
    'oneuptime.kubernetes.cluster.name',
    'resource.k8s.cluster.name',
    'resource.k8s.namespace.name',
    'destination_service',
    'source_workload',
    'response_code',
    'http.response.status_code',
    'http.request.method',
    'request_protocol'
  ], key) AND attributes[key] != '',
  attributeKeys
) AS attributeKey
GROUP BY projectId, name, primaryEntityId, attributeKey, attributeValue, bucketTime`,
        },
      ],
      sortKeys: [
        "projectId",
        "name",
        "primaryEntityId",
        "attributeKey",
        "attributeValue",
        "bucketTime",
      ],
      primaryKeys: [
        "projectId",
        "name",
        "primaryEntityId",
        "attributeKey",
        "attributeValue",
        "bucketTime",
      ],
      partitionKey: "toYYYYMM(bucketTime)",
      tableSettings:
        "ttl_only_drop_parts = 1, non_replicated_deduplication_window = 10000",
      ttlExpression: "retentionDate DELETE",
    });
  }
}
