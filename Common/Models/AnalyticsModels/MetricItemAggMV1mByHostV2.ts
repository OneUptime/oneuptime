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
 * Per-(host, minute) pre-aggregated rollup of `MetricItemV3` value
 * samples — successor of `MetricItemAggMV1mByHost`, re-keyed from the
 * raw `hostIdentifier` string to the stable 16-hex `hostEntityKey`
 * (see Common/Utils/Telemetry/EntityKey.keyForHost).
 *
 * Why the re-key: the V1 rollup grouped by the raw
 * `attributes['resource.host.name']` spelling, so hosts reporting the
 * same machine with casing/whitespace drift split into separate rollup
 * streams, and the read side had to ship the raw string. Keying by the
 * canonical entity key collapses those spellings, makes the rollup
 * joinable with every other entity-key read (`has(entityKeys, :key)`),
 * and lets the MV read the ingest-stamped `hostEntityKey` scalar column
 * instead of re-parsing the attributes map on every insert.
 *
 * Populated by `MetricItemAggMV1mByHostV2_mv` (declared below; created
 * by the `RekeyMetricHostRollupToEntityKey` migration, which also
 * backfills from the V1 table by computing the key in SQL). Rows whose
 * resource carries no host entity (`hostEntityKey = ''`) are filtered
 * out so the rollup stays much smaller than `MetricItemAggMV1m`.
 *
 * Read access goes through `MetricService.tryBuildHostAggregateMVStatement`,
 * which computes `keyForHost(projectId, hostIdentifier)` server-side from
 * the incoming `resource.host.name` filter — the dominant path for
 * host-detail chart queries.
 *
 * No CRUD API; read-only infrastructure populated entirely by the MV.
 */
export default class MetricItemAggMV1mByHostV2 extends AnalyticsBaseModel {
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

    const hostEntityKeyColumn: AnalyticsTableColumn = new AnalyticsTableColumn({
      key: "hostEntityKey",
      title: "Host Entity Key",
      description:
        "Stable 16-hex host entity key (EntityKey.keyForHost) replicated from MetricItemV3.hostEntityKey at insert time. Rows without one are filtered out by the MV's WHERE clause so this column is always populated for rows that exist.",
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
      tableName: AnalyticsTableName.MetricItemAggMV1mByHostV2,
      tableEngine: AnalyticsTableEngine.AggregatingMergeTree,
      singularName: "Metric 1-Minute Aggregate (By Host Entity Key)",
      pluralName: "Metric 1-Minute Aggregates (By Host Entity Key)",
      tableColumns: [
        projectIdColumn,
        nameColumn,
        hostEntityKeyColumn,
        bucketTimeColumn,
        valueSumStateColumn,
        valueCountStateColumn,
        valueMinStateColumn,
        valueMaxStateColumn,
        retentionDateColumn,
      ],
      projections: [],
      /*
       * Per-host materialized view, reading the ingest-stamped
       * `hostEntityKey` scalar column (contract C3) rather than the raw
       * attributes map. Canonical definition; created by the
       * RekeyMetricHostRollupToEntityKey migration and applied
       * idempotently by the analytics schema-sync on boot
       * (MetricItemAggMV1mByHostV2Service is registered in
       * AnalyticsServices, so a wiped ClickHouse volume self-heals).
       * Rows without a host entity are filtered out so the per-host MV
       * stays small.
       */
      materializedViews: [
        {
          name: "MetricItemAggMV1mByHostV2_mv",
          query: `CREATE MATERIALIZED VIEW IF NOT EXISTS MetricItemAggMV1mByHostV2_mv
TO MetricItemAggMV1mByHostV2
AS
SELECT
  projectId,
  name,
  hostEntityKey,
  toStartOfMinute(time) AS bucketTime,
  sumState(toFloat64(coalesce(value, sum, 0))) AS valueSumState,
  countState(toFloat64(coalesce(value, sum, 0))) AS valueCountState,
  minState(toFloat64(coalesce(value, sum, 0))) AS valueMinState,
  maxState(toFloat64(coalesce(value, sum, 0))) AS valueMaxState,
  max(retentionDate) AS retentionDate
FROM MetricItemV3
WHERE hostEntityKey != ''
GROUP BY projectId, name, hostEntityKey, bucketTime`,
        },
      ],
      sortKeys: ["projectId", "name", "hostEntityKey", "bucketTime"],
      primaryKeys: ["projectId", "name", "hostEntityKey", "bucketTime"],
      partitionKey: "toYYYYMM(bucketTime)",
      // Align with this MV's GROUP BY (projectId, name, hostEntityKey).
      shardingKey: "cityHash64(projectId, name, hostEntityKey)",
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
