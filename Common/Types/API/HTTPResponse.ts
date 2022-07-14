import BaseModel from '../../Models/BaseModel';
import { JSONArray, JSONObject, JSONObjectOrArray } from '../JSON';

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


    private _count: number = 0;
    public get count(): number {
        return this._count;
    }
    public set count(v: number) {
        this._count = v;
    }


    private _limit: number = 0;
    public get limit(): number {
        return this._limit;
    }
    public set limit(v: number) {
        this._limit = v;
    }


    private _skip: number = 0;
    public get skip(): number {
        return this._skip;
    }
    public set skip(v: number) {
        this._skip = v;
    }

    public constructor(statusCode: number, data: JSONObject | Array<JSONObject>) {
        this.statusCode = statusCode;

        if (
            !Array.isArray(data)
            && Object.keys(data).includes("count")
            && Object.keys(data).includes("skip")
            && Object.keys(data).includes("limit")) {
            // likely a list returned. 
            this.count = data["count"] as number;
            this.skip = data["skip"] as number;
            this.limit = data["limit"] as number;
            this.jsonData = data["data"] as JSONArray;
        } else {
            this.jsonData = data;
        }

        this.data = this.jsonData as T;
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
