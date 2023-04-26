import { FindOperator } from 'typeorm';
import DatabaseProperty from '../Database/DatabaseProperty';
import BadDataException from '../Exception/BadDataException';
import { JSONObject, ObjectType } from '../JSON';

export default class Route extends DatabaseProperty {
    private _route: string = '';
    public get route(): string {
        return this._route;
    }
    public set route(v: string) {
        const matchRouteCharacters: RegExp =
            /^[a-zA-Z_\d\-!#$&'()*+,./:;=?@[\]]*$/;
        if (v && !matchRouteCharacters.test(v)) {
            throw new BadDataException(`Invalid route: ${v}`);
        }
        this._route = v;
    }

    public constructor(route?: string | Route) {
        super();
        if (route && route instanceof Route) {
            route = route.toString();
        }

        if (route) {
            this.route = route;
        }
    }

    public override toJSON(): JSONObject {
        return {
            _type: ObjectType.Route,
            value: (this as Route).toString(),
        }
    }

    public static override fromJSON(json: JSONObject): Route {
        if(json['_type'] === ObjectType.Route){
            return new Route(json['value'] as string || '');
        }

        throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
    }

    public addRoute(route: Route | string): Route {
        if (typeof route === 'string') {
            route = new Route(route);
        }

        let routeToBeAdded: string = route.toString();
        if (this.route.endsWith('/') && routeToBeAdded.trim().startsWith('/')) {
            routeToBeAdded = routeToBeAdded.trim().substring(1); // remove leading  "/" from route
        }
        this.route = new Route(this.route + routeToBeAdded).route;
        return this;
    }

    public override toString(): string {
        return this.route;
    }

    public static fromString(route: string): Route {
        return new Route(route);
    }

    public addRouteParam(paramName: string, value: string): Route {
        this.route = this.route.replace(paramName, value);
        return this;
    }

    public static override toDatabase(
        value: Route | FindOperator<Route>
    ): string | null {
        if (value) {
            return value.toString();
        }

        return value;
    }

    public static override fromDatabase(_value: string): Route | null {
        if (_value) {
            return new Route(_value);
        }

        return null;
    }
}
