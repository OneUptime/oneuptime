import ObjectID from './ObjectID';
import Version from './Version';

export type JSONValue =
    | Array<string>
    | string
    | Array<number>
    | number
    | Array<boolean>
    | boolean
    | JSONObject
    | JSONArray
    | Date
    | Array<Date>
    | ObjectID
    | Array<ObjectID>
    | Version
    | Buffer
    | null;

export interface JSONObject {
    [x: string]: JSONValue;
}

export type JSONArray = Array<JSONObject>;

export class JSONFunctions {
    public static toCompressedString(val: JSONValue): string {
        return JSON.stringify(val, null, 2);
    }

    public static toString(val: JSONValue): string {
        return JSON.stringify(val);
    }

    public static toJSON(val: JSONObject | JSONArray): Object {
        return JSON.parse(JSON.stringify(val));
    }
}

export type JSONObjectOrArray = JSONObject | JSONArray;
