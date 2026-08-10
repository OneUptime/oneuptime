import URL from "../../Types/API/URL";
import BadDataException from "../../Types/Exception/BadDataException";
import dns from "dns";

const IPV4_LITERAL_REGEX: RegExp = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_UNIQUE_LOCAL_REGEX: RegExp = /^f[cd][0-9a-f]{2}:/;

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
    let parsed: URL;
    try {
      parsed = URL.fromString(rawUrl.toString());
    } catch {
      return "";
    }

    return SSRFProtection.extractHost(parsed.hostname.hostname.toLowerCase());
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
    let parsed: URL;
    try {
      parsed = URL.fromString(rawUrl.toString());
    } catch {
      return false;
    }

    if (parsed.protocol.toString().toLowerCase() !== "https://") {
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

  private static isIpLiteral(hostname: string): boolean {
    return IPV4_LITERAL_REGEX.test(hostname) || hostname.includes(":");
  }

  private static isBlockedHostnameLiteral(hostname: string): boolean {
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "metadata.google.internal"
    ) {
      return true;
    }

    const ipv4Match: RegExpMatchArray | null = hostname.match(
      /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/,
    );
    if (ipv4Match) {
      const octets: Array<number> = [
        Number(ipv4Match[1]),
        Number(ipv4Match[2]),
        Number(ipv4Match[3]),
        Number(ipv4Match[4]),
      ];

      if (
        octets.some((o: number) => {
          return o < 0 || o > 255;
        })
      ) {
        return true;
      }
      if (octets[0] === 0) {
        return true;
      }
      if (octets[0] === 127) {
        return true;
      }
      if (octets[0] === 10) {
        return true;
      }
      if (octets[0] === 172 && (octets[1]! & 0xf0) === 16) {
        return true;
      }
      if (octets[0] === 192 && octets[1] === 168) {
        return true;
      }
      if (octets[0] === 169 && octets[1] === 254) {
        return true;
      }
      if (octets[0] === 100 && (octets[1]! & 0xc0) === 64) {
        return true;
      }
      return false;
    }

    if (hostname.includes(":")) {
      const stripped: string = hostname.replace(/^\[|\]$/g, "");
      if (stripped === "::1" || stripped === "::") {
        return true;
      }
      if (stripped.startsWith("fe80:") || stripped.startsWith("fe80::")) {
        return true;
      }
      if (IPV6_UNIQUE_LOCAL_REGEX.test(stripped)) {
        return true;
      }
    }

    return false;
  }
}
