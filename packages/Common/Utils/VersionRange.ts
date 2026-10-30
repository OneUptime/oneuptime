import VersionUtil, { ParsedVersion } from "./VersionUtil";

/*
 * Version ranges as GitHub writes them on a security advisory.
 *
 * A published repository advisory names, for each affected package, the
 * versions it affects (`vulnerable_version_range`) and the versions that fix
 * it (`patched_versions`). GitHub documents the range as comparators joined
 * by commas, each one an operator and a version:
 *
 *   "= 0.2.0"             that version alone
 *   "<= 1.0.8"            up to and including 1.0.8
 *   "< 0.1.11"            up to, not including, 0.1.11
 *   ">= 4.3.0, < 4.3.5"   from 4.3.0 up to, not including, 4.3.5
 *   ">= 0.0.1"            from 0.0.1 on
 *
 * OneUptime's own advisories are written by hand, and read as people type
 * them: "<=11.0.1" with no space, " < 10.0.19" with one in front, a version
 * with no operator at all ("10.0.23"), and now and then a sentence ("All
 * versions including 10.0.23"). This reads every spelling GitHub documents,
 * plus what npm writes (`||` between alternatives, a space between
 * comparators, "1.2.3 - 1.4.0", "1.x", "1.2.*", "*"), and refuses anything
 * else rather than guess: parse() answers null for a range it cannot read,
 * and the caller decides what an unreadable range means
 * (SecurityAdvisoryMatcher falls back to the patched versions).
 *
 * Versions compare as semantic versions (VersionUtil), never as text, so
 * 12.0.9 is below 12.0.10, a pre-release is below its release
 * (14.0.5-rc.1 < 14.0.5), and build metadata is ignored. A partial version
 * reads as npm reads it: "< 12.0" is "< 12.0.0" and "<= 12.0" is every
 * 12.0.x.
 *
 * Every entry point is total: anything that is not a string, an empty one,
 * or a string longer than MAX_RANGE_LENGTH yields null or [] - never a throw.
 * The length is capped before any regular expression reads the text.
 */

export enum VersionComparatorOperator {
  LessThan = "<",
  LessThanOrEqual = "<=",
  GreaterThan = ">",
  GreaterThanOrEqual = ">=",
  Equal = "=",
}

export interface VersionComparator {
  operator: VersionComparatorOperator;
  // Canonical (VersionUtil.canonicalize): "12.0.34", "13.0.0-0".
  version: string;
}

export interface VersionRange {
  /*
   * The range takes a version that satisfies every comparator of any one
   * alternative. GitHub writes one alternative; npm separates more with
   * "||". An alternative with no comparators takes every version ("*").
   */
  alternatives: Array<Array<VersionComparator>>;
  /*
   * Set when the whole range is one full version with no operator
   * ("10.0.23"): GitHub reads that as the version alone, but people write
   * the version they found the issue in, so SecurityAdvisoryMatcher reads it
   * together with the patched versions.
   */
  singleVersion: string | null;
}

// Longer than any range GitHub's advisory form takes; anything longer is not one.
export const MAX_RANGE_LENGTH: number = 256;

/*
 * The most versions read from one patched_versions value. GitHub lists one
 * per package; a handful covers backports.
 */
export const MAX_LISTED_VERSIONS: number = 20;

// A version that nothing is below: "< 0.0.0-0" takes no version at all.
const LOWEST_VERSION: string = "0.0.0-0";

const OPERATOR_TOKEN: RegExp = /^(<=|>=|=<|=>|==|<|>|=)/;

// An operator, then the spaces people put between it and its version.
const OPERATOR_AND_SPACES: RegExp = /(<=|>=|=<|=>|==|<|>|=)[ \t]+/g;

const SEPARATORS: RegExp = /[\s,]+/;

// "1.2.3 - 1.4.0": npm's hyphen range, both ends inclusive.
const HYPHEN_RANGE: RegExp = /^(\S+)\s+-\s+(\S+)$/;

/*
 * One version as a range writes it: up to three numbers or wildcards, then
 * an optional pre-release and build. Only ever run on a token of a range
 * already capped at MAX_RANGE_LENGTH.
 */
const PARTIAL_VERSION: RegExp =
  /^[vV]?(\d{1,10}|[xX*])(?:\.(\d{1,10}|[xX*]))?(?:\.(\d{1,10}|[xX*]))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/*
 * Every full version in a list of them ("12.0.34", ">= 12.0.14",
 * "9.0.10, 10.0.5"). Only ever run on a value capped at MAX_RANGE_LENGTH.
 */
const FULL_VERSION_IN_TEXT: RegExp =
  /(?:^|[^0-9A-Za-z.])[vV]?(\d{1,10}\.\d{1,10}\.\d{1,10}(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)(?![0-9A-Za-z.])/g;

interface PartialVersion {
  /*
   * How many leading numbers were written: 3 for "1.2.3", 2 for "1.2" and
   * "1.2.x", 1 for "1" and "1.x", 0 for "*".
   */
  known: 0 | 1 | 2 | 3;
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

const isWildcard: (part: string | undefined) => boolean = (
  part: string | undefined,
): boolean => {
  return part === undefined || part === "x" || part === "X" || part === "*";
};

export default class VersionRangeUtil {
  /*
   * The range a vulnerable_version_range value writes, or null when it is
   * missing, empty, too long, or says something this cannot read.
   */
  public static parse(value: unknown): VersionRange | null {
    const text: string | null = this.readText(value);

    if (text === null) {
      return null;
    }

    const alternatives: Array<Array<VersionComparator>> = [];

    for (const alternativeText of text.split("||")) {
      const alternative: Array<VersionComparator> | null =
        this.parseAlternative(alternativeText);

      if (alternative === null) {
        return null;
      }

      alternatives.push(alternative);
    }

    if (alternatives.length === 0) {
      return null;
    }

    return {
      alternatives: alternatives,
      singleVersion: this.getSingleVersion(text),
    };
  }

  // Whether the range takes this version; null when the version is not one.
  public static matches(range: VersionRange, version: unknown): boolean | null {
    if (!VersionUtil.parse(version)) {
      return null;
    }

    return range.alternatives.some(
      (alternative: Array<VersionComparator>): boolean => {
        return alternative.every((comparator: VersionComparator): boolean => {
          return this.satisfies(version, comparator);
        });
      },
    );
  }

  /*
   * Every full version a patched_versions value names, canonical, without
   * repeats, lowest first: "12.0.34" -> ["12.0.34"], ">= 12.0.14" ->
   * ["12.0.14"], "9.0.10, 10.0.5" -> ["9.0.10", "10.0.5"]. "", "none", null
   * and anything too long -> [].
   */
  public static parseVersionList(value: unknown): Array<string> {
    const text: string | null = this.readText(value);

    if (text === null) {
      return [];
    }

    const versions: Array<string> = [];

    for (const match of text.matchAll(FULL_VERSION_IN_TEXT)) {
      const canonical: string | null = VersionUtil.canonicalize(match[1]);

      if (canonical && !versions.includes(canonical)) {
        versions.push(canonical);
      }

      if (versions.length >= MAX_LISTED_VERSIONS) {
        break;
      }
    }

    return this.sortAscending(versions);
  }

  /*
   * The lowest release the range's upper bound leaves out, when the range
   * has exactly one alternative and it ends with "< X": X is then the first
   * version the advisory does not affect ("< 12.0" -> 12.0.0, "<= 12.0" ->
   * 12.1.0, as npm reads a partial version). "<= X", no upper bound, or more
   * than one alternative -> null.
   */
  public static getExclusiveUpperBound(range: VersionRange): string | null {
    if (range.alternatives.length !== 1) {
      return null;
    }

    const upperBounds: Array<VersionComparator> = (
      range.alternatives[0] as Array<VersionComparator>
    ).filter((comparator: VersionComparator): boolean => {
      return (
        comparator.operator === VersionComparatorOperator.LessThan ||
        comparator.operator === VersionComparatorOperator.LessThanOrEqual ||
        comparator.operator === VersionComparatorOperator.Equal
      );
    });

    if (upperBounds.length !== 1) {
      return null;
    }

    const upperBound: VersionComparator = upperBounds[0] as VersionComparator;

    if (upperBound.operator !== VersionComparatorOperator.LessThan) {
      return null;
    }

    const parsed: ParsedVersion | null = VersionUtil.parse(upperBound.version);

    if (!parsed) {
      return null;
    }

    /*
     * "< 13.0.0-0" is how a partial version's bound is written ("<= 12.x"),
     * so that 13.0.0's pre-releases are left out with it: the first release
     * it leaves out is 13.0.0.
     */
    if (parsed.prerelease === "0") {
      return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
    }

    return upperBound.version;
  }

  public static sortAscending(versions: Array<string>): Array<string> {
    return [...versions].sort((a: string, b: string): number => {
      return VersionUtil.compare(a, b) || 0;
    });
  }

  private static satisfies(
    version: unknown,
    comparator: VersionComparator,
  ): boolean {
    const comparison: number | null = VersionUtil.compare(
      version,
      comparator.version,
    );

    if (comparison === null) {
      return false;
    }

    switch (comparator.operator) {
      case VersionComparatorOperator.LessThan:
        return comparison < 0;
      case VersionComparatorOperator.LessThanOrEqual:
        return comparison <= 0;
      case VersionComparatorOperator.GreaterThan:
        return comparison > 0;
      case VersionComparatorOperator.GreaterThanOrEqual:
        return comparison >= 0;
      case VersionComparatorOperator.Equal:
        return comparison === 0;
      default:
        return false;
    }
  }

  // The value as text to read, or null when there is nothing to read.
  private static readText(value: unknown): string | null {
    if (typeof value !== "string") {
      return null;
    }

    if (value.length > MAX_RANGE_LENGTH) {
      return null;
    }

    const text: string = value
      .split("≤")
      .join("<=")
      .split("≥")
      .join(">=")
      .trim();

    return text ? text : null;
  }

  // "10.0.23": the whole range is one full version with no operator.
  private static getSingleVersion(text: string): string | null {
    if (OPERATOR_TOKEN.test(text) || text.includes("||")) {
      return null;
    }

    const partial: PartialVersion | null = this.parsePartialVersion(text);

    if (!partial || partial.known !== 3) {
      return null;
    }

    return this.toVersion(partial);
  }

  private static parseAlternative(
    text: string,
  ): Array<VersionComparator> | null {
    const trimmed: string = text.trim();

    if (!trimmed) {
      return null;
    }

    const hyphen: RegExpMatchArray | null = trimmed.match(HYPHEN_RANGE);

    if (hyphen) {
      return this.parseHyphenRange(hyphen[1] as string, hyphen[2] as string);
    }

    const tokens: Array<string> = trimmed
      .replace(OPERATOR_AND_SPACES, "$1")
      .split(SEPARATORS)
      .filter((token: string): boolean => {
        return token.length > 0;
      });

    if (tokens.length === 0) {
      return null;
    }

    const comparators: Array<VersionComparator> = [];

    for (const token of tokens) {
      const parsed: Array<VersionComparator> | null =
        this.parseComparatorToken(token);

      if (parsed === null) {
        return null;
      }

      comparators.push(...parsed);
    }

    return comparators;
  }

  private static parseHyphenRange(
    lowerText: string,
    upperText: string,
  ): Array<VersionComparator> | null {
    const lower: PartialVersion | null = this.parsePartialVersion(lowerText);
    const upper: PartialVersion | null = this.parsePartialVersion(upperText);

    if (!lower || !upper) {
      return null;
    }

    return [
      ...this.desugar(VersionComparatorOperator.GreaterThanOrEqual, lower),
      ...this.desugar(VersionComparatorOperator.LessThanOrEqual, upper),
    ];
  }

  private static parseComparatorToken(
    token: string,
  ): Array<VersionComparator> | null {
    const operatorMatch: RegExpMatchArray | null = token.match(OPERATOR_TOKEN);
    const operatorText: string = operatorMatch
      ? (operatorMatch[1] as string)
      : "";
    const versionText: string = token.substring(operatorText.length);

    const partial: PartialVersion | null =
      this.parsePartialVersion(versionText);

    if (!partial) {
      return null;
    }

    const operator: VersionComparatorOperator | null =
      this.toOperator(operatorText);

    if (!operator) {
      return null;
    }

    return this.desugar(operator, partial);
  }

  private static toOperator(text: string): VersionComparatorOperator | null {
    switch (text) {
      case "":
      case "=":
      case "==":
        return VersionComparatorOperator.Equal;
      case "<":
        return VersionComparatorOperator.LessThan;
      case "<=":
      case "=<":
        return VersionComparatorOperator.LessThanOrEqual;
      case ">":
        return VersionComparatorOperator.GreaterThan;
      case ">=":
      case "=>":
        return VersionComparatorOperator.GreaterThanOrEqual;
      default:
        return null;
    }
  }

  private static parsePartialVersion(text: string): PartialVersion | null {
    const match: RegExpMatchArray | null = text.match(PARTIAL_VERSION);

    if (!match) {
      return null;
    }

    const parts: Array<string | undefined> = [match[1], match[2], match[3]];
    let known: 0 | 1 | 2 | 3 = 3;

    for (let index: number = 0; index < parts.length; index++) {
      if (isWildcard(parts[index])) {
        known = index as 0 | 1 | 2;
        break;
      }
    }

    // A number after a wildcard ("1.x.3") is not a version.
    for (let index: number = known; index < parts.length; index++) {
      if (!isWildcard(parts[index])) {
        return null;
      }
    }

    const prerelease: string | null = match[4] ? (match[4] as string) : null;

    // A pre-release belongs to one release: "1.2-rc.1" is not a version.
    if (prerelease && known !== 3) {
      return null;
    }

    const numbers: Array<number> = parts.map(
      (part: string | undefined, index: number): number => {
        return index < known ? Number.parseInt(part as string, 10) : 0;
      },
    );

    if (
      !numbers.every((value: number): boolean => {
        return Number.isSafeInteger(value);
      })
    ) {
      return null;
    }

    return {
      known: known,
      major: numbers[0] as number,
      minor: numbers[1] as number,
      patch: numbers[2] as number,
      prerelease: prerelease,
    };
  }

  /*
   * A comparator on a partial version, as npm reads it (its X-ranges):
   *
   *   "1.2" / "=1.2"   >= 1.2.0, < 1.3.0-0   every 1.2.x
   *   ">=1.2"          >= 1.2.0
   *   ">1.2"           >= 1.3.0
   *   "<1.2"           < 1.2.0-0             nothing of 1.2, its pre-releases neither
   *   "<=1.2"          < 1.3.0-0
   *   "*" / ">=*"      every version
   *   "<*" / ">*"      no version
   */
  private static desugar(
    operator: VersionComparatorOperator,
    partial: PartialVersion,
  ): Array<VersionComparator> {
    if (partial.known === 3) {
      return [{ operator: operator, version: this.toVersion(partial) }];
    }

    if (partial.known === 0) {
      if (
        operator === VersionComparatorOperator.LessThan ||
        operator === VersionComparatorOperator.GreaterThan
      ) {
        return [
          {
            operator: VersionComparatorOperator.LessThan,
            version: LOWEST_VERSION,
          },
        ];
      }

      return [];
    }

    const lower: string =
      partial.known === 1
        ? `${partial.major}.0.0`
        : `${partial.major}.${partial.minor}.0`;
    const next: string =
      partial.known === 1
        ? `${partial.major + 1}.0.0`
        : `${partial.major}.${partial.minor + 1}.0`;

    switch (operator) {
      case VersionComparatorOperator.GreaterThanOrEqual:
        return [
          {
            operator: VersionComparatorOperator.GreaterThanOrEqual,
            version: lower,
          },
        ];
      case VersionComparatorOperator.GreaterThan:
        return [
          {
            operator: VersionComparatorOperator.GreaterThanOrEqual,
            version: next,
          },
        ];
      case VersionComparatorOperator.LessThan:
        return [
          {
            operator: VersionComparatorOperator.LessThan,
            version: `${lower}-0`,
          },
        ];
      case VersionComparatorOperator.LessThanOrEqual:
        return [
          {
            operator: VersionComparatorOperator.LessThan,
            version: `${next}-0`,
          },
        ];
      default:
        return [
          {
            operator: VersionComparatorOperator.GreaterThanOrEqual,
            version: lower,
          },
          {
            operator: VersionComparatorOperator.LessThan,
            version: `${next}-0`,
          },
        ];
    }
  }

  private static toVersion(partial: PartialVersion): string {
    return `${partial.major}.${partial.minor}.${partial.patch}${
      partial.prerelease ? `-${partial.prerelease}` : ""
    }`;
  }
}
