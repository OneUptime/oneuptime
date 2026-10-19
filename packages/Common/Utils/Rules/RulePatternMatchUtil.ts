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
 * The regex runs on the linear-time matcher (Utils/LinearRegExp), not on
 * JavaScript's own RegExp: the people of a project write these patterns, and
 * the alert titles, descriptions and names they read come from outside, so a
 * pattern such as (a+)+$ must not hold the server that every project shares.
 * JavaScript's syntax and answers are kept, look-arounds included; a
 * back-reference (\1) cannot run in linear time and makes the pattern one
 * this matcher refuses (see getRegexProblem).
 *
 * Pure and dependency-free (no logger, no models) so rule decisions stay
 * unit-testable.
 */

import CidrMatchUtil from "../NetworkSite/CidrMatchUtil";
import { getLinearRegExp } from "../LinearRegExp/PatternCache";
import {
  describePatternProblemReason,
  PatternProblemError,
  PatternProblemReason,
} from "../LinearRegExp/PatternProblem";

// How much of a pattern a refusal quotes: a rule's pattern column holds 500.
const MAX_QUOTED_PATTERN_LENGTH: number = 500;

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
     * which the (unanchored) regex attempt above already covers. A regular
     * expression this matcher cannot run is not read as a glob either: it
     * matches nothing.
     */
    if (RulePatternMatchUtil.isGlobPattern(trimmedPattern)) {
      return CidrMatchUtil.hostnameMatchesWildcard(value, trimmedPattern);
    }

    return false;
  }

  /*
   * True when `pattern` is a JavaScript regular expression the rule engines
   * can run: one the linear-time matcher compiles.
   */
  public static isValidRegex(pattern: string): boolean {
    if (typeof pattern !== "string") {
      return false;
    }

    try {
      getLinearRegExp(pattern, "i");
      return true;
    } catch {
      return false;
    }
  }

  /*
   * Why `pattern` cannot run as a rule's regular expression, in words for the
   * person who wrote it - "it refers back to ..." - or null when it can. Only
   * for a valid regular expression the matcher refuses (a back-reference, a
   * pattern too large): a pattern that is not a regular expression at all is
   * null here, and isValidRegex is false for it.
   */
  public static getRegexProblem(pattern: string): string | null {
    const reason: PatternProblemReason | null =
      RulePatternMatchUtil.getRegexProblemReason(pattern);

    return reason === null
      ? null
      : `it ${describePatternProblemReason(reason)}`;
  }

  // The same, as the reason itself (Utils/LinearRegExp/PatternProblem).
  public static getRegexProblemReason(
    pattern: string,
  ): PatternProblemReason | null {
    if (typeof pattern !== "string") {
      return null;
    }

    try {
      getLinearRegExp(pattern, "i");
      return null;
    } catch (error: unknown) {
      return error instanceof PatternProblemError ? error.reason : null;
    }
  }

  /*
   * The refusal a rule's save gives for a pattern that is a regular
   * expression the matcher cannot run - `Monitor Name Pattern "(a)\1"
   * cannot run: it refers back to ...` - or null for any other pattern. A
   * long pattern is quoted by its beginning only: one too large to run can
   * be megabytes.
   */
  public static getCannotRunMessage(
    title: string,
    pattern: string,
  ): string | null {
    const problem: string | null =
      RulePatternMatchUtil.getRegexProblem(pattern);

    if (problem === null) {
      return null;
    }

    const quoted: string =
      pattern.length > MAX_QUOTED_PATTERN_LENGTH
        ? `${pattern.slice(0, MAX_QUOTED_PATTERN_LENGTH)}…`
        : pattern;

    return `${title} "${quoted}" cannot run: ${problem}`;
  }

  /*
   * Whether `value` matches `pattern` as a case-insensitive regular
   * expression, in time in line with the value's length. Throws when the
   * pattern cannot run - not a regular expression (SyntaxError), or one the
   * linear-time matcher refuses - so a rule engine can say which rule.
   */
  public static testRegex(pattern: string, value: string): boolean {
    return getLinearRegExp(pattern, "i").test(value);
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
      RulePatternMatchUtil.isGlobPattern(trimmedPattern)
    );
  }

  /*
   * Whether `pattern` is read as a '*' wildcard: it carries one, and is not
   * a regular expression the matcher refuses - (\w)\1* refers back to a
   * group, and is no wildcard.
   */
  public static isGlobPattern(pattern: string): boolean {
    return (
      typeof pattern === "string" &&
      pattern.includes("*") &&
      RulePatternMatchUtil.getRegexProblemReason(pattern) === null
    );
  }

  private static matchesRegex(value: string, pattern: string): boolean {
    try {
      return RulePatternMatchUtil.testRegex(pattern, value);
    } catch {
      return false;
    }
  }
}

export default RulePatternMatchUtil;
