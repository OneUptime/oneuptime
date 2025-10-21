import { AnalyticsServices } from "Common/Server/Services/Index";
import AnalyticsDatabaseService, {
  DbJSONResponse,
  Results,
} from "Common/Server/Services/AnalyticsDatabaseService";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import logger from "Common/Server/Utils/Logger";
import Projection from "Common/Types/AnalyticsDatabase/Projection";
import { JSONObject } from "Common/Types/JSON";

export default class AnalyticsTableManagement {
  public static async createTables(): Promise<void> {
    for (const service of AnalyticsServices) {
      // create a table if it does not exist
      await service.execute(
        service.statementGenerator.toTableCreateStatement(),
      );

      const projections: Array<Projection> = service.model.projections;

      if (projections.length > 0) {
        logger.debug(
          `Processing ${projections.length} projections for ${service.model.tableName}`,
        );
      }

      for (const projection of projections) {
        if (!projection.query || projection.query.trim().length === 0) {
          logger.debug(
            `Skipping projection with empty query on ${service.model.tableName}`,
          );
          continue;
        }

        if (!projection.name || projection.name.trim().length === 0) {
          logger.debug(
            `Skipping projection with empty name on ${service.model.tableName}`,
          );
          continue;
        }

        logger.debug(
          `Ensuring projection ${projection.name} exists on ${service.model.tableName}`,
        );

        const projectionExists: boolean =
          await AnalyticsTableManagement.doesProjectionExist(
            service,
            projection.name,
          );

        if (projectionExists) {
          logger.debug(
            `Projection ${projection.name} already exists on ${service.model.tableName}`,
          );
          continue;
        }

        logger.debug(
          `Creating projection ${projection.name} on ${service.model.tableName}`,
        );

        await service.execute(projection.query);

        await AnalyticsTableManagement.materializeProjection(
          service,
          projection.name,
        );
      }
    }
  }

  private static async doesProjectionExist(
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

  private static async materializeProjection(
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

  private static escapeForQuery(value: string): string {
    return value.replace(/'/g, "''");
  }

  private static escapeIdentifier(value: string): string {
    return `\`${value.replace(/`/g, "``")}\``;
  }
}
