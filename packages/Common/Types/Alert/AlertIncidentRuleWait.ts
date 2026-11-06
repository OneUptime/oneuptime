/*
 * HOW LONG AN ALERT INCIDENT RULE WAITS BEFORE IT DECLARES.
 *
 * An alert incident rule (AlertIncidentRule) declares an incident from an
 * alert it matches as soon as the alert is created, or - with a wait - only
 * if the alert is still unresolved that many minutes after it was created
 * ("Declare After (Minutes)", declareAfterInMinutes). The wait is what keeps
 * an alert that resolves on its own, a blip or a flapping check, from ever
 * becoming an incident.
 *
 * Server-free and React-free: the rule's service, its engine, the worker
 * that declares once a wait is up and the Dashboard's form all read the
 * same numbers and words from here.
 */

// The column the wait is stored in, as the model names it.
export const ALERT_INCIDENT_RULE_WAIT_COLUMN: string = "declareAfterInMinutes";

/*
 * The longest wait a rule may have: a week. An alert still unresolved after
 * that is long past being caught early, and a bound keeps a typo (a number
 * of seconds, say) from scheduling a check years away.
 */
export const ALERT_INCIDENT_RULE_MAX_WAIT_IN_MINUTES: number = 7 * 24 * 60;

/*
 * Why a value cannot be saved as a rule's wait, or null when it can: a
 * whole number of minutes from 0 (declare right away) to a week. A number
 * sent as text ("15") is the number it spells, as the database would store
 * it. Nothing at all - no value, or a form's emptied number box - is the
 * column's default, 0, and is fine.
 */
export function getAlertIncidentRuleWaitProblem(value: unknown): string | null {
  if (isNoWait(value)) {
    return null;
  }

  const minutes: number | null = readWaitInMinutes(value);

  if (minutes === null) {
    return "Declare After (Minutes) must be a whole number of minutes: 0 to declare the incident as soon as the alert is created, or how long the alert must stay unresolved first.";
  }

  if (minutes > ALERT_INCIDENT_RULE_MAX_WAIT_IN_MINUTES) {
    return `Declare After (Minutes) can be at most ${ALERT_INCIDENT_RULE_MAX_WAIT_IN_MINUTES} minutes (a week).`;
  }

  return null;
}

/*
 * The wait a stored or sent value means, in whole minutes: 0 for nothing,
 * and for anything that is not a whole number of minutes from 0 up - which
 * the service never saves, so only a row written around it can hold one -
 * so such a rule declares right away rather than never.
 */
export function getAlertIncidentRuleWaitInMinutes(value: unknown): number {
  const minutes: number | null = readWaitInMinutes(value);

  if (minutes === null) {
    return 0;
  }

  return Math.min(minutes, ALERT_INCIDENT_RULE_MAX_WAIT_IN_MINUTES);
}

// Whether a rule with this wait declares as soon as the alert is created.
export function doesAlertIncidentRuleDeclareRightAway(value: unknown): boolean {
  return getAlertIncidentRuleWaitInMinutes(value) === 0;
}

/*
 * When a rule with this wait declares from an alert created at
 * `alertCreatedAt`, if the alert is still unresolved then.
 */
export function getAlertIncidentRuleDeclareAt(data: {
  alertCreatedAt: Date;
  waitInMinutes: unknown;
}): Date {
  return new Date(
    data.alertCreatedAt.getTime() +
      getAlertIncidentRuleWaitInMinutes(data.waitInMinutes) * 60 * 1000,
  );
}

/*
 * "Right away", or "If still unresolved after 15 minutes": when a rule
 * declares, in English - for the API's and the server's own words. The
 * Dashboard words it in the reader's language (AlertIncidentRuleCopy).
 */
export function describeAlertIncidentRuleWait(value: unknown): string {
  const minutes: number = getAlertIncidentRuleWaitInMinutes(value);

  if (minutes === 0) {
    return "Right away";
  }

  return `If still unresolved after ${formatWait(minutes)}`;
}

/*
 * "15 minutes", "1 hour", "1 hour 30 minutes", "2 days": a wait as a person
 * says it, largest unit first, leaving out the units that are 0.
 */
export function formatAlertIncidentRuleWait(minutes: number): string {
  return formatWait(getAlertIncidentRuleWaitInMinutes(minutes));
}

function formatWait(totalMinutes: number): string {
  const days: number = Math.floor(totalMinutes / (24 * 60));
  const hours: number = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes: number = totalMinutes % 60;

  const parts: Array<string> = [];

  if (days > 0) {
    parts.push(`${days} ${days === 1 ? "day" : "days"}`);
  }

  if (hours > 0) {
    parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  }

  if (minutes > 0 || parts.length === 0) {
    parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
  }

  return parts.join(" ");
}

// No value at all: nothing, or text of nothing but spaces.
function isNoWait(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim().length === 0)
  );
}

// A whole number of minutes from 0 up, or null.
function readWaitInMinutes(value: unknown): number | null {
  let minutes: number;

  if (typeof value === "number") {
    minutes = value;
  } else if (typeof value === "string" && value.trim().length > 0) {
    minutes = Number(value.trim());
  } else {
    return null;
  }

  if (!Number.isInteger(minutes) || minutes < 0) {
    return null;
  }

  return minutes;
}
