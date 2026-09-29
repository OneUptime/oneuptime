import IP from "../Types/IP/IP";

/*
 * The two things every caller that holds a host string needs to get right
 * when that host might be an IPv6 literal, in one place.
 *
 * Both are pure text problems that only exist for IPv6, which is exactly why
 * they kept being got wrong one call site at a time:
 *
 *   1. BRACKETS ARE URL SYNTAX, NOT PART OF THE ADDRESS. "[2001:db8::1]" is
 *      how RFC 3986 writes an IPv6 host inside a URL authority, and that is
 *      the form URL.fromString and Hostname.fromAuthority hand back. Node
 *      does NOT strip them: net.connect({host: "[::1]"}) and
 *      https.get({host: "[::1]"}) both go to the resolver and come back
 *      ENOTFOUND, and `ping [::1]` fails the same way. An IPv4 host never
 *      carries brackets, so every one of those call sites worked until
 *      somebody pointed it at IPv6.
 *
 *   2. "host:port" IS AMBIGUOUS FOR IPv6, AND NOT IN A WAY THAT LOOKS WRONG.
 *      "192.0.2.1:179" cannot be mistaken for an address. Appending ":179" to
 *      "2001:518:2800:9::2" produces "2001:518:2800:9::2:179", which node's
 *      net.isIP() reports as a PERFECTLY VALID IPv6 address - a different
 *      host from the one that was meant. So the unbracketed spelling does not
 *      merely read oddly, it silently renames the target.
 */
export default class HostAddressUtil {
  /*
   * True when the value is an IPv6 literal, written bare ("2001:db8::1") or
   * bracketed ("[2001:db8::1]"). Anything else - a DNS name, an IPv4 literal,
   * an authority with a port - is false.
   */
  public static isIPv6(host: string): boolean {
    const bare: string = HostAddressUtil.stripBrackets(host);

    if (!bare) {
      return false;
    }

    return IP.isIP(bare) && new IP(bare).isIPv6();
  }

  /*
   * The address to hand to a socket, a resolver or the ping binary: the same
   * host with any IPv6 URL brackets removed.
   *
   * Brackets are only removed when what is inside them really is an IPv6
   * address. "[not-an-address]" is returned untouched so it fails validation
   * downstream as the nonsense it is, rather than being quietly laundered
   * into a bare hostname.
   */
  public static stripBrackets(host: string): string {
    const trimmed: string = (host || "").trim();

    if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
      return trimmed;
    }

    const inner: string = trimmed.substring(1, trimmed.length - 1);

    if (!inner || !IP.isIP(inner) || !new IP(inner).isIPv6()) {
      return trimmed;
    }

    return inner;
  }

  /*
   * The authority form: an IPv6 host is bracketed so the ":" before the port
   * cannot be read as another group of the address. Already-bracketed input
   * is not bracketed twice.
   *
   * A missing/empty port returns the host on its own, bare. That is
   * deliberate: a port-less destination is stored and pinged as the address
   * itself, and wrapping it in brackets there would change what is written to
   * the database and shown to the user for no benefit - the ambiguity this
   * guards against only exists once a ":port" is appended.
   */
  public static formatHostAndPort(data: {
    host: string;
    port?: string | number | undefined;
  }): string {
    const bare: string = HostAddressUtil.stripBrackets(data.host);
    const port: string =
      data.port === undefined || data.port === null ? "" : String(data.port);

    if (!port) {
      return bare;
    }

    return HostAddressUtil.isIPv6(bare)
      ? `[${bare}]:${port}`
      : `${bare}:${port}`;
  }
}
