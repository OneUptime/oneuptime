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
