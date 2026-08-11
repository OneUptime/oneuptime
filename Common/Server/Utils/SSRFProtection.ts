import URL from "../../Types/API/URL";
import BadDataException from "../../Types/Exception/BadDataException";
import dns from "dns";
import net from "net";

/*
 * Guards outbound HTTP(S) requests whose target is (fully or partly)
 * attacker-controlled — status page subscriber webhooks, project webhook
 * notifications, etc. — against Server-Side Request Forgery. It rejects URLs
 * that point at loopback, RFC-1918 private ranges, link-local (including the
 * 169.254.169.254 cloud metadata endpoint), CGNAT, and IPv6 loopback /
 * link-local / unique-local addresses, resolving DNS hostnames first so a
 * public-looking name that maps to an internal address is still blocked.
 *
 * This is a best-effort, TOCTOU-susceptible check: a hostname can resolve to a
 * different address between validation and the actual request (DNS rebinding).
 * Callers should therefore ALSO disable redirect-following on the request so a
 * validated public host cannot 3xx-redirect the server to an internal target.
 */
export default class SSRFProtection {
  /*
   * Returns the bare, lowercased host of a URL — no port, no brackets — or an
   * empty string if it cannot be parsed. Host-pinning allowlists (Slack, Teams)
   * must compare against THIS, never against the whole URL string: a substring
   * check on the full URL is satisfied by an attacker-controlled path or query
   * (`http://169.254.169.254/?x=office.com`) and pins nothing.
   */
  public static getBareHostname(rawUrl: string | URL): string {
    /*
     * WHATWG, not URL.fromString. OneUptime's parser takes everything before
     * the first "/" as the authority and never terminates at "?" or "#", so it
     * reads "https://169.254.169.254#.office.com" as the host
     * "169.254.169.254#.office.com" - which ends with ".office.com" and
     * satisfied the allowlist, while axios re-parsed the same string per WHATWG
     * and dialled 169.254.169.254. A pin is only worth anything if it parses
     * the host the same way the HTTP client will.
     */
    let parsed: globalThis.URL;
    try {
      parsed = new globalThis.URL(rawUrl.toString());
    } catch {
      return "";
    }

    return SSRFProtection.extractHost(parsed.hostname.toLowerCase());
  }

  /*
   * True when the URL's host is exactly one of `allowedDomains` or a subdomain
   * of one, and the scheme is https. Suffix matching is anchored on a leading
   * dot so `office.com.attacker.tld` and `evil-office.com` are both rejected.
   */
  public static isUrlOnAllowedDomain(
    rawUrl: string | URL,
    allowedDomains: Array<string>,
  ): boolean {
    let parsed: globalThis.URL;
    try {
      parsed = new globalThis.URL(rawUrl.toString());
    } catch {
      return false;
    }

    // Scheme and host must come from the SAME parser, or they can disagree.
    if (parsed.protocol.toLowerCase() !== "https:") {
      return false;
    }

    const hostname: string = SSRFProtection.getBareHostname(rawUrl);

    if (!hostname) {
      return false;
    }

    return allowedDomains.some((domain: string) => {
      const allowed: string = domain.toLowerCase();
      return hostname === allowed || hostname.endsWith(`.${allowed}`);
    });
  }

  public static async validateWebhookTargetIsSafe(
    rawUrl: string | URL,
  ): Promise<void> {
    /*
     * URL.fromString only knows http/https/ws/wss/mongodb/mailto and silently
     * DEFAULTS anything else to https - "file:///etc/passwd" comes back as
     * host "file", not as a file: URL - so the protocol check below never sees
     * the scheme the caller actually wrote. Read it off the raw string first.
     *
     * The ":" must be followed by "/" or this would treat the host in a
     * scheme-less "example.com:8080/hook" as a scheme and reject it.
     */
    const schemeMatch: RegExpMatchArray | null = rawUrl
      .toString()
      .trim()
      .match(/^([a-z][a-z0-9+.-]*):\//i);

    if (
      schemeMatch &&
      schemeMatch[1] &&
      !["http", "https"].includes(schemeMatch[1].toLowerCase())
    ) {
      throw new BadDataException(
        "Webhook URL must use http or https protocol.",
      );
    }

    let parsed: URL;
    try {
      parsed = URL.fromString(rawUrl.toString());
    } catch {
      throw new BadDataException("Webhook URL is not a valid URL");
    }

    const protocolValue: string = parsed.protocol.toString().toLowerCase();
    if (protocolValue !== "http://" && protocolValue !== "https://") {
      throw new BadDataException(
        "Webhook URL must use http or https protocol.",
      );
    }

    const rawHost: string = parsed.hostname.hostname.toLowerCase();

    if (!rawHost) {
      throw new BadDataException("Webhook URL must include a host.");
    }

    /*
     * OneUptime's URL parser keeps the port glued to the host (e.g.
     * "169.254.169.254:80"). Strip it before the checks below, otherwise a
     * literal-with-port slips past the IPv4 blocklist and, because it contains
     * a ":", is mistaken for an IP literal and skips DNS resolution entirely.
     */
    const hostname: string = SSRFProtection.extractHost(rawHost);

    if (!hostname) {
      throw new BadDataException("Webhook URL must include a host.");
    }

    if (SSRFProtection.isBlockedHostnameLiteral(hostname)) {
      throw new BadDataException(
        "Webhook URL points to a private, loopback, or link-local address and is not allowed.",
      );
    }

    if (!SSRFProtection.isIpLiteral(hostname)) {
      let resolved: Array<{ address: string }> = [];
      try {
        resolved = await dns.promises.lookup(hostname, { all: true });
      } catch {
        throw new BadDataException(
          "Webhook URL hostname could not be resolved via DNS.",
        );
      }

      for (const entry of resolved) {
        if (
          SSRFProtection.isBlockedHostnameLiteral(entry.address.toLowerCase())
        ) {
          throw new BadDataException(
            "Webhook URL resolves to a private, loopback, or link-local address and is not allowed.",
          );
        }
      }
    }
  }

  /*
   * Extracts the bare host (IPv4, IPv6, or hostname) from a "host[:port]"
   * string, handling bracketed IPv6 (`[::1]`, `[::1]:8080`) and unbracketed
   * IPv6 literals (which contain multiple colons and carry no port).
   */
  private static extractHost(hostWithPort: string): string {
    const host: string = hostWithPort.trim();

    if (host.startsWith("[")) {
      const closingBracketIndex: number = host.indexOf("]");
      if (closingBracketIndex !== -1) {
        return host.slice(1, closingBracketIndex);
      }
      return host.replace(/^\[|\]$/g, "");
    }

    const colonCount: number = (host.match(/:/g) || []).length;

    if (colonCount > 1) {
      // Unbracketed IPv6 literal — colons are part of the address, not a port.
      return host;
    }

    if (colonCount === 1) {
      // host:port — keep only the host part.
      return host.split(":")[0] || "";
    }

    return host;
  }

  /*
   * An IP literal needs no DNS lookup - but "looks like it has a colon" is not
   * the same question, and getting it wrong is a bypass in both directions.
   * net.isIP is the authority: it rejects "2852039166" and "0177.0.0.1"
   * (which then go to DNS, where getaddrinfo decodes them and the resolved
   * address gets checked) and accepts every real IPv6 spelling.
   */
  private static isIpLiteral(hostname: string): boolean {
    return net.isIP(SSRFProtection.stripZoneId(hostname)) !== 0;
  }

  private static stripZoneId(address: string): string {
    const zoneIndex: number = address.indexOf("%");
    return zoneIndex === -1 ? address : address.substring(0, zoneIndex);
  }

  /*
   * Expands an IPv6 address into its eight 16-bit groups, folding an embedded
   * IPv4 tail ("::ffff:127.0.0.1") into two hex groups on the way, so that
   * every spelling of one address produces one canonical answer. Returns null
   * if the address is not parseable as IPv6.
   *
   * This exists because the checks below CANNOT be string prefix matches:
   * "::1", "0:0:0:0:0:0:0:1" and "0000:...:0001" are the same host, and
   * "::ffff:169.254.169.254" is the cloud metadata endpoint wearing a hat.
   */
  private static expandIpv6(address: string): Array<number> | null {
    let ip: string = SSRFProtection.stripZoneId(address.toLowerCase());

    if (net.isIPv6(ip) === false) {
      return null;
    }

    // Fold a dotted-quad tail into the two hex groups it stands for.
    const lastColonIndex: number = ip.lastIndexOf(":");
    const tail: string = ip.substring(lastColonIndex + 1);
    if (tail.includes(".")) {
      if (net.isIPv4(tail) === false) {
        return null;
      }
      const octets: Array<number> = tail.split(".").map((part: string) => {
        return parseInt(part, 10);
      });
      const high: string = (
        ((octets[0] as number) << 8) |
        (octets[1] as number)
      ).toString(16);
      const low: string = (
        ((octets[2] as number) << 8) |
        (octets[3] as number)
      ).toString(16);
      ip = `${ip.substring(0, lastColonIndex)}:${high}:${low}`;
    }

    const halves: Array<string> = ip.split("::");
    if (halves.length > 2) {
      return null;
    }

    const head: Array<string> =
      halves[0] === undefined || halves[0] === "" ? [] : halves[0].split(":");
    const rear: Array<string> =
      halves.length === 2 && halves[1] !== undefined && halves[1] !== ""
        ? halves[1].split(":")
        : [];

    let groups: Array<string>;
    if (halves.length === 2) {
      const zeroFill: number = 8 - head.length - rear.length;
      if (zeroFill < 0) {
        return null;
      }
      groups = [...head, ...new Array(zeroFill).fill("0"), ...rear];
    } else {
      groups = head;
    }

    if (groups.length !== 8) {
      return null;
    }

    const parsed: Array<number> = groups.map((group: string) => {
      return parseInt(group || "0", 16);
    });

    if (
      parsed.some((group: number) => {
        return Number.isNaN(group) || group < 0 || group > 0xffff;
      })
    ) {
      return null;
    }

    return parsed;
  }

  /*
   * True when an IPv6 literal points somewhere the server must never be made
   * to reach. Ranges, not spellings: loopback, unspecified, link-local
   * (fe80::/10), unique-local (fc00::/7) and multicast (ff00::/8), plus the
   * three ways IPv6 can carry an IPv4 destination - IPv4-mapped
   * (::ffff:0:0/96), IPv4-compatible (::/96) and the NAT64 well-known prefix
   * (64:ff9b::/96) - which are handed to the IPv4 blocklist.
   */
  private static isBlockedIpv6(address: string): boolean {
    const groups: Array<number> | null = SSRFProtection.expandIpv6(address);

    if (!groups) {
      // Not parseable as IPv6; the caller's other checks decide.
      return false;
    }

    const isZeroThrough: (endExclusive: number) => boolean = (
      endExclusive: number,
    ): boolean => {
      return groups.slice(0, endExclusive).every((group: number) => {
        return group === 0;
      });
    };

    const embeddedIpv4: () => string = (): string => {
      const high: number = groups[6] as number;
      const low: number = groups[7] as number;
      return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
    };

    // ::  — unspecified. Connecting here lands on the local host.
    if (isZeroThrough(8)) {
      return true;
    }

    // ::1 — loopback.
    if (isZeroThrough(7) && groups[7] === 1) {
      return true;
    }

    // ::ffff:0:0/96 — IPv4-mapped.
    if (isZeroThrough(5) && groups[5] === 0xffff) {
      return SSRFProtection.isBlockedIpv4(embeddedIpv4());
    }

    // 64:ff9b::/96 — NAT64 well-known prefix.
    if (
      groups[0] === 0x0064 &&
      groups[1] === 0xff9b &&
      groups[2] === 0 &&
      groups[3] === 0 &&
      groups[4] === 0 &&
      groups[5] === 0
    ) {
      return SSRFProtection.isBlockedIpv4(embeddedIpv4());
    }

    // ::/96 — IPv4-compatible (deprecated, still routable by some stacks).
    if (isZeroThrough(6)) {
      return SSRFProtection.isBlockedIpv4(embeddedIpv4());
    }

    const first: number = groups[0] as number;

    // fe80::/10 — link-local.
    if ((first & 0xffc0) === 0xfe80) {
      return true;
    }

    // fc00::/7 — unique-local.
    if ((first & 0xfe00) === 0xfc00) {
      return true;
    }

    // fec0::/10 — site-local. Deprecated by RFC 3879, still routed on some networks.
    if ((first & 0xffc0) === 0xfec0) {
      return true;
    }

    // ff00::/8 — multicast.
    if ((first & 0xff00) === 0xff00) {
      return true;
    }

    return false;
  }

  private static isBlockedIpv4(address: string): boolean {
    const octets: Array<number> = address.split(".").map((part: string) => {
      return Number(part);
    });

    if (
      octets.length !== 4 ||
      octets.some((octet: number) => {
        return Number.isNaN(octet) || octet < 0 || octet > 255;
      })
    ) {
      return true;
    }

    const [first, second] = octets as [number, number, number, number];

    if (first === 0) {
      return true; // 0.0.0.0/8 — "this host".
    }
    if (first === 127) {
      return true; // loopback
    }
    if (first === 10) {
      return true; // RFC-1918
    }
    if (first === 172 && (second & 0xf0) === 16) {
      return true; // RFC-1918 172.16/12
    }
    if (first === 192 && second === 168) {
      return true; // RFC-1918
    }
    if (first === 169 && second === 254) {
      return true; // link-local, incl. the 169.254.169.254 metadata endpoint
    }
    if (first === 100 && (second & 0xc0) === 64) {
      return true; // CGNAT 100.64/10
    }
    if (first >= 224) {
      return true; // multicast, reserved, and 255.255.255.255
    }

    return false;
  }

  private static isBlockedHostnameLiteral(hostname: string): boolean {
    if (
      hostname === "localhost" ||
      hostname === "localhost." ||
      hostname.endsWith(".localhost") ||
      hostname === "metadata.google.internal"
    ) {
      return true;
    }

    const address: string = SSRFProtection.stripZoneId(
      hostname.replace(/^\[|\]$/g, ""),
    );

    if (net.isIPv4(address)) {
      return SSRFProtection.isBlockedIpv4(address);
    }

    if (net.isIPv6(address)) {
      return SSRFProtection.isBlockedIpv6(address);
    }

    return false;
  }
}
