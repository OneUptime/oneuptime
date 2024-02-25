import DataMigrationBase from './DataMigrationBase';
import AnalyticsTableColumn from 'Common/Types/AnalyticsDatabase/TableColumn';
import LogService from 'CommonServer/Services/LogService';
import TableColumnType from 'Common/Types/AnalyticsDatabase/TableColumnType';
import Log from 'Model/AnalyticsModels/Log';

export default class ChangeLogSeverityColumnTypeFromTextToNumber extends DataMigrationBase {
    public constructor() {
        super('ChangeLogSeverityColumnTypeFromTextToNumber');
    }

    public override async migrate(): Promise<void> {

        debugger;

        const logSeverityNumberColumn: AnalyticsTableColumn | undefined =
            new Log().tableColumns.find((column: AnalyticsTableColumn) => {
                return column.key === 'severityNumber';
            });

        if (!logSeverityNumberColumn) {
            return;
        }

        const columnType: TableColumnType | null =
            await LogService.getColumnTypeInDatabase(logSeverityNumberColumn);

        if (!columnType || columnType === TableColumnType.Number) {
            await LogService.dropColumnInDatabase('severityNumber');
            await LogService.addColumnInDatabase(logSeverityNumberColumn);
        }
    }

    public override async rollback(): Promise<void> {
        return;
    }
}
