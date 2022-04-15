import Protocol from './Protocol';
import Route from './Route';
import Hostname from './Hostname';

export default class URL {
    private _route: Route = new Route();
    public get route(): Route {
        return this._route;
    }
    public set route(v: Route) {
        this._route = v;
    }

    private _hostname: Hostname = new Hostname('localhost');
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

    public constructor(protocol: Protocol, hostname: Hostname, route?: Route) {
        this.hostname = hostname;

        this.protocol = protocol;

        if (route) {
            this.route = route;
        }
    }

    isHttps(): boolean {
        return this.protocol === Protocol.HTTPS;
    }

    toString(): string {
        return `${this.protocol}${this.hostname}${this.route}`;
    }

    static fromString(url: string): URL {
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

        let route: Route;

        if (url.split('/').length > 1) {
            const paths: Array<string> = url.split('/');
            paths.shift();
            route = new Route(paths.join('/'));
        }

        return new URL(protocol, hostname, route);
    }
}
