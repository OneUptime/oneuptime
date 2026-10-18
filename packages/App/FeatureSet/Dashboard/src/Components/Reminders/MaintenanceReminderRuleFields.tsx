import {
  MAINTENANCE_REMINDER_TIMING_COLUMNS,
  MAINTENANCE_REMINDER_TIMING_FIELD_TITLE,
  MaintenanceReminderTiming,
  getMaintenanceReminderTiming,
  isMaintenanceReminderTiming,
} from "./MaintenanceReminderTiming";
import MaintenanceReminderTimingField from "./MaintenanceReminderTimingField";
import {
  DEFAULT_REMINDER_INTERVAL_IN_MINUTES,
  MAINTENANCE_REMINDER_INTERVAL_DESCRIPTION,
  REMINDER_RULE_NAME_DESCRIPTION,
  followValueWithRuleName,
  getMaintenanceReminderRuleName,
  getNewMaintenanceReminderRuleName,
} from "../../Utils/Form/EventRuleForm";
import {
  FILLED_IN_RULE_NAME_KEY,
  RULE_ENABLED_DESCRIPTION,
  RULE_NAME_MAX_LENGTH,
  getFollowedRuleName,
} from "../../Utils/Form/ResourceRuleForm";
import ScheduledMaintenanceReminderRule from "Common/Models/DatabaseModels/ScheduledMaintenanceReminderRule";
import type { ModelField } from "Common/UI/Components/Forms/ModelForm";
import {
  CustomElementProps,
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import React, { ReactElement } from "react";

/*
 * The Reminders step of a scheduled maintenance reminder rule: how often it
 * reminds (30 minutes for a new rule), when - one plain choice, "Remind
 * Owners", in place of a "Stop Reminders When" dropdown and a switch whose
 * help explained two modes (MaintenanceReminderTiming.ts) - its name,
 * filled in from both, its Enabled switch on the Edit form only, and its
 * description folded under More fields.
 *
 * The choice is form-only: what it answers is written into the rule's two
 * columns, registered here unseen so the form loads and saves them.
 */

// The form value the choice keeps; never sent (formOnly).
export const MAINTENANCE_REMINDER_TIMING_FIELD_KEY: string = "reminderTiming";

type Values = Record<string, unknown>;

const asValues: (values: unknown) => Values = (values: unknown): Values => {
  return values && typeof values === "object" ? (values as Values) : {};
};

/**
 * The values a picked answer makes: its two columns, and the rule's name
 * following it while the name is still the form's own.
 */
export const getValuesForMaintenanceReminderTiming: (data: {
  values: Values;
  timing: MaintenanceReminderTiming;
}) => Values = (data: {
  values: Values;
  timing: MaintenanceReminderTiming;
}): Values => {
  const next: Values = {
    ...data.values,
    ...MAINTENANCE_REMINDER_TIMING_COLUMNS[data.timing],
  };

  const name: string | null = getFollowedRuleName({
    name: data.values["name"],
    filledInName: data.values[FILLED_IN_RULE_NAME_KEY],
    previousName: getMaintenanceReminderRuleName(data.values),
    nextName: getMaintenanceReminderRuleName(next),
  });

  if (name === null) {
    return next;
  }

  return { ...next, name: name, [FILLED_IN_RULE_NAME_KEY]: name };
};

export const getMaintenanceReminderRuleActionFields: () => Array<
  ModelField<ScheduledMaintenanceReminderRule>
> = (): Array<ModelField<ScheduledMaintenanceReminderRule>> => {
  const moreFields: FormFieldCollapsibleSection<ScheduledMaintenanceReminderRule> =
    getAdvancedFormSection<ScheduledMaintenanceReminderRule>();

  return [
    {
      field: {
        reminderIntervalInMinutes: true,
      },
      title: "Reminder Interval (minutes)",
      description: MAINTENANCE_REMINDER_INTERVAL_DESCRIPTION,
      stepId: "reminder-settings",
      fieldType: FormFieldSchemaType.Number,
      required: true,
      placeholder: "30",
      defaultValue: DEFAULT_REMINDER_INTERVAL_IN_MINUTES,
      onChange: followValueWithRuleName<ScheduledMaintenanceReminderRule>({
        column: "reminderIntervalInMinutes",
        makeName: getMaintenanceReminderRuleName,
      }),
    },
    {
      overrideField: {
        remindWhileScheduled: true,
      },
      overrideFieldKey: MAINTENANCE_REMINDER_TIMING_FIELD_KEY,
      formOnly: true,
      title: MAINTENANCE_REMINDER_TIMING_FIELD_TITLE,
      stepId: "reminder-settings",
      fieldType: FormFieldSchemaType.CustomComponent,
      required: false,
      hideOptionalLabel: true,
      /*
       * Each answer says what it means; the column the field stands in for
       * (remindWhileScheduled) describes only half of the choice.
       */
      hideColumnDescription: true,
      dataTestId: "maintenance-reminder-timing-field",
      onChange: (
        value: unknown,
        currentValues: FormValues<ScheduledMaintenanceReminderRule>,
        setNewFormValues: (
          values: FormValues<ScheduledMaintenanceReminderRule>,
        ) => void,
      ): void => {
        if (!isMaintenanceReminderTiming(value)) {
          return;
        }

        setNewFormValues(
          getValuesForMaintenanceReminderTiming({
            values: asValues(currentValues),
            timing: value,
          }) as FormValues<ScheduledMaintenanceReminderRule>,
        );
      },
      getCustomElement: (
        values: FormValues<ScheduledMaintenanceReminderRule>,
        props: CustomElementProps,
      ): ReactElement => {
        return (
          <MaintenanceReminderTimingField
            value={getMaintenanceReminderTiming(asValues(values))}
            error={props.error}
            ariaLabelledby={props.ariaLabelledby}
            onChange={(timing: MaintenanceReminderTiming): void => {
              props.onChange?.(timing);
            }}
          />
        );
      },
    },
    /*
     * The two columns the choice writes, registered so the form loads and
     * saves them; never drawn.
     */
    {
      field: {
        remindWhileScheduled: true,
      },
      title: "Remind While Event is Scheduled",
      stepId: "reminder-settings",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      showIf: (): boolean => {
        return false;
      },
    },
    {
      field: {
        stopRemindersOnState: true,
      },
      title: "Stop Reminders When",
      stepId: "reminder-settings",
      fieldType: FormFieldSchemaType.Text,
      required: false,
      showIf: (): boolean => {
        return false;
      },
    },
    {
      field: {
        name: true,
      },
      title: "Name",
      description: REMINDER_RULE_NAME_DESCRIPTION,
      stepId: "reminder-settings",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      // Named after the interval and the answer a new rule starts with.
      defaultValue: getNewMaintenanceReminderRuleName(),
      validation: {
        minLength: 2,
        maxLength: RULE_NAME_MAX_LENGTH,
      },
    },
    {
      field: {
        isEnabled: true,
      },
      title: "Enabled",
      description: RULE_ENABLED_DESCRIPTION,
      stepId: "reminder-settings",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      // A rule starts on: the switch is on its edit form only.
      doNotShowWhenCreating: true,
    },
    {
      field: {
        description: true,
      },
      title: "Description",
      stepId: "reminder-settings",
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      collapsibleSection: moreFields,
    },
  ];
};
