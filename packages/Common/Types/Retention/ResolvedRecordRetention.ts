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

/*
 * THE SERVER'S LIMITS (issue #6941): Admin Dashboard -> Settings -> Data
 * Retention, for a self-hosted server whose database must not grow without
 * bound, whatever each project picks.
 *
 *   - A maximum (GlobalConfig.maxIncidentRetentionInDays,
 *     maxAlertRetentionInDays): no project keeps a resolved incident (alert)
 *     longer. A project set to Never, or to a longer length, is held to it.
 *     Empty - where every server starts - is no maximum.
 *   - A default (GlobalConfig.defaultIncidentRetentionInDays,
 *     defaultAlertRetentionInDays): the length a new project starts with.
 *     Empty is Never, as before. Projects that exist keep their own.
 *
 * Both are one of the project choices. The maximum is applied where records
 * are deleted (getEffectiveResolvedRecordRetentionInDays): a project's own
 * setting is never rewritten, so lifting the maximum gives every project
 * back what it picked. Incidents with a completed postmortem stay under the
 * maximum too, while their project keeps them: that switch is the project's
 * way to keep what it learned.
 */
export interface ResolvedRecordRetentionServerLimits {
  // The longest a project keeps resolved records of the kind; undefined for no maximum.
  maximumInDays?: number | undefined;
  // Where a new project starts; KEEP_EVERY_RESOLVED_RECORD (0) for Never.
  defaultInDays: number;
}

// Where every server starts: no maximum, and new projects at Never.
export const NO_RESOLVED_RECORD_RETENTION_SERVER_LIMITS: Readonly<ResolvedRecordRetentionServerLimits> =
  {
    maximumInDays: undefined,
    defaultInDays: KEEP_EVERY_RESOLVED_RECORD,
  };

/*
 * A server maximum as GlobalConfig holds it, read: one of the choices, or
 * undefined for none. Anything else - empty, 0, a number that is not a
 * choice - is no maximum: a value that cannot be read must never delete
 * what a project keeps.
 */
export function readResolvedRecordRetentionMaximumInDays(
  value: unknown,
): number | undefined {
  const days: number | null = toNumber(value);

  return days !== null &&
    RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS.includes(days)
    ? days
    : undefined;
}

/*
 * A new project's starting length as GlobalConfig holds it, read: one of the
 * choices, or 0 (Never) for anything else, empty included.
 */
export function readResolvedRecordRetentionDefaultInDays(
  value: unknown,
): number {
  const days: number | null = toNumber(value);

  return days !== null &&
    RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS.includes(days)
    ? days
    : KEEP_EVERY_RESOLVED_RECORD;
}

// The server's limits for a kind, from the values GlobalConfig holds.
export function readResolvedRecordRetentionServerLimits(data: {
  maximumInDays: unknown;
  defaultInDays: unknown;
}): ResolvedRecordRetentionServerLimits {
  return {
    maximumInDays: readResolvedRecordRetentionMaximumInDays(data.maximumInDays),
    defaultInDays: readResolvedRecordRetentionDefaultInDays(data.defaultInDays),
  };
}

/*
 * How long a project's resolved records are kept: its own setting, held to
 * the server's maximum - Never, or a longer length, is the maximum.
 */
export function getEffectiveResolvedRecordRetentionInDays(data: {
  projectRetentionInDays: number;
  maximumInDays?: number | undefined;
}): number {
  if (data.maximumInDays === undefined) {
    return data.projectRetentionInDays;
  }

  if (!isResolvedRecordRetentionOn(data.projectRetentionInDays)) {
    return data.maximumInDays;
  }

  return Math.min(data.projectRetentionInDays, data.maximumInDays);
}

/*
 * Whether a project's pick means anything under the server's maximum: a
 * length up to it. Never and the longer lengths read as the maximum, so the
 * card offers them locked. The API still takes them, so a project's
 * automation keeps working: they apply again once the maximum is lifted.
 */
export function isResolvedRecordRetentionWithinMaximum(data: {
  retentionInDays: number;
  maximumInDays?: number | undefined;
}): boolean {
  if (data.maximumInDays === undefined) {
    return true;
  }

  return (
    isResolvedRecordRetentionOn(data.retentionInDays) &&
    data.retentionInDays <= data.maximumInDays
  );
}

// The words both server settings refuse with, for the kind.
function getServerRetentionNoun(kind: ResolvedRecordKind): string {
  return kind === ResolvedRecordKind.Incident ? "incident" : "alert";
}

/*
 * What is wrong with a server maximum written to GlobalConfig, or null when
 * it is one of the choices, or empty (null, or 0) for no maximum.
 */
export function getResolvedRecordRetentionMaximumProblem(
  value: unknown,
  kind: ResolvedRecordKind,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const days: number | null = toNumber(value);

  if (
    days === KEEP_EVERY_RESOLVED_RECORD ||
    (days !== null && RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS.includes(days))
  ) {
    return null;
  }

  const noun: string = getServerRetentionNoun(kind);

  return `Pick the longest a project keeps a resolved ${noun}: ${RETENTION_CHOICES_TEXT} days, or leave it empty for no maximum.`;
}

/*
 * What is wrong with a new project's starting length written to
 * GlobalConfig, or null when it is one of the choices, or empty (null, or
 * 0) for Never - and no longer than the server's maximum, which a new
 * project could never use.
 */
export function getResolvedRecordRetentionDefaultProblem(data: {
  value: unknown;
  kind: ResolvedRecordKind;
  maximumInDays?: number | undefined;
}): string | null {
  if (data.value === null || data.value === undefined) {
    return null;
  }

  const days: number | null = toNumber(data.value);
  const noun: string = getServerRetentionNoun(data.kind);

  if (
    days !== KEEP_EVERY_RESOLVED_RECORD &&
    (days === null || !RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS.includes(days))
  ) {
    return `Pick how long a new project keeps a resolved ${noun}: ${RETENTION_CHOICES_TEXT} days, or leave it empty for Never.`;
  }

  if (
    data.maximumInDays !== undefined &&
    days !== KEEP_EVERY_RESOLVED_RECORD &&
    days > data.maximumInDays
  ) {
    return `A new project can keep a resolved ${noun} for at most ${data.maximumInDays} days, the server's maximum. Pick that or less.`;
  }

  return null;
}

/*
 * A server setting as GlobalConfig stores it: the choice, or null for empty
 * (no maximum, or Never). Call the setting's problem function first.
 */
export function toResolvedRecordRetentionServerValue(
  value: unknown,
): number | null {
  const days: number | null = toNumber(value);

  return days !== null &&
    RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS.includes(days)
    ? days
    : null;
}

/*
 * Whether moving the server's maximum from `from` to `to` (undefined: no
 * maximum) deletes records some project kept: setting one, or lowering it.
 * The Admin Dashboard asks first, saying how many projects it reaches.
 */
export function doesResolvedRecordRetentionMaximumDeleteMore(data: {
  from?: number | undefined;
  to?: number | undefined;
}): boolean {
  if (data.to === undefined) {
    return false;
  }

  if (data.from === undefined) {
    return true;
  }

  return data.to < data.from;
}

/*
 * WHICH POSTMORTEM STATUSES KEEP AN INCIDENT (issue #6945).
 *
 * While Project.keepIncidentsWithCompletedPostmortem is on, an incident whose
 * postmortem is in one of the project's chosen statuses stays, however long
 * ago it was resolved (Project.keepIncidentsInPostmortemStatusIds). Empty -
 * where every project starts - is the project's Completed status, as it was:
 * an upgrade keeps exactly what it kept. A Project Owner or Admin adds the
 * project's own statuses (a "Published" placed below Completed), or takes
 * Completed out.
 *
 * Why chosen, and not worked out from where a status sits: the statuses at
 * and below Completed all count as done, but done means two things - a
 * postmortem written ("Published") and one not needed ("Not Needed", "Won't
 * Do"). Keeping every done status would keep every Not Needed incident,
 * usually most of them; keeping done ones with a note would too wherever
 * OneUptime AI drafts a note for every resolved incident. Only the team
 * knows which of its statuses mean "written", so it says.
 */
export const MAX_KEPT_POSTMORTEM_STATUSES: number = 50;

// A list of status ids as a reader of a response or a row takes it: undefined when empty or not a list.
export function readKeptPostmortemStatusIds(
  value: unknown,
): Array<string> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const ids: Array<string> = [];

  for (const item of value) {
    const id: string =
      typeof item === "string" ? item.trim().toLowerCase() : "";

    if (UUID.test(id) && !ids.includes(id)) {
      ids.push(id);
    }
  }

  return ids.length > 0 ? ids : undefined;
}

/*
 * What is wrong with the statuses written to
 * Project.keepIncidentsInPostmortemStatusIds, or null for empty (the
 * Completed status) or a list of up to MAX_KEPT_POSTMORTEM_STATUSES ids.
 * Whether each is one of the project's own statuses is the server's to
 * check (ProjectService).
 */
export function getKeptPostmortemStatusIdsProblem(
  value: unknown,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (!Array.isArray(value)) {
    return "Pick the postmortem statuses that keep an incident as a list of their ids, or leave it empty for the Completed status.";
  }

  if (value.length === 0) {
    return "Pick at least one postmortem status that keeps an incident, or turn off keeping incidents with a completed postmortem.";
  }

  if (value.length > MAX_KEPT_POSTMORTEM_STATUSES) {
    return `Pick at most ${MAX_KEPT_POSTMORTEM_STATUSES} postmortem statuses that keep an incident.`;
  }

  for (const item of value) {
    if (typeof item !== "string" || !UUID.test(item.trim().toLowerCase())) {
      return "Each postmortem status that keeps an incident is named by its id.";
    }
  }

  return null;
}

// An id as the statuses' rows hold it.
const UUID: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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
