import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import NestedModel from "Common/AnalyticsModels/NestedModel";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";

export default class KeyValueNestedModel extends NestedModel {
    public constructor(){
        super({
            nestedColumns: [
                new AnalyticsTableColumn({
                    key: 'key',
                    title: 'Key',
                    description: 'Key of the attribute',
                    required: true,
                    type: TableColumnType.Text,
                }),

                new AnalyticsTableColumn({
                    key: 'value',
                    title: 'Value',
                    description: 'Value of the attribute',
                    required: true,
                    type: TableColumnType.Text,
                }),

            ]
        })
    }
}