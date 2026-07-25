/*
 * Matching helpers for NetworkSite auto-assignment rules: IPv4 CIDR
 * containment, case-insensitive '*' wildcard hostname patterns, and the
 * highest-priority-wins rule picker. Pure and dependency-free so the rule
 * engine's decisions are unit-testable.
 */

// The shape NetworkSiteAssignmentRule rows are matched with.
export interface AssignmentRuleCandidate {
  subnetCidr?: string | null | undefined;
  hostnamePattern?: string | null | undefined;
  priority?: number | null | undefined;
  createdAt?: Date | null | undefined;
}

// The device attributes a rule is evaluated against.
export interface RuleMatchTarget {
  ip?: string | null | undefined;
  hostname?: string | null | undefined;
  sysName?: string | null | undefined;
}

export class CidrMatchUtil {
  /*
   * Longest hostname pattern we will evaluate. The column itself is
   * ShortText (100), and a DNS name tops out at 253 characters, so anything
   * longer is either a mistake or an attempt to make matching expensive.
   */
  public static readonly MAX_HOSTNAME_PATTERN_LENGTH: number = 253;

  /*
   * Hoisted out of the call sites so the literals are not the object of a
   * member expression, which `wrap-regex` and Prettier cannot agree on.
   */
  private static readonly PREFIX_LENGTH_PATTERN: RegExp = /^\d{1,2}$/;

  private static readonly OCTET_PATTERN: RegExp = /^\d{1,3}$/;

  /*
   * True when the IPv4 address `ip` falls inside `cidr` ('10.0.0.0/8').
   * Prefixes /0 through /32 are supported; a bare address is treated as /32.
   * Any invalid input returns false instead of throwing.
   */
  public static ipInCidr(ip: string, cidr: string): boolean {
    const ipValue: number | null = CidrMatchUtil.parseIpv4(ip);
    if (ipValue === null) {
      return false;
    }

    if (typeof cidr !== "string" || cidr.trim().length === 0) {
      return false;
    }

    const parts: Array<string> = cidr.trim().split("/");
    if (parts.length > 2) {
      return false;
    }

    const baseValue: number | null = CidrMatchUtil.parseIpv4(parts[0] || "");
    if (baseValue === null) {
      return false;
    }

    let prefixLength: number = 32;
    if (parts.length === 2) {
      const prefixText: string = parts[1] || "";
      if (!CidrMatchUtil.PREFIX_LENGTH_PATTERN.test(prefixText)) {
        return false;
      }
      prefixLength = parseInt(prefixText, 10);
      if (prefixLength < 0 || prefixLength > 32) {
        return false;
      }
    }

    /*
     * JS bitwise ops are 32-bit signed; >>> 0 keeps the mask and the masked
     * addresses unsigned. A shift by 32 is a no-op in JS, so /0 is special
     * cased to the all-zero mask (matches everything).
     */
    const mask: number =
      prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;

    return (ipValue & mask) >>> 0 === (baseValue & mask) >>> 0;
  }

  // True when `cidr` is a well-formed IPv4 CIDR (or bare address == /32).
  public static isValidCidr(cidr: string): boolean {
    if (typeof cidr !== "string" || cidr.trim().length === 0) {
      return false;
    }
    const parts: Array<string> = cidr.trim().split("/");
    if (parts.length > 2) {
      return false;
    }
    if (CidrMatchUtil.parseIpv4(parts[0] || "") === null) {
      return false;
    }
    if (parts.length === 2) {
      const prefixText: string = parts[1] || "";
      if (!CidrMatchUtil.PREFIX_LENGTH_PATTERN.test(prefixText)) {
        return false;
      }
      const prefixLength: number = parseInt(prefixText, 10);
      if (prefixLength < 0 || prefixLength > 32) {
        return false;
      }
    }
    return true;
  }

  /*
   * Case-insensitive wildcard match where '*' matches any run of characters
   * (including none) and every other character is literal. The pattern must
   * cover the whole hostname. Non-string or missing inputs never match, and
   * so does an over-long pattern.
   *
   * Deliberately NOT a regex: compiling a user-authored pattern into
   * /^.*a.*a.*a...$/ makes the backtracking engine explore an exponential
   * number of split points on a long homogeneous input, which blocks the
   * event loop for minutes. This matcher is O(hostname x pattern) worst case
   * with no recursion, so a hostile rule cannot hang the process.
   */
  public static hostnameMatchesWildcard(
    hostname: string,
    pattern: string,
  ): boolean {
    if (typeof hostname !== "string" || typeof pattern !== "string") {
      return false;
    }

    const text: string = hostname.trim().toLowerCase();
    const glob: string = pattern.trim().toLowerCase();

    if (glob.length > CidrMatchUtil.MAX_HOSTNAME_PATTERN_LENGTH) {
      return false;
    }

    /*
     * Greedy two-pointer glob match. On a mismatch we rewind only to the
     * most recent '*' and advance the character it consumed by one, so each
     * character of the hostname is revisited at most once per '*'.
     */
    let textIndex: number = 0;
    let globIndex: number = 0;
    let lastStarIndex: number = -1;
    let textIndexAtLastStar: number = 0;

    while (textIndex < text.length) {
      if (globIndex < glob.length && glob[globIndex] === "*") {
        lastStarIndex = globIndex;
        textIndexAtLastStar = textIndex;
        globIndex++;
      } else if (
        globIndex < glob.length &&
        glob[globIndex] === text[textIndex]
      ) {
        globIndex++;
        textIndex++;
      } else if (lastStarIndex !== -1) {
        globIndex = lastStarIndex + 1;
        textIndexAtLastStar++;
        textIndex = textIndexAtLastStar;
      } else {
        return false;
      }
    }

    // Any trailing '*' in the pattern can still match the empty remainder.
    while (globIndex < glob.length && glob[globIndex] === "*") {
      globIndex++;
    }

    return globIndex === glob.length;
  }

  /*
   * True when the rule's populated criteria all match the target. A CIDR
   * criterion matches the target's ip; a hostname pattern matches either the
   * hostname or the SNMP sysName. A rule with no criteria never matches.
   */
  public static ruleMatches(
    rule: AssignmentRuleCandidate,
    target: RuleMatchTarget,
  ): boolean {
    const hasCidr: boolean = Boolean(
      rule.subnetCidr && rule.subnetCidr.trim().length > 0,
    );
    const hasPattern: boolean = Boolean(
      rule.hostnamePattern && rule.hostnamePattern.trim().length > 0,
    );

    if (!hasCidr && !hasPattern) {
      return false;
    }

    if (hasCidr) {
      if (!target.ip || !CidrMatchUtil.ipInCidr(target.ip, rule.subnetCidr!)) {
        return false;
      }
    }

    if (hasPattern) {
      const matchesHostname: boolean = Boolean(
        target.hostname &&
          CidrMatchUtil.hostnameMatchesWildcard(
            target.hostname,
            rule.hostnamePattern!,
          ),
      );
      const matchesSysName: boolean = Boolean(
        target.sysName &&
          CidrMatchUtil.hostnameMatchesWildcard(
            target.sysName,
            rule.hostnamePattern!,
          ),
      );
      if (!matchesHostname && !matchesSysName) {
        return false;
      }
    }

    return true;
  }

  /*
   * Picks the winning rule for a target: among matching rules the highest
   * priority number wins; ties go to the earlier createdAt when both rows
   * carry one, otherwise the earlier rule in the input order (stable).
   * Returns null when nothing matches.
   */
  public static pickRule<T extends AssignmentRuleCandidate>(
    rules: Array<T>,
    target: RuleMatchTarget,
  ): T | null {
    let best: T | null = null;

    for (const rule of rules) {
      if (!CidrMatchUtil.ruleMatches(rule, target)) {
        continue;
      }

      if (!best) {
        best = rule;
        continue;
      }

      const bestPriority: number = best.priority || 0;
      const rulePriority: number = rule.priority || 0;

      if (rulePriority > bestPriority) {
        best = rule;
        continue;
      }

      if (
        rulePriority === bestPriority &&
        rule.createdAt &&
        best.createdAt &&
        rule.createdAt.getTime() < best.createdAt.getTime()
      ) {
        best = rule;
      }
    }

    return best;
  }

  // '10.0.0.1' -> unsigned 32-bit value; anything malformed -> null.
  private static parseIpv4(ip: string): number | null {
    if (typeof ip !== "string") {
      return null;
    }

    const octets: Array<string> = ip.trim().split(".");
    if (octets.length !== 4) {
      return null;
    }

    let value: number = 0;
    for (const octetText of octets) {
      if (!CidrMatchUtil.OCTET_PATTERN.test(octetText)) {
        return null;
      }
      const octet: number = parseInt(octetText, 10);
      if (octet > 255) {
        return null;
      }
      value = (value * 256 + octet) >>> 0;
    }

    return value;
  }
}

export default CidrMatchUtil;
