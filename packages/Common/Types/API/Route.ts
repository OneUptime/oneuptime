import DatabaseProperty from "../Database/DatabaseProperty";
import Dictionary from "../Dictionary";
import BadDataException from "../Exception/BadDataException";
import { JSONObject, ObjectType } from "../JSON";
import { FindOperator } from "typeorm";
import { refusedValue } from "../../Utils/RefusedValue";

export default class Route extends DatabaseProperty {
  private static readonly SCHEME_PREFIX: RegExp = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

  /*
   * True when the value, read on its own as a relative reference, would start
   * with a scheme (RFC 3986 4.2): "javascript:alert(1)", but equally
   * "bot123:ABC/sendMessage". Route refuses such values so a scheme can never
   * reach a navigation sink; URL uses this to know when a path it parsed has
   * to keep its leading "/".
   */
  public static hasSchemePrefix(route: string): boolean {
    return Route.SCHEME_PREFIX.test(route);
  }

  private static validateRoute(route: string): void {
    if (Route.hasSchemePrefix(route)) {
      throw new BadDataException(`Invalid route: ${refusedValue(route)}`);
    }

    /*
     * RFC 3986 path characters: unreserved (which includes "~"), sub-delims,
     * ":" and "@", plus "/", "?", "#", "[", "]" and "%" for the rest of a
     * path-and-query. "~" was missing, so "https://example.com/~user" could
     * not be parsed at all.
     */
    const matchRouteCharacters: RegExp =
      /^[a-zA-Z_\d\-!#$%&'()*+,./:;=?@[\]~]*$/;

    if (route && !matchRouteCharacters.test(route)) {
      throw new BadDataException(`Invalid route: ${refusedValue(route)}`);
    }
  }

  private _route: string = "";
  public get route(): string {
    return this._route;
  }
  public set route(v: string) {
    Route.validateRoute(v);
    this._route = v;
  }

  public constructor(route?: string | Route) {
    super();
    if (route && route instanceof Route) {
      route = route.toString();
    }

    if (route) {
      Route.validateRoute(route);
    }

    route = route?.replace(/\/+/g, "/"); // remove multiple slashes from route and replace with single slash

    if (route) {
      this.route = route;
    }
  }

  public override toJSON(): JSONObject {
    return {
      _type: ObjectType.Route,
      value: (this as Route).toString(),
    };
  }

  public static override fromJSON(json: JSONObject): Route {
    if (json["_type"] === ObjectType.Route) {
      return new Route((json["value"] as string) || "");
    }

    throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
  }

  public addRoute(route: Route | string): Route {
    route = route.toString();

    if (!route.startsWith("/")) {
      route = "/" + route;
    }

    if (typeof route === "string") {
      route = new Route(route);
    }

    let routeToBeAdded: string = route.toString();
    if (this.route.endsWith("/") && routeToBeAdded.trim().startsWith("/")) {
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
    value: Route | FindOperator<Route>,
  ): string | null {
    if (value) {
      if (typeof value === "string") {
        value = new Route(value);
      }

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

  /*
   * The route with these parameters after its query: "?" before them when
   * it has none, "&" when it has some already - joined straight on, a route
   * that had a query ran its last value into the first new key
   * ("?x=1y=2") - and the route as it was when there are none, where its
   * last character used to be cut off.
   */
  public addQueryParams(queryParams: Dictionary<string>): Route {
    const pairs: Array<string> = Object.keys(queryParams).map(
      (key: string): string => {
        return `${key}=${queryParams[key]}`;
      },
    );

    if (pairs.length === 0) {
      return this;
    }

    let separator: string = "&";

    if (!this.route.includes("?")) {
      separator = "?";
    } else if (this.route.endsWith("?") || this.route.endsWith("&")) {
      separator = "";
    }

    this.route += `${separator}${pairs.join("&")}`;

    return this;
  }
}
