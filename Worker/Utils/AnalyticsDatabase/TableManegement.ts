import { AnalyticsServices } from "Common/Server/Services/Index";

export default class AnalyticsTableManagement {
  public static async createTables(): Promise<void> {
    for (const service of AnalyticsServices) {
      // create a table if it does not exist
      await service.execute(
        service.statementGenerator.toTableCreateStatement(),
      );

      const projections: Array<string> = service.model.projections;

      for (const projection of projections) {
        if (!projection || projection.trim().length === 0) {
          continue;
        }

        await service.execute(projection);
      }
    }
  }
}
