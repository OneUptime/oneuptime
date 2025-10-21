import { AnalyticsServices } from "Common/Server/Services/Index";
import Projection from "Common/Types/AnalyticsDatabase/Projection";

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

        await service.execute(projection.query);
      }
    }
  }
}
