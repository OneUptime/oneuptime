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

  private _username: string | null = null;
  public get username(): string | null {
    return this._username;
  }
  public set username(v: string | null) {
    this._username = v;
  }

  private _password: string | null = null;
  public get password(): string | null {
    return this._password;
  }
  public set password(v: string | null) {
    this._password = v;
  }

  public constructor(
    protocol: Protocol,
    hostname: Hostname | string | Email,
    route?: Route,
    queryString?: string,
    username?: string | null,
    password?: string | null,
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

    this.username = username || null;
    this.password = password || null;
  }

  public getUsername(): string | null {
    return this.username;
  }

  public getPassword(): string | null {
    return this.password;
  }

  public override toString(): string {
    let urlString: string = `${this.protocol}`;

    // Add auth if present
    if (this.username) {
      urlString += `${this.username}`;
      if (this.password) {
        urlString += `:${this.password}`;
      }
      urlString += `@`;
    }

    urlString += `${this.hostname || this.email}`;

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
    let username: string | null = null;
    let password: string | null = null;

    if (url.startsWith("https://")) {
      protocol = Protocol.HTTPS;
      url = url.replace("https://", "");
    } else if (url.startsWith("http://")) {
      protocol = Protocol.HTTP;
      url = url.replace("http://", "");
    } else if (url.startsWith("wss://")) {
      protocol = Protocol.WSS;
      url = url.replace("wss://", "");
    } else if (url.startsWith("ws://")) {
      protocol = Protocol.WS;
      url = url.replace("ws://", "");
    } else if (url.startsWith("mongodb://")) {
      protocol = Protocol.MONGO_DB;
      url = url.replace("mongodb://", "");
    } else if (url.startsWith("mailto:")) {
      protocol = Protocol.MAIL;
      url = url.replace("mailto:", "");
    }

    // Parse auth if present (username:password@)
    if (url.includes('@')) {
      const parts = url.split('@');
      if (parts.length > 1 && parts[0] && parts[1]) {
        const authPart = parts[0];
        if (authPart.includes(':')) {
          const authSplit = authPart.split(':');
          if (authSplit.length >= 2 && authSplit[0] && authSplit[1]) {
            username = decodeURIComponent(authSplit[0]);
            password = decodeURIComponent(authSplit[1]);
          }
        } else {
          username = decodeURIComponent(authPart);
        }
        url = parts[1]; // Remove auth part from URL
      }
    }

    const hostname: Hostname = new Hostname(url.split("/")[0] || "");

    let route: Route | undefined;

    if (url.split("/").length > 1) {
      const paths: Array<string> = url.split("/");
      paths.shift();
      route = new Route(paths.join("/").split("?")[0]);
    }

    const queryString: string | undefined = url.split("?")[1] || "";

    return new URL(protocol, hostname, route, queryString, username, password);
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
