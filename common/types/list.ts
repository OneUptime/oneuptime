import { JSONArray, JSONValue } from './json';
import PositiveNumber from './positive-number';

export class ListData {
    constructor(obj: {
        data: JSONArray;
        count: PositiveNumber;
        skip: PositiveNumber;
        limit: PositiveNumber;
    }) {
        this.data = obj.data;
        this.count = obj.count;
        this.skip = obj.skip;
        this.limit = obj.limit;
    }

    public data: JSONArray;
    public count: PositiveNumber;
    public skip: PositiveNumber;
    public limit: PositiveNumber;

    public toJSONValue(): JSONValue {
        const json: JSONValue = {
            data: this.data,
            count: this.count.toNumber(),
            skip: this.skip.toNumber(),
            limit: this.limit.toNumber(),
        };

        return json;
    }
}
