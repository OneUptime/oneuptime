import { JSONValue } from 'common/types/json';

export default class Action {
    private _type: string = '';
    public get type(): string {
        return this._type;
    }
    public set type(v: string) {
        this._type = v;
    }

    private _payload: JSONValue = {};
    public get payload(): JSONValue {
        return this._payload;
    }
    public set payload(v: JSONValue) {
        this._payload = v;
    }
}
