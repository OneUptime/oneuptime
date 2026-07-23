import DataMigrationBase from "./DataMigrationBase";
import ClickHouseMigrationUtil, {
  ClickHouseJsonResult,
} from "./ClickHouseMigrationUtil";
import AnalyticsDatabaseService, {
  ClickhouseExecuteOptions,
  MigrationExecuteOptions,
} from "Common/Server/Services/AnalyticsDatabaseService";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import MetricService from "Common/Server/Services/MetricService";
import MetricItemAggMV1mByServiceService from "Common/Server/Services/MetricItemAggMV1mByServiceService";
import MetricItemAggMV1mByK8sClusterService from "Common/Server/Services/MetricItemAggMV1mByK8sClusterService";
import MetricItemAggMV1mByContainerService from "Common/Server/Services/MetricItemAggMV1mByContainerService";
import MaterializedView from "Common/Types/AnalyticsDatabase/MaterializedView";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import {
  applyClusterToMaterializedViewQuery,
  getClickhouseClusterName,
  getClickhouseDatabaseName,
  getStorageTableName,
  onClusterClause,
} from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";
import logger from "Common/Server/Utils/Logger";

/*
 * Backfills the per-entity 1-minute aggregates of Metric data — service /
 * k8s cluster / container siblings of the per-host rollup
 * (MetricItemAggMV1mByHostV2), each keyed by the corresponding
 * ingest-stamped scalar entity-key column (serviceEntityKey /
 * k8sClusterEntityKey / containerEntityKey).
 *
 * Why:
 *   The Service, Kubernetes-cluster and container detail pages ALWAYS
 *   filter metric queries by their entity (resource.service.name /
 *   resource.k8s.cluster.name / resource.container.id, or the synthetic
 *   entityScope filter). MetricService.tryBuildEntityAggregateMVStatement
 *   routes those queries to these rollups — so if the rollups start empty
 *   on an existing install, every pre-upgrade time range silently renders
 *   empty charts even though the raw MetricItemV3 rows are still there.
 *   This migration re-derives the rollups from raw so history survives.
 *
 * Ownership split (same as the per-host V2 rollup):
 *   Table + MV creation is owned by the models + boot schema-sync (the
 *   three services are registered in AnalyticsServices, so a fresh install
 *   or wiped ClickHouse volume self-heals; both migration entrypoints —
 *   App/Migrate.ts and Workers/Index.ts — await createTables() +
 *   createMaterializedViews() BEFORE running data migrations). This
 *   one-time migration owns the BACKFILL of rows that were ingested before
 *   the MV triggers attached.
 *
 * CLUSTER-MODE ONLY, because that is the only layout that exists (see
 * ClusterConfig: the analytics schema is always Distributed over local
 * ReplicatedMergeTree; a single node is a "cluster of one"). Every step
 * follows the established cluster-mode precedents:
 *
 *   - MV triggers are dropped `ON CLUSTER ... SYNC` and recreated through
 *     applyClusterToMaterializedViewQuery, exactly like the boot
 *     schema-sync (AnalyticsTableManagement.createMaterializedViews /
 *     createMaterializedView) — never from materializedView.query
 *     verbatim, which points TO/FROM the Distributed wrappers.
 *   - TRUNCATE targets the LOCAL storage table `<table>Local`
 *     `ON CLUSTER` (TRUNCATE of a Distributed wrapper is unsupported),
 *     with `max_table_size_to_drop = 0` like
 *     DropPreclusteredAnalyticsBackupTables' big-object DDL.
 *   - The backfill INSERT ... SELECT reads the Distributed raw table and
 *     writes the Distributed rollup wrapper (which re-shards by the
 *     rollup's own sharding key), mirroring the INSERT-into-Distributed
 *     pattern documented in ConvertAnalyticsTablesToCluster; every
 *     statement runs with MigrationExecuteOptions (migration pool with its
 *     30-minute socket-idle ceiling + send_progress_in_http_headers) and
 *     the INSERTs additionally carry a server-side max_execution_time cap,
 *     per the guidance in Common/Server/Infrastructure/ClickhouseConfig.
 *
 * Bounded, chunked backfill:
 *   ConvertAnalyticsTablesToCluster deliberately refuses to stream its
 *   (unbounded, possibly billions-of-rows) legacy backups through a boot
 *   migration. This backfill is far smaller — it re-aggregates the raw
 *   metric table, which is bounded by the metric retention window, into
 *   1-minute rollups — but the same caution applies, so instead of one
 *   giant INSERT ... SELECT it runs one INSERT per raw-table partition
 *   (MetricItemV3 partitions by toYYYYMMDD(time), i.e. per day). Each
 *   chunk's GROUP BY state fits one day of metrics, each chunk gets its
 *   own max_execution_time budget, and partition pruning means each chunk
 *   reads exactly one partition.
 *
 * Backfill without double counting:
 *   Boot schema-sync creates the MVs earlier in the same boot, so by the
 *   time this runs the trigger may already have captured a few minutes of
 *   inserts. Per table: drop the MV trigger (ON CLUSTER ... SYNC),
 *   TRUNCATE the local target, re-derive everything currently in the raw
 *   table with per-partition INSERT ... SELECTs that reuse the MV's own
 *   SELECT text (state-identical by construction), then re-attach the
 *   trigger via the cluster MV helper. Rows ingested between a chunk's
 *   snapshot and the re-attach are missing from the rollup — the same
 *   forward-only, retention-bounded tradeoff every prior rollup migration
 *   accepted. Rows whose entity-key column is '' (ingested before the
 *   scalar entity-key columns existed) are skipped, matching the MV's
 *   WHERE.
 *
 * Idempotent / failure recovery: every DDL statement carries IF EXISTS /
 * IF NOT EXISTS, and re-running redoes the drop/truncate/backfill/attach
 * cycle from scratch (the TRUNCATE discards any partial backfill). If a
 * run fails part-way, the runner halts the chain and retries next boot;
 * the boot schema-sync recreates a dropped MV trigger before the retry, so
 * ingest keeps flowing into the rollups in the meantime. Per-table
 * failures are collected and re-thrown at the end so one broken table does
 * not stop the other backfills but the migration still records as failed.
 * Residual (accepted, bounded) race: an INSERT chunk orphaned server-side
 * by a killed pod could complete after a fast retry's TRUNCATE and double
 * count one day-partition; max_execution_time bounds any orphan's lifetime
 * to 30 minutes, and each chunk's deterministic query_id makes ClickHouse
 * reject a retry that overlaps a still-running predecessor.
 *
 * Fresh installs: the raw table has no parts, so this no-ops without
 * touching the boot-created MVs at all (guarded by a row-probe so an
 * empty partition listing on a table that HAS rows fails loudly instead of
 * silently skipping the backfill).
 */

/*
 * Server-side wall-clock cap per backfill chunk (one raw-table partition =
 * one day of metrics). Matches the migration pool's 30-minute socket-idle
 * ceiling (ClickhouseConfig.migrationDataSourceOptions), which
 * ClickhouseConfig prescribes pairing with a SETTINGS max_execution_time
 * so ClickHouse remains the authoritative cap.
 */
const BACKFILL_MAX_EXECUTION_TIME_IN_SECONDS: number = 1800;

/*
 * MetricItemV3 partitions by toYYYYMMDD(time), so system.parts renders each
 * partition as a bare digit string (e.g. "20260716"). Anything else means
 * the partition scheme changed under us — refuse to guess rather than
 * backfill the wrong slices.
 */
const RAW_PARTITION_VALUE: RegExp = /^[0-9]+$/;

export default class AddMetricEntityMinuteAggregateMaterializedViews extends DataMigrationBase {
  public constructor() {
    super("AddMetricEntityMinuteAggregateMaterializedViews");
  }

  /*
   * MUST run in cluster mode: the analytics schema is always clustered, so
   * a `false` here would make the runner baseline this migration (record it
   * as executed WITHOUT running it — see Utils/DataMigration.ts) and the
   * backfill would never happen anywhere. Explicit rather than inherited so
   * the intent survives a base-class default change.
   */
  public override runsInClusterMode(): boolean {
    return true;
  }

  public override async migrate(): Promise<void> {
    const rawTableName: string = MetricService.model.tableName;

    /*
     * Nothing to backfill from without the raw table (boot schema-sync
     * creates it before migrations run, so this only trips on a broken
     * install — skip rather than wedge the chain; there is no history to
     * lose if the raw table itself is gone).
     */
    if (!(await ClickHouseMigrationUtil.tableExists(rawTableName))) {
      logger.info(
        `AddMetricEntityMinuteAggregateMaterializedViews: ${rawTableName} not present — skipping.`,
      );
      return;
    }

    const partitions: Array<string> = await this.listRawMetricPartitions();

    if (partitions.length === 0) {
      /*
       * No parts anywhere on the cluster — a fresh install (or fully
       * TTL-expired raw table). Guard against the silent-loss failure mode
       * where the partition listing comes back empty even though the raw
       * table has rows (e.g. a clusterAllReplicas problem): in that case
       * fail loudly so the runner retries, instead of recording this
       * migration as done without ever backfilling.
       */
      if (await this.rawMetricTableHasAnyRow()) {
        throw new Error(
          `AddMetricEntityMinuteAggregateMaterializedViews: ${rawTableName} has rows but no partitions were found on the cluster (${getStorageTableName(rawTableName)} via clusterAllReplicas) — refusing to record the backfill as done.`,
        );
      }
      logger.info(
        `AddMetricEntityMinuteAggregateMaterializedViews: ${rawTableName} is empty — nothing to backfill (fresh install no-op).`,
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
        await this.rebuildAndBackfill(service, partitions);
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

  /*
   * Every ACTIVE partition of the raw metric table across the whole
   * cluster, ascending. system.parts is a per-node table, so it is read
   * through clusterAllReplicas — `cluster()` would read only one replica
   * per shard and could miss parts a lagging peer holds (the same
   * rationale ConvertAnalyticsTablesToCluster documents for reading
   * per-node data).
   */
  private async listRawMetricPartitions(): Promise<Array<string>> {
    const escapeString: (value: string) => string = (value: string) => {
      return value.replace(/'/g, "''");
    };

    const clusterName: string = escapeString(getClickhouseClusterName());
    const databaseName: string = escapeString(getClickhouseDatabaseName());
    const localRawTableName: string = escapeString(
      getStorageTableName(MetricService.model.tableName),
    );

    const result: { json: () => Promise<unknown> } =
      await MetricService.executeQuery(
        `SELECT DISTINCT partition FROM clusterAllReplicas('${clusterName}', system.parts) WHERE database = '${databaseName}' AND table = '${localRawTableName}' AND active ORDER BY partition ASC`,
        MigrationExecuteOptions,
      );
    const json: ClickHouseJsonResult =
      (await result.json()) as ClickHouseJsonResult;

    const partitions: Array<string> = (json.data ?? []).map(
      (row: Record<string, unknown>) => {
        return String(row["partition"] ?? "");
      },
    );

    for (const partition of partitions) {
      if (!RAW_PARTITION_VALUE.test(partition)) {
        /*
         * Unexpected partition rendering (the raw table's partition scheme
         * changed?). Skipping it would silently drop that slice from the
         * backfill, so refuse instead; the chain halts and surfaces this.
         */
        throw new Error(
          `unexpected ${MetricService.model.tableName} partition value "${partition}" (expected digits from ${MetricService.model.partitionKey}); refusing to backfill blind`,
        );
      }
    }

    return partitions;
  }

  /** Cheap probe: does the Distributed raw metric table have any row at all? */
  private async rawMetricTableHasAnyRow(): Promise<boolean> {
    const result: { json: () => Promise<unknown> } =
      await MetricService.executeQuery(
        `SELECT 1 AS present FROM ${MetricService.model.tableName} LIMIT 1`,
        MigrationExecuteOptions,
      );
    const json: ClickHouseJsonResult =
      (await result.json()) as ClickHouseJsonResult;
    return (json.data ?? []).length > 0;
  }

  private buildBackfillExecuteOptions(
    queryId: string,
  ): ClickhouseExecuteOptions {
    return {
      ...MigrationExecuteOptions,
      /*
       * Deterministic per-chunk query_id: a retry that overlaps a
       * still-running predecessor is rejected by ClickHouse (loud, retried
       * next boot) instead of double-writing, and a finished predecessor is
       * findable in system.query_log.
       */
      queryId: queryId,
      clickhouseSettings: {
        ...MigrationExecuteOptions.clickhouseSettings,
        max_execution_time: BACKFILL_MAX_EXECUTION_TIME_IN_SECONDS,
        /*
         * Wait until every shard has durably written its slice before the
         * INSERT returns — the default async distributed send could still
         * lose rows after this migration records as executed.
         */
        insert_distributed_sync: 1,
      },
    };
  }

  private async rebuildAndBackfill(
    service: AnalyticsDatabaseService<AnalyticsBaseModel>,
    partitions: Array<string>,
  ): Promise<void> {
    const tableName: string = service.model.tableName;
    const localTableName: string = getStorageTableName(tableName);
    const rawTableName: string = MetricService.model.tableName;

    const materializedView: MaterializedView | undefined = (service.model
      .materializedViews || [])[0];

    if (!materializedView) {
      throw new Error(`${tableName} declares no materialized view`);
    }

    /*
     * The rollup tables are owned by boot schema-sync, which both
     * entrypoints await before running migrations. If they are missing the
     * install is broken; fail (the chain halts and retries after
     * schema-sync self-heals next boot) rather than record the backfill as
     * done without having run it.
     */
    for (const requiredTable of [tableName, localTableName]) {
      if (!(await ClickHouseMigrationUtil.tableExists(requiredTable))) {
        throw new Error(
          `${requiredTable} does not exist — boot schema-sync has not created the rollup tables; failing so the backfill is retried next boot`,
        );
      }
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

    /*
     * Injection point for the per-partition predicate. The canonical MV
     * SELECTs all read `FROM MetricItemV3\nWHERE <entityKey> != ''`; keep
     * the Distributed raw table as the source (one coordinator-run INSERT
     * scatter-gathers all shards — the per-shard Local rewrite only applies
     * to the live MV trigger, created below via the cluster helper).
     */
    const whereMarker: string = `\nFROM ${rawTableName}\nWHERE `;
    if (!backfillSelect.includes(whereMarker)) {
      throw new Error(
        `${materializedView.name} query has an unexpected shape (no "FROM ${rawTableName} WHERE" clause); refusing to guess a backfill predicate`,
      );
    }

    /*
     * Explicit column list for the INSERTs, in the model's declared order —
     * which is the MV SELECT's output order by construction. Strict aggregate
     * models omit `_id` / `createdAt`; legacy physical targets can still carry
     * those columns until MigrateMetricAggregatesToStrictSchema runs later in
     * this chain. Keeping an explicit list makes both layouts safe.
     */
    const backfillColumns: Array<string> = service.model.tableColumns
      .map((column: AnalyticsTableColumn) => {
        return column.key;
      })
      .filter((key: string) => {
        return key !== "_id" && key !== "createdAt";
      });

    for (const column of backfillColumns) {
      // Drift tripwire: every insert column must come out of the MV SELECT.
      if (!backfillSelect.includes(column)) {
        throw new Error(
          `${materializedView.name} SELECT does not produce column "${column}" declared on ${tableName}; refusing a mis-aligned backfill`,
        );
      }
    }

    /*
     * 1. Detach the write path before the backfill, on every node.
     * ON CLUSTER + SYNC mirrors the boot schema-sync's drift drop
     * (AnalyticsTableManagement.createMaterializedViews); SYNC so the drop
     * completes before the TRUNCATE below (Atomic-engine deferred drops
     * would otherwise let stale objects linger). With the trigger gone,
     * nothing can insert into the target between the truncate and the
     * re-attach, so the backfill's derived states cannot be double counted.
     */
    await service.execute(
      `DROP VIEW IF EXISTS ${materializedView.name}${onClusterClause()} SYNC`,
      MigrationExecuteOptions,
    );

    /*
     * 2. Discard the boot-window states; the backfill re-derives them from
     * raw. TRUNCATE must target the LOCAL storage table on every node —
     * TRUNCATE of the Distributed wrapper is unsupported.
     * max_table_size_to_drop = 0 lifts the server's 50 GB safety guard, as
     * DropPreclusteredAnalyticsBackupTables does for its big drops (a
     * re-run after a near-complete backfill can be over the default).
     */
    await service.execute(
      `TRUNCATE TABLE IF EXISTS ${localTableName}${onClusterClause()} SETTINGS max_table_size_to_drop = 0`,
      MigrationExecuteOptions,
    );

    /*
     * 3. Backfill, one raw-table partition (= one day, toYYYYMMDD(time))
     * per INSERT. The predicate is on the raw table's own partition key,
     * so each chunk prunes to exactly one partition; INSERT INTO the
     * Distributed wrapper re-shards by the rollup's sharding key
     * (ConvertAnalyticsTablesToCluster's documented INSERT pattern).
     */
    for (const partition of partitions) {
      const chunkSelect: string = backfillSelect.replace(
        whereMarker,
        `\nFROM ${rawTableName}\nWHERE ${MetricService.model.partitionKey} = ${partition} AND `,
      );

      await service.execute(
        `INSERT INTO ${tableName}\n  (${backfillColumns.join(", ")})\n${chunkSelect}`,
        this.buildBackfillExecuteOptions(
          `${this.name}:${tableName}:${partition}`,
        ),
      );
    }

    logger.info(
      `AddMetricEntityMinuteAggregateMaterializedViews: backfilled ${tableName} from ${rawTableName} (${partitions.length} partition(s))`,
    );

    /*
     * 4. Re-attach the trigger; capture resumes from this instant. Must go
     * through the cluster MV transformation (ON CLUSTER + TO/FROM retargeted
     * at the Local tables) exactly like the boot schema-sync's
     * createMaterializedView — the model's query verbatim would attach a
     * trigger on the Distributed wrappers.
     */
    await service.execute(
      applyClusterToMaterializedViewQuery(materializedView.query),
      MigrationExecuteOptions,
    );
    logger.info(
      `AddMetricEntityMinuteAggregateMaterializedViews: (re)created ${materializedView.name}`,
    );
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
