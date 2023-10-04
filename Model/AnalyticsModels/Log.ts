import AnalyticsBaseModel from 'Common/AnalyticsModels/BaseModel';
import AnalyticsTableColumn from 'Common/Types/AnalyticsDatabase/TableColumn';
import TableColumnType from 'Common/Types/BaseDatabase/TableColumnType';
import AnalyticsTableEngine from 'Common/Types/AnalyticsDatabase/AnalyticsTableEngine';
import ObjectID from 'Common/Types/ObjectID';

export default class Log extends AnalyticsBaseModel {
    public constructor() {
        super({
            tableName: 'Logs',
            tableEngine: AnalyticsTableEngine.MergeTree,
            singularName: 'Log',
            pluralName: 'Logs',
            tableColumns: [
                new AnalyticsTableColumn({
                    key: 'projectId',
                    title: 'Project ID',
                    description: 'ID of project',
                    required: true,
                    type: TableColumnType.ObjectID,
                }),

                new AnalyticsTableColumn({
                    key: 'sourceId',
                    title: 'Source ID',
                    description: 'ID of the Log Source',
                    required: true,
                    type: TableColumnType.ObjectID,
                }),

                new AnalyticsTableColumn({
                    key: 'message',
                    title: 'Log Message',
                    description: 'Log message',
                    required: true,
                    type: TableColumnType.VeryLongText,
                }),

                new AnalyticsTableColumn({
                    key: 'timestamp',
                    title: 'Timestamp',
                    description: 'When was the log created?',
                    required: true,
                    type: TableColumnType.Date,
                }),

                new AnalyticsTableColumn({
                    key: 'severity',
                    title: 'Severity',
                    description: 'Log Severity',
                    required: true,
                    type: TableColumnType.ShortText,
                }),
            ],
            primaryKeys: ['projectId', 'sourceId', 'timestamp'],
        });
    }

    public get severity(): string | undefined {
        return this.getColumnValue('severity') as string | undefined;
    }
    public set severity(v: string | undefined) {
        this.setColumnValue('severity', v);
    }

    public get timestamp(): Date | undefined {
        return this.getColumnValue('timestamp') as Date | undefined;
    }
    public set timestamp(v: Date | undefined) {
        this.setColumnValue('timestamp', v);
    }

    public get log(): string | undefined {
        return this.getColumnValue('log') as string | undefined;
    }
    public set log(v: string | undefined) {
        this.setColumnValue('log', v);
    }

    public get sourceId(): ObjectID | undefined {
        return this.getColumnValue('sourceId') as ObjectID | undefined;
    }

    public set sourceId(v: ObjectID | undefined) {
        this.setColumnValue('sourceId', v);
    }

    public get projectId(): ObjectID | undefined {
        return this.getColumnValue('projectId') as ObjectID | undefined;
    }

    public set projectId(v: ObjectID | undefined) {
        this.setColumnValue('projectId', v);
    }

    public get message(): string | undefined {
        return this.getColumnValue('message') as string | undefined;
    }

    public set message(v: string | undefined) {
        this.setColumnValue('message', v);
    }
}
