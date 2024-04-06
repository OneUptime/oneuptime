import Typeof from './Typeof';
import DatabaseProperty from './Database/DatabaseProperty';
import OneUptimeDate from './Date';
import BaseModel from '../Models/BaseModel';
import { JSONArray, JSONObject, JSONValue, ObjectType } from './JSON';
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

    public static removeCircularReferences(obj: JSONObject): JSONObject {
        const cache: any[] = [];
        const returnValue: string = JSON.stringify(
            obj,
            (_key: string, value: any) => {
                if (typeof value === 'object' && value !== null) {
                    if (cache.includes(value)) {
                        return;
                    }

                    cache.push(value);
                }

                return value;
            }
        );

        return JSON.parse(returnValue);
    }

    public static isEqualObject(
        obj1: JSONObject | undefined,
        obj2: JSONObject | undefined
    ): boolean {
        // check if all the keys are the same

        if (!obj1 && !obj2) {
            return true;
        }

        if (!obj1 || !obj2) {
            return false;
        }

        const keys1: Array<string> = Object.keys(obj1);
        const keys2: Array<string> = Object.keys(obj2);

        if (keys1.length !== keys2.length) {
            return false;
        }

        for (const key of keys1) {
            if (!keys2.includes(key)) {
                return false;
            }
        }

        // check if all the values are the same

        for (const key of keys1) {
            if (obj1[key] !== obj2[key]) {
                return false;
            }
        }

        return true;
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

    // this function serializes JSON with Common Objects to JSON that can be stringified.
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
            return BaseModel.toJSON(val, BaseModel);
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
        } else if (Array.isArray(val)) {
            const arr: Array<JSONValue> = [];

            for (const v of val) {
                arr.push(this.deserializeValue(v));
            }

            return arr;
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

    public static parse(val: string): JSONObject | JSONArray {
        return JSON5.parse(val);
    }

    public static parseJSONObject(val: string): JSONObject {
        const result: JSONObject | JSONArray = this.parse(val);

        if (Array.isArray(result)) {
            throw new Error('Expected JSONObject, but got JSONArray');
        }

        return result;
    }

    public static parseJSONArray(val: string): JSONArray {
        const result: JSONObject | JSONArray = this.parse(val);

        if (!Array.isArray(result)) {
            throw new Error('Expected JSONArray, but got JSONObject');
        }

        return result;
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

    public static anyObjectToJSONObject(val: any): JSONObject {
        return JSON.parse(JSON.stringify(val));
    }

    public static flattenObject(val: JSONObject): JSONObject {
        const returnObj: JSONObject = {};

        type FlattenFunction = (obj: JSONObject, prefix: string) => void;

        const flatten: FlattenFunction = (
            obj: JSONObject,
            prefix: string
        ): void => {
            for (const key in obj) {
                if (typeof obj[key] === Typeof.Object) {
                    flatten(obj[key] as JSONObject, `${prefix}${key}.`);
                } else {
                    returnObj[`${prefix}${key}`] = obj[key];
                }
            }
        };

        flatten(val, '');

        return returnObj;
    }
}
