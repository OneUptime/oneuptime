// This model will be extended by BaseModel and Nested Mdoel

import AnalyticsTableColumn from '../Types/AnalyticsDatabase/TableColumn';
import TableColumnType from '../Types/AnalyticsDatabase/TableColumnType';
import OneUptimeDate from '../Types/Date';
import BadDataException from '../Types/Exception/BadDataException';
import { JSONObject, JSONValue } from '../Types/JSON';
import ObjectID from '../Types/ObjectID';

export type RecordValue =
    | ObjectID
    | string
    | number
    | boolean
    | Date
    | Array<number>
    | Array<string>
    | Array<CommonModel>;

export type Record = Array<RecordValue | Record>;

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

            if (
                column.type === TableColumnType.Number &&
                typeof value === 'string'
            ) {
                value = parseInt(value);
            }

            // decimal
            if (
                column.type === TableColumnType.Decimal &&
                typeof value === 'string'
            ) {
                value = parseFloat(value);
            }

            return (this.data[columnName] = value as any);
        }
        throw new BadDataException('Column ' + columnName + ' does not exist');
    }

    public constructor(data: { tableColumns: Array<AnalyticsTableColumn> }) {
        this.tableColumns = data.tableColumns;
    }

    public getColumnValue<T extends RecordValue>(
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

    public fromJSON(json: JSONObject): CommonModel {
        for (const key in json) {
            this.setColumnValue(key, json[key]);
        }

        return this;
    }

    public toJSON(): JSONObject {
        const json: JSONObject = {};

        this.tableColumns.forEach((column: AnalyticsTableColumn) => {
            const recordValue: RecordValue | undefined = this.getColumnValue(
                column.key
            );

            if (recordValue instanceof CommonModel) {
                json[column.key] = recordValue.toJSON();
                return;
            }

            if (recordValue instanceof Array) {
                if (
                    recordValue.length > 0 &&
                    recordValue[0] instanceof CommonModel
                ) {
                    json[column.key] = CommonModel.toJSONArray(
                        recordValue as Array<CommonModel>
                    );
                }

                return;
            }

            json[column.key] = recordValue;
        });

        return json;
    }

    public static fromJSONArray<TBaseModel extends CommonModel>(
        modelType: { new (): CommonModel },
        jsonArray: Array<JSONObject>
    ): Array<TBaseModel> {
        const models: Array<CommonModel> = [];

        jsonArray.forEach((json: JSONObject) => {
            const model: CommonModel = new modelType();
            model.fromJSON(json);
            models.push(model);
        });

        return models as Array<TBaseModel>;
    }

    public static toJSONArray(models: Array<CommonModel>): Array<JSONObject> {
        const json: Array<JSONObject> = [];

        models.forEach((model: CommonModel) => {
            json.push(model.toJSON());
        });

        return json;
    }
}
