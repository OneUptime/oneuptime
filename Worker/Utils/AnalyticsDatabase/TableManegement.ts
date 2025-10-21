import { AnalyticsServices } from "Common/Server/Services/Index";
import AnalyticsDatabaseService, {
  DbJSONResponse,
  Results,
} from "Common/Server/Services/AnalyticsDatabaseService";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
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

      for (const projection of projections) {
        if (!projection.query || projection.query.trim().length === 0) {
          continue;
        }

        if (!projection.name || projection.name.trim().length === 0) {
          continue;
        }

        const projectionExists: boolean =
          await AnalyticsTableManagement.doesProjectionExist(
            service,
            projection.name,
          );

        if (projectionExists) {
          continue;
        }

        await service.execute(projection.query);
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

    const result: Results = await service.executeQuery(statement);
    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    return Boolean(response.data && response.data.length > 0);
  }

  private static escapeForQuery(value: string): string {
    return value.replace(/'/g, "''");
  }
}
