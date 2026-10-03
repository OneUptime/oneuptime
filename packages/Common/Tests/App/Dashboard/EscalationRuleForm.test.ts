import { describe, expect, test } from "@jest/globals";
import {
  countEscalationRuleResponders,
  ESCALATION_RULE_NOTIFY_FIELD_KEY,
  ESCALATION_RULE_NOTIFY_REQUIRED_MESSAGE,
  ESCALATION_RULE_SCHEDULES_KEY,
  ESCALATION_RULE_TEAMS_KEY,
  ESCALATION_RULE_USERS_KEY,
  getEscalationRuleFormFields,
  getEscalationRuleNotifyFormField,
  getEscalationRuleNotifyPickerConfig,
  isEscalationRuleAdvancedConfigured,
  readEscalationRuleResponderIds,
  resolveEscalationRuleName,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/EscalationRule/EscalationRuleForm";
import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import { DEFAULT_ESCALATE_AFTER_IN_MINUTES } from "../../../Types/OnCallDutyPolicy/EscalationRuleDefaults";
import ObjectID from "../../../Types/ObjectID";
import Field, {
  FormFieldCollapsibleSection,
} from "../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import {
  ADVANCED_FORM_SECTION_ID,
  ADVANCED_FORM_SECTION_TITLE,
  isFormSectionConfigured,
} from "../../../UI/Components/Forms/Utils/AdvancedFormSection";
import { PeoplePickerKind } from "../../../UI/Components/PeoplePicker/PeoplePickerTypes";

/*
 * ADDING AN ESCALATION RULE IS ONE SHORT STEP.
 *
 * The rule's form used to be three steps - a required name, three dropdowns
 * for "who gets paged", and an empty required number. These pin what replaced
 * it: two questions (who to notify, in one picker; how long to wait, 30
 * minutes unless changed) and a folded Advanced section with the name and the
 * description, which a rule can do without.
 */

type RuleField = Field<OnCallDutyPolicyEscalationRule>;

const keyOf: (field: RuleField) => string = (field: RuleField): string => {
  return Object.keys(field.field || {})[0] || "";
};

const fieldsFor: (level: number, isEditing?: boolean) => Array<RuleField> = (
  level: number,
  isEditing?: boolean,
): Array<RuleField> => {
  return getEscalationRuleFormFields<OnCallDutyPolicyEscalationRule>({
    level,
    isEditing,
  });
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
) => FormValues<OnCallDutyPolicyEscalationRule> = (
  record: Record<string, unknown>,
): FormValues<OnCallDutyPolicyEscalationRule> => {
  return record as FormValues<OnCallDutyPolicyEscalationRule>;
};

describe("the add form", () => {
  const fields: Array<RuleField> = fieldsFor(3);

  test("asks who to notify and how long to wait, then folds the rest", () => {
    expect(fields.map(keyOf)).toEqual([
      ESCALATION_RULE_NOTIFY_FIELD_KEY,
      "escalateAfterInMinutes",
      "name",
      "description",
    ]);
  });

  test("is one step: no field is placed on a step", () => {
    for (const field of fields) {
      expect(field.stepId).toBeUndefined();
    }
  });

  test("asks who to notify with one picker of schedules, teams and people", () => {
    const notify: RuleField = fieldByKey(
      fields,
      ESCALATION_RULE_NOTIFY_FIELD_KEY,
    );

    expect(notify.title).toBe("Notify");
    expect(notify.fieldType).toBe(FormFieldSchemaType.PeoplePicker);
    expect(notify.required).toBe(true);
    // The picker's own key is never sent; its picks are.
    expect(notify.formOnly).toBe(true);
    expect(notify.peoplePicker?.kinds).toEqual([
      {
        kind: PeoplePickerKind.OnCallSchedule,
        valueKey: ESCALATION_RULE_SCHEDULES_KEY,
      },
      { kind: PeoplePickerKind.Team, valueKey: ESCALATION_RULE_TEAMS_KEY },
      { kind: PeoplePickerKind.User, valueKey: ESCALATION_RULE_USERS_KEY },
    ]);
  });

  test("writes the three lists the rule's join tables are made from", () => {
    expect(ESCALATION_RULE_SCHEDULES_KEY).toBe("onCallSchedules");
    expect(ESCALATION_RULE_TEAMS_KEY).toBe("teams");
    expect(ESCALATION_RULE_USERS_KEY).toBe("users");
  });

  test("waits 30 minutes for an acknowledgement unless told otherwise", () => {
    const wait: RuleField = fieldByKey(fields, "escalateAfterInMinutes");

    expect(wait.fieldType).toBe(FormFieldSchemaType.Number);
    expect(wait.required).toBe(true);
    expect(wait.defaultValue).toBe(DEFAULT_ESCALATE_AFTER_IN_MINUTES);
    expect(wait.defaultValue).toBe(30);
    expect(wait.validation?.minValue).toBe(0);
  });

  test("does not require a name, and shows the one the rule gets", () => {
    const name: RuleField = fieldByKey(fields, "name");

    expect(name.required).toBe(false);
    expect(name.placeholder).toBe("Level 3");
  });

  test("folds the name and the description into one Advanced section", () => {
    const name: RuleField = fieldByKey(fields, "name");
    const description: RuleField = fieldByKey(fields, "description");

    expect(description.required).toBe(false);
    expect(name.collapsibleSection).toBeDefined();
    // One section: the same object on both fields, written once.
    expect(description.collapsibleSection).toBe(name.collapsibleSection);

    const section: FormFieldCollapsibleSection<OnCallDutyPolicyEscalationRule> =
      name.collapsibleSection!;

    expect(section.id).toBe(ADVANCED_FORM_SECTION_ID);
    expect(section.title).toBe(ADVANCED_FORM_SECTION_TITLE);
    // Folded on Create and on Edit alike.
    expect(section.openWhenConfigured).toBe(false);
  });

  test("leaves who to notify and the wait out of the Advanced section", () => {
    expect(
      fieldByKey(fields, ESCALATION_RULE_NOTIFY_FIELD_KEY).collapsibleSection,
    ).toBeUndefined();
    expect(
      fieldByKey(fields, "escalateAfterInMinutes").collapsibleSection,
    ).toBeUndefined();
  });

  test("names the next level in the placeholder, whichever level it is", () => {
    expect(fieldByKey(fieldsFor(1), "name").placeholder).toBe("Level 1");
    expect(fieldByKey(fieldsFor(7), "name").placeholder).toBe("Level 7");
  });
});

describe("the edit form", () => {
  const fields: Array<RuleField> = fieldsFor(2, true);

  test("is the same one step", () => {
    expect(fields.map(keyOf)).toEqual(fieldsFor(2).map(keyOf));

    for (const field of fields) {
      expect(field.stepId).toBeUndefined();
    }
  });

  test("starts from the rule's own wait rather than prefilling 30", () => {
    expect(fieldByKey(fields, "escalateAfterInMinutes").defaultValue).toBe(
      undefined,
    );
  });

  test("shows the level's name for a cleared name", () => {
    expect(fieldByKey(fields, "name").placeholder).toBe("Level 2");
  });
});

describe("whether the Advanced section says Configured", () => {
  const section: FormFieldCollapsibleSection<OnCallDutyPolicyEscalationRule> =
    fieldByKey(fieldsFor(2), "name").collapsibleSection!;

  const configured: (record: Record<string, unknown>) => boolean = (
    record: Record<string, unknown>,
  ): boolean => {
    return isFormSectionConfigured({
      section,
      fields: [],
      values: values(record),
    });
  };

  test("not on a new rule", () => {
    expect(configured({})).toBe(false);
    expect(configured({ name: "", description: "" })).toBe(false);
  });

  test("not for the name the level gives the rule", () => {
    expect(configured({ name: "Level 2" })).toBe(false);
    expect(configured({ name: " level 2 " })).toBe(false);
  });

  test("for a name somebody chose", () => {
    expect(configured({ name: "Managers" })).toBe(true);
    expect(configured({ name: "Level 1" })).toBe(true);
  });

  test("for a description", () => {
    expect(configured({ name: "Level 2", description: "Paged at night" })).toBe(
      true,
    );
    expect(configured({ description: "   " })).toBe(false);
  });

  test("reads anything it is handed without throwing", () => {
    expect(isEscalationRuleAdvancedConfigured(undefined, 1)).toBe(false);
    expect(isEscalationRuleAdvancedConfigured("text", 1)).toBe(false);
    expect(isEscalationRuleAdvancedConfigured({ name: 5 }, 1)).toBe(false);
  });
});

describe("the Notify picker", () => {
  test("lists on-call schedules, then teams, then people", () => {
    expect(
      getEscalationRuleNotifyPickerConfig().kinds.map(
        (entry: { kind: PeoplePickerKind }): PeoplePickerKind => {
          return entry.kind;
        },
      ),
    ).toEqual([
      PeoplePickerKind.OnCallSchedule,
      PeoplePickerKind.Team,
      PeoplePickerKind.User,
    ]);
  });

  test("says what it adds and what it searches", () => {
    const config: ReturnType<typeof getEscalationRuleNotifyPickerConfig> =
      getEscalationRuleNotifyPickerConfig();

    expect(config.addButtonText).toBe("Add responder");
    expect(config.searchPlaceholder).toBe(
      "Search schedules, teams or people...",
    );
    expect(config.emptyText).toBe(
      "No on-call schedules, teams or people to pick from.",
    );
  });

  test("when nobody is picked, says what to do", () => {
    const notify: RuleField = getEscalationRuleNotifyFormField();

    expect(notify.customValidation?.(values({}))).toBe(
      ESCALATION_RULE_NOTIFY_REQUIRED_MESSAGE,
    );
    expect(ESCALATION_RULE_NOTIFY_REQUIRED_MESSAGE).toBe(
      "Add at least one on-call schedule, team or person to notify.",
    );
    expect(
      notify.customValidation?.(
        values({ onCallSchedules: [], teams: [], users: [] }),
      ),
    ).toBe(ESCALATION_RULE_NOTIFY_REQUIRED_MESSAGE);
  });

  const ANSWERS: Array<[string, Record<string, Array<string>>]> = [
    ["an on-call schedule", { onCallSchedules: ["schedule-1"] }],
    ["a team", { teams: ["team-1"] }],
    ["a person", { users: ["user-1"] }],
  ];

  test.each(ANSWERS)(
    "is answered by %s alone",
    (_label: string, picks: Record<string, Array<string>>) => {
      expect(
        getEscalationRuleNotifyFormField().customValidation?.(
          values({ ...picks }),
        ),
      ).toBeNull();
    },
  );

  test("made optional, it accepts nobody", () => {
    const notify: RuleField = getEscalationRuleNotifyFormField({
      required: false,
    });

    expect(notify.customValidation?.(values({}))).toBeNull();
  });

  test("required only sometimes, it asks for a pick only then", () => {
    const notify: RuleField = getEscalationRuleNotifyFormField({
      required: (formValues: FormValues<OnCallDutyPolicyEscalationRule>) => {
        return Boolean(
          (formValues as unknown as Record<string, unknown>)["pageSomebody"],
        );
      },
    });

    expect(notify.customValidation?.(values({}))).toBeNull();
    expect(notify.customValidation?.(values({ pageSomebody: true }))).toBe(
      ESCALATION_RULE_NOTIFY_REQUIRED_MESSAGE,
    );
    expect(
      notify.customValidation?.(
        values({ pageSomebody: true, users: ["user-1"] }),
      ),
    ).toBeNull();
  });

  test("a caller's own validation is kept", () => {
    const notify: RuleField = getEscalationRuleNotifyFormField({
      customValidation: (): string => {
        return "Pick the first responders.";
      },
    });

    expect(notify.customValidation?.(values({ users: ["user-1"] }))).toBe(
      "Pick the first responders.",
    );
  });

  test("a caller can make it optional or retitle it", () => {
    const notify: RuleField = getEscalationRuleNotifyFormField({
      title: "First responders",
      required: false,
      stepId: "responders",
    });

    expect(notify.title).toBe("First responders");
    expect(notify.required).toBe(false);
    expect(notify.stepId).toBe("responders");
    // What makes it the Notify picker cannot be overridden.
    expect(notify.fieldType).toBe(FormFieldSchemaType.PeoplePicker);
    expect(keyOf(notify)).toBe(ESCALATION_RULE_NOTIFY_FIELD_KEY);
  });
});

describe("reading the responders a form holds", () => {
  test("reads each kind's ids", () => {
    expect(
      readEscalationRuleResponderIds({
        onCallSchedules: ["s1"],
        teams: ["t1", "t2"],
        users: ["u1"],
        name: "ignored",
      }),
    ).toEqual({ onCallSchedules: ["s1"], teams: ["t1", "t2"], users: ["u1"] });
  });

  test("reads ObjectIDs, related rows and dropdown options as ids", () => {
    expect(
      readEscalationRuleResponderIds({
        onCallSchedules: [new ObjectID("aaaaaaaa-1111-4111-8111-111111111111")],
        teams: [{ _id: "t1" }],
        users: [{ value: "u1", label: "Alex" }],
      }),
    ).toEqual({
      onCallSchedules: ["aaaaaaaa-1111-4111-8111-111111111111"],
      teams: ["t1"],
      users: ["u1"],
    });
  });

  test("names each responder once", () => {
    expect(
      readEscalationRuleResponderIds({ users: ["u1", "u1", " u1 "] }).users,
    ).toEqual(["u1"]);
  });

  test("a kind nobody picked is an empty list", () => {
    expect(readEscalationRuleResponderIds({})).toEqual({
      onCallSchedules: [],
      teams: [],
      users: [],
    });
    expect(readEscalationRuleResponderIds(undefined)).toEqual({
      onCallSchedules: [],
      teams: [],
      users: [],
    });
  });

  test("counts every pick of every kind", () => {
    expect(
      countEscalationRuleResponders({
        onCallSchedules: ["s1"],
        teams: ["t1", "t2"],
        users: [],
      }),
    ).toBe(3);
  });
});

describe("the name a rule is saved with", () => {
  test("is what was typed", () => {
    expect(resolveEscalationRuleName("Managers", 2)).toBe("Managers");
  });

  test("is the level's name when the field was left empty", () => {
    expect(resolveEscalationRuleName("", 2)).toBe("Level 2");
    expect(resolveEscalationRuleName("   ", 4)).toBe("Level 4");
    expect(resolveEscalationRuleName(undefined, 1)).toBe("Level 1");
    expect(resolveEscalationRuleName(null, 3)).toBe("Level 3");
  });
});
