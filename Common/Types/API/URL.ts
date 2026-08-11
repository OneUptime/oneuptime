import DatabaseProperty from "../Database/DatabaseProperty";
import Dictionary from "../Dictionary";
import Email from "../Email";
import BadDataException from "../Exception/BadDataException";
import { JSONObject, ObjectType } from "../JSON";
import Typeof from "../Typeof";
import Hostname from "./Hostname";
import Protocol from "./Protocol";
import Route from "./Route";
import { FindOperator } from "typeorm";

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
    queryString?: string,
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
      const keyValues: Array<string> = queryString.split("&");
      for (const keyValue of keyValues) {
        if (keyValue.split("=")[0] && keyValue.split("=")[1]) {
          const key: string | undefined = keyValue.split("=")[0];
          const value: string | undefined = keyValue.split("=")[1];
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
    let urlString: string = `${this.protocol}${this.hostname || this.email}`;
    if (!this.email && !urlString.startsWith("mailto:")) {
      if (this.route && this.route.toString().startsWith("/")) {
        if (urlString.endsWith("/")) {
          urlString = urlString.substring(0, urlString.length - 1);
        }
        urlString += this.route.toString();
      } else {
        if (urlString.endsWith("/")) {
          urlString = urlString.substring(0, urlString.length - 1);
        }
        urlString += "/" + this.route.toString();
      }

      if (Object.keys(this.params).length > 0) {
        urlString += "?";

        for (const key of Object.keys(this.params)) {
          urlString += key + "=" + this.params[key] + "&";
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

    /*
     * Schemes are case-insensitive (RFC 3986), so match on a lower-cased
     * copy and strip by length. Matching the literal prefix left "HTTPS://"
     * in place, which then read as an authority of "HTTPS:".
     *
     * Longest-first: "https://" has to be tested before "http://", and only
     * the first match is stripped.
     */
    const schemePrefixes: Array<[string, Protocol]> = [
      ["https://", Protocol.HTTPS],
      ["http://", Protocol.HTTP],
      ["wss://", Protocol.WSS],
      ["ws://", Protocol.WS],
      ["mongodb://", Protocol.MONGO_DB],
      ["mailto:", Protocol.MAIL],
    ];

    const lowerCasedUrl: string = url.toLowerCase();

    for (const [prefix, prefixProtocol] of schemePrefixes) {
      if (lowerCasedUrl.startsWith(prefix)) {
        protocol = prefixProtocol;
        url = url.substring(prefix.length);
        break;
      }
    }

    if (protocol === Protocol.MAIL) {
      /*
       * Hand the bare address to the constructor so it is recognised as an
       * Email. Routing it through Hostname instead would ask a host validator
       * to accept an email address — and "?subject=..." along with it.
       */
      const address: string = url.split("?")[0] || "";
      const mailQueryString: string = url.split("?")[1] || "";

      return new URL(protocol, address, undefined, mailQueryString);
    }

    /*
     * The authority ends at the first "/", "?" or "#". Splitting on "/" alone
     * left the query and fragment glued to the host for URLs with no path
     * ("https://host?token=x" parsed to a host of "host?token=x"), which both
     * round-tripped wrong and handed anything that later interpolated the
     * host a way to smuggle a path.
     */
    const authority: string = (url.split("/")[0] || "").split(/[?#]/)[0] || "";

    const hostname: Hostname = new Hostname(authority);

    let route: Route | undefined;

    if (url.split("/").length > 1) {
      const paths: Array<string> = url.split("/");
      paths.shift();
      route = new Route(paths.join("/").split("?")[0]);
    }

    const queryString: string | undefined = url.split("?")[1] || "";

    return new URL(protocol, hostname, route, queryString);
  }

  public removeQueryString(): URL {
    return URL.fromString(this.toString().split("?")[0] || "");
  }

  public override toJSON(): JSONObject {
    return {
      _type: ObjectType.URL,
      value: (this as URL).toString(),
    };
  }

  public static override fromJSON(json: JSONObject): URL {
    if (json["_type"] === ObjectType.URL) {
      return URL.fromString((json["value"] as string) || "");
    }

    throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
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

  public addQueryParam(
    paramName: string,
    value: string,
    encode?: boolean | undefined,
  ): URL {
    if (encode) {
      value = encodeURIComponent(value);
    }

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
    const paths: Array<string> = this.route.toString().split("/");

    if (paths.length > 0) {
      if (!getFromLastRoute) {
        return new Route("/" + paths[paths.length - 1]);
      }
      return new Route("/" + paths[paths.length - (1 + getFromLastRoute)]);
    }

    return null;
  }

  protected static override toDatabase(
    value: URL | FindOperator<URL>,
  ): string | null {
    if (value) {
      if (typeof value === "string") {
        value = URL.fromString(value);
      }

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
