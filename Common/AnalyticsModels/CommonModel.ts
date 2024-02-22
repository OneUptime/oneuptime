// This model will be extended by BaseModel and Nested Mdoel

import AnalyticsTableColumn from '../Types/AnalyticsDatabase/TableColumn';
import TableColumnType from '../Types/AnalyticsDatabase/TableColumnType';
import GreaterThan from '../Types/BaseDatabase/GreaterThan';
import GreaterThanOrEqual from '../Types/BaseDatabase/GreaterThanOrEqual';
import InBetween from '../Types/BaseDatabase/InBetween';
import Includes from '../Types/BaseDatabase/Includes';
import LessThan from '../Types/BaseDatabase/LessThan';
import LessThanOrEqual from '../Types/BaseDatabase/LessThanOrEqual';
import NotEqual from '../Types/BaseDatabase/NotEqual';
import Search from '../Types/BaseDatabase/Search';
import OneUptimeDate from '../Types/Date';
import BadDataException from '../Types/Exception/BadDataException';
import { JSONArray, JSONObject, JSONValue } from '../Types/JSON';
import JSONFunctions from '../Types/JSONFunctions';
import ObjectID from '../Types/ObjectID';

export type RecordValue =
    | ObjectID
    | string
    | number
    | boolean
    | Date
    | Search
    | NotEqual
    | GreaterThan
    | InBetween
    | Includes
    | Date
    | LessThan
    | LessThanOrEqual
    | GreaterThanOrEqual
    | Array<number>
    | Array<string>
    | Array<ObjectID>
    | Array<CommonModel>
    | CommonModel;

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
                (typeof value === 'string' || typeof value === 'object')
            ) {
                value = new ObjectID(value as string | JSONObject);
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

            // long number
            if (
                column.type === TableColumnType.LongNumber &&
                typeof value === 'string'
            ) {
                value = parseInt(value);
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

    public static fromJSON<T extends CommonModel>(
        json: JSONObject | JSONArray | CommonModel | Array<CommonModel>,
        type: { new (): T }
    ): T | Array<T> {
        if (Array.isArray(json)) {
            const arr: Array<T> = [];

            for (const item of json) {
                if (item instanceof CommonModel) {
                    arr.push(item as T);
                    continue;
                }

                arr.push(new type().fromJSON(item) as T);
            }

            return arr;
        }

        if (json instanceof CommonModel) {
            return json as T;
        }

        return new type().fromJSON(json) as T;
    }

    public static toJSON<T extends CommonModel>(
        model: T,
        _modelType: { new (): T }
    ): JSONObject {
        return model.toJSON();
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
                if (recordValue.length > 0 && column.nestedModelType) {
                    json[column.key] = CommonModel.toJSONArray(
                        recordValue as Array<CommonModel>,
                        column.nestedModelType
                    );
                }

                return;
            }

            json[column.key] = recordValue;
        });

        return JSONFunctions.serialize(json);
    }

    public static fromJSONArray<TBaseModel extends CommonModel>(
        jsonArray: Array<JSONObject | CommonModel>,
        modelType: { new (): CommonModel }
    ): Array<TBaseModel> {
        const models: Array<CommonModel> = [];

        jsonArray.forEach((json: JSONObject | CommonModel) => {
            if (json instanceof CommonModel) {
                models.push(json);
                return;
            }

            const model: CommonModel = new modelType();
            model.fromJSON(json);
            models.push(model);
        });

        return models as Array<TBaseModel>;
    }

    public static toJSONArray(
        models: Array<CommonModel>,
        modelType: { new (): CommonModel }
    ): Array<JSONObject> {
        const json: Array<JSONObject> = [];

        models.forEach((model: CommonModel) => {
            json.push(this.toJSON(model, modelType));
        });

        return json;
    }
}
