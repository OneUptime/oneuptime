import { JSONValue } from 'common/types/json';

export default class Action {
    private _type: string = '';
    public get type(): string {
        return this._type;
    }
    public set type(v: string) {
        this._type = v;
    }

    private _paylaod: JSONValue = {};
    public get paylaod(): JSONValue {
        return this._paylaod;
    }
    public set paylaod(v: JSONValue) {
        this._paylaod = v;
    }
}
