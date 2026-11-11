/*
 * HOW LONG A RESOLVED INCIDENT OR ALERT IS KEPT (OneUptime issue #6903).
 *
 * Incidents and alerts used to stay in the database for good, with all they
 * carry: their state timelines, feeds, notes, notification logs - and, for a
 * synthetic monitor's, the screenshots of the check that opened and closed
 * them. A project now chooses how long a resolved one stays
 * (Project.incidentRetentionInDays, Project.alertRetentionInDays, set by a
 * Project Owner or Admin on Incidents -> Settings -> Data Retention and Alerts
 * -> Settings -> Data Retention). The Workers jobs
 * Incident:DeleteResolvedIncidents and Alert:DeleteResolvedAlerts delete the
 * ones resolved for longer, through Server/Utils/Retention/ResolvedRecordRetention,
 * which says what stays however old it is.
 *
 * Every project starts at 0 - every incident and alert stays, as before - so
 * an upgrade deletes nothing until someone picks a length. The lengths are a
 * short list, as a polling interval's are, from a month - longer than a
 * status page's incident history shows by default (14 days) - to three
 * years.
 */

// What a retention is about: incidents (and their episodes) or alerts (and theirs).
export enum ResolvedRecordKind {
  Incident = "Incident",
  Alert = "Alert",
}

export const RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS: ReadonlyArray<number> =
  [30, 60, 90, 180, 365, 730, 1095];

// The setting's value for "Never": every resolved record stays.
export const KEEP_EVERY_RESOLVED_RECORD: number = 0;

// Where every project starts: nothing is deleted until someone picks a length.
export const DEFAULT_RESOLVED_RECORD_RETENTION_IN_DAYS: number =
  KEEP_EVERY_RESOLVED_RECORD;

// The shortest a project may keep a resolved incident or alert.
export const MIN_RESOLVED_RECORD_RETENTION_IN_DAYS: number =
  RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS[0]!;

/*
 * Whether an incident whose postmortem is completed stays however long ago it
 * was resolved (Project.keepIncidentsWithCompletedPostmortem): on unless a
 * Project Owner or Admin turns it off - a written-up incident is the one a
 * team comes back to.
 */
export const DEFAULT_KEEP_INCIDENTS_WITH_COMPLETED_POSTMORTEM: boolean = true;

// "30, 60, 90, 180, 365, 730 or 1095": the choices as a sentence says them.
const RETENTION_CHOICES_TEXT: string = `${RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS.slice(0, -1).join(", ")} or ${RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS[RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS.length - 1]}`;

// What a refused value is answered with, for the kind it was written for.
export function getResolvedRecordRetentionRefusal(
  kind: ResolvedRecordKind,
): string {
  const noun: string =
    kind === ResolvedRecordKind.Incident ? "incident" : "alert";

  return `Pick how long a resolved ${noun} is kept: ${RETENTION_CHOICES_TEXT} days, or ${KEEP_EVERY_RESOLVED_RECORD} to keep every ${noun}.`;
}

// Whether a value is one the setting takes: a choice, or 0 for never.
export function isResolvedRecordRetentionInDays(
  value: unknown,
): value is number {
  return (
    typeof value === "number" &&
    (value === KEEP_EVERY_RESOLVED_RECORD ||
      RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS.includes(value))
  );
}

/*
 * What is wrong with a value written to the setting, or null when it is one
 * of the choices or 0. A whole number written as text ("90") is read as the
 * number; nothing else is: the column is never left empty, so null is
 * refused too, and a number that is not a choice is a mistake, not a
 * default - a typo must never delete more than was meant.
 */
export function getResolvedRecordRetentionProblem(
  value: unknown,
  kind: ResolvedRecordKind,
): string | null {
  return isResolvedRecordRetentionInDays(toNumber(value))
    ? null
    : getResolvedRecordRetentionRefusal(kind);
}

/*
 * The value as the column stores it. Call getResolvedRecordRetentionProblem
 * first: anything else reads as the default, which deletes nothing.
 */
export function toResolvedRecordRetentionInDays(value: unknown): number {
  const days: number | null = toNumber(value);

  return isResolvedRecordRetentionInDays(days)
    ? days
    : DEFAULT_RESOLVED_RECORD_RETENTION_IN_DAYS;
}

/*
 * The setting as a reader of a response or a row takes it: one of the
 * choices, 0 for never, or undefined when it is missing or not one of them -
 * then nothing is said about it, and nothing is deleted by it.
 */
export function readResolvedRecordRetentionInDays(
  value: unknown,
): number | undefined {
  const days: number | null = toNumber(value);

  return isResolvedRecordRetentionInDays(days) ? days : undefined;
}

// Whether resolved records are deleted at all with this setting.
export function isResolvedRecordRetentionOn(days: number): boolean {
  return days !== KEEP_EVERY_RESOLVED_RECORD;
}

/*
 * Whether moving the setting from `from` to `to` deletes records `from` kept:
 * turning it on, or shortening it. The setting asks before such a move, as
 * what it deletes cannot be brought back; lengthening it or turning it off
 * deletes nothing.
 */
export function doesResolvedRecordRetentionDeleteMore(data: {
  from: number;
  to: number;
}): boolean {
  if (!isResolvedRecordRetentionOn(data.to)) {
    return false;
  }

  if (!isResolvedRecordRetentionOn(data.from)) {
    return true;
  }

  return data.to < data.from;
}

// Days as a form or an API client may send them: as text.
const DAYS_AS_TEXT: RegExp = /^\d{1,4}$/;

function toNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" && DAYS_AS_TEXT.test(value.trim())) {
    return Number(value.trim());
  }

  return null;
}
