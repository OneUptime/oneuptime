import { JSONArray, JSONValue } from './json';

export class ListData {
    constructor(obj: {
        data: JSONArray;
        count: number;
        skip: number;
        limit: number;
    }) {
        this.data = obj.data;
        this.count = obj.count;
        this.skip = obj.skip;
        this.limit = obj.limit;
    }

    public data: JSONArray;
    public count: number;
    public skip: number;
    public limit: number;

    public toJSONValue(): JSONValue {
        const json: JSONValue = {
            data: this.data,
            count: this.count,
            skip: this.skip,
            limit: this.limit,
        };

        return json;
    }
}
