import OneUptimeDate from "../Date";
import { coerceNumericColumnValue } from "../Database/NumericColumnValue";

/*
 * HOW LONG THE AUDIT LOG KEEPS AN ENTRY: ONE RULE FOR EVERY READER.
 *
 * A project keeps each audit log entry for its Retention (days)
 * (Project.auditLogsRetentionInDays): a whole number of days from 7 to 180,
 * and 7 until someone sets another. The recorder stamps each entry with it
 * as it records it - the entry's retentionDate, which the AuditLog table's
 * TTL deletes it on. A failing audit log export reads those stamps back to
 * warn a day before the first of the entries it has not sent is deleted,
 * and reckons with the retention as it is now only when it cannot read
 * them: a retention changed since moves no stamp (#6563).
 *
 * The two used to work it out each their own way, and the server took any
 * value: the settings form checked 7 to 180, but the API took -3, 0 or 3.
 * For -3 the recorder kept entries a day while the export reckoned a week,
 * so its "will start losing entries" email came six days after they were
 * gone (#6383). Everything that reads the setting now reads it here:
 *
 *   - readAuditLogRetentionInDays: the retention an entry is recorded with.
 *     Every value reads as one, so a value stored before the server checked
 *     it never breaks a read: one that is not a number of days (none, NaN,
 *     text) as the default, and a number as the nearest whole number of days
 *     from 7 to 180 - -3, 0 and 3 as 7, 500 as 180;
 *   - getAuditLogRetentionDate: when an entry recorded at a moment is
 *     deleted, that many calendar days later by the server's clock
 *     (OneUptimeDate.addRemoveDays) - the retentionDate the recorder stamps,
 *     and the moment a failing export reckons when it cannot read the
 *     stamps;
 *   - getAuditLogRetentionError: why a value cannot be saved, which
 *     ProjectService refuses a create or an update with. The settings form
 *     checks the same range in the browser.
 *
 * Why 7 to 180, and not 1: it is what the settings form, the column's
 * description, the API reference and the docs (NIST 800-53 AU-11 among them)
 * have always said. A week is the least that keeps an audit log useful: an
 * administrator cannot shrink it to hours to hide what they do next, and a
 * failing export has days between "is failing" and "will start losing
 * entries". A stored value under 7 keeps new entries for 7 days, and one
 * over 180 for 180; the entries recorded so far keep their dates.
 */

// What a project keeps its entries for until someone sets another retention.
export const AUDIT_LOG_DEFAULT_RETENTION_IN_DAYS: number = 7;

// The shortest and longest retention a project can have.
export const AUDIT_LOG_MIN_RETENTION_IN_DAYS: number = 7;
export const AUDIT_LOG_MAX_RETENTION_IN_DAYS: number = 180;

// What the server answers a value it will not save.
export const AUDIT_LOG_RETENTION_ERROR: string = `Audit log retention must be a whole number of days from ${AUDIT_LOG_MIN_RETENTION_IN_DAYS} to ${AUDIT_LOG_MAX_RETENTION_IN_DAYS}.`;

/*
 * The retention, in whole days, an entry is recorded with for a stored or
 * written value. A number written as text ("30", as a form sends it) reads
 * as the number it is (coerceNumericColumnValue).
 */
export function readAuditLogRetentionInDays(value: unknown): number {
  const days: unknown = coerceNumericColumnValue(value);

  if (typeof days !== "number" || !Number.isFinite(days)) {
    return AUDIT_LOG_DEFAULT_RETENTION_IN_DAYS;
  }

  return Math.min(
    AUDIT_LOG_MAX_RETENTION_IN_DAYS,
    Math.max(AUDIT_LOG_MIN_RETENTION_IN_DAYS, Math.round(days)),
  );
}

/*
 * Why a retention someone saves cannot be kept - not a whole number of days,
 * or outside 7 to 180 - or null when it can. A number written as text is
 * judged as the number it is.
 */
export function getAuditLogRetentionError(value: unknown): string | null {
  const days: unknown = coerceNumericColumnValue(value);

  if (
    typeof days === "number" &&
    Number.isInteger(days) &&
    days >= AUDIT_LOG_MIN_RETENTION_IN_DAYS &&
    days <= AUDIT_LOG_MAX_RETENTION_IN_DAYS
  ) {
    return null;
  }

  return AUDIT_LOG_RETENTION_ERROR;
}

/*
 * When the audit log deletes an entry recorded at `recordedAt` by a project
 * whose retention is `retentionInDays`: that many calendar days later, by
 * the server's own clock, so across a change of the clocks the day in
 * between is 23 or 25 hours long, as the recorder has always stamped it.
 */
export function getAuditLogRetentionDate(data: {
  recordedAt: Date;
  retentionInDays: unknown;
}): Date {
  return OneUptimeDate.addRemoveDays(
    new Date(data.recordedAt),
    readAuditLogRetentionInDays(data.retentionInDays),
  );
}
