import SelectFormFields from "Common/UI/Types/SelectEntityField";
import {
  DEFAULT_ESCALATE_AFTER_IN_MINUTES,
  getDefaultEscalationRuleName,
  isDefaultEscalationRuleName,
} from "Common/Types/OnCallDutyPolicy/EscalationRuleDefaults";
import Field, {
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import {
  PeoplePickerFieldConfig,
  PeoplePickerKind,
  toPeoplePickerIds,
} from "Common/UI/Components/PeoplePicker/PeoplePickerTypes";
import {
  translateText,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * ADDING AN ESCALATION RULE IS ONE SHORT STEP.
 *
 * It used to be a three-step wizard: Overview (a required name and a
 * description, for one rung of a ladder), Notify (three dropdowns - on-call
 * schedules, teams, users - for the one question "who gets paged?") and
 * Escalation (one required number with no value in it). Now it asks the two
 * things a rule cannot do without, on one page:
 *
 *   - Notify: one picker for on-call schedules, teams and people together.
 *     It still writes the three lists the rule's join tables are made from
 *     (onCallSchedules, teams, users), so nothing about what is saved changed.
 *   - Escalate after: how long to wait for an acknowledgement, 30 minutes
 *     unless changed.
 *
 * The name and the description wait under a folded Advanced section. A rule
 * nobody names is called after its level ("Level 3"), which the server fills
 * in on create and the edit dialog fills in when the name is cleared; the
 * name field shows it as its placeholder, so what the form shows is what is
 * saved.
 *
 * React-free, so the on-call policy's own form can offer the same Notify
 * field for its first rule.
 */

// The form values the Notify picker writes, one per kind of responder.
export const ESCALATION_RULE_SCHEDULES_KEY: string = "onCallSchedules";
export const ESCALATION_RULE_TEAMS_KEY: string = "teams";
export const ESCALATION_RULE_USERS_KEY: string = "users";

// The Notify field's own key: it names the field in the form, nothing is sent under it.
export const ESCALATION_RULE_NOTIFY_FIELD_KEY: string = "notify";

export const ESCALATION_RULE_NOTIFY_ADD_BUTTON_TEXT: string =
  translationKey("Add responder");

export const ESCALATION_RULE_NOTIFY_EMPTY_TEXT: string = translationKey(
  "No on-call schedules, teams or people to pick from.",
);

export const ESCALATION_RULE_NOTIFY_REQUIRED_MESSAGE: string = translationKey(
  "Add at least one on-call schedule, team or person to notify.",
);

/*
 * On-call schedules first, then teams, then people: the order a rule's card
 * and the escalation summary list them in.
 */
export const getEscalationRuleNotifyPickerConfig: () => PeoplePickerFieldConfig =
  (): PeoplePickerFieldConfig => {
    return {
      kinds: [
        {
          kind: PeoplePickerKind.OnCallSchedule,
          valueKey: ESCALATION_RULE_SCHEDULES_KEY,
        },
        { kind: PeoplePickerKind.Team, valueKey: ESCALATION_RULE_TEAMS_KEY },
        { kind: PeoplePickerKind.User, valueKey: ESCALATION_RULE_USERS_KEY },
      ],
      addButtonText: ESCALATION_RULE_NOTIFY_ADD_BUTTON_TEXT,
      searchPlaceholder: "Search schedules, teams or people...",
      emptyText: ESCALATION_RULE_NOTIFY_EMPTY_TEXT,
    };
  };

// Who a rule notifies, as ids per kind of responder.
export interface EscalationRuleResponderIds {
  onCallSchedules: Array<string>;
  teams: Array<string>;
  users: Array<string>;
}

// The responders a form's values name: what the Notify picker wrote.
export const readEscalationRuleResponderIds: (
  values: unknown,
) => EscalationRuleResponderIds = (
  values: unknown,
): EscalationRuleResponderIds => {
  const record: Record<string, unknown> =
    values && typeof values === "object"
      ? (values as Record<string, unknown>)
      : {};

  return {
    onCallSchedules: toPeoplePickerIds(record[ESCALATION_RULE_SCHEDULES_KEY]),
    teams: toPeoplePickerIds(record[ESCALATION_RULE_TEAMS_KEY]),
    users: toPeoplePickerIds(record[ESCALATION_RULE_USERS_KEY]),
  };
};

export const countEscalationRuleResponders: (
  responders: EscalationRuleResponderIds,
) => number = (responders: EscalationRuleResponderIds): number => {
  return (
    responders.onCallSchedules.length +
    responders.teams.length +
    responders.users.length
  );
};

/*
 * The one Notify field: on-call schedules, teams and people in one picker.
 * Required unless the caller says otherwise - a level that pages nobody is
 * the one way a rule can be useless - and when nobody is picked it says what
 * to do rather than "Notify is required". A form that makes it optional
 * (required: false, or a function) gets that check only when it is required;
 * a form with a customValidation of its own keeps its own.
 */
export const getEscalationRuleNotifyFormField: <TEntity>(
  options?: Omit<
    Field<TEntity>,
    "field" | "fieldType" | "peoplePicker" | "formOnly"
  >,
) => Field<TEntity> = <TEntity>(
  options?: Omit<
    Field<TEntity>,
    "field" | "fieldType" | "peoplePicker" | "formOnly"
  >,
): Field<TEntity> => {
  const field: Field<TEntity> = {
    title: "Notify",
    description:
      "On-call schedules page whoever is on call. Teams page every member.",
    required: true,
    ...options,
    field: {
      [ESCALATION_RULE_NOTIFY_FIELD_KEY]: true,
    } as SelectFormFields<TEntity>,
    fieldType: FormFieldSchemaType.PeoplePicker,
    peoplePicker: getEscalationRuleNotifyPickerConfig(),
    formOnly: true,
  };

  if (!options?.customValidation) {
    field.customValidation = (values: FormValues<TEntity>): string | null => {
      const isRequired: boolean =
        typeof field.required === "function"
          ? field.required(values)
          : Boolean(field.required);

      if (
        !isRequired ||
        countEscalationRuleResponders(readEscalationRuleResponderIds(values)) >
          0
      ) {
        return null;
      }

      return (
        translateText(ESCALATION_RULE_NOTIFY_REQUIRED_MESSAGE) ||
        ESCALATION_RULE_NOTIFY_REQUIRED_MESSAGE
      );
    };
  }

  return field;
};

// The name a rule is saved with: what was typed, or its level's when blank.
export const resolveEscalationRuleName: (
  name: string | undefined | null,
  level: number,
) => string = (name: string | undefined | null, level: number): string => {
  if (typeof name === "string" && name.trim()) {
    return name;
  }

  return getDefaultEscalationRuleName(level);
};

/*
 * Whether the folded Advanced section holds anything of the user's: a
 * description, or a name other than the one the level gives the rule.
 * "Level 2" on the second level is the default, not a choice.
 */
export const isEscalationRuleAdvancedConfigured: (
  values: unknown,
  level: number,
) => boolean = (values: unknown, level: number): boolean => {
  const record: Record<string, unknown> =
    values && typeof values === "object"
      ? (values as Record<string, unknown>)
      : {};

  const name: unknown = record["name"];
  const description: unknown = record["description"];

  if (typeof description === "string" && description.trim()) {
    return true;
  }

  return (
    typeof name === "string" &&
    Boolean(name.trim()) &&
    !isDefaultEscalationRuleName(name, level)
  );
};

export interface EscalationRuleFormOptions {
  // The level the rule is (edit) or will be (create): names it "Level N".
  level: number;
  // An edit form starts from the rule's own values: no prefilled wait.
  isEditing?: boolean | undefined;
}

/*
 * The add and edit forms' fields, in order: Notify, Escalate after, then the
 * folded Advanced section with the name and the description. No steps: two
 * questions and a folded section are one short page.
 */
export const getEscalationRuleFormFields: <TEntity>(
  options: EscalationRuleFormOptions,
) => Array<Field<TEntity>> = <TEntity>(
  options: EscalationRuleFormOptions,
): Array<Field<TEntity>> => {
  const level: number = options.level;

  const advanced: FormFieldCollapsibleSection<TEntity> =
    getAdvancedFormSection<TEntity>({
      isConfigured: (values: FormValues<TEntity>): boolean => {
        return isEscalationRuleAdvancedConfigured(values, level);
      },
    });

  return [
    getEscalationRuleNotifyFormField<TEntity>(),
    {
      field: { escalateAfterInMinutes: true } as SelectFormFields<TEntity>,
      title: "Escalate after (in minutes)",
      description:
        "If nobody acknowledges within this time, the next level is paged.",
      fieldType: FormFieldSchemaType.Number,
      required: true,
      placeholder: "30",
      validation: {
        minValue: 0,
      },
      defaultValue: options.isEditing
        ? undefined
        : DEFAULT_ESCALATE_AFTER_IN_MINUTES,
    },
    {
      field: { name: true } as SelectFormFields<TEntity>,
      title: "Name",
      description: "Leave it empty to name this rule after its level.",
      fieldType: FormFieldSchemaType.Text,
      required: false,
      placeholder: getDefaultEscalationRuleName(level),
      collapsibleSection: advanced,
    },
    {
      field: { description: true } as SelectFormFields<TEntity>,
      title: "Description",
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      placeholder: "Describe who this level notifies and why.",
      collapsibleSection: advanced,
    },
  ];
};
