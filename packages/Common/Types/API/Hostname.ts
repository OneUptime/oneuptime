import DatabaseProperty from "../Database/DatabaseProperty";
import BadDataException from "../Exception/BadDataException";
import { JSONObject, ObjectType } from "../JSON";
import Port from "../Port";
import Typeof from "../Typeof";
import HostAddressUtil from "../../Utils/HostAddressUtil";
import IP from "../IP/IP";
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

const PORT_REGEX: RegExp = /^\d{1,5}$/;

/*
 * The authority spellings of an IPv6 host: bracketed ("[::1]", "[::1]:8080")
 * or bare. Two or more colons cannot be a "host:port", so every colon in a
 * bare value belongs to the address itself.
 *
 * This only decides which SHAPE a value has. Whether what it holds is really
 * an address is IP.isIP's job, and isValid below asks it -- the old code
 * settled for a "[0-9a-fA-F:.]+" charset, which called "::::" and
 * "1.2.3.4.5.6" valid hosts and then handed them to a socket.
 */
function isIPv6Authority(authority: string): boolean {
  return authority.startsWith("[") || (authority.match(/:/g) || []).length > 1;
}

function isIPv6Address(value: string): boolean {
  return Boolean(value) && IP.isIP(value) && new IP(value).isIPv6();
}

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
      return isIPv6Address(bracketedIpv6Match[1] as string);
    }

    /*
     * Unbracketed IPv6 literal. Two or more colons cannot be a "host:port",
     * so the colons must be part of the address itself.
     */
    if (isIPv6Authority(authority)) {
      return isIPv6Address(authority);
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

  /*
   * The authority form. An IPv6 host is BRACKETED once a port is appended,
   * because "2001:db8::1" + ":179" is not an ambiguous-looking string — it is
   * "2001:db8::1:179", which net.isIP() accepts as a different, perfectly
   * valid address. Anything that read this back (or showed it to an operator)
   * was therefore pointed at a host nobody configured.
   *
   * Without a port the host is returned exactly as it is held, brackets and
   * all. A bracketed value came from a URL authority and has to go back into
   * one — dropping the brackets there would make URL.toString() emit
   * "https://2001:db8::1/", which no URL parser accepts.
   */
  public override toString(): string {
    if (!this.port) {
      return this.hostname;
    }

    return HostAddressUtil.formatHostAndPort({
      host: this.hostname,
      port: this.port.toString(),
    });
  }

  /*
   * Reads a stored host, which may carry a ":port".
   *
   * IPv6 literals are handed to fromAuthority instead of being split, because
   * splitting on the first colon is meaningless for an address that is made
   * of colons: "2001:518:2800:9::2" used to come back as host "2001" with
   * port 518 — and because 518 is a legal port number NOTHING threw. A
   * monitor saved from the dashboard therefore silently pointed at a host
   * called "2001", and the address the operator typed was simply gone.
   *
   * DNS names and IPv4 literals keep the original behaviour exactly: neither
   * can contain two colons, so neither can reach the new branch.
   */
  public static fromString(hostname: string | Hostname): Hostname {
    if (hostname instanceof Hostname) {
      hostname = hostname.toString();
    }

    const value: string = (hostname || "").trim();

    if (isIPv6Authority(value)) {
      return Hostname.fromAuthority(value);
    }

    if (value.includes(":")) {
      return new Hostname(value.split(":")[0] as string, value.split(":")[1]);
    }
    return new Hostname(value);
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
