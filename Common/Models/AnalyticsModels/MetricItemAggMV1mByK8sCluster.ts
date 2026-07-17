import AnalyticsBaseModel from "./AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsTableEngine from "../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import AnalyticsTableColumn from "../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";

/**
 * Per-(k8s cluster, minute) pre-aggregated rollup of `MetricItemV3` value
 * samples — sibling of `MetricItemAggMV1mByHostV2`, keyed by the stable
 * 16-hex `k8sClusterEntityKey` the ingest pipeline stamps on every row
 * whose resource carries a Kubernetes cluster identity. Cluster identity
 * is `k8s.cluster.name` ONLY (see `TelemetryEntity.k8sClusterIdentity`),
 * so the read side can derive the key directly from the incoming
 * `resource.k8s.cluster.name` filter via
 * `EntityKey.keyForKubernetesCluster` — no registry lookup needed.
 *
 * Populated by `MetricItemAggMV1mByK8sCluster_mv` (declared below;
 * created idempotently by boot schema-sync — the service is registered
 * in AnalyticsServices — and backfilled from `MetricItemV3` by the
 * AddMetricEntityMinuteAggregateMaterializedViews migration). Rows whose
 * resource carries no cluster entity (`k8sClusterEntityKey = ''`) are
 * filtered out so the rollup stays small.
 *
 * Read access goes through
 * `MetricService.tryBuildEntityAggregateMVStatement` — the dominant path
 * for the Kubernetes cluster detail page's Metrics tab.
 *
 * No CRUD API; read-only infrastructure populated entirely by the MV.
 */
export default class MetricItemAggMV1mByK8sCluster extends AnalyticsBaseModel {
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

    const k8sClusterEntityKeyColumn: AnalyticsTableColumn =
      new AnalyticsTableColumn({
        key: "k8sClusterEntityKey",
        title: "Kubernetes Cluster Entity Key",
        description:
          "Stable 16-hex k8s cluster entity key (EntityKey.keyForKubernetesCluster) replicated from MetricItemV3.k8sClusterEntityKey at insert time. Rows without one are filtered out by the MV's WHERE clause so this column is always populated for rows that exist.",
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
      tableName: AnalyticsTableName.MetricItemAggMV1mByK8sCluster,
      tableEngine: AnalyticsTableEngine.AggregatingMergeTree,
      singularName:
        "Metric 1-Minute Aggregate (By Kubernetes Cluster Entity Key)",
      pluralName:
        "Metric 1-Minute Aggregates (By Kubernetes Cluster Entity Key)",
      tableColumns: [
        projectIdColumn,
        nameColumn,
        k8sClusterEntityKeyColumn,
        bucketTimeColumn,
        valueSumStateColumn,
        valueCountStateColumn,
        valueMinStateColumn,
        valueMaxStateColumn,
        retentionDateColumn,
      ],
      projections: [],
      /*
       * Per-cluster materialized view, reading the ingest-stamped
       * `k8sClusterEntityKey` scalar column (contract C3) rather than the
       * raw attributes map. Canonical definition; created idempotently by
       * the analytics schema-sync on boot
       * (MetricItemAggMV1mByK8sClusterService is registered in
       * AnalyticsServices, so a wiped ClickHouse volume self-heals) and
       * backfilled by the AddMetricEntityMinuteAggregateMaterializedViews
       * migration. Rows without a cluster entity are filtered out so the
       * per-cluster MV stays small.
       */
      materializedViews: [
        {
          name: "MetricItemAggMV1mByK8sCluster_mv",
          query: `CREATE MATERIALIZED VIEW IF NOT EXISTS MetricItemAggMV1mByK8sCluster_mv
TO MetricItemAggMV1mByK8sCluster
AS
SELECT
  projectId,
  name,
  k8sClusterEntityKey,
  toStartOfMinute(time) AS bucketTime,
  sumState(toFloat64(coalesce(value, sum, 0))) AS valueSumState,
  countState(toFloat64(coalesce(value, sum, 0))) AS valueCountState,
  minState(toFloat64(coalesce(value, sum, 0))) AS valueMinState,
  maxState(toFloat64(coalesce(value, sum, 0))) AS valueMaxState,
  max(retentionDate) AS retentionDate
FROM MetricItemV3
WHERE k8sClusterEntityKey != ''
GROUP BY projectId, name, k8sClusterEntityKey, bucketTime`,
        },
      ],
      sortKeys: ["projectId", "name", "k8sClusterEntityKey", "bucketTime"],
      primaryKeys: ["projectId", "name", "k8sClusterEntityKey", "bucketTime"],
      partitionKey: "toYYYYMM(bucketTime)",
      // Align with this MV's GROUP BY (projectId, name, k8sClusterEntityKey).
      shardingKey: "cityHash64(projectId, name, k8sClusterEntityKey)",
      tableSettings:
        "ttl_only_drop_parts = 1, non_replicated_deduplication_window = 10000",
      ttlExpression: "retentionDate DELETE",
    });
  }
}
