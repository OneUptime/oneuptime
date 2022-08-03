import { FindOperator } from 'typeorm';
import DatabaseProperty from '../Database/DatabaseProperty';
import BadDataException from '../Exception/BadDataException';
import Port from '../Port';
import Typeof from '../Typeof';

export default class Hostname extends DatabaseProperty {
    private _route: string = '';
    public get hostname(): string {
        return this._route;
    }

    private _port!: Port;
    public get port(): Port {
        return this._port;
    }
    public set port(v: Port) {
        this._port = v;
    }

    public set hostname(v: string) {
        const matchHostnameCharacters: RegExp =
            /^[a-zA-Z-\d!#$&'*+,/:;=?@[\].]*$/;
        if (v && !matchHostnameCharacters.test(v)) {
            throw new BadDataException(`Invalid hostname: ${v}`);
        }
        this._route = v;
    }

    public constructor(hostname: string, port?: Port | string | number) {
        super();
        if (hostname) {
            this.hostname = hostname;
        }

        if (port instanceof Port) {
            this.port = port;
        } else if (typeof port === Typeof.String) {
            this.port = new Port(port as string);
        } else if (typeof port === Typeof.Number) {
            this.port = new Port(port as number);
        }
    }

    public override toString(): string {
        let hostame: string = this.hostname;

        if (this.port) {
            hostame += ':' + this.port.toString();
        }

        return hostame;
    }

    public static fromString(hostname: string): Hostname {
        if (hostname.includes(':')) {
            return new Hostname(
                hostname.split(':')[0] as string,
                hostname.split(':')[1]
            );
        }
        return new Hostname(hostname);
    }

    public static override toDatabase(
        value: Hostname | FindOperator<Hostname>
    ): string | null {
        if (value) {
            return value.toString();
        }

        return value;
    }

    public static override fromDatabase(_value: string): Hostname | null {
        if (_value) {
            return new Hostname(_value);
        }

        return null;
    }
}
