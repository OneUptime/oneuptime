export default class Hostname {
    private _route: string = '';
    public get hostname(): string {
        return this._route;
    }
    public set hostname(v: string) {
        this._route = v;
    }

    public constructor(hostname: string) {
        if (hostname) {
            this.hostname = hostname;
        }
    }

    public toString(): string {
        return this.hostname;
    }
}
