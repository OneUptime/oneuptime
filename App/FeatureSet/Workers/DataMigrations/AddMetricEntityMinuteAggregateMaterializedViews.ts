import DataMigrationBase from "./DataMigrationBase";
import ClickHouseMigrationUtil from "./ClickHouseMigrationUtil";
import AnalyticsDatabaseService from "Common/Server/Services/AnalyticsDatabaseService";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import MetricItemAggMV1mByServiceService from "Common/Server/Services/MetricItemAggMV1mByServiceService";
import MetricItemAggMV1mByK8sClusterService from "Common/Server/Services/MetricItemAggMV1mByK8sClusterService";
import MetricItemAggMV1mByContainerService from "Common/Server/Services/MetricItemAggMV1mByContainerService";
import MaterializedView from "Common/Types/AnalyticsDatabase/MaterializedView";
import logger from "Common/Server/Utils/Logger";

/*
 * Per-entity 1-minute aggregates of Metric data — service / k8s cluster /
 * container siblings of the per-host rollup (MetricItemAggMV1mByHostV2),
 * each keyed by the corresponding ingest-stamped scalar entity-key column
 * (serviceEntityKey / k8sClusterEntityKey / containerEntityKey).
 *
 * Why:
 *   The Service, Kubernetes-cluster and container detail pages ALWAYS
 *   filter metric queries by their entity (resource.service.name /
 *   resource.k8s.cluster.name / resource.container.id, or the synthetic
 *   entityScope filter). Until these rollups existed, every such chart
 *   fell through to a raw MetricItemV3 scan — the per-host MV was the
 *   only entity fast path. See
 *   MetricService.tryBuildEntityAggregateMVStatement for the read side.
 *
 * Ownership split (same as the per-host V2 rollup):
 *   Table + MV creation is owned by the models + boot schema-sync
 *   (the three services are registered in AnalyticsServices, so a fresh
 *   install or wiped ClickHouse volume self-heals). This one-time
 *   migration owns the BACKFILL of rows that were ingested before the
 *   MV triggers attached, so charts don't lose their pre-deploy history
 *   until it ages out of retention.
 *
 * Backfill without double counting:
 *   Boot schema-sync creates the MVs earlier in the same boot, so by the
 *   time this runs the trigger may already have captured a few minutes
 *   of inserts. Per table: detach the MV trigger (DROP VIEW ... SYNC),
 *   TRUNCATE the target, re-derive EVERYTHING currently in MetricItemV3
 *   with an INSERT ... SELECT that reuses the MV's own SELECT text
 *   (state-identical by construction), then re-attach the trigger. Rows
 *   ingested in the seconds between the backfill snapshot and the
 *   re-attach are missing from the rollup — the same forward-only,
 *   retention-bounded tradeoff every prior rollup migration accepted.
 *   The backfill scan itself is bounded by the metric retention window.
 *   Rows whose entity-key column is '' (ingested before the scalar
 *   entity-key columns existed) are skipped, matching the MV's WHERE.
 *
 * Idempotent: re-running redoes the detach/truncate/backfill/attach
 * cycle from scratch. Per-table failures are collected and re-thrown at
 * the end so a partial run is retried on the next boot.
 */
export default class AddMetricEntityMinuteAggregateMaterializedViews extends DataMigrationBase {
  public constructor() {
    super("AddMetricEntityMinuteAggregateMaterializedViews");
  }

  /*
   * Single-node only, mirroring the sibling rollup migrations: on a
   * clustered ClickHouse the boot schema-sync builds the tables + MVs
   * with the full ON CLUSTER layout, and the raw single-node DDL below
   * would fail against the Distributed wrappers. Clustered installs are
   * forward-only (no backfill), the same posture as the V3 cut.
   */
  public override runsInClusterMode(): boolean {
    return false;
  }

  public override async migrate(): Promise<void> {
    /*
     * Nothing to create from / backfill from without the raw V3 table
     * (it is created by boot schema-sync before migrations run, so this
     * only trips on a broken install — skip rather than wedge the chain).
     */
    if (!(await ClickHouseMigrationUtil.tableExists("MetricItemV3"))) {
      logger.info(
        "AddMetricEntityMinuteAggregateMaterializedViews: MetricItemV3 not present — skipping.",
      );
      return;
    }

    const targets: Array<AnalyticsDatabaseService<AnalyticsBaseModel>> = [
      MetricItemAggMV1mByServiceService,
      MetricItemAggMV1mByK8sClusterService,
      MetricItemAggMV1mByContainerService,
    ];

    const errors: Array<string> = [];

    for (const service of targets) {
      try {
        await this.rebuildAndBackfill(service);
      } catch (err) {
        logger.error(
          `AddMetricEntityMinuteAggregateMaterializedViews: failed on ${service.model.tableName}:`,
        );
        logger.error(err as Error);
        errors.push(`${service.model.tableName}: ${(err as Error).message}`);
      }
    }

    if (errors.length > 0) {
      throw new Error(
        `AddMetricEntityMinuteAggregateMaterializedViews: ${errors.length} failure(s): ${errors.join("; ")}`,
      );
    }
  }

  private async rebuildAndBackfill(
    service: AnalyticsDatabaseService<AnalyticsBaseModel>,
  ): Promise<void> {
    const tableName: string = service.model.tableName;
    const materializedView: MaterializedView | undefined = (service.model
      .materializedViews || [])[0];

    if (!materializedView) {
      throw new Error(`${tableName} declares no materialized view`);
    }

    /*
     * The MV's own SELECT is the single source of truth for the state
     * shape — reuse it verbatim for the backfill so the two can never
     * drift. The models declare their MV as `CREATE ... TO <table>\nAS\n
     * SELECT ...`.
     */
    const selectMarker: string = "\nAS\n";
    const markerIndex: number = materializedView.query.indexOf(selectMarker);
    if (markerIndex === -1) {
      throw new Error(
        `${materializedView.name} query has an unexpected shape (no AS marker); refusing to guess a backfill SELECT`,
      );
    }
    const backfillSelect: string = materializedView.query.substring(
      markerIndex + selectMarker.length,
    );

    // Self-sufficient even if boot schema-sync did not run this boot.
    await service.execute(service.statementGenerator.toTableCreateStatement());

    /*
     * Detach the write path before the backfill. SYNC so the drop
     * completes before the TRUNCATE below (see
     * RebuildMetricAggTablesMissingPrimaryEntityId for the Atomic-engine
     * rationale). With the trigger gone, nothing can insert into the
     * target between the truncate and the re-attach, so the backfill's
     * derived states cannot be double counted.
     */
    await service.execute(`DROP VIEW IF EXISTS ${materializedView.name} SYNC`);

    // Discard the boot-window states; the backfill re-derives them from raw.
    await service.execute(`TRUNCATE TABLE ${tableName}`);

    await service.execute(`INSERT INTO ${tableName}\n${backfillSelect}`);
    logger.info(
      `AddMetricEntityMinuteAggregateMaterializedViews: backfilled ${tableName} from MetricItemV3`,
    );

    // Re-attach the trigger; capture resumes from this instant.
    await service.execute(materializedView.query);
    logger.info(
      `AddMetricEntityMinuteAggregateMaterializedViews: (re)created ${materializedView.name}`,
    );
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
