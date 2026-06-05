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
    }
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
