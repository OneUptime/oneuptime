import DataMigrationBase from "./DataMigrationBase";
import ClickHouseMigrationUtil from "./ClickHouseMigrationUtil";
import AnalyticsDatabaseService from "Common/Server/Services/AnalyticsDatabaseService";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import MetricItemAggMV1mService from "Common/Server/Services/MetricItemAggMV1mService";
import MetricBaselineService from "Common/Server/Services/MetricBaselineService";
import MaterializedView from "Common/Types/AnalyticsDatabase/MaterializedView";
import logger from "Common/Server/Utils/Logger";

/**
 * Repairs the metric MV-target tables that drifted across the V3 cut and
 * are missing the `primaryEntityId` column.
 *
 * Symptom: `MetricService.deleteBy()` cascades an entity-scoped
 * lightweight DELETE (`DELETE FROM <table> WHERE TRUE AND primaryEntityId
 * = …`) into `MetricItemAggMV1m` and `MetricBaselineHourly` when an
 * Incident/Alert that owns metrics is deleted. ClickHouse rewrites that
 * into an `ALTER … UPDATE _row_exists` mutation; on a drifted table it
 * fails forever with `Code: 47 … Missing columns: 'primaryEntityId'
 * (UNKNOWN_IDENTIFIER)`.
 *
 * Why drift persists: the V3 cut (MigrateTelemetryToV3PrimaryEntityId)
 * renamed `serviceId` → `primaryEntityId` and was meant to drop+recreate
 * these AggregatingMergeTree tables from the updated models, but its drop
 * is gated on a PROXY signal (the MV no longer reads `FROM MetricItemV3`)
 * rather than on whether the column actually exists; likewise
 * RebuildMetricBaselineHourlyWithBFloat16Quantiles gates its rebuild on
 * `medianState`'s aggregate type alone. So a table can end up with a
 * V3-pointed MV re-attached while the table itself keeps the old
 * `serviceId`-keyed schema. Both migrations are tracked once in Postgres
 * and never re-run, and the boot-time schema-sync only runs `CREATE TABLE
 * IF NOT EXISTS` / creates missing MVs — neither adds a column to an
 * existing table — so the drift is permanent without this repair.
 *
 * Relationship with the boot-time reconciler: createTables'
 * reconcileColumns() runs earlier in the same boot and will already have
 * ADDed `primaryEntityId` to a drifted table — but as a plain column,
 * because `ALTER … ADD COLUMN` cannot touch ORDER BY. That alone stops
 * the crash (the lightweight DELETE predicate only needs the column to
 * exist), so the two fixes are complementary: the reconciler is the
 * immediate, universal net; this migration upgrades these two MV-target
 * tables to the key-correct layout the read path depends on for granule
 * pruning (chart aggregation and baseline lookups filter on the
 * `(projectId, name, primaryEntityId, …)` prefix).
 *
 * It is therefore gated on SORT-KEY membership (`is_in_sorting_key`), not
 * mere column existence: only when `primaryEntityId` is absent from the
 * table's ORDER BY does it drop the MV trigger(s) + table and recreate
 * both from the current model (`ORDER BY (projectId, name,
 * primaryEntityId, …)`). Gating on existence would let the reconciled
 * non-key column make this a permanent no-op. On a healthy install
 * `primaryEntityId` is already in the sort key, so this is a clean no-op.
 *
 * DATA LOSS, accepted: the dropped table's accumulated rollup/baseline
 * aggregates are discarded and re-learn from new ingest — the same
 * forward-only tradeoff as the V3 cut and the BFloat16 rebuild, and it
 * only ever touches an already-broken table.
 *
 * Drop order (MV first) means no insert can target the table mid-swap.
 * Idempotent: every statement is `IF [NOT] EXISTS` and the guard re-skips
 * once primaryEntityId is in the table's sort key.
 */
export default class RebuildMetricAggTablesMissingPrimaryEntityId extends DataMigrationBase {
  public constructor() {
    super("RebuildMetricAggTablesMissingPrimaryEntityId");
  }

  public override runsInClusterMode(): boolean {
    return false;
  }

  public override async migrate(): Promise<void> {
    const targets: Array<AnalyticsDatabaseService<AnalyticsBaseModel>> = [
      MetricItemAggMV1mService,
      MetricBaselineService,
    ];

    for (const service of targets) {
      await this.rebuildIfPrimaryEntityIdNotInSortKey(service);
    }
  }

  private async rebuildIfPrimaryEntityIdNotInSortKey(
    service: AnalyticsDatabaseService<AnalyticsBaseModel>,
  ): Promise<void> {
    const tableName: string = service.model.tableName;

    const isKeyed: boolean = await ClickHouseMigrationUtil.isColumnInSortingKey(
      tableName,
      "primaryEntityId",
    );

    if (isKeyed) {
      logger.info(
        `RebuildMetricAggTablesMissingPrimaryEntityId: ${tableName} already has primaryEntityId in its sort key - skipping.`,
      );
      return;
    }

    logger.info(
      `RebuildMetricAggTablesMissingPrimaryEntityId: ${tableName} is missing primaryEntityId from its sort key - dropping and recreating from the model (accumulated aggregates are discarded).`,
    );

    const materializedViews: Array<MaterializedView> =
      service.model.materializedViews || [];

    /*
     * 1. Detach the write path (MV triggers) before swapping the table.
     * SYNC forces each drop to complete synchronously; under the Atomic
     * database engine a deferred drop lets the following
     * `CREATE TABLE IF NOT EXISTS` no-op against the still-present old
     * object, leaving the drifted (serviceId-keyed) table in place.
     */
    for (const materializedView of materializedViews) {
      await service.execute(
        `DROP VIEW IF EXISTS ${materializedView.name} SYNC`,
      );
    }

    // 2. Drop the drifted table (this is the accepted data loss).
    await service.execute(`DROP TABLE IF EXISTS ${tableName} SYNC`);

    // 3. Recreate table + MV(s) from the current model (key-correct).
    await service.execute(service.statementGenerator.toTableCreateStatement());
    for (const materializedView of materializedViews) {
      await service.execute(materializedView.query);
    }

    logger.info(
      `RebuildMetricAggTablesMissingPrimaryEntityId: recreated ${tableName} + ${materializedViews.length} MV(s) with primaryEntityId.`,
    );
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
