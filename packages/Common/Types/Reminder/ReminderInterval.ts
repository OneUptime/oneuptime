/*
 * HOW OFTEN A REMINDER RULE REMINDS: ITS INTERVAL, IN MINUTES.
 *
 * An incident's, an alert's and a scheduled maintenance event's reminder
 * rules (IncidentReminderRule, AlertReminderRule,
 * ScheduledMaintenanceReminderRule) remind the record's owners every
 * "Reminder Interval (Minutes)" (reminderIntervalInMinutes) while it is
 * open. The workers that send them (Workers/Jobs/IncidentOwners,
 * AlertOwners and ScheduledMaintenanceOwners,
 * SendUnresolvedReminderNotification) run every minute: each sends the
 * reminders that are due and puts the next one that many minutes later.
 *
 * The interval's only check was the one every required column has - is
 * there a value at all - the check that refused the 0% error budget policy
 * tier of #6978. It refused 0 as "reminderIntervalInMinutes is required",
 * and it took -5, which put each next reminder five minutes in the past:
 * the owners were reminded every minute, by every channel they have, until
 * the record was resolved. An edit was not checked at all, so 0 saved
 * there, and the rule then reminded nobody.
 *
 * Every write now holds the interval to a whole number of minutes from 1 to
 * a year: the Dashboard's forms, and the API, Terraform, MCP and workflows
 * through the three rules' services (Server/Utils/Rules/ReminderIntervalCheck).
 * A rule saved before with an interval below a minute reminds nobody, as a
 * rule without one always did, instead of reminding every minute.
 *
 * Server-free and React-free: the services, the workers and the Dashboard
 * read the same numbers and words from here.
 */

// The column every reminder rule keeps its interval in.
export const REMINDER_INTERVAL_COLUMN: string = "reminderIntervalInMinutes";

// The shortest interval: the workers that remind run once a minute.
export const MIN_REMINDER_INTERVAL_IN_MINUTES: number = 1;

/*
 * The longest: a year. Far longer than anything stays open, and a bound
 * keeps a typo - a number of seconds, say - from being saved as a number
 * the column cannot hold.
 */
export const MAX_REMINDER_INTERVAL_IN_MINUTES: number = 365 * 24 * 60;

export const REMINDER_INTERVAL_REFUSAL: string = `Reminder Interval (Minutes) must be a whole number of minutes from ${MIN_REMINDER_INTERVAL_IN_MINUTES} to ${MAX_REMINDER_INTERVAL_IN_MINUTES} (a year).`;

/*
 * The whole number a value is - a number, or one written as text ("30") -
 * or null for anything else: nothing, an empty box, a part of a minute,
 * words, true.
 */
function readWholeNumber(value: unknown): number | null {
  let minutes: number;

  if (typeof value === "number") {
    minutes = value;
  } else if (typeof value === "string" && value.trim().length > 0) {
    minutes = Number(value.trim());
  } else {
    return null;
  }

  return Number.isInteger(minutes) ? minutes : null;
}

/*
 * The interval a write may save, as the number the column stores - one
 * sent as text is the number it spells - or null when it may not be saved:
 * anything but a whole number of minutes from 1 to a year.
 */
export function readReminderIntervalInMinutes(value: unknown): number | null {
  const minutes: number | null = readWholeNumber(value);

  if (
    minutes === null ||
    minutes < MIN_REMINDER_INTERVAL_IN_MINUTES ||
    minutes > MAX_REMINDER_INTERVAL_IN_MINUTES
  ) {
    return null;
  }

  return minutes;
}

/*
 * Why a value cannot be saved as a rule's interval, or null when it can.
 * Nothing at all (undefined) is no interval written: an update keeps the
 * rule's own, and a create without one is refused by the required-column
 * check ("reminderIntervalInMinutes is required"). Null, an empty box, 0,
 * a negative number, a part of a minute and anything over a year are
 * refused.
 */
export function getReminderIntervalRefusal(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }

  return readReminderIntervalInMinutes(value) === null
    ? REMINDER_INTERVAL_REFUSAL
    : null;
}

/*
 * How often a saved rule reminds, in minutes, or null when it reminds
 * nobody. What the workers, the services that schedule a record's next
 * reminder, and the Dashboard's countdown to it read. A whole number of
 * minutes from 1 up, read as at most a year. Anything else - no interval,
 * or one below a minute, which only a rule saved before the check can hold
 * - reminds nobody, as a rule without an interval always did: never every
 * minute.
 */
export function getReminderIntervalInMinutes(value: unknown): number | null {
  const minutes: number | null = readWholeNumber(value);

  if (minutes === null || minutes < MIN_REMINDER_INTERVAL_IN_MINUTES) {
    return null;
  }

  return Math.min(minutes, MAX_REMINDER_INTERVAL_IN_MINUTES);
}
