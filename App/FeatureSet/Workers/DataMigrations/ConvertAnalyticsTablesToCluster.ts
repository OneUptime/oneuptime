import DataMigrationBase from "./DataMigrationBase";
import logger from "Common/Server/Utils/Logger";
import AnalyticsTableManagement from "../Utils/AnalyticsDatabase/TableManegement";

/**
 * Make the analytics materialized views cluster-correct after the cutover to the
 * sharded + replicated cluster layout.
 *
 * The cutover itself happens at boot schema-sync: AnalyticsTableManagement
 * .reconcileDistributedTable renames any legacy single-node `<table>` MergeTree
 * aside to `<table>_preclustered` and creates the `Distributed` `<table>` over
 * `<table>Local` — so NEW telemetry lands in the cluster tables from the get-go
 * (and, on a multi-node cluster, stops re-splitting). This migration's only job
 * is to make the materialized views cluster-correct, which it does by delegating
 * to AnalyticsTableManagement.createMaterializedViews() (the same routine the
 * boot schema-sync runs on every boot).
 *
 * IDEMPOTENT / SAFE TO RE-RUN. createMaterializedViews is conditional per view:
 * it SKIPS any MV whose stored definition already matches the model (a true
 * no-op), and only DROP + recreates one that has DRIFTED (e.g. a stale
 * single-node MV from before the cluster cutover), behind safety gates that
 * refuse a destructive drop it cannot prove will recreate cleanly. There are NO
 * unconditional DROPs here, so running this migration again — manually, or after
 * a recording failure — neither errors on already-applied state nor destroys
 * working views. (An earlier version of this migration force-dropped every MV
 * first; that was both non-idempotent on re-run and bypassed those safety gates.)
 *
 * BACKFILL OF OLD ROWS IS INTENTIONALLY NOT DONE HERE, AND THE BACKUPS ARE
 * DROPPED — telemetry history is forward-only across the conversion.
 *
 * Copying the OLD rows out of the `<table>_preclustered` backups into the cluster
 * tables streams the entire legacy dataset (often billions of rows) through one
 * coordinator node. Doing that automatically inside a boot data-migration is
 * unsafe at scale: it OOMs / hits the client's socket-idle timeout, and the
 * atomic table swaps race live ingestion (TABLE_UUID_MISMATCH / UNKNOWN_TABLE on
 * a high-throughput instance). So new telemetry simply starts fresh in the
 * cluster tables, and the abandoned `<table>_preclustered` backups are reclaimed
 * by the DropPreclusteredAnalyticsBackupTables migration (ordered just before
 * this one) instead of being kept around indefinitely.
 *
 * Operators who want to carry pre-conversion history forward must do it BEFORE
 * upgrading: copy it out by hand, or rename the source aside to a non-
 * `_preclustered` name (e.g. `…_backup`, which the drop migration does not
 * match), then run — in a maintenance window with ingestion quiesced — directly
 * against ClickHouse, table-by-table, biggest first, watching per-node memory:
 *
 *   INSERT INTO <table> (<cols>) SELECT <cols>
 *     FROM clusterAllReplicas('<cluster>', currentDatabase(), <table>_backup)
 *     SETTINGS send_progress_in_http_headers = 1;
 *
 * (clusterAllReplicas reads EVERY node's backup — `cluster()` would read only one
 * replica per shard and miss data split across the others; the INSERT into the
 * Distributed table re-shards + replicates, reunifying split data.)
 *
 * BEST-EFFORT / NEVER RETRIES: createMaterializedViews swallows per-view errors
 * and migrate() never throws — the migration always records as complete.
 */
export default class ConvertAnalyticsTablesToCluster extends DataMigrationBase {
  public constructor() {
    super("ConvertAnalyticsTablesToCluster");
  }

  public override async migrate(): Promise<void> {
    /*
     * Ensure the materialized views are cluster-correct. createMaterializedViews
     * is idempotent: it skips MVs that already match the model and only drops +
     * recreates drifted (e.g. legacy single-node) ones, so re-running this
     * migration is a no-op once the views are correct. It also swallows per-view
     * errors internally; the try/catch is defense in depth so migrate() never
     * throws (the migration must record complete and never loop).
     */
    try {
      await AnalyticsTableManagement.createMaterializedViews();
    } catch (err) {
      logger.error({
        message:
          "ConvertAnalyticsTablesToCluster: failed to rebuild materialized views; the boot schema-sync will retry next boot.",
        error: (err as Error).message,
      });
    }

    /*
     * This migration ALWAYS records as complete and NEVER retries. New telemetry
     * is already in the cluster tables (reconcileDistributedTable switched the
     * Distributed wrappers in at schema-sync). The OLD rows left in the
     * `<table>_preclustered` backups are reclaimed by
     * DropPreclusteredAnalyticsBackupTables — see the class doc comment.
     */
  }

  public override async rollback(): Promise<void> {
    /*
     * Forward-only. The `<table>_preclustered` backups (created by the boot
     * schema-sync) are not touched by THIS migration —
     * DropPreclusteredAnalyticsBackupTables drops them — so there is nothing
     * here to roll back.
     */
    logger.warn(
      "ConvertAnalyticsTablesToCluster rollback is a no-op; the cluster cutover is forward-only and the *_preclustered backups are dropped by DropPreclusteredAnalyticsBackupTables.",
    );
  }
}
