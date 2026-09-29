import OneUptimeDate from "Common/Types/Date";
import Typeof from "Common/Types/Typeof";

/*
 * Rotation-start and hand-off instants are ENFORCED by the engine as wall-clock
 * in the schedule's timezone (Layer.addRotationUnits steps day/week/month
 * rotations with the schedule zone), but the datetime-local input
 * captures/displays in the viewer's own zone. These two helpers reconcile
 * the two — identical treatment to the restriction times (audit F1) — so what
 * the admin types matches what the engine enforces regardless of their own
 * zone. Kept React-free so the anchoring contract is unit-testable on its own.
 *
 * The viewer's zone here is the CURRENT timezone: the User Settings zone, else
 * the browser's. The Input converts with OneUptimeDate.toDateTimeLocalString /
 * fromDateTimeLocalString, which read and write that zone, so these use the
 * current-timezone wall-clock helpers. The browser-local twins that the
 * schedule preview grid uses would put the value off by the gap between the
 * settings zone and the browser zone.
 */

/*
 * Convert a datetime-local input value (a wall clock in the current timezone)
 * into the instant to STORE, reinterpreting the entered wall-clock in the
 * schedule timezone. When no timezone is given, the entered instant is kept.
 */
export function wallClockInputToStoredInstant(
  value: Date | string,
  timezone?: string | undefined,
): Date {
  let date: Date = OneUptimeDate.getCurrentDate();

  if (value instanceof Date) {
    date = value;
  }

  if (typeof value === Typeof.String) {
    date = OneUptimeDate.fromString(value as string);
  }

  return timezone
    ? OneUptimeDate.getInstantFromLocalWallClockInTimezone(date, timezone)
    : date;
}

/*
 * Inverse of wallClockInputToStoredInstant: turn a stored instant into a Date
 * whose current-timezone wall clock is the schedule-zone wall-clock, so the
 * datetime-local input redisplays exactly the value the admin typed.
 */
export function storedInstantToWallClockInput(
  stored: Date | string | undefined | null,
  timezone?: string | undefined,
): Date | undefined {
  if (stored === undefined || stored === null || (stored as any) === "") {
    return undefined;
  }

  const instant: Date = OneUptimeDate.fromString(stored as any);

  return timezone
    ? OneUptimeDate.getLocalDateFromWallClockInTimezone(instant, timezone)
    : instant;
}
