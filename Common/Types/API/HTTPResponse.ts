import BaseModel from "../../Models/BaseModel";
import { JSONObjectOrArray } from "../JSON";

export default class HTTPResponse<T extends JSONObjectOrArray | BaseModel | Array<BaseModel>> {
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

    
    private _data! : T;
    public get data() : T {
        return this._data;
    }
    public set data(v : T) {
        this._data = v;
    }
    

    public constructor(statusCode: number, data: JSONObjectOrArray) {
        this.statusCode = statusCode;
        this.jsonData = data; 

        let obj!: T; 

        if (obj instanceof BaseModel) {
            // this.data = BaseModel.fromJSON(data) as T;
            this.data = data as T;
        } else {
            this.data = data as T;
        }
       
    }
}
