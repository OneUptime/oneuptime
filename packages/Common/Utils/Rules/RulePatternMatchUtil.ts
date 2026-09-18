/*
 * Matching for the free-text "pattern" criteria on automation rules (label
 * rules, owner rules).
 *
 * These fields are documented as case-insensitive regular expressions, but
 * the sibling Network Site assignment rules take '*' wildcard globs and the
 * two features sit next to each other under Network > Rules. A user who
 * typed `*0664*` into a label rule got silence: `new RegExp("*0664*")` throws
 * "Nothing to repeat", the rule engine swallowed the SyntaxError, and the
 * rule matched nothing forever (OneUptime/oneuptime#2940).
 *
 * So the pattern is tried as a regex first - existing rules keep their exact
 * semantics - and a pattern containing '*' additionally gets a wildcard glob
 * attempt. Matching is therefore a superset of the old behaviour: nothing
 * that used to match stops matching.
 *
 * Pure and dependency-free (no logger, no models) so rule decisions stay
 * unit-testable.
 */

import CidrMatchUtil from "../NetworkSite/CidrMatchUtil";

export class RulePatternMatchUtil {
  /*
   * True when `value` satisfies `pattern`. An empty/missing pattern is "no
   * criterion configured" and matches everything - callers that treat an
   * empty criterion as skippable get the same answer either way. A missing
   * value never matches a configured pattern.
   */
  public static matches(
    value: string | null | undefined,
    pattern: string | null | undefined,
  ): boolean {
    if (typeof pattern !== "string" || pattern.trim().length === 0) {
      return true;
    }

    if (typeof value !== "string" || value.length === 0) {
      return false;
    }

    const trimmedPattern: string = pattern.trim();

    if (RulePatternMatchUtil.matchesRegex(value, trimmedPattern)) {
      return true;
    }

    /*
     * Glob fallback only for patterns that actually carry a wildcard. Without
     * a '*' a glob is just a case-insensitive whole-string equality test,
     * which the (unanchored) regex attempt above already covers.
     */
    if (trimmedPattern.includes("*")) {
      return CidrMatchUtil.hostnameMatchesWildcard(value, trimmedPattern);
    }

    return false;
  }

  // True when `pattern` compiles as a JavaScript regular expression.
  public static isValidRegex(pattern: string): boolean {
    if (typeof pattern !== "string") {
      return false;
    }

    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex instanceof RegExp;
    } catch {
      return false;
    }
  }

  /*
   * A pattern this matcher can do something sensible with: either a valid
   * regex, or a glob. Anything else (`switch-(01`, `[unclosed`) is a typo
   * that can only ever match nothing - worth telling the user about instead
   * of failing silently.
   */
  public static isSupportedPattern(pattern: string): boolean {
    if (typeof pattern !== "string" || pattern.trim().length === 0) {
      return true;
    }

    const trimmedPattern: string = pattern.trim();

    return (
      RulePatternMatchUtil.isValidRegex(trimmedPattern) ||
      trimmedPattern.includes("*")
    );
  }

  private static matchesRegex(value: string, pattern: string): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      return false;
    }
  }
}

export default RulePatternMatchUtil;
