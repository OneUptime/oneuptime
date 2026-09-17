import IP from "../Types/IP/IP";

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

  private static canonicalizeIpv6(value: string): string {
    /*
     * Expand to 8 groups. IPv4-mapped tails (::ffff:1.2.3.4) are folded
     * into two hex groups so every address reduces to the same shape.
     */
    let input: string = value.toLowerCase();

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
