import EnterpriseFeature from "./EnterpriseFeature";
import type { SeatUsage } from "../../Utils/EnterpriseLicense/EnterpriseLicenseSeats";

export type { SeatUsage };

/*
 * Where the license stands in time. Deliberately about time only; whether the
 * token was cryptographically verified is the separate `verification` axis.
 *
 *   missing  no license token is stored (and the unlicensed grace, if any, is over)
 *   valid    the license is current
 *   grace    expired no more than the grace period ago, OR an unlicensed
 *            Enterprise install still inside its first-seen grace window
 *            (see graceReason)
 *   expired  expired longer ago than the grace period
 *   invalid  a token is stored but cannot be trusted: a bad signature from a
 *            trusted key, the wrong audience or issuer, bound to a different
 *            instance, or malformed
 */
export type EnterpriseLicenseStatus =
  | "missing"
  | "valid"
  | "grace"
  | "expired"
  | "invalid";

/*
 *   verified    signed by a key this build trusts; every limit comes from the
 *               signed claims
 *   unverified  a legacy HS256 token or one signed by a key this build does not
 *               know; accepted while legacy acceptance is on, with limits taken
 *               from the stored columns
 *   none        there is no token to verify
 */
export type EnterpriseLicenseVerification = "verified" | "unverified" | "none";

export type EnterpriseLicenseGraceReason = "expired" | "unlicensed";

export type EnterpriseLicenseFeatures = "all" | Array<EnterpriseFeature>;

export interface EnterpriseLicenseSnapshot {
  status: EnterpriseLicenseStatus;
  verification: EnterpriseLicenseVerification;
  graceReason?: EnterpriseLicenseGraceReason | undefined;
  companyName?: string | undefined;
  expiresAt?: Date | undefined;
  graceEndsAt?: Date | undefined;
  // Null when the license sets no seat limit.
  userLimit: number | null;
  isEvaluation: boolean;
  features: EnterpriseLicenseFeatures;
  // A human-readable explanation of the status, for logs and admin banners.
  message?: string | undefined;
}

/*
 * How long an expired license (or an unlicensed Enterprise install, counted
 * from GlobalConfig.enterpriseEditionFirstSeenAt) keeps enterprise
 * configuration writable. Security controls never depend on it.
 */
export const ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS: number = 14;

export class EnterpriseLicenseSnapshotUtil {
  /*
   * True when the license currently entitles anything at all. Grace counts:
   * the whole point of grace is that nothing changes until it ends.
   */
  public static isUsable(snapshot: EnterpriseLicenseSnapshot | null): boolean {
    if (!snapshot) {
      return false;
    }

    return snapshot.status === "valid" || snapshot.status === "grace";
  }

  public static includesFeature(
    snapshot: EnterpriseLicenseSnapshot | null,
    feature: EnterpriseFeature,
  ): boolean {
    if (!snapshot) {
      return false;
    }

    if (snapshot.features === "all") {
      return true;
    }

    if (!Array.isArray(snapshot.features)) {
      return false;
    }

    return snapshot.features.includes(feature);
  }

  // Usable AND entitled: the license half of EnterpriseEdition.isFeatureAvailable.
  public static entitles(
    snapshot: EnterpriseLicenseSnapshot | null,
    feature: EnterpriseFeature,
  ): boolean {
    return (
      EnterpriseLicenseSnapshotUtil.isUsable(snapshot) &&
      EnterpriseLicenseSnapshotUtil.includesFeature(snapshot, feature)
    );
  }

  public static createMissing(message?: string): EnterpriseLicenseSnapshot {
    return {
      status: "missing",
      verification: "none",
      userLimit: null,
      isEvaluation: false,
      features: [],
      message: message || "No OneUptime Enterprise license is installed.",
    };
  }
}
