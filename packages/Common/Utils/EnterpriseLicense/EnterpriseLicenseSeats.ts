import EnterpriseLicenseInstanceSummary from "../../Types/EnterpriseLicense/EnterpriseLicenseInstanceSummary";

/*
 * Everything the seat calculation needs, taken as plain values so this file
 * stays a pure function the tests can drive directly. The server reads these
 * off GlobalConfig; the browser reads them off the /global-config/license
 * response.
 */
export interface SeatUsageInput {
  /*
   * The seat limit mirrored from oneuptime.com. Null, undefined or anything
   * that is not a positive whole number means "no limit to enforce" — see
   * getSeatUsage for why zero is included in that.
   */
  userLimit?: number | null | undefined;

  /*
   * Users that exist on THIS installation right now. The live number, counted
   * at the moment of the check rather than taken from the last daily report,
   * because the whole point of enforcement is to catch the user who is being
   * added a second after the report was sent.
   */
  localUserCount: number;

  /*
   * Unique users across every instance sharing this license, as oneuptime.com
   * last computed it. Up to a day stale, and only meaningful for a customer
   * running more than one instance on one key.
   */
  aggregatedUserCount?: number | null | undefined;

  /*
   * Per-instance breakdown from the same report. Used only to work out how
   * much of aggregatedUserCount belongs to OTHER instances.
   */
  instances?: Array<EnterpriseLicenseInstanceSummary> | null | undefined;

  // This installation's own instance id, so it can find itself in `instances`.
  thisInstanceId?: string | null | undefined;
}

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
   * across every instance on this license. See getSeatUsage for how it is
   * derived and which way it is allowed to be wrong.
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
   * conservative answer — see getSeatUsage.
   */
  seatsUsedByOtherInstances: number;
}

export default class EnterpriseLicenseSeatsUtil {
  /*
   * How many seats are in use, and whether one more user fits.
   *
   * The awkward part is that a license is shared by every instance the
   * customer runs, and only oneuptime.com can deduplicate users across them —
   * the same person on staging and production is one seat. So this instance
   * has two numbers and neither one is the answer on its own:
   *
   *   localUserCount      live, but blind to the customer's other instances.
   *   aggregatedUserCount complete, but up to a day old, so it does not know
   *                       about anyone added since the last daily report —
   *                       including the user being added right now.
   *
   * Combining them needs to know how much of the aggregate is NOT ours, which
   * is what the per-instance breakdown is for: subtract our own last reported
   * count from the aggregate and what is left is other instances. Add the live
   * local count back and the result is current on this instance and complete
   * on the others.
   *
   * When the breakdown does not say — an older license server that sends no
   * instance list, an instance that has never registered — there is nothing to
   * subtract, and the fallback is the larger of the two numbers on their own.
   * That is the only case where the stale aggregate decides anything: with a
   * usable breakdown it is deliberately NOT maxed in, because it would then
   * outvote the live count in the one direction that hurts. Free twenty seats
   * by deleting twenty users and a stale aggregate would go on refusing new
   * ones until the next daily report.
   *
   * Which way it is allowed to be wrong: under-enforcing is recoverable (the
   * next daily report corrects the count, and the breach emails already go
   * out), over-enforcing locks a paying customer out of their own instance.
   * So every "I cannot tell" branch below resolves towards under-enforcing.
   */
  public static getSeatUsage(input: SeatUsageInput): SeatUsage {
    const userLimit: number | null = this.parseUserLimit(input.userLimit);
    const localUserCount: number = this.parseCount(input.localUserCount) ?? 0;
    const aggregatedUserCount: number | null = this.parseCount(
      input.aggregatedUserCount,
    );

    /*
     * Null means the report is not complete enough to attribute seats to
     * anybody, which is a different thing from attributing zero to them.
     */
    const otherInstanceSeats: number | null = this.getSeatsUsedByOtherInstances(
      {
        aggregatedUserCount: aggregatedUserCount,
        instances: input.instances,
        thisInstanceId: input.thisInstanceId,
      },
    );

    const seatsUsedByOtherInstances: number = otherInstanceSeats ?? 0;

    const seatsInUse: number =
      otherInstanceSeats === null
        ? Math.max(localUserCount, aggregatedUserCount ?? 0)
        : otherInstanceSeats + localUserCount;

    if (userLimit === null) {
      return {
        isEnforced: false,
        userLimit: null,
        seatsInUse: seatsInUse,
        seatsRemaining: null,
        hasSeatForNewUser: true,
        seatsUsedByOtherInstances: seatsUsedByOtherInstances,
      };
    }

    return {
      isEnforced: true,
      userLimit: userLimit,
      seatsInUse: seatsInUse,
      seatsRemaining: Math.max(0, userLimit - seatsInUse),
      hasSeatForNewUser: seatsInUse < userLimit,
      seatsUsedByOtherInstances: seatsUsedByOtherInstances,
    };
  }

  /*
   * The message an administrator reads when a seat could not be taken. Built
   * here rather than at each throw site so the invite form, the signup form
   * and SSO/SCIM provisioning all explain the same thing the same way, and so
   * the tests can assert on it without copying the wording.
   */
  public static getSeatLimitReachedMessage(data: {
    seatsInUse: number;
    userLimit: number;
  }): string {
    return (
      `This OneUptime installation has reached the ${data.userLimit.toLocaleString()}-user ` +
      `limit of its enterprise license (${data.seatsInUse.toLocaleString()} in use). New users ` +
      `cannot be invited, signed up or provisioned until a seat is freed up or the license is ` +
      `expanded. Contact sales@oneuptime.com to add seats, then use "Refresh license" in the ` +
      `edition dialog to apply the new limit.`
    );
  }

  /*
   * The part of the aggregate that belongs to instances other than this one,
   * or null when the report does not say.
   *
   * Null rather than zero, because the two lead somewhere different: zero means
   * "this installation is the only one holding seats", and null means "the
   * report cannot be decomposed, fall back to comparing the two totals". Every
   * missing or unusable field lands on null.
   *
   * In particular, an instance list that does not contain us is NOT treated as
   * "then all of the aggregate is somebody else's". That reading is right for a
   * genuinely unregistered instance, and catastrophic for an instance whose id
   * changed after its users were already counted under the old one: it would
   * count this installation's users twice and lock it out.
   */
  private static getSeatsUsedByOtherInstances(data: {
    aggregatedUserCount: number | null;
    instances?: Array<EnterpriseLicenseInstanceSummary> | null | undefined;
    thisInstanceId?: string | null | undefined;
  }): number | null {
    const aggregatedUserCount: number | null = data.aggregatedUserCount;

    if (aggregatedUserCount === null) {
      return null;
    }

    if (!Array.isArray(data.instances) || data.instances.length === 0) {
      return null;
    }

    const thisInstanceId: string =
      typeof data.thisInstanceId === "string" ? data.thisInstanceId.trim() : "";

    if (!thisInstanceId) {
      return null;
    }

    const thisInstance: EnterpriseLicenseInstanceSummary | undefined =
      data.instances.find(
        (instance: EnterpriseLicenseInstanceSummary): boolean => {
          return Boolean(instance) && instance.instanceId === thisInstanceId;
        },
      );

    if (!thisInstance) {
      return null;
    }

    /*
     * The active-only aggregate contains none of this installation's stale
     * reported users. Subtracting that old count would remove users belonging
     * to active instances and under-enforce the license. Treat the complete
     * aggregate as other-instance usage. We also cannot add the two counts:
     * the same users may exist on both this installation and active ones.
     * Return null to use the existing uncertainty fallback, which takes the
     * larger complete-or-live total without subtracting or double-counting.
     *
     * Undefined retains the legacy behavior for responses from older license
     * servers that did not send activity provenance.
     */
    if (thisInstance.isCountedTowardsUsage === false) {
      return null;
    }

    const ownReportedCount: number | null = this.parseCount(
      thisInstance.userCount,
    );

    if (ownReportedCount === null) {
      return null;
    }

    return Math.max(0, aggregatedUserCount - ownReportedCount);
  }

  /*
   * A limit is only a limit when it is a positive whole number.
   *
   * Zero is deliberately read as "no limit" rather than "no seats at all",
   * matching every other place in the product that measures seat usage
   * (the license modal, the breach notification job). A license that really
   * grants nobody an account is not a thing OneUptime issues, and reading a
   * stray zero the other way would leave an installation unable to create even
   * its first user.
   */
  private static parseUserLimit(value: unknown): number | null {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      !Number.isInteger(value) ||
      value <= 0
    ) {
      return null;
    }

    return value;
  }

  private static parseCount(value: unknown): number | null {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      !Number.isInteger(value) ||
      value < 0
    ) {
      return null;
    }

    return value;
  }
}
