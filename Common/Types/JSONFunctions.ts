import Typeof from './Typeof';
import DatabaseProperty from './Database/DatabaseProperty';
import OneUptimeDate from './Date';
import BaseModel from '../Models/BaseModel';
import { JSONArray, JSONObject, JSONValue, ObjectType } from './JSON';
import { TableColumnMetadata } from '../Types/Database/TableColumn';
import TableColumnType from '../Types/Database/TableColumnType';
import SerializableObject from './SerializableObject';
import SerializableObjectDictionary from './SerializableObjectDictionary';
import JSON5 from 'json5';

export default class JSONFunctions {
    public static isEmptyObject(
        obj: JSONObject | BaseModel | null | undefined
    ): boolean {
        if (!obj) {
            return true;
        }

        return Object.keys(obj).length === 0;
    }

    public static toJSON(
        model: BaseModel,
        modelType: { new (): BaseModel }
    ): JSONObject {
        const json: JSONObject = this.toJSONObject(model, modelType);
        return JSONFunctions.serialize(json);
    }

    public static toJSONObject(
        model: BaseModel,
        modelType: { new (): BaseModel }
    ): JSONObject {
        const json: JSONObject = {};

        const vanillaModel: BaseModel = new modelType();

        for (const key of vanillaModel.getTableColumns().columns) {
            if ((model as any)[key] === undefined) {
                continue;
            }

            const tableColumnMetadata: TableColumnMetadata =
                vanillaModel.getTableColumnMetadata(key);

            if (tableColumnMetadata) {
                if (
                    (model as any)[key] &&
                    tableColumnMetadata.modelType &&
                    tableColumnMetadata.type === TableColumnType.Entity &&
                    (model as any)[key] instanceof BaseModel
                ) {
                    (json as any)[key] = this.toJSONObject(
                        (model as any)[key],
                        tableColumnMetadata.modelType
                    );
                } else if (
                    (model as any)[key] &&
                    Array.isArray((model as any)[key]) &&
                    (model as any)[key].length > 0 &&
                    tableColumnMetadata.modelType &&
                    tableColumnMetadata.type === TableColumnType.EntityArray
                ) {
                    (json as any)[key] = this.toJSONObjectArray(
                        (model as any)[key] as Array<BaseModel>,
                        tableColumnMetadata.modelType
                    );
                } else {
                    (json as any)[key] = (model as any)[key];
                }
            }
        }

        return json;
    }

    public static toJSONObjectArray(
        list: Array<BaseModel>,
        modelType: { new (): BaseModel }
    ): JSONArray {
        const array: JSONArray = [];

        for (const item of list) {
            array.push(this.toJSONObject(item, modelType));
        }

        return array;
    }

    public static toJSONArray(
        list: Array<BaseModel>,
        modelType: { new (): BaseModel }
    ): JSONArray {
        const array: JSONArray = [];

        for (const item of list) {
            array.push(this.toJSON(item, modelType));
        }

        return array;
    }

    private static _fromJSON<T extends BaseModel>(
        json: JSONObject,
        type: { new (): T }
    ): T {
        json = JSONFunctions.deserialize(json);
        const baseModel: T = new type();

        for (const key of Object.keys(json)) {
            const tableColumnMetadata: TableColumnMetadata =
                baseModel.getTableColumnMetadata(key);
            if (tableColumnMetadata) {
                if (
                    json[key] &&
                    tableColumnMetadata.modelType &&
                    tableColumnMetadata.type === TableColumnType.Entity
                ) {
                    if (
                        json[key] &&
                        Array.isArray(json[key]) &&
                        (json[key] as Array<any>).length > 0
                    ) {
                        json[key] = (json[key] as Array<any>)[0];
                    }

                    (baseModel as any)[key] = this.fromJSON(
                        json[key] as JSONObject,
                        tableColumnMetadata.modelType
                    );
                } else if (
                    json[key] &&
                    tableColumnMetadata.modelType &&
                    tableColumnMetadata.type === TableColumnType.EntityArray
                ) {
                    if (json[key] && !Array.isArray(json[key])) {
                        json[key] = [json[key]];
                    }

                    (baseModel as any)[key] = this.fromJSONArray(
                        json[key] as JSONArray,
                        tableColumnMetadata.modelType
                    );
                } else {
                    (baseModel as any)[key] = json[key];
                }
            }
        }

        return baseModel as T;
    }

    public static fromJSON<T extends BaseModel>(
        json: JSONObject | JSONArray,
        type: { new (): T }
    ): T | Array<T> {
        if (Array.isArray(json)) {
            const arr: Array<T> = [];

            for (const item of json) {
                arr.push(this._fromJSON<T>(item, type));
            }

            return arr;
        }

        return this._fromJSON<T>(json, type);
    }

    public static fromJSONObject<T extends BaseModel>(
        json: JSONObject | T,
        type: { new (): T }
    ): T {
        if (json instanceof BaseModel) {
            return json;
        }

        return this.fromJSON<T>(json, type) as T;
    }

    public static fromJSONArray<T extends BaseModel>(
        json: Array<JSONObject>,
        type: { new (): T }
    ): Array<T> {
        const arr: Array<T> = [];

        for (const item of json) {
            arr.push(this._fromJSON<T>(item, type));
        }

        return arr;
    }

    public static toCompressedString(val: JSONValue): string {
        return JSON.stringify(val, null, 2);
    }

    public static toString(val: JSONValue): string {
        return JSON.stringify(val);
    }

    public static getJSONValueInPath(
        obj: JSONObject,
        path: string
    ): JSONValue | null {
        const paths: Array<string> = path.split('.');
        let returnValue: JSONObject = obj as JSONObject;
        for (const p of paths) {
            if (!p) {
                continue;
            }

            if (returnValue && returnValue[p as string]!) {
                returnValue = returnValue[p] as JSONObject;
            } else {
                return null;
            }
        }

        return returnValue as JSONValue;
    }

    // this funciton serializes JSON with Common Objects to JSON that can be stringified.
    public static serialize(val: JSONObject): JSONObject {
        const newVal: JSONObject = {};

        for (const key in val) {
            if (val[key] === undefined) {
                continue;
            }

            if (val[key] === null) {
                newVal[key] = val[key];
            }

            if (Array.isArray(val[key])) {
                const arraySerialize: Array<JSONValue> = [];
                for (const arrVal of val[key] as Array<JSONValue>) {
                    arraySerialize.push(this.serializeValue(arrVal));
                }

                newVal[key] = arraySerialize;
            } else {
                newVal[key] = this.serializeValue(val[key] as JSONValue);
            }
        }

        return newVal;
    }

    public static serializeValue(val: JSONValue): JSONValue {
        if (val === null || val === undefined) {
            return val;
        } else if (
            typeof val === Typeof.String &&
            val.toString().trim() === ''
        ) {
            return val;
        } else if (val instanceof BaseModel) {
            return this.toJSON(val, BaseModel);
        } else if (typeof val === Typeof.Number) {
            return val;
        } else if (ArrayBuffer.isView(val)) {
            return {
                _type: ObjectType.Buffer,
                value: val as Uint8Array,
            };
        } else if (val && val instanceof SerializableObject) {
            return val.toJSON();
        } else if (val && val instanceof Date) {
            return {
                _type: ObjectType.DateTime,
                value: OneUptimeDate.toString(val as Date).toString(),
            };
        } else if (
            typeof val === Typeof.Object &&
            (val as JSONObject)['_type'] &&
            Object.keys(ObjectType).includes(
                (val as JSONObject)['_type'] as string
            )
        ) {
            return val;
        } else if (typeof val === Typeof.Object) {
            return this.serialize(val as JSONObject);
        }

        return val;
    }

    public static deserializeValue(val: JSONValue): JSONValue {
        if (val === null || val === undefined) {
            return val;
        } else if (
            typeof val === Typeof.String &&
            val.toString().trim() === ''
        ) {
            return val;
        } else if (
            val &&
            typeof val === Typeof.Object &&
            (val as JSONObject)['_type'] &&
            (val as JSONObject)['value'] &&
            ((val as JSONObject)['value'] as JSONObject)['data'] &&
            ((val as JSONObject)['value'] as JSONObject)['type'] &&
            ((val as JSONObject)['value'] as JSONObject)['type'] ===
                ObjectType.Buffer &&
            ((val as JSONObject)['_type'] as string) === ObjectType.Buffer
        ) {
            return Buffer.from(
                ((val as JSONObject)['value'] as JSONObject)[
                    'data'
                ] as Uint8Array
            );
        } else if (val && ArrayBuffer.isView(val)) {
            return Buffer.from(val as Uint8Array);
        } else if (typeof val === Typeof.Number) {
            return val;
        } else if (val instanceof DatabaseProperty) {
            return val;
        } else if (
            val &&
            typeof val === Typeof.Object &&
            (val as JSONObject)['_type'] &&
            SerializableObjectDictionary[(val as JSONObject)['_type'] as string]
        ) {
            return SerializableObjectDictionary[
                (val as JSONObject)['_type'] as string
            ].fromJSON(val);
        } else if (val instanceof Date) {
            return val;
        } else if (typeof val === Typeof.Object) {
            return this.deserialize(val as JSONObject);
        }

        return val;
    }

    public static deserializeArray(array: JSONArray): JSONArray {
        const returnArr: JSONArray = [];

        for (const obj of array) {
            returnArr.push(this.deserialize(obj));
        }

        return returnArr;
    }

    public static serializeArray(array: JSONArray): JSONArray {
        const returnArr: JSONArray = [];

        for (const obj of array) {
            returnArr.push(this.serialize(obj));
        }

        return returnArr;
    }

    public static parse(val: string): JSONObject {
        return JSON5.parse(val);
    }

    public static deserialize(val: JSONObject): JSONObject {
        const newVal: JSONObject = {};
        for (const key in val) {
            if (val[key] === null || val[key] === undefined) {
                newVal[key] = val[key];
            }

            if (Array.isArray(val[key])) {
                const arraySerialize: Array<JSONValue> = [];
                for (const arrVal of val[key] as Array<JSONValue>) {
                    arraySerialize.push(this.deserializeValue(arrVal));
                }

                newVal[key] = arraySerialize;
            } else {
                newVal[key] = this.deserializeValue(val[key] as JSONValue);
            }
        }

        return newVal;
    }
}
