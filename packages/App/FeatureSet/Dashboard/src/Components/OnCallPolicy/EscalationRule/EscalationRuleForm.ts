import SelectFormFields from "Common/UI/Types/SelectEntityField";
import {
  DEFAULT_ESCALATE_AFTER_IN_MINUTES,
  getDefaultEscalationRuleName,
  isDefaultEscalationRuleName,
} from "Common/Types/OnCallDutyPolicy/EscalationRuleDefaults";
import { NEXT_IN_ROTATION_SCHEDULES_KEY } from "Common/Types/OnCallDutyPolicy/NextInRotation";
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
import type { ReactElement } from "react";

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
 *     It also offers each schedule's "Next in rotation" - the person after
 *     whoever is on call, the backup from the same rotation - written as a
 *     fourth list (nextInRotationSchedules) to the same schedule join table.
 *   - Escalate after: how long to wait for an acknowledgement, 30 minutes
 *     unless changed. On a new rule after the first, "Paged after" instead:
 *     when the new level is paged, saved as the wait of the level before it
 *     (#7373).
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
/*
 * The schedules whose next person in the rotation the rule pages - the misc
 * data key the server reads them under (Types/OnCallDutyPolicy/NextInRotation).
 */
export const ESCALATION_RULE_NEXT_IN_ROTATION_SCHEDULES_KEY: string =
  NEXT_IN_ROTATION_SCHEDULES_KEY;

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
 * What the Notify picker offers. An escalation rule's own dialog offers each
 * schedule's "Next in rotation" as well; "Who gets paged first?" of a new
 * on-call policy does not - its first level pages whoever is on call, and a
 * backup belongs on a level after it.
 */
export interface EscalationRuleNotifyKindsOptions {
  offerNextInRotation?: boolean | undefined;
}

// The Notify field's line under it, without and with "Next in rotation".
export const ESCALATION_RULE_NOTIFY_DESCRIPTION: string = translationKey(
  "On-call schedules page whoever is on call. Teams page every member.",
);
export const ESCALATION_RULE_NOTIFY_WITH_NEXT_IN_ROTATION_DESCRIPTION: string =
  translationKey(
    "On-call schedules page whoever is on call; Next in rotation pages the person after them. Teams page every member.",
  );

/*
 * On-call schedules first, then the next person in their rotations, then
 * teams, then people: the order a rule's card and the escalation summary
 * list them in.
 */
export const getEscalationRuleNotifyPickerConfig: (
  options?: EscalationRuleNotifyKindsOptions,
) => PeoplePickerFieldConfig = (
  options?: EscalationRuleNotifyKindsOptions,
): PeoplePickerFieldConfig => {
  return {
    kinds: [
      {
        kind: PeoplePickerKind.OnCallSchedule,
        valueKey: ESCALATION_RULE_SCHEDULES_KEY,
      },
      ...(options?.offerNextInRotation
        ? [
            {
              kind: PeoplePickerKind.OnCallScheduleNextInRotation,
              valueKey: ESCALATION_RULE_NEXT_IN_ROTATION_SCHEDULES_KEY,
            },
          ]
        : []),
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
  // Schedules whose next person in the rotation is paged: the backup.
  nextInRotationSchedules: Array<string>;
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
    nextInRotationSchedules: toPeoplePickerIds(
      record[ESCALATION_RULE_NEXT_IN_ROTATION_SCHEDULES_KEY],
    ),
    teams: toPeoplePickerIds(record[ESCALATION_RULE_TEAMS_KEY]),
    users: toPeoplePickerIds(record[ESCALATION_RULE_USERS_KEY]),
  };
};

export const countEscalationRuleResponders: (
  responders: EscalationRuleResponderIds,
) => number = (responders: EscalationRuleResponderIds): number => {
  return (
    responders.onCallSchedules.length +
    responders.nextInRotationSchedules.length +
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
  kinds?: EscalationRuleNotifyKindsOptions,
) => Field<TEntity> = <TEntity>(
  options?: Omit<
    Field<TEntity>,
    "field" | "fieldType" | "peoplePicker" | "formOnly"
  >,
  kinds?: EscalationRuleNotifyKindsOptions,
): Field<TEntity> => {
  const field: Field<TEntity> = {
    title: "Notify",
    description: kinds?.offerNextInRotation
      ? ESCALATION_RULE_NOTIFY_WITH_NEXT_IN_ROTATION_DESCRIPTION
      : ESCALATION_RULE_NOTIFY_DESCRIPTION,
    required: true,
    ...options,
    field: {
      [ESCALATION_RULE_NOTIFY_FIELD_KEY]: true,
    } as SelectFormFields<TEntity>,
    fieldType: FormFieldSchemaType.PeoplePicker,
    peoplePicker: getEscalationRuleNotifyPickerConfig(kinds),
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

/*
 * The level a new rule is added after, as the rules list names it, and its
 * wait: how long it waits for an acknowledgement before the new one is
 * paged (#7373).
 */
export interface EscalationRulePreviousLevel {
  name: string;
  escalateAfterInMinutes: number;
}

export interface EscalationRuleFormOptions {
  // The level the rule is (edit) or will be (create): names it "Level N".
  level: number;
  // An edit form starts from the rule's own values: no prefilled wait.
  isEditing?: boolean | undefined;
  /*
   * Under Notify (EscalationRuleNotifyNote): that how each person is reached
   * is their own How to Reach Me, not this rule (#6820), and on a new rule
   * after the first, when it is paged (#7373).
   */
  notifyFooterElement?: ReactElement | undefined;
  /*
   * A new rule after the first, added by someone who may change the level
   * before it (#7373): the form asks when the new level is paged ("Paged
   * after"), starting from the level before's wait, which is where it is
   * saved. Its description names that level, so the page words it
   * (pagedAfterDescriptionElement). Left out, the form asks "Escalate after".
   */
  previousLevel?: EscalationRulePreviousLevel | undefined;
  pagedAfterDescriptionElement?: ReactElement | undefined;
}

// "Escalate after": how long THIS level has before the next one is paged.
export const ESCALATE_AFTER_DESCRIPTION: string = translationKey(
  "If nobody acknowledges this level within this time, the level after it is paged.",
);

/*
 * "PAGED AFTER": WHEN A NEW LEVEL IS PAGED, ASKED ON THE NEW LEVEL (#7373).
 *
 * The wait before a level belongs to the level before it: that level's
 * "Escalate after" is how long it waits for an acknowledgement before the
 * next one is paged. A new rule's form asked "Escalate after" too, and a
 * newcomer adding a teammate to page "after 5 minutes" typed 5 there - the
 * new level's own wait, before a level that did not exist - while the
 * teammate was still paged 30 minutes after Level 1. A new rule after the
 * first asks when it is paged instead, starting from the level before's
 * wait, and the page saves the answer as that level's wait. The new level
 * waits DEFAULT_ESCALATE_AFTER_IN_MINUTES itself until a level after it is
 * added, which asks again; its Edit sets it any time.
 */
export const ESCALATION_RULE_PAGED_AFTER_KEY: string = "pagedAfterInMinutes";

export const PAGED_AFTER_TITLE: string = translationKey(
  "Paged after (in minutes)",
);

// Under it, naming the level before: "How long Level 1 waits ...".
export const PAGED_AFTER_DESCRIPTION: string = translationKey(
  "How long {{level}} waits for someone to acknowledge before this level is paged. Saved as the wait of {{level}}.",
);

// The minutes a "Paged after" answer holds, or null when it holds none.
export const readPagedAfterInMinutes: (values: unknown) => number | null = (
  values: unknown,
): number | null => {
  const record: Record<string, unknown> =
    values && typeof values === "object"
      ? (values as Record<string, unknown>)
      : {};
  const value: unknown = record[ESCALATION_RULE_PAGED_AFTER_KEY];

  if (value === undefined || value === null || value === "") {
    return null;
  }

  const minutes: number = Number(value);

  return Number.isFinite(minutes) && minutes >= 0 ? Math.floor(minutes) : null;
};

/*
 * The add and edit forms' fields, in order: Notify (with each schedule's
 * "Next in rotation" on offer), the wait - "Escalate after", or on a new
 * rule after the first "Paged after" (#7373) - then the folded Advanced
 * section with the name and the description. No steps: two questions and a
 * folded section are one short page.
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

  const escalateAfter: Field<TEntity> = {
    field: { escalateAfterInMinutes: true } as SelectFormFields<TEntity>,
    title: "Escalate after (in minutes)",
    description: ESCALATE_AFTER_DESCRIPTION,
    fieldType: FormFieldSchemaType.Number,
    required: true,
    placeholder: "30",
    validation: {
      minValue: 0,
    },
    defaultValue: options.isEditing
      ? undefined
      : DEFAULT_ESCALATE_AFTER_IN_MINUTES,
  };

  // Not a column of the new rule: the page saves it on the level before.
  const pagedAfter: Field<TEntity> = {
    field: {
      [ESCALATION_RULE_PAGED_AFTER_KEY]: true,
    } as SelectFormFields<TEntity>,
    showEvenIfPermissionDoesNotExist: true,
    formOnly: true,
    title: PAGED_AFTER_TITLE,
    // Worded by the page, which names the level before (PAGED_AFTER_DESCRIPTION).
    ...(options.pagedAfterDescriptionElement
      ? { description: options.pagedAfterDescriptionElement }
      : {}),
    fieldType: FormFieldSchemaType.Number,
    required: true,
    placeholder: "30",
    validation: {
      minValue: 0,
    },
    defaultValue: options.previousLevel?.escalateAfterInMinutes,
  };

  const wait: Field<TEntity> =
    options.previousLevel && !options.isEditing ? pagedAfter : escalateAfter;

  return [
    getEscalationRuleNotifyFormField<TEntity>(
      options.notifyFooterElement
        ? { footerElement: options.notifyFooterElement }
        : undefined,
      {
        offerNextInRotation: true,
      },
    ),
    wait,
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
