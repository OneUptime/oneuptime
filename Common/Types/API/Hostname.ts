import DatabaseProperty from "../Database/DatabaseProperty";
import BadDataException from "../Exception/BadDataException";
import { JSONObject, ObjectType } from "../JSON";
import Port from "../Port";
import Typeof from "../Typeof";
import { FindOperator } from "typeorm";

/*
 * A chain of DNS labels (which also covers IPv4 literals). Labels are
 * alphanumeric plus "-" and "_", may not start or end with "-", and are
 * capped at 63 characters; a single trailing dot (the fully-qualified form)
 * is allowed. "_" is permitted because internal and service-discovery names
 * use it and it is not a URL delimiter.
 */
const HOST_REGEX: RegExp =
  /^[a-zA-Z0-9_](?:[a-zA-Z0-9_-]{0,61}[a-zA-Z0-9_])?(?:\.[a-zA-Z0-9_](?:[a-zA-Z0-9_-]{0,61}[a-zA-Z0-9_])?)*\.?$/;

/*
 * Anything that is not a URL delimiter. The point is not to validate
 * credentials, it is to make sure userinfo cannot smuggle a path, a query, a
 * fragment or a second authority past the host check.
 */
const USER_INFO_REGEX: RegExp = /^[^@/?#\s[\]]*$/;

const IPV6_CHARS_REGEX: RegExp = /^[0-9a-fA-F:.]+$/;

const PORT_REGEX: RegExp = /^\d{1,5}$/;

export default class Hostname extends DatabaseProperty {
  private _route: string = "";
  public get hostname(): string {
    return this._route;
  }

  private _port!: Port;
  public get port(): Port {
    return this._port;
  }
  public set port(v: Port) {
    this._port = v;
  }

  public set hostname(value: string) {
    value = value.trim();

    if (Hostname.isValid(value)) {
      this._route = value;
    } else {
      throw new BadDataException(
        "Hostname " + value + " is not in valid format.",
      );
    }
  }

  /*
   * True when the value is a usable authority: an optional "userinfo@"
   * prefix, a host (DNS name, IPv4, or IPv6 literal) and an optional ":port".
   *
   * The old check was a character allowlist that permitted "/", "?", "#" and
   * "@" anywhere, which made "169.254.169.254/latest/meta-data/#" a valid
   * Hostname. Anything that stores a Hostname and later interpolates it into
   * a URL therefore inherited full control of the host, port and path of the
   * resulting request. Structure, not a charset, is what rules that out.
   *
   * Userinfo is still accepted because "https://user:token@host/path" is a
   * real thing customers put in webhook URLs, and those values are already in
   * the database — rejecting them here would fail on read, not just on write.
   * Callers that need the bare host must not split this string themselves;
   * SSRFProtection.getBareHostname exists for that.
   */
  public static isValid(value: string): boolean {
    const authorityWithUserInfo: string = value.trim();

    /*
     * 253 for a DNS name, plus room for ":65535" and a userinfo prefix.
     * A bound here also keeps the label regex from being handed something
     * pathological.
     */
    if (!authorityWithUserInfo || authorityWithUserInfo.length > 512) {
      return false;
    }

    /*
     * Split on the LAST "@": userinfo may itself contain "@" percent-encoded
     * or not, and everything after the final one is the authority.
     */
    const atIndex: number = authorityWithUserInfo.lastIndexOf("@");

    if (atIndex !== -1) {
      const userInfo: string = authorityWithUserInfo.substring(0, atIndex);
      if (!USER_INFO_REGEX.test(userInfo)) {
        return false;
      }
    }

    const authority: string = authorityWithUserInfo.substring(atIndex + 1);

    if (!authority) {
      return false;
    }

    // Bracketed IPv6, with or without a port: "[::1]", "[::1]:8080".
    const bracketedIpv6Match: RegExpMatchArray | null = authority.match(
      /^\[([0-9a-fA-F:.]+)\](?::(\d{1,5}))?$/,
    );
    if (bracketedIpv6Match) {
      return true;
    }

    /*
     * Unbracketed IPv6 literal. Two or more colons cannot be a "host:port",
     * so the colons must be part of the address itself.
     */
    if ((authority.match(/:/g) || []).length > 1) {
      return IPV6_CHARS_REGEX.test(authority);
    }

    const colonIndex: number = authority.indexOf(":");
    const host: string =
      colonIndex === -1 ? authority : authority.substring(0, colonIndex);
    const port: string =
      colonIndex === -1 ? "" : authority.substring(colonIndex + 1);

    if (colonIndex !== -1 && !PORT_REGEX.test(port)) {
      return false;
    }

    return HOST_REGEX.test(host);
  }

  public constructor(hostname: string, port?: Port | string | number) {
    super();
    if (hostname) {
      this.hostname = hostname;
    }

    if (port instanceof Port) {
      this.port = port;
    } else if (typeof port === Typeof.String) {
      this.port = new Port(port as string);
    } else if (typeof port === Typeof.Number) {
      this.port = new Port(port as number);
    }
  }

  public override toJSON(): JSONObject {
    return {
      _type: ObjectType.Hostname,
      value: (this as Hostname).toString(),
    };
  }

  public static override fromJSON(json: JSONObject): Hostname {
    if (json["_type"] === ObjectType.Hostname) {
      return new Hostname((json["value"] as string) || "");
    }

    throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
  }

  public override toString(): string {
    let hostname: string = this.hostname;

    if (this.port) {
      hostname += ":" + this.port.toString();
    }

    return hostname;
  }

  public static fromString(hostname: string | Hostname): Hostname {
    if (hostname instanceof Hostname) {
      hostname = hostname.toString();
    }

    if (hostname.includes(":")) {
      return new Hostname(
        hostname.split(":")[0] as string,
        hostname.split(":")[1],
      );
    }
    return new Hostname(hostname);
  }

  /*
   * Splits a URL authority into its bare host and its port, using the same
   * structure isValid() already understands: optional userinfo, then either
   * a bracketed IPv6 literal, an unbracketed IPv6 literal, or a host with an
   * optional ":port".
   *
   * fromString() is NOT a substitute. It splits on the FIRST colon, so it
   * turns "[::1]:8080" into a host of "[" and a port of "", and any IPv6
   * literal into nonsense. Callers that hold an authority (a URL's host
   * component) and need the two parts apart must use this.
   *
   * Userinfo is dropped rather than preserved: the caller asked for a host
   * to connect to, and credentials are not part of one. Anything that needs
   * the original string still has the authority it passed in.
   */
  public static fromAuthority(authority: string): Hostname {
    const trimmedAuthority: string = (authority || "").trim();

    if (!trimmedAuthority) {
      return new Hostname("");
    }

    /*
     * Split on the LAST "@" for the same reason isValid() does: userinfo may
     * itself contain an "@", and everything after the final one is the
     * authority proper.
     */
    const atIndex: number = trimmedAuthority.lastIndexOf("@");
    const hostAndPort: string =
      atIndex === -1
        ? trimmedAuthority
        : trimmedAuthority.substring(atIndex + 1);

    if (!hostAndPort) {
      return new Hostname("");
    }

    // Bracketed IPv6, with or without a port: "[::1]", "[::1]:8080".
    const bracketedIpv6Match: RegExpMatchArray | null = hostAndPort.match(
      /^(\[[0-9a-fA-F:.]+\])(?::(\d{1,5}))?$/,
    );

    if (bracketedIpv6Match) {
      const ipv6Host: string = bracketedIpv6Match[1] as string;
      const ipv6Port: string | undefined = bracketedIpv6Match[2];

      return ipv6Port
        ? new Hostname(ipv6Host, ipv6Port)
        : new Hostname(ipv6Host);
    }

    /*
     * Unbracketed IPv6 literal: two or more colons cannot be a "host:port",
     * so every colon belongs to the address itself and there is no port.
     */
    if ((hostAndPort.match(/:/g) || []).length > 1) {
      return new Hostname(hostAndPort);
    }

    const colonIndex: number = hostAndPort.indexOf(":");

    if (colonIndex === -1) {
      return new Hostname(hostAndPort);
    }

    const host: string = hostAndPort.substring(0, colonIndex);
    const port: string = hostAndPort.substring(colonIndex + 1);

    /*
     * A trailing colon with no digits ("host:") is not a port. Keep the host
     * and drop the empty port rather than constructing an invalid Port.
     */
    if (!port) {
      return new Hostname(host);
    }

    return new Hostname(host, port);
  }

  public static override toDatabase(
    value: Hostname | FindOperator<Hostname>,
  ): string | null {
    if (value) {
      if (typeof value === "string") {
        value = new Hostname(value);
      }

      return value.toString();
    }

    return value;
  }

  public static override fromDatabase(_value: string): Hostname | null {
    if (_value) {
      return new Hostname(_value);
    }

    return null;
  }
}
