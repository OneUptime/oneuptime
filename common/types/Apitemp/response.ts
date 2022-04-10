import { JSONObjectOrArray } from '../JSON';

export default class HTTPResponse {
    private _statusCode: number = -1;
    public get statusCode(): number {
        return this._statusCode;
    }
    public set statusCode(v: number) {
        this._statusCode = v;
    }

    private _data: JSONObjectOrArray = {};
    public get data(): JSONObjectOrArray {
        return this._data;
    }
    public set data(v: JSONObjectOrArray) {
        this._data = v;
    }

    constructor(statusCode: number, data: JSONObjectOrArray) {
        this.statusCode = statusCode;
        this.data = data;
    }
}
