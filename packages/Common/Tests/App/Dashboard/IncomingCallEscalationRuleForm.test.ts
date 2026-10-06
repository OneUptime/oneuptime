import { describe, expect, test } from "@jest/globals";
import {
  getIncomingCallEscalationRuleFormFields,
  getIncomingCallRuleTargetFormField,
  getIncomingCallRuleTargetPickerConfig,
  INCOMING_CALL_RULE_ADD_BUTTON_TEXT,
  INCOMING_CALL_RULE_EMPTY_TEXT,
  INCOMING_CALL_RULE_REQUIRED_MESSAGE,
  INCOMING_CALL_RULE_SCHEDULE_KEY,
  INCOMING_CALL_RULE_TARGET_FIELD_KEY,
  INCOMING_CALL_RULE_USER_KEY,
  IncomingCallRuleTarget,
  prepareIncomingCallRuleForCreate,
  readIncomingCallRuleTarget,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/EscalationRule/IncomingCallEscalationRuleForm";
import IncomingCallPolicyEscalationRule from "../../../Models/DatabaseModels/IncomingCallPolicyEscalationRule";
import BadDataException from "../../../Types/Exception/BadDataException";
import {
  DEFAULT_INCOMING_CALL_RING_SECONDS,
  MAX_INCOMING_CALL_RING_SECONDS,
  MIN_INCOMING_CALL_RING_SECONDS,
} from "../../../Types/IncomingCall/IncomingCallRingTime";
import ObjectID from "../../../Types/ObjectID";
import Field, {
  FormFieldCollapsibleSection,
} from "../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import Validation from "../../../UI/Components/Forms/Validation";
import {
  ADVANCED_FORM_SECTION_ID,
  MORE_FIELDS_SECTION_TITLE,
  isFormSectionConfigured,
} from "../../../UI/Components/Forms/Utils/AdvancedFormSection";
import {
  PeoplePickerKind,
  toPeoplePickerFormValues,
} from "../../../UI/Components/PeoplePicker/PeoplePickerTypes";

/*
 * ADDING AN INCOMING CALL ESCALATION RULE IS ONE SHORT STEP.
 *
 * An incoming call policy's escalation rule used to be added in three steps
 * - a name and a description, a "Notify" dropdown switching between a
 * schedule dropdown and a user dropdown, and "Escalate After (Seconds)".
 * These pin what replaced it: two questions (who to call, in one picker of
 * on-call schedules and people that takes one pick; how long to ring, 20
 * seconds unless changed) and a folded Advanced section with the name and
 * the description, which a rule can do without.
 *
 * A new rule rings for 20 seconds so the call moves on before most
 * voicemail picks up; rules used to start at 30, and an edit opens a rule on
 * the ring time it was saved with.
 */

type RuleField = Field<IncomingCallPolicyEscalationRule>;

const SCHEDULE_ID: string = "5c4e2d1a-0000-4000-8000-000000000001";
const USER_ID: string = "5c4e2d1a-0000-4000-8000-000000000002";

const keyOf: (field: RuleField) => string = (field: RuleField): string => {
  return Object.keys(field.field || {})[0] || "";
};

const fieldsFor: (level: number, isEditing?: boolean) => Array<RuleField> = (
  level: number,
  isEditing?: boolean,
): Array<RuleField> => {
  return getIncomingCallEscalationRuleFormFields<IncomingCallPolicyEscalationRule>(
    {
      level,
      isEditing,
    },
  );
};

const fieldByKey: (fields: Array<RuleField>, key: string) => RuleField = (
  fields: Array<RuleField>,
  key: string,
): RuleField => {
  const found: RuleField | undefined = fields.find(
    (field: RuleField): boolean => {
      return keyOf(field) === key;
    },
  );

  if (!found) {
    throw new Error(`No field ${key}`);
  }

  return found;
};

const values: (
  record: Record<string, unknown>,
) => FormValues<IncomingCallPolicyEscalationRule> = (
  record: Record<string, unknown>,
): FormValues<IncomingCallPolicyEscalationRule> => {
  return record as FormValues<IncomingCallPolicyEscalationRule>;
};

// What the form's validation says about a set of values, by field.
const validate: (
  fields: Array<RuleField>,
  record: Record<string, unknown>,
) => Record<string, string> = (
  fields: Array<RuleField>,
  record: Record<string, unknown>,
): Record<string, string> => {
  return Validation.validate({
    formFields: fields.map((field: RuleField) => {
      return { ...field, name: keyOf(field) };
    }),
    values: values(record),
    onValidate: undefined,
    currentFormStepId: null,
  }) as Record<string, string>;
};

describe("the add form", () => {
  const fields: Array<RuleField> = fieldsFor(3);

  test("asks who to call and how long to ring, then folds the rest", () => {
    expect(fields.map(keyOf)).toEqual([
      INCOMING_CALL_RULE_TARGET_FIELD_KEY,
      "escalateAfterSeconds",
      "name",
      "description",
    ]);
  });

  test("is one step: no field is placed on a step", () => {
    for (const field of fields) {
      expect(field.stepId).toBeUndefined();
    }
  });

  test("asks who to call with one picker of schedules and people", () => {
    const target: RuleField = fieldByKey(
      fields,
      INCOMING_CALL_RULE_TARGET_FIELD_KEY,
    );

    expect(target.title).toBe("Who to call");
    expect(target.description).toBe(
      "An on-call schedule rings whoever is on call in it when the call comes in.",
    );
    expect(target.fieldType).toBe(FormFieldSchemaType.PeoplePicker);
    expect(target.required).toBe(true);
    // The picker's own key is never sent; its pick is.
    expect(target.formOnly).toBe(true);
    expect(target.peoplePicker?.kinds).toEqual([
      {
        kind: PeoplePickerKind.OnCallSchedule,
        valueKey: INCOMING_CALL_RULE_SCHEDULE_KEY,
      },
      { kind: PeoplePickerKind.User, valueKey: INCOMING_CALL_RULE_USER_KEY },
    ]);
    // Teams are not offered: a rule calls one schedule or one person.
    expect(
      target.peoplePicker?.kinds.some((entry: { kind: PeoplePickerKind }) => {
        return entry.kind === PeoplePickerKind.Team;
      }),
    ).toBe(false);
  });

  test("takes one pick, written to the rule's own columns", () => {
    const target: RuleField = fieldByKey(
      fields,
      INCOMING_CALL_RULE_TARGET_FIELD_KEY,
    );

    expect(target.peoplePicker?.isSinglePick).toBe(true);
    expect(INCOMING_CALL_RULE_SCHEDULE_KEY).toBe("onCallDutyPolicyScheduleId");
    expect(INCOMING_CALL_RULE_USER_KEY).toBe("userId");
  });

  test("names its button, search and empty list in words about calling", () => {
    const config: ReturnType<typeof getIncomingCallRuleTargetPickerConfig> =
      getIncomingCallRuleTargetPickerConfig();

    expect(config.addButtonText).toBe(INCOMING_CALL_RULE_ADD_BUTTON_TEXT);
    expect(INCOMING_CALL_RULE_ADD_BUTTON_TEXT).toBe("Choose who to call");
    expect(config.searchPlaceholder).toBe("Search schedules or people...");
    expect(config.emptyText).toBe(INCOMING_CALL_RULE_EMPTY_TEXT);
    expect(INCOMING_CALL_RULE_EMPTY_TEXT).toBe(
      "No on-call schedules or people to pick from.",
    );
  });

  test("rings for 20 seconds unless told otherwise, inside what Twilio takes", () => {
    const ring: RuleField = fieldByKey(fields, "escalateAfterSeconds");

    expect(ring.title).toBe("Ring for (in seconds)");
    expect(ring.fieldType).toBe(FormFieldSchemaType.Number);
    expect(ring.required).toBe(true);
    expect(ring.defaultValue).toBe(DEFAULT_INCOMING_CALL_RING_SECONDS);
    expect(ring.defaultValue).toBe(20);
    expect(ring.placeholder).toBe("20");
    expect(ring.validation?.minValue).toBe(MIN_INCOMING_CALL_RING_SECONDS);
    expect(ring.validation?.maxValue).toBe(MAX_INCOMING_CALL_RING_SECONDS);
    expect(ring.collapsibleSection).toBeUndefined();
  });

  test("starts from what the API saves when the ring time is left out", () => {
    const column: { defaultValue?: unknown } =
      new IncomingCallPolicyEscalationRule().getTableColumnMetadata(
        "escalateAfterSeconds",
      ) as { defaultValue?: unknown };

    expect(column.defaultValue).toBe(DEFAULT_INCOMING_CALL_RING_SECONDS);
    expect(fieldByKey(fields, "escalateAfterSeconds").defaultValue).toBe(
      column.defaultValue,
    );
  });

  test("says what the ring time is for, and warns about voicemail", () => {
    const ring: RuleField = fieldByKey(fields, "escalateAfterSeconds");

    expect(ring.description).toBe(
      "If nobody answers in this time, the call moves on to the next rule. Keep it shorter than their phone takes to go to voicemail.",
    );
  });

  test("does not require a name, and shows the one the rule is listed under", () => {
    const name: RuleField = fieldByKey(fields, "name");

    expect(name.required).toBe(false);
    expect(name.placeholder).toBe("Level 3");
    expect(name.description).toBe(
      "Leave it empty to name this rule after its level.",
    );
  });

  test("folds the name and the description under one Advanced section", () => {
    const name: RuleField = fieldByKey(fields, "name");
    const description: RuleField = fieldByKey(fields, "description");

    const section: FormFieldCollapsibleSection<IncomingCallPolicyEscalationRule> =
      name.collapsibleSection!;

    expect(section.id).toBe(ADVANCED_FORM_SECTION_ID);
    expect(section.title).toBe(MORE_FIELDS_SECTION_TITLE);
    expect(description.collapsibleSection).toBe(section);
    expect(description.required).toBe(false);
    expect(description.fieldType).toBe(FormFieldSchemaType.LongText);
    expect(description.placeholder).toBe(
      "Describe who this rule calls and why.",
    );
  });

  test("leaves only the target and the ring time open", () => {
    expect(
      fields
        .filter((field: RuleField): boolean => {
          return !field.collapsibleSection;
        })
        .map(keyOf),
    ).toEqual([INCOMING_CALL_RULE_TARGET_FIELD_KEY, "escalateAfterSeconds"]);
  });
});

describe("the edit form", () => {
  const fields: Array<RuleField> = fieldsFor(2, true);

  test("is the add form, opened on the rule as it is", () => {
    expect(fields.map(keyOf)).toEqual(fieldsFor(2).map(keyOf));
  });

  test("does not prefill the ring time: the rule has its own", () => {
    expect(fieldByKey(fields, "escalateAfterSeconds").defaultValue).toBe(
      undefined,
    );
  });

  test("shows the rule's own level as the name it is listed under", () => {
    expect(fieldByKey(fields, "name").placeholder).toBe("Level 2");
  });
});

describe("the Advanced section's Configured badge", () => {
  const section: FormFieldCollapsibleSection<IncomingCallPolicyEscalationRule> =
    fieldByKey(fieldsFor(2), "name").collapsibleSection!;

  const isConfigured: (record: Record<string, unknown>) => boolean = (
    record: Record<string, unknown>,
  ): boolean => {
    return isFormSectionConfigured({
      section,
      fields: fieldsFor(2),
      values: values(record),
    });
  };

  test("is off for a rule with nothing of its own folded away", () => {
    expect(isConfigured({})).toBe(false);
    expect(isConfigured({ name: "", description: "  " })).toBe(false);
  });

  test("is off for the name its level gives it", () => {
    expect(isConfigured({ name: "Level 2" })).toBe(false);
  });

  test("is on for a name or a description of the user's", () => {
    expect(isConfigured({ name: "Support desk" })).toBe(true);
    expect(isConfigured({ description: "Weekday mornings" })).toBe(true);
  });
});

describe("validation", () => {
  const fields: Array<RuleField> = fieldsFor(1);

  test("asks for whom to call, in words that say what to do", () => {
    const errors: Record<string, string> = validate(fields, {
      escalateAfterSeconds: 30,
    });

    expect(errors[INCOMING_CALL_RULE_TARGET_FIELD_KEY]).toBe(
      INCOMING_CALL_RULE_REQUIRED_MESSAGE,
    );
    expect(INCOMING_CALL_RULE_REQUIRED_MESSAGE).toBe(
      "Choose an on-call schedule or a person to call.",
    );
  });

  test("passes with an on-call schedule or a person picked", () => {
    expect(
      validate(fields, {
        escalateAfterSeconds: 30,
        [INCOMING_CALL_RULE_SCHEDULE_KEY]: SCHEDULE_ID,
        [INCOMING_CALL_RULE_USER_KEY]: null,
      }),
    ).toEqual({});

    expect(
      validate(fields, {
        escalateAfterSeconds: 30,
        [INCOMING_CALL_RULE_SCHEDULE_KEY]: null,
        [INCOMING_CALL_RULE_USER_KEY]: USER_ID,
      }),
    ).toEqual({});
  });

  test("reads a pick the way the picker writes it", () => {
    const config: ReturnType<typeof getIncomingCallRuleTargetPickerConfig> =
      getIncomingCallRuleTargetPickerConfig();

    expect(
      validate(fields, {
        escalateAfterSeconds: 30,
        ...toPeoplePickerFormValues(config, {
          [PeoplePickerKind.User]: [USER_ID],
        }),
      }),
    ).toEqual({});
  });

  test("keeps the ring time inside what Twilio takes", () => {
    const target: Record<string, unknown> = {
      [INCOMING_CALL_RULE_USER_KEY]: USER_ID,
    };

    expect(
      validate(fields, { ...target, escalateAfterSeconds: 4 })[
        "escalateAfterSeconds"
      ],
    ).toBeTruthy();
    expect(
      validate(fields, { ...target, escalateAfterSeconds: 601 })[
        "escalateAfterSeconds"
      ],
    ).toBeTruthy();
    expect(
      validate(fields, { ...target, escalateAfterSeconds: 5 })[
        "escalateAfterSeconds"
      ],
    ).toBeUndefined();
    expect(
      validate(fields, { ...target, escalateAfterSeconds: 600 })[
        "escalateAfterSeconds"
      ],
    ).toBeUndefined();
  });

  test("a form that makes the field optional gets no pick check", () => {
    const field: RuleField =
      getIncomingCallRuleTargetFormField<IncomingCallPolicyEscalationRule>({
        required: false,
      });

    expect(field.customValidation!(values({}))).toBeNull();
  });

  test("a form's own check is kept", () => {
    const field: RuleField =
      getIncomingCallRuleTargetFormField<IncomingCallPolicyEscalationRule>({
        customValidation: (): string => {
          return "Own check";
        },
      });

    expect(field.customValidation!(values({}))).toBe("Own check");
  });
});

describe("reading whom a rule calls", () => {
  test("reads an on-call schedule", () => {
    expect(
      readIncomingCallRuleTarget({
        onCallDutyPolicyScheduleId: SCHEDULE_ID,
        userId: null,
      }),
    ).toEqual({ kind: PeoplePickerKind.OnCallSchedule, id: SCHEDULE_ID });
  });

  test("reads a person", () => {
    expect(
      readIncomingCallRuleTarget({
        onCallDutyPolicyScheduleId: null,
        userId: USER_ID,
      }),
    ).toEqual({ kind: PeoplePickerKind.User, id: USER_ID });
  });

  test("reads ids as a saved rule holds them, and as lists", () => {
    const fromRule: IncomingCallRuleTarget | null = readIncomingCallRuleTarget({
      userId: new ObjectID(USER_ID),
    });

    expect(fromRule).toEqual({ kind: PeoplePickerKind.User, id: USER_ID });

    expect(
      readIncomingCallRuleTarget({
        onCallDutyPolicyScheduleId: [SCHEDULE_ID],
      }),
    ).toEqual({ kind: PeoplePickerKind.OnCallSchedule, id: SCHEDULE_ID });
  });

  test("is nobody when nothing is picked", () => {
    expect(readIncomingCallRuleTarget({})).toBeNull();
    expect(
      readIncomingCallRuleTarget({
        onCallDutyPolicyScheduleId: "",
        userId: [],
      }),
    ).toBeNull();
    expect(readIncomingCallRuleTarget(null)).toBeNull();
    expect(readIncomingCallRuleTarget("not values")).toBeNull();
  });
});

describe("a new rule as it is sent", () => {
  const ruleFrom: (
    data: Partial<
      Record<"userId" | "onCallDutyPolicyScheduleId" | "name", unknown>
    >,
  ) => IncomingCallPolicyEscalationRule = (
    data: Partial<
      Record<"userId" | "onCallDutyPolicyScheduleId" | "name", unknown>
    >,
  ): IncomingCallPolicyEscalationRule => {
    const rule: IncomingCallPolicyEscalationRule =
      new IncomingCallPolicyEscalationRule();
    Object.assign(rule, data);
    return rule;
  };

  test("carries the picked schedule as an id, and no person", () => {
    const rule: IncomingCallPolicyEscalationRule =
      prepareIncomingCallRuleForCreate(
        ruleFrom({ onCallDutyPolicyScheduleId: SCHEDULE_ID, userId: null }),
      );

    expect(rule.onCallDutyPolicyScheduleId).toBeInstanceOf(ObjectID);
    expect(rule.onCallDutyPolicyScheduleId?.toString()).toBe(SCHEDULE_ID);
    expect("userId" in rule && rule.userId !== undefined).toBe(false);
  });

  test("carries the picked person as an id, and no schedule", () => {
    const rule: IncomingCallPolicyEscalationRule =
      prepareIncomingCallRuleForCreate(
        ruleFrom({ onCallDutyPolicyScheduleId: null, userId: USER_ID }),
      );

    expect(rule.userId?.toString()).toBe(USER_ID);
    expect(rule.onCallDutyPolicyScheduleId).toBeUndefined();
  });

  test("leaves an empty name out: the list names the rule after its level", () => {
    expect(
      prepareIncomingCallRuleForCreate(ruleFrom({ userId: USER_ID, name: "" }))
        .name,
    ).toBeUndefined();
    expect(
      prepareIncomingCallRuleForCreate(
        ruleFrom({ userId: USER_ID, name: "   " }),
      ).name,
    ).toBeUndefined();
    expect(
      prepareIncomingCallRuleForCreate(
        ruleFrom({ userId: USER_ID, name: "Support desk" }),
      ).name,
    ).toBe("Support desk");
  });

  test("refuses a rule that calls nobody", () => {
    expect(() => {
      prepareIncomingCallRuleForCreate(ruleFrom({}));
    }).toThrow(BadDataException);
    expect(() => {
      prepareIncomingCallRuleForCreate(ruleFrom({}));
    }).toThrow(INCOMING_CALL_RULE_REQUIRED_MESSAGE);
  });
});
