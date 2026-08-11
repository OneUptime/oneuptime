import dns from "dns";
import http from "http";
import https from "https";
import net from "net";
import BadDataException from "../../../Types/Exception/BadDataException";
import { IsBillingEnabled } from "../../EnvironmentConfig";

/*
 * SSRF egress guard for outbound connections whose target is chosen by a
 * tenant.
 *
 * It started life guarding external Data Source connections — hence the
 * file's home — but the same policy now covers every sink where a project
 * member picks the host and a self-hosted install may legitimately point at
 * something internal: LLM providers (self-hosted Ollama/vLLM), SMTP OAuth
 * token endpoints, status page / dashboard domain verification, OIDC
 * discovery and Runbook HTTP steps. Sinks that can only ever be third-party
 * SaaS (Slack, Teams, subscriber webhooks) use SSRFProtection instead, which
 * blocks private ranges unconditionally.
 *
 * Without a guard these turn the API server into an authenticated request
 * proxy into whatever network it runs in (cloud metadata endpoints, internal
 * services, sibling tenants' infrastructure). Every caller must validate its
 * target through this guard before opening a socket.
 *
 * Policy:
 *  - ALWAYS blocked, in every deployment: loopback, link-local (cloud
 *    metadata lives at 169.254.169.254), unspecified, multicast, broadcast
 *    and reserved ranges. Nothing a data source legitimately targets lives
 *    there, and the app server's own loopback is exactly what an attacker
 *    wants.
 *  - PRIVATE ranges (RFC1918, CGNAT, ULA, benchmark/documentation nets):
 *    blocked when billing is enabled (multi-tenant SaaS), allowed for
 *    self-hosted installs — a self-hosted OneUptime's databases usually ARE
 *    on 10.x/192.168.x. Self-hosted operators can force SaaS behavior with
 *    DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true.
 *
 * Validation happens on RESOLVED ADDRESSES, not hostnames, so decimal
 * (2130706433), octal (0177.0.0.1) and DNS-based tricks all get caught at
 * the same choke point: whatever getaddrinfo would connect to is what gets
 * checked. HTTP connectors additionally PIN the validated addresses into
 * the socket lookup so the checked address is the connected address (no
 * DNS-rebind window); SQL drivers connect by hostname immediately after
 * validation, accepting a small residual rebind window in exchange for
 * intact TLS hostname verification.
 */

export interface ResolvedAddress {
  address: string;
  family: number; // 4 | 6
}

export type EgressResolveFunction = (
  hostname: string,
) => Promise<Array<ResolvedAddress>>;

export interface EgressGuardOptions {
  /*
   * Test seam / policy override. Undefined ⇒ derive from billing flag and
   * the DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES env var.
   */
  blockPrivateAddresses?: boolean | undefined;
  // Test seam for DNS. Undefined ⇒ dns.promises.lookup with a timeout.
  resolveFunction?: EgressResolveFunction | undefined;
  /*
   * Noun used in error messages so a rejection names the thing the user was
   * actually configuring ("LLM provider host ... is not allowed"). Defaults
   * to "Data source".
   */
  targetLabel?: string | undefined;
}

export interface PinnedAgents {
  httpAgent: http.Agent;
  httpsAgent: https.Agent;
}

/*
 * dns.lookup's shape, as http.Agent / net.Socket call it. Declared locally
 * rather than pulled from @types/node because the real declaration is a heavy
 * overload set and every consumer here uses exactly this one shape.
 */
export type EgressLookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | Array<{ address: string; family: number }>,
  family?: number,
) => void;

export type EgressLookupFunction = (
  hostname: string,
  options: { all?: boolean | undefined; family?: number | undefined },
  callback: EgressLookupCallback,
) => void;

const DEFAULT_TARGET_LABEL: string = "Data source";

export interface AddressVerdict {
  blocked: boolean;
  reason?: string | undefined;
}

const DNS_LOOKUP_TIMEOUT_IN_MS: number = 5000;

interface Ipv4Range {
  base: number;
  maskBits: number;
  reason: string;
}

type RangeSpec = [string, number, string];

const ALWAYS_BLOCKED_IPV4_RANGE_SPECS: Array<RangeSpec> = [
  ["127.0.0.0", 8, "loopback address"],
  ["169.254.0.0", 16, "link-local address (cloud metadata range)"],
  ["0.0.0.0", 8, "unspecified address"],
  ["224.0.0.0", 4, "multicast address"],
  ["240.0.0.0", 4, "reserved address"],
];

const PRIVATE_IPV4_RANGE_SPECS: Array<RangeSpec> = [
  ["10.0.0.0", 8, "private network address"],
  ["172.16.0.0", 12, "private network address"],
  ["192.168.0.0", 16, "private network address"],
  ["100.64.0.0", 10, "carrier-grade NAT address"],
  ["192.0.0.0", 24, "IETF protocol assignment address"],
  ["198.18.0.0", 15, "benchmarking address"],
  ["192.0.2.0", 24, "documentation address"],
  ["198.51.100.0", 24, "documentation address"],
  ["203.0.113.0", 24, "documentation address"],
];

export default class DataSourceEgressGuard {
  public static shouldBlockPrivateAddresses(): boolean {
    if (process.env["DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES"] === "true") {
      return true;
    }
    return IsBillingEnabled;
  }

  private static ipv4ToInt(ip: string): number {
    const parts: Array<string> = ip.split(".");
    let value: number = 0;
    for (const part of parts) {
      value = value * 256 + parseInt(part, 10);
    }
    // >>> 0 keeps the value an unsigned 32-bit int.
    return value >>> 0;
  }

  private static buildRanges(specs: Array<RangeSpec>): Array<Ipv4Range> {
    return specs.map((spec: RangeSpec) => {
      return {
        base: this.ipv4ToInt(spec[0]),
        maskBits: spec[1],
        reason: spec[2],
      };
    });
  }

  private static isInRange(ipAsInt: number, range: Ipv4Range): boolean {
    /*
     * maskBits 0 would shift by 32 (undefined behavior in JS bitwise ops);
     * no range here uses it, but guard anyway.
     */
    if (range.maskBits <= 0) {
      return true;
    }
    const mask: number = (0xffffffff << (32 - range.maskBits)) >>> 0;
    return (ipAsInt & mask) >>> 0 === (range.base & mask) >>> 0;
  }

  private static checkIpv4(
    ip: string,
    blockPrivateAddresses: boolean,
  ): AddressVerdict {
    const ipAsInt: number = this.ipv4ToInt(ip);

    if (ip === "255.255.255.255") {
      return { blocked: true, reason: "broadcast address" };
    }

    for (const range of this.buildRanges(ALWAYS_BLOCKED_IPV4_RANGE_SPECS)) {
      if (this.isInRange(ipAsInt, range)) {
        return { blocked: true, reason: range.reason };
      }
    }

    if (blockPrivateAddresses) {
      for (const range of this.buildRanges(PRIVATE_IPV4_RANGE_SPECS)) {
        if (this.isInRange(ipAsInt, range)) {
          return { blocked: true, reason: range.reason };
        }
      }
    }

    return { blocked: false };
  }

  /*
   * Expand an IPv6 address to its full 8-group lowercase form so prefix
   * checks are string-safe ("fe80::1" -> "fe80:0000:...:0001"). Zone ids
   * (%eth0) are stripped first.
   */
  private static expandIpv6(ip: string): string | null {
    let address: string = ip.toLowerCase();
    const zoneIndex: number = address.indexOf("%");
    if (zoneIndex !== -1) {
      address = address.substring(0, zoneIndex);
    }

    /*
     * Convert a trailing embedded IPv4 (::ffff:127.0.0.1) into two hex
     * groups so the group math below is uniform.
     */
    const lastColon: number = address.lastIndexOf(":");
    const tail: string = address.substring(lastColon + 1);
    if (tail.includes(".")) {
      if (net.isIPv4(tail) === false) {
        return null;
      }
      const octets: Array<number> = tail.split(".").map((part: string) => {
        return parseInt(part, 10);
      });
      const groupA: string = ((octets[0]! << 8) | octets[1]!).toString(16);
      const groupB: string = ((octets[2]! << 8) | octets[3]!).toString(16);
      address = `${address.substring(0, lastColon)}:${groupA}:${groupB}`;
    }

    const doubleColonParts: Array<string> = address.split("::");
    if (doubleColonParts.length > 2) {
      return null;
    }

    let groups: Array<string>;
    if (doubleColonParts.length === 2) {
      const head: Array<string> = doubleColonParts[0]
        ? doubleColonParts[0].split(":")
        : [];
      const tailGroups: Array<string> = doubleColonParts[1]
        ? doubleColonParts[1].split(":")
        : [];
      const missing: number = 8 - head.length - tailGroups.length;
      if (missing < 0) {
        return null;
      }
      groups = [...head, ...Array(missing).fill("0"), ...tailGroups];
    } else {
      groups = address.split(":");
    }

    if (groups.length !== 8) {
      return null;
    }

    return groups
      .map((group: string) => {
        return group.padStart(4, "0");
      })
      .join(":");
  }

  private static checkIpv6(
    ip: string,
    blockPrivateAddresses: boolean,
  ): AddressVerdict {
    const expanded: string | null = this.expandIpv6(ip);
    if (!expanded) {
      return { blocked: true, reason: "unparseable IPv6 address" };
    }

    /*
     * IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::/96) addresses
     * reach IPv4 targets — extract the embedded IPv4 and apply the IPv4
     * policy so mapping can't be used to smuggle a blocked v4 address.
     */
    const embeddedV4Prefixes: Array<string> = [
      "0000:0000:0000:0000:0000:ffff:",
      "0064:ff9b:0000:0000:0000:0000:",
    ];
    for (const prefix of embeddedV4Prefixes) {
      if (expanded.startsWith(prefix)) {
        const hexGroups: Array<string> = expanded
          .substring(prefix.length)
          .split(":");
        const high: number = parseInt(hexGroups[0]!, 16);
        const low: number = parseInt(hexGroups[1]!, 16);
        const embedded: string = [
          (high >> 8) & 0xff,
          high & 0xff,
          (low >> 8) & 0xff,
          low & 0xff,
        ].join(".");
        return this.checkIpv4(embedded, blockPrivateAddresses);
      }
    }

    const allZero: boolean = expanded === "0000:".repeat(7) + "0000";
    if (allZero) {
      return { blocked: true, reason: "unspecified address" };
    }
    if (expanded === "0000:".repeat(7) + "0001") {
      return { blocked: true, reason: "loopback address" };
    }

    const firstGroup: number = parseInt(expanded.substring(0, 4), 16);
    // fe80::/10 link-local.
    if ((firstGroup & 0xffc0) === 0xfe80) {
      return { blocked: true, reason: "link-local address" };
    }
    // ff00::/8 multicast.
    if ((firstGroup & 0xff00) === 0xff00) {
      return { blocked: true, reason: "multicast address" };
    }

    if (blockPrivateAddresses) {
      // fc00::/7 unique-local.
      if ((firstGroup & 0xfe00) === 0xfc00) {
        return { blocked: true, reason: "private network address" };
      }
      // 2001:db8::/32 documentation.
      if (expanded.startsWith("2001:0db8:")) {
        return { blocked: true, reason: "documentation address" };
      }
    }

    return { blocked: false };
  }

  /*
   * Verdict for a single literal IP address under the given (or derived)
   * policy. Exposed for tests and for connectors that receive addresses
   * from somewhere other than the standard resolve path.
   */
  public static checkAddress(
    address: string,
    options?: EgressGuardOptions,
  ): AddressVerdict {
    const blockPrivateAddresses: boolean =
      options?.blockPrivateAddresses ?? this.shouldBlockPrivateAddresses();

    const family: number = net.isIP(address);
    if (family === 4) {
      return this.checkIpv4(address, blockPrivateAddresses);
    }
    if (family === 6) {
      return this.checkIpv6(address, blockPrivateAddresses);
    }
    return { blocked: true, reason: "not a valid IP address" };
  }

  private static async defaultResolve(
    hostname: string,
  ): Promise<Array<ResolvedAddress>> {
    /*
     * dns.lookup (getaddrinfo) rather than dns.resolve so /etc/hosts and
     * container DNS behave exactly as the eventual socket connect would —
     * we must validate what would actually be dialed.
     */
    const lookupPromise: Promise<Array<ResolvedAddress>> = dns.promises
      .lookup(hostname, { all: true })
      .then((results: Array<{ address: string; family: number }>) => {
        return results.map((result: { address: string; family: number }) => {
          return { address: result.address, family: result.family };
        });
      });

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined = undefined;
    const timeoutPromise: Promise<never> = new Promise(
      (_resolve: (value: never) => void, reject: (error: Error) => void) => {
        timeoutHandle = setTimeout(() => {
          reject(new BadDataException(`DNS lookup timed out for ${hostname}`));
        }, DNS_LOOKUP_TIMEOUT_IN_MS);
      },
    );

    try {
      return await Promise.race([lookupPromise, timeoutPromise]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  /*
   * Resolve a hostname (or accept a literal IP) and assert every address it
   * can reach is allowed. Returns the validated addresses so HTTP callers
   * can pin them into the socket lookup. Throws BadDataException when any
   * address is blocked — ALL must pass, otherwise a multi-record DNS answer
   * could mix one public decoy with a private target.
   */
  public static async assertHostnameAllowed(
    hostname: string,
    options?: EgressGuardOptions,
  ): Promise<Array<ResolvedAddress>> {
    const label: string = options?.targetLabel || DEFAULT_TARGET_LABEL;

    if (!hostname) {
      throw new BadDataException(`${label} host is required.`);
    }

    // Literal [::1] style hosts arrive with brackets from URL parsing.
    const bareHostname: string = hostname.replace(/^\[|\]$/g, "");

    if (net.isIP(bareHostname) !== 0) {
      const verdict: AddressVerdict = this.checkAddress(bareHostname, options);
      if (verdict.blocked) {
        throw new BadDataException(
          `${label} host ${bareHostname} is not allowed: ${verdict.reason}.`,
        );
      }
      return [{ address: bareHostname, family: net.isIP(bareHostname) }];
    }

    const resolveFunction: EgressResolveFunction =
      options?.resolveFunction ||
      ((host: string) => {
        return this.defaultResolve(host);
      });

    let addresses: Array<ResolvedAddress> = [];
    try {
      addresses = await resolveFunction(bareHostname);
    } catch (error) {
      throw new BadDataException(
        `Could not resolve ${label.toLowerCase()} host ${bareHostname}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (addresses.length === 0) {
      throw new BadDataException(
        `Could not resolve ${label.toLowerCase()} host ${bareHostname}.`,
      );
    }

    for (const resolved of addresses) {
      const verdict: AddressVerdict = this.checkAddress(
        resolved.address,
        options,
      );
      if (verdict.blocked) {
        throw new BadDataException(
          `${label} host ${bareHostname} resolves to ${resolved.address}, which is not allowed: ${verdict.reason}.`,
        );
      }
    }

    return addresses;
  }

  /*
   * Validate a full HTTP(S) URL: scheme must be http/https and the host
   * must pass address validation. Returns the parsed URL plus the pinned
   * addresses for the HTTP client.
   */
  public static async assertUrlAllowed(
    urlString: string,
    options?: EgressGuardOptions,
  ): Promise<{ url: URL; addresses: Array<ResolvedAddress> }> {
    const label: string = options?.targetLabel || DEFAULT_TARGET_LABEL;

    if (!urlString) {
      throw new BadDataException(`${label} URL is required.`);
    }

    let url: URL;
    try {
      url = new URL(urlString);
    } catch {
      throw new BadDataException(
        `Invalid ${label.toLowerCase()} URL: ${urlString}`,
      );
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new BadDataException(
        `${label} URL must use http or https (got ${url.protocol.replace(
          ":",
          "",
        )}).`,
      );
    }

    const addresses: Array<ResolvedAddress> = await this.assertHostnameAllowed(
      url.hostname,
      options,
    );

    return { url, addresses };
  }

  /*
   * A dns.lookup-shaped function that always answers with the already
   * validated addresses. Handing this to an http(s).Agent makes the address
   * that was checked the address that gets dialed, closing the DNS-rebind
   * window between validation and connect. TLS still verifies against the
   * original hostname because SNI is taken from the URL, not from here.
   */
  public static createPinnedLookup(
    addresses: Array<ResolvedAddress>,
  ): EgressLookupFunction {
    return (
      _hostname: string,
      lookupOptions: { all?: boolean | undefined },
      callback: EgressLookupCallback,
    ): void => {
      if (lookupOptions && lookupOptions.all) {
        callback(
          null,
          addresses.map((resolved: ResolvedAddress) => {
            return { address: resolved.address, family: resolved.family };
          }),
        );
        return;
      }

      const first: ResolvedAddress = addresses[0]!;
      callback(null, first.address, first.family);
    };
  }

  // http/https agent pair that dials only the given validated addresses.
  public static createPinnedAgents(
    addresses: Array<ResolvedAddress>,
  ): PinnedAgents {
    const lookup: EgressLookupFunction = this.createPinnedLookup(addresses);

    return {
      httpAgent: new http.Agent({ lookup: lookup as never }),
      httpsAgent: new https.Agent({ lookup: lookup as never }),
    };
  }

  /*
   * Validate a URL and return agents pinned to what it resolved to — the
   * one-call form for HTTP callers. Pair with maxRedirects 0 /
   * doNotFollowRedirects: pinning only covers the host that was validated, so
   * a 3xx to an unvalidated host would otherwise walk straight around it.
   */
  public static async assertUrlAllowedAndPin(
    urlString: string,
    options?: EgressGuardOptions,
  ): Promise<{ url: URL; addresses: Array<ResolvedAddress> } & PinnedAgents> {
    const { url, addresses } = await this.assertUrlAllowed(urlString, options);

    return { url, addresses, ...this.createPinnedAgents(addresses) };
  }

  /*
   * A dns.lookup-shaped function that validates every hostname it is asked
   * about and then answers with the addresses it just checked.
   *
   * For libraries that build their own request URLs from documents they
   * fetched (openid-client adopts token_endpoint/userinfo_endpoint/jwks_uri
   * from the discovery document), pre-validating the one URL we know about
   * fixes nothing. Installing this as the library's lookup puts the guard on
   * every socket the library opens, whichever URL it decided to call.
   */
  public static createGuardedLookup(
    options?: EgressGuardOptions,
  ): EgressLookupFunction {
    return (
      hostname: string,
      lookupOptions: { all?: boolean | undefined; family?: number | undefined },
      callback: EgressLookupCallback,
    ): void => {
      this.assertHostnameAllowed(hostname, options)
        .then((addresses: Array<ResolvedAddress>) => {
          const wantedFamily: number | undefined =
            lookupOptions && lookupOptions.family
              ? lookupOptions.family
              : undefined;

          const usable: Array<ResolvedAddress> =
            wantedFamily === 4 || wantedFamily === 6
              ? addresses.filter((resolved: ResolvedAddress) => {
                  return resolved.family === wantedFamily;
                })
              : addresses;

          if (usable.length === 0) {
            const error: NodeJS.ErrnoException = new Error(
              `No IPv${wantedFamily} address for ${hostname}`,
            );
            error.code = "ENOTFOUND";
            callback(error, "");
            return;
          }

          this.createPinnedLookup(usable)(hostname, lookupOptions, callback);
        })
        .catch((error: Error) => {
          callback(error as NodeJS.ErrnoException, "");
        });
    };
  }
}
