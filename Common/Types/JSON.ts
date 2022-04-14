import ObjectID from './ObjectID';

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
    | null;

export interface JSONObject {
    [x: string]: JSONValue;
}

export interface JSONArray extends Array<JSONObject> {}

export class JSONFunctions {
    toCompressedString(val: JSONValue): string {
        return JSON.stringify(val, null, 2);
    }

    toString(val: JSONValue): string {
        return JSON.stringify(val);
    }
}

export type JSONObjectOrArray = JSONObject | JSONArray;
