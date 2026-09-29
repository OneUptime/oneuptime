/*
 * Scan-target parsing for network device discovery.
 *
 * A discovery scan's target is the IPv4 address space a probe sweeps. Two
 * notations are accepted:
 *
 *   CIDR         192.168.1.0/24
 *   Octet range  10.16-22.0-255.51-66
 *
 * Octet-range notation exists because real networks are not shaped like CIDR
 * blocks. "The .51-.66 management addresses in every /24 of 10.16-22.x" is a
 * single target here; expressed in CIDR it is 1,792 separate scans, and the
 * only CIDR that covers it in one go (10.16.0.0/13) is 512k addresses, of
 * which 98% are not worth probing.
 *
 * This lives in Common rather than in the Probe's SubnetScanner so the server
 * can validate a target at write time with exactly the parser the probe will
 * later expand it with. A target that saves is a target that scans.
 *
 * IPv4-only by design, same as the sweep itself: IPv6 space is far too sparse
 * to enumerate, and IPv6 discovery will be neighbour-discovery based.
 */

// Which of the two notations a target string is written in.
export enum ScanTargetNotation {
  Cidr = "CIDR",
  OctetRange = "OctetRange",
}

// One octet's accepted values: `start` through `end`, both inclusive.
export interface OctetRange {
  start: number;
  end: number;
}

export interface ScanTarget {
  notation: ScanTargetNotation;
  /*
   * How many addresses the target expands to. Always derived arithmetically
   * (prefix length / range widths) and never by building the address list, so
   * an absurd target can be rejected before anything is allocated.
   */
  hostCount: number;
  // Populated for ScanTargetNotation.OctetRange. Always exactly 4 entries.
  octetRanges?: Array<OctetRange> | undefined;
  // Populated for ScanTargetNotation.Cidr.
  networkLong?: number | undefined;
  blockSize?: number | undefined;
}

interface ParseOutcome {
  target?: ScanTarget | undefined;
  /*
   * Human-readable, shown to the operator who typed the target. Never null when
   * `target` is absent.
   */
  error?: string | undefined;
}

export class ScanTargetUtil {
  /*
   * Hard ceiling on how many addresses one scan may sweep.
   *
   * The number is a wall-clock budget, not a memory one. SubnetScanner runs 32
   * workers; a dead host costs ~1s (the ICMP pre-sweep timeout), or ~2s when
   * every host is SNMP-probed directly. At this ceiling that is ~17 minutes
   * for a sweep the ICMP gate resolves, ~34 minutes when the pre-sweep is
   * unavailable, and ~51 minutes in the worst case — an ICMP pass that finds
   * no SNMP responder, so every address is re-probed over SNMP as well (see
   * the ICMP-filtered fallback in SubnetScanner.scan). All three sit inside
   * the 2-hour window after which the server declares an In Progress scan
   * abandoned (Workers/Jobs/NetworkDeviceDiscovery/RequeueRecurringScans.ts)
   * and above the 15-minute minimum rescan interval for recurring scans.
   *
   * It is also still a real abuse guard: a /17 in CIDR terms. Anything larger
   * (a /16 sweep, an unbounded 10.*.*.* octet range) is rejected at write time
   * with a message telling the operator to narrow the target.
   */
  public static readonly MAX_SCAN_HOSTS: number = 32768;

  /*
   * Longest string we will even attempt to parse. The widest well-formed
   * target is "255-255.255-255.255-255.255-255" at 31 characters, so this is
   * ~2x headroom and still far below the 100-character column. It exists to
   * bound the error messages, which quote the target back — see the gate in
   * parseWithError().
   */
  public static readonly MAX_TARGET_LENGTH: number = 64;

  /*
   * Hoisted so the literals are not the object of a member expression, which
   * `wrap-regex` and Prettier cannot agree on. Same reason as CidrMatchUtil.
   */
  private static readonly CIDR_PATTERN: RegExp =
    /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,3})$/;

  // A single octet term: `42` or `16-22`. Bounds are validated after parsing.
  private static readonly OCTET_TERM_PATTERN: RegExp =
    /^(\d{1,3})(?:-(\d{1,3}))?$/;

  // One octet of a bare address. Bounds are validated after parsing.
  private static readonly IP_OCTET_PATTERN: RegExp = /^\d{1,3}$/;

  private static readonly EXAMPLE_CIDR: string = "192.168.1.0/24";

  private static readonly EXAMPLE_OCTET_RANGE: string = "10.16-22.0-255.51-66";

  /*
   * Parses a target into the shape needed to count and expand it. Returns null
   * for anything malformed; use getValidationError() when you need to tell the
   * operator WHY. Size is deliberately not checked here — parse() answers "is
   * this well-formed", the caller decides what it can afford to sweep.
   */
  public static parse(target: string): ScanTarget | null {
    return ScanTargetUtil.parseWithError(target).target || null;
  }

  // True when `target` is well-formed in either notation. Ignores size.
  public static isValid(target: string): boolean {
    return ScanTargetUtil.parse(target) !== null;
  }

  /*
   * The notation `target` is written in, or null when it is not a valid target
   * at all. A string containing '/' is always read as CIDR — a malformed CIDR
   * is never silently retried as an octet range, because "10.0.0.0/99" is a
   * typo'd prefix and deserves to say so.
   */
  public static getNotation(target: string): ScanTargetNotation | null {
    return ScanTargetUtil.parse(target)?.notation || null;
  }

  /*
   * How many addresses `target` sweeps, or 0 when it is malformed. Computed
   * from the prefix length / range widths alone, with no allocation: expand()
   * materializes one string per address, so a size check that ran after
   * expansion would let a /8 allocate ~16M strings before the limit it exists
   * to enforce was ever consulted.
   */
  public static countHosts(target: string): number {
    return ScanTargetUtil.parse(target)?.hostCount || 0;
  }

  /*
   * The single validation entry point for a scan target: syntax first, then
   * the size ceiling. Returns null when the target is good to scan, otherwise
   * a message written for the operator who typed it.
   */
  public static getValidationError(target: string): string | null {
    const outcome: ParseOutcome = ScanTargetUtil.parseWithError(target);

    if (!outcome.target) {
      return outcome.error || ScanTargetUtil.getMalformedTargetMessage(target);
    }

    if (outcome.target.hostCount > ScanTargetUtil.MAX_SCAN_HOSTS) {
      return (
        `"${String(target).trim()}" expands to ` +
        `${outcome.target.hostCount.toLocaleString("en-US")} addresses, ` +
        `exceeding the ${ScanTargetUtil.MAX_SCAN_HOSTS.toLocaleString("en-US")}-address scan limit. ` +
        `Narrow the target (a smaller subnet, or tighter octet ranges) or split it into several scans.`
      );
    }

    return null;
  }

  /*
   * Expands a target into the addresses to probe, in ascending address order.
   *
   * Returns an empty array for a malformed target — there is nothing to sweep.
   * THROWS for a well-formed target above MAX_SCAN_HOSTS: that is a caller
   * that skipped its size check, and quietly returning a truncated or empty
   * list would turn it into a silently wrong scan. Callers should gate on
   * getValidationError() (or countHosts()) first and never see this.
   */
  public static expand(target: string): Array<string> {
    const parsed: ScanTarget | null = ScanTargetUtil.parse(target);

    if (!parsed) {
      return [];
    }

    if (parsed.hostCount > ScanTargetUtil.MAX_SCAN_HOSTS) {
      throw new Error(
        ScanTargetUtil.getValidationError(target) ||
          `Scan target "${String(target).trim()}" is too large to expand.`,
      );
    }

    if (parsed.notation === ScanTargetNotation.Cidr) {
      return ScanTargetUtil.expandCidrTarget(parsed);
    }

    return ScanTargetUtil.expandOctetRangeTarget(parsed);
  }

  /*
   * True when `ip` falls inside `target`, in either notation. This is the
   * matcher behind the auto-import rules' "Host IP is in" condition, sharing
   * the exact parser scan targets are validated and expanded with — so a
   * condition that saves is a condition that matches what its scan sweeps.
   *
   * Containment, not enumeration: a CIDR block is a mask comparison over the
   * whole block (network and broadcast addresses INCLUDED — a rule asking
   * "is this address in 10.0.0.0/24" means the subnet, not the sweep list),
   * and an octet range is per-octet interval membership. The latter is NOT a
   * single numeric interval: for `10.16-22.0-255.51-66`, the address
   * 10.17.5.10 sits between the range's lowest and highest addresses but its
   * fourth octet is outside 51-66, so it does not match.
   *
   * Malformed targets and malformed addresses match nothing.
   */
  public static contains(target: string, ip: string): boolean {
    const parsed: ScanTarget | null = ScanTargetUtil.parse(target);

    if (!parsed) {
      return false;
    }

    const octets: Array<number> | null = ScanTargetUtil.parseIpOctets(ip);

    if (!octets) {
      return false;
    }

    if (parsed.notation === ScanTargetNotation.Cidr) {
      const ipLong: number =
        (((octets[0]! * 256 + octets[1]!) * 256 + octets[2]!) * 256 +
          octets[3]!) >>>
        0;

      return (
        ipLong >= parsed.networkLong! &&
        ipLong < parsed.networkLong! + parsed.blockSize!
      );
    }

    return parsed.octetRanges!.every(
      (range: OctetRange, index: number): boolean => {
        return octets[index]! >= range.start && octets[index]! <= range.end;
      },
    );
  }

  /*
   * Both notations in one sentence, for form hints and error messages. Kept
   * here so the UI, the server-side validator and the probe all describe the
   * accepted syntax identically.
   */
  public static getSyntaxHint(): string {
    return (
      `Use CIDR notation (e.g. ${ScanTargetUtil.EXAMPLE_CIDR}) or octet-range notation, ` +
      `where any octet may be an inclusive low-high range (e.g. ${ScanTargetUtil.EXAMPLE_OCTET_RANGE}).`
    );
  }

  private static parseWithError(target: string): ParseOutcome {
    if (typeof target !== "string" || target.trim().length === 0) {
      return {
        error: `A scan target is required. ${ScanTargetUtil.getSyntaxHint()}`,
      };
    }

    const trimmed: string = target.trim();

    /*
     * Length gate BEFORE anything builds a message. Every rejection below
     * quotes the offending target back (parseOctetRange quotes both the bad
     * term AND the whole target, doubling it), and the server-side create
     * hook runs ahead of the column's 100-character cap — so without this,
     * a 50 MB request body would be reflected into a ~100 MB exception that
     * is both logged and serialized into the response. This message is a
     * constant and echoes nothing.
     */
    if (trimmed.length > ScanTargetUtil.MAX_TARGET_LENGTH) {
      return {
        error:
          `A scan target cannot be longer than ${ScanTargetUtil.MAX_TARGET_LENGTH} characters. ` +
          ScanTargetUtil.getSyntaxHint(),
      };
    }

    /*
     * The '/' is the discriminator, checked before either parser runs. A
     * string carrying a prefix is a CIDR attempt by intent, so "10.0.0.0/99"
     * must report a bad prefix rather than fall through to the octet-range
     * parser and report the far more confusing "not a valid scan target".
     */
    if (trimmed.includes("/")) {
      return ScanTargetUtil.parseCidr(trimmed);
    }

    return ScanTargetUtil.parseOctetRange(trimmed);
  }

  private static parseCidr(trimmed: string): ParseOutcome {
    const match: RegExpMatchArray | null = trimmed.match(
      ScanTargetUtil.CIDR_PATTERN,
    );

    if (!match) {
      return {
        error:
          `"${trimmed}" is not a valid IPv4 CIDR. ` +
          `Expected four octets and a prefix length, e.g. ${ScanTargetUtil.EXAMPLE_CIDR}.`,
      };
    }

    let baseLong: number = 0;
    for (let i: number = 1; i <= 4; i++) {
      const octet: number = parseInt(match[i]!, 10);
      if (octet > 255) {
        return {
          error:
            `Octet "${match[i]}" in "${trimmed}" is out of range. ` +
            `Each octet must be between 0 and 255.`,
        };
      }
      baseLong = baseLong * 256 + octet;
    }

    const prefix: number = parseInt(match[5]!, 10);
    if (prefix > 32) {
      return {
        error:
          `Prefix length "/${match[5]}" in "${trimmed}" is out of range. ` +
          `An IPv4 prefix must be between /0 and /32.`,
      };
    }

    const hostBits: number = 32 - prefix;
    const blockSize: number = Math.pow(2, hostBits);

    /*
     * Shifting by 32 is a no-op in JS (the shift count is taken mod 32), so a
     * /0 would mask with 0xffffffff and "expand" from the address as typed
     * rather than from 0.0.0.0. Special-cased rather than relied upon.
     */
    const mask: number = hostBits >= 32 ? 0 : (0xffffffff << hostBits) >>> 0;
    const networkLong: number = (baseLong & mask) >>> 0;

    return {
      target: {
        notation: ScanTargetNotation.Cidr,
        /*
         * /31 and /32 have no network/broadcast addresses to exclude (RFC
         * 3021), so every address in them is a host. Larger blocks drop the
         * first and last.
         */
        hostCount: blockSize <= 2 ? blockSize : blockSize - 2,
        networkLong: networkLong,
        blockSize: blockSize,
      },
    };
  }

  private static parseOctetRange(trimmed: string): ParseOutcome {
    const terms: Array<string> = trimmed.split(".");

    if (terms.length !== 4) {
      return { error: ScanTargetUtil.getMalformedTargetMessage(trimmed) };
    }

    const octetRanges: Array<OctetRange> = [];
    let hostCount: number = 1;

    for (const term of terms) {
      const match: RegExpMatchArray | null = term.match(
        ScanTargetUtil.OCTET_TERM_PATTERN,
      );

      if (!match) {
        return {
          error:
            `"${term}" in "${trimmed}" is not a valid octet. ` +
            `Each octet must be a number (42) or an inclusive range (16-22).`,
        };
      }

      const start: number = parseInt(match[1]!, 10);
      // No '-' in the term means a single value: a zero-width range.
      const end: number =
        match[2] === undefined ? start : parseInt(match[2], 10);

      if (start > 255 || end > 255) {
        return {
          error:
            `Octet "${term}" in "${trimmed}" is out of range. ` +
            `Each octet must be between 0 and 255.`,
        };
      }

      /*
       * Reversed bounds are a typo, not an empty set. Silently accepting
       * "22-16" as zero addresses would produce a scan that sweeps nothing
       * and reports success — the least debuggable outcome available.
       */
      if (start > end) {
        return {
          error:
            `Octet range "${term}" in "${trimmed}" is reversed. ` +
            `Write the lower bound first, e.g. ${end}-${start}.`,
        };
      }

      octetRanges.push({ start: start, end: end });
      hostCount = hostCount * (end - start + 1);
    }

    return {
      target: {
        notation: ScanTargetNotation.OctetRange,
        /*
         * Every address in the product is swept, with no network/broadcast
         * exclusion. An octet range is an explicit enumeration, not a subnet:
         * whoever wrote "10.0.0.0-255" asked for .0 and .255 by name, and
         * there is no prefix length here from which a broadcast address could
         * even be derived.
         */
        hostCount: hostCount,
        octetRanges: octetRanges,
      },
    };
  }

  private static expandCidrTarget(parsed: ScanTarget): Array<string> {
    const networkLong: number = parsed.networkLong!;
    const blockSize: number = parsed.blockSize!;
    const hosts: Array<string> = [];

    if (blockSize <= 2) {
      // /31 and /32: every address is usable.
      for (let i: number = 0; i < blockSize; i++) {
        hosts.push(ScanTargetUtil.longToIp(networkLong + i));
      }
      return hosts;
    }

    // Skip network (first) and broadcast (last).
    for (let i: number = 1; i < blockSize - 1; i++) {
      hosts.push(ScanTargetUtil.longToIp(networkLong + i));
    }
    return hosts;
  }

  private static expandOctetRangeTarget(parsed: ScanTarget): Array<string> {
    const ranges: Array<OctetRange> = parsed.octetRanges!;
    const hosts: Array<string> = [];

    // Outer-to-inner octet order, so the result comes out address-ascending.
    for (let a: number = ranges[0]!.start; a <= ranges[0]!.end; a++) {
      for (let b: number = ranges[1]!.start; b <= ranges[1]!.end; b++) {
        for (let c: number = ranges[2]!.start; c <= ranges[2]!.end; c++) {
          for (let d: number = ranges[3]!.start; d <= ranges[3]!.end; d++) {
            hosts.push(`${a}.${b}.${c}.${d}`);
          }
        }
      }
    }

    return hosts;
  }

  // '10.0.0.1' -> [10, 0, 0, 1]; anything malformed -> null.
  private static parseIpOctets(ip: string): Array<number> | null {
    if (typeof ip !== "string") {
      return null;
    }

    const terms: Array<string> = ip.trim().split(".");

    if (terms.length !== 4) {
      return null;
    }

    const octets: Array<number> = [];

    for (const term of terms) {
      if (!ScanTargetUtil.IP_OCTET_PATTERN.test(term)) {
        return null;
      }

      const octet: number = parseInt(term, 10);

      if (octet > 255) {
        return null;
      }

      octets.push(octet);
    }

    return octets;
  }

  private static getMalformedTargetMessage(target: string): string {
    const shown: string =
      typeof target === "string" ? target.trim() : String(target);

    return (
      `"${shown}" is not a valid scan target. ` + ScanTargetUtil.getSyntaxHint()
    );
  }

  private static longToIp(long: number): string {
    return (
      ((long >>> 24) & 0xff) +
      "." +
      ((long >>> 16) & 0xff) +
      "." +
      ((long >>> 8) & 0xff) +
      "." +
      (long & 0xff)
    );
  }
}

export default ScanTargetUtil;
