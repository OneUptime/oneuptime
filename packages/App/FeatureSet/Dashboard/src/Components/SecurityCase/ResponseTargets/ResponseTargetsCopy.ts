import { SecurityCaseTarget } from "Common/Utils/SecurityCase/SecurityCaseTargets";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Every word the response targets are drawn with - Security Events >
 * Settings > Response Targets, the case's header and Overview, the case
 * lists' Due column - kept as English keys the locales translate, and the
 * test ids the offline browser suite reads. React-free, so a plain test pins
 * them.
 */

export const RESPONSE_TARGETS_COPY: {
  title: string;
  description: string;
  singularName: string;
  pluralName: string;
  priorityColumn: string;
  acknowledgeColumn: string;
  containColumn: string;
  acknowledgeTooltip: string;
  containTooltip: string;
  noTarget: string;
  acknowledgeFieldDescription: string;
  containFieldDescription: string;
  editTitle: string;
  dueColumn: string;
} = {
  title: translationKey("Response Targets"),
  description: translationKey(
    "How fast a case at each priority must be taken on and contained. When a case is about to miss a target, or misses it, the people on it are told.",
  ),
  singularName: translationKey("Response Target"),
  pluralName: translationKey("Response Targets"),
  priorityColumn: translationKey("Priority"),
  acknowledgeColumn: translationKey("Acknowledge Within"),
  containColumn: translationKey("Contain Within"),
  acknowledgeTooltip: translationKey(
    "From when a case opens to when somebody takes it on: assigns it to a person, or moves it on from New.",
  ),
  containTooltip: translationKey(
    "From when a case opens to when it is contained, or closed.",
  ),
  noTarget: translationKey("No target"),
  acknowledgeFieldDescription: translationKey(
    "How long a new case at this priority may wait for somebody to take it on. Leave empty for no target.",
  ),
  containFieldDescription: translationKey(
    "How long a case at this priority may take to be contained or closed, from when it opens. Leave empty for no target.",
  ),
  // Edit's dialog: which priority's targets it changes.
  editTitle: translationKey("Edit Targets for {{priority}}"),
  dueColumn: translationKey("Due"),
};

// What a target is called on its own: a column's subline, a tooltip.
export const SECURITY_CASE_TARGET_NAMES: Readonly<
  Record<SecurityCaseTarget, string>
> = {
  [SecurityCaseTarget.Acknowledge]: translationKey("Acknowledge"),
  [SecurityCaseTarget.Contain]: translationKey("Contain"),
};

/*
 * The case header's chip, and the Due column: the next target, and when.
 * {{time}} is a duration in the reader's language ("12 min", "4 Std.").
 */
export const SECURITY_CASE_TARGET_DUE_IN: Readonly<
  Record<SecurityCaseTarget, string>
> = {
  [SecurityCaseTarget.Acknowledge]: translationKey("Acknowledge in {{time}}"),
  [SecurityCaseTarget.Contain]: translationKey("Contain in {{time}}"),
};

export const SECURITY_CASE_TARGET_OVERDUE_BY: Readonly<
  Record<SecurityCaseTarget, string>
> = {
  [SecurityCaseTarget.Acknowledge]: translationKey(
    "Acknowledge overdue by {{time}}",
  ),
  [SecurityCaseTarget.Contain]: translationKey("Contain overdue by {{time}}"),
};

// The chip's tooltip: when it is due, as a date and time.
export const SECURITY_CASE_TARGET_DUE_AT: string =
  translationKey("Due {{time}}");

// The Due column's two lines: when, then which target.
export const SECURITY_CASE_DUE_CELL_IN: string = translationKey("in {{time}}");
export const SECURITY_CASE_DUE_CELL_OVERDUE: string =
  translationKey("{{time}} overdue");

/*
 * Under the Overview's Time to Acknowledge and Time to Contain figures:
 * where the case stands against the target.
 */
export const SECURITY_CASE_TARGET_TILE_NOTES: {
  dueIn: string;
  overdueBy: string;
  withinTarget: string;
  overTarget: string;
  metByDueTime: string;
  pastDueTime: string;
} = {
  dueIn: translationKey("Due in {{time}}"),
  overdueBy: translationKey("Overdue by {{time}}"),
  withinTarget: translationKey("Within its {{target}} target"),
  overTarget: translationKey("{{time}} over its {{target}} target"),
  metByDueTime: translationKey("Met by its due time"),
  pastDueTime: translationKey("{{time}} past its due time"),
};

// The duration field's units, and what it says when a value cannot be kept.
export const RESPONSE_TARGET_DURATION_COPY: {
  minutes: string;
  hours: string;
  days: string;
  unitLabel: string;
  amountLabel: string;
  wholeNumber: string;
  tooLong: string;
} = {
  minutes: translationKey("Minutes"),
  hours: translationKey("Hours"),
  days: translationKey("Days"),
  unitLabel: translationKey("Unit"),
  amountLabel: translationKey("Amount"),
  wholeNumber: translationKey(
    "Enter a whole number from 1 up, or leave it empty.",
  ),
  tooLong: translationKey("A target can be a year at the most."),
};

export const RESPONSE_TARGETS_TEST_IDS: {
  table: string;
  chip: string;
  dueCell: string;
  dueLine: string;
  tileNote: string;
  durationField: string;
  durationAmount: string;
  durationUnit: string;
} = {
  table: "security-response-targets-table",
  chip: "security-case-target-chip",
  dueCell: "security-case-row-due",
  dueLine: "security-case-row-due-line",
  tileNote: "security-case-target-note",
  durationField: "response-target-duration",
  durationAmount: "response-target-duration-amount",
  durationUnit: "response-target-duration-unit",
};
