import "@testing-library/jest-dom";
import { describe, expect, test } from "@jest/globals";
import {
  RULE_EXCEPTION_FORM_STEPS,
  getFormExceptionKind,
  getRuleExceptionEntityTypeOptions,
  getRuleExceptionFormFields,
  getRuleExceptionKindChoices,
  getRuleExceptionWindowDefaults,
  isRuleExceptionFormEdit,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/RuleExceptions/RuleExceptionFormFields";
import {
  ENDS_AT_FIELD_TITLE,
  EXPIRES_AT_FIELD_TITLE,
  FIELD_NAME_FIELD_TITLE,
  KIND_FIELD_TITLE,
  REASON_FIELD_TITLE,
  RULE_FIELD_TITLE,
  STARTS_AT_FIELD_TITLE,
  STEP_WHAT_TO_SKIP,
  STEP_WHY,
  VALUE_FIELD_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/RuleExceptions/RuleExceptionsCopy";
import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import DetectionRuleException from "../../../Models/DatabaseModels/DetectionRuleException";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import { DetectionRuleExceptionKind } from "../../../Types/SecurityEvent/DetectionRuleException";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import { ModelField } from "../../../UI/Components/Forms/ModelForm";
import {
  Translator,
  createTranslator,
} from "../../../UI/Utils/TranslateTemplate";

/*
 * THE ADD EXCEPTION FORM, as every door opens it: two steps - what to skip,
 * then why - each kind asking only its own fields, every field showing the
 * shared rules' problem with it in the reader's language, a new
 * exception's expiry held to the future and an edit's left as it was.
 */

const NOW: Date = new Date("2026-10-27T12:00:00.000Z");
const HOUR: number = 60 * 60 * 1000;
const DAY: number = 24 * HOUR;

// A reader whose language words each problem: German, for the test.
const GERMAN: Record<string, string> = {
  "Enter the user, host or address the rule skips.":
    "Geben Sie den Benutzer, Host oder die Adresse ein, die die Regel überspringt.",
  "An exception expires in the future. To stop one now, delete it.":
    "Eine Ausnahme läuft in der Zukunft ab. Um eine sofort zu beenden, löschen Sie sie.",
};

const german: Translator = createTranslator((text: string) => {
  return GERMAN[text];
}, "de");

const english: Translator = createTranslator(undefined, "en");

type Field = ModelField<DetectionRuleException>;

function fields(options: { translator?: Translator } = {}): Array<Field> {
  return getRuleExceptionFormFields({
    translator: options.translator || english,
    getNow: (): Date => {
      return NOW;
    },
  });
}

function column(field: Field): string {
  return Object.keys(field.field || {})[0] || "";
}

function byColumn(name: string, list: Array<Field> = fields()): Field {
  const field: Field | undefined = list.find((candidate: Field): boolean => {
    return column(candidate) === name;
  });

  expect(field).toBeDefined();

  return field!;
}

function values(
  data: Record<string, unknown>,
): FormValues<DetectionRuleException> {
  return data as FormValues<DetectionRuleException>;
}

// The columns a kind's form shows, in order.
function shownFor(kind: DetectionRuleExceptionKind): Array<string> {
  return fields()
    .filter((field: Field): boolean => {
      return !field.showIf || field.showIf(values({ kind }));
    })
    .map(column);
}

function isRequired(field: Field, data: Record<string, unknown>): boolean {
  return typeof field.required === "function"
    ? field.required(values(data))
    : Boolean(field.required);
}

describe("two steps: what to skip, then why", () => {
  test("the steps, by their words", () => {
    expect(
      RULE_EXCEPTION_FORM_STEPS.map((step: { id: string; title: string }) => {
        return [step.id, step.title];
      }),
    ).toEqual([
      ["what-to-skip", STEP_WHAT_TO_SKIP],
      ["why", STEP_WHY],
    ]);
  });

  test("the rule and what it skips first; the reason and the expiry after", () => {
    const steps: Record<string, string> = {};

    for (const field of fields()) {
      steps[column(field)] = field.stepId || "";
    }

    expect(steps).toEqual({
      detectionRule: "what-to-skip",
      kind: "what-to-skip",
      entityType: "what-to-skip",
      fieldName: "what-to-skip",
      value: "what-to-skip",
      startsAt: "what-to-skip",
      endsAt: "what-to-skip",
      reason: "why",
      expiresAt: "why",
    });
  });

  test("every field names itself in the form's words", () => {
    expect(
      fields().map((field: Field): [string, string | undefined] => {
        return [column(field), field.title];
      }),
    ).toEqual([
      ["detectionRule", RULE_FIELD_TITLE],
      ["kind", KIND_FIELD_TITLE],
      ["entityType", "Entity Type"],
      ["fieldName", FIELD_NAME_FIELD_TITLE],
      ["value", VALUE_FIELD_TITLE],
      ["startsAt", STARTS_AT_FIELD_TITLE],
      ["endsAt", ENDS_AT_FIELD_TITLE],
      ["reason", REASON_FIELD_TITLE],
      ["expiresAt", EXPIRES_AT_FIELD_TITLE],
    ]);
    // Never a bare "Field" or "From": words other screens use otherwise.
    expect(FIELD_NAME_FIELD_TITLE).toBe("Event Field");
    expect(STARTS_AT_FIELD_TITLE).toBe("Starts At");
    expect(ENDS_AT_FIELD_TITLE).toBe("Ends At");
    expect(EXPIRES_AT_FIELD_TITLE).toBe("Expires At");
  });
});

describe("the rule", () => {
  test("a dropdown of the project's detection rules, by name, required", () => {
    const rule: Field = byColumn("detectionRule");

    expect(rule.fieldType).toBe(FormFieldSchemaType.Dropdown);
    expect(rule.dropdownModal?.type).toBe(DetectionRule);
    expect(rule.dropdownModal?.labelField).toBe("name");
    expect(rule.dropdownModal?.valueField).toBe("_id");
    expect(rule.required).toBe(true);
  });
});

describe("what the rule skips", () => {
  test("an entity, a value or a time window, each said in a line", () => {
    const kind: Field = byColumn("kind");

    expect(kind.fieldType).toBe(FormFieldSchemaType.RadioButton);
    expect(kind.defaultValue).toBe(DetectionRuleExceptionKind.Entity);
    expect(
      getRuleExceptionKindChoices().map(
        (choice: { value: string; title: string }) => {
          return [choice.value, choice.title];
        },
      ),
    ).toEqual([
      [DetectionRuleExceptionKind.Entity, "An entity"],
      [DetectionRuleExceptionKind.Value, "A value"],
      [DetectionRuleExceptionKind.TimeWindow, "A time window"],
    ]);
    expect(kind.radioButtonOptions).toEqual(getRuleExceptionKindChoices());
  });

  test("an entity is a user, a host or an IP address", () => {
    expect(getRuleExceptionEntityTypeOptions()).toEqual([
      { label: SecurityEntityType.User, value: SecurityEntityType.User },
      { label: SecurityEntityType.Host, value: SecurityEntityType.Host },
      {
        label: SecurityEntityType.IpAddress,
        value: SecurityEntityType.IpAddress,
      },
    ]);
  });

  test("each kind asks only its own fields", () => {
    expect(shownFor(DetectionRuleExceptionKind.Entity)).toEqual([
      "detectionRule",
      "kind",
      "entityType",
      "value",
      "reason",
      "expiresAt",
    ]);
    expect(shownFor(DetectionRuleExceptionKind.Value)).toEqual([
      "detectionRule",
      "kind",
      "fieldName",
      "value",
      "reason",
      "expiresAt",
    ]);
    // A window ends by itself: no expiry.
    expect(shownFor(DetectionRuleExceptionKind.TimeWindow)).toEqual([
      "detectionRule",
      "kind",
      "startsAt",
      "endsAt",
      "reason",
    ]);
  });

  test("the form starts on an entity until another kind is chosen", () => {
    expect(getFormExceptionKind(values({}))).toBe(
      DetectionRuleExceptionKind.Entity,
    );
    expect(getFormExceptionKind(values({ kind: "nonsense" }))).toBe(
      DetectionRuleExceptionKind.Entity,
    );
    expect(
      getFormExceptionKind(values({ kind: DetectionRuleExceptionKind.Value })),
    ).toBe(DetectionRuleExceptionKind.Value);
  });

  test("a field is required for the kind that shows it, and only then", () => {
    expect(
      isRequired(byColumn("fieldName"), {
        kind: DetectionRuleExceptionKind.Value,
      }),
    ).toBe(true);
    expect(
      isRequired(byColumn("fieldName"), {
        kind: DetectionRuleExceptionKind.Entity,
      }),
    ).toBe(false);
    expect(
      isRequired(byColumn("startsAt"), {
        kind: DetectionRuleExceptionKind.TimeWindow,
      }),
    ).toBe(true);
    expect(
      isRequired(byColumn("value"), {
        kind: DetectionRuleExceptionKind.TimeWindow,
      }),
    ).toBe(false);
    expect(isRequired(byColumn("reason"), {})).toBe(true);
    expect(isRequired(byColumn("expiresAt"), {})).toBe(false);
  });

  test("a value or a field name is typed as written: no spelling fixes", () => {
    expect(byColumn("value").disableSpellCheck).toBe(true);
    expect(byColumn("fieldName").disableSpellCheck).toBe(true);
  });
});

describe("each field's problem, in the reader's language", () => {
  function problem(
    name: string,
    data: Record<string, unknown>,
    options: { translator?: Translator } = {},
  ): string | null {
    return byColumn(name, fields(options)).customValidation!(values(data));
  }

  test("a field with nothing wrong has no problem", () => {
    expect(
      problem("value", {
        kind: DetectionRuleExceptionKind.Entity,
        entityType: SecurityEntityType.User,
        value: "svc-*",
        reason: "Backups.",
      }),
    ).toBeNull();
  });

  test("each problem shows under its own field only", () => {
    const empty: Record<string, unknown> = {
      kind: DetectionRuleExceptionKind.Entity,
      entityType: SecurityEntityType.User,
      value: "",
      reason: "",
    };

    expect(problem("value", empty)).toBe(
      "Enter the user, host or address the rule skips.",
    );
    expect(problem("reason", empty)).toBe(
      "Say why it is safe for the rule to skip this.",
    );
    expect(problem("expiresAt", empty)).toBeNull();
  });

  test("in German, for a German reader", () => {
    expect(
      problem(
        "value",
        { kind: DetectionRuleExceptionKind.Entity, value: " " },
        { translator: german },
      ),
    ).toBe(
      "Geben Sie den Benutzer, Host oder die Adresse ein, die die Regel überspringt.",
    );
  });

  test("a field of another kind has no problem, whatever it holds", () => {
    expect(
      problem("fieldName", {
        kind: DetectionRuleExceptionKind.Entity,
        fieldName: "has spaces",
      }),
    ).toBeNull();
    expect(
      problem("fieldName", {
        kind: DetectionRuleExceptionKind.Value,
        fieldName: "has spaces",
        value: "x",
      }),
    ).toBe(
      "A field name has no spaces: principalUser, processName or an attribute key such as http.user_agent.",
    );
  });

  test("a window's end is checked against its start, and its length", () => {
    expect(
      problem("endsAt", {
        kind: DetectionRuleExceptionKind.TimeWindow,
        startsAt: NOW.toISOString(),
        endsAt: new Date(NOW.getTime() - HOUR).toISOString(),
      }),
    ).toBe("The window must end after it starts.");
    expect(
      problem("endsAt", {
        kind: DetectionRuleExceptionKind.TimeWindow,
        startsAt: NOW.toISOString(),
        endsAt: new Date(NOW.getTime() + 31 * DAY).toISOString(),
      }),
    ).toBe(
      "A window is at most 30 days. To stop a rule for longer, turn it off.",
    );
  });

  test("a new exception's expiry must be ahead; an edit's past one is the row's own", () => {
    const expired: Record<string, unknown> = {
      kind: DetectionRuleExceptionKind.Entity,
      entityType: SecurityEntityType.User,
      value: "alice",
      reason: "Testing.",
      expiresAt: new Date(NOW.getTime() - DAY).toISOString(),
    };

    // A new exception: no row id in the form's values.
    expect(problem("expiresAt", expired)).toBe(
      "An exception expires in the future. To stop one now, delete it.",
    );
    expect(problem("expiresAt", expired, { translator: german })).toBe(
      "Eine Ausnahme läuft in der Zukunft ab. Um eine sofort zu beenden, löschen Sie sie.",
    );

    /*
     * An Edit form holds the row's id: its expiry, past or not, is the
     * row's own, so the reason of an exception that expired can still be
     * fixed. The list's table never tells the page which form it opened, so
     * the form reads it from its values.
     */
    expect(
      problem("expiresAt", {
        ...expired,
        _id: "2c000000-0000-4000-8000-000000000004",
      }),
    ).toBeNull();
  });
});

describe("whether the form edits a saved exception", () => {
  test("an Edit form's values carry the row's id; a new one's do not", () => {
    expect(isRuleExceptionFormEdit(values({}))).toBe(false);
    expect(isRuleExceptionFormEdit(values({ _id: "" }))).toBe(false);
    expect(isRuleExceptionFormEdit(values({ _id: "  " }))).toBe(false);
    expect(
      isRuleExceptionFormEdit(
        values({ _id: "2c000000-0000-4000-8000-000000000004" }),
      ),
    ).toBe(true);
  });

  test("an id read from a model counts as its text", () => {
    expect(
      isRuleExceptionFormEdit(
        values({
          _id: {
            toString: (): string => {
              return "2c000000-0000-4000-8000-000000000004";
            },
          },
        }),
      ),
    ).toBe(true);
  });
});

describe("a new window", () => {
  test("starts now, to the minute, and ends two hours later", () => {
    expect(
      getRuleExceptionWindowDefaults(new Date("2026-10-27T12:34:56.789Z")),
    ).toEqual({
      startsAt: new Date("2026-10-27T12:34:00.000Z"),
      endsAt: new Date("2026-10-27T14:34:00.000Z"),
    });
  });
});
