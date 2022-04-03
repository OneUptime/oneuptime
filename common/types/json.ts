export type JSONValue = string | number | boolean | JSONObject | JSONArray;

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
