import { AnalyticsServices } from 'CommonServer/Services/Index';

export default class AnalyticsTableManagement {
    public static async createTables(): Promise<void> {
        for (const service of AnalyticsServices) {
            // create a table if it does not exist
            await service.execute(
                service.statementGenerator.toTableCreateStatement()
            );
        }
    }
}
