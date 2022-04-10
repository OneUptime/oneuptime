import ActionPayload from './action-payload';

export default class Action {
    private _type: string = '';
    public get type(): string {
        return this._type;
    }
    public set type(v: string) {
        this._type = v;
    }

    private _payload: ActionPayload = {};
    public get payload(): ActionPayload {
        return this._payload;
    }
    public set payload(v: ActionPayload) {
        this._payload = v;
    }
}
