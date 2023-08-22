import TableColumnType from '../Types/BaseDatabase/TableColumnType';
import AnalyticsTableColumn from '../Types/AnalyticsDatabase/TableColumn';
import BadDataException from '../Types/Exception/BadDataException';
import AnalyticsTableEngine from '../Types/AnalyticsDatabase/AnalyticsTableEngine';

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

    private _tableEngine: AnalyticsTableEngine = AnalyticsTableEngine.MergeTree;
    public get tableEngine(): AnalyticsTableEngine {
        return this._tableEngine;
    }
    public set tableEngine(v: AnalyticsTableEngine) {
        this._tableEngine = v;
    }

    private _primaryKeys: Array<string> = [];
    public get primaryKeys(): Array<string> {
        return this._primaryKeys;
    }
    public set primaryKeys(v: Array<string>) {
        this._primaryKeys = v;
    }

    public constructor(data: {
        tableName: string;
        tableEngine?: AnalyticsTableEngine | undefined;
        tableColumns: Array<AnalyticsTableColumn>;
        primaryKeys: Array<string>; // this should be the subset of tableColumns
    }) {
        const columns: Array<AnalyticsTableColumn> = [...data.tableColumns];

        this.tableName = data.tableName;

        if (data.tableEngine) {
            this.tableEngine = data.tableEngine;
        }

        columns.push(
            new AnalyticsTableColumn({
                key: '_id',
                title: 'ID',
                description: 'ID of this object',
                required: true,
                type: TableColumnType.ObjectID,
            })
        );

        columns.push(
            new AnalyticsTableColumn({
                key: 'createdAt',
                title: 'Created',
                description: 'Date and Time when the object was created.',
                required: true,
                type: TableColumnType.Date,
            })
        );

        columns.push(
            new AnalyticsTableColumn({
                key: 'updatedAt',
                title: 'Updated',
                description: 'Date and Time when the object was updated.',
                required: true,
                type: TableColumnType.Date,
            })
        );

        if (!data.primaryKeys || data.primaryKeys.length === 0) {
            throw new BadDataException('Primary keys are required');
        }

        // check if primary keys are subset of tableColumns

        console.log(columns);

        data.primaryKeys.forEach((primaryKey) => {
            if (
                !columns.find((column) => {
                    return column.key === primaryKey;
                })
            ) {
                throw new BadDataException(
                    'Primary key ' + primaryKey + ' is not part of tableColumns'
                );
            }
        });

        this.primaryKeys = data.primaryKeys;
        this.tableColumns = columns;
    }
}
