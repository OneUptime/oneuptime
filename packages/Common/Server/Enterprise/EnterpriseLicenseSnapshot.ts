import EnterpriseFeature from "./EnterpriseFeature";

/*
 * The seat usage of an Enterprise install, as
 * EnterpriseEdition.getSeatUsage() returns it and the /global-config/license
 * response carries it. Only the type lives in core: the arithmetic that
 * computes it belongs to the Enterprise license client
 * (ee/Server/License/EnterpriseLicenseSeats.ts).
 */
export interface SeatUsage {
  /*
   * False when the license carries no usable seat limit. Every other field is
   * still filled in — a caller that wants to display usage can, it just must
   * not block anything.
   */
  isEnforced: boolean;

  // The limit actually being enforced, or null when there is none.
  userLimit: number | null;

  /*
   * The best estimate of how many licensed seats are consumed right now,
   * across every instance on this license, counting this installation's live
   * users and the other instances' users from the last usage report.
   */
  seatsInUse: number;

  // Null when there is no limit. Never negative — a breach reads as 0 free.
  seatsRemaining: number | null;

  /*
   * The single question enforcement asks. True whenever there is no limit, so
   * a caller can use this on its own without re-checking isEnforced.
   */
  hasSeatForNewUser: boolean;

  /*
   * How many of seatsInUse are users this installation has never seen. Zero
   * whenever the topology is not known well enough to say, which is the
   * conservative answer.
   */
  seatsUsedByOtherInstances: number;
}

/*
 * Where the license stands in time. Deliberately about time only; whether the
 * token was cryptographically verified is the separate `verification` axis.
 *
 *   missing  no license token is stored and the unlicensed trial is over, in
 *            which case graceEndsAt says when it ended. With no graceEndsAt
 *            the trial start is not known (see isTrialStartUnknown).
 *   valid    the license is current
 *   grace    expired no more than the grace period
 *            (ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS) ago, OR an unlicensed
 *            Enterprise install still inside its trial
 *            (ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS from first seen). Both
 *            share this status because both entitle everything until they
 *            end; graceReason tells them apart, and graceEndsAt is the end of
 *            whichever one it is.
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
 * ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS (30): how long an expired license
 * keeps working, counted from its expiry - a verified license's signed
 * expiry, or an unverified legacy license's stored expiry column.
 *
 * ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS (14): how long an Enterprise install
 * that has no license is on trial, counted from
 * GlobalConfig.enterpriseEditionFirstSeenAt.
 *
 * Until either ends nothing changes; after it, enterprise configuration
 * becomes read-only and SSO, SCIM and audit logging stop
 * (EnterpriseEdition.isFeatureActive) until a license is activated. They are
 * defined in Common/Types so the browser copy derives the same numbers.
 */
export {
  ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS,
  ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS,
} from "../../Types/EnterpriseLicense/EnterpriseLicensePeriods";

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

  /*
   * "missing" with no graceEndsAt: no license is installed, and the start of
   * the unlicensed trial (GlobalConfig.enterpriseEditionFirstSeenAt) is not
   * known - the stamp has not been written yet (it failed, or the row does
   * not exist yet), or nothing could be read at all (createMissing). So
   * whether the install is still in its trial is unknown.
   * EnterpriseEdition.isFeatureActive treats it as an unknown license state
   * (active); the configuration checks still fail closed on it.
   */
  public static isTrialStartUnknown(
    snapshot: EnterpriseLicenseSnapshot | null,
  ): boolean {
    if (!snapshot) {
      return false;
    }

    return snapshot.status === "missing" && !snapshot.graceEndsAt;
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
