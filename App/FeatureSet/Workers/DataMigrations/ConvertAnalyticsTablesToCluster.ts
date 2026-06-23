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
 * Convert the existing single-node analytics tables to the sharded + replicated
 * cluster layout, in place, preserving data.
 *
 * Runs on every install. On a fresh install the boot schema-sync already created
 * the tables as Distributed, so every table is skipped and this is a no-op. For
 * an existing install, each analytics table that still exists as a legacy
 * (non-Distributed) MergeTree is converted:
 *
 *   1. (once, up front) drop the legacy materialized views so the cluster-aware
 *      boot sync rebuilds them reading/writing the local tables;
 *   2. ensure the local `<table>Local` ReplicatedMergeTree exists (boot
 *      createTables normally already made it);
 *   3. `RENAME TABLE <table> TO <table>_preclustered ON CLUSTER` — move the
 *      legacy data aside on every node;
 *   4. create the `Distributed` wrapper `<table>` over `<table>Local`;
 *   5. `INSERT INTO <table> SELECT … FROM clusterAllReplicas(<cluster>, db, <table>_preclustered)`
 *      — copy the legacy rows back through the Distributed table so they are
 *      re-sharded and replicated. clusterAllReplicas(...) reads EVERY node's
 *      backup (cluster() would read only one replica per shard and miss data on
 *      the others), so data that was split across nodes — the original "Span not
 *      found" incident — is reunified;
 *   6. verify row counts, then drop the backup. If the new count is below the
 *      legacy count the backup is LEFT IN PLACE for manual recovery.
 *
 * Idempotent: already-Distributed tables are skipped, and a conversion
 * interrupted between rename and copy is resumed from the `<table>_preclustered`
 * backup.
 *
 * OPERATIONAL NOTES:
 *  - Run in a maintenance window. Step 5 streams the entire legacy dataset
 *    through one coordinator node and can take a long time on large tables.
 *  - Requires the `<cluster>` cluster + Keeper to be configured and healthy.
 *  - This has NOT been validated end-to-end against a live multi-node cluster
 *    in this change; review and test against a staging cluster before
 *    production.
 */
export default class ConvertAnalyticsTablesToCluster extends DataMigrationBase {
  public constructor() {
    super("ConvertAnalyticsTablesToCluster");
  }

  public override async migrate(): Promise<void> {
    const cluster: string = getClickhouseClusterName();
    const failures: Array<string> = [];

    /*
     * 1. Drop legacy single-node materialized views (rebuilt cluster-correctly
     *    in step 3 below). ON CLUSTER + SYNC so the drop reaches every node and
     *    completes before the rebuild.
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

    // 2. Convert each table.
    for (const service of AnalyticsServices) {
      try {
        await this.convertTable(service, cluster);
      } catch (err) {
        logger.error({
          message: `ConvertAnalyticsTablesToCluster: failed to convert ${service.model.tableName}`,
          error: (err as Error).message,
        });
        failures.push(service.model.tableName);
      }
    }

    /*
     * 3. Rebuild materialized views cluster-correctly (ON CLUSTER, reading the
     *    local source, writing the local target).
     */
    try {
      await AnalyticsTableManagement.createMaterializedViews();
    } catch (err) {
      logger.error({
        message:
          "ConvertAnalyticsTablesToCluster: failed to rebuild materialized views after conversion",
        error: (err as Error).message,
      });
      failures.push("materializedViews");
    }

    if (failures.length > 0) {
      throw new Error(
        `ConvertAnalyticsTablesToCluster: conversion incomplete for [${failures.join(
          ", ",
        )}]. Any *${PRECLUSTER_SUFFIX} backups were left in place; resolve the error and let the migration re-run. See logs above.`,
      );
    }
  }

  private async convertTable(
    service: AnyAnalyticsService,
    cluster: string,
  ): Promise<void> {
    const table: string = service.model.tableName;
    const localTable: string = getStorageTableName(table); // `${table}Local`
    const preclustered: string = `${table}${PRECLUSTER_SUFFIX}`;

    const engine: string | null = await AnalyticsTableManagement.getTableEngine(
      service,
      table,
    );
    const backupEngine: string | null =
      await AnalyticsTableManagement.getTableEngine(service, preclustered);

    if (
      engine !== null &&
      engine.startsWith("Distributed") &&
      backupEngine === null
    ) {
      /*
       * Distributed AND no backup left = a prior run finished: the backup is
       * dropped ONLY after the row-count check passes, so its absence proves a
       * verified copy. Done.
       */
      logger.info(
        `ConvertAnalyticsTablesToCluster: ${table} is already converted - skipping.`,
      );
      return;
    }

    /*
     * Otherwise, if a backup still exists the copy was NOT confirmed (it never
     * reached the verify+drop step — e.g. the INSERT timed out or the pod
     * restarted mid-copy). Do NOT treat that as success: fall through and
     * re-copy idempotently (TRUNCATE + reload from the backup) below. The backup
     * is the source of truth until the count check passes.
     */

    if (engine === null && backupEngine === null) {
      /*
       * Fresh install: no legacy table and no backup. The boot sync owns
       * creating the Distributed wrapper.
       */
      logger.info(
        `ConvertAnalyticsTablesToCluster: ${table} has no legacy data to convert - skipping.`,
      );
      return;
    }

    logger.info(
      `ConvertAnalyticsTablesToCluster: converting ${table} (engine=${
        engine ?? "absent"
      }, backup=${backupEngine ?? "absent"}).`,
    );

    // Ensure the local Replicated storage table exists.
    await service.execute(service.statementGenerator.toTableCreateStatement());

    /*
     * Move the legacy table aside — only the legacy non-Distributed table, and
     * only if it has not already been renamed by an interrupted prior run.
     */
    if (
      engine !== null &&
      !engine.startsWith("Distributed") &&
      backupEngine === null
    ) {
      await service.execute(
        `RENAME TABLE ${table} TO ${preclustered}${onClusterClause()}`,
      );
    }

    // Create the Distributed wrapper over the local table.
    const distributedStatement: ReturnType<
      AnyAnalyticsService["statementGenerator"]["toDistributedTableCreateStatement"]
    > = service.statementGenerator.toDistributedTableCreateStatement();
    if (distributedStatement) {
      await service.execute(distributedStatement);
    }

    /*
     * Idempotent copy: a prior attempt may have been interrupted mid-INSERT
     * (timeout / pod restart) and left PARTIAL rows in the local table. The
     * backup is the source of truth until the count check passes, so clear the
     * local table and reload it fresh — re-running the INSERT without this would
     * duplicate the already-copied rows. TRUNCATE ON CLUSTER drops all parts on
     * every shard/replica. (Conversion of large data should run in a maintenance
     * window; this truncate assumes live ingestion is paused/minimal.)
     */
    await service.execute(`TRUNCATE TABLE ${localTable}${onClusterClause()}`);

    /*
     * Copy legacy rows back through the Distributed table (re-sharded +
     * replicated). Only columns present in BOTH the legacy table and the model
     * are copied; new columns take their defaults.
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
        `No columns in common between ${localTable} and ${preclustered}; refusing to copy.`,
      );
    }

    /*
     * clusterAllReplicas (NOT cluster): on the pre-cluster split-data setup the
     * legacy tables are plain MergeTree whose "replicas" hold DIFFERENT subsets
     * (that is the bug being fixed). `cluster()` reads only ONE replica per shard
     * (load-balanced), so it would silently skip the data on the other replicas;
     * `clusterAllReplicas()` reads EVERY node, so the full split dataset is
     * gathered and re-sharded through the Distributed table. On a single node the
     * two are identical.
     */
    const columnList: string = commonColumns.join(", ");
    /*
     * Progress headers are ESSENTIAL here. The ClickHouse client enforces its
     * request_timeout (58s) as a socket-IDLE timer, and an INSERT…SELECT returns
     * zero bytes until it finishes — so a copy that runs longer than 58s would
     * have its connection destroyed and the INSERT cancelled (leaving partial
     * data). `send_progress_in_http_headers` makes ClickHouse stream
     * X-ClickHouse-Progress header lines every http_headers_progress_interval_ms,
     * keeping the socket non-idle so an arbitrarily long copy completes. There is
     * no per-query max_execution_time on execute(), so the server runs it to
     * completion.
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

    /*
     * Verify before dropping the backup. The Distributed count spans all shards;
     * the clusterAllReplicas count spans EVERY node's backup (so the check can't
     * be fooled by data sitting on an un-read replica). Never drop on a shortfall
     * — leave the backup for manual recovery.
     */
    const newCount: number = await this.count(service, `${table}`);
    const oldCount: number = await this.countFrom(
      service,
      `clusterAllReplicas('${cluster}', currentDatabase(), ${preclustered})`,
    );

    if (newCount < oldCount) {
      throw new Error(
        `Row-count check failed for ${table}: Distributed table has ${newCount} rows but the legacy backup had ${oldCount}. Leaving ${preclustered} in place for manual recovery.`,
      );
    }

    logger.info(
      `ConvertAnalyticsTablesToCluster: ${table} converted; copied ${newCount} rows (legacy ${oldCount}). Dropping ${preclustered}.`,
    );
    await service.execute(
      `DROP TABLE IF EXISTS ${preclustered}${onClusterClause()} SYNC`,
    );
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

  private async count(
    service: AnyAnalyticsService,
    table: string,
  ): Promise<number> {
    return this.countFrom(service, table);
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
