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
 *   then, while BOTH sides are usable AND the two dates measure the same
 *   thing, the date entitlement actually ends on:
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
 *
 * When the date is NOT compared, and why it must not be.
 *
 * Comparing the dates of two DIFFERENT licenses says nothing about a mistake.
 * A different token is a different license, deliberately issued, and a real
 * plan change may legitimately end sooner: an evaluation running to next
 * summer converted to a paid year, an annual plan moved to monthly. Refusing
 * those kept the evaluation token and its flag installed, left the seat limit
 * stale, and made every later refresh throw at the administrator who had just
 * bought the new plan. Status still refuses a genuinely expired or invalid
 * license, because status outranks everything.
 *
 * So the tie-break runs only where the two dates are comparable measures of
 * entitlement (see mayReplace):
 *
 *   - the token is UNCHANGED: the same license restated. A shorter or dropped
 *     term here is not a plan change, it is this product's own bookkeeping
 *     going backwards - a sync glitch, a response that forgot expiresAt, a
 *     bare column edit - which is what the tie-break was added for.
 *   - or the candidate's end date is the INSTALLATION's rather than a
 *     license's: an install with nothing usable to go on falls back to the
 *     unlicensed trial (graceReason "unlicensed"), which ends at first run +
 *     trialDays. That date describes the install, not anything that was
 *     bought, so it must never quietly shorten a real licensed term - whatever
 *     token it happens to arrive with.
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

export interface LicenseRankingOptions {
  /*
   * Whether an otherwise equal rank is broken on the date the entitlement
   * actually ends. True is the full order described at the top of this file;
   * false stops at status and verification, for two licenses whose end dates
   * are not comparable measures of the same entitlement. mayReplace decides
   * which of the two applies to a license-server answer.
   */
  compareEffectiveEnd: boolean;
}

const FULL_ORDER: LicenseRankingOptions = { compareEffectiveEnd: true };

export interface GuardedLicenseUpdate {
  // What is safe to write: `update` minus the license terms when they were refused.
  update: PartialEntity<GlobalConfig>;
  // Set when the returned license was refused.
  downgrade: LicenseDowngrade | null;
}

export default class LicenseRanking {
  /*
   * Positive when `a` is better than `b`, negative when worse, 0 when equal.
   * Defaults to the full order; pass compareEffectiveEnd false to stop at
   * status and verification.
   */
  public static compare(
    a: EnterpriseLicenseSnapshot,
    b: EnterpriseLicenseSnapshot,
    options: LicenseRankingOptions = FULL_ORDER,
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
     * license would keep an install from ever recording the truth. And only
     * where the caller says the two dates measure the same entitlement at all
     * (see "When the date is NOT compared" above).
     */
    if (
      !options.compareEffectiveEnd ||
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
    options: LicenseRankingOptions = FULL_ORDER,
  ): boolean {
    return LicenseRanking.compare(candidate, current, options) >= 0;
  }

  /*
   * Whether a license the license server returned may replace the installed
   * one: the never-downgrade rule as both writers apply it (a refresh through
   * guardUpdate, and an activation through LicenseClient).
   *
   * `sameToken` is what decides whether the effective-end tie-break is a
   * meaningful comparison - see "When the date is NOT compared" at the top of
   * this file. A candidate that falls back to the installation's own trial
   * (graceReason "unlicensed") carries no license term to compare, so its date
   * is always judged, however the token changed.
   */
  public static mayReplace(data: {
    current: EnterpriseLicenseSnapshot;
    candidate: EnterpriseLicenseSnapshot;
    sameToken: boolean;
  }): boolean {
    return LicenseRanking.isAtLeastAsGood(data.candidate, data.current, {
      compareEffectiveEnd:
        data.sameToken ||
        LicenseRanking.endsWithTheInstallationsTrial(data.candidate),
    });
  }

  /*
   * Whether a snapshot's effective end date is about this INSTALLATION rather
   * than about a license. An install with no usable license falls back to the
   * unlicensed trial, which ends at first run + trialDays and says nothing
   * about what was bought; every other end date - an expiry, or the grace
   * period that follows one - is the license's own.
   *
   * Only a usable snapshot ever reaches the date comparison, and the only
   * usable trial state is "grace" with graceReason "unlicensed" (a lapsed
   * trial is "missing", which compare() rejects before this matters).
   */
  private static endsWithTheInstallationsTrial(
    snapshot: EnterpriseLicenseSnapshot,
  ): boolean {
    return snapshot.graceReason === "unlicensed";
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
   * Note what this costs, stated for the unverified license that nearly every
   * installation in the field actually holds (TrustedLicenseKeys shipped empty
   * until very recently, so almost nothing verifies). Its expiry and seat
   * limit no longer follow the license server unconditionally:
   *
   *   accepted   a renewal, a seat change, a company-name change, and - under
   *              a DIFFERENT token - a real plan change that ends sooner than
   *              the license it replaces, as long as it is still current.
   *   refused    the SAME token with its term dropped or moved earlier, and
   *              any answer that would take the installation to a worse status
   *              or a worse verification.
   *
   * So a shorter term is followed when a new license comes with it, and
   * refused when it arrives as a bare edit to the license already installed.
   * For a legacy license the server is the only authority on those columns,
   * but it is not an authority on taking the installation down by accident.
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

    if (
      LicenseRanking.mayReplace({
        current,
        candidate,
        sameToken: data.inputs.token === candidateInputs.token,
      })
    ) {
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
