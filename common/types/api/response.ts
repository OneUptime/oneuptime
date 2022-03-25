import { JSONValue } from '../json';

export default class HTTPRepsonse {
    private _statusCode: number = -1;
    public get statusCode(): number {
        return this._statusCode;
    }
    public set statusCode(v: number) {
        this._statusCode = v;
    }

    private _data: JSONValue = {};
    public get data(): JSONValue {
        return this._data;
    }
    public set data(v: JSONValue) {
        this._data = v;
    }

    constructor(statusCode: number, data: JSONValue) {
        this.statusCode = statusCode;
        this.data = data;
    }
}
