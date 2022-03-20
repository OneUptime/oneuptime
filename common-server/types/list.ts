import { JSONArray, JSONValue } from './json';

export class ListData {
    constructor(data: JSONArray, count: number, skip: number, limit: number) {
        this.data = data;
        this.count = count;
        this.skip = skip;
        this.limit = limit;
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
        }

        return json;
    }
}
