import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import {
  EnterpriseLicenseSnapshot,
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
 *
 * Status comes first because it is what the product acts on: a current legacy
 * license beats a verified one that has already expired. Equal ranks are
 * accepted - that is how a renewal with a later expiry lands.
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

    return VERIFICATION_RANK[a.verification] - VERIFICATION_RANK[b.verification];
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
   * Applies the rule to an update built from a license-server response.
   *
   * Only an update that CHANGES the stored token is judged. The columns of an
   * unverified license (its expiry, its seat limit) still follow the license
   * server as they always have: for a legacy license the server is the only
   * authority there is.
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

    if (!Object.prototype.hasOwnProperty.call(update, "enterpriseLicenseToken")) {
      return { update: data.update, downgrade: null };
    }

    const candidateInputs: LicenseInputs = LicenseInputsUtil.withUpdate(
      data.inputs,
      data.update,
    );

    if (candidateInputs.token === data.inputs.token) {
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
