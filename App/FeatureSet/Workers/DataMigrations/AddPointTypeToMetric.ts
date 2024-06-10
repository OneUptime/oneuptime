import DataMigrationBase from './DataMigrationBase';
import AnalyticsTableColumn from 'Common/Types/AnalyticsDatabase/TableColumn';
import TableColumnType from 'Common/Types/AnalyticsDatabase/TableColumnType';
import MetricService from 'CommonServer/Services/MetricService';
import Metric from 'Model/AnalyticsModels/Metric';

export default class AddPointTypeToMetric extends DataMigrationBase {
    public constructor() {
        super('AddPointTypeToMetric');
    }

    public override async migrate(): Promise<void> {
        const column: AnalyticsTableColumn | undefined =
            new Metric().tableColumns.find((column: AnalyticsTableColumn) => {
                return column.key === 'metricPointType';
            });

        if (!column) {
            return;
        }

        const columnType: TableColumnType | null =
            await MetricService.getColumnTypeInDatabase(column);

        if (!columnType) {
            await MetricService.dropColumnInDatabase('metricPointType');
            await MetricService.addColumnInDatabase(column);
        }
    }

    public override async rollback(): Promise<void> {
        return;
    }
}
