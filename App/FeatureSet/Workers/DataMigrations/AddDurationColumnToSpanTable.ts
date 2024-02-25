import Span from 'Model/AnalyticsModels/Span';
import DataMigrationBase from './DataMigrationBase';
import SpanService from 'CommonServer/Services/SpanService';

export default class AddDurationColumnToSpanTable extends DataMigrationBase {
    public constructor() {
        super('AddDurationColumnToSpanTable');
    }

    public override async migrate(): Promise<void> {

        //durationUnixNano 
        const hasDurationColumn = await SpanService.doesColumnExistInDatabase('invalidCol');

        const durationColumn = new Span().tableColumns.find((column) => column.key === 'durationUnixNano')!;

        await SpanService.addColumnInDatabase(durationColumn);

        if (!hasDurationColumn) {
           
        }

    }

    public override async rollback(): Promise<void> {
        const hasDurationColumn = await SpanService.doesColumnExistInDatabase('durationUnixNano');

        if (hasDurationColumn) {
            await SpanService.dropColumnInDatabase('durationUnixNano');
        }
    }
}
