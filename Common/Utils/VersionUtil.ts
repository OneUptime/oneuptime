/*
 * Semantic version parsing and comparison.
 *
 * OneUptime releases are tagged on GitHub as `v11.5.13`, stored in the root
 * VERSION file as `11.5.13` and baked into images as APP_VERSION. This util
 * is the one place that knows how to turn any of those spellings into
 * something comparable, so "is this installation behind the latest release?"
 * has a single answer on the server, in the worker and in the browser.
 *
 * Every entry point is total: anything unparseable ("unknown", "", null,
 * a 5000 character string) yields null or false rather than throwing.
 */

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /*
   * The `-rc.1` part of `11.6.0-rc.1`, without the leading dash. Null for a
   * plain release. Build metadata (`+sha`) is discarded — semver says it
   * takes no part in precedence.
   */
  prerelease: string | null;
}

export interface IsUpdateAvailableData {
  currentVersion: unknown;
  latestVersion: unknown;
}

export default class VersionUtil {
  /*
   * Version strings arrive from an unauthenticated report endpoint and from
   * a third-party API, so they are length-capped before any regex runs.
   * Matches ColumnLength.ShortText, which is what they are stored in.
   */
  private static readonly maxVersionLength: number = 100;

  private static readonly versionRegex: RegExp =
    /^(\d{1,10})\.(\d{1,10})\.(\d{1,10})(?:-([0-9a-z-]+(?:\.[0-9a-z-]+)*))?(?:\+[0-9a-z-]+(?:\.[0-9a-z-]+)*)?$/i;

  private static readonly numericIdentifierRegex: RegExp = /^\d+$/;

  /*
   * Trims, caps the length and strips a leading `v` (GitHub tag names are
   * `v11.5.13`, the VERSION file is `11.5.13`). Returns "" for anything
   * that is not a string.
   */
  public static normalize(value: unknown): string {
    if (typeof value !== "string") {
      return "";
    }

    const trimmed: string = value.trim().substring(0, this.maxVersionLength);

    if (trimmed.startsWith("v") || trimmed.startsWith("V")) {
      return trimmed.substring(1);
    }

    return trimmed;
  }

  // Returns null when the value is not a full major.minor.patch version.
  public static parse(value: unknown): ParsedVersion | null {
    const normalized: string = this.normalize(value);

    if (!normalized) {
      return null;
    }

    const match: RegExpMatchArray | null = normalized.match(this.versionRegex);

    if (!match) {
      return null;
    }

    const major: number = Number.parseInt(match[1] as string, 10);
    const minor: number = Number.parseInt(match[2] as string, 10);
    const patch: number = Number.parseInt(match[3] as string, 10);

    if (
      !Number.isSafeInteger(major) ||
      !Number.isSafeInteger(minor) ||
      !Number.isSafeInteger(patch)
    ) {
      return null;
    }

    return {
      major: major,
      minor: minor,
      patch: patch,
      prerelease: match[4] ? match[4] : null,
    };
  }

  public static isValid(value: unknown): boolean {
    return this.parse(value) !== null;
  }

  /*
   * The canonical spelling of a version, rebuilt from its parts, or null if it
   * is not a version at all. Use this rather than normalize() whenever the
   * result is going to be stored: normalize() strips only ONE leading "v" and
   * parse() normalizes again, so "vv1.2.3" passes isValid() while still
   * carrying a "v" — and the UIs prefix another one when they render it.
   *
   * Build metadata is dropped, since it takes no part in precedence.
   */
  public static canonicalize(value: unknown): string | null {
    const parsed: ParsedVersion | null = this.parse(value);

    if (!parsed) {
      return null;
    }

    return `${parsed.major}.${parsed.minor}.${parsed.patch}${
      parsed.prerelease ? `-${parsed.prerelease}` : ""
    }`;
  }

  /*
   * Semver precedence for the dot-separated identifiers of a prerelease tag:
   * numeric identifiers compare numerically and rank below alphanumeric ones,
   * and when every shared identifier is equal the longer list wins
   * (1.0.0-alpha < 1.0.0-alpha.1).
   */
  private static comparePrereleaseIdentifiers(a: string, b: string): number {
    const aParts: Array<string> = a.split(".");
    const bParts: Array<string> = b.split(".");
    const length: number = Math.max(aParts.length, bParts.length);

    for (let index: number = 0; index < length; index++) {
      const aPart: string | undefined = aParts[index];
      const bPart: string | undefined = bParts[index];

      if (aPart === undefined) {
        return -1;
      }

      if (bPart === undefined) {
        return 1;
      }

      if (aPart === bPart) {
        continue;
      }

      const aIsNumeric: boolean = this.numericIdentifierRegex.test(aPart);
      const bIsNumeric: boolean = this.numericIdentifierRegex.test(bPart);

      if (aIsNumeric && bIsNumeric) {
        return Number(aPart) < Number(bPart) ? -1 : 1;
      }

      if (aIsNumeric !== bIsNumeric) {
        // Numeric identifiers always have lower precedence than alphanumeric.
        return aIsNumeric ? -1 : 1;
      }

      return aPart < bPart ? -1 : 1;
    }

    return 0;
  }

  /*
   * -1 when a is older than b, 0 when they are the same release, 1 when a is
   * newer. Null when either side cannot be parsed — callers must treat null
   * as "cannot tell", never as "equal".
   */
  public static compare(a: unknown, b: unknown): number | null {
    const parsedA: ParsedVersion | null = this.parse(a);
    const parsedB: ParsedVersion | null = this.parse(b);

    if (!parsedA || !parsedB) {
      return null;
    }

    const triples: Array<[number, number]> = [
      [parsedA.major, parsedB.major],
      [parsedA.minor, parsedB.minor],
      [parsedA.patch, parsedB.patch],
    ];

    for (const [left, right] of triples) {
      if (left !== right) {
        return left < right ? -1 : 1;
      }
    }

    if (parsedA.prerelease === parsedB.prerelease) {
      return 0;
    }

    // A release always outranks a prerelease of the same triple.
    if (!parsedA.prerelease) {
      return 1;
    }

    if (!parsedB.prerelease) {
      return -1;
    }

    return this.comparePrereleaseIdentifiers(
      parsedA.prerelease,
      parsedB.prerelease,
    );
  }

  /*
   * Whether an installation running currentVersion should be told to upgrade.
   * Deliberately conservative — it drives a banner that nags administrators,
   * so every uncertain case answers false:
   *
   *   - either version unparseable (a dev build reporting "unknown", an
   *     instance too old to report a version at all) -> false
   *   - the latest release is a prerelease -> false, stable installations are
   *     never nudged onto a release candidate
   *   - the installation is level with, or ahead of, the latest release
   *     (someone running a build off master) -> false, never suggest a
   *     downgrade
   */
  public static isUpdateAvailable(data: IsUpdateAvailableData): boolean {
    const latest: ParsedVersion | null = this.parse(data.latestVersion);

    if (!latest || latest.prerelease) {
      return false;
    }

    if (!this.parse(data.currentVersion)) {
      return false;
    }

    return this.compare(data.latestVersion, data.currentVersion) === 1;
  }

  /*
   * Whether taking the available update crosses a major version. Major
   * upgrades are the ones with breaking changes and manual migration steps —
   * OneUptime's upgrade guide requires applying them one major at a time — so
   * they are the only ones worth interrupting an administrator over.
   *
   * Implies isUpdateAvailable: false whenever there is no update to take.
   */
  public static isMajorUpgrade(data: IsUpdateAvailableData): boolean {
    if (!this.isUpdateAvailable(data)) {
      return false;
    }

    const current: ParsedVersion | null = this.parse(data.currentVersion);
    const latest: ParsedVersion | null = this.parse(data.latestVersion);

    if (!current || !latest) {
      return false;
    }

    return latest.major > current.major;
  }
}
