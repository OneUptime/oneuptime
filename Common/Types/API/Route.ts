import BadDataException from '../Exception/BadDataException';
export default class Route {
    private _route: string = '';
    public get route(): string {
        return this._route;
    }
    public set route(v: string) {
        const matchRouteCharacters: RegExp =
            /^[a-zA-Z\d\-!#$&'()*+,./:;=?@[\]]*$/;
        if (v && !matchRouteCharacters.test(v)) {
            throw new BadDataException(`Invalid route: ${v}`);
        }
        this._route = v;
    }

    public constructor(route?: string) {
        if (route) {
            this.route = route;
        }
    }

    public addRoute(route: Route): Route {
        let routeToBeAdded: string = route.toString();
        if (this.route.endsWith('/') && routeToBeAdded.trim().startsWith('/')) {
            routeToBeAdded = routeToBeAdded.trim().substring(1); // remove leading  "/" from route
        }
        this.route = new Route(this.route + routeToBeAdded).route;
        return this;
    }

    public toString(): string {
        return this.route;
    }

    public static fromString(route: string): Route {
        return new Route(route);
    }
}
