import ScheduledMaintenanceReminderStopState from "Common/Types/Reminder/ScheduledMaintenanceReminderStopState";
import { doesScheduledMaintenanceReminderRuleNeverRemind } from "Common/Types/Reminder/ScheduledMaintenanceReminderNeverReminds";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * WHEN A SCHEDULED MAINTENANCE REMINDER RULE REMINDS: ONE PLAIN CHOICE.
 *
 * A maintenance reminder rule used to ask two things: "Stop Reminders When"
 * - the event starts (Ongoing), or it is completed - and a switch, "Remind
 * While Event is Scheduled", whose help explained both of its modes ("When
 * off, reminders only begin once the event has started"). Read together
 * they mean three plain answers, and one combination that never reminds at
 * all: wait for the start (the switch off), then stop at the start
 * (Ongoing) - the worker defers the first reminder to the start, and the
 * start stops it (Workers/Jobs/ScheduledMaintenanceOwners/
 * SendUnresolvedReminderNotification).
 *
 * So the form asks one question, "Remind Owners", with the three answers.
 * Each answer is written into the rule's two columns, which are unchanged:
 * the API, Terraform and every stored rule keep what they mean. A new rule
 * starts on "While it is in progress", which is what the columns' defaults
 * (switch off, Completed) always did. The server refuses the combination
 * that never reminds however a rule is saved - the API, Terraform, MCP
 * (Common/Types/Reminder/ScheduledMaintenanceReminderNeverReminds) - and a
 * rule stored that way before it did shows no answer picked, and says so,
 * until one is.
 *
 * Kept free of React, so App/Tests can read it.
 */

export enum MaintenanceReminderTiming {
  // From the event's start until it is completed: the columns' defaults.
  WhileInProgress = "while-in-progress",
  // From when it is scheduled until it starts.
  BeforeItStarts = "before-it-starts",
  // From when it is scheduled until it is completed.
  BeforeAndDuring = "before-and-during",
}

export interface MaintenanceReminderColumns {
  remindWhileScheduled: boolean;
  stopRemindersOnState: ScheduledMaintenanceReminderStopState;
}

// The answers, in the order the form offers them: the new rule's first.
export const MAINTENANCE_REMINDER_TIMINGS: ReadonlyArray<MaintenanceReminderTiming> =
  [
    MaintenanceReminderTiming.WhileInProgress,
    MaintenanceReminderTiming.BeforeItStarts,
    MaintenanceReminderTiming.BeforeAndDuring,
  ];

export const DEFAULT_MAINTENANCE_REMINDER_TIMING: MaintenanceReminderTiming =
  MaintenanceReminderTiming.WhileInProgress;

// What each answer stores.
export const MAINTENANCE_REMINDER_TIMING_COLUMNS: Record<
  MaintenanceReminderTiming,
  MaintenanceReminderColumns
> = {
  [MaintenanceReminderTiming.WhileInProgress]: {
    remindWhileScheduled: false,
    stopRemindersOnState: ScheduledMaintenanceReminderStopState.Completed,
  },
  [MaintenanceReminderTiming.BeforeItStarts]: {
    remindWhileScheduled: true,
    stopRemindersOnState: ScheduledMaintenanceReminderStopState.Ongoing,
  },
  [MaintenanceReminderTiming.BeforeAndDuring]: {
    remindWhileScheduled: true,
    stopRemindersOnState: ScheduledMaintenanceReminderStopState.Completed,
  },
};

export const MAINTENANCE_REMINDER_TIMING_FIELD_TITLE: string =
  translationKey("Remind Owners");

export const MAINTENANCE_REMINDER_TIMING_COPY: Record<
  MaintenanceReminderTiming,
  { title: string; description: string }
> = {
  [MaintenanceReminderTiming.WhileInProgress]: {
    title: translationKey("While it is in progress"),
    description: translationKey("From when the event starts until it ends."),
  },
  [MaintenanceReminderTiming.BeforeItStarts]: {
    title: translationKey("Before it starts"),
    description: translationKey(
      "From when the event is scheduled until it starts.",
    ),
  },
  [MaintenanceReminderTiming.BeforeAndDuring]: {
    title: translationKey("Before it starts and while it is in progress"),
    description: translationKey(
      "From when the event is scheduled until it ends.",
    ),
  },
};

/*
 * A rule stored with the two that clash: its Edit form shows this note in
 * place of an answer, and the rules list marks it "Never reminds" (with the
 * note as the mark's tooltip), as label and owner rules that add nothing
 * are marked "Adds nothing".
 */
export const MAINTENANCE_REMINDER_NEVER_REMINDS_NOTE: string = translationKey(
  "This rule never sends a reminder: it waits for the event to start and stops when it starts. Pick when to remind.",
);

export const MAINTENANCE_REMINDER_NEVER_REMINDS_TEXT: string =
  translationKey("Never reminds");

/*
 * "Remind every 30 minutes while it is in progress": the rule's name after
 * how often and when it reminds.
 */
export const MAINTENANCE_REMINDER_RULE_NAME_WORDING: Record<
  MaintenanceReminderTiming,
  string
> = {
  [MaintenanceReminderTiming.WhileInProgress]: translationKey(
    "Remind every {{interval}} while it is in progress",
  ),
  [MaintenanceReminderTiming.BeforeItStarts]: translationKey(
    "Remind every {{interval}} before it starts",
  ),
  [MaintenanceReminderTiming.BeforeAndDuring]: translationKey(
    "Remind every {{interval}} before and during the event",
  ),
};

const isStopState: (
  value: unknown,
) => value is ScheduledMaintenanceReminderStopState = (
  value: unknown,
): value is ScheduledMaintenanceReminderStopState => {
  return (
    value === ScheduledMaintenanceReminderStopState.Ongoing ||
    value === ScheduledMaintenanceReminderStopState.Completed
  );
};

/**
 * The answer a rule's two columns make, or null for the combination that
 * never reminds. A column the form has not read yet is what a new rule
 * stores: the switch off, Completed.
 */
export const getMaintenanceReminderTiming: (values: {
  remindWhileScheduled?: unknown;
  stopRemindersOnState?: unknown;
}) => MaintenanceReminderTiming | null = (values: {
  remindWhileScheduled?: unknown;
  stopRemindersOnState?: unknown;
}): MaintenanceReminderTiming | null => {
  const remindsWhileScheduled: boolean = values.remindWhileScheduled === true;
  const stopsAtTheStart: boolean =
    isStopState(values.stopRemindersOnState) &&
    values.stopRemindersOnState ===
      ScheduledMaintenanceReminderStopState.Ongoing;

  /*
   * The pair that never reminds, read by the rule the server refuses it
   * with (ScheduledMaintenanceReminderNeverReminds).
   */
  if (doesScheduledMaintenanceReminderRuleNeverRemind(values)) {
    return null;
  }

  if (!remindsWhileScheduled) {
    return MaintenanceReminderTiming.WhileInProgress;
  }

  return stopsAtTheStart
    ? MaintenanceReminderTiming.BeforeItStarts
    : MaintenanceReminderTiming.BeforeAndDuring;
};

export const isMaintenanceReminderTiming: (
  value: unknown,
) => value is MaintenanceReminderTiming = (
  value: unknown,
): value is MaintenanceReminderTiming => {
  return MAINTENANCE_REMINDER_TIMINGS.includes(
    value as MaintenanceReminderTiming,
  );
};
