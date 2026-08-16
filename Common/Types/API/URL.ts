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

/*
 * Schemes whose remainder is NOT an authority: there is no host, no port and
 * no path to parse, so the value is carried verbatim instead of being routed
 * through Hostname. "mailto:" is handled separately because its payload is an
 * Email, which already has its own type.
 */
const OPAQUE_PROTOCOLS: Array<Protocol> = [Protocol.TEL, Protocol.SMS];

/*
 * A tel/sms subscriber per RFC 3966: an optional "+" for a global number, then
 * digits and the visual separators the RFC permits ("-", ".", "(", ")"). At
 * least one digit is required, but it need not come first — "(313)636-1710"
 * opens on a separator and is a number people really write.
 *
 * Deliberately narrow beyond that: the point is to reject anything that could
 * smuggle a path, query, fragment or authority ("/", "?", "#", "@",
 * whitespace) into a value that later gets interpolated into an href.
 */
const TEL_SUBSCRIBER_REGEX: RegExp = /^\+?[0-9\-.()]*[0-9][0-9\-.()]*$/;

/*
 * ";key=value" parameters, e.g. ";phone-context=+1". Values are restricted to
 * RFC 3986 unreserved characters plus the few sub-delims real numbers use.
 */
const TEL_PARAM_REGEX: RegExp =
  /^[A-Za-z0-9\-._~%]+(?:=[A-Za-z0-9\-._~%+:]*)?$/;

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

  /*
   * The payload of an opaque scheme — the phone number of a tel:/sms: URL.
   * Empty for every other scheme.
   */
  private _opaqueValue: string = "";
  public get opaqueValue(): string {
    return this._opaqueValue;
  }
  public set opaqueValue(v: string) {
    const value: string = v.trim();

    if (!URL.isValidOpaqueValue(value)) {
      throw new BadDataException(
        "Phone number " + v + " is not in valid format.",
      );
    }

    this._opaqueValue = value;
  }

  /*
   * Set only by the lenient read paths (fromDatabase / fromJSON) when a stored
   * value cannot be parsed. Such a URL keeps the raw string so it still
   * round-trips and still renders, but exposes no hostname and is refused by
   * toDatabase so the bad value can never be written back or newly created.
   */
  private _isMalformed: boolean = false;
  public isMalformed(): boolean {
    return this._isMalformed;
  }

  private _rawValue: string = "";

  public static isOpaqueProtocol(protocol: Protocol): boolean {
    return OPAQUE_PROTOCOLS.includes(protocol);
  }

  /*
   * A tel:/sms: payload: one or more comma-separated numbers (sms: allows
   * several recipients) followed by optional ";key=value" parameters.
   */
  public static isValidOpaqueValue(value: string): boolean {
    const trimmed: string = value.trim();

    if (!trimmed || trimmed.length > 256) {
      return false;
    }

    const [subscribers, ...params] = trimmed.split(";");

    if (!subscribers) {
      return false;
    }

    const numbers: Array<string> = subscribers.split(",");

    const everyNumberIsValid: boolean = numbers.every((number: string) => {
      return TEL_SUBSCRIBER_REGEX.test(number);
    });

    if (!everyNumberIsValid) {
      return false;
    }

    return params.every((param: string) => {
      return TEL_PARAM_REGEX.test(param);
    });
  }

  public constructor(
    protocol: Protocol,
    hostname: Hostname | string | Email,
    route?: Route,
    queryString?: string,
  ) {
    super();

    /*
     * Opaque schemes first: their payload is a phone number, and asking
     * Hostname to validate one would either reject it or — as it did before
     * tel: was a known scheme — read "tel:1234567890" as host + port.
     */
    if (URL.isOpaqueProtocol(protocol)) {
      this.protocol = protocol;
      this.opaqueValue =
        hostname instanceof Hostname || hostname instanceof Email
          ? hostname.toString()
          : (hostname as string);
      this.setParamsFromQueryString(queryString);
      return;
    }

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

    this.setParamsFromQueryString(queryString);
  }

  private setParamsFromQueryString(queryString?: string): void {
    if (!queryString) {
      return;
    }

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

  public isHttps(): boolean {
    return this.protocol === Protocol.HTTPS;
  }

  private queryStringSuffix(): string {
    if (Object.keys(this.params).length === 0) {
      return "";
    }

    return (
      "?" +
      Object.keys(this.params)
        .map((key: string) => {
          return key + "=" + this.params[key];
        })
        .join("&")
    );
  }

  public override toString(): string {
    /*
     * A value that failed to parse on read is echoed back exactly as stored,
     * so a legacy row still renders as the link it always was.
     */
    if (this.isMalformed()) {
      return this._rawValue;
    }

    if (URL.isOpaqueProtocol(this.protocol)) {
      return `${this.protocol}${this.opaqueValue}${this.queryStringSuffix()}`;
    }

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

      urlString += this.queryStringSuffix();
    }

    return urlString;
  }

  public static fromURL(url: URL): URL {
    return URL.fromString(url.toString());
  }

  /*
   * An unrecognised scheme used to be swallowed: the prefix loop simply did
   * not match, the protocol stayed at its https default, and the rest was read
   * as an authority. "tel:3136361710" was stored as "https://tel:3136361710/"
   * that way — a value nobody typed, with a host of "tel", which a later,
   * stricter Hostname then refused to read back.
   *
   * Anything that clearly announces a scheme this type cannot represent is now
   * refused with a message that says so, rather than silently rewritten:
   *
   *  - "scheme://..." for any scheme not in the supported list, and
   *  - the schemes that are dangerous in an href even without "//".
   *
   * A scheme-less "example.com:8080/hook" is deliberately still allowed: its
   * "example.com:" looks like a scheme to a regex but is a host and port, and
   * callers really do pass it.
   */
  private static rejectUnsupportedScheme(url: string): void {
    const schemeMatch: RegExpMatchArray | null = url
      .trim()
      .match(/^([a-zA-Z][a-zA-Z0-9+.-]*):(\/\/)?/);

    if (!schemeMatch || !schemeMatch[1]) {
      return;
    }

    const scheme: string = schemeMatch[1].toLowerCase();
    const hasAuthorityMarker: boolean = Boolean(schemeMatch[2]);

    const isDangerousInAnHref: boolean = [
      "javascript",
      "data",
      "vbscript",
      "file",
      "blob",
    ].includes(scheme);

    if (hasAuthorityMarker || isDangerousInAnHref) {
      throw new BadDataException(
        "URL scheme " + scheme + ": is not supported.",
      );
    }
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
      ["tel:", Protocol.TEL],
      ["sms:", Protocol.SMS],
    ];

    const lowerCasedUrl: string = url.toLowerCase();

    let matchedKnownScheme: boolean = false;

    for (const [prefix, prefixProtocol] of schemePrefixes) {
      if (lowerCasedUrl.startsWith(prefix)) {
        protocol = prefixProtocol;
        url = url.substring(prefix.length);
        matchedKnownScheme = true;
        break;
      }
    }

    if (!matchedKnownScheme) {
      URL.rejectUnsupportedScheme(url);
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

    if (URL.isOpaqueProtocol(protocol)) {
      /*
       * "sms:+15555550123?body=hi" — the number is everything before the
       * query. There is no authority and no path, so nothing here may reach
       * Hostname.
       */
      const number: string = url.split("?")[0] || "";
      const opaqueQueryString: string = url.split("?")[1] || "";

      return new URL(protocol, number, undefined, opaqueQueryString);
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

  /*
   * Parses like fromString, but never throws: a value it cannot understand
   * comes back as a malformed URL that preserves the original string.
   *
   * This exists for READ paths only. A single unparseable row must not be able
   * to fail the request that reads it — a status page footer link of
   * "https://tel:1234567890/", stored years earlier by a looser validator,
   * used to 400 the whole status page config endpoint and left the page stuck
   * on "Loading...". Writes stay strict: see toDatabase.
   *
   * A malformed URL exposes NO hostname, so nothing can read a host off it and
   * build a request. The outbound-request guards (SSRFProtection) re-parse the
   * raw string with the WHATWG parser and never trusted this type's parse
   * anyway, so leniency here does not widen them.
   */
  public static fromStringLenient(url: string): URL {
    try {
      return URL.fromString(url);
    } catch {
      return URL.createMalformed(url);
    }
  }

  private static createMalformed(rawValue: string): URL {
    /*
     * Built through the opaque branch so the constructor never asks Hostname
     * to validate the very value that just failed to parse; the placeholder is
     * then cleared, leaving a URL with no hostname and no opaque value. The
     * protocol reports the same https default fromString falls back to for an
     * unrecognised scheme.
     */
    const url: URL = new URL(Protocol.TEL, "0");
    url._protocol = Protocol.HTTPS;
    url._opaqueValue = "";
    url._isMalformed = true;
    url._rawValue = rawValue;
    return url;
  }

  public removeQueryString(): URL {
    if (this.isMalformed()) {
      return this;
    }

    return URL.fromString(this.toString().split("?")[0] || "");
  }

  public override toJSON(): JSONObject {
    return {
      _type: ObjectType.URL,
      value: (this as URL).toString(),
    };
  }

  /*
   * Lenient for the same reason fromDatabase is: this is how a URL crosses the
   * wire into the browser. If it threw, moving the server-side failure out of
   * the API would only move the crash into the client that renders the link.
   */
  public static override fromJSON(json: JSONObject): URL {
    if (json["_type"] === ObjectType.URL) {
      return URL.fromStringLenient((json["value"] as string) || "");
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

  /*
   * The write side stays strict. Reads tolerate a legacy value that no longer
   * validates, but nothing may persist one: a malformed URL only ever comes
   * from fromDatabase/fromJSON, so refusing it here stops a bad value being
   * written back on an unrelated update, and stops a client inventing one.
   */
  protected static override toDatabase(
    value: URL | FindOperator<URL>,
  ): string | null {
    if (value) {
      if (typeof value === "string") {
        value = URL.fromString(value);
      }

      if (value instanceof URL && value.isMalformed()) {
        throw new BadDataException(
          "URL " + value.toString() + " is not in valid format.",
        );
      }

      return value.toString();
    }

    return null;
  }

  /*
   * Lenient by design — see fromStringLenient. A row that cannot be parsed is
   * returned as a malformed URL rather than throwing, because throwing here
   * fails the entire query that touched the row, not just the one column.
   */
  protected static override fromDatabase(_value: string): URL | null {
    if (_value) {
      return URL.fromStringLenient(_value);
    }

    return null;
  }
}
