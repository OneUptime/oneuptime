export type JSONValue =
    | string
    | number
    | boolean
    | { [x: string]: JSONValue }
    | Array<JSONValue>;

export class JSONObject {
    [x: string]: JSONValue;
}

export interface JSONArray extends Array<JSONObject> {}
