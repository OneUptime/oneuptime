"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class ListData {
    constructor(obj) {
        this.data = obj.data;
        this.count = obj.count;
        this.skip = obj.skip;
        this.limit = obj.limit;
    }
    toJSON() {
        const json = {
            data: this.data,
            count: this.count.toNumber(),
            skip: this.skip.toNumber(),
            limit: this.limit.toNumber(),
        };
        return json;
    }
}
exports.default = ListData;
