import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import ReminderStopState from "Common/Types/Reminder/ReminderStopState";
import type Field from "Common/UI/Components/Forms/Types/Field";
import type { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import type { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import type FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import type SelectFormFields from "Common/UI/Types/SelectEntityField";
import {
  ComposedValue,
  Translator,
  composedValue,
  translateTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import { formatGroupingDuration } from "../GroupingRule/GroupingRuleSetup";
import {
  DEFAULT_MAINTENANCE_REMINDER_TIMING,
  MAINTENANCE_REMINDER_RULE_NAME_WORDING,
  MAINTENANCE_REMINDER_TIMING_COLUMNS,
  MaintenanceReminderTiming,
  getMaintenanceReminderTiming,
} from "../../Components/Reminders/MaintenanceReminderTiming";
import {
  FILLED_IN_RULE_NAME_KEY,
  RULE_ENABLED_DESCRIPTION,
  RULE_NAME_MAX_LENGTH,
  RuleNameWording,
  followPicksWithRuleName,
  getFollowedRuleName,
  getRuleNameFromPicks,
} from "./ResourceRuleForm";

/*
 * CREATE AN ON-CALL, PRIVACY, SLA OR REMINDER RULE: WHAT IT MATCHES, THEN
 * WHAT IT DOES.
 *
 * Incidents, alerts, their episodes and scheduled maintenance have four
 * kinds of rule beside their label, owner and grouping rules: On-Call Rules
 * page on-call policies for a new record, Privacy Rules make it private, SLA
 * Rules track how fast an incident is acknowledged and resolved, and
 * Reminder Rules remind its owners while it is open. Their forms used to
 * start with "Basic Info" (or "Rule Info") - a name and a description,
 * before anyone had said what the rule was for - while the label, owner and
 * grouping rules on the same menu start with what the rule matches, then
 * what it does, and fill the name in from that (ResourceRuleForm). These
 * now ask the same way:
 *
 *   - Match (step id "match-criteria"): the page's criteria fields, drawn as
 *     one conditions builder (Common/UI/Components/RuleCriteria), which
 *     starts on "All incidents".
 *   - What the rule does, on a step of its own: the on-call policies it
 *     pages, the SLA's targets, how often it reminds. Then the rule's Name -
 *     filled in from what it does ("Page Platform on-call", "Remind every 30
 *     minutes until resolved") and following it until somebody types a name
 *     of their own - its Enabled switch on the Edit form only (a new rule
 *     starts on), and More fields, folded: the Description, and what most
 *     rules leave alone.
 *
 * A privacy rule does one thing - it makes what it matches private - so its
 * second step holds only its name, filled in, and says what the rule does.
 *
 * Nothing stored changes: every field is still the column it was, and a
 * rule saved through the API or Terraform is the rule it was.
 *
 * Every step id is written out as a string literal on each field, so the
 * form step guards (Common/Tests/Helpers/FormStepsScan.ts) can place them.
 */

// ---- Steps -----------------------------------------------------------------

// An on-call rule: what it matches, then the policies it pages.
export const getOnCallRuleFormSteps: <TEntity>() => Array<FormStep<TEntity>> = <
  TEntity,
>(): Array<FormStep<TEntity>> => {
  return [
    { title: "Match", id: "match-criteria" },
    { title: "On-Call Policies", id: "on-call" },
  ];
};

// A privacy rule: what it matches, then its name.
export const getPrivacyRuleFormSteps: <TEntity>() => Array<
  FormStep<TEntity>
> = <TEntity>(): Array<FormStep<TEntity>> => {
  return [
    { title: "Match", id: "match-criteria" },
    { title: "Name", id: "rule-name" },
  ];
};

// An SLA rule: what it matches, then its targets.
export const getSlaRuleFormSteps: <TEntity>() => Array<FormStep<TEntity>> = <
  TEntity,
>(): Array<FormStep<TEntity>> => {
  return [
    { title: "Match", id: "match-criteria" },
    { title: "Targets", id: "sla-targets" },
  ];
};

// A reminder rule: what it matches, then how often and until when it reminds.
export const getReminderRuleFormSteps: <TEntity>() => Array<
  FormStep<TEntity>
> = <TEntity>(): Array<FormStep<TEntity>> => {
  return [
    { title: "Match", id: "match-criteria" },
    { title: "Reminders", id: "reminder-settings" },
  ];
};

// ---- Names -----------------------------------------------------------------

type FormValuesRecord = Record<string, unknown>;

const asRecord: (values: unknown) => FormValuesRecord = (
  values: unknown,
): FormValuesRecord => {
  return values && typeof values === "object"
    ? (values as FormValuesRecord)
    : {};
};

// Digits only: what a number box holds once it is a whole number.
const WHOLE_NUMBER: RegExp = /^\d+$/;

/*
 * A whole number of minutes from what a number box holds - typed text or a
 * stored number - or null while it is empty or not a positive whole number.
 */
export const readMinutes: (value: unknown) => number | null = (
  value: unknown,
): number | null => {
  const text: string =
    typeof value === "number"
      ? String(value)
      : typeof value === "string"
        ? value.trim()
        : "";

  if (!text || !WHOLE_NUMBER.test(text)) {
    return null;
  }

  const minutes: number = Number(text);

  return minutes > 0 ? minutes : null;
};

/*
 * "30 minutes", "1 hour", "2 days", for a name's sentence: in the language
 * the sentence is in, so a language that has not worded the sentence yet
 * reads one English name, never "Remind every 30 Minuten until resolved".
 */
const formatMinutes: (minutes: number) => ComposedValue = (
  minutes: number,
): ComposedValue => {
  return composedValue((translator: Translator): string => {
    return formatGroupingDuration({
      minutes: minutes,
      translate: translator.translateTemplate,
    });
  });
};

// The name, cut to what the rule's Name column holds.
const fitName: (name: string) => string = (name: string): string => {
  return name.slice(0, RULE_NAME_MAX_LENGTH);
};

/*
 * The onChange of a field the rule is named after: the name follows the
 * field, while the name is still the form's own (getFollowedRuleName) -
 * empty, the name the form filled in last, or the name the old value made.
 * The field's own value is stored after this (FormField), so the new name
 * is made from the values with the new value laid over them.
 */
export type RuleNameFromValuesFunction = (values: FormValuesRecord) => string;

export const followValueWithRuleName: <TEntity>(data: {
  column: string;
  makeName: RuleNameFromValuesFunction;
}) => (
  value: unknown,
  currentValues: FormValues<TEntity>,
  setNewFormValues: (values: FormValues<TEntity>) => void,
) => void = <TEntity>(data: {
  column: string;
  makeName: RuleNameFromValuesFunction;
}): ((
  value: unknown,
  currentValues: FormValues<TEntity>,
  setNewFormValues: (values: FormValues<TEntity>) => void,
) => void) => {
  return (
    value: unknown,
    currentValues: FormValues<TEntity>,
    setNewFormValues: (values: FormValues<TEntity>) => void,
  ): void => {
    const values: FormValuesRecord = asRecord(currentValues);

    const name: string | null = getFollowedRuleName({
      name: values["name"],
      filledInName: values[FILLED_IN_RULE_NAME_KEY],
      previousName: data.makeName(values),
      nextName: data.makeName({ ...values, [data.column]: value }),
    });

    if (name === null) {
      return;
    }

    setNewFormValues({
      ...values,
      name: name,
      [FILLED_IN_RULE_NAME_KEY]: name,
    } as unknown as FormValues<TEntity>);
  };
};

// ---- On-call rules ---------------------------------------------------------

/*
 * "Page Platform on-call": an on-call rule is named after the policies it
 * pages, as a label rule is after its labels - as many as fit, then a count.
 */
export const ON_CALL_RULE_NAME_WORDING: RuleNameWording = {
  picksSlot: "policies",
  allPicks: translationKey("Page {{policies}}"),
  somePicks: {
    one: "Page {{policies}} and {{count}} more",
    other: "Page {{policies}} and {{count}} more",
  },
};

export const getOnCallRuleName: (policyNames: Array<string>) => string = (
  policyNames: Array<string>,
): string => {
  return getRuleNameFromPicks(ON_CALL_RULE_NAME_WORDING, policyNames);
};

export const ON_CALL_RULE_POLICIES_DESCRIPTION: string = translationKey(
  "The on-call policies to page when this rule matches. Each runs once, even when another rule picks it too.",
);

export const ON_CALL_RULE_NAME_DESCRIPTION: string = translationKey(
  "Named after the policies it pages until you type a name of your own.",
);

/**
 * Everything on an on-call rule's On-Call Policies step: the policies it
 * pages (required), its name (filled in from them), its Enabled switch on
 * the Edit form only, and its description folded under More fields.
 */
export const getOnCallRuleActionFields: <TEntity>() => Array<Field<TEntity>> = <
  TEntity,
>(): Array<Field<TEntity>> => {
  const moreFields: FormFieldCollapsibleSection<TEntity> =
    getAdvancedFormSection<TEntity>();

  return [
    {
      field: {
        onCallDutyPolicies: true,
      } as unknown as SelectFormFields<TEntity>,
      title: "On-Call Duty Policies",
      description: ON_CALL_RULE_POLICIES_DESCRIPTION,
      stepId: "on-call",
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      dropdownModal: {
        type: OnCallDutyPolicy,
        labelField: "name",
        valueField: "_id",
      },
      required: true,
      placeholder: "Select On-Call Policies",
      onChange: followPicksWithRuleName<TEntity>(getOnCallRuleName),
    },
    {
      field: { name: true } as unknown as SelectFormFields<TEntity>,
      title: "Name",
      description: ON_CALL_RULE_NAME_DESCRIPTION,
      stepId: "on-call",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "e.g. Page Platform on-call",
      validation: {
        minLength: 2,
        maxLength: RULE_NAME_MAX_LENGTH,
      },
    },
    {
      field: { isEnabled: true } as unknown as SelectFormFields<TEntity>,
      title: "Enabled",
      description: RULE_ENABLED_DESCRIPTION,
      stepId: "on-call",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      // A rule starts on: the switch is on its edit form only.
      doNotShowWhenCreating: true,
    },
    {
      field: { description: true } as unknown as SelectFormFields<TEntity>,
      title: "Description",
      stepId: "on-call",
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      collapsibleSection: moreFields,
    },
  ];
};

// ---- Privacy rules ---------------------------------------------------------

export type PrivacyRuleRecord =
  | "incident"
  | "incidentEpisode"
  | "alert"
  | "alertEpisode";

/*
 * The name a new privacy rule starts with. A privacy rule does one thing -
 * makes what it matches private - so its name says that; its conditions
 * show in the list beside it. Typed over like any other name.
 */
export const PRIVACY_RULE_NAMES: Record<PrivacyRuleRecord, string> = {
  incident: translationKey("Make incidents private"),
  incidentEpisode: translationKey("Make incident episodes private"),
  alert: translationKey("Make alerts private"),
  alertEpisode: translationKey("Make alert episodes private"),
};

// What the rule does, said where its name is asked for.
export const PRIVACY_RULE_NAME_DESCRIPTIONS: Record<PrivacyRuleRecord, string> =
  {
    incident: translationKey(
      "Incidents this rule matches become private: only their owners, project admins and project owners can see them.",
    ),
    incidentEpisode: translationKey(
      "Episodes this rule matches become private: only their owners, project admins and project owners can see them.",
    ),
    alert: translationKey(
      "Alerts this rule matches become private: only their owners, project admins and project owners can see them.",
    ),
    alertEpisode: translationKey(
      "Episodes this rule matches become private: only their owners, project admins and project owners can see them.",
    ),
  };

/**
 * Everything on a privacy rule's Name step: its name, filled in in the
 * creator's language and saying what the rule does, its Enabled switch on
 * the Edit form only, and its description folded under More fields.
 */
export const getPrivacyRuleActionFields: <TEntity>(
  record: PrivacyRuleRecord,
) => Array<Field<TEntity>> = <TEntity>(
  record: PrivacyRuleRecord,
): Array<Field<TEntity>> => {
  const moreFields: FormFieldCollapsibleSection<TEntity> =
    getAdvancedFormSection<TEntity>();

  return [
    {
      field: { name: true } as unknown as SelectFormFields<TEntity>,
      title: "Name",
      description: PRIVACY_RULE_NAME_DESCRIPTIONS[record],
      stepId: "rule-name",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      defaultValue: fitName(translateTemplate(PRIVACY_RULE_NAMES[record])),
      validation: {
        minLength: 2,
        maxLength: RULE_NAME_MAX_LENGTH,
      },
    },
    {
      field: { isEnabled: true } as unknown as SelectFormFields<TEntity>,
      title: "Enabled",
      description: RULE_ENABLED_DESCRIPTION,
      stepId: "rule-name",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      // A rule starts on: the switch is on its edit form only.
      doNotShowWhenCreating: true,
    },
    {
      field: { description: true } as unknown as SelectFormFields<TEntity>,
      title: "Description",
      stepId: "rule-name",
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      collapsibleSection: moreFields,
    },
  ];
};

// ---- SLA rules -------------------------------------------------------------

/*
 * "Respond in 15 minutes, resolve in 4 hours": an SLA rule is named after
 * its targets, as many as it has.
 */
export const SLA_RULE_NAME_WORDING: {
  both: string;
  response: string;
  resolution: string;
} = {
  both: translationKey("Respond in {{response}}, resolve in {{resolution}}"),
  response: translationKey("Respond in {{response}}"),
  resolution: translationKey("Resolve in {{resolution}}"),
};

// An SLA rule's name from its targets, or "" while it has none.
export const getSlaRuleName: RuleNameFromValuesFunction = (
  values: FormValuesRecord,
): string => {
  const response: number | null = readMinutes(values["responseTimeInMinutes"]);
  const resolution: number | null = readMinutes(
    values["resolutionTimeInMinutes"],
  );

  if (response !== null && resolution !== null) {
    return fitName(
      translateTemplate(SLA_RULE_NAME_WORDING.both, {
        response: formatMinutes(response),
        resolution: formatMinutes(resolution),
      }),
    );
  }

  if (response !== null) {
    return fitName(
      translateTemplate(SLA_RULE_NAME_WORDING.response, {
        response: formatMinutes(response),
      }),
    );
  }

  if (resolution !== null) {
    return fitName(
      translateTemplate(SLA_RULE_NAME_WORDING.resolution, {
        resolution: formatMinutes(resolution),
      }),
    );
  }

  return "";
};

export const SLA_RULE_NAME_DESCRIPTION: string = translationKey(
  "Named after its targets until you type a name of your own.",
);

// ---- Reminder rules --------------------------------------------------------

export type ReminderRuleRecord = "incident" | "alert";

// How often a new reminder rule reminds, until somebody changes it.
export const DEFAULT_REMINDER_INTERVAL_IN_MINUTES: number = 30;

/*
 * "Remind every 30 minutes until resolved": a reminder rule is named after
 * how often it reminds and when it stops.
 */
export const REMINDER_RULE_NAME_WORDING: Record<ReminderStopState, string> = {
  [ReminderStopState.Resolved]: translationKey(
    "Remind every {{interval}} until resolved",
  ),
  [ReminderStopState.Acknowledged]: translationKey(
    "Remind every {{interval}} until acknowledged",
  ),
};

/*
 * When an incident's or an alert's reminders stop: the two answers, each
 * with what it means. Resolved first: it is where a new rule starts, as the
 * column does.
 */
export const REMINDER_STOP_OPTION_DESCRIPTIONS: Record<
  ReminderRuleRecord,
  Record<ReminderStopState, string>
> = {
  incident: {
    [ReminderStopState.Resolved]: translationKey(
      "Keep reminding until the incident is resolved.",
    ),
    [ReminderStopState.Acknowledged]: translationKey(
      "Stop once someone acknowledges the incident.",
    ),
  },
  alert: {
    [ReminderStopState.Resolved]: translationKey(
      "Keep reminding until the alert is resolved.",
    ),
    [ReminderStopState.Acknowledged]: translationKey(
      "Stop once someone acknowledges the alert.",
    ),
  },
};

const readStopState: (value: unknown) => ReminderStopState = (
  value: unknown,
): ReminderStopState => {
  return value === ReminderStopState.Acknowledged
    ? ReminderStopState.Acknowledged
    : ReminderStopState.Resolved;
};

// A reminder rule's name from its interval and when it stops, or "".
export const getReminderRuleName: RuleNameFromValuesFunction = (
  values: FormValuesRecord,
): string => {
  const interval: number | null = readMinutes(
    values["reminderIntervalInMinutes"],
  );

  if (interval === null) {
    return "";
  }

  return fitName(
    translateTemplate(
      REMINDER_RULE_NAME_WORDING[readStopState(values["stopRemindersOnState"])],
      { interval: formatMinutes(interval) },
    ),
  );
};

export const REMINDER_RULE_NAME_DESCRIPTION: string = translationKey(
  "Named after how often it reminds until you type a name of your own.",
);

export const REMINDER_INTERVAL_DESCRIPTIONS: Record<
  ReminderRuleRecord,
  string
> = {
  incident: translationKey(
    "How often to remind the incident's owners while it is open.",
  ),
  alert: translationKey(
    "How often to remind the alert's owners while it is open.",
  ),
};

/**
 * Everything on an incident's or an alert's reminder rule's Reminders step:
 * how often it reminds (30 minutes for a new rule), when it stops - Resolved
 * or Acknowledged, two plain answers where a dropdown was - its name, filled
 * in from both, its Enabled switch on the Edit form only, and its
 * description folded under More fields.
 */
export const getReminderRuleActionFields: <TEntity>(
  record: ReminderRuleRecord,
) => Array<Field<TEntity>> = <TEntity>(
  record: ReminderRuleRecord,
): Array<Field<TEntity>> => {
  const moreFields: FormFieldCollapsibleSection<TEntity> =
    getAdvancedFormSection<TEntity>();

  return [
    {
      field: {
        reminderIntervalInMinutes: true,
      } as unknown as SelectFormFields<TEntity>,
      title: "Reminder Interval (minutes)",
      description: REMINDER_INTERVAL_DESCRIPTIONS[record],
      stepId: "reminder-settings",
      fieldType: FormFieldSchemaType.Number,
      required: true,
      placeholder: "30",
      defaultValue: DEFAULT_REMINDER_INTERVAL_IN_MINUTES,
      onChange: followValueWithRuleName<TEntity>({
        column: "reminderIntervalInMinutes",
        makeName: getReminderRuleName,
      }),
    },
    {
      field: {
        stopRemindersOnState: true,
      } as unknown as SelectFormFields<TEntity>,
      title: "Stop Reminders When",
      stepId: "reminder-settings",
      fieldType: FormFieldSchemaType.RadioButton,
      required: true,
      // Each answer says what it means: the column's sentence would repeat it.
      hideColumnDescription: true,
      dataTestId: "reminder-stop-state",
      radioButtonOptions: [
        {
          title: "Resolved",
          description:
            REMINDER_STOP_OPTION_DESCRIPTIONS[record][
              ReminderStopState.Resolved
            ],
          value: ReminderStopState.Resolved,
        },
        {
          title: "Acknowledged",
          description:
            REMINDER_STOP_OPTION_DESCRIPTIONS[record][
              ReminderStopState.Acknowledged
            ],
          value: ReminderStopState.Acknowledged,
        },
      ],
      onChange: followValueWithRuleName<TEntity>({
        column: "stopRemindersOnState",
        makeName: getReminderRuleName,
      }),
    },
    {
      field: { name: true } as unknown as SelectFormFields<TEntity>,
      title: "Name",
      description: REMINDER_RULE_NAME_DESCRIPTION,
      stepId: "reminder-settings",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      // Named after the interval and the stop a new rule starts with.
      defaultValue: getReminderRuleName({
        reminderIntervalInMinutes: DEFAULT_REMINDER_INTERVAL_IN_MINUTES,
        stopRemindersOnState: ReminderStopState.Resolved,
      }),
      validation: {
        minLength: 2,
        maxLength: RULE_NAME_MAX_LENGTH,
      },
    },
    {
      field: { isEnabled: true } as unknown as SelectFormFields<TEntity>,
      title: "Enabled",
      description: RULE_ENABLED_DESCRIPTION,
      stepId: "reminder-settings",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      // A rule starts on: the switch is on its edit form only.
      doNotShowWhenCreating: true,
    },
    {
      field: { description: true } as unknown as SelectFormFields<TEntity>,
      title: "Description",
      stepId: "reminder-settings",
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      collapsibleSection: moreFields,
    },
  ];
};

// ---- Scheduled maintenance reminder rules ----------------------------------

/*
 * A scheduled maintenance reminder rule's name: "Remind every 30 minutes
 * while it is in progress" - how often, and the answer its two columns make
 * (MaintenanceReminderTiming). "" while it has no interval, or while its
 * columns make the pair that never reminds.
 */
export const getMaintenanceReminderRuleName: RuleNameFromValuesFunction = (
  values: FormValuesRecord,
): string => {
  const interval: number | null = readMinutes(
    values["reminderIntervalInMinutes"],
  );
  const timing: MaintenanceReminderTiming | null =
    getMaintenanceReminderTiming(values);

  if (interval === null || timing === null) {
    return "";
  }

  return fitName(
    translateTemplate(MAINTENANCE_REMINDER_RULE_NAME_WORDING[timing], {
      interval: formatMinutes(interval),
    }),
  );
};

// The name a new maintenance reminder rule starts with.
export const getNewMaintenanceReminderRuleName: () => string = (): string => {
  return getMaintenanceReminderRuleName({
    reminderIntervalInMinutes: DEFAULT_REMINDER_INTERVAL_IN_MINUTES,
    ...MAINTENANCE_REMINDER_TIMING_COLUMNS[DEFAULT_MAINTENANCE_REMINDER_TIMING],
  });
};

export const MAINTENANCE_REMINDER_INTERVAL_DESCRIPTION: string = translationKey(
  "How often to remind the event's owners.",
);
