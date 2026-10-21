/*
 * The If / Else settings as a sentence (Workflow/Condition/ConditionModel):
 * how stored settings read, what each choice writes, what must be filled in,
 * and the condition said back in words.
 *
 * The stored settings never change shape - input-1, operator, input-2 and
 * the two types - so this also holds that every shape a workflow can already
 * have (the templates', a step from before the change, one written through
 * the API) reads as something the settings can show, and that what a choice
 * writes runs the way the settings say it does.
 */

import { JSONObject, JSONValue } from "../../../../../Types/JSON";
import {
  CONDITION_ARGUMENT_IDS,
  ConditionOperator,
  ConditionValueType,
} from "../../../../../Types/Workflow/Components/Condition";
import {
  CONDITION_COMPARE_AS_OPTIONS,
  CONDITION_COMPARISONS,
  CONDITION_COMPARISON_GROUPS,
  ConditionCompareAsOption,
  ConditionComparison,
  ConditionComparisonGroup,
  ConditionComparisonId,
} from "../../../../../Types/Workflow/Components/ConditionComparison";
import { evaluateCondition } from "../../../../../Types/Workflow/Components/ConditionEvaluation";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import {
  WorkflowTemplate,
  getTemplateGraphSpec,
  getWorkflowTemplates,
} from "../../../../../Types/Workflow/Templates";
import {
  ComparisonChange,
  ConditionNote,
  ConditionNoteTone,
  ConditionPhrasePart,
  ConditionPhrasePartKind,
  ConditionState,
  describeConditionMet,
  getConditionNotes,
  hasConditionErrors,
  isBlankConditionValue,
  patchForCompareAs,
  patchForComparison,
  patchForDefaults,
  readConditionState,
  shortReferenceLabel,
  showsCompareAs,
  summarizeCondition,
  validateCondition,
} from "../../../../../UI/Components/Workflow/Condition/ConditionModel";
import {
  ReferenceDescription,
  describeReference,
} from "../../../../../UI/Components/Workflow/ValuePicker/ReferenceDescription";
import { describe, expect, test } from "@jest/globals";

const IDS: typeof CONDITION_ARGUMENT_IDS = CONDITION_ARGUMENT_IDS;

const ENVIRONMENT: string =
  "{{local.components.webhook-1.returnValues.request-body.environment}}";
const STATUS: string =
  "{{local.components.api-get-1.returnValues.response-status}}";
const PROCEED: string =
  "{{local.components.javascript-1.returnValues.returnValue.proceed}}";

// The If / Else in the "branch on a webhook" template, as stored.
const PRODUCTION_CHECK: JSONObject = {
  "input-1-type": "text",
  "input-1": ENVIRONMENT,
  operator: "==",
  "input-2-type": "text",
  "input-2": "production",
};

// Every Jira template's check of its script's decision, as stored.
const PROCEED_CHECK: JSONObject = {
  "input-1-type": "boolean",
  "input-1": PROCEED,
  operator: "==",
  "input-2-type": "boolean",
  "input-2": true,
};

const STATUS_CHECK: JSONObject = {
  "input-1": STATUS,
  operator: ">=",
  "input-2": "400",
  "input-1-type": "number",
  "input-2-type": "number",
};

type DescribeFunction = (reference: string) => ReferenceDescription | null;

// References named by their ids, as the canvas names them.
const byIds: DescribeFunction = (
  reference: string,
): ReferenceDescription | null => {
  return describeReference(reference, {});
};

type ApplyFunction = (args: JSONObject, patch: JSONObject) => JSONObject;

const apply: ApplyFunction = (
  args: JSONObject,
  patch: JSONObject,
): JSONObject => {
  return { ...args, ...patch };
};

type ChooseFunction = (
  args: JSONObject,
  next: ConditionComparisonId,
  hidden?: unknown,
) => { args: JSONObject; change: ComparisonChange };

// Choose a comparison on a step holding `args`, as the settings do.
const choose: ChooseFunction = (
  args: JSONObject,
  next: ConditionComparisonId,
  hidden?: unknown,
): { args: JSONObject; change: ComparisonChange } => {
  const change: ComparisonChange = patchForComparison({
    state: readConditionState(args),
    next: next,
    hiddenCompareWith: hidden,
  });

  return { args: apply(args, change.patch), change: change };
};

type PhraseTextFunction = (parts: Array<ConditionPhrasePart>) => string;

// The phrase as it reads, references as the words on their chips.
const phraseText: PhraseTextFunction = (
  parts: Array<ConditionPhrasePart>,
): string => {
  return parts
    .map((part: ConditionPhrasePart) => {
      if (part.kind === ConditionPhrasePartKind.Reference) {
        return `[${byIds(part.reference || part.text)?.label || part.text}]`;
      }

      return part.text;
    })
    .join("");
};

type MetFunction = (args: JSONObject) => string;

const met: MetFunction = (args: JSONObject): string => {
  return phraseText(describeConditionMet(readConditionState(args)));
};

describe("the comparisons the list offers", () => {
  test("each has its own id and words", () => {
    const ids: Array<string> = CONDITION_COMPARISONS.map(
      (comparison: ConditionComparison) => {
        return comparison.id;
      },
    );
    const labels: Array<string> = CONDITION_COMPARISONS.map(
      (comparison: ConditionComparison) => {
        return comparison.label;
      },
    );

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(labels).size).toBe(labels.length);

    // Plain words, read after "If <value>": no symbols, no capitals.
    for (const label of labels) {
      expect(label).toMatch(/^[a-z ]+$/);
    }
  });

  test("the groups list every comparison exactly once, the everyday two first", () => {
    const listed: Array<ConditionComparisonId> =
      CONDITION_COMPARISON_GROUPS.flatMap((group: ConditionComparisonGroup) => {
        return group.ids;
      });

    expect([...listed].sort()).toEqual(
      CONDITION_COMPARISONS.map((comparison: ConditionComparison) => {
        return comparison.id;
      }).sort(),
    );
    expect(CONDITION_COMPARISON_GROUPS[0]).toEqual({
      ids: [ConditionComparisonId.EqualTo, ConditionComparisonId.NotEqualTo],
    });
    expect(
      CONDITION_COMPARISON_GROUPS.slice(1).map(
        (group: ConditionComparisonGroup) => {
          return group.title;
        },
      ),
    ).toEqual(["Text", "Numbers", "Empty or not", "True or false"]);
  });

  test("every operator the step runs can be chosen", () => {
    for (const operator of Object.values(ConditionOperator)) {
      expect(
        CONDITION_COMPARISONS.some((comparison: ConditionComparison) => {
          return comparison.operator === operator;
        }),
      ).toBe(true);
    }
  });

  test("Compare as offers text, numbers and true or false, never Null or Undefined", () => {
    expect(
      CONDITION_COMPARE_AS_OPTIONS.map((option: ConditionCompareAsOption) => {
        return [option.type, option.label];
      }),
    ).toEqual([
      [ConditionValueType.Text, "Text"],
      [ConditionValueType.Number, "Number"],
      [ConditionValueType.Boolean, "True / False"],
    ]);
  });
});

describe("how stored settings read", () => {
  test("a new step reads is equal to, compared as text, with nothing set", () => {
    const state: ConditionState = readConditionState({});

    expect(state.comparison?.id).toBe(ConditionComparisonId.EqualTo);
    expect(state.compareAs.type).toBe(ConditionValueType.Text);
    expect(state.valueToCheck).toBeUndefined();
    expect(state.compareWith).toBeUndefined();
    expect(readConditionState(undefined).comparison?.id).toBe(
      ConditionComparisonId.EqualTo,
    );
  });

  test("the template's production check", () => {
    const state: ConditionState = readConditionState(PRODUCTION_CHECK);

    expect(state.valueToCheck).toBe(ENVIRONMENT);
    expect(state.comparison?.label).toBe("is equal to");
    expect(state.compareWith).toBe("production");
    expect(state.compareAs.type).toBe(ConditionValueType.Text);
  });

  test("a script's proceed flag reads is true; false reads is false", () => {
    expect(readConditionState(PROCEED_CHECK).comparison?.id).toBe(
      ConditionComparisonId.IsTrue,
    );
    expect(
      readConditionState({ ...PROCEED_CHECK, "input-2": "true" }).comparison
        ?.id,
    ).toBe(ConditionComparisonId.IsTrue);

    for (const value of [false, "false"]) {
      expect(
        readConditionState({ ...PROCEED_CHECK, "input-2": value }).comparison
          ?.id,
      ).toBe(ConditionComparisonId.IsFalse);
    }
  });

  test("true compared as text, or with is not equal to, is not is true", () => {
    expect(
      readConditionState({ ...PRODUCTION_CHECK, "input-2": "true" }).comparison
        ?.id,
    ).toBe(ConditionComparisonId.EqualTo);
    expect(
      readConditionState({ ...PROCEED_CHECK, operator: "!=" }).comparison?.id,
    ).toBe(ConditionComparisonId.NotEqualTo);
  });

  test("two different types read as the one they are compared as", () => {
    expect(
      readConditionState({
        ...PRODUCTION_CHECK,
        "input-1-type": "text",
        "input-2-type": "number",
      }).compareAs.type,
    ).toBe(ConditionValueType.Number);
    expect(
      readConditionState({
        ...PRODUCTION_CHECK,
        "input-1-type": undefined,
        "input-2-type": "boolean",
      }).compareAs.type,
    ).toBe(ConditionValueType.Boolean);
  });

  test("a value compared as Null or Undefined reads as compared differently", () => {
    const state: ConditionState = readConditionState({
      ...PRODUCTION_CHECK,
      "input-2-type": "null",
    });

    expect(state.compareAs.type).toBeNull();
    expect(state.compareAs.types).toEqual({
      valueToCheck: ConditionValueType.Text,
      compareWith: ConditionValueType.Null,
    });
    // Both as null is no better: it ignores both values.
    expect(
      readConditionState({
        ...PRODUCTION_CHECK,
        "input-1-type": "null",
        "input-2-type": "null",
      }).compareAs.type,
    ).toBeNull();
  });

  test("=== and !== read as is equal to and is not equal to", () => {
    expect(
      readConditionState({ ...PRODUCTION_CHECK, operator: "===" }).comparison
        ?.id,
    ).toBe(ConditionComparisonId.EqualTo);
    expect(
      readConditionState({ ...PRODUCTION_CHECK, operator: "!==" }).comparison
        ?.id,
    ).toBe(ConditionComparisonId.NotEqualTo);
  });

  test("a comparison the step does not know reads as none", () => {
    const state: ConditionState = readConditionState({
      ...PRODUCTION_CHECK,
      operator: "~=",
    });

    expect(state.comparison).toBeNull();
    expect(state.operatorIsReference).toBe(false);
  });

  test("a comparison taken from a reference reads as that reference", () => {
    const state: ConditionState = readConditionState({
      ...PRODUCTION_CHECK,
      operator: "{{local.variables.OPERATOR}}",
    });

    expect(state.operatorIsReference).toBe(true);
    expect(state.comparison).toBeNull();
    expect(state.operator).toBe("{{local.variables.OPERATOR}}");
  });

  test("every If / Else in every template reads as a comparison the list offers", () => {
    let seen: number = 0;

    for (const template of getWorkflowTemplates()) {
      for (const node of getTemplateGraphSpec((template as WorkflowTemplate).id)
        ?.nodes || []) {
        if (node.metadataId !== ComponentID.IfElse) {
          continue;
        }

        seen++;
        const state: ConditionState = readConditionState(node.args);

        expect({
          template: template.id,
          step: node.componentId,
          comparison: state.comparison !== null,
          comparedTheSameWay: state.compareAs.type !== null,
          errors: hasConditionErrors(validateCondition(state)),
        }).toEqual({
          template: template.id,
          step: node.componentId,
          comparison: true,
          comparedTheSameWay: true,
          errors: false,
        });
      }
    }

    // The Jira templates alone have several.
    expect(seen).toBeGreaterThan(3);
  });
});

describe("what a choice writes", () => {
  test("a number comparison compares numbers", () => {
    const { args } = choose(
      PRODUCTION_CHECK,
      ConditionComparisonId.GreaterThan,
    );

    expect(args).toEqual({
      ...PRODUCTION_CHECK,
      operator: ">",
      "input-1-type": "number",
      "input-2-type": "number",
    });
  });

  test("so on a new step too, whose types are not set", () => {
    const { change } = choose({}, ConditionComparisonId.LessThanOrEqualTo);

    expect(change.patch).toEqual({
      operator: "<=",
      "input-1-type": "number",
      "input-2-type": "number",
    });
  });

  test("a text comparison compares text", () => {
    const { args } = choose(STATUS_CHECK, ConditionComparisonId.Contains);

    expect(args[IDS.comparison]).toBe("contains");
    expect(args[IDS.valueToCheckType]).toBe("text");
    expect(args[IDS.compareWithType]).toBe("text");
  });

  test("is equal to keeps how the values are compared", () => {
    const { change } = choose(STATUS_CHECK, ConditionComparisonId.EqualTo);

    expect(change.patch).toEqual({ operator: "==" });
  });

  test("Text chosen under Compare as holds until the comparison changes", () => {
    // Dates as text: the person chose Text for is greater than.
    const datesAsText: JSONObject = apply(
      choose({}, ConditionComparisonId.GreaterThan).args,
      patchForCompareAs(ConditionValueType.Text),
    );

    expect(readConditionState(datesAsText).compareAs.type).toBe(
      ConditionValueType.Text,
    );
    // Picking another number comparison compares numbers again.
    expect(
      choose(datesAsText, ConditionComparisonId.LessThan).args[
        IDS.valueToCheckType
      ],
    ).toBe("number");
  });

  test("is true sets true or false and Compare with; leaving it puts text back", () => {
    const isTrue: JSONObject = choose(
      PRODUCTION_CHECK,
      ConditionComparisonId.IsTrue,
    ).args;

    expect(isTrue).toEqual({
      ...PRODUCTION_CHECK,
      "input-1-type": "boolean",
      "input-2-type": "boolean",
      "input-2": "true",
    });

    const isFalse: JSONObject = choose(
      isTrue,
      ConditionComparisonId.IsFalse,
    ).args;
    expect(isFalse[IDS.compareWith]).toBe("false");
    expect(readConditionState(isFalse).comparison?.id).toBe(
      ConditionComparisonId.IsFalse,
    );

    const back: { args: JSONObject; change: ComparisonChange } = choose(
      isTrue,
      ConditionComparisonId.EqualTo,
      "production",
    );
    expect(back.args).toEqual({
      ...PRODUCTION_CHECK,
      "input-1-type": "text",
      "input-2-type": "text",
    });
  });

  test("is empty hides Compare with, and keeps what it held to put back", () => {
    const toEmpty: { args: JSONObject; change: ComparisonChange } = choose(
      PRODUCTION_CHECK,
      ConditionComparisonId.IsEmpty,
    );

    expect(toEmpty.args[IDS.comparison]).toBe("is empty");
    expect(toEmpty.args[IDS.compareWith]).toBe("");
    expect(toEmpty.change.hiddenCompareWith).toBe("production");
    // The types are left as they were: is empty does not use them.
    expect(toEmpty.args[IDS.valueToCheckType]).toBe("text");

    // is not empty next: still remembered.
    const toNotEmpty: { args: JSONObject; change: ComparisonChange } = choose(
      toEmpty.args,
      ConditionComparisonId.IsNotEmpty,
      toEmpty.change.hiddenCompareWith,
    );
    expect(toNotEmpty.change.hiddenCompareWith).toBe("production");

    const back: { args: JSONObject; change: ComparisonChange } = choose(
      toNotEmpty.args,
      ConditionComparisonId.NotEqualTo,
      toNotEmpty.change.hiddenCompareWith,
    );
    expect(back.args[IDS.compareWith]).toBe("production");
    expect(back.args[IDS.comparison]).toBe("!=");
  });

  test("is true, then is empty, then is equal to compares text again", () => {
    const isTrue: JSONObject = choose({}, ConditionComparisonId.IsTrue).args;
    const isEmpty: JSONObject = choose(
      isTrue,
      ConditionComparisonId.IsEmpty,
    ).args;

    expect(isEmpty).toEqual(
      expect.objectContaining({
        operator: "is empty",
        "input-2": "",
        "input-1-type": "text",
        "input-2-type": "text",
      }),
    );

    const isEqual: JSONObject = choose(
      isEmpty,
      ConditionComparisonId.EqualTo,
    ).args;

    expect(readConditionState(isEqual).compareAs.type).toBe(
      ConditionValueType.Text,
    );
    // The true is not put back: it was is true's, not something typed.
    expect(isEqual[IDS.compareWith]).toBe("");
  });

  test("nothing to put back leaves Compare with empty", () => {
    const empty: JSONObject = choose(
      { ...PRODUCTION_CHECK, "input-2": "" },
      ConditionComparisonId.IsEmpty,
    ).args;

    expect(choose(empty, ConditionComparisonId.EqualTo).args).toEqual(
      expect.objectContaining({ "input-2": "", operator: "==" }),
    );
  });

  test("a workflow compared as Null keeps its types until Compare as is chosen", () => {
    const legacy: JSONObject = { ...PRODUCTION_CHECK, "input-2-type": "null" };

    expect(
      choose(legacy, ConditionComparisonId.GreaterThan).change.patch,
    ).toEqual({ operator: ">" });
    expect(choose(legacy, ConditionComparisonId.Contains).change.patch).toEqual(
      { operator: "contains" },
    );
    expect(
      readConditionState(
        apply(legacy, patchForCompareAs(ConditionValueType.Text)),
      ).compareAs.type,
    ).toBe(ConditionValueType.Text);
  });

  test("Compare as writes the same type for both values", () => {
    for (const option of CONDITION_COMPARE_AS_OPTIONS) {
      expect(patchForCompareAs(option.type)).toEqual({
        "input-1-type": option.type,
        "input-2-type": option.type,
      });
    }
  });

  test("a new step is given is equal to; a step with a comparison is left alone", () => {
    expect(patchForDefaults({})).toEqual({ operator: "==" });
    expect(patchForDefaults(undefined)).toEqual({ operator: "==" });
    expect(patchForDefaults({ operator: "" })).toEqual({ operator: "==" });
    expect(patchForDefaults(PRODUCTION_CHECK)).toBeNull();
    expect(patchForDefaults({ operator: "~=" })).toBeNull();
  });

  test.each(
    CONDITION_COMPARISONS.map(
      (comparison: ConditionComparison): [string, ConditionComparisonId] => {
        return [comparison.label, comparison.id];
      },
    ),
  )(
    "choosing %s reads back as itself, on a new step and on a set-up one",
    (_label: string, id: ConditionComparisonId) => {
      for (const start of [{}, PRODUCTION_CHECK, STATUS_CHECK, PROCEED_CHECK]) {
        const { args } = choose(start as JSONObject, id);
        expect(readConditionState(args).comparison?.id).toBe(id);
      }
    },
  );
});

describe("what a choice writes runs the way it reads", () => {
  type RunFunction = (args: JSONObject, valueToCheck: JSONValue) => boolean;

  const run: RunFunction = (
    args: JSONObject,
    valueToCheck: JSONValue,
  ): boolean => {
    return evaluateCondition({
      valueToCheck: valueToCheck,
      operator: args[IDS.comparison],
      compareWith: args[IDS.compareWith],
      valueToCheckType: args[IDS.valueToCheckType],
      compareWithType: args[IDS.compareWithType],
    });
  };

  test("is greater than, chosen on a step comparing text, compares numbers", () => {
    const args: JSONObject = choose(
      { ...PRODUCTION_CHECK, "input-2": "9" },
      ConditionComparisonId.GreaterThan,
    ).args;

    expect(run(args, "10")).toBe(true);
    expect(run(args, "8")).toBe(false);
  });

  test("is true and is false", () => {
    const isTrue: JSONObject = choose({}, ConditionComparisonId.IsTrue).args;
    const isFalse: JSONObject = choose({}, ConditionComparisonId.IsFalse).args;

    expect(run(isTrue, true)).toBe(true);
    expect(run(isTrue, "true")).toBe(true);
    expect(run(isTrue, "yes")).toBe(false);
    expect(run(isFalse, false)).toBe(true);
    expect(run(isFalse, "anything else")).toBe(true);
    expect(run(isFalse, true)).toBe(false);
  });

  test("is empty and is not empty", () => {
    const isEmpty: JSONObject = choose(
      PRODUCTION_CHECK,
      ConditionComparisonId.IsEmpty,
    ).args;
    const isNotEmpty: JSONObject = choose(
      PRODUCTION_CHECK,
      ConditionComparisonId.IsNotEmpty,
    ).args;

    expect(run(isEmpty, "")).toBe(true);
    expect(run(isEmpty, ENVIRONMENT)).toBe(true);
    expect(run(isEmpty, "staging")).toBe(false);
    expect(run(isNotEmpty, "staging")).toBe(true);
  });

  test("contains, chosen on a step comparing numbers, compares text", () => {
    const args: JSONObject = choose(
      { ...STATUS_CHECK, "input-2": "Sev 1" },
      ConditionComparisonId.Contains,
    ).args;

    expect(run(args, "Sev 1: database down")).toBe(true);
  });
});

describe("what must be filled in", () => {
  test("a new step needs the value to check and what to compare with", () => {
    expect(validateCondition(readConditionState({}))).toEqual({
      valueToCheck: "Pick or type the value to check.",
      compareWith: "Type or pick what to compare with.",
    });
  });

  test("a set-up step needs nothing", () => {
    for (const args of [PRODUCTION_CHECK, PROCEED_CHECK, STATUS_CHECK]) {
      expect(
        hasConditionErrors(validateCondition(readConditionState(args))),
      ).toBe(false);
    }
  });

  test("is empty, is true and the like need no Compare with", () => {
    for (const id of [
      ConditionComparisonId.IsEmpty,
      ConditionComparisonId.IsNotEmpty,
      ConditionComparisonId.IsTrue,
      ConditionComparisonId.IsFalse,
    ]) {
      const args: JSONObject = choose({ "input-1": ENVIRONMENT }, id).args;

      expect(validateCondition(readConditionState(args))).toEqual({});
    }
  });

  test("a comparison the step does not know must be chosen again", () => {
    expect(
      validateCondition(
        readConditionState({ ...PRODUCTION_CHECK, operator: "~=" }),
      ),
    ).toEqual({ comparison: "Choose a comparison." });
  });

  test("a comparison taken from a reference is left to the run", () => {
    expect(
      validateCondition(
        readConditionState({
          ...PRODUCTION_CHECK,
          operator: "{{local.variables.OPERATOR}}",
        }),
      ),
    ).toEqual({});
  });

  test("0 and false are values; blank text is not", () => {
    expect(isBlankConditionValue(0)).toBe(false);
    expect(isBlankConditionValue(false)).toBe(false);
    expect(isBlankConditionValue("0")).toBe(false);
    expect(isBlankConditionValue("   ")).toBe(true);
    expect(isBlankConditionValue("")).toBe(true);
    expect(isBlankConditionValue(null)).toBe(true);
    expect(isBlankConditionValue(undefined)).toBe(true);
  });
});

describe("when Compare as is offered", () => {
  test.each([
    [ConditionComparisonId.EqualTo, PRODUCTION_CHECK, true],
    [ConditionComparisonId.GreaterThan, PRODUCTION_CHECK, true],
    [ConditionComparisonId.Contains, PRODUCTION_CHECK, false],
    [ConditionComparisonId.IsEmpty, PRODUCTION_CHECK, false],
    [ConditionComparisonId.IsTrue, PRODUCTION_CHECK, false],
  ])(
    "%s: %s",
    (id: ConditionComparisonId, start: JSONObject, offered: boolean): void => {
      expect(showsCompareAs(readConditionState(choose(start, id).args))).toBe(
        offered,
      );
    },
  );

  test("a text comparison a workflow compares as numbers shows it, to be seen and changed", () => {
    expect(
      showsCompareAs(
        readConditionState({ ...STATUS_CHECK, operator: "contains" }),
      ),
    ).toBe(true);
  });

  test("so does a comparison taken from a reference", () => {
    expect(
      showsCompareAs(
        readConditionState({
          ...PRODUCTION_CHECK,
          operator: "{{local.variables.OPERATOR}}",
        }),
      ),
    ).toBe(true);
  });
});

describe("what the settings point out", () => {
  type NotesFunction = (args: JSONObject) => Array<ConditionNote>;

  const notes: NotesFunction = (args: JSONObject): Array<ConditionNote> => {
    return getConditionNotes(readConditionState(args));
  };

  test("nothing, for a condition that compares as it reads", () => {
    expect(notes(PRODUCTION_CHECK)).toEqual([]);
    expect(notes(PROCEED_CHECK)).toEqual([]);
    expect(notes(STATUS_CHECK)).toEqual([]);
    expect(notes({ "input-1": ENVIRONMENT, operator: "is empty" })).toEqual([]);
  });

  test("a value compared as Null, and what to do instead", () => {
    const [note] = notes({ ...PRODUCTION_CHECK, "input-2-type": "null" });

    expect(note?.tone).toBe(ConditionNoteTone.Warning);
    expect(note?.text).toBe(
      "Compare with is compared as null, which ignores what it holds. This step no longer offers that: choose how to compare under Compare as, or choose is empty to check for a missing value.",
    );

    expect(
      notes({
        ...PRODUCTION_CHECK,
        "input-1-type": "undefined",
        "input-2-type": "undefined",
      })[0]?.text,
    ).toMatch(
      /^Value to check and Compare with are compared as undefined, which ignores what they hold\./,
    );
  });

  test("typed text that is not a number, compared as one", () => {
    expect(notes({ ...STATUS_CHECK, "input-2": "abc" })).toEqual([
      {
        id: "not-a-number-Compare with",
        tone: ConditionNoteTone.Warning,
        text: '"abc" is not a number, so it is compared as 0.',
      },
    ]);
    // A reference is not known until the step runs.
    expect(notes({ ...STATUS_CHECK, "input-2": STATUS })).toEqual([]);
  });

  test("typed text that is not true or false, compared as true or false", () => {
    expect(
      notes({ ...PROCEED_CHECK, operator: "!=", "input-2": "yes" }).map(
        (note: ConditionNote) => {
          return note.text;
        },
      ),
    ).toEqual(['Only true counts as true, so "yes" is compared as false.']);
  });

  test("a number comparison of text, which suits dates", () => {
    expect(
      notes(
        apply(
          choose(PRODUCTION_CHECK, ConditionComparisonId.GreaterThan).args,
          patchForCompareAs(ConditionValueType.Text),
        ),
      ).map((note: ConditionNote) => {
        return [note.tone, note.text];
      }),
    ).toEqual([
      [
        ConditionNoteTone.Info,
        'Compared as text, letter by letter: "10" comes before "9". That suits dates written 2026-10-01. For numbers, choose Number under Compare as.',
      ],
    ]);
  });

  test("a long value is shortened", () => {
    const [note] = notes({ ...STATUS_CHECK, "input-2": "x".repeat(80) });

    expect(note?.text).toBe(
      `"${"x".repeat(39)}…" is not a number, so it is compared as 0.`,
    );
  });
});

describe("the condition in words", () => {
  test("text in quotes, references as their chips", () => {
    expect(met(PRODUCTION_CHECK)).toBe(
      "when [webhook-1 › request-body › environment] is equal to “production”.",
    );
  });

  test("numbers as themselves, and how they are compared", () => {
    expect(met(STATUS_CHECK)).toBe(
      "when [api-get-1 › response-status] is greater than or equal to 400, compared as numbers.",
    );
  });

  test("is true, is empty", () => {
    expect(met(PROCEED_CHECK)).toBe(
      "when [javascript-1 › returnValue › proceed] is true.",
    );
    expect(met({ "input-1": ENVIRONMENT, operator: "is empty" })).toBe(
      "when [webhook-1 › request-body › environment] is empty.",
    );
  });

  test("what is not set yet reads as what it is for", () => {
    const parts: Array<ConditionPhrasePart> = describeConditionMet(
      readConditionState({}),
    );

    expect(phraseText(parts)).toBe(
      "when the value to check is equal to the value to compare with.",
    );
    expect(
      parts.filter((part: ConditionPhrasePart) => {
        return part.kind === ConditionPhrasePartKind.Missing;
      }),
    ).toHaveLength(2);
  });

  test("text with a value in it is quoted, the value a chip", () => {
    expect(
      met({
        "input-1":
          "Alert: {{local.components.webhook-1.returnValues.request-body.title}}",
        operator: "contains",
        "input-2": "Sev 1",
      }),
    ).toBe(
      "when “Alert: [webhook-1 › request-body › title]” contains “Sev 1”.",
    );
  });

  test("text compared as text by a number comparison says so", () => {
    expect(
      met(
        apply(
          choose(PRODUCTION_CHECK, ConditionComparisonId.LessThan).args,
          patchForCompareAs(ConditionValueType.Text),
        ),
      ),
    ).toBe(
      "when [webhook-1 › request-body › environment] is less than “production”, compared as text.",
    );
  });

  test("true or false, and a value typed that is not a number, read as typed", () => {
    expect(met({ ...PROCEED_CHECK, operator: "!=" })).toBe(
      "when [javascript-1 › returnValue › proceed] is not equal to true, compared as true or false.",
    );
    expect(met({ ...STATUS_CHECK, "input-2": "abc" })).toBe(
      "when [api-get-1 › response-status] is greater than or equal to “abc”, compared as numbers.",
    );
  });

  test("a value compared as Null says how", () => {
    expect(met({ ...PRODUCTION_CHECK, "input-2-type": "null" })).toBe(
      "when [webhook-1 › request-body › environment] is equal to “production”, compared as text and null.",
    );
  });

  test("an unknown comparison, and one from a reference", () => {
    expect(met({ ...PRODUCTION_CHECK, operator: "~=" })).toBe(
      "when [webhook-1 › request-body › environment] … (choose a comparison).",
    );
    expect(
      met({ ...PRODUCTION_CHECK, operator: "{{local.variables.OPERATOR}}" }),
    ).toBe(
      "when [webhook-1 › request-body › environment] compared by [Variable › OPERATOR] with “production”.",
    );
  });

  test("Compare as can be left out", () => {
    expect(
      phraseText(
        describeConditionMet(readConditionState(STATUS_CHECK), {
          withCompareAs: false,
        }),
      ),
    ).toBe(
      "when [api-get-1 › response-status] is greater than or equal to 400.",
    );
  });
});

describe("the condition in one line, for the canvas", () => {
  test("references by the last thing they name", () => {
    expect(
      summarizeCondition({ args: PRODUCTION_CHECK, describeReference: byIds }),
    ).toBe("environment is equal to “production”");
    expect(
      summarizeCondition({ args: STATUS_CHECK, describeReference: byIds }),
    ).toBe("response-status is greater than or equal to 400");
    expect(
      summarizeCondition({ args: PROCEED_CHECK, describeReference: byIds }),
    ).toBe("proceed is true");
    expect(
      summarizeCondition({
        args: {
          "input-1": "{{local.variables.DEPLOY_ENV}}",
          operator: "!=",
          "input-2": "prod",
        },
        describeReference: byIds,
      }),
    ).toBe("DEPLOY_ENV is not equal to “prod”");
  });

  test("nothing until there is a value to check and a known comparison", () => {
    expect(summarizeCondition({ args: {}, describeReference: byIds })).toBe(
      null,
    );
    expect(
      summarizeCondition({
        args: { ...PRODUCTION_CHECK, operator: "~=" },
        describeReference: byIds,
      }),
    ).toBe(null);
  });

  test("a missing Compare with reads as …", () => {
    expect(
      summarizeCondition({
        args: { "input-1": ENVIRONMENT, operator: "==" },
        describeReference: byIds,
      }),
    ).toBe("environment is equal to …");
  });

  test("a deep path is named by its last field", () => {
    expect(
      shortReferenceLabel(
        "{{local.components.webhook-1.returnValues.request-body.items[0].name}}",
        byIds,
      ),
    ).toBe("name");
    expect(shortReferenceLabel("not a reference", byIds)).toBe(
      "not a reference",
    );
  });
});
