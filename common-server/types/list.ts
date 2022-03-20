import { JSONArray, JSONValue } from './json';

export class ListData {
    constructor(data: JSONArray, count: Number, skip: Number, limit: Number) {
        this.data = data;
        this.count = count;
        this.skip = skip;
        this.limit = limit;
    }

    public data: JSONArray;
    public count: Number;
    public skip: Number;
    public limit: Number;

    toJSONValue(): JSONValue {}
}
