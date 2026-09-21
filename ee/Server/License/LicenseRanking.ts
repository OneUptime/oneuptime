import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import {
  EnterpriseLicenseSnapshot,
  EnterpriseLicenseSnapshotUtil,
  EnterpriseLicenseStatus,
  EnterpriseLicenseVerification,
} from "Common/Server/Enterprise/EnterpriseLicenseSnapshot";
import PartialEntity from "Common/Types/Database/PartialEntity";
import LicenseInputsUtil, {
  LICENSE_TERM_COLUMNS,
  LicenseInputs,
} from "./LicenseInputs";
import { LicenseTokenClassification } from "./LicenseToken";

/*
 * The never-downgrade rule.
 *
 * The daily report and the refresh button store whatever license the license
 * server sends back. That used to include a token nobody had checked, so one
 * misconfigured license server (a key paired with the wrong kid, a signing
 * fallback, a token for another instance) could replace a working license on
 * every installation within a day. Now a returned license replaces the stored
 * one only when it classifies at least as well:
 *
 *   status first:        valid > grace > expired > missing > invalid
 *   then verification:   verified > unverified > none
 *   then, while BOTH sides are usable, the date entitlement actually ends on:
 *                        later > earlier
 *
 * Status comes first because it is what the product acts on: a current legacy
 * license beats a verified one that has already expired. Verification comes
 * next, ahead of the date, so that replacing a legacy token with the signed
 * one oneuptime.com issues for the same license always lands whatever the two
 * dates say: that upgrade is the point of the signing rollout, and the stored
 * expiry column of a legacy license is the least trustworthy date here - it is
 * whatever the last sync happened to write. Equal ranks are accepted - that is
 * how a renewal lands.
 *
 * Why the date is compared at all, when this rule deliberately never did.
 *
 * It never needed to. Every status was a proxy for the date: a license that
 * lapses sooner lapses into a worse status sooner, so "at least as good a
 * status" was "at least as much entitlement", and comparing dates as well
 * would only have refused renewals that shorten a term the customer agreed to.
 *
 * A token with NO recorded expiry broke that proxy. It classifies as the
 * unlicensed trial (LicenseToken's classifyUnverifiedWithoutExpiry), whose
 * grace ends at first run + trialDays - a date about this INSTALLATION, not
 * about the license. Two licenses can now both be "grace (unverified)" while
 * one entitles the install for another month and the other for two more days,
 * and accepting that tie shortens what the customer paid for. So on an
 * otherwise equal rank, and only while both sides are usable (there is
 * entitlement left to compare at all), whichever lapses later wins.
 *
 * The date compared is the one the install actually stops on: graceEndsAt when
 * there is one (an expired license's grace period, or the trial), else
 * expiresAt. If either side has no date the ranks stay equal, exactly as
 * before - there is nothing to compare, and refusing on ignorance would be the
 * downgrade this rule exists to prevent.
 */

const STATUS_RANK: Record<EnterpriseLicenseStatus, number> = {
  valid: 4,
  grace: 3,
  expired: 2,
  missing: 1,
  invalid: 0,
};

const VERIFICATION_RANK: Record<EnterpriseLicenseVerification, number> = {
  verified: 2,
  unverified: 1,
  none: 0,
};

/*
 * The moment a usable license stops entitling the installation: the end of an
 * expired license's grace period or of an unlicensed install's trial when
 * there is one, else the expiry itself. Null when the snapshot carries
 * neither, which is every snapshot built by hand (and the Community Edition's).
 */
const effectiveEndsAt: (snapshot: EnterpriseLicenseSnapshot) => Date | null = (
  snapshot: EnterpriseLicenseSnapshot,
): Date | null => {
  const end: Date | undefined = snapshot.graceEndsAt || snapshot.expiresAt;

  return end instanceof Date && !Number.isNaN(end.getTime()) ? end : null;
};

export interface LicenseDowngrade {
  current: LicenseTokenClassification;
  candidate: LicenseTokenClassification;
}

export interface GuardedLicenseUpdate {
  // What is safe to write: `update` minus the license terms when they were refused.
  update: PartialEntity<GlobalConfig>;
  // Set when the returned license was refused.
  downgrade: LicenseDowngrade | null;
}

export default class LicenseRanking {
  // Positive when `a` is better than `b`, negative when worse, 0 when equal.
  public static compare(
    a: EnterpriseLicenseSnapshot,
    b: EnterpriseLicenseSnapshot,
  ): number {
    const statusDifference: number =
      STATUS_RANK[a.status] - STATUS_RANK[b.status];

    if (statusDifference !== 0) {
      return statusDifference;
    }

    const verificationDifference: number =
      VERIFICATION_RANK[a.verification] - VERIFICATION_RANK[b.verification];

    if (verificationDifference !== 0) {
      return verificationDifference;
    }

    /*
     * Same status, same verification: the one that lapses later is worth more.
     * Only while both are usable - between two lapsed licenses the date is
     * bookkeeping, not entitlement, and refusing a fresher record of a dead
     * license would keep an install from ever recording the truth.
     */
    if (
      !EnterpriseLicenseSnapshotUtil.isUsable(a) ||
      !EnterpriseLicenseSnapshotUtil.isUsable(b)
    ) {
      return 0;
    }

    const endOfA: Date | null = effectiveEndsAt(a);
    const endOfB: Date | null = effectiveEndsAt(b);

    if (!endOfA || !endOfB) {
      return 0;
    }

    return Math.sign(endOfA.getTime() - endOfB.getTime());
  }

  public static isAtLeastAsGood(
    candidate: EnterpriseLicenseSnapshot,
    current: EnterpriseLicenseSnapshot,
  ): boolean {
    return LicenseRanking.compare(candidate, current) >= 0;
  }

  public static describe(snapshot: EnterpriseLicenseSnapshot): string {
    return `${snapshot.status} (${snapshot.verification})`;
  }

  /*
   * Whether an update would leave every LICENSE_TERM_COLUMN exactly as it is
   * now - the same token, expiry, seat limit, evaluation flag and company
   * name, read back through the same defensive conversions the classifier
   * uses (so "" and an unparseable date are "no value" here too, as they are
   * there).
   *
   * Read LicenseInputs.LICENSE_TERM_COLUMNS beside this: the two lists are the
   * same five columns, one as database columns and one as the classifier's
   * view of them, and they must stay in step.
   */
  private static licenseTermsAreUnchanged(
    current: LicenseInputs,
    candidate: LicenseInputs,
  ): boolean {
    const sameDate: (a: Date | null | undefined, b: Date | null | undefined) => boolean =
      (a: Date | null | undefined, b: Date | null | undefined): boolean => {
        return (a ? a.getTime() : null) === (b ? b.getTime() : null);
      };

    return (
      current.token === candidate.token &&
      sameDate(current.storedColumns.expiresAt, candidate.storedColumns.expiresAt) &&
      (current.storedColumns.userLimit ?? null) ===
        (candidate.storedColumns.userLimit ?? null) &&
      (current.storedColumns.isEvaluation === true) ===
        (candidate.storedColumns.isEvaluation === true) &&
      (current.storedColumns.companyName ?? null) ===
        (candidate.storedColumns.companyName ?? null)
    );
  }

  /*
   * Applies the rule to an update built from a license-server response.
   *
   * An update is judged whenever it would CHANGE any license term, not only
   * when it changes the token. It used to be judged on the token alone, and
   * that left the worst version of the very failure this rule exists for
   * unguarded: a refresh that returns the SAME token with no expiresAt.
   * LicenseClient.mapValidationResponse always writes
   * enterpriseLicenseExpiresAt, as null when the response carried none, so
   * such an answer nulls a perfectly good expiry - taking a "valid" license to
   * "missing" - and, because the token did not change, nothing looked.
   *
   * An update that changes no term at all is still passed through without
   * being classified: there is nothing to judge, and classifying verifies a
   * signature for no reason.
   *
   * Note what this costs: the expiry and seat limit of an unverified license
   * no longer follow the license server unconditionally. They still follow it
   * in every direction that does not make the license classify worse (a
   * renewal, a seat change, a shorter term that is still current), which is
   * every legitimate change; what is refused now is a bare column edit that
   * would lapse a license which is working today. For a legacy license the
   * server is the only authority on those columns, but it is not an authority
   * on taking the installation down by accident.
   *
   * A refused update keeps the stored token and every license-term column,
   * and still writes the rest (the usage report: user count, instances).
   */
  public static guardUpdate(data: {
    inputs: LicenseInputs;
    update: PartialEntity<GlobalConfig>;
    now: Date;
  }): GuardedLicenseUpdate {
    const update: Record<string, unknown> = {
      ...(data.update as Record<string, unknown>),
    };

    const candidateInputs: LicenseInputs = LicenseInputsUtil.withUpdate(
      data.inputs,
      data.update,
    );

    if (LicenseRanking.licenseTermsAreUnchanged(data.inputs, candidateInputs)) {
      return { update: data.update, downgrade: null };
    }

    const current: LicenseTokenClassification = LicenseInputsUtil.classify(
      data.inputs,
      data.now,
    );
    const candidate: LicenseTokenClassification = LicenseInputsUtil.classify(
      candidateInputs,
      data.now,
    );

    if (LicenseRanking.isAtLeastAsGood(candidate, current)) {
      return { update: data.update, downgrade: null };
    }

    for (const column of LICENSE_TERM_COLUMNS) {
      delete update[column as string];
    }

    return {
      update: update as PartialEntity<GlobalConfig>,
      downgrade: { current, candidate },
    };
  }

  public static describeDowngrade(downgrade: LicenseDowngrade): string {
    return (
      `The license server returned a license that classifies as ${LicenseRanking.describe(downgrade.candidate)}, ` +
      `which is worse than the installed ${LicenseRanking.describe(downgrade.current)} license` +
      `${downgrade.candidate.message ? ` (${downgrade.candidate.message})` : ""}. ` +
      "The installed license was kept."
    );
  }
}
