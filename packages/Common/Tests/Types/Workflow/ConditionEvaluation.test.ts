/*
 * How an If / Else step decides between Yes and No.
 *
 * The step used to write its settings into a line of JavaScript and run it
 * in the script sandbox. It now compares in TypeScript (ConditionEvaluation),
 * and every workflow that already runs must take the same branch it took
 * before. So the first part of this file keeps the old code path as it was -
 * format each value for its type, build `const input1 = ...; const input2 =
 * ...; return input1 <op> input2;`, run it - and holds the new evaluator to
 * it for every operator, every pair of stored types (missing and misspelt
 * ones included) and a wide set of values: text, numbers written every way,
 * true and false, null, quotes, backslashes, objects.
 *
 * The rest pins the rules in readable cases, the new "is empty" and "is not
 * empty", and what fails a run.
 */

import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONValue } from "../../../Types/JSON";
import {
  CONDITION_ARGUMENT_IDS,
  ConditionOperator,
  ConditionValueType,
} from "../../../Types/Workflow/Components/Condition";
import {
  ConditionInputs,
  evaluateCondition,
  getConditionValueType,
  getEffectiveConditionTypes,
  isEmptyConditionValue,
  normalizeConditionOperatorText,
  resolveConditionOperator,
  toConditionValue,
} from "../../../Types/Workflow/Components/ConditionEvaluation";
import { describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * The old code path, verbatim in what it did (IfElse.ts before this change).
 * ---------------------------------------------------------------------------
 */

const LEGACY_TYPE_PRIORITY: Record<string, number> = {
  boolean: 2,
  number: 1,
  text: 0,
};

type LegacyFormatFunction = (value: unknown, valueType: unknown) => string;

const legacyFormatValue: LegacyFormatFunction = (
  value: unknown,
  valueType: unknown,
): string => {
  const strValue: string =
    typeof value === "object" ? JSON.stringify(value) : String(value ?? "");

  switch (valueType) {
    case "boolean":
      return strValue === "true" ? "true" : "false";
    case "number":
      return isNaN(Number(strValue)) ? "0" : String(Number(strValue));
    case "null":
      return "null";
    case "undefined":
      return "undefined";
    case "text":
    default:
      return JSON.stringify(strValue);
  }
};

type LegacyEvaluateFunction = (args: Record<string, unknown>) => boolean;

const legacyEvaluate: LegacyEvaluateFunction = (
  args: Record<string, unknown>,
): boolean => {
  let input1Type: unknown = args["input-1-type"] || "text";
  let input2Type: unknown = args["input-2-type"] || "text";

  if (input1Type !== input2Type) {
    const isNullish: (t: unknown) => boolean = (t: unknown): boolean => {
      return t === "null" || t === "undefined";
    };

    if (!isNullish(input1Type) && !isNullish(input2Type)) {
      const p1: number = LEGACY_TYPE_PRIORITY[input1Type as string] ?? 0;
      const p2: number = LEGACY_TYPE_PRIORITY[input2Type as string] ?? 0;
      const commonType: unknown = p1 >= p2 ? input1Type : input2Type;
      input1Type = commonType;
      input2Type = commonType;
    }
  }

  const input1: string = legacyFormatValue(args["input-1"], input1Type);
  const input2: string = legacyFormatValue(args["input-2"], input2Type);

  let code: string = `const input1 = ${input1 || ""};\nconst input2 = ${input2 || ""};\n`;

  if (args["operator"] === "contains") {
    code += "return String(input1).includes(String(input2));";
  } else if (args["operator"] === "does not contain") {
    code += "return !String(input1).includes(String(input2));";
  } else if (args["operator"] === "starts with") {
    code += "return String(input1).startsWith(String(input2));";
  } else if (args["operator"] === "ends with") {
    code += "return String(input1).endsWith(String(input2));";
  } else {
    code += `return input1 ${(args["operator"] as string) || "=="} input2;`;
  }

  // What the sandbox did with the code: run it, and go Yes on a truthy result.
  // eslint-disable-next-line no-new-func
  return Boolean(new Function(code)());
};

/*
 * ---------------------------------------------------------------------------
 * The matrix.
 * ---------------------------------------------------------------------------
 */

const LEGACY_OPERATORS: Array<unknown> = [
  ConditionOperator.EqualTo,
  ConditionOperator.NotEqualTo,
  ConditionOperator.GreaterThan,
  ConditionOperator.GreaterThanOrEqualTo,
  ConditionOperator.LessThan,
  ConditionOperator.LessThanOrEqualTo,
  ConditionOperator.Contains,
  ConditionOperator.DoesNotContain,
  ConditionOperator.StartsWith,
  ConditionOperator.EndsWith,
  // Never offered, but valid JavaScript the old code ran.
  "===",
  "!==",
  // Nothing stored: the old code compared with ==.
  undefined,
  "",
];

// Every stored type, and what a hand-written workflow might hold instead.
const STORED_TYPES: Array<unknown> = [
  undefined,
  "text",
  "number",
  "boolean",
  "null",
  "undefined",
  "Number",
  "",
];

/*
 * Values as a step receives them once references are filled in: text, but
 * also a whole-field reference's own number, boolean or null, and JSON.
 */
const VALUES: Array<JSONValue | undefined> = [
  undefined,
  null,
  "",
  " ",
  "0",
  "-0",
  "1",
  "10",
  "9",
  " 12 ",
  "1e3",
  "0x10",
  "Infinity",
  "abc",
  "ABC",
  "true",
  "false",
  "null",
  "2026-10-01",
  "2026-09-30",
  'said "ready"',
  "C:\\temp\\file",
  "line one\nline two",
  0,
  10,
  -5,
  3.5,
  true,
  false,
  { a: 1 },
  [],
];

// The same small set on both sides keeps the matrix quick; it still crosses every kind.
const OTHER_SIDE: Array<JSONValue | undefined> = [
  undefined,
  null,
  "",
  "0",
  "9",
  "10",
  "abc",
  "true",
  "null",
  "2026-09-30",
  'said "ready"',
  10,
  true,
  false,
];

type DescribeFunction = (value: unknown) => string;

const describeValue: DescribeFunction = (value: unknown): string => {
  return value === undefined ? "undefined" : JSON.stringify(value);
};

describe("every workflow that already runs takes the branch it took before", () => {
  test.each(
    LEGACY_OPERATORS.map((operator: unknown) => {
      return [describeValue(operator), operator];
    }),
  )(
    "operator %s, every pair of types and values",
    (_label: string, operator: unknown) => {
      const mismatches: Array<string> = [];
      let compared: number = 0;
      let wentYes: number = 0;

      for (const type1 of STORED_TYPES) {
        for (const type2 of STORED_TYPES) {
          for (const value1 of VALUES) {
            for (const value2 of OTHER_SIDE) {
              const args: Record<string, unknown> = {
                "input-1": value1,
                "input-2": value2,
                operator: operator,
                "input-1-type": type1,
                "input-2-type": type2,
              };

              const expected: boolean = legacyEvaluate(args);
              const actual: boolean = evaluateCondition({
                valueToCheck: value1,
                compareWith: value2,
                operator: operator as JSONValue,
                valueToCheckType: type1 as JSONValue,
                compareWithType: type2 as JSONValue,
              });

              compared++;

              if (expected) {
                wentYes++;
              }

              if (actual !== expected && mismatches.length < 20) {
                mismatches.push(
                  `${describeValue(value1)} (${describeValue(type1)}) ${describeValue(operator)} ${describeValue(value2)} (${describeValue(type2)}): was ${expected}, now ${actual}`,
                );
              }
            }
          }
        }
      }

      expect(compared).toBe(
        STORED_TYPES.length ** 2 * VALUES.length * OTHER_SIDE.length,
      );
      // Both branches are taken often, so agreeing is not a matter of luck.
      expect(wentYes).toBeGreaterThan(compared / 50);
      expect(compared - wentYes).toBeGreaterThan(compared / 50);
      expect(mismatches).toEqual([]);
    },
  );

  test("values swapped, so both sides see every value", () => {
    const mismatches: Array<string> = [];

    for (const operator of LEGACY_OPERATORS) {
      for (const type of STORED_TYPES) {
        for (const value1 of OTHER_SIDE) {
          for (const value2 of VALUES) {
            const args: Record<string, unknown> = {
              "input-1": value1,
              "input-2": value2,
              operator: operator,
              "input-1-type": type,
              "input-2-type": type,
            };

            const actual: boolean = evaluateCondition({
              valueToCheck: value1,
              compareWith: value2,
              operator: operator as JSONValue,
              valueToCheckType: type as JSONValue,
              compareWithType: type as JSONValue,
            });

            if (actual !== legacyEvaluate(args) && mismatches.length < 20) {
              mismatches.push(
                `${describeValue(value1)} ${describeValue(operator)} ${describeValue(value2)} as ${describeValue(type)}`,
              );
            }
          }
        }
      }
    }

    expect(mismatches).toEqual([]);
  });
});

describe("how each type compares", () => {
  type CaseRow = [string, ConditionInputs, boolean];

  const textCases: Array<CaseRow> = [
    [
      "text is equal only to the same text, capitals included",
      { valueToCheck: "Error", operator: "==", compareWith: "error" },
      false,
    ],
    [
      "quotes in text are text, not code",
      {
        valueToCheck: 'The service said "ready".',
        operator: "==",
        compareWith: 'The service said "ready".',
      },
      true,
    ],
    [
      "a backslash is a backslash, not an escape",
      {
        valueToCheck: "C:\\temp\\file",
        operator: "contains",
        compareWith: "\t",
      },
      false,
    ],
    [
      "line breaks are kept",
      {
        valueToCheck: "line one\nline two",
        operator: "==",
        compareWith: "line one--newline--line two",
      },
      false,
    ],
    [
      'as text, "10" comes before "9"',
      { valueToCheck: "10", operator: ">", compareWith: "9" },
      false,
    ],
    [
      "as text, dates written 2026-10-01 order correctly",
      {
        valueToCheck: "2026-10-01",
        operator: ">",
        compareWith: "2026-09-30",
      },
      true,
    ],
    [
      "contains",
      {
        valueToCheck: "Sev 1: database down",
        operator: "contains",
        compareWith: "Sev 1",
      },
      true,
    ],
    [
      "does not contain",
      {
        valueToCheck: "all good",
        operator: "does not contain",
        compareWith: "error",
      },
      true,
    ],
    [
      "starts with",
      {
        valueToCheck: "prod-eu-1",
        operator: "starts with",
        compareWith: "prod",
      },
      true,
    ],
    [
      "ends with",
      { valueToCheck: "prod-eu-1", operator: "ends with", compareWith: "-2" },
      false,
    ],
    [
      "a null value reads as the text null",
      { valueToCheck: null, operator: "==", compareWith: "null" },
      true,
    ],
    [
      "nothing reads as empty text",
      { valueToCheck: undefined, operator: "==", compareWith: "" },
      true,
    ],
  ];

  test.each(textCases)(
    "%s",
    (_name: string, inputs: ConditionInputs, met: boolean) => {
      expect(evaluateCondition(inputs)).toBe(met);
    },
  );

  const numberCases: Array<CaseRow> = [
    [
      "as numbers, 10 is greater than 9",
      {
        valueToCheck: "10",
        operator: ">",
        compareWith: "9",
        valueToCheckType: "number",
        compareWithType: "number",
      },
      true,
    ],
    [
      "200 and 200.0 are the same number",
      {
        valueToCheck: 200,
        operator: "==",
        compareWith: "200.0",
        valueToCheckType: "number",
        compareWithType: "number",
      },
      true,
    ],
    [
      "spaces around a number do not matter",
      {
        valueToCheck: " 12 ",
        operator: "==",
        compareWith: "12",
        valueToCheckType: "number",
        compareWithType: "number",
      },
      true,
    ],
    [
      "text that is not a number counts as 0",
      {
        valueToCheck: "abc",
        operator: "==",
        compareWith: "0",
        valueToCheckType: "number",
        compareWithType: "number",
      },
      true,
    ],
    [
      "one side typed as a number makes both numbers",
      {
        valueToCheck: "10",
        operator: ">",
        compareWith: "9",
        valueToCheckType: "text",
        compareWithType: "number",
      },
      true,
    ],
    [
      "less than or equal to",
      {
        valueToCheck: "400",
        operator: "<=",
        compareWith: 400,
        valueToCheckType: "number",
        compareWithType: "number",
      },
      true,
    ],
  ];

  test.each(numberCases)(
    "%s",
    (_name: string, inputs: ConditionInputs, met: boolean) => {
      expect(evaluateCondition(inputs)).toBe(met);
    },
  );

  const trueFalseCases: Array<CaseRow> = [
    [
      "true is true",
      {
        valueToCheck: true,
        operator: "==",
        compareWith: true,
        valueToCheckType: "boolean",
        compareWithType: "boolean",
      },
      true,
    ],
    [
      'the text "true" is true',
      {
        valueToCheck: "true",
        operator: "==",
        compareWith: "true",
        valueToCheckType: "boolean",
        compareWithType: "boolean",
      },
      true,
    ],
    [
      '"True", "yes" and 1 are not',
      {
        valueToCheck: "True",
        operator: "==",
        compareWith: true,
        valueToCheckType: "boolean",
        compareWithType: "boolean",
      },
      false,
    ],
    [
      "a missing value is false",
      {
        valueToCheck: undefined,
        operator: "==",
        compareWith: "false",
        valueToCheckType: "boolean",
        compareWithType: "boolean",
      },
      true,
    ],
    [
      "true or false wins over a number",
      {
        valueToCheck: "true",
        operator: "==",
        compareWith: "1",
        valueToCheckType: "boolean",
        compareWithType: "number",
      },
      false,
    ],
  ];

  test.each(trueFalseCases)(
    "%s",
    (_name: string, inputs: ConditionInputs, met: boolean) => {
      expect(evaluateCondition(inputs)).toBe(met);
    },
  );

  test("a value compared as Null or Undefined ignores what it holds, as it always did", () => {
    // What the old settings offered for "is it missing", and never did.
    expect(
      evaluateCondition({
        valueToCheck: "",
        operator: "==",
        compareWith: "null",
        compareWithType: "null",
      }),
    ).toBe(false);
    expect(
      evaluateCondition({
        valueToCheck: "anything",
        operator: "!=",
        compareWith: "x",
        compareWithType: "undefined",
      }),
    ).toBe(true);
    expect(
      evaluateCondition({
        valueToCheck: "anything",
        operator: "==",
        compareWith: "x",
        valueToCheckType: "null",
        compareWithType: "undefined",
      }),
    ).toBe(true);
  });
});

describe("the types a step can store", () => {
  test("missing and unknown types are text, exactly spelt ones are themselves", () => {
    expect(getConditionValueType(undefined)).toBe(ConditionValueType.Text);
    expect(getConditionValueType("")).toBe(ConditionValueType.Text);
    expect(getConditionValueType("Number")).toBe(ConditionValueType.Text);
    expect(getConditionValueType(true)).toBe(ConditionValueType.Text);

    for (const type of Object.values(ConditionValueType)) {
      expect(getConditionValueType(type)).toBe(type);
    }
  });

  test("two types meet at the more specific one, and null or undefined never moves", () => {
    expect(getEffectiveConditionTypes("text", "number")).toEqual({
      valueToCheck: ConditionValueType.Number,
      compareWith: ConditionValueType.Number,
    });
    expect(getEffectiveConditionTypes("number", "boolean")).toEqual({
      valueToCheck: ConditionValueType.Boolean,
      compareWith: ConditionValueType.Boolean,
    });
    expect(getEffectiveConditionTypes(undefined, "boolean")).toEqual({
      valueToCheck: ConditionValueType.Boolean,
      compareWith: ConditionValueType.Boolean,
    });
    expect(getEffectiveConditionTypes("number", "null")).toEqual({
      valueToCheck: ConditionValueType.Number,
      compareWith: ConditionValueType.Null,
    });
  });

  test("a value under each type", () => {
    expect(toConditionValue(" 12 ", ConditionValueType.Number)).toBe(12);
    expect(toConditionValue("abc", ConditionValueType.Number)).toBe(0);
    expect(toConditionValue("-0", ConditionValueType.Number)).toBe(0);
    expect(toConditionValue("true", ConditionValueType.Boolean)).toBe(true);
    expect(toConditionValue("yes", ConditionValueType.Boolean)).toBe(false);
    expect(toConditionValue({ a: 1 }, ConditionValueType.Text)).toBe('{"a":1}');
    expect(toConditionValue(null, ConditionValueType.Text)).toBe("null");
    expect(toConditionValue(undefined, ConditionValueType.Text)).toBe("");
    expect(toConditionValue("x", ConditionValueType.Null)).toBeNull();
    expect(toConditionValue("x", ConditionValueType.Undefined)).toBeUndefined();
  });
});

describe("comparisons the step knows", () => {
  test("nothing stored is is equal to, as it always was", () => {
    for (const nothing of [undefined, null, "", "   ", 0, false]) {
      expect(resolveConditionOperator(nothing)).toBe(ConditionOperator.EqualTo);
    }
  });

  test("a comparison in words is matched whatever its capitals and spaces", () => {
    expect(normalizeConditionOperatorText("  Starts   With ")).toBe(
      "starts with",
    );
    expect(resolveConditionOperator("Contains")).toBe(
      ConditionOperator.Contains,
    );
    expect(resolveConditionOperator(" IS NOT EMPTY ")).toBe(
      ConditionOperator.IsNotEmpty,
    );
    expect(
      evaluateCondition({
        valueToCheck: "Sev 1 outage",
        operator: "Contains",
        compareWith: "Sev 1",
      }),
    ).toBe(true);
  });

  test("=== and !== still run, strictly", () => {
    expect(
      evaluateCondition({
        valueToCheck: "a",
        operator: "===",
        compareWith: "a",
      }),
    ).toBe(true);
    // Loosely null is undefined; strictly it is not.
    const nullAndUndefined: ConditionInputs = {
      valueToCheck: "x",
      compareWith: "y",
      valueToCheckType: "null",
      compareWithType: "undefined",
      operator: "===",
    };
    expect(evaluateCondition(nullAndUndefined)).toBe(false);
    expect(evaluateCondition({ ...nullAndUndefined, operator: "!==" })).toBe(
      true,
    );
    expect(evaluateCondition({ ...nullAndUndefined, operator: "==" })).toBe(
      true,
    );
  });

  test.each([
    ["a word it does not know", "is roughly"],
    ["code", "== input2; while (true) {} //"],
    ["an operator that is not a comparison", "&&"],
    ["a reference that found nothing", "{{local.variables.OPERATOR}}"],
    ["a number", 5],
  ])(
    "%s fails the run with a sentence that says so",
    (_name: string, operator: unknown) => {
      expect(() => {
        return evaluateCondition({
          valueToCheck: "a",
          operator: operator as JSONValue,
          compareWith: "a",
        });
      }).toThrow(BadDataException);

      expect(() => {
        return evaluateCondition({
          valueToCheck: "a",
          operator: operator as JSONValue,
          compareWith: "a",
        });
      }).toThrow(`If / Else cannot compare with "${String(operator)}"`);
    },
  );
});

describe("is empty and is not empty", () => {
  const EMPTY: Array<[string, JSONValue | undefined]> = [
    ["nothing at all", undefined],
    ["null, from a field sent as null", null],
    ["blank text", ""],
    ["only spaces", "   \n "],
    ["an empty list, as a reference hands it over", "[]"],
    ["an empty object, as a reference hands it over", "{}"],
    ["an empty object written over lines", "{\n}"],
    [
      "a reference that found nothing",
      "{{local.components.webhook-1.returnValues.request-body.environment}}",
    ],
    ["a variable that does not exist", "{{global.variables.MISSING}}"],
    ["an empty list", []],
    ["an empty object", {}],
  ];

  const NOT_EMPTY: Array<[string, JSONValue | undefined]> = [
    ["text", "production"],
    ["0", 0],
    ["the text 0", "0"],
    ["false", false],
    ["the text false", "false"],
    ["the text null", "null"],
    ["a list with something in it", "[1]"],
    ["an object with something in it", '{"a":1}'],
    ["text that looks like JSON but is not", "{not json"],
    ["a reference with text around it", "env: {{local.variables.ENV}}"],
    ["braces that are not a reference", "{{name}}"],
    ["a list", [1]],
    ["an object", { a: 1 }],
  ];

  test.each(EMPTY)(
    "%s is empty",
    (_name: string, value: JSONValue | undefined) => {
      expect(isEmptyConditionValue(value)).toBe(true);
      expect(
        evaluateCondition({ valueToCheck: value, operator: "is empty" }),
      ).toBe(true);
      expect(
        evaluateCondition({ valueToCheck: value, operator: "is not empty" }),
      ).toBe(false);
    },
  );

  test.each(NOT_EMPTY)(
    "%s is not empty",
    (_name: string, value: JSONValue | undefined) => {
      expect(isEmptyConditionValue(value)).toBe(false);
      expect(
        evaluateCondition({ valueToCheck: value, operator: "is empty" }),
      ).toBe(false);
      expect(
        evaluateCondition({ valueToCheck: value, operator: "is not empty" }),
      ).toBe(true);
    },
  );

  test("they look at the value to check only, whatever else is stored", () => {
    for (const type of [undefined, "number", "boolean", "null", "undefined"]) {
      expect(
        evaluateCondition({
          valueToCheck: "",
          operator: ConditionOperator.IsEmpty,
          compareWith: "something",
          valueToCheckType: type,
          compareWithType: type,
        }),
      ).toBe(true);
    }
  });

  test("the stored names are the ones the settings write", () => {
    expect(ConditionOperator.IsEmpty).toBe("is empty");
    expect(ConditionOperator.IsNotEmpty).toBe("is not empty");
    expect(CONDITION_ARGUMENT_IDS).toEqual({
      valueToCheck: "input-1",
      comparison: "operator",
      compareWith: "input-2",
      valueToCheckType: "input-1-type",
      compareWithType: "input-2-type",
    });
  });
});
