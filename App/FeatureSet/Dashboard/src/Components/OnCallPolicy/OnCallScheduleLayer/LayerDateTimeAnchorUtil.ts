import OneUptimeDate from "Common/Types/Date";
import Typeof from "Common/Types/Typeof";

/*
 * Rotation-start and hand-off instants are ENFORCED by the engine as wall-clock
 * in the schedule's timezone (Layer.addRotationUnits steps day/week/month
 * rotations with the schedule zone), but the datetime-local input
 * captures/displays in the viewer's BROWSER zone. These two helpers reconcile
 * the two — identical treatment to the restriction times (audit F1) — so what
 * the admin types matches what the engine enforces regardless of their browser
 * zone. Kept React-free so the anchoring contract is unit-testable on its own.
 */

/*
 * Convert a datetime-local input value (a browser-local wall-clock) into the
 * instant to STORE, reinterpreting the entered wall-clock in the schedule
 * timezone. When no timezone is given, the legacy browser-local instant is kept.
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
 * Inverse of wallClockInputToStoredInstant: turn a stored instant into a
 * browser-local Date carrying the schedule-zone wall-clock, so the
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
