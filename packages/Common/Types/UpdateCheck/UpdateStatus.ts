import { JSONObject } from "../JSON";
import VersionUtil from "../../Utils/VersionUtil";
import SecurityAdvisoryUtil, {
  MAX_SUMMARY_LENGTH,
  SecurityAdvisorySeverity,
} from "./SecurityAdvisory";
import UpdateCheckFailure, {
  parseUpdateCheckFailure,
} from "./UpdateCheckFailure";

/*
 * Whether this installation should be upgraded, and why: the answer of
 * GET /global-config/update-status (master admins only), which the
 * Dashboard's and the Admin Dashboard's footers and the Admin Dashboard's
 * security notice draw. The server works it out from what the daily update
 * check stored and the version it runs (SecurityAdvisoryMatcher.
 * buildUpdateStatus), so it follows an upgrade the moment the new version
 * starts, and no browser ever calls GitHub.
 */

export enum UpdateState {
  /*
   * A published security advisory affects the version this installation
   * runs, and a release fixes it.
   */
  SecurityUpdate = "security-update",
  /*
   * A published security advisory affects the version this installation
   * runs, and no release fixes it yet.
   */
  SecurityAdvisory = "security-advisory",
  // A newer release is out, and no advisory affects this version.
  UpdateAvailable = "update-available",
  // The latest release, as of the last check, and no advisory affects it.
  UpToDate = "up-to-date",
  /*
   * Nothing to say: the check is off, has not answered yet, the build
   * reports no version, or this is OneUptime Cloud.
   */
  Unknown = "unknown",
}

// A published advisory that affects the running version.
export interface AffectingAdvisory {
  ghsaId: string;
  cveId: string | null;
  summary: string;
  severity: SecurityAdvisorySeverity;
  // The advisory on github.com.
  url: string | null;
  publishedAt: string | null;
  // The versions it affects, as GitHub writes them ("<= 14.0.66").
  affectedVersions: string | null;
  // The first release that fixes it for this installation, or null.
  fixedIn: string | null;
}

export interface UpdateStatus {
  state: UpdateState;
  // What this installation runs, as it reports it (APP_VERSION).
  currentVersion: string;
  // False for a build that reports no release version ("unknown", a dev build).
  isVersionComparable: boolean;
  // DISABLE_UPDATE_CHECK is set: the installation never asks GitHub.
  isUpdateCheckDisabled: boolean;
  latestVersion: string | null;
  latestVersionPublishedAt: string | null;
  isUpdateAvailable: boolean;
  // Taking the update crosses a major version (one major at a time).
  isMajorUpgrade: boolean;
  /*
   * The release to upgrade to: the latest one when no advisory affects it,
   * else the first release no known advisory affects. Null when no release
   * fixes everything yet, or there is nothing to fix.
   */
  recommendedVersion: string | null;
  // Most severe first.
  advisories: Array<AffectingAdvisory>;
  // When GitHub last answered with the latest release.
  latestVersionCheckedAt: string | null;
  // When GitHub last answered with the published advisories.
  advisoriesCheckedAt: string | null;
  // When the check last asked GitHub, answered or not.
  lastCheckAttemptedAt: string | null;
  // Why that attempt failed; null when it did not.
  lastCheckFailure: UpdateCheckFailure | null;
}

const MAX_ADVISORIES_SHOWN: number = 100;

const toStringOrNull: (value: unknown, maxLength: number) => string | null = (
  value: unknown,
  maxLength: number,
): string | null => {
  return typeof value === "string" && value && value.length <= maxLength
    ? value
    : null;
};

export default class UpdateStatusUtil {
  public static isSecurityState(state: UpdateState): boolean {
    return (
      state === UpdateState.SecurityUpdate ||
      state === UpdateState.SecurityAdvisory
    );
  }

  /*
   * Whether the footers show anything for this state: an update, or an
   * advisory. Up to date and unknown show nothing, so the footer stays as
   * it always was.
   */
  public static isShownInFooter(status: UpdateStatus | null): boolean {
    if (!status) {
      return false;
    }

    return (
      this.isSecurityState(status.state) ||
      status.state === UpdateState.UpdateAvailable
    );
  }

  public static parseState(value: unknown): UpdateState {
    return (Object.values(UpdateState) as Array<unknown>).includes(value)
      ? (value as UpdateState)
      : UpdateState.Unknown;
  }

  /*
   * The response as a browser reads it: every field checked, anything
   * missing or of the wrong kind read as "nothing to say". An advisory link
   * is only ever kept when it is on github.com.
   */
  public static fromJSON(value: unknown): UpdateStatus | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const json: JSONObject = value as JSONObject;

    const advisories: Array<AffectingAdvisory> = Array.isArray(
      json["advisories"],
    )
      ? (json["advisories"] as Array<unknown>)
          .slice(0, MAX_ADVISORIES_SHOWN)
          .map((item: unknown): AffectingAdvisory | null => {
            return this.parseAffectingAdvisory(item);
          })
          .filter(
            (item: AffectingAdvisory | null): item is AffectingAdvisory => {
              return item !== null;
            },
          )
      : [];

    let state: UpdateState = this.parseState(json["state"]);

    // A security state with no advisory to show is not one.
    if (this.isSecurityState(state) && advisories.length === 0) {
      state = UpdateState.Unknown;
    }

    return {
      state: state,
      currentVersion: toStringOrNull(json["currentVersion"], 100) || "",
      isVersionComparable: json["isVersionComparable"] === true,
      isUpdateCheckDisabled: json["isUpdateCheckDisabled"] === true,
      latestVersion: VersionUtil.canonicalize(json["latestVersion"]),
      latestVersionPublishedAt: SecurityAdvisoryUtil.parseDate(
        json["latestVersionPublishedAt"],
      ),
      isUpdateAvailable: json["isUpdateAvailable"] === true,
      isMajorUpgrade: json["isMajorUpgrade"] === true,
      recommendedVersion: VersionUtil.canonicalize(json["recommendedVersion"]),
      advisories: advisories,
      latestVersionCheckedAt: SecurityAdvisoryUtil.parseDate(
        json["latestVersionCheckedAt"],
      ),
      advisoriesCheckedAt: SecurityAdvisoryUtil.parseDate(
        json["advisoriesCheckedAt"],
      ),
      lastCheckAttemptedAt: SecurityAdvisoryUtil.parseDate(
        json["lastCheckAttemptedAt"],
      ),
      lastCheckFailure: parseUpdateCheckFailure(json["lastCheckFailure"]),
    };
  }

  public static toJSON(status: UpdateStatus): JSONObject {
    return {
      state: status.state,
      currentVersion: status.currentVersion,
      isVersionComparable: status.isVersionComparable,
      isUpdateCheckDisabled: status.isUpdateCheckDisabled,
      latestVersion: status.latestVersion,
      latestVersionPublishedAt: status.latestVersionPublishedAt,
      isUpdateAvailable: status.isUpdateAvailable,
      isMajorUpgrade: status.isMajorUpgrade,
      recommendedVersion: status.recommendedVersion,
      advisories: status.advisories.map(
        (advisory: AffectingAdvisory): JSONObject => {
          return {
            ghsaId: advisory.ghsaId,
            cveId: advisory.cveId,
            summary: advisory.summary,
            severity: advisory.severity,
            url: advisory.url,
            publishedAt: advisory.publishedAt,
            affectedVersions: advisory.affectedVersions,
            fixedIn: advisory.fixedIn,
          };
        },
      ),
      latestVersionCheckedAt: status.latestVersionCheckedAt,
      advisoriesCheckedAt: status.advisoriesCheckedAt,
      lastCheckAttemptedAt: status.lastCheckAttemptedAt,
      lastCheckFailure: status.lastCheckFailure,
    };
  }

  private static parseAffectingAdvisory(
    value: unknown,
  ): AffectingAdvisory | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const json: JSONObject = value as JSONObject;

    if (!SecurityAdvisoryUtil.isGhsaId(json["ghsaId"])) {
      return null;
    }

    const ghsaId: string = SecurityAdvisoryUtil.normalizeGhsaId(
      json["ghsaId"] as string,
    );

    return {
      ghsaId: ghsaId,
      cveId: SecurityAdvisoryUtil.parseCveId(json["cveId"]),
      summary:
        SecurityAdvisoryUtil.parseText(json["summary"], MAX_SUMMARY_LENGTH) ||
        ghsaId,
      severity: SecurityAdvisoryUtil.parseSeverity(json["severity"]),
      url: SecurityAdvisoryUtil.parseUrl(json["url"]),
      publishedAt: SecurityAdvisoryUtil.parseDate(json["publishedAt"]),
      affectedVersions: SecurityAdvisoryUtil.parseVersionText(
        json["affectedVersions"],
      ),
      fixedIn: VersionUtil.canonicalize(json["fixedIn"]),
    };
  }
}
