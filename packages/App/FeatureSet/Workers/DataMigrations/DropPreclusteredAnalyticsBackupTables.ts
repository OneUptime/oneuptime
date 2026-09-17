import DataMigrationBase from "./DataMigrationBase";
import { ClickHouseJsonResult } from "./ClickHouseMigrationUtil";
import MetricService from "Common/Server/Services/MetricService";
import { onClusterClause } from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";
import logger from "Common/Server/Utils/Logger";

// A plain identifier ending in `_preclustered` — the only shape this drops.
const PRECLUSTERED_TABLE_NAME: RegExp = /^[A-Za-z0-9_]+_preclustered$/;

/**
 * Drops the `<table>_preclustered` ClickHouse backups left behind by a
 * single-node -> cluster conversion.
 *
 * When a legacy single-node instance is upgraded to the always-clustered
 * analytics schema, the boot schema-sync (AnalyticsTableManagement
 * .reconcileDistributedTable) renames each legacy non-Distributed `<table>`
 * aside to `<table>_preclustered` and swaps in the `Distributed` wrapper, so
 * NEW telemetry lands in the cluster tables immediately. The pre-conversion
 * rows stay behind in the `_preclustered` backups.
 *
 * OneUptime's telemetry cuts are forward-only: history is not carried across
 * them automatically (the same policy as DropUnusedTelemetryTables and the
 * V2 -> V3 cut — see App/FeatureSet/Docs/Content/en/installation/upgrading.md,
 * 'Upgrading from OneUptime 10 -> 11'). Operators who want the pre-conversion
 * history must copy it out by hand BEFORE upgrading, or rename the source aside
 * to a non-`_preclustered` name (e.g. `…_backup`, which this migration does not
 * match). This migration reclaims the disk the abandoned backups hold instead
 * of leaving them stranded as a standing "un-backfilled history" warning.
 *
 * PERMANENT / DESTRUCTIVE: this DROPs the backups. Any pre-conversion rows that
 * live ONLY in `<table>_preclustered` (never copied into the cluster tables) are
 * gone for good once this runs. That is the intended behaviour.
 *
 * Discovers the backups exactly the way the admin-health probe did — every
 * `%_preclustered` table in the current database — so it drops whatever exists
 * and is a clean no-op on installs that never converted (fresh V3 installs, and
 * instances already fully clustered, never have `_preclustered` tables).
 *
 * Best-effort: a failed listing or drop is logged and skipped and migrate()
 * never throws, so a flaky ON CLUSTER DDL can never halt the migration chain.
 *
 * Runs in cluster mode (deliberately does NOT override runsInClusterMode): the
 * `_preclustered` backups only ever exist on a clustered instance, so this must
 * run there — the legacy single-node baseline path would skip it exactly where
 * the cleanup is needed.
 */
export default class DropPreclusteredAnalyticsBackupTables extends DataMigrationBase {
  public constructor() {
    super("DropPreclusteredAnalyticsBackupTables");
  }

  public override async migrate(): Promise<void> {
    let backupTables: Array<string> = [];

    try {
      const result: { json: () => Promise<unknown> } =
        await MetricService.executeQuery(
          "SELECT name FROM system.tables WHERE database = currentDatabase() AND name LIKE '%\\_preclustered'",
        );
      const json: ClickHouseJsonResult =
        (await result.json()) as ClickHouseJsonResult;

      backupTables = (json.data ?? [])
        .map((row: Record<string, unknown>) => {
          return String(row["name"] ?? "");
        })
        // Defensive: only ever drop a plain identifier ending in _preclustered.
        .filter((name: string) => {
          return PRECLUSTERED_TABLE_NAME.test(name);
        });
    } catch (err) {
      logger.error(
        "DropPreclusteredAnalyticsBackupTables: failed to list *_preclustered backups; nothing dropped this run.",
      );
      logger.error(err as Error);
      return;
    }

    for (const table of backupTables) {
      try {
        /*
         * ON CLUSTER so the backup is dropped on every node (each shard kept its
         * own legacy copy). max_table_size_to_drop = 0 lifts the server's 50 GB
         * drop guard — these backups routinely exceed it.
         */
        await MetricService.execute(
          `DROP TABLE IF EXISTS ${table}${onClusterClause()} SETTINGS max_table_size_to_drop = 0`,
        );
        logger.info(`DropPreclusteredAnalyticsBackupTables: dropped ${table}.`);
      } catch (err) {
        logger.error(
          `DropPreclusteredAnalyticsBackupTables: failed to drop ${table}; leaving it in place.`,
        );
        logger.error(err as Error);
      }
    }
  }

  public override async rollback(): Promise<void> {
    /*
     * Forward-only — the dropped backups cannot be recreated. No-op.
     */
    return;
  }
}
