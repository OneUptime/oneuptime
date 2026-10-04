import SelectFormFields from "Common/UI/Types/SelectEntityField";
import { getDefaultEscalationRuleName } from "Common/Types/OnCallDutyPolicy/EscalationRuleDefaults";
import {
  DEFAULT_INCOMING_CALL_RING_SECONDS,
  MAX_INCOMING_CALL_RING_SECONDS,
  MIN_INCOMING_CALL_RING_SECONDS,
} from "Common/Types/IncomingCall/IncomingCallRingTime";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
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
import { isEscalationRuleAdvancedConfigured } from "./EscalationRuleForm";

/*
 * ADDING AN INCOMING CALL ESCALATION RULE IS ONE SHORT STEP.
 *
 * An incoming call policy's escalation rules are who is rung, from the top
 * of the list down, when someone calls the policy's number. Adding one used
 * to walk three steps - Overview (a name and a description for one line of
 * a list), Notification (a "Notify" dropdown of two choices, then a second
 * dropdown of on-call schedules or of users) and Escalation (one number,
 * "Escalate After (Seconds)") - for a rule that holds one target and one
 * number. Now it asks those two things on one page:
 *
 *   - Who to call: one picker of on-call schedules and people that takes a
 *     single pick. A schedule rings whoever is on call in it when the call
 *     comes in. The pick is written straight to the rule's own columns -
 *     onCallDutyPolicyScheduleId or userId, the other one cleared - so what
 *     is saved did not change.
 *   - Ring for (in seconds): how long the phone rings before the call moves
 *     on to the next rule. It is the timeout of Twilio's <Dial>, 30 seconds
 *     unless changed (IncomingCallRingTime).
 *
 * The name and the description wait under a folded Advanced section, as an
 * on-call policy's escalation rules have them (EscalationRuleForm.ts). A
 * rule nobody names is shown after its place in the list - "Level 2" - and
 * the name field says so as its placeholder.
 *
 * The old User dropdown listed User records, which the API lets a person
 * read only for themselves, so it offered nobody but whoever was filling it
 * in. The picker's people are the project's members.
 *
 * React-free, so the page and its tests share one description of the form.
 */

// The rule's own columns the picker writes: one of them holds its target.
export const INCOMING_CALL_RULE_SCHEDULE_KEY: string =
  "onCallDutyPolicyScheduleId";
export const INCOMING_CALL_RULE_USER_KEY: string = "userId";

// The picker's own key: it names the field in the form, nothing is sent under it.
export const INCOMING_CALL_RULE_TARGET_FIELD_KEY: string = "whoToCall";

export const INCOMING_CALL_RULE_ADD_BUTTON_TEXT: string =
  translationKey("Choose who to call");

export const INCOMING_CALL_RULE_EMPTY_TEXT: string = translationKey(
  "No on-call schedules or people to pick from.",
);

export const INCOMING_CALL_RULE_REQUIRED_MESSAGE: string = translationKey(
  "Choose an on-call schedule or a person to call.",
);

/*
 * On-call schedules first, then people: a schedule is what most rules call,
 * since it rings whoever is on call that day. One pick, of either kind.
 */
export const getIncomingCallRuleTargetPickerConfig: () => PeoplePickerFieldConfig =
  (): PeoplePickerFieldConfig => {
    return {
      kinds: [
        {
          kind: PeoplePickerKind.OnCallSchedule,
          valueKey: INCOMING_CALL_RULE_SCHEDULE_KEY,
        },
        {
          kind: PeoplePickerKind.User,
          valueKey: INCOMING_CALL_RULE_USER_KEY,
        },
      ],
      isSinglePick: true,
      addButtonText: INCOMING_CALL_RULE_ADD_BUTTON_TEXT,
      searchPlaceholder: "Search schedules or people...",
      emptyText: INCOMING_CALL_RULE_EMPTY_TEXT,
    };
  };

// Who a rule calls: an on-call schedule or a person, by id.
export interface IncomingCallRuleTarget {
  kind: PeoplePickerKind.OnCallSchedule | PeoplePickerKind.User;
  id: string;
}

/*
 * What a form's values (or a rule) say the rule calls, or null when they
 * name nobody. A schedule wins over a person: the picker never holds both,
 * and neither does a saved rule.
 */
export const readIncomingCallRuleTarget: (
  values: unknown,
) => IncomingCallRuleTarget | null = (
  values: unknown,
): IncomingCallRuleTarget | null => {
  const record: Record<string, unknown> =
    values && typeof values === "object"
      ? (values as Record<string, unknown>)
      : {};

  const scheduleId: string | undefined = toPeoplePickerIds(
    record[INCOMING_CALL_RULE_SCHEDULE_KEY],
  )[0];

  if (scheduleId) {
    return { kind: PeoplePickerKind.OnCallSchedule, id: scheduleId };
  }

  const userId: string | undefined = toPeoplePickerIds(
    record[INCOMING_CALL_RULE_USER_KEY],
  )[0];

  if (userId) {
    return { kind: PeoplePickerKind.User, id: userId };
  }

  return null;
};

/*
 * The one "Who to call" field. Required - a rule that calls nobody is the
 * one way a rule can be useless - and when nobody is picked it says what to
 * do rather than "Who to call is required".
 */
export const getIncomingCallRuleTargetFormField: <TEntity>(
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
    title: "Who to call",
    description:
      "An on-call schedule rings whoever is on call in it when the call comes in.",
    required: true,
    ...options,
    field: {
      [INCOMING_CALL_RULE_TARGET_FIELD_KEY]: true,
    } as SelectFormFields<TEntity>,
    fieldType: FormFieldSchemaType.PeoplePicker,
    peoplePicker: getIncomingCallRuleTargetPickerConfig(),
    formOnly: true,
  };

  if (!options?.customValidation) {
    field.customValidation = (values: FormValues<TEntity>): string | null => {
      const isRequired: boolean =
        typeof field.required === "function"
          ? field.required(values)
          : Boolean(field.required);

      if (!isRequired || readIncomingCallRuleTarget(values)) {
        return null;
      }

      return (
        translateText(INCOMING_CALL_RULE_REQUIRED_MESSAGE) ||
        INCOMING_CALL_RULE_REQUIRED_MESSAGE
      );
    };
  }

  return field;
};

export interface IncomingCallEscalationRuleFormOptions {
  /*
   * The rule's place in the list: the one it has (edit), or the one it
   * will have at the end of the list (create). A rule nobody names is
   * shown as "Level <place>".
   */
  level: number;
  // An edit form starts from the rule's own values: no prefilled ring time.
  isEditing?: boolean | undefined;
}

/*
 * The add and edit forms' fields, in order: Who to call, Ring for, then the
 * folded Advanced section with the name and the description. No steps: two
 * questions and a folded section are one short page.
 */
export const getIncomingCallEscalationRuleFormFields: <TEntity>(
  options: IncomingCallEscalationRuleFormOptions,
) => Array<Field<TEntity>> = <TEntity>(
  options: IncomingCallEscalationRuleFormOptions,
): Array<Field<TEntity>> => {
  const level: number = options.level;

  const advanced: FormFieldCollapsibleSection<TEntity> =
    getAdvancedFormSection<TEntity>({
      isConfigured: (values: FormValues<TEntity>): boolean => {
        return isEscalationRuleAdvancedConfigured(values, level);
      },
    });

  return [
    getIncomingCallRuleTargetFormField<TEntity>(),
    {
      field: { escalateAfterSeconds: true } as SelectFormFields<TEntity>,
      title: "Ring for (in seconds)",
      description:
        "If nobody answers in this time, the call moves on to the next rule. Keep it shorter than their phone takes to go to voicemail.",
      fieldType: FormFieldSchemaType.Number,
      required: true,
      placeholder: String(DEFAULT_INCOMING_CALL_RING_SECONDS),
      validation: {
        minValue: MIN_INCOMING_CALL_RING_SECONDS,
        maxValue: MAX_INCOMING_CALL_RING_SECONDS,
      },
      defaultValue: options.isEditing
        ? undefined
        : DEFAULT_INCOMING_CALL_RING_SECONDS,
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
      placeholder: "Describe who this rule calls and why.",
      collapsibleSection: advanced,
    },
  ];
};

// The columns a rule's target is kept in.
export interface IncomingCallRuleTargetColumns {
  userId?: ObjectID | undefined;
  onCallDutyPolicyScheduleId?: ObjectID | undefined;
  name?: string | undefined;
}

/*
 * A new rule as it is sent: its target in its own column as an id, the
 * column it does not use left out, and a name left empty left out too - the
 * list shows the rule after its level. Refuses a rule that calls nobody,
 * which the form never lets through.
 */
export const prepareIncomingCallRuleForCreate: <
  TRule extends IncomingCallRuleTargetColumns,
>(
  rule: TRule,
) => TRule = <TRule extends IncomingCallRuleTargetColumns>(
  rule: TRule,
): TRule => {
  const target: IncomingCallRuleTarget | null =
    readIncomingCallRuleTarget(rule);

  if (!target) {
    throw new BadDataException(
      translateText(INCOMING_CALL_RULE_REQUIRED_MESSAGE) ||
        INCOMING_CALL_RULE_REQUIRED_MESSAGE,
    );
  }

  delete rule.userId;
  delete rule.onCallDutyPolicyScheduleId;

  if (target.kind === PeoplePickerKind.OnCallSchedule) {
    rule.onCallDutyPolicyScheduleId = new ObjectID(target.id);
  } else {
    rule.userId = new ObjectID(target.id);
  }

  if (typeof rule.name !== "string" || !rule.name.trim()) {
    delete rule.name;
  }

  return rule;
};
