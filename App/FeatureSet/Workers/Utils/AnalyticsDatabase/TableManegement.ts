import { AnalyticsServices } from "Common/Server/Services/Index";
import AnalyticsDatabaseService, {
  DbJSONResponse,
  Results,
} from "Common/Server/Services/AnalyticsDatabaseService";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import logger from "Common/Server/Utils/Logger";
import MaterializedView from "Common/Types/AnalyticsDatabase/MaterializedView";
import { JSONObject } from "Common/Types/JSON";

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
    let existingColumns: Set<string>;

    try {
      existingColumns = await this.getExistingColumnNames(service);
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
  }

  private static async getExistingColumnNames(
    service: AnalyticsDatabaseService<AnalyticsBaseModel>,
  ): Promise<Set<string>> {
    const escapedTableName: string = this.escapeForQuery(
      service.model.tableName,
    );

    const result: Results = await service.executeQuery(
      `SELECT name FROM system.columns WHERE database = currentDatabase() AND table = '${escapedTableName}'`,
    );

    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    const names: Set<string> = new Set<string>();

    for (const row of response.data || []) {
      names.add(String((row as JSONObject)["name"]));
    }

    return names;
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
            logger.debug(
              `Materialized view ${materializedView.name} already exists - skipping create.`,
            );
            continue;
          }

          logger.info(
            `Materialized view ${materializedView.name} is missing - creating it.`,
          );

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
