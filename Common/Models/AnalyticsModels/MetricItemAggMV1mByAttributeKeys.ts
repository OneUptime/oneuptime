import AnalyticsBaseModel from "./AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsTableEngine from "../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import AnalyticsTableColumn from "../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";

/**
 * Per-(attributeKey, attributeValue, minute) pre-aggregated rollup of
 * `MetricItemV3`, for shape-collapsed evaluation of metric monitors that filter
 * or group by a single attribute (Phase 3). Lets the worker serve those shapes
 * from one cheap rollup read instead of scanning the raw table per monitor.
 *
 * ⚠️ INGEST FAN-OUT — on by default; kill-switch is the flag set to "false".
 * The materialized view ARRAY JOINs each ingested metric row across ALL of its
 * attributes, so a metric carrying N attributes produces N rollup rows per
 * insert. On high-attribute-cardinality fleets this multiplies ingest CPU and
 * rollup storage. It is registered in AnalyticsServices (and so created + fired
 * on ingest) unless TELEMETRY_MONITOR_ATTRIBUTE_KEY_MV_ENABLED="false". Before
 * relying on it in production:
 *   (1) restrict the MV's WHERE to an ALLOWLIST of attribute keys you actually
 *       alert on (edit the `attributeKey IN (...)` clause below) so the fan-out
 *       is bounded, and
 *   (2) validate ingest CPU / storage on a representative volume — or set the
 *       env var to "false" until you have.
 *
 * Read access is gated behind the same flag via
 * MetricService.tryBuildAttributeKeyMVStatement; monitors fall back to the raw
 * path when it is off, so correctness never depends on this MV.
 *
 * No CRUD API; read-only infrastructure populated entirely by the MV.
 */
export default class MetricItemAggMV1mByAttributeKeys extends AnalyticsBaseModel {
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

    const attributeKeyColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "attributeKey",
      title: "Attribute Key",
      description:
        "A single attribute key unnested from MetricItemV3.attributes by the MV's ARRAY JOIN.",
      required: true,
      type: TableColumnType.Text,
    });

    const attributeValueColumn: AnalyticsTableColumn = new AnalyticsTableColumn(
      {
        key: "attributeValue",
        title: "Attribute Value",
        description: "The value of attributeKey for this rollup stream.",
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
        "Date after which this row is eligible for TTL deletion (max(retentionDate) per bucket).",
      required: true,
      type: TableColumnType.Date,
    });

    super({
      tableName: AnalyticsTableName.MetricItemAggMV1mByAttributeKeys,
      tableEngine: AnalyticsTableEngine.AggregatingMergeTree,
      singularName: "Metric 1-Minute Aggregate (By Attribute Key)",
      pluralName: "Metric 1-Minute Aggregates (By Attribute Key)",
      tableColumns: [
        projectIdColumn,
        nameColumn,
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
      /*
       * ARRAY JOIN fans each metric row across its attributes (see the
       * fan-out warning above). The `attributeKey IN (...)` allowlist below is
       * intentionally empty-by-convention — replace `1 = 1` with an explicit
       * key allowlist before enabling on a high-cardinality fleet. Created
       * idempotently by the analytics schema-sync, but ONLY because the
       * service is conditionally registered behind the flag.
       */
      materializedViews: [
        {
          name: "MetricItemAggMV1mByAttributeKeys_mv",
          query: `CREATE MATERIALIZED VIEW IF NOT EXISTS MetricItemAggMV1mByAttributeKeys_mv
TO MetricItemAggMV1mByAttributeKeys
AS
SELECT
  projectId,
  name,
  kv.1 AS attributeKey,
  kv.2 AS attributeValue,
  toStartOfMinute(time) AS bucketTime,
  sumState(toFloat64(coalesce(value, sum, 0))) AS valueSumState,
  countState(toFloat64(coalesce(value, sum, 0))) AS valueCountState,
  minState(toFloat64(coalesce(value, sum, 0))) AS valueMinState,
  maxState(toFloat64(coalesce(value, sum, 0))) AS valueMaxState,
  max(retentionDate) AS retentionDate
FROM MetricItemV3
ARRAY JOIN arrayZip(mapKeys(attributes), mapValues(attributes)) AS kv
WHERE 1 = 1
GROUP BY projectId, name, attributeKey, attributeValue, bucketTime`,
        },
      ],
      sortKeys: [
        "projectId",
        "name",
        "attributeKey",
        "attributeValue",
        "bucketTime",
      ],
      primaryKeys: [
        "projectId",
        "name",
        "attributeKey",
        "attributeValue",
        "bucketTime",
      ],
      partitionKey: "toYYYYMM(bucketTime)",
      shardingKey: "cityHash64(projectId, name, attributeKey, attributeValue)",
      tableSettings:
        "ttl_only_drop_parts = 1, non_replicated_deduplication_window = 10000",
      ttlExpression: "retentionDate DELETE",
    });
  }
}
