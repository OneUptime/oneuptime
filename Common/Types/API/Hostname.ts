import BadDataException from '../Exception/BadDataException';
import Port from '../Port';

export default class Hostname {
    private _route = '';
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
        const matchHostnameCharacters = /^[a-zA-Z-\d!#$&'*+,/:;=?@[\].]*$/;
        if (v && !matchHostnameCharacters.test(v)) {
            throw new BadDataException(`Invalid hostname: ${v}`);
        }
        this._route = v;
    }

    public constructor(hostname: string, port?: Port | string | number) {
        if (hostname) {
            this.hostname = hostname;
        }

        if (port instanceof Port) {
            this.port = port;
        } else if (typeof port === 'string') {
            this.port = new Port(port);
        } else if (typeof port === 'number') {
            this.port = new Port(port);
        }
    }

    public toString(): string {
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
}
