import AnalyticsBaseModel from "Common/Models/AnalyticsBaseModel";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "Common/Types/BaseDatabase/TableColumnType";
import AnalyticsTableEngine from "Common/Types/AnalyticsDatabase/AnalyticsTableEngine";

export default class Log extends AnalyticsBaseModel {
    public constructor() {
        super({
            tableName: 'Logs',
            tableEngine: AnalyticsTableEngine.MergeTree,
            tableColumns: [
                new AnalyticsTableColumn({
                    key: 'projectId',
                    title: 'Project ID',
                    description: 'ID of project',
                    required: true,
                    type: TableColumnType.ObjectID,
                }),
                new AnalyticsTableColumn({
                    key: 'logContainerId',
                    title: 'Log Container ID',
                    description: 'ID of the log container',
                    required: true,
                    type: TableColumnType.ObjectID,
                }),
                new AnalyticsTableColumn({
                    key: 'logData',
                    title: 'Log Data',
                    description: 'Data of the log container',
                    required: true,
                    type: TableColumnType.VeryLongText,
                }),
            ],
            primaryKeys: [
                'projectId', 'logContainerId', 'createdAt'
            ]
        })
    }
}