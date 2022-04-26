import NotImplementedException from '../Exception/NotImplementedException';

export default class IP {
    private _ip: string = '';
    public get ip(): string {
        return this._ip;
    }
    public set ip(v: string) {
        this._ip = v;
    }

    public constructor(ip: string) {
        this.ip = ip;
    }

    public toString(): string {
        return this.ip;
    }

    public isIPv4(): boolean {
        throw new NotImplementedException();
    }

    public isIPv6(): boolean {
        throw new NotImplementedException();
    }
}
