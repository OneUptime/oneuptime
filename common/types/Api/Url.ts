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

    constructor(protocol: Protocol, hostname: Hostname, route?: Route) {
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
}
