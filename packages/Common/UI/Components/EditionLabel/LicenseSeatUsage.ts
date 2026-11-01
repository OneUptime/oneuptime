/*
 * How close the installation is to its licensed seats, as the edition pill,
 * the edition dialog and the Admin Dashboard's license page all read it. One
 * calculation, so the page never says one thing and the pill beside it
 * another.
 *
 * Pure, and it reads only what the license GET answers.
 */

/*
 * "breached" also covers an enforced limit that is exactly full: new users
 * are already refused there.
 */
export type SeatTone = "healthy" | "approaching" | "breached";

/*
 * Seat usage at or above this percent asks the admin to talk to OneUptime about
 * expanding. Matches CRITICAL_CAPACITY_PERCENT in
 * App/FeatureSet/Workers/Jobs/InstanceHealth/EvaluateClickhouseCapacity.ts.
 */
const SEAT_WARNING_PERCENT: number = 90;

export interface LicenseSeatFigures {
  licenseValid: boolean;
  userLimit: number | null;
  // What oneuptime.com last counted across every instance on the license.
  currentUserCount: number | null;
  isSeatLimitEnforced: boolean;
  // The live count the server enforces the limit on; null when it does not.
  enforcedSeatsInUse: number | null;
  canAddMoreUsers: boolean;
}

export interface LicenseSeatUsage {
  /*
   * The seat figure everything is measured against: the live, enforced count
   * when this installation enforces its seat limit, else currentUserCount.
   */
  effectiveUserCount: number | null;
  // The percent of licensed seats in use, as the admin reads it (may exceed 100).
  seatUsageDisplayPercent: number | null;
  seatTone: SeatTone;
}

type GetLicenseSeatUsageFunction = (
  figures: LicenseSeatFigures,
) => LicenseSeatUsage;

export const getLicenseSeatUsage: GetLicenseSeatUsageFunction = (
  figures: LicenseSeatFigures,
): LicenseSeatUsage => {
  /*
   * The seat figure everything below is measured against.
   *
   * currentUserCount is what oneuptime.com last computed across every instance
   * on this license, which is up to a day old. On an installation that
   * enforces a seat limit the server also sends seatsInUse: the same
   * cross-instance figure reconciled with the live User table here, and the
   * number invitations are actually refused on. Showing anything else would
   * leave the card reading "98 of 100" next to an invitation that had just
   * bounced.
   */
  const effectiveUserCount: number | null =
    figures.isSeatLimitEnforced &&
    typeof figures.enforcedSeatsInUse === "number"
      ? figures.enforcedSeatsInUse
      : figures.currentUserCount;

  const hasSeatLimit: boolean =
    typeof figures.userLimit === "number" && figures.userLimit > 0;

  /*
   * Unclamped and unrounded. The only value that can tell 120/120 apart from
   * 240/120. Null means there is no seat limit to measure against, either
   * because the license is unlimited or because usage has not been reported.
   */
  const rawUserUsagePercent: number | null =
    hasSeatLimit && typeof effectiveUserCount === "number"
      ? Math.max(0, (effectiveUserCount / (figures.userLimit as number)) * 100)
      : null;

  /*
   * The percent the admin reads, and the one the warning fires on. May exceed
   * 100 so a breach shows a real figure. Floored to 99 when rounding would
   * claim 100% while a seat is genuinely free, so 599/600 never reads
   * "100% of licensed seats in use" next to "1 seat remaining".
   */
  let seatUsageDisplayPercent: number | null = null;

  if (rawUserUsagePercent !== null) {
    const rounded: number = Math.round(rawUserUsagePercent);

    seatUsageDisplayPercent =
      rounded >= 100 && rawUserUsagePercent < 100 ? 99 : rounded;
  }

  const isUserLimitBreached: boolean =
    figures.licenseValid &&
    hasSeatLimit &&
    typeof effectiveUserCount === "number" &&
    effectiveUserCount > (figures.userLimit as number);

  /*
   * Total and mutually exclusive. isUserLimitBreached is tested first, so
   * reaching the >= 90 test structurally guarantees the limit is not exceeded
   * and the amber nudge can never co-fire with the red breach.
   *
   * The test runs on the displayed percent rather than the raw ratio so that
   * the number triggering the warning is the number printed under the bar.
   */
  const getSeatTone: () => SeatTone = (): SeatTone => {
    if (!figures.licenseValid) {
      return "healthy";
    }

    if (isUserLimitBreached) {
      return "breached";
    }

    /*
     * Exactly at the limit is not over it, but it is the point where the
     * installation starts refusing new users - so it gets the red treatment
     * rather than the amber "nearly full" nudge, which would understate a
     * door that is already shut.
     */
    if (figures.isSeatLimitEnforced && !figures.canAddMoreUsers) {
      return "breached";
    }

    if (
      typeof seatUsageDisplayPercent === "number" &&
      seatUsageDisplayPercent >= SEAT_WARNING_PERCENT
    ) {
      return "approaching";
    }

    return "healthy";
  };

  return {
    effectiveUserCount: effectiveUserCount,
    seatUsageDisplayPercent: seatUsageDisplayPercent,
    seatTone: getSeatTone(),
  };
};
