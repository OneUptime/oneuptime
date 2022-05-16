import BadDataException from '../Exception/BadDataException';
import NotImplementedException from '../Exception/NotImplementedException';

enum IPType {
    IPv4 = 'IPv4',
    IPv6 = 'IPv6',
}

export default class IP {
    private _ip: string = '';
    protected type: IPType = IPType.IPv4;
    public get ip(): string {
        return this._ip;
    }
    public set ip(v: string) {
        if (this.type === IPType.IPv4) {
            if (IP.isValidIpv4(v)) {
                this._ip = v;
            } else {
                throw new BadDataException('Invalid IPv4 address');
            }
        } else if (this.type === IPType.IPv6) {
            if (IP.isValidIpv6(v)) {
                this._ip = v;
            } else {
                throw new BadDataException('Invalid IPv6 address');
            }
        }
    }

    public constructor(ip: string, type: IPType) {
        this.type = type;
        this.ip = ip;
    }

    protected static isValidIpv4: Function = (str: string): boolean => {
        const regexExp: RegExp =
            /^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/gi;
        return regexExp.test(str);
    };

    protected static isValidIpv6: Function = (str: string): boolean => {
        const regexExp: RegExp =
            /(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))/gi;
        return regexExp.test(str);
    };

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
