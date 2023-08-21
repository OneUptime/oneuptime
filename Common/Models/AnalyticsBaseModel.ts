import TableColumnType from '../Types/BaseDatabase/TableColumnType';
import AnalyticsTableColumn from '../Types/AnalyticsDatabase/TableColumn';

export default class AnalyticsDataModel {
    private _tableColumns: Array<AnalyticsTableColumn> = [];
    public get tableColumns(): Array<AnalyticsTableColumn> {
        return this._tableColumns;
    }
    public set tableColumns(v: Array<AnalyticsTableColumn>) {
        this._tableColumns = v;
    }

    private _tableName: string = '';
    public get tableName(): string {
        return this._tableName;
    }
    public set tableName(v: string) {
        this._tableName = v;
    }

    public constructor(data: {
        tableName: string;
        tableColumns: Array<AnalyticsTableColumn>;
    }) {
        this.tableName = data.tableName;

        this.tableColumns.push(
            new AnalyticsTableColumn({
                key: '_id',
                title: 'ID',
                description: 'ID of this object',
                required: true,
                type: TableColumnType.ObjectID,
            })
        );

        this.tableColumns.push(
            new AnalyticsTableColumn({
                key: 'createdAt',
                title: 'Created',
                description: 'Date and Time when the object was created.',
                required: true,
                type: TableColumnType.Date,
            })
        );

        this.tableColumns.push(
            new AnalyticsTableColumn({
                key: 'updatedAt',
                title: 'Updated',
                description: 'Date and Time when the object was updated.',
                required: true,
                type: TableColumnType.Date,
            })
        );

        this.tableColumns = this.tableColumns.concat(data.tableColumns);
    }

    public toTableCreateStatement(): string {
        return `CREATE TABLE IF NOT EXISTS ${this.tableName}
        (
            user_id UInt32,
            message String,
            timestamp DateTime,
            metric Float32
        )
        ENGINE = MergeTree()
        PRIMARY KEY (user_id, timestamp)`;
    }
}
