import ScheduledMaintenanceReminderStopState from "./ScheduledMaintenanceReminderStopState";

/*
 * A SCHEDULED MAINTENANCE REMINDER RULE THAT WOULD NEVER REMIND.
 *
 * A reminder rule says when it reminds an event's owners with two columns:
 * "Remind While Event is Scheduled" (remindWhileScheduled) and "Stop
 * Reminders When" (stopRemindersOnState). With the switch off, the worker
 * holds the first reminder back until the event starts
 * (Workers/Jobs/ScheduledMaintenanceOwners/SendUnresolvedReminderNotification);
 * with Ongoing, the start is where reminders stop. Together they wait for
 * the start and stop at it: the rule matches every event it is meant for
 * and reminds nobody.
 *
 * The Dashboard's form never makes that pair - it asks one question with
 * three answers (Dashboard Components/Reminders/MaintenanceReminderTiming) -
 * and the server holds every other way of saving a rule to the same: the
 * API, Terraform, MCP and workflows (ScheduledMaintenanceReminderRuleService,
 * through Server/Utils/Database/ColumnRuleCheck). A rule stored that way
 * before the server refused it keeps working as it did: the rules list marks
 * it "Never reminds", and an edit that leaves the pair as it is (a rename)
 * still saves.
 *
 * Server-free and React-free: the server, the Dashboard and the tests read
 * the same rule.
 */

// The two columns the rule reads, as the model names them.
export const SCHEDULED_MAINTENANCE_REMINDER_TIMING_COLUMNS: ReadonlyArray<string> =
  ["remindWhileScheduled", "stopRemindersOnState"];

export interface ScheduledMaintenanceReminderTimingValues {
  remindWhileScheduled?: unknown;
  stopRemindersOnState?: unknown;
}

/*
 * Whether the pair waits for the event to start and stops when it starts. A
 * column not given is what a new rule stores: the switch off, Completed.
 */
export function doesScheduledMaintenanceReminderRuleNeverRemind(
  values: ScheduledMaintenanceReminderTimingValues,
): boolean {
  return (
    values.remindWhileScheduled !== true &&
    values.stopRemindersOnState ===
      ScheduledMaintenanceReminderStopState.Ongoing
  );
}

/*
 * What saving that pair is refused with, in the API's own column names:
 * what each of the two columns does to the rule, then the two ways out.
 */
export const SCHEDULED_MAINTENANCE_REMINDER_NEVER_REMINDS_REFUSAL: string =
  "This reminder rule would never send a reminder: Remind While Event is Scheduled is off, so it waits for the event to start, and Stop Reminders When is Ongoing, so it stops when the event starts. Turn on Remind While Event is Scheduled, or set Stop Reminders When to Completed.";

// The refusal for a pair that never reminds, or null for one that reminds.
export function getScheduledMaintenanceReminderRuleRefusal(
  values: ScheduledMaintenanceReminderTimingValues,
): string | null {
  return doesScheduledMaintenanceReminderRuleNeverRemind(values)
    ? SCHEDULED_MAINTENANCE_REMINDER_NEVER_REMINDS_REFUSAL
    : null;
}
