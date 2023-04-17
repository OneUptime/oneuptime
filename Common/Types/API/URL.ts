import Protocol from './Protocol';
import Route from './Route';
import Hostname from './Hostname';
import DatabaseProperty from '../Database/DatabaseProperty';
import { FindOperator } from 'typeorm';
import Dictionary from '../Dictionary';
import Typeof from '../Typeof';
import Email from '../Email';
import { JSONObject } from '../JSON';
import BadDataException from '../Exception/BadDataException';

export default class URL extends DatabaseProperty {
    private _route: Route = new Route();
    public get route(): Route {
        return this._route;
    }
    public set route(v: Route) {
        this._route = v;
    }

    private _params: Dictionary<string> = {};
    public get params(): Dictionary<string> {
        return this._params;
    }
    public set params(v: Dictionary<string>) {
        this._params = v;
    }

    private _email!: Email;
    public get email(): Email {
        return this._email;
    }
    public set email(v: Email) {
        this._email = v;
    }

    private _hostname!: Hostname;
    public get hostname(): Hostname {
        return this._hostname;
    }
    public set hostname(v: Hostname) {
        this._hostname = v;
    }

    private _protocol: Protocol = Protocol.HTTPS;
    public get protocol(): Protocol {
        return this._protocol;
    }
    public set protocol(v: Protocol) {
        this._protocol = v;
    }

    public constructor(
        protocol: Protocol,
        hostname: Hostname | string | Email,
        route?: Route,
        queryString?: string
    ) {
        super();

        if (
            typeof hostname === Typeof.String &&
            Email.isValid(hostname as string)
        ) {
            this.email = new Email(hostname as string);
        } else if (hostname instanceof Email) {
            this.email = hostname;
        } else if (hostname instanceof Hostname) {
            this.hostname = hostname;
        } else if (typeof hostname === Typeof.String) {
            this.hostname = Hostname.fromString(hostname);
        }

        this.protocol = protocol;

        if (route) {
            this.route = route;
        }

        if (queryString) {
            const keyValues: Array<string> = queryString.split('&');
            for (const keyValue of keyValues) {
                if (keyValue.split('=')[0] && keyValue.split('=')[1]) {
                    const key: string | undefined = keyValue.split('=')[0];
                    const value: string | undefined = keyValue.split('=')[1];
                    if (key && value) {
                        this._params[key] = value;
                    }
                }
            }
        }
    }

    public isHttps(): boolean {
        return this.protocol === Protocol.HTTPS;
    }

    public override toString(): string {
        let urlString: string = `${this.protocol}${
            this.hostname || this.email
        }`;
        if (!this.email) {
            if (this.route && this.route.toString().startsWith('/')) {
                if (urlString.endsWith('/')) {
                    urlString = urlString.substring(0, urlString.length - 1);
                }
                urlString += this.route.toString();
            } else {
                if (urlString.endsWith('/')) {
                    urlString = urlString.substring(0, urlString.length - 1);
                }
                urlString += '/' + this.route.toString();
            }

            if (Object.keys(this.params).length > 0) {
                urlString += '?';

                for (const key of Object.keys(this.params)) {
                    urlString += key + '=' + this.params[key] + '&';
                }

                urlString = urlString.substring(0, urlString.length - 1); // remove last &
            }
        }

        return urlString;
    }

    public static fromURL(url: URL): URL {
        return URL.fromString(url.toString());
    }

    public static fromString(url: string): URL {
        let protocol: Protocol = Protocol.HTTPS;

        if (url.startsWith('https://')) {
            protocol = Protocol.HTTPS;
            url = url.replace('https://', '');
        }

        if (url.startsWith('http://')) {
            protocol = Protocol.HTTP;
            url = url.replace('http://', '');
        }

        if (url.startsWith('wss://')) {
            protocol = Protocol.WSS;
            url = url.replace('wss://', '');
        }

        if (url.startsWith('ws://')) {
            protocol = Protocol.WS;
            url = url.replace('ws://', '');
        }

        if (url.startsWith('mongodb://')) {
            protocol = Protocol.MONGO_DB;
            url = url.replace('mongodb://', '');
        }

        if (url.startsWith('mailto:')) {
            protocol = Protocol.MAIL;
            url = url.replace('mailto:', '');
        }

        const hostname: Hostname = new Hostname(url.split('/')[0] || '');

        let route: Route | undefined;

        if (url.split('/').length > 1) {
            const paths: Array<string> = url.split('/');
            paths.shift();
            route = new Route(paths.join('/').split('?')[0]);
        }

        const queryString: string | undefined = url.split('?')[1] || '';

        return new URL(protocol, hostname, route, queryString);
    }

    public removeQueryString(): URL {
        return URL.fromString(this.toString().split('?')[0] || '');
    }

    public toJSON(): JSONObject {
        return {
            value: this.toString(),
            _type: 'URL',
        };
    }

    public static fromJSON(json: JSONObject): URL {
        if (json && json['_type'] !== 'URL') {
            throw new BadDataException('Invalid JSON for URL');
        }

        if (json && json['value'] && typeof json['value'] === Typeof.String) {
            return URL.fromString(json['value'] as string);
        }

        throw new BadDataException('Invalid JSON for URL');
    }

    public addRoute(route: Route | string): URL {
        if (typeof route === Typeof.String) {
            this.route.addRoute(new Route(route.toString()));
        }

        if (route instanceof Route) {
            this.route.addRoute(route);
        }

        return this;
    }

    public addQueryParam(paramName: string, value: string): URL {
        this.params[paramName] = value;
        return this;
    }

    public getQueryParam(paramName: string): string | null {
        return this.params[paramName] || null;
    }

    public addQueryParams(params: Dictionary<string>): URL {
        this.params = {
            ...this.params,
            ...params,
        };
        return this;
    }

    public getLastRoute(getFromLastRoute?: number): Route | null {
        const paths: Array<string> = this.route.toString().split('/');

        if (paths.length > 0) {
            if (!getFromLastRoute) {
                return new Route('/' + paths[paths.length - 1]);
            }
            return new Route(
                '/' + paths[paths.length - (1 + getFromLastRoute)]
            );
        }

        return null;
    }

    protected static override toDatabase(
        value: URL | FindOperator<URL>
    ): string | null {
        if (value) {
            return value.toString();
        }

        return null;
    }

    protected static override fromDatabase(_value: string): URL | null {
        if (_value) {
            return URL.fromString(_value);
        }

        return null;
    }
}
