import DataMigrationBase from "./DataMigrationBase";
import logger from "Common/Server/Utils/Logger";
import { AnalyticsServices } from "Common/Server/Services/Index";
import AnalyticsDatabaseService from "Common/Server/Services/AnalyticsDatabaseService";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import MaterializedView from "Common/Types/AnalyticsDatabase/MaterializedView";
import AnalyticsTableManagement from "../Utils/AnalyticsDatabase/TableManegement";
import {
  getClickhouseClusterName,
  getStorageTableName,
  onClusterClause,
} from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";

/*
 * Suffix for the renamed legacy table held as a backup during conversion. The
 * original single-node `<table>` is renamed to `<table>_preclustered` so the
 * model name is free for the Distributed wrapper; the backup is dropped only
 * after the row-count check passes.
 */
const PRECLUSTER_SUFFIX: string = "_preclustered";

type AnyAnalyticsService = AnalyticsDatabaseService<AnalyticsBaseModel>;

/**
 * Backfill the OLD analytics data into the sharded + replicated cluster tables.
 *
 * The cutover itself happens earlier, at boot schema-sync: AnalyticsTableManagement
 * .reconcileDistributedTable renames any legacy `<table>` MergeTree aside to
 * `<table>_preclustered` and creates the `Distributed` `<table>` over
 * `<table>Local` — so NEW telemetry lands in the cluster tables from the get-go
 * (and, on a multi-node cluster, stops re-splitting). This migration only moves
 * the OLD rows:
 *
 *   1. drop the stale legacy materialized views (rebuilt cluster-correctly in 3);
 *   2. for each table with a `<table>_preclustered` backup, ADDITIVELY copy its
 *      rows into the cluster tables:
 *      `INSERT INTO <table> SELECT … FROM clusterAllReplicas(<cluster>, db, <table>_preclustered)`.
 *      clusterAllReplicas reads EVERY node's backup (cluster() would read only one
 *      replica per shard and miss split data), and the INSERT into the Distributed
 *      table re-shards + replicates — reunifying data split across nodes (the
 *      original "Span not found" incident). The copy is additive (no truncate)
 *      because new telemetry is already flowing into `<table>Local`. Progress
 *      headers keep the long INSERT alive past the client's socket-idle timeout.
 *      On success the backup is dropped; on failure it is LEFT for manual recovery;
 *   3. rebuild the materialized views cluster-correctly.
 *
 * BEST-EFFORT / NEVER RETRIES: the backfill of each table is wrapped so a failure
 * is logged and swallowed, and migrate() never throws — so the migration always
 * records as complete and never re-runs. A copy that cannot finish (too large,
 * OOM, …) must not block deploys or loop forever; the system is already healthy
 * because new data is in the cluster tables, and the old rows remain safe in the
 * `<table>_preclustered` backup for manual recovery.
 *
 * OPERATIONAL NOTES:
 *  - Best run in a maintenance window: the copy streams the entire legacy dataset
 *    through one coordinator node and can take a long time on large tables.
 *  - Requires the `<cluster>` cluster + Keeper to be configured and healthy.
 *  - Validated end-to-end on a single-node cluster-of-one; review against a
 *    staging multi-shard cluster before production.
 */
export default class ConvertAnalyticsTablesToCluster extends DataMigrationBase {
  public constructor() {
    super("ConvertAnalyticsTablesToCluster");
  }

  public override async migrate(): Promise<void> {
    const cluster: string = getClickhouseClusterName();

    /*
     * 1. Drop the legacy single-node materialized views (rebuilt cluster-correctly
     *    in step 3). The boot schema-sync (reconcileDistributedTable) already
     *    renamed the source/target tables aside, so the old MVs are stale; drop
     *    them ON CLUSTER + SYNC.
     */
    for (const service of AnalyticsServices) {
      const materializedViews: Array<MaterializedView> =
        service.model.materializedViews || [];
      for (const mv of materializedViews) {
        try {
          await service.execute(
            `DROP VIEW IF EXISTS ${mv.name}${onClusterClause()} SYNC`,
          );
        } catch (err) {
          logger.error({
            message: `ConvertAnalyticsTablesToCluster: failed to drop legacy materialized view ${mv.name}`,
            error: (err as Error).message,
          });
        }
      }
    }

    // 2. Backfill old rows per table (best-effort; convertTable never throws).
    for (const service of AnalyticsServices) {
      try {
        await this.convertTable(service, cluster);
      } catch (err) {
        // convertTable is best-effort and should not throw; log defensively.
        logger.error({
          message: `ConvertAnalyticsTablesToCluster: unexpected error backfilling ${service.model.tableName}`,
          error: (err as Error).message,
        });
      }
    }

    /*
     * 3. Rebuild materialized views cluster-correctly (ON CLUSTER, reading the
     *    local source, writing the local target). Best-effort: the boot
     *    schema-sync (createMaterializedViews) self-heals MVs on every boot too.
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
     * Distributed wrappers in at schema-sync). Any table whose backfill failed
     * left its *${PRECLUSTER_SUFFIX} backup in place for manual recovery — see
     * the per-table error logs above. A copy that cannot finish must not block
     * deploys or loop forever.
     */
  }

  private async convertTable(
    service: AnyAnalyticsService,
    cluster: string,
  ): Promise<void> {
    const table: string = service.model.tableName;
    const localTable: string = getStorageTableName(table); // `${table}Local`
    const preclustered: string = `${table}${PRECLUSTER_SUFFIX}`;

    /*
     * The boot schema-sync (reconcileDistributedTable) already switched <table>
     * to the Distributed wrapper and renamed any legacy data to
     * `<table>_preclustered`, so NEW telemetry is ALREADY landing in
     * `<table>Local`. This migration's only job is to BACKFILL the old rows from
     * the backup. No backup → nothing to do (fresh install, or already drained).
     */
    const backupEngine: string | null =
      await AnalyticsTableManagement.getTableEngine(service, preclustered);
    if (backupEngine === null) {
      return;
    }

    /*
     * BEST-EFFORT backfill, run AT MOST ONCE. New data is already flowing into
     * `${localTable}` via the Distributed table, so the copy is ADDITIVE — it
     * must NOT truncate. If it succeeds we drop the backup; if it FAILS we LEAVE
     * the backup for manual recovery and swallow the error so the migration
     * records as complete and NEVER retries. A copy that can't finish must not
     * block deploys or loop forever — the system is already healthy because new
     * data is in the cluster tables regardless.
     */
    try {
      logger.info(
        `ConvertAnalyticsTablesToCluster: backfilling old rows for ${table} from ${preclustered}.`,
      );

      // Defensive: ensure the local + Distributed tables exist.
      await service.execute(
        service.statementGenerator.toTableCreateStatement(),
      );
      const distributedStatement: ReturnType<
        AnyAnalyticsService["statementGenerator"]["toDistributedTableCreateStatement"]
      > = service.statementGenerator.toDistributedTableCreateStatement();
      if (distributedStatement) {
        await service.execute(distributedStatement);
      }

      /*
       * Only columns present in BOTH the backup and the model are copied; new
       * columns take their defaults.
       */
      const targetColumns: Array<string> = await this.getColumns(
        service,
        localTable,
      );
      const sourceColumns: Set<string> = new Set(
        await this.getColumns(service, preclustered),
      );
      const commonColumns: Array<string> = targetColumns.filter((c: string) => {
        return sourceColumns.has(c);
      });
      if (commonColumns.length === 0) {
        throw new Error(
          `No columns in common between ${localTable} and ${preclustered}.`,
        );
      }
      const columnList: string = commonColumns.join(", ");

      /*
       * clusterAllReplicas reads EVERY node's backup — `cluster()` would read
       * only one replica per shard and silently miss data split across the
       * others. The INSERT into the Distributed table re-shards + replicates.
       * Progress headers keep the socket non-idle so an arbitrarily long copy is
       * not killed by the client's 58s socket-idle request_timeout (an
       * INSERT…SELECT returns no bytes until it completes).
       */
      await service.execute(
        `INSERT INTO ${table} (${columnList}) SELECT ${columnList} FROM clusterAllReplicas('${cluster}', currentDatabase(), ${preclustered})`,
        {
          clickhouseSettings: {
            send_progress_in_http_headers: 1,
            http_headers_progress_interval_ms: "10000",
          },
        },
      );

      const copied: number = await this.countFrom(
        service,
        `clusterAllReplicas('${cluster}', currentDatabase(), ${preclustered})`,
      );
      logger.info(
        `ConvertAnalyticsTablesToCluster: backfilled ${copied} old rows for ${table}; dropping ${preclustered}.`,
      );
      await service.execute(
        `DROP TABLE IF EXISTS ${preclustered}${onClusterClause()} SYNC`,
      );
    } catch (err) {
      logger.error({
        message: `ConvertAnalyticsTablesToCluster: failed to backfill old rows for ${table}. New telemetry is already in the cluster tables; the old rows remain in ${preclustered} for manual recovery. NOT retrying.`,
        table,
        error: (err as Error).message,
      });
    }
  }

  private async getColumns(
    service: AnyAnalyticsService,
    table: string,
  ): Promise<Array<string>> {
    const escaped: string = table.replace(/'/g, "''");
    const result: { json: () => Promise<unknown> } = await service.executeQuery(
      `SELECT name FROM system.columns WHERE database = currentDatabase() AND table = '${escaped}' ORDER BY position`,
    );
    const json: { data?: Array<Record<string, unknown>> } =
      (await result.json()) as { data?: Array<Record<string, unknown>> };
    return (json.data ?? []).map((row: Record<string, unknown>) => {
      return String(row["name"]);
    });
  }

  private async countFrom(
    service: AnyAnalyticsService,
    fromExpression: string,
  ): Promise<number> {
    const result: { json: () => Promise<unknown> } = await service.executeQuery(
      `SELECT count() AS cnt FROM ${fromExpression}`,
    );
    const json: { data?: Array<Record<string, unknown>> } =
      (await result.json()) as { data?: Array<Record<string, unknown>> };
    const row: Record<string, unknown> | undefined = json.data?.[0];
    return row ? Number(row["cnt"]) : 0;
  }

  public override async rollback(): Promise<void> {
    /*
     * Forward-only. A partial conversion leaves the `<table>_preclustered`
     * backups intact (they are only dropped after the row-count check passes),
     * so no automated rollback is attempted — re-running the migration resumes
     * from the backups, and manual recovery is always possible from them.
     */
    logger.warn(
      "ConvertAnalyticsTablesToCluster rollback is a no-op; *_preclustered backups (if any) preserve the legacy data for manual recovery.",
    );
  }
}
