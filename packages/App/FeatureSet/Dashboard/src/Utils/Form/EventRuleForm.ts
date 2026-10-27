import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import OneUptimeDate from "Common/Types/Date";
import OnCallRuleWhenToPage from "Common/Types/OnCallDutyPolicy/OnCallRuleWhenToPage";
import RestrictionTimes from "Common/Types/OnCallDutyPolicy/RestrictionTimes";
import WorkingHours, {
  WORKING_HOURS_DAILY_WINDOW_EMPTY_MESSAGE,
  WORKING_HOURS_NOT_SET_MESSAGE,
  WORKING_HOURS_NO_WEEKLY_WINDOWS_MESSAGE,
  WORKING_HOURS_TIMEZONE_NOT_SET_MESSAGE,
  WORKING_HOURS_WEEKLY_WINDOW_EMPTY_MESSAGE,
} from "Common/Types/OnCallDutyPolicy/WorkingHours";
import ReminderStopState from "Common/Types/Reminder/ReminderStopState";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import type Field from "Common/UI/Components/Forms/Types/Field";
import type {
  CustomElementProps,
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import type { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import type FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import type SelectFormFields from "Common/UI/Types/SelectEntityField";
import TimezoneUtil from "Common/UI/Utils/Timezone";
import {
  ComposedValue,
  PluralTemplate,
  Translator,
  composedValue,
  getGlobalTranslator,
  translatePlural,
  translateTemplate,
  translateText,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import React, { ReactElement } from "react";
import WorkingHoursPicker from "../../Components/OnCallRule/WorkingHoursPicker";
import WorkingHoursSummary from "../../Components/OnCallRule/WorkingHoursSummary";
import AiFirstResponderSummary, {
  ComponentProps as AiFirstResponderSummaryProps,
} from "../../Components/OnCallRule/AiFirstResponderSummary";
import {
  AI_HOLD_TIME_DEFAULT_IN_MINUTES,
  AI_HOLD_TIME_MAX_IN_MINUTES,
  AI_HOLD_TIME_MIN_IN_MINUTES,
  getAiHoldTimeInMinutes,
} from "Common/Types/OnCallDutyPolicy/OnCallPolicyAiHold";
import {
  OnCallRuleRecord,
  WorkingHoursOfRule,
  describeWorkingHours,
} from "../../Components/OnCallRule/WorkingHoursText";
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
 * CREATE AN ON-CALL, PRIVACY, SLA, REMINDER OR RUNBOOK RULE: WHAT IT
 * MATCHES, THEN WHAT IT DOES.
 *
 * Incidents, alerts, their episodes and scheduled maintenance have these
 * kinds of rule beside their label, owner and grouping rules: On-Call Rules
 * page on-call policies for a new record, Privacy Rules make it private, SLA
 * Rules track how fast an incident is acknowledged and resolved, Reminder
 * Rules remind its owners while it is open, and Runbook Rules start runbooks
 * for it (incidents, alerts and scheduled maintenance). Their forms used to
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
 *     pages, the SLA's targets, how often it reminds, the runbooks it
 *     starts. Then the rule's Name - filled in from what it does ("Page
 *     Platform on-call", "Remind every 30 minutes until resolved", "Start
 *     Database failover") and following it until somebody types a name
 *     of their own - its Enabled switch on the Edit form only (a new rule
 *     starts on), and More fields, folded: the Description, and what most
 *     rules leave alone - for an on-call rule, when it pages.
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

/*
 * A runbook rule - on the Rules menus of incidents, alerts and scheduled
 * maintenance: what it matches, then the runbooks it starts.
 */
export const getRunbookRuleFormSteps: <TEntity>() => Array<
  FormStep<TEntity>
> = <TEntity>(): Array<FormStep<TEntity>> => {
  return [
    { title: "Match", id: "match-criteria" },
    { title: "Runbooks", id: "runbooks" },
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

/*
 * What the field is for, in one line. That a policy picked by two matching
 * rules still runs once is for the help panel and the docs, which say it.
 */
export const ON_CALL_RULE_POLICIES_DESCRIPTION: string = translationKey(
  "The on-call policies to page when this rule matches.",
);

export const ON_CALL_RULE_NAME_DESCRIPTION: string = translationKey(
  "Named after the policies it pages until you type a name of your own.",
);

// ---- When an on-call rule pages ------------------------------------------

/*
 * WHEN SHOULD THIS RULE PAGE? (OnCallRuleWhenToPage): right away, as rules
 * always have, or only during working hours - a record that matches outside
 * them waits, and paging starts when they begin (OnCallDutyPolicyRunWait).
 * Most rules page right away, so the question waits under More fields, with
 * the description, and a rule that pages right away is not named there.
 *
 * Picking "Only during working hours" fills in what most people mean by it -
 * Monday to Friday, 09:00 to 17:00 - in the reader's own time zone, and
 * shows both, to change: the days and two times (WorkingHoursPicker), then
 * the zone. Under the choice, one sentence says what will happen
 * (WorkingHoursSummary). Changing the zone keeps the hours on the clock:
 * 09:00 to 17:00 stays 09:00 to 17:00 in the zone picked.
 */
export const WHEN_TO_PAGE_TITLE: string = translationKey(
  "When should this rule page?",
);

export const WHEN_TO_PAGE_TITLES: Record<OnCallRuleWhenToPage, string> = {
  [OnCallRuleWhenToPage.RightAway]: translationKey("Right away"),
  [OnCallRuleWhenToPage.WorkingHours]: translationKey(
    "Only during working hours",
  ),
  [OnCallRuleWhenToPage.AfterOneUptimeAI]: translationKey(
    "After OneUptime AI tries",
  ),
};

export const WHEN_TO_PAGE_DESCRIPTIONS: Record<OnCallRuleWhenToPage, string> = {
  [OnCallRuleWhenToPage.RightAway]: translationKey(
    "Page as soon as this rule matches.",
  ),
  [OnCallRuleWhenToPage.WorkingHours]: translationKey(
    "Outside working hours, wait and page when they begin.",
  ),
  [OnCallRuleWhenToPage.AfterOneUptimeAI]: translationKey(
    "OneUptime AI looks first and fixes what it may. If it hasn't resolved this in time, page as usual.",
  ),
};

/*
 * "After OneUptime AI tries" (OnCallPolicyAiHold) is offered on alert and
 * incident rules: OneUptime AI investigates those, not episodes. Like working
 * hours, it shows one field of its own - how long AI may hold the page - and
 * under the choice what will happen and what AI needs
 * (AiFirstResponderSummary).
 */
export const AI_HOLD_TIME_TITLE: string = translationKey(
  "Wait for OneUptime AI for up to (minutes)",
);

export const AI_HOLD_TIME_DESCRIPTION: string = translationKey(
  "If OneUptime AI hasn't resolved it by then, the policies page as usual. From 1 to 30 minutes.",
);

export const AI_HOLD_TIME_PROBLEM: string = translationKey(
  "Wait from 1 to 30 whole minutes.",
);

export const AI_HOLD_TIME_FOLDED_VALUE: PluralTemplate = {
  one: "{{count}} minute",
  other: "{{count}} minutes",
};

// Whether the record kind's rules may let OneUptime AI respond first.
export const canOneUptimeAiRespondFirst: (
  record: OnCallRuleRecord,
) => boolean = (record: OnCallRuleRecord): boolean => {
  return (
    record === OnCallRuleRecord.Alert || record === OnCallRuleRecord.Incident
  );
};

export const WORKING_HOURS_TIMEZONE_DESCRIPTION: string = translationKey(
  "The time zone the working hours are in.",
);

export const WORKING_HOURS_DESCRIPTION: string = translationKey(
  "When this rule may page. Once paging starts, the policy escalates as usual.",
);

// Hours a schedule layer's editor shows: its note, and its Add button.
export {
  ADD_WORKING_HOURS_TITLE,
  WORKING_HOURS_TIMEZONE_NOTE,
} from "../../Components/OnCallRule/WorkingHoursPicker";

/*
 * Why the hours cannot be saved (WorkingHours.getProblem), in the reader's
 * words - the words of the picker most rules are set in: its days, and the
 * two times.
 */
const WORKING_HOURS_PROBLEMS: Record<string, string> = {
  [WORKING_HOURS_NOT_SET_MESSAGE]: translationKey(
    "Set the working hours to page in.",
  ),
  [WORKING_HOURS_TIMEZONE_NOT_SET_MESSAGE]: translationKey(
    "Choose the time zone the working hours are in.",
  ),
  [WORKING_HOURS_DAILY_WINDOW_EMPTY_MESSAGE]: translationKey(
    "Working hours must end at a different time than they start.",
  ),
  [WORKING_HOURS_NO_WEEKLY_WINDOWS_MESSAGE]: translationKey(
    "Pick at least one day.",
  ),
  [WORKING_HOURS_WEEKLY_WINDOW_EMPTY_MESSAGE]: translationKey(
    "Working hours must end at a different time than they start.",
  ),
};

// Whether the form's rule lets OneUptime AI respond first.
export const isAiFirstResponderRule: (values: unknown) => boolean = (
  values: unknown,
): boolean => {
  return (
    asRecord(values)["whenToPage"] === OnCallRuleWhenToPage.AfterOneUptimeAI
  );
};

// A hold time the form holds, or null for none.
const readAiHoldTime: (values: unknown) => number | null = (
  values: unknown,
): number | null => {
  const value: unknown = asRecord(values)["aiHoldTimeInMinutes"];

  if (value === undefined || value === null || value === "") {
    return null;
  }

  const minutes: number =
    typeof value === "string" ? Number(value) : (value as number);

  return Number.isFinite(minutes) ? minutes : NaN;
};

// Why the hold time cannot be saved, or null: empty is the default, 10.
export const getAiHoldTimeProblem: (values: unknown) => string | null = (
  values: unknown,
): string | null => {
  if (!isAiFirstResponderRule(values)) {
    return null;
  }

  const minutes: number | null = readAiHoldTime(values);

  if (
    minutes === null ||
    (Number.isInteger(minutes) &&
      minutes >= AI_HOLD_TIME_MIN_IN_MINUTES &&
      minutes <= AI_HOLD_TIME_MAX_IN_MINUTES)
  ) {
    return null;
  }

  return translateText(AI_HOLD_TIME_PROBLEM) || AI_HOLD_TIME_PROBLEM;
};

// The hold time on the folded More fields line: "10 minutes".
export const getAiHoldTimeFoldedValue: (values: unknown) => string | null = (
  values: unknown,
): string | null => {
  if (!isAiFirstResponderRule(values)) {
    return null;
  }

  return translatePlural(
    AI_HOLD_TIME_FOLDED_VALUE,
    getAiHoldTimeInMinutes(readAiHoldTime(values)),
  );
};

/*
 * Picking "After OneUptime AI tries" on a rule with no hold time fills in the
 * default, so the field shows what the rule will do. Working hours fill in
 * their own (fillInWorkingHours).
 */
export const fillInWhenToPage: <TEntity>(
  value: unknown,
  currentValues: FormValues<TEntity>,
  setNewFormValues: (values: FormValues<TEntity>) => void,
) => void = <TEntity>(
  value: unknown,
  currentValues: FormValues<TEntity>,
  setNewFormValues: (values: FormValues<TEntity>) => void,
): void => {
  if (value === OnCallRuleWhenToPage.AfterOneUptimeAI) {
    if (readAiHoldTime(currentValues) === null) {
      setNewFormValues({
        ...currentValues,
        aiHoldTimeInMinutes: AI_HOLD_TIME_DEFAULT_IN_MINUTES,
      } as FormValues<TEntity>);
    }

    return;
  }

  fillInWorkingHours(value, currentValues, setNewFormValues);
};

// Whether the form's rule pages only during working hours.
export const isWorkingHoursRule: (values: unknown) => boolean = (
  values: unknown,
): boolean => {
  return asRecord(values)["whenToPage"] === OnCallRuleWhenToPage.WorkingHours;
};

// The zone the form's working hours are in, when it is one OneUptime knows.
const getWorkingHoursTimezone: (values: unknown) => string | undefined = (
  values: unknown,
): string | undefined => {
  const timezone: unknown = asRecord(values)["workingHoursTimezone"];

  return typeof timezone === "string" && WorkingHours.isKnownTimezone(timezone)
    ? timezone
    : undefined;
};

/*
 * Why the form's working hours cannot hold a page, in the reader's words -
 * or null when they can, or the rule pages right away.
 */
export const getWorkingHoursProblem: (values: unknown) => string | null = (
  values: unknown,
): string | null => {
  if (!isWorkingHoursRule(values)) {
    return null;
  }

  const problem: string | null = WorkingHours.getProblem({
    hours: asRecord(values)["workingHours"] as RestrictionTimes | undefined,
    timezone: getWorkingHoursTimezone(values),
  });

  if (!problem) {
    return null;
  }

  const text: string = WORKING_HOURS_PROBLEMS[problem] || problem;

  return translateText(text) || text;
};

/*
 * Picking "Only during working hours" on a rule that has no hours yet fills
 * them in - Monday to Friday, 09:00 to 17:00 - in the reader's own zone.
 * Hours the rule already holds are kept, and so is its zone.
 */
export const fillInWorkingHours: <TEntity>(
  value: unknown,
  currentValues: FormValues<TEntity>,
  setNewFormValues: (values: FormValues<TEntity>) => void,
) => void = <TEntity>(
  value: unknown,
  currentValues: FormValues<TEntity>,
  setNewFormValues: (values: FormValues<TEntity>) => void,
): void => {
  if (value !== OnCallRuleWhenToPage.WorkingHours) {
    return;
  }

  const timezone: string =
    getWorkingHoursTimezone(currentValues) ||
    OneUptimeDate.getCurrentTimezone().toString();
  const hours: unknown = asRecord(currentValues)["workingHours"];
  const hasHours: boolean =
    WorkingHours.getProblem({
      hours: hours as RestrictionTimes | undefined,
      timezone: timezone,
    }) === null;

  if (hasHours && getWorkingHoursTimezone(currentValues) === timezone) {
    return;
  }

  setNewFormValues({
    ...currentValues,
    workingHoursTimezone: timezone,
    ...(hasHours
      ? {}
      : { workingHours: WorkingHours.getDefaultHours({ timezone }) }),
  } as FormValues<TEntity>);
};

/*
 * A new zone keeps the hours on the clock: the stored times are moments, and
 * read on the new zone's clock they would say other hours.
 */
export const keepWorkingHoursOnTheClock: <TEntity>(
  value: unknown,
  currentValues: FormValues<TEntity>,
  setNewFormValues: (values: FormValues<TEntity>) => void,
) => void = <TEntity>(
  value: unknown,
  currentValues: FormValues<TEntity>,
  setNewFormValues: (values: FormValues<TEntity>) => void,
): void => {
  const fromTimezone: string | undefined =
    getWorkingHoursTimezone(currentValues);
  const toTimezone: string | undefined =
    typeof value === "string" && WorkingHours.isKnownTimezone(value)
      ? value
      : undefined;

  if (!fromTimezone || !toTimezone || fromTimezone === toTimezone) {
    return;
  }

  const moved: RestrictionTimes | null = WorkingHours.moveToTimezone({
    hours: asRecord(currentValues)["workingHours"] as
      | RestrictionTimes
      | undefined,
    fromTimezone: fromTimezone,
    toTimezone: toTimezone,
  });

  if (!moved) {
    return;
  }

  setNewFormValues({
    ...currentValues,
    workingHours: moved,
  } as FormValues<TEntity>);
};

// The zones to pick from, worked out once: some six hundred of them.
let timezoneOptions: Array<DropdownOption> | null = null;

const getTimezoneOptions: () => Array<DropdownOption> =
  (): Array<DropdownOption> => {
    if (!timezoneOptions) {
      timezoneOptions = TimezoneUtil.getTimezoneDropdownOptions();
    }

    return timezoneOptions;
  };

/*
 * A working-hours rule's hours in a few words, for the folded More fields
 * line: "Working Hours: Mon–Fri 09:00–17:00" - the zone is said once the
 * section is open, where the sentence under the choice names it. Hours that
 * are not set yet read as the choice itself.
 */
export const getWorkingHoursFoldedValue: (values: unknown) => string | null = (
  values: unknown,
): string | null => {
  if (!isWorkingHoursRule(values)) {
    return null;
  }

  const translator: Translator = getGlobalTranslator();

  return (
    describeWorkingHours(asRecord(values) as WorkingHoursOfRule, {
      translator: translator,
      use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat(),
      withTimezone: false,
    }) ||
    translator.translateText(
      WHEN_TO_PAGE_TITLES[OnCallRuleWhenToPage.WorkingHours],
    )!
  );
};

const isNeverListedWhileFolded: () => boolean = (): boolean => {
  return false;
};

/**
 * Everything on an on-call rule's On-Call Policies step: the policies it
 * pages (required), its name (filled in from them), its Enabled switch on
 * the Edit form only, and folded under More fields its description and when
 * it pages - right away, or only during working hours, and then which days,
 * from when until when, and in which zone. The record is what the rule
 * pages for: the sentence under the choice names it ("Alerts that match
 * this rule ...").
 */
export const getOnCallRuleActionFields: <TEntity>(
  record: OnCallRuleRecord,
) => Array<Field<TEntity>> = <TEntity>(
  record: OnCallRuleRecord,
): Array<Field<TEntity>> => {
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
    {
      field: { whenToPage: true } as unknown as SelectFormFields<TEntity>,
      title: WHEN_TO_PAGE_TITLE,
      stepId: "on-call",
      fieldType: FormFieldSchemaType.RadioButton,
      // The column starts on Right away: there is always an answer.
      required: true,
      // Each answer says what it means: the column's sentence would repeat it.
      hideColumnDescription: true,
      dataTestId: "on-call-rule-when-to-page",
      radioButtonOptions: [
        {
          title: WHEN_TO_PAGE_TITLES[OnCallRuleWhenToPage.RightAway],
          description:
            WHEN_TO_PAGE_DESCRIPTIONS[OnCallRuleWhenToPage.RightAway],
          value: OnCallRuleWhenToPage.RightAway,
        },
        {
          title: WHEN_TO_PAGE_TITLES[OnCallRuleWhenToPage.WorkingHours],
          description:
            WHEN_TO_PAGE_DESCRIPTIONS[OnCallRuleWhenToPage.WorkingHours],
          value: OnCallRuleWhenToPage.WorkingHours,
        },
        ...(canOneUptimeAiRespondFirst(record)
          ? [
              {
                title:
                  WHEN_TO_PAGE_TITLES[OnCallRuleWhenToPage.AfterOneUptimeAI],
                description:
                  WHEN_TO_PAGE_DESCRIPTIONS[
                    OnCallRuleWhenToPage.AfterOneUptimeAI
                  ],
                value: OnCallRuleWhenToPage.AfterOneUptimeAI,
              },
            ]
          : []),
      ],
      collapsibleSection: moreFields,
      onChange: fillInWhenToPage,
      /*
       * The folded line names the hours, or how long AI may hold the page,
       * instead (getWorkingHoursFoldedValue, getAiHoldTimeFoldedValue).
       */
      isListedWhileFolded: isNeverListedWhileFolded,
      /*
       * Under the choice, what will happen: what OneUptime AI does and needs
       * for a rule that lets it respond first, the hours otherwise.
       */
      getFooterElement: (values: FormValues<TEntity>): ReactElement => {
        if (isAiFirstResponderRule(values)) {
          return React.createElement(AiFirstResponderSummary, {
            rule: asRecord(values) as AiFirstResponderSummaryProps["rule"],
            record: record,
          });
        }

        return React.createElement(WorkingHoursSummary, {
          rule: asRecord(values) as WorkingHoursOfRule,
          record: record,
        });
      },
    },
    ...(canOneUptimeAiRespondFirst(record)
      ? [
          {
            field: {
              aiHoldTimeInMinutes: true,
            } as unknown as SelectFormFields<TEntity>,
            title: AI_HOLD_TIME_TITLE,
            description: AI_HOLD_TIME_DESCRIPTION,
            stepId: "on-call",
            fieldType: FormFieldSchemaType.Number,
            required: false,
            placeholder: String(AI_HOLD_TIME_DEFAULT_IN_MINUTES),
            showIf: isAiFirstResponderRule,
            collapsibleSection: moreFields,
            // "Wait for OneUptime AI for up to (minutes): 10 minutes".
            isListedWhileFolded: isAiFirstResponderRule,
            getFoldedValue: getAiHoldTimeFoldedValue,
            customValidation: getAiHoldTimeProblem,
          } as Field<TEntity>,
        ]
      : []),
    {
      field: { workingHours: true } as unknown as SelectFormFields<TEntity>,
      title: "Working Hours",
      description: WORKING_HOURS_DESCRIPTION,
      stepId: "on-call",
      fieldType: FormFieldSchemaType.CustomComponent,
      required: isWorkingHoursRule,
      showIf: isWorkingHoursRule,
      collapsibleSection: moreFields,
      /*
       * Named on the folded line only when the rule waits for them: "Working
       * Hours: Mon–Fri 09:00–17:00 (Europe/London)". A rule that pages right
       * away adds nothing to the line.
       */
      isListedWhileFolded: isWorkingHoursRule,
      getFoldedValue: getWorkingHoursFoldedValue,
      customValidation: getWorkingHoursProblem,
      getCustomElement: (
        values: FormValues<TEntity>,
        props: CustomElementProps,
      ): ReactElement => {
        return React.createElement(WorkingHoursPicker, {
          error: props.error,
          onChange: props.onChange,
          value: asRecord(values)["workingHours"] as
            | RestrictionTimes
            | undefined,
          timezone: getWorkingHoursTimezone(values),
        });
      },
    },
    {
      field: {
        workingHoursTimezone: true,
      } as unknown as SelectFormFields<TEntity>,
      title: "Timezone",
      description: WORKING_HOURS_TIMEZONE_DESCRIPTION,
      stepId: "on-call",
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: getTimezoneOptions(),
      required: isWorkingHoursRule,
      showIf: isWorkingHoursRule,
      collapsibleSection: moreFields,
      isListedWhileFolded: isNeverListedWhileFolded,
      onChange: keepWorkingHoursOnTheClock,
    },
  ];
};

// ---- Runbook rules ---------------------------------------------------------

/*
 * "Start Database failover": a runbook rule is named after the runbooks it
 * starts, as an on-call rule is after the policies it pages - as many as
 * fit, then a count.
 */
export const RUNBOOK_RULE_NAME_WORDING: RuleNameWording = {
  picksSlot: "runbooks",
  allPicks: translationKey("Start {{runbooks}}"),
  somePicks: {
    one: "Start {{runbooks}} and {{count}} more",
    other: "Start {{runbooks}} and {{count}} more",
  },
};

export const getRunbookRuleName: (runbookNames: Array<string>) => string = (
  runbookNames: Array<string>,
): string => {
  return getRuleNameFromPicks(RUNBOOK_RULE_NAME_WORDING, runbookNames);
};

/*
 * What the field is for, in one line. That each runbook starts a run of its
 * own, attached to what matched, is for the help panel and the docs.
 */
export const RUNBOOK_RULE_RUNBOOKS_DESCRIPTION: string = translationKey(
  "The runbooks to start when this rule matches.",
);

export const RUNBOOK_RULE_NAME_DESCRIPTION: string = translationKey(
  "Named after the runbooks it starts until you type a name of your own.",
);

/**
 * Everything on a runbook rule's Runbooks step: the runbooks it starts
 * (required), its name (filled in from them), its Enabled switch on the Edit
 * form only, and its description folded under More fields.
 */
export const getRunbookRuleActionFields: <TEntity>() => Array<
  Field<TEntity>
> = <TEntity>(): Array<Field<TEntity>> => {
  const moreFields: FormFieldCollapsibleSection<TEntity> =
    getAdvancedFormSection<TEntity>();

  return [
    {
      field: { runbooks: true } as unknown as SelectFormFields<TEntity>,
      title: "Runbooks to Start",
      description: RUNBOOK_RULE_RUNBOOKS_DESCRIPTION,
      stepId: "runbooks",
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      dropdownModal: {
        type: Runbook,
        labelField: "name",
        valueField: "_id",
      },
      required: true,
      placeholder: "Select Runbooks",
      onChange: followPicksWithRuleName<TEntity>(getRunbookRuleName),
    },
    {
      field: { name: true } as unknown as SelectFormFields<TEntity>,
      title: "Name",
      description: RUNBOOK_RULE_NAME_DESCRIPTION,
      stepId: "runbooks",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "e.g. Start Database failover",
      validation: {
        minLength: 2,
        maxLength: RULE_NAME_MAX_LENGTH,
      },
    },
    {
      field: { isEnabled: true } as unknown as SelectFormFields<TEntity>,
      title: "Enabled",
      description: RULE_ENABLED_DESCRIPTION,
      stepId: "runbooks",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      // A rule starts on: the switch is on its edit form only.
      doNotShowWhenCreating: true,
    },
    {
      field: { description: true } as unknown as SelectFormFields<TEntity>,
      title: "Description",
      stepId: "runbooks",
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

/*
 * The targets a new SLA rule starts with: acknowledged within 15 minutes,
 * resolved within 4 hours. Two empty boxes whose placeholders read like
 * values ("15", "60") left a new rule tracking nothing and its name empty;
 * a rule that starts with targets says what it will track, is named after
 * them, and either can be changed or emptied.
 */
export const DEFAULT_SLA_RESPONSE_TIME_IN_MINUTES: number = 15;

export const DEFAULT_SLA_RESOLUTION_TIME_IN_MINUTES: number = 240;

/**
 * What the Create form of an SLA rule starts with: the two targets above
 * and the name they make ("Respond in 15 minutes, resolve in 4 hours", in
 * the reader's language). A Create form only - ModelTable's
 * createInitialValues - so an Edit form never fills in a target that a rule
 * left empty.
 */
export const getNewSlaRuleValues: <TEntity>() => FormValues<TEntity> = <
  TEntity,
>(): FormValues<TEntity> => {
  const values: FormValuesRecord = {
    responseTimeInMinutes: DEFAULT_SLA_RESPONSE_TIME_IN_MINUTES,
    resolutionTimeInMinutes: DEFAULT_SLA_RESOLUTION_TIME_IN_MINUTES,
  };

  return {
    ...values,
    name: getSlaRuleName(values),
  } as unknown as FormValues<TEntity>;
};

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

/*
 * Each answer's word, as the form offers it and the rules list shows it -
 * one word for both, looked up in the reader's language where it is drawn.
 */
export const REMINDER_STOP_STATE_TITLES: Record<ReminderStopState, string> = {
  [ReminderStopState.Resolved]: translationKey("Resolved"),
  [ReminderStopState.Acknowledged]: translationKey("Acknowledged"),
};

/*
 * The stop a rule's column means. Anything but Acknowledged is Resolved, as
 * the reminder workers read it (and the column starts as Resolved).
 */
export const readStopState: (value: unknown) => ReminderStopState = (
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
          title: REMINDER_STOP_STATE_TITLES[ReminderStopState.Resolved],
          description:
            REMINDER_STOP_OPTION_DESCRIPTIONS[record][
              ReminderStopState.Resolved
            ],
          value: ReminderStopState.Resolved,
        },
        {
          title: REMINDER_STOP_STATE_TITLES[ReminderStopState.Acknowledged],
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
