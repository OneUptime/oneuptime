import DatabaseProperty from '../Database/DatabaseProperty';
import BadDataException from '../Exception/BadDataException';
import { JSONObject } from '../JSON';
import Typeof from '../Typeof';
import IPType from './IPType';

export default class IP extends DatabaseProperty {
    private _ip: string = '';
    protected type: IPType = IPType.IPv4;
    public get ip(): string {
        return this._ip;
    }
    public set ip(value: string) {
        if (this.type === IPType.IPv4) {
            if (IP.isIPv4(value)) {
                this._ip = value;
                this.type = IPType.IPv4;
            } else {
                throw new BadDataException('IP is not a valid IPv4 address');
            }
        } else if (this.type === IPType.IPv6) {
            if (IP.isIPv6(value)) {
                this._ip = value;
                this.type = IPType.IPv6;
            } else {
                throw new BadDataException('IP is not a valid IPv6 address');
            }
        }
    }

    public constructor(ip: string, type?: IPType) {
        super();

        this.ip = ip;

        if (type) {
            this.type = type;
        }
    }

    public override toString(): string {
        return this.ip;
    }

    private static isIPv4(str: string): boolean {
        const regexExp: RegExp =
            /^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/gi;
        return regexExp.test(str);
    }

    private static isIPv6(str: string): boolean {
        const regexExp: RegExp =
            /(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))/gi;
        return regexExp.test(str);
    }

    public isIPv4(): boolean {
        if (IP.isIPv4(this.ip)) {
            return true;
        }
        return false;
    }

    public isIPv6(): boolean {
        if (IP.isIPv6(this.ip)) {
            return true;
        }
        return false;
    }

    public static fromJSON(json: JSONObject): IP {
        if (json && json['_type'] !== 'IP') {
            throw new BadDataException('Invalid JSON for IP');
        }

        if (json && json['value'] && typeof json['value'] === Typeof.String) {
            throw new BadDataException('Invalid JSON for IP');
        }

        return new IP(json['value'] as string);
    }

    public toJSON(): JSONObject {
        return {
            value: this.toString(),
            _type: 'IP',
        };
    }

    public static override toDatabase(_value: string): string | null {
        if (_value) {
            return _value.toString();
        }
        return null;
    }

    public static override fromDatabase(value: string): IP | null {
        if (value) {
            if (IP.isIPv4(value)) {
                return new IP(value, IPType.IPv4);
            } else if (IP.isIPv6(value)) {
                return new IP(value, IPType.IPv6);
            }
        }
        return null;
    }
}
