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
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";

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
    }
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
      service.model.tableName,
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

      // ---- Codec drift (best-effort; only when the model declares one) ----
      if (column.codec && existing.codec) {
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
            message: `ClickHouse codec drift on ${tableName}.${column.key}: model declares CODEC(${expectedCodec}) but the column reports ${existing.codec}. A MODIFY COLUMN ... CODEC migration is needed to converge it.`,
            table: tableName,
            column: column.key,
            expectedCodec,
            actualCodec: existing.codec,
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
   * Normalize a codec for comparison: lower-cased, whitespace removed, and
   * the surrounding `CODEC( ... )` wrapper that system.columns reports
   * stripped so it lines up with buildCodecString's bare output.
   */
  private static normalizeCodec(codec: string): string {
    return codec
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/^codec\(/, "")
      .replace(/\)$/, "");
  }

  /**
   * True when the service's own table has at least one AggregateFunction
   * column whose physical state type no longer matches the model. This is
   * the drift that would make a `CREATE MATERIALIZED VIEW … TO <table>`
   * fail its aggregate cast, so createMaterializedViews uses it to refuse a
   * destructive auto-drop. Returns false on any read error (never block or
   * destroy on a transient failure).
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
             * SAFETY GATE: only auto-drop when the recreate is sure to
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
              `DROP VIEW IF EXISTS ${materializedView.name} SYNC`,
            );
          } else {
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
      service.model.tableName,
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
    const escapedTable: string = this.escapeIdentifier(service.model.tableName);
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
      await service.execute(materializedView.query);
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
