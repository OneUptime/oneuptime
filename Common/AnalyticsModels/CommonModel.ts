// This model will be extended by BaseModel and Nested Mdoel 

import AnalyticsTableColumn from "../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../Types/AnalyticsDatabase/TableColumnType";
import OneUptimeDate from "../Types/Date";
import BadDataException from "../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../Types/JSON";
import ObjectID from "../Types/ObjectID";

export default class CommonModel { 

    protected data: JSONObject = {};
    
    private _tableColumns: Array<AnalyticsTableColumn> = [];
    public get tableColumns(): Array<AnalyticsTableColumn> {
        return this._tableColumns;
    }
    public set tableColumns(v: Array<AnalyticsTableColumn>) {
        this._tableColumns = v;
    }

    public setColumnValue(
        columnName: string,
        value: JSONValue | Array<CommonModel>
    ): void {
        const column: AnalyticsTableColumn | null =
            this.getTableColumn(columnName);

        if (column) {
            if (
                column.type === TableColumnType.ObjectID &&
                typeof value === 'string'
            ) {
                value = new ObjectID(value);
            }

            if (
                column.type === TableColumnType.Date &&
                typeof value === 'string'
            ) {
                value = OneUptimeDate.fromString(value);
            }

            if (
                column.type === TableColumnType.JSON &&
                typeof value === 'string'
            ) {
                value = JSON.parse(value);
            }

            return (this.data[columnName] = value as any);
        }
        throw new BadDataException('Column ' + columnName + ' does not exist');
    }

    public constructor(data: { tableColumns: Array<AnalyticsTableColumn> }) {
        this.tableColumns = data.tableColumns;
    }

    public getColumnValue<T extends JSONValue>(
        columnName: string
    ): T | undefined {
        if (this.getTableColumn(columnName)) {
            return this.data[columnName] as T;
        }

        return undefined;
    }

    public getTableColumn(name: string): AnalyticsTableColumn | null {
        const column: AnalyticsTableColumn | undefined = this.tableColumns.find(
            (column: AnalyticsTableColumn) => {
                return column.key === name;
            }
        );

        if (!column) {
            return null;
        }

        return column;
    }

    public getTableColumns(): Array<AnalyticsTableColumn> {
        return this.tableColumns;
    }
}