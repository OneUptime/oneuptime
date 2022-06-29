import Protocol from './Protocol';
import Route from './Route';
import Hostname from './Hostname';
import DatabaseProperty from '../Database/DatabaseProperty';
import { FindOperator } from 'typeorm';

export default class URL extends DatabaseProperty {
    private _route: Route = new Route();
    public get route(): Route {
        return this._route;
    }
    public set route(v: Route) {
        this._route = v;
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
        hostname: Hostname | string,
        route?: Route
    ) {
        super();
        if (hostname instanceof Hostname) {
            this.hostname = hostname;
        } else if (typeof hostname === 'string') {
            this.hostname = Hostname.fromString(hostname);
        }

        this.protocol = protocol;

        if (route) {
            this.route = route;
        }
    }

    public isHttps(): boolean {
        return this.protocol === Protocol.HTTPS;
    }

    public override toString(): string {
        let urlString: string = `${this.protocol}${this.hostname}`;
        if (this.route.toString().startsWith('/')) {
            urlString += this.route.toString();
        } else {
            urlString += '/' + this.route.toString();
        }
        return urlString;
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

        const hostname: Hostname = new Hostname(url.split('/')[0] || '');

        let route: Route | undefined = undefined;

        if (url.split('/').length > 1) {
            const paths: Array<string> = url.split('/');
            paths.shift();
            route = new Route(paths.join('/'));
        }

        return new URL(protocol, hostname, route);
    }

    public addRoute(route: Route | string): URL {
        if (typeof route === "string") {
            this.route.addRoute(new Route(route));
        } else {
            this.route.addRoute(route);
        }

        return this;
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
