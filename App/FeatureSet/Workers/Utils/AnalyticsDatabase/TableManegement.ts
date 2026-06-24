import { AnalyticsServices } from "Common/Server/Services/Index";
import AnalyticsDatabaseService, {
  DbJSONResponse,
  Results,
} from "Common/Server/Services/AnalyticsDatabaseService";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import logger from "Common/Server/Utils/Logger";
import MaterializedView from "Common/Types/AnalyticsDatabase/MaterializedView";
import { JSONObject } from "Common/Types/JSON";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import Projection from "Common/Types/AnalyticsDatabase/Projection";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import {
  applyClusterToMaterializedViewQuery,
  getStorageTableName,
  onClusterClause,
} from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";

/**
 * A column as it physically exists in ClickHouse (read from
 * system.columns) — used to detect drift between the model and the table.
 */
type ExistingColumn = {
  type: string;
  codec: string;
};

export default class AnalyticsTableManagement {
  public static async createTables(): Promise<void> {
    for (const service of AnalyticsServices) {
      // create a table if it does not exist
      await service.execute(
        service.statementGenerator.toTableCreateStatement(),
      );

      /*
       * Self-heal column drift. `CREATE TABLE IF NOT EXISTS` above is a
       * no-op once the table exists, so a column added to a model after
       * the table was first created never reaches the physical table —
       * and the one-time DataMigrations that `ALTER … ADD COLUMN` are
       * tracked in Postgres and never re-run. Reconcile here, on every
       * boot, the same way createMaterializedViews() self-heals MV
       * triggers: add any model column the physical table is missing.
       *
       * Caveat: `ADD COLUMN` cannot change a table's ORDER BY / partition
       * key, so a reconciled column lands as a plain (non-key) column.
       * That is enough to keep schema-dependent statements valid — e.g.
       * the entity-scoped lightweight DELETE that MetricService cascades
       * into the metric MV tables, which only needs `primaryEntityId` to
       * exist to evaluate its predicate. A migration that needs the
       * column in the sort key still has to drop+recreate the table.
       */
      await this.reconcileColumns(service);

      /*
       * Self-heal the two other additive schema layers the inline
       * CREATE TABLE owns but CREATE ... IF NOT EXISTS can never re-apply
       * once the table exists:
       *  - skip indexes: addColumnInDatabase adds a column's index in a
       *    separate, non-atomic ALTER, so a failed ADD INDEX after a
       *    succeeded ADD COLUMN would otherwise never be retried.
       *  - projections: a projection added to a model after table creation
       *    never reaches the physical table without this.
       * Both are purely additive (never drop) and run after reconcileColumns
       * so every model column physically exists before we index/project it.
       */
      await this.reconcileSkipIndexes(service);
      await this.reconcileProjections(service);

      /*
       * The model's tableName is a Distributed table that wraps the local
       * `<tableName>Local` table created above. Reconcile it AFTER the local
       * table's columns / indexes / projections so the Distributed layout
       * matches.
       */
      await this.reconcileDistributedTable(service);
    }
  }

  /**
   * Ensure the app-facing `<tableName>` is the `Distributed` wrapper over the
   * local `<tableName>Local` storage table.
   *
   * createTables() runs on every boot BEFORE data migrations. On a
   * cluster-conversion boot the model's table still exists as the legacy
   * single-node MergeTree holding real data. We must NOT clobber it — but we
   * also must switch `<tableName>` to the Distributed table HERE (at schema-sync,
   * before ingestion ramps) rather than waiting for the late-running converter,
   * so NEW telemetry lands in the cluster tables from the get-go instead of
   * piling back into the legacy (and, on a multi-node cluster, re-splitting)
   * table. So: rename the legacy table aside to `<tableName>_preclustered`, then
   * create the Distributed wrapper. The ConvertAnalyticsTablesToCluster
   * migration later backfills the old rows from the backup (best-effort).
   *
   * The `_preclustered` suffix MUST match ConvertAnalyticsTablesToCluster's
   * PRECLUSTER_SUFFIX.
   */
  private static async reconcileDistributedTable(
    service: AnalyticsDatabaseService<AnalyticsBaseModel>,
  ): Promise<void> {
    const tableName: string = service.model.tableName;
    const preclustered: string = `${tableName}_preclustered`;

    const existingEngine: string | null = await this.getTableEngine(
      service,
      tableName,
    );

    if (existingEngine && !existingEngine.startsWith("Distributed")) {
      // Legacy non-Distributed table holding pre-cluster data.
      const backupEngine: string | null = await this.getTableEngine(
        service,
        preclustered,
      );
      if (backupEngine !== null) {
        /*
         * Inconsistent: the legacy table AND a backup both exist. Don't rename
         * (would fail) or create the Distributed wrapper (would clobber the
         * legacy table's live data). Leave it for manual intervention.
         */
        logger.error({
          message: `${tableName} still exists as a non-Distributed (${existingEngine}) table AND ${preclustered} already exists. Not renaming or creating the Distributed wrapper — manual intervention needed.`,
          table: tableName,
        });
        return;
      }

      try {
        logger.info({
          message: `Renaming legacy ${tableName} to ${preclustered} so new telemetry lands in the cluster tables immediately; ConvertAnalyticsTablesToCluster will backfill the old rows.`,
          table: tableName,
        });
        await service.execute(
          `RENAME TABLE ${tableName} TO ${preclustered}${onClusterClause()}`,
        );
      } catch (error) {
        /*
         * Rename failed — do NOT create the Distributed wrapper over the still
         * present legacy table (that would clobber it). Retry next boot.
         */
        logger.error({
          message: `Failed to rename legacy ${tableName} to ${preclustered}; leaving it in place. Distributed wrapper not created this boot.`,
          table: tableName,
          error: (error as Error).message,
        });
        return;
      }
    }

    /*
     * <tableName> is now absent (just renamed) or already Distributed — safe to
     * create / re-sync the Distributed wrapper.
     */
    await service.execute(
      service.statementGenerator.toDistributedTableCreateStatement(),
    );
  }

  /**
   * The ClickHouse engine string of a table (e.g. "MergeTree",
   * "ReplicatedMergeTree", "Distributed"), or null if it does not exist.
   */
  public static async getTableEngine(
    service: AnalyticsDatabaseService<AnalyticsBaseModel>,
    tableName: string,
  ): Promise<string | null> {
    const escapedTableName: string = this.escapeForQuery(tableName);
    let result: Results;
    try {
      result = await service.executeQuery(
        `SELECT engine FROM system.tables WHERE database = currentDatabase() AND name = '${escapedTableName}' LIMIT 1`,
      );
    } catch (error) {
      logger.error({
        message: `Failed to read engine for ${tableName}`,
        error: (error as Error).message,
      });
      return null;
    }

    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    if (!response.data || response.data.length === 0) {
      return null;
    }

    const row: JSONObject = response.data[0] as JSONObject;
    const engine: unknown = row["engine"];
    return typeof engine === "string" ? engine : null;
  }

  /**
   * Add any column declared on the model that is absent from the physical
   * table. One `system.columns` lookup per table, then per-column
   * `ADD COLUMN IF NOT EXISTS` (idempotent and race-safe across booting
   * replicas). Failures are logged and skipped so a single bad column
   * never aborts startup.
   */
  private static async reconcileColumns(
    service: AnalyticsDatabaseService<AnalyticsBaseModel>,
  ): Promise<void> {
    let existingColumns: Map<string, ExistingColumn>;

    try {
      existingColumns = await this.getExistingColumns(service);
    } catch (error) {
      logger.error({
        message: `Failed to read existing columns for ${service.model.tableName} - skipping column reconciliation.`,
        error: (error as Error).message,
      });
      return;
    }

    /*
     * No columns back ⇒ the table is genuinely absent (the CREATE above
     * failed or raced). There is nothing to reconcile, and
     * toTableCreateStatement() already owns creating it.
     */
    if (existingColumns.size === 0) {
      return;
    }

    for (const column of service.model.tableColumns) {
      if (existingColumns.has(column.key)) {
        continue;
      }

      try {
        logger.info(
          `Column ${column.key} is missing on ${service.model.tableName} - adding it.`,
        );
        await service.addColumnInDatabase(column);
      } catch (error) {
        logger.error({
          message: `Failed to add missing column ${column.key} on ${service.model.tableName}`,
          error: (error as Error).message,
        });
      }
    }

    /*
     * Surface — do NOT silently repair — columns whose physical TYPE no
     * longer matches the model. `ADD COLUMN` above only fixes MISSING
     * columns; a column whose type changed (most importantly an
     * AggregateFunction state type, e.g. quantile → quantileBFloat16)
     * keeps its old type forever, and the boot CREATE/ADD path can never
     * converge it. That exact drift makes a materialized view fail its
     * aggregate cast and — because the data-migration runner stops at the
     * first failure — can freeze the whole migration chain. Auto-dropping
     * the table here is unsafe (base tables hold irreplaceable telemetry),
     * so convergence stays owned by an explicit, data-loss-aware
     * DataMigration; this just makes the drift loud instead of silent.
     */
    this.reportColumnDrift(service, existingColumns);
  }

  private static async getExistingColumns(
    service: AnalyticsDatabaseService<AnalyticsBaseModel>,
  ): Promise<Map<string, ExistingColumn>> {
    const escapedTableName: string = this.escapeForQuery(
      getStorageTableName(service.model.tableName),
    );

    const result: Results = await service.executeQuery(
      `SELECT name, type, compression_codec FROM system.columns WHERE database = currentDatabase() AND table = '${escapedTableName}'`,
    );

    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    const columns: Map<string, ExistingColumn> = new Map<
      string,
      ExistingColumn
    >();

    for (const row of response.data || []) {
      const record: JSONObject = row as JSONObject;
      columns.set(String(record["name"]), {
        type: String(record["type"] ?? ""),
        codec: String(record["compression_codec"] ?? ""),
      });
    }

    return columns;
  }

  /**
   * Add any skip index declared on a model column that the physical table is
   * missing. reconcileColumns adds a freshly-added column's skip index in the
   * same pass (via addColumnInDatabase), but that is a TWO-statement,
   * non-atomic sequence: `ADD COLUMN` then a separate `ADD INDEX`. If the
   * column add succeeds but the index add throws, the column exists on the
   * next boot, so reconcileColumns short-circuits it (existingColumns.has) and
   * the index would never be retried. This reconciler closes that gap by
   * keying on INDEX existence (system.data_skipping_indices), not column
   * existence, so a missing index self-heals on a later boot.
   *
   * `ADD INDEX IF NOT EXISTS` is idempotent and race-safe across booting
   * replicas. Definition-only — it does NOT `MATERIALIZE INDEX` over historical
   * parts (matching addColumnInDatabase and the inline CREATE-TABLE index), so
   * the index applies to new and merged parts going forward. Failures are
   * logged and skipped so one bad index never aborts startup.
   */
  private static async reconcileSkipIndexes(
    service: AnalyticsDatabaseService<AnalyticsBaseModel>,
  ): Promise<void> {
    const indexedColumns: Array<AnalyticsTableColumn> =
      service.model.tableColumns.filter((column: AnalyticsTableColumn) => {
        return Boolean(column.skipIndex);
      });

    if (indexedColumns.length === 0) {
      return;
    }

    let existingIndexNames: Set<string>;

    try {
      existingIndexNames = await this.getExistingSkipIndexNames(service);
    } catch (error) {
      logger.error({
        message: `Failed to read existing skip indexes for ${service.model.tableName} - skipping skip-index reconciliation.`,
        error: (error as Error).message,
      });
      return;
    }

    for (const column of indexedColumns) {
      const indexName: string = column.skipIndex!.name;

      if (existingIndexNames.has(indexName)) {
        continue;
      }

      const indexStatement: Statement | null =
        service.statementGenerator.toAddSkipIndexStatement(column);

      if (!indexStatement) {
        continue;
      }

      try {
        logger.info(
          `Skip index ${indexName} is missing on ${service.model.tableName} - adding it.`,
        );
        await service.execute(indexStatement);
      } catch (error) {
        logger.error({
          message: `Failed to add missing skip index ${indexName} on ${service.model.tableName}`,
          error: (error as Error).message,
        });
      }
    }
  }

  private static async getExistingSkipIndexNames(
    service: AnalyticsDatabaseService<AnalyticsBaseModel>,
  ): Promise<Set<string>> {
    const escapedTableName: string = this.escapeForQuery(
      getStorageTableName(service.model.tableName),
    );

    const result: Results = await service.executeQuery(
      `SELECT name FROM system.data_skipping_indices WHERE database = currentDatabase() AND table = '${escapedTableName}'`,
    );

    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    const names: Set<string> = new Set<string>();

    for (const row of response.data || []) {
      const record: JSONObject = row as JSONObject;
      names.add(String(record["name"]));
    }

    return names;
  }

  /**
   * Log (loudly) any column whose physical type or codec has drifted from
   * the model. AggregateFunction state drift is logged at error level
   * because it breaks materialized-view creation; other type/codec changes
   * are warnings. Never mutates the table — convergence of a type change is
   * a destructive, data-loss-aware operation owned by an explicit
   * DataMigration. Conservative comparison (normalized) so cosmetic
   * differences never raise a false alarm and spam boot logs.
   */
  private static reportColumnDrift(
    service: AnalyticsDatabaseService<AnalyticsBaseModel>,
    existingColumns: Map<string, ExistingColumn>,
  ): void {
    const tableName: string = service.model.tableName;

    for (const column of service.model.tableColumns) {
      const existing: ExistingColumn | undefined = existingColumns.get(
        column.key,
      );

      if (!existing) {
        // Missing columns are handled by the ADD COLUMN path above.
        continue;
      }

      // ---- Type drift (most importantly AggregateFunction state types) ----
      let expectedType: string;
      try {
        expectedType = service.statementGenerator
          .toFullColumnType(column)
          .query.trim();
      } catch {
        // A column we cannot render (should never happen) is not worth a false alarm.
        continue;
      }

      if (
        this.normalizeChType(expectedType) !==
        this.normalizeChType(existing.type)
      ) {
        const detail: JSONObject = {
          message: `ClickHouse schema drift on ${tableName}.${column.key}: physical column type does not match the model. The boot schema-sync only ADDs missing columns and cannot change a type — a one-time DataMigration must drop+recreate (or MODIFY) this column to converge it.`,
          table: tableName,
          column: column.key,
          expectedType,
          actualType: existing.type,
        };

        if (column.type === TableColumnType.AggregateFunction) {
          // State-type drift here is what breaks CREATE MATERIALIZED VIEW.
          logger.error(detail);
        } else {
          logger.warn(detail);
        }
      }

      /*
       * ---- Codec drift (best-effort) ----
       * Gate on the MODEL declaring a codec, NOT on both sides having one.
       * system.columns.compression_codec is the empty string for a column
       * with no explicit codec, so an `&& existing.codec` guard would
       * silently swallow the most common real drift — the model now declares
       * a codec but the physical column has none (e.g. a codec added to the
       * model after the table was created, which the boot ADD path never
       * applies). The model is the source of truth: if it declares a codec
       * and the column lacks/differs from it, that is drift worth surfacing.
       */
      if (column.codec) {
        let expectedCodec: string = "";
        try {
          expectedCodec = StatementGenerator.buildCodecString(column.codec);
        } catch {
          expectedCodec = "";
        }

        if (
          expectedCodec &&
          this.normalizeCodec(expectedCodec) !==
            this.normalizeCodec(existing.codec)
        ) {
          logger.warn({
            message: `ClickHouse codec drift on ${tableName}.${column.key}: model declares CODEC(${expectedCodec}) but the column reports ${existing.codec || "no codec"}. A MODIFY COLUMN ... CODEC migration is needed to converge it.`,
            table: tableName,
            column: column.key,
            expectedCodec,
            actualCodec: existing.codec || "(none)",
          });
        }
      }
    }
  }

  /*
   * Normalize a ClickHouse type for comparison: lower-cased, whitespace
   * removed, and `Double` (what the model emits for Decimal) folded to the
   * canonical `Float64` that system.columns reports. Intentionally
   * conservative — it only flags real changes (and AggregateFunction state
   * types, which both sides render identically).
   */
  private static normalizeChType(type: string): string {
    return type
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/double/g, "float64");
  }

  /*
   * Reduce a codec spec to its ordered list of codec NAMES, dropping the
   * surrounding `CODEC( ... )` wrapper that system.columns reports and every
   * argument group. Comparing names only is deliberate: ClickHouse rewrites
   * default args in system.columns (e.g. a column declared `Gorilla` reports
   * back as `Gorilla(8)`, and levels like `ZSTD(1)` may be normalized), so an
   * arg-sensitive compare would warn on every healthy boot. Name-level
   * comparison still catches the meaningful drift — a codec added, removed,
   * replaced, or reordered — without the false positives.
   */
  private static normalizeCodec(codec: string): string {
    let inner: string = codec.toLowerCase().trim();

    const wrapped: RegExpMatchArray | null = inner.match(/^codec\((.*)\)$/);
    if (wrapped && wrapped[1] !== undefined) {
      inner = wrapped[1];
    }

    return inner
      .split(",")
      .map((part: string): string => {
        // keep only the codec name, dropping any "(args)" that follow it
        return part.replace(/\(.*$/, "").trim();
      })
      .filter((name: string): boolean => {
        return name.length > 0;
      })
      .join(",");
  }

  /**
   * True when the service's own table has at least one AggregateFunction
   * column whose physical state type no longer matches the model. This is
   * the drift that would make a `CREATE MATERIALIZED VIEW … TO <table>`
   * fail its aggregate cast, so createMaterializedViews uses it to refuse a
   * destructive auto-drop. Returns false on any read error (never block or
   * destroy on a transient failure).
   *
   * Assumes the MV's `TO` target is the owning service's own table, which
   * holds for every MV defined today (each `*_mv` targets its declaring
   * model's table). A future MV that targets a different table would need
   * this gate to check that target instead.
   */
  private static async hasAggregateTypeDrift(
    service: AnalyticsDatabaseService<AnalyticsBaseModel>,
  ): Promise<boolean> {
    let existingColumns: Map<string, ExistingColumn>;

    try {
      existingColumns = await this.getExistingColumns(service);
    } catch {
      return false;
    }

    if (existingColumns.size === 0) {
      return false;
    }

    for (const column of service.model.tableColumns) {
      if (column.type !== TableColumnType.AggregateFunction) {
        continue;
      }

      const existing: ExistingColumn | undefined = existingColumns.get(
        column.key,
      );

      if (!existing) {
        continue;
      }

      let expectedType: string;
      try {
        expectedType = service.statementGenerator
          .toFullColumnType(column)
          .query.trim();
      } catch {
        continue;
      }

      if (
        this.normalizeChType(expectedType) !==
        this.normalizeChType(existing.type)
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Ensure every materialized view declared on a registered analytics
   * model exists. Unlike the one-time DataMigrations (tracked in Postgres
   * and skipped once recorded as executed), this runs on every boot and
   * is idempotent — so a ClickHouse volume that was wiped or recreated
   * after the migration was recorded self-heals: the MV triggers are
   * recreated even though Postgres still marks the migration done.
   * Mirrors createTables() for the materialized-view layer, and must run
   * after it so the source/target tables already exist.
   *
   * A single failing view is logged and skipped rather than aborting
   * startup — the read path falls back to the base table, so a missing
   * MV degrades dashboard performance but does not take the worker down.
   */
  public static async createMaterializedViews(): Promise<void> {
    for (const service of AnalyticsServices) {
      const materializedViews: Array<MaterializedView> =
        service.model.materializedViews || [];

      for (const materializedView of materializedViews) {
        try {
          const exists: boolean = await this.doesMaterializedViewExist(
            service,
            materializedView.name,
          );

          if (exists) {
            const drifted: boolean = await this.hasMaterializedViewDrifted(
              service,
              materializedView,
            );

            if (!drifted) {
              logger.debug(
                `Materialized view ${materializedView.name} already exists and matches the model - skipping create.`,
              );
              continue;
            }

            /*
             * SAFETY GATE 1: enforce the invariant the next gate relies on.
             * hasAggregateTypeDrift below inspects the OWNING service's table
             * (service.model.tableName) — that is only the MV's real recreate
             * target when the MV's `TO` clause points at the owning table,
             * which holds for every MV today. If a future MV targets a
             * DIFFERENT table, that assumption breaks: the gate would clear a
             * table that is not the recreate target, we could DROP a working
             * view, and the CREATE could then fail against a drifted foreign
             * target — leaving NO view. Rather than silently trust the
             * assumption, verify it and refuse the destructive drop when it
             * does not hold.
             */
            const declaredTarget: string | null =
              this.extractMaterializedViewTarget(materializedView.query);

            if (
              declaredTarget &&
              declaredTarget.toLowerCase() !==
                service.model.tableName.toLowerCase()
            ) {
              logger.error({
                message: `Materialized view ${materializedView.name} has drifted but its TO target (${declaredTarget}) is not the owning table ${service.model.tableName}. The aggregate-drift safety gate only inspects the owning table, so an auto-drop here cannot be proven safe — leaving the existing view in place. A DataMigration must own recreating an MV that targets a different table.`,
                view: materializedView.name,
                declaredTarget,
                owningTable: service.model.tableName,
              });
              continue;
            }

            /*
             * SAFETY GATE 2: only auto-drop when the recreate is sure to
             * succeed. If the MV's target table has AggregateFunction
             * type drift (e.g. quantile → quantileBFloat16), recreating the
             * model MV would fail the aggregate cast — and we'd have dropped
             * a stale-but-functioning view, leaving NO view until a
             * migration rebuilds the table. That table+view rebuild is a
             * destructive, data-loss-aware operation owned by an explicit
             * DataMigration, so here we leave the existing view untouched
             * and log loudly instead.
             */
            const targetDrift: boolean =
              await this.hasAggregateTypeDrift(service);

            if (targetDrift) {
              logger.error({
                message: `Materialized view ${materializedView.name} has drifted AND its target table ${service.model.tableName} has AggregateFunction type drift. Not auto-dropping the view (recreating it would fail the aggregate cast) — a DataMigration must rebuild the table and view together. Leaving the existing view in place.`,
                view: materializedView.name,
                table: service.model.tableName,
              });
              continue;
            }

            /*
             * Pure MV-definition drift (e.g. a changed source table or a
             * non-state SELECT change) with a matching target table. DROP it
             * so the create below re-attaches the canonical definition;
             * otherwise the existence check would skip it forever and reads
             * would run against a stale view. SYNC so the drop completes
             * before the recreate. The MV holds no data of its own (its
             * target table does), so this only rebuilds the trigger.
             */
            logger.warn(
              `Materialized view ${materializedView.name} has drifted from the model definition - dropping and recreating it.`,
            );
            await service.execute(
              `DROP VIEW IF EXISTS ${this.escapeIdentifier(
                materializedView.name,
              )}${onClusterClause()} SYNC`,
            );
          } else {
            /*
             * SAFETY GATE (missing-view path): creating the view issues
             * CREATE MATERIALIZED VIEW … TO <table> AS SELECT …, which makes
             * ClickHouse build converting actions from the SELECT's
             * aggregate-state output to the target table's columns. If the
             * target table still has the OLD AggregateFunction state type
             * (e.g. quantile while the model now emits quantileBFloat16State),
             * that cast is impossible and the CREATE throws
             * (createAggregateFunctionWrapper). This is the SAME hazard
             * Safety Gate 2 guards on the drift-recreate path above; the
             * missing-view branch must guard it too. The window where the
             * view is gone but the table is still the legacy type is opened
             * by the table+view rebuild DataMigration (DROP VIEW → DROP TABLE
             * → CREATE TABLE): this method runs unlocked on every replica's
             * boot, so a concurrent replica can observe the view missing while
             * the table has not yet been rebuilt. Refuse the create and let
             * that DataMigration rebuild the table and view together. Only
             * gate when the MV's TO target IS the owning table, since
             * hasAggregateTypeDrift inspects that table — a foreign-target MV
             * (none exist today) has no drift signal here and creates as
             * before, matching prior behavior.
             */
            const declaredTarget: string | null =
              this.extractMaterializedViewTarget(materializedView.query);

            if (
              declaredTarget &&
              declaredTarget.toLowerCase() ===
                service.model.tableName.toLowerCase() &&
              (await this.hasAggregateTypeDrift(service))
            ) {
              logger.error({
                message: `Materialized view ${materializedView.name} is missing AND its target table ${service.model.tableName} has AggregateFunction type drift. Not creating the view (the aggregate cast would fail) — a DataMigration must rebuild the table and view together. Leaving the view absent until then.`,
                view: materializedView.name,
                table: service.model.tableName,
              });
              continue;
            }

            logger.info(
              `Materialized view ${materializedView.name} is missing - creating it.`,
            );
          }

          await this.createMaterializedView(service, materializedView);
        } catch (error) {
          logger.error({
            message: `Failed to ensure materialized view ${materializedView.name} on ${service.model.tableName}`,
            error: (error as Error).message,
          });
        }
      }
    }
  }

  /**
   * Returns the stored CREATE statement of a materialized view (from
   * system.tables.create_table_query), or null if the view does not
   * exist. Callers use this to distinguish a correctly-defined view from
   * a stale one — e.g. an MV still sourcing the pre-v2 `MetricItem`
   * table instead of `MetricItemV2`.
   */
  public static async getMaterializedViewCreateQuery(
    service: AnalyticsDatabaseService<AnalyticsBaseModel>,
    viewName: string,
  ): Promise<string | null> {
    const databaseName: string | undefined =
      service.database.getDatasourceOptions().database;

    if (!databaseName) {
      return null;
    }

    const escapedDatabaseName: string = this.escapeForQuery(databaseName);
    const escapedViewName: string = this.escapeForQuery(viewName);

    const statement: string = `SELECT create_table_query FROM system.tables WHERE database = '${escapedDatabaseName}' AND name = '${escapedViewName}' AND engine = 'MaterializedView' LIMIT 1`;

    const result: Results = await service.executeQuery(statement);

    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    if (!response.data || response.data.length === 0) {
      return null;
    }

    const row: JSONObject = response.data[0] as JSONObject;
    const createQuery: unknown = row["create_table_query"];

    return typeof createQuery === "string" ? createQuery : null;
  }

  /**
   * Decide whether an existing materialized view's stored definition has
   * drifted from the model's canonical definition. ClickHouse rewrites and
   * fully-qualifies `create_table_query`, so a raw textual diff would always
   * report a (false) change and churn DROP/CREATE every boot. Instead we
   * extract the load-bearing identifiers from the MODEL query — the source
   * table (FROM), the target table (TO) and every aggregate-state function
   * (e.g. sumState, quantileBFloat16State) — and require each to appear in
   * the stored definition. ClickHouse preserves table and function names
   * verbatim, so a missing token means a real semantic change (a renamed
   * source table, or a changed aggregate function), which is exactly the
   * drift that breaks the view. Conservative by design: it under-reports
   * rather than risk a destructive false positive. Returns false on any
   * read error so a transient failure never triggers a drop.
   */
  private static async hasMaterializedViewDrifted(
    service: AnalyticsDatabaseService<AnalyticsBaseModel>,
    materializedView: MaterializedView,
  ): Promise<boolean> {
    let storedQuery: string | null;

    try {
      storedQuery = await this.getMaterializedViewCreateQuery(
        service,
        materializedView.name,
      );
    } catch (error) {
      logger.error({
        message: `Failed to read stored definition for materialized view ${materializedView.name} - assuming no drift.`,
        error: (error as Error).message,
      });
      return false;
    }

    if (!storedQuery) {
      return false;
    }

    const haystack: string = storedQuery.toLowerCase();
    const expectedTokens: Array<string> = this.extractMaterializedViewTokens(
      materializedView.query,
    );

    const missing: Array<string> = expectedTokens.filter((token: string) => {
      return !haystack.includes(token.toLowerCase());
    });

    if (missing.length > 0) {
      logger.warn({
        message: `Materialized view ${materializedView.name} is missing expected identifiers from its stored definition - treating as drift.`,
        missing,
      });
      return true;
    }

    return false;
  }

  /**
   * Pull the load-bearing identifiers out of a model MV definition: the
   * source table after FROM, the target table after TO, and every
   * aggregate-state function (a `<name>State(` call). Used to fingerprint a
   * view against its stored ClickHouse definition without a brittle textual
   * diff.
   */
  private static extractMaterializedViewTokens(query: string): Array<string> {
    const tokens: Set<string> = new Set<string>();

    const fromMatch: RegExpMatchArray | null = query.match(
      /\bFROM\s+([A-Za-z0-9_]+)/,
    );
    if (fromMatch && fromMatch[1]) {
      tokens.add(fromMatch[1]);
    }

    const toMatch: RegExpMatchArray | null = query.match(
      /\bTO\s+([A-Za-z0-9_]+)/,
    );
    if (toMatch && toMatch[1]) {
      tokens.add(toMatch[1]);
    }

    const stateFnRegex: RegExp = /\b([A-Za-z0-9]+State)\s*\(/g;
    let stateMatch: RegExpExecArray | null = stateFnRegex.exec(query);
    while (stateMatch !== null) {
      if (stateMatch[1]) {
        tokens.add(stateMatch[1]);
      }
      stateMatch = stateFnRegex.exec(query);
    }

    return Array.from(tokens);
  }

  /**
   * The bare table name a model MV writes into (its `TO` target), or null if
   * the query has no `TO` clause. Strips an optional `db.` qualifier and
   * backticks so it can be compared to a model's tableName. Used to verify
   * the documented invariant that an MV targets its declaring model's own
   * table before the aggregate-drift safety gate (which only inspects that
   * owning table) is trusted to authorise a destructive drop.
   */
  private static extractMaterializedViewTarget(query: string): string | null {
    const toMatch: RegExpMatchArray | null = query.match(
      /\bTO\s+`?(?:[A-Za-z0-9_]+\.)?([A-Za-z0-9_]+)`?/,
    );

    if (toMatch && toMatch[1]) {
      return toMatch[1];
    }

    return null;
  }

  /**
   * Ensure every projection declared on a model exists on its physical table.
   * Projections are emitted inline by toColumnsCreateStatement, but that only
   * fires under CREATE TABLE IF NOT EXISTS — a no-op once the table exists. So
   * a projection ADDED to a model after the table was created (the normal way
   * to introduce one going forward) never reaches the table. This is the
   * projection-layer counterpart to reconcileColumns: on every boot, ADD any
   * declared projection the table is missing (`ALTER ... ADD PROJECTION IF NOT
   * EXISTS` — idempotent and race-safe across replicas), then MATERIALIZE it
   * over existing parts asynchronously (mutations_sync=0) so it also covers
   * historical rows without blocking boot. A fresh table already has the
   * projection inline, so doesProjectionExist short-circuits there.
   *
   * Purely additive, like reconcileColumns: a projection REMOVED from a model
   * is left in place (dropping is destructive and owned by a DataMigration).
   * One failing projection is logged and skipped, never aborting startup.
   */
  private static async reconcileProjections(
    service: AnalyticsDatabaseService<AnalyticsBaseModel>,
  ): Promise<void> {
    const projections: Array<Projection> = service.model.projections || [];

    if (projections.length === 0) {
      return;
    }

    const databaseName: string | undefined =
      service.database.getDatasourceOptions().database;

    if (!databaseName) {
      logger.warn(
        `Cannot reconcile projections on ${service.model.tableName} because database name is undefined`,
      );
      return;
    }

    const escapedDatabase: string = this.escapeIdentifier(databaseName);
    /*
     * Projections live on the physical (local) storage table — in cluster mode
     * `<tableName>Local`, otherwise the model's own table.
     */
    const escapedTable: string = this.escapeIdentifier(
      getStorageTableName(service.model.tableName),
    );

    for (const projection of projections) {
      let exists: boolean;

      try {
        exists = await this.doesProjectionExist(service, projection.name);
      } catch (error) {
        logger.error({
          message: `Failed to check projection ${projection.name} on ${service.model.tableName} - skipping it.`,
          error: (error as Error).message,
        });
        continue;
      }

      if (exists) {
        continue;
      }

      const escapedProjection: string = this.escapeIdentifier(projection.name);

      try {
        logger.info(
          `Projection ${projection.name} is missing on ${service.model.tableName} - adding it.`,
        );

        await service.execute(
          `ALTER TABLE ${escapedDatabase}.${escapedTable} ADD PROJECTION IF NOT EXISTS ${escapedProjection} (${projection.query})`,
        );

        /*
         * Materialize over existing parts so the projection covers historical
         * rows, not just future inserts. mutations_sync=0 returns immediately
         * and runs the mutation in the background server-side — materializing
         * a projection on a large table can take a long time and must never
         * block boot. New and merged parts get the projection automatically.
         */
        await service.execute(
          `ALTER TABLE ${escapedDatabase}.${escapedTable} MATERIALIZE PROJECTION ${escapedProjection} SETTINGS mutations_sync=0`,
        );
      } catch (error) {
        logger.error({
          message: `Failed to add/materialize projection ${projection.name} on ${service.model.tableName}`,
          error: (error as Error).message,
        });
      }
    }
  }

  public static async doesProjectionExist(
    service: AnalyticsDatabaseService<AnalyticsBaseModel>,
    projectionName: string,
  ): Promise<boolean> {
    const databaseName: string | undefined =
      service.database.getDatasourceOptions().database;

    if (!databaseName) {
      return false;
    }

    const escapedDatabaseName: string = this.escapeForQuery(databaseName);
    const escapedTableName: string = this.escapeForQuery(
      getStorageTableName(service.model.tableName),
    );
    const escapedProjectionName: string = this.escapeForQuery(projectionName);

    const statement: string = `SELECT name FROM system.projections WHERE database = '${escapedDatabaseName}' AND table = '${escapedTableName}' AND name = '${escapedProjectionName}' LIMIT 1`;

    let result: Results;

    try {
      result = await service.executeQuery(statement);
    } catch (error) {
      logger.error({
        message: `Failed to verify projection ${projectionName} on ${service.model.tableName}`,
        error: (error as Error).message,
      });
      throw error;
    }

    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    return Boolean(response.data && response.data.length > 0);
  }

  public static async materializeProjection(
    service: AnalyticsDatabaseService<AnalyticsBaseModel>,
    projectionName: string,
  ): Promise<void> {
    const databaseName: string | undefined =
      service.database.getDatasourceOptions().database;

    if (!databaseName) {
      logger.warn(
        `Cannot materialize projection ${projectionName} because database name is undefined`,
      );
      return;
    }

    const escapedDatabase: string = this.escapeIdentifier(databaseName);
    const escapedTable: string = this.escapeIdentifier(
      getStorageTableName(service.model.tableName),
    );
    const escapedProjection: string = this.escapeIdentifier(projectionName);

    const statement: string = `ALTER TABLE ${escapedDatabase}.${escapedTable} MATERIALIZE PROJECTION ${escapedProjection}`;

    logger.debug(
      `Materializing projection ${projectionName} on ${service.model.tableName}`,
    );

    try {
      await service.execute(statement);
    } catch (error) {
      const clickhouseError: { code?: string } = error as { code?: string };

      logger.error({
        message: `Failed to materialize projection ${projectionName} on ${service.model.tableName}`,
        error: (error as Error).message,
        code: clickhouseError?.code,
        stack: (error as Error).stack,
      });

      throw error;
    }
  }

  public static escapeForQuery(value: string): string {
    return value.replace(/'/g, "''");
  }

  public static escapeIdentifier(value: string): string {
    return `\`${value.replace(/`/g, "``")}\``;
  }

  public static async doesMaterializedViewExist(
    service: AnalyticsDatabaseService<AnalyticsBaseModel>,
    viewName: string,
  ): Promise<boolean> {
    const databaseName: string | undefined =
      service.database.getDatasourceOptions().database;

    if (!databaseName) {
      return false;
    }

    const escapedDatabaseName: string = this.escapeForQuery(databaseName);
    const escapedViewName: string = this.escapeForQuery(viewName);

    const statement: string = `SELECT name FROM system.tables WHERE database = '${escapedDatabaseName}' AND name = '${escapedViewName}' AND engine = 'MaterializedView' LIMIT 1`;

    let result: Results;

    try {
      result = await service.executeQuery(statement);
    } catch (error) {
      logger.error({
        message: `Failed to verify materialized view ${viewName} on ${service.model.tableName}`,
        error: (error as Error).message,
      });
      throw error;
    }

    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    return Boolean(response.data && response.data.length > 0);
  }

  public static async createMaterializedView(
    service: AnalyticsDatabaseService<AnalyticsBaseModel>,
    materializedView: MaterializedView,
  ): Promise<void> {
    try {
      /*
       * Inject ON CLUSTER and retarget the view's TO/FROM at the local
       * source/target tables before creating it.
       */
      await service.execute(
        applyClusterToMaterializedViewQuery(materializedView.query),
      );
    } catch (error) {
      const clickhouseError: { code?: string } = error as { code?: string };

      logger.error({
        message: `Failed to create materialized view ${materializedView.name} on ${service.model.tableName}`,
        error: (error as Error).message,
        code: clickhouseError?.code,
        stack: (error as Error).stack,
      });

      throw error;
    }
  }
}
