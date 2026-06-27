import DataMigrationBase from "./DataMigrationBase";
import { ClickHouseJsonResult } from "./ClickHouseMigrationUtil";
import MetricService from "Common/Server/Services/MetricService";
import { MigrationExecuteOptions } from "Common/Server/Services/AnalyticsDatabaseService";
import AnalyticsTableName from "Common/Types/AnalyticsDatabase/AnalyticsTableName";
import {
  getClickhouseClusterName,
  getClickhouseDatabaseName,
  getStorageTableName,
  onClusterClause,
} from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";
import logger from "Common/Server/Utils/Logger";

/**
 * One-time drain of the incident/alert "metric mutation storm".
 *
 * Until the emit-once refresh fix, `IncidentService.refreshIncidentMetrics`
 * and `AlertService.refreshAlertMetrics` deleted-and-rewrote the lifecycle
 * metrics on EVERY state transition. Each delete compiled to a ClickHouse
 * `ALTER TABLE MetricItemV3Local … DELETE` mutation. On busy installs these
 * piled into a non-draining backlog (thousands pending, ~0 completing) that
 * blocked part merges, throttled metric ingest, and starved IO — the
 * recurring "ClickHouse is breaking" incidents.
 *
 * The code fix stops NEW such mutations, but a backlog already in
 * `system.mutations` never drains on its own — it must be cancelled. This
 * migration cancels the still-pending DELETE mutations on the metric table
 * cluster-wide via `KILL MUTATION ON CLUSTER`. Cancelling is safe: those
 * mutations are best-effort metric cleanups, and the rows they targeted are
 * now reconciled by the emit-once append path (routine transitions) and the
 * corrective recompute on manual state-timeline deletion.
 *
 * Scope is deliberately narrow:
 *   - only `MetricItemV3Local` — the table the RCA confirmed the backlog is
 *     on (the MV cascade never created mutations; it used a broken
 *     lightweight DELETE);
 *   - only `is_done = 0` — still pending, never anything already applied;
 *   - only `command LIKE 'DELETE%'` — so legitimate in-flight column / index
 *     materialization mutations (`UPDATE …` / `MATERIALIZE …`, e.g. the boot
 *     column reconciler's) are left untouched.
 *
 * Safe + idempotent everywhere: on a fresh install (or after the backlog is
 * already drained) nothing matches and the KILL is a no-op; it records once
 * and never re-runs. A failure is swallowed (logged, not thrown) so this
 * operational cleanup can never halt the migration chain.
 */
export default class KillStuckMetricDeleteMutations extends DataMigrationBase {
  public constructor() {
    super("KillStuckMetricDeleteMutations");
  }

  public override async migrate(): Promise<void> {
    const clusterName: string = getClickhouseClusterName();
    const databaseName: string = getClickhouseDatabaseName();

    // The storm's ALTER DELETE mutations run on the LOCAL storage table.
    const localTableName: string = getStorageTableName(
      AnalyticsTableName.Metric,
    );

    /*
     * `command` holds the mutation text, e.g. "DELETE WHERE projectId = '…'".
     * Matching only DELETE keeps this from cancelling unrelated mutations.
     */
    const mutationWhere: string =
      `database = '${databaseName}' ` +
      `AND table = '${localTableName}' ` +
      `AND is_done = 0 ` +
      `AND command LIKE 'DELETE%'`;

    try {
      const pendingCount: number | null = await this.countPendingMutations(
        clusterName,
        mutationWhere,
      );

      if (pendingCount === 0) {
        logger.info(
          `KillStuckMetricDeleteMutations: no pending DELETE mutations on ${localTableName} - nothing to drain.`,
        );
        return;
      }

      logger.info(
        `KillStuckMetricDeleteMutations: cancelling ${
          pendingCount ?? "any"
        } pending DELETE mutation(s) on ${localTableName} across cluster '${clusterName}'.`,
      );

      await MetricService.execute(
        `KILL MUTATION${onClusterClause()} WHERE ${mutationWhere}`,
        MigrationExecuteOptions,
      );

      logger.info("KillStuckMetricDeleteMutations: KILL MUTATION dispatched.");
    } catch (error) {
      /*
       * Operational cleanup — never halt the migration chain. If the KILL
       * fails (e.g. a degraded cluster refusing the ON CLUSTER DDL) an
       * operator can drain the backlog by hand per the RCA T1.1 runbook.
       */
      logger.warn(
        "KillStuckMetricDeleteMutations: failed to cancel stuck mutations; drain the backlog manually if the storm persists.",
      );
      logger.warn(error);
    }
  }

  private async countPendingMutations(
    clusterName: string,
    mutationWhere: string,
  ): Promise<number | null> {
    try {
      const result: { json: () => Promise<unknown> } =
        await MetricService.executeQuery(
          `SELECT count() AS pending FROM clusterAllReplicas('${clusterName}', system.mutations) WHERE ${mutationWhere}`,
          MigrationExecuteOptions,
        );
      const json: ClickHouseJsonResult =
        (await result.json()) as ClickHouseJsonResult;
      const row: Record<string, unknown> | undefined = json.data?.[0];
      return row ? Number(row["pending"]) : null;
    } catch (countError) {
      // Best-effort only — fall through to the KILL regardless of count.
      logger.warn(
        "KillStuckMetricDeleteMutations: could not count pending mutations; running KILL anyway.",
      );
      logger.warn(countError);
      return null;
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
