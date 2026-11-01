import VersionUtil from "./VersionUtil";
import VersionRangeUtil, { VersionRange } from "./VersionRange";
import SecurityAdvisoryUtil, {
  SecurityAdvisory,
  SecurityAdvisoryVulnerability,
} from "../Types/UpdateCheck/SecurityAdvisory";
import UpdateCheckFailure, {
  parseUpdateCheckFailure,
} from "../Types/UpdateCheck/UpdateCheckFailure";
import {
  AffectingAdvisory,
  UpdateState,
  UpdateStatus,
} from "../Types/UpdateCheck/UpdateStatus";

/*
 * Does a published security advisory affect the version this installation
 * runs, and which release fixes it?
 *
 * OneUptime's advisories are written by hand, so their ranges say the same
 * thing several ways (VersionRange.ts reads them). What each one means here:
 *
 *   - A range with operators ("<= 14.0.66", ">= 6.0.1, < 12.0.34") is taken
 *     at its word: the version is affected exactly when the range takes it.
 *   - A range that is one version with no operator ("10.0.23") names the
 *     version the issue was found in. Every version up to it is affected, and
 *     so is every version below the release that fixes it: "10.0.23", fixed
 *     in 10.0.34, affects 10.0.30 too.
 *   - A range that is missing, or that cannot be read ("All versions
 *     including 10.0.23"), falls back to the patched versions: below the fix
 *     is affected. With neither, nobody can tell, and an advisory nobody can
 *     place is never reported as affecting this installation.
 *
 * "Below the fix" reads the patched versions per major version: a fix listed
 * for 9.0.10 and 10.0.5 fixes 9.0.12 but not 10.0.3.
 *
 * A pre-release counts as earlier than its release, as semver orders them:
 * 14.0.67-rc.1 is affected by an advisory fixed in 14.0.67, since only the
 * release is certain to carry the fix. A version that is not a release
 * version at all ("unknown", a dev build) is affected by nothing - there is
 * nothing to compare - and the update check does not run for it.
 *
 * Pure on purpose: no I/O, so the server, the worker and the tests share one
 * answer.
 */

export interface AdvisoryVerdict {
  // true: affected; false: not affected; null: cannot tell.
  isAffected: boolean | null;
  // The first release that fixes it for this version, when affected and known.
  fixedIn: string | null;
}

export interface BuildUpdateStatusData {
  // APP_VERSION, as the server reports it.
  currentVersion: unknown;
  isUpdateCheckDisabled: boolean;
  // False on OneUptime Cloud, which is not told to upgrade itself.
  isSelfHosted: boolean;
  latestVersion: unknown;
  latestVersionPublishedAt: unknown;
  latestVersionCheckedAt: unknown;
  // GlobalConfig.securityAdvisories, as stored.
  advisories: unknown;
  advisoriesCheckedAt: unknown;
  lastCheckAttemptedAt: unknown;
  lastCheckFailure: unknown;
}

const toIsoDate: (value: unknown) => string | null = (
  value: unknown,
): string | null => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  return SecurityAdvisoryUtil.parseDate(value);
};

export default class SecurityAdvisoryMatcher {
  public static evaluateVulnerability(
    version: unknown,
    vulnerability: SecurityAdvisoryVulnerability,
  ): AdvisoryVerdict {
    if (!VersionUtil.parse(version)) {
      return { isAffected: null, fixedIn: null };
    }

    const patched: Array<string> = VersionRangeUtil.parseVersionList(
      vulnerability.patchedVersions,
    );
    const range: VersionRange | null = VersionRangeUtil.parse(
      vulnerability.vulnerableVersionRange,
    );

    let isAffected: boolean | null = null;
    let fixFromRange: string | null = null;

    if (range && !range.singleVersion) {
      isAffected = VersionRangeUtil.matches(range, version);
      fixFromRange = VersionRangeUtil.getExclusiveUpperBound(range);
    } else if (range && range.singleVersion) {
      isAffected =
        (VersionUtil.compare(version, range.singleVersion) ?? 1) <= 0 ||
        this.isBelowFix(version, patched);
    } else if (patched.length > 0) {
      isAffected = this.isBelowFix(version, patched);
    }

    if (isAffected !== true) {
      return { isAffected: isAffected, fixedIn: null };
    }

    const fixedIn: string | null =
      this.firstAbove(version, patched) ||
      (fixFromRange && (VersionUtil.compare(fixFromRange, version) ?? 0) > 0
        ? fixFromRange
        : null);

    return { isAffected: true, fixedIn: fixedIn };
  }

  /*
   * An advisory affects a version when any of its packages' ranges does. It
   * is fixed by the release that fixes every one of them, when each names
   * one.
   */
  public static evaluateAdvisory(
    version: unknown,
    advisory: SecurityAdvisory,
  ): AdvisoryVerdict {
    let isAffected: boolean | null = false;
    const fixes: Array<string | null> = [];

    for (const vulnerability of advisory.vulnerabilities) {
      const verdict: AdvisoryVerdict = this.evaluateVulnerability(
        version,
        vulnerability,
      );

      if (verdict.isAffected === true) {
        isAffected = true;
        fixes.push(verdict.fixedIn);
      } else if (verdict.isAffected === null && isAffected === false) {
        isAffected = null;
      }
    }

    if (isAffected !== true) {
      return {
        isAffected: advisory.vulnerabilities.length === 0 ? null : isAffected,
        fixedIn: null,
      };
    }

    if (
      fixes.some((fix: string | null): boolean => {
        return fix === null;
      })
    ) {
      return { isAffected: true, fixedIn: null };
    }

    const sorted: Array<string> = VersionRangeUtil.sortAscending(
      fixes as Array<string>,
    );

    return { isAffected: true, fixedIn: sorted[sorted.length - 1] || null };
  }

  public static isAffected(
    version: unknown,
    advisory: SecurityAdvisory,
  ): boolean {
    return this.evaluateAdvisory(version, advisory).isAffected === true;
  }

  // The advisories that affect the version, most severe and newest first.
  public static getAffectingAdvisories(
    version: unknown,
    advisories: Array<SecurityAdvisory>,
  ): Array<AffectingAdvisory> {
    if (!VersionUtil.parse(version)) {
      return [];
    }

    const affecting: Array<{
      advisory: SecurityAdvisory;
      fixedIn: string | null;
    }> = [];

    for (const advisory of advisories) {
      const verdict: AdvisoryVerdict = this.evaluateAdvisory(version, advisory);

      if (verdict.isAffected === true) {
        affecting.push({ advisory: advisory, fixedIn: verdict.fixedIn });
      }
    }

    affecting.sort(
      (
        a: { advisory: SecurityAdvisory },
        b: { advisory: SecurityAdvisory },
      ): number => {
        const bySeverity: number =
          SecurityAdvisoryUtil.severityRank(a.advisory.severity) -
          SecurityAdvisoryUtil.severityRank(b.advisory.severity);

        if (bySeverity !== 0) {
          return bySeverity;
        }

        const byDate: number = (b.advisory.publishedAt || "").localeCompare(
          a.advisory.publishedAt || "",
        );

        if (byDate !== 0) {
          return byDate;
        }

        return a.advisory.ghsaId.localeCompare(b.advisory.ghsaId);
      },
    );

    return affecting.map(
      (item: {
        advisory: SecurityAdvisory;
        fixedIn: string | null;
      }): AffectingAdvisory => {
        return {
          ghsaId: item.advisory.ghsaId,
          cveId: item.advisory.cveId,
          summary: item.advisory.summary,
          severity: item.advisory.severity,
          url: item.advisory.url,
          publishedAt: item.advisory.publishedAt,
          affectedVersions: this.describeAffectedVersions(
            version,
            item.advisory,
          ),
          fixedIn: item.fixedIn,
        };
      },
    );
  }

  /*
   * The release to upgrade to: the latest release when no known advisory
   * affects it, else the first release no known advisory affects (among
   * the versions the advisories name as fixes). Null when nothing affects
   * the current version, when it cannot be compared, or when no release
   * fixes everything yet.
   */
  public static getRecommendedVersion(data: {
    currentVersion: unknown;
    latestVersion: unknown;
    advisories: Array<SecurityAdvisory>;
  }): string | null {
    if (!VersionUtil.parse(data.currentVersion)) {
      return null;
    }

    const isFree: (version: string) => boolean = (version: string): boolean => {
      return data.advisories.every((advisory: SecurityAdvisory): boolean => {
        return !this.isAffected(version, advisory);
      });
    };

    if (
      data.advisories.every((advisory: SecurityAdvisory): boolean => {
        return !this.isAffected(data.currentVersion, advisory);
      })
    ) {
      return null;
    }

    const latest: string | null = VersionUtil.canonicalize(data.latestVersion);
    const isAbove: (version: string) => boolean = (
      version: string,
    ): boolean => {
      return (VersionUtil.compare(version, data.currentVersion) ?? 0) > 0;
    };

    if (latest && isAbove(latest) && isFree(latest)) {
      return latest;
    }

    const candidates: Array<string> = [];

    for (const advisory of data.advisories) {
      for (const vulnerability of advisory.vulnerabilities) {
        candidates.push(
          ...VersionRangeUtil.parseVersionList(vulnerability.patchedVersions),
        );

        const range: VersionRange | null = VersionRangeUtil.parse(
          vulnerability.vulnerableVersionRange,
        );
        const bound: string | null = range
          ? VersionRangeUtil.getExclusiveUpperBound(range)
          : null;

        if (bound) {
          candidates.push(bound);
        }
      }
    }

    const releases: Array<string> = VersionRangeUtil.sortAscending(
      Array.from(new Set<string>(candidates)),
    ).filter((version: string): boolean => {
      if (!isAbove(version)) {
        return false;
      }

      // A pre-release is never what an installation is told to move to.
      if (VersionUtil.parse(version)?.prerelease) {
        return false;
      }

      // Not released yet, as far as this installation knows.
      return !latest || (VersionUtil.compare(version, latest) ?? 1) <= 0;
    });

    return (
      releases.find((version: string): boolean => {
        return isFree(version);
      }) || null
    );
  }

  /*
   * The answer of GET /global-config/update-status, from what the daily
   * check stored and the version this installation runs now.
   */
  public static buildUpdateStatus(data: BuildUpdateStatusData): UpdateStatus {
    const currentVersion: string =
      typeof data.currentVersion === "string"
        ? data.currentVersion.substring(0, 100)
        : "";
    const isVersionComparable: boolean = VersionUtil.isValid(currentVersion);
    const isChecking: boolean =
      data.isSelfHosted && !data.isUpdateCheckDisabled;
    const latestVersion: string | null = VersionUtil.canonicalize(
      data.latestVersion,
    );

    const isUpdateAvailable: boolean =
      isChecking &&
      VersionUtil.isUpdateAvailable({
        currentVersion: currentVersion,
        latestVersion: latestVersion,
      });

    const advisories: Array<SecurityAdvisory> = isChecking
      ? SecurityAdvisoryUtil.fromJSONArray(data.advisories)
      : [];

    const affecting: Array<AffectingAdvisory> = isVersionComparable
      ? this.getAffectingAdvisories(currentVersion, advisories)
      : [];

    const recommendedVersion: string | null =
      affecting.length > 0
        ? this.getRecommendedVersion({
            currentVersion: currentVersion,
            latestVersion: latestVersion,
            advisories: advisories,
          })
        : null;

    let state: UpdateState = UpdateState.Unknown;

    if (isChecking && isVersionComparable) {
      if (affecting.length > 0) {
        state = recommendedVersion
          ? UpdateState.SecurityUpdate
          : UpdateState.SecurityAdvisory;
      } else if (isUpdateAvailable) {
        state = UpdateState.UpdateAvailable;
      } else if (latestVersion) {
        state = UpdateState.UpToDate;
      }
    }

    const lastCheckFailure: UpdateCheckFailure | null = parseUpdateCheckFailure(
      data.lastCheckFailure,
    );

    return {
      state: state,
      currentVersion: currentVersion,
      isVersionComparable: isVersionComparable,
      isUpdateCheckDisabled: data.isUpdateCheckDisabled,
      latestVersion: isChecking ? latestVersion : null,
      latestVersionPublishedAt: isChecking
        ? toIsoDate(data.latestVersionPublishedAt)
        : null,
      isUpdateAvailable: isUpdateAvailable,
      isMajorUpgrade:
        isUpdateAvailable &&
        VersionUtil.isMajorUpgrade({
          currentVersion: currentVersion,
          latestVersion: latestVersion,
        }),
      recommendedVersion: recommendedVersion,
      advisories: state === UpdateState.Unknown ? [] : affecting,
      latestVersionCheckedAt: isChecking
        ? toIsoDate(data.latestVersionCheckedAt)
        : null,
      advisoriesCheckedAt: isChecking
        ? toIsoDate(data.advisoriesCheckedAt)
        : null,
      lastCheckAttemptedAt: isChecking
        ? toIsoDate(data.lastCheckAttemptedAt)
        : null,
      lastCheckFailure: isChecking ? lastCheckFailure : null,
    };
  }

  /*
   * Below the release that fixes it on this version's line: the lowest
   * patched version of the same major when the list has one (a fix
   * backported to 9.0.10 does not fix 10.0.3), else the lowest patched
   * version.
   */
  private static isBelowFix(version: unknown, patched: Array<string>): boolean {
    if (patched.length === 0) {
      return false;
    }

    const major: number | undefined = VersionUtil.parse(version)?.major;

    const sameMajor: Array<string> = patched.filter((fix: string): boolean => {
      return VersionUtil.parse(fix)?.major === major;
    });

    const fix: string = (
      sameMajor.length > 0 ? sameMajor : patched
    )[0] as string;

    return (VersionUtil.compare(version, fix) ?? 0) < 0;
  }

  // The lowest of the (ascending) versions that is above the version.
  private static firstAbove(
    version: unknown,
    versions: Array<string>,
  ): string | null {
    return (
      versions.find((candidate: string): boolean => {
        return (VersionUtil.compare(candidate, version) ?? 0) > 0;
      }) || null
    );
  }

  // The ranges, as GitHub writes them, of the packages that affect the version.
  private static describeAffectedVersions(
    version: unknown,
    advisory: SecurityAdvisory,
  ): string | null {
    const ranges: Array<string> = [];

    for (const vulnerability of advisory.vulnerabilities) {
      if (
        this.evaluateVulnerability(version, vulnerability).isAffected ===
          true &&
        vulnerability.vulnerableVersionRange &&
        !ranges.includes(vulnerability.vulnerableVersionRange)
      ) {
        ranges.push(vulnerability.vulnerableVersionRange);
      }
    }

    return ranges.length > 0 ? ranges.join("; ") : null;
  }
}
