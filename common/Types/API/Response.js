"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class HTTPResponse {
    constructor(statusCode, data) {
        this._statusCode = -1;
        this._data = {};
        this.statusCode = statusCode;
        this.data = data;
    }
    get statusCode() {
        return this._statusCode;
    }
    set statusCode(v) {
        this._statusCode = v;
    }
    get data() {
        return this._data;
    }
    set data(v) {
        this._data = v;
    }
}
exports.default = HTTPResponse;
