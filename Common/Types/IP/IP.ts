import BadDataException from '../Exception/BadDataException';
import { IPType } from '../../Tests/Types/IP/IPType';

export default class IP {
    private _ip: string = '';
    protected type: IPType = IPType.IPv4;
    public get ip(): string {
        return this._ip;
    }
    public set ip(value: string) {
        if (this.type === IPType.IPv4) {
            if (this.isIPv4(value)) {
                this._ip = value;
            } else {
                throw new BadDataException('IP is not a valid IPv4 address');
            }
        } else if (this.type === IPType.IPv6) {
            if (this.isIPv6(value)) {
                this._ip = value;
            } else {
                throw new BadDataException('IP is not a valid IPv6 address');
            }
        }
    }

    public constructor(ip: string, type: IPType) {
        this.type = type;
        this.ip = ip;
    }

    public toString(): string {
        return this.ip;
    }

    public isIPv4(str: string): boolean {
        const regexExp: RegExp =
            /^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/gi;
        return regexExp.test(str);
    }

    public isIPv6(str: string): boolean {
        const regexExp: RegExp =
            /(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))/gi;
        return regexExp.test(str);
    }
}
