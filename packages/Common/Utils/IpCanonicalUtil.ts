import IP from "../Types/IP/IP";

// 6to4, 2002::/16 (RFC 3056).
const SIX_TO_FOUR_PREFIX_GROUP: number = 0x2002;

// Teredo, 2001::/32 (RFC 4380): the first two groups.
const TEREDO_PREFIX_GROUPS: [number, number] = [0x2001, 0x0000];

/*
 * Canonical text form for IP literals, so two spellings of the same
 * address compare equal. IPv4 already has a single canonical dotted-quad
 * form; IPv6 does not — `2001:DB8::1`, `2001:db8:0:0:0:0:0:1` and
 * `2001:db8::0001` are all the same address. Datagram sources (traps,
 * syslog, flows) arrive in Node's normalized lowercase-compressed form,
 * while device hostnames are whatever a human typed, so correlation must
 * canonicalize both sides (RFC 5952: lowercase, no leading zeros, longest
 * zero-run compressed, leftmost on ties, no compression of a single
 * group).
 *
 * Non-IP input (DNS names, garbage) is returned unchanged.
 */
export default class IpCanonicalUtil {
  public static canonicalize(value: string): string {
    const trimmed: string = value.trim();

    if (!IP.isIP(trimmed)) {
      return trimmed;
    }

    const ip: IP = new IP(trimmed);

    if (ip.isIPv4()) {
      // Dotted-quad is already canonical.
      return trimmed;
    }

    return IpCanonicalUtil.canonicalizeIpv6(trimmed);
  }

  // True when both values are IP literals of the same address.
  public static areSameIpAddress(a: string, b: string): boolean {
    const trimmedA: string = a.trim();
    const trimmedB: string = b.trim();

    if (!IP.isIP(trimmedA) || !IP.isIP(trimmedB)) {
      return false;
    }

    return (
      IpCanonicalUtil.canonicalize(trimmedA) ===
      IpCanonicalUtil.canonicalize(trimmedB)
    );
  }

  /*
   * The /64 network an IPv6 address is in, written as its first four groups
   * and "::/64" ("2001:db8:0:1::/64"), or null when the value is not an IPv6
   * literal. A single host is commonly given a whole /64, so a rate limit
   * counts the requests of a /64 together as well as each address's
   * (Server/Utils/ClientIp getRateLimitClient).
   *
   * An IPv4-mapped address (::ffff:192.0.2.1) is the IPv4 address it maps,
   * not an IPv6 one: null, like any IPv4 literal.
   */
  public static getIpv6Network64(value: string): string | null {
    const trimmed: string = value.trim();

    if (!IP.isIP(trimmed) || new IP(trimmed).isIPv4()) {
      return null;
    }

    const groups: Array<number> | null = IpCanonicalUtil.toIpv6Groups(trimmed);

    if (!groups || IpCanonicalUtil.isIpv4Mapped(groups)) {
      return null;
    }

    const network: string = groups
      .slice(0, 4)
      .map((group: number): string => {
        return group.toString(16);
      })
      .join(":");

    return `${network}::/64`;
  }

  /*
   * The IPv4 host an IPv6 literal stands for, dotted, for the prefixes whose
   * addresses are an IPv4 host written as IPv6:
   *
   *  - IPv4-mapped, ::ffff:0:0/96 ("::ffff:192.0.2.1" and "::ffff:c000:201"
   *    are both "192.0.2.1"), what a dual-stack socket reports for an IPv4
   *    peer;
   *  - the well-known IPv4/IPv6 translation prefix, 64:ff9b::/96 (RFC 6052),
   *    what a server reached through a stateless translator sees for an
   *    IPv4 client;
   *  - 6to4, 2002::/16 (RFC 3056): the IPv4 address of the site's router in
   *    the 32 bits after the prefix, with a whole /48 behind it;
   *  - Teredo, 2001::/32 (RFC 4380): the client's public IPv4 address, its
   *    bits inverted, in the last 32 bits. The 32 bits after the prefix name
   *    a Teredo server, which the client writes as it likes, so they are
   *    not read.
   *
   * Null for anything else. A rate limit counts such an address as the IPv4
   * host it is (Server/Utils/ClientIp getRateLimitClient). Every IPv4
   * client behind one translator shares the translator's /96, and counting
   * that as one IPv6 /64 would hold them all to one allowance. And one IPv4
   * host can send from every /64 of its 6to4 /48, or of any Teredo server it
   * names, so counting those by their /64 would hand it a fresh allowance
   * from each.
   */
  public static getEmbeddedIpv4(value: string): string | null {
    const trimmed: string = value.trim();

    if (!IP.isIP(trimmed) || new IP(trimmed).isIPv4()) {
      return null;
    }

    const groups: Array<number> | null = IpCanonicalUtil.toIpv6Groups(trimmed);

    if (!groups) {
      return null;
    }

    if (
      IpCanonicalUtil.isIpv4Mapped(groups) ||
      IpCanonicalUtil.isIpv4Translated(groups)
    ) {
      return IpCanonicalUtil.toDottedIpv4(groups[6]!, groups[7]!);
    }

    if (groups[0] === SIX_TO_FOUR_PREFIX_GROUP) {
      return IpCanonicalUtil.toDottedIpv4(groups[1]!, groups[2]!);
    }

    if (
      groups[0] === TEREDO_PREFIX_GROUPS[0] &&
      groups[1] === TEREDO_PREFIX_GROUPS[1]
    ) {
      return IpCanonicalUtil.toDottedIpv4(
        groups[6]! ^ 0xffff,
        groups[7]! ^ 0xffff,
      );
    }

    return null;
  }

  // Two 16-bit groups as a dotted IPv4 address.
  private static toDottedIpv4(high: number, low: number): string {
    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
  }

  // 64:ff9b::a.b.c.d - the well-known translation prefix, then four zero groups.
  private static isIpv4Translated(groups: Array<number>): boolean {
    return (
      groups[0] === 0x64 &&
      groups[1] === 0xff9b &&
      groups.slice(2, 6).every((group: number): boolean => {
        return group === 0;
      })
    );
  }

  // ::ffff:a.b.c.d - five zero groups, then ffff.
  private static isIpv4Mapped(groups: Array<number>): boolean {
    return (
      groups.slice(0, 5).every((group: number): boolean => {
        return group === 0;
      }) && groups[5] === 0xffff
    );
  }

  /*
   * An IPv6 literal as its 8 groups, or null when it cannot be read as one.
   * IPv4-mapped tails (::ffff:1.2.3.4) are folded into two hex groups so
   * every address reduces to the same shape.
   */
  private static toIpv6Groups(value: string): Array<number> | null {
    let input: string = value.trim().toLowerCase();

    const v4TailMatch: RegExpMatchArray | null = input.match(
      /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/,
    );

    if (v4TailMatch) {
      const octets: Array<number> = v4TailMatch.slice(1, 5).map(Number);
      const high: number = ((octets[0]! << 8) | octets[1]!) >>> 0;
      const low: number = ((octets[2]! << 8) | octets[3]!) >>> 0;
      input =
        input.substring(0, input.length - v4TailMatch[0]!.length) +
        `${high.toString(16)}:${low.toString(16)}`;
    }

    const doubleColonSplit: Array<string> = input.split("::");
    const headGroups: Array<string> = doubleColonSplit[0]
      ? doubleColonSplit[0].split(":").filter(Boolean)
      : [];
    const tailGroups: Array<string> =
      doubleColonSplit.length > 1 && doubleColonSplit[1]
        ? doubleColonSplit[1].split(":").filter(Boolean)
        : [];

    const missingGroups: number =
      doubleColonSplit.length > 1
        ? 8 - headGroups.length - tailGroups.length
        : 0;

    const groups: Array<number> = [
      ...headGroups,
      ...new Array(Math.max(0, missingGroups)).fill("0"),
      ...tailGroups,
    ].map((group: string) => {
      return parseInt(group, 16) & 0xffff;
    });

    if (groups.length !== 8 || groups.some(Number.isNaN)) {
      return null;
    }

    return groups;
  }

  private static canonicalizeIpv6(value: string): string {
    // Expand to 8 groups (toIpv6Groups).
    const groups: Array<number> | null = IpCanonicalUtil.toIpv6Groups(value);

    if (!groups) {
      // Malformed despite passing IP.isIP — return as-is rather than lie.
      return value.trim().toLowerCase();
    }

    /*
     * RFC 5952 zero compression: longest run of 2+ zero groups, leftmost
     * wins ties.
     */
    let bestStart: number = -1;
    let bestLength: number = 0;
    let runStart: number = -1;
    let runLength: number = 0;

    for (let i: number = 0; i < 8; i++) {
      if (groups[i] === 0) {
        if (runStart === -1) {
          runStart = i;
          runLength = 0;
        }
        runLength++;
        if (runLength > bestLength) {
          bestStart = runStart;
          bestLength = runLength;
        }
      } else {
        runStart = -1;
        runLength = 0;
      }
    }

    const hex: Array<string> = groups.map((group: number) => {
      return group.toString(16);
    });

    if (bestLength >= 2) {
      const head: string = hex.slice(0, bestStart).join(":");
      const tail: string = hex.slice(bestStart + bestLength).join(":");
      return `${head}::${tail}`;
    }

    return hex.join(":");
  }
}
