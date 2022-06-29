import BaseModel from '../../Models/BaseModel';
import { JSONObjectOrArray } from '../JSON';

export default class HTTPResponse<
    T extends JSONObjectOrArray | BaseModel | Array<BaseModel>
> {
    private _statusCode: number = -1;
    public get statusCode(): number {
        return this._statusCode;
    }
    public set statusCode(v: number) {
        this._statusCode = v;
    }

    private _jsonData!: JSONObjectOrArray;
    public get jsonData(): JSONObjectOrArray {
        return this._jsonData;
    }
    public set jsonData(v: JSONObjectOrArray) {
        this._jsonData = v;
    }

    private _data!: T;
    public get data(): T {
        return this._data;
    }
    public set data(v: T) {
        this._data = v;
    }

    public constructor(statusCode: number, data: JSONObjectOrArray) {
        this.statusCode = statusCode;
        this.jsonData = data;
        this.data = data as T;
    }

    public isSuccess(): boolean {
        return this.statusCode === 200;
    }

    public isFailure(): boolean {
        return this.statusCode !== 200;
    }

    public isNotAuthorized(): boolean {
        return this.statusCode === 401;
    }

    public isTooManyRequests(): boolean {
        return this.statusCode === 429;
    }

    public isPaymentDeclined(): boolean {
        return this.statusCode === 402;
    }

    public isServerError(): boolean {
        return this.statusCode === 500;
    }
}
