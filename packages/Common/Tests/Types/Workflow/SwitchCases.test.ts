/*
 * The cases of a Switch / Case step (Types/Workflow/Components/SwitchCases):
 * how a stored list is read back, the id each case's output gets, what each
 * output is called, the outputs a step has, which case a value takes, and
 * the sentence that says why.
 *
 * The maintainer asked for "case component in addition to just if/else": one
 * value, many cases, the first match wins, Default otherwise. What matters
 * most is that a case matches exactly when If / Else would - the sweep below
 * holds every comparison, every way of comparing and a spread of values to
 * If / Else's own evaluateCondition.
 */

import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import { Port } from "../../../Types/Workflow/Component";
import {
  ConditionOperator,
  ConditionValueType,
} from "../../../Types/Workflow/Components/Condition";
import {
  CONDITION_COMPARISONS,
  ConditionComparison,
} from "../../../Types/Workflow/Components/ConditionComparison";
import { evaluateCondition } from "../../../Types/Workflow/Components/ConditionEvaluation";
import {
  SWITCH_DEFAULT_PORT,
  SWITCH_DEFAULT_PORT_ID,
} from "../../../Types/Workflow/Components/Switch";
import {
  SWITCH_CASE_LABEL_MAX_LENGTH,
  SwitchCase,
  SwitchCasesReading,
  SwitchEvaluation,
  createSwitchCase,
  describeSwitchCaseCheck,
  describeSwitchCaseCondition,
  describeSwitchEvaluation,
  evaluateSwitch,
  findShadowedSwitchCases,
  findSwitchCaseWithUnknownComparison,
  getNextSwitchCaseId,
  getStarterSwitchCases,
  getSwitchCaseComparison,
  getSwitchCaseLabel,
  getSwitchCasePort,
  getSwitchOutPorts,
  getUnknownSwitchComparisonMessage,
  isSwitchCaseSetUp,
  nameTemplateValue,
  parseSwitchCases,
  readSwitchCases,
  shortReferenceName,
  toStoredSwitchCases,
} from "../../../Types/Workflow/Components/SwitchCases";
import { describe, expect, test } from "@jest/globals";

type CaseFunction = (
  id: string,
  comparison: string,
  value?: string,
  compareAs?: string,
) => SwitchCase;

const aCase: CaseFunction = (
  id: string,
  comparison: string,
  value: string = "",
  compareAs: string = ConditionValueType.Text,
): SwitchCase => {
  return { id: id, comparison: comparison, value: value, compareAs: compareAs };
};

const SEVERITY: string =
  "{{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}";

const IS_TRUE: SwitchCase = aCase(
  "case-1",
  ConditionOperator.EqualTo,
  "true",
  ConditionValueType.Boolean,
);

describe("reading the stored cases", () => {
  test("nothing stored is no cases, and reads fine", () => {
    for (const raw of [undefined, null, "", "   ", []]) {
      expect(parseSwitchCases(raw)).toEqual({ cases: [], isReadable: true });
    }
  });

  test("a list, as the settings save it, reads back as it was", () => {
    const stored: JSONValue = [
      {
        id: "case-1",
        comparison: "==",
        value: "Critical Incident",
        compareAs: "text",
      },
      { id: "case-7", comparison: "is empty", value: "", compareAs: "text" },
    ];

    expect(readSwitchCases(stored)).toEqual([
      aCase("case-1", "==", "Critical Incident", "text"),
      aCase("case-7", "is empty", "", "text"),
    ]);
  });

  test("the JSON text of a list, as a hand-written workflow may hold it, is read too", () => {
    expect(
      readSwitchCases(
        JSON.stringify([
          { id: "case-1", comparison: "contains", value: "timeout" },
        ]),
      ),
    ).toEqual([aCase("case-1", "contains", "timeout", "")]);
  });

  test("something that is not a list cannot be read, and says so", () => {
    for (const raw of [
      { id: "case-1" },
      "not json",
      '{"id":"case-1"}',
      42,
      true,
    ]) {
      const reading: SwitchCasesReading = parseSwitchCases(raw);

      expect({ raw, reading }).toEqual({
        raw,
        reading: { cases: [], isReadable: false },
      });
    }
  });

  test("anything in the list that is not a case is skipped", () => {
    expect(
      readSwitchCases([
        "case-1",
        null,
        12,
        ["case-2"],
        { id: "case-3", comparison: "==", value: "x" },
      ]),
    ).toEqual([aCase("case-3", "==", "x", "")]);
  });

  test("values that are not text are read as If / Else reads them: as their text", () => {
    expect(
      readSwitchCases([
        { id: "case-1", comparison: "==", value: 500, compareAs: "number" },
        { id: "case-2", comparison: "==", value: true, compareAs: "boolean" },
        { id: "case-3", comparison: "==", value: { a: 1 } },
        { id: "case-4", comparison: null, value: null, compareAs: null },
      ]),
    ).toEqual([
      aCase("case-1", "==", "500", "number"),
      aCase("case-2", "==", "true", "boolean"),
      aCase("case-3", "==", '{"a":1}', ""),
      aCase("case-4", "", "", ""),
    ]);
  });

  test("a case keeps its id, so a connection to its output follows it", () => {
    expect(
      readSwitchCases([
        { id: "case-9", comparison: "==", value: "a" },
        { id: "my_case-2", comparison: "==", value: "b" },
        { id: "A", comparison: "==", value: "c" },
      ]).map((switchCase: SwitchCase): string => {
        return switchCase.id;
      }),
    ).toEqual(["case-9", "my_case-2", "A"]);
  });

  test("a case without a usable id gets the first free case-N, in list order", () => {
    expect(
      readSwitchCases([
        { comparison: "==", value: "no id" },
        { id: "case-1", comparison: "==", value: "keeps case-1" },
        { id: "case-1", comparison: "==", value: "a second case-1" },
        { id: "default", comparison: "==", value: "Default's id" },
        { id: "in", comparison: "==", value: "the input's id" },
        { id: "has space", comparison: "==", value: "a space" },
        { id: "{{local.variables.x}}", comparison: "==", value: "a reference" },
        { id: "", comparison: "==", value: "empty" },
        { id: 3, comparison: "==", value: "a number" },
        { id: "x".repeat(65), comparison: "==", value: "too long" },
      ]).map((switchCase: SwitchCase): string => {
        return `${switchCase.id}=${switchCase.value}`;
      }),
    ).toEqual([
      "case-2=no id",
      "case-1=keeps case-1",
      "case-3=a second case-1",
      "case-4=Default's id",
      "case-5=the input's id",
      "case-6=a space",
      "case-7=a reference",
      "case-8=empty",
      "case-9=a number",
      "case-10=too long",
    ]);
  });

  test("ids come out the same every time the same list is read, so the canvas and the runner agree", () => {
    const stored: JSONValue = [
      { comparison: "==", value: "a" },
      { id: "case-2", comparison: "==", value: "b" },
      { comparison: "==", value: "c" },
    ];

    expect(readSwitchCases(stored)).toEqual(readSwitchCases(stored));
    expect(
      readSwitchCases(stored).map((switchCase: SwitchCase): string => {
        return switchCase.id;
      }),
    ).toEqual(["case-1", "case-2", "case-3"]);
  });

  test("what is saved reads back the same", () => {
    const cases: Array<SwitchCase> = [
      aCase("case-1", "==", "Critical Incident", "text"),
      aCase("case-4", ">", "500", "number"),
      { ...IS_TRUE, id: "case-2" },
    ];

    expect(readSwitchCases(toStoredSwitchCases(cases))).toEqual(cases);
    expect(
      readSwitchCases(JSON.parse(JSON.stringify(toStoredSwitchCases(cases)))),
    ).toEqual(cases);
  });

  test("what is saved holds exactly a case's four fields", () => {
    expect(
      toStoredSwitchCases([
        {
          ...aCase("case-1", "==", "x"),
          extra: "dropped",
        } as unknown as SwitchCase,
      ]),
    ).toEqual([
      { id: "case-1", comparison: "==", value: "x", compareAs: "text" },
    ]);
  });
});

describe("a new case's id", () => {
  test("is one past the highest case-N", () => {
    expect(getNextSwitchCaseId([])).toBe("case-1");
    expect(
      getNextSwitchCaseId([aCase("case-1", "=="), aCase("case-4", "==")]),
    ).toBe("case-5");
  });

  test("ignores ids that are not case-N", () => {
    expect(
      getNextSwitchCaseId([
        aCase("A", "=="),
        aCase("case-x", "=="),
        aCase("case-2.5", "=="),
        aCase("case-2", "=="),
      ]),
    ).toBe("case-3");
  });

  test("never reuses an id the step had while its settings were open", () => {
    // case-3 was just removed: its connection is on the canvas until Save.
    expect(
      getNextSwitchCaseId(
        [aCase("case-1", "=="), aCase("case-2", "==")],
        ["case-1", "case-2", "case-3"],
      ),
    ).toBe("case-4");
  });

  test("a new case is is equal to, as text, with nothing to compare with yet", () => {
    expect(createSwitchCase("case-3")).toEqual({
      id: "case-3",
      comparison: ConditionOperator.EqualTo,
      value: "",
      compareAs: ConditionValueType.Text,
    });
  });

  test("a new step starts with two such cases", () => {
    expect(getStarterSwitchCases()).toEqual([
      createSwitchCase("case-1"),
      createSwitchCase("case-2"),
    ]);
  });
});

describe("what a case asks", () => {
  test("each stored comparison reads as If / Else reads it", () => {
    for (const comparison of CONDITION_COMPARISONS) {
      const switchCase: SwitchCase = aCase(
        "case-1",
        comparison.operator,
        comparison.fixedCompareWith || "x",
        comparison.fixedCompareWith ? ConditionValueType.Boolean : "text",
      );

      expect({
        id: comparison.id,
        read: getSwitchCaseComparison(switchCase)?.id,
      }).toEqual({ id: comparison.id, read: comparison.id });
    }
  });

  test("a comparison the step does not know reads as none", () => {
    expect(getSwitchCaseComparison(aCase("case-1", "~="))).toBeNull();
  });

  test("a missing comparison is is equal to, as If / Else has always run it", () => {
    expect(getSwitchCaseComparison(aCase("case-1", ""))?.label).toBe(
      "is equal to",
    );
  });

  test("is set up once it says what to compare with, where the comparison needs it", () => {
    expect(isSwitchCaseSetUp(aCase("case-1", "==", ""))).toBe(false);
    expect(isSwitchCaseSetUp(aCase("case-1", "==", "   "))).toBe(false);
    expect(isSwitchCaseSetUp(aCase("case-1", "==", "x"))).toBe(true);
    expect(isSwitchCaseSetUp(aCase("case-1", "is empty", ""))).toBe(true);
    expect(isSwitchCaseSetUp(IS_TRUE)).toBe(true);
    expect(isSwitchCaseSetUp(aCase("case-1", "~=", "x"))).toBe(false);
  });

  test("its condition in words, values quoted as a sentence quotes them", () => {
    expect(
      describeSwitchCaseCondition(aCase("case-1", "==", "Critical Incident")),
    ).toBe("is equal to “Critical Incident”");
    expect(
      describeSwitchCaseCondition(aCase("case-1", ">", "500", "number")),
    ).toBe("is greater than 500");
    expect(
      describeSwitchCaseCondition(aCase("case-1", ">", "five", "number")),
    ).toBe("is greater than “five”");
    expect(describeSwitchCaseCondition(IS_TRUE)).toBe("is true");
    expect(
      describeSwitchCaseCondition(aCase("case-1", "is not empty", "")),
    ).toBe("is not empty");
    expect(
      describeSwitchCaseCondition(
        aCase("case-1", "==", "{{local.variables.criticalName}}"),
      ),
    ).toBe("is equal to criticalName");
    expect(describeSwitchCaseCondition(aCase("case-1", "==", ""))).toBeNull();
    expect(describeSwitchCaseCondition(aCase("case-1", "~=", "x"))).toBeNull();
  });
});

describe("a reference, in a word or two", () => {
  test.each([
    ["local.variables.criticalName", "criticalName"],
    ["global.variables.ON_CALL", "ON_CALL"],
    [
      "local.components.incident-on-create-1.returnValues.model.incidentSeverity.name",
      "incidentSeverity.name",
    ],
    [
      "local.components.webhook-1.returnValues.request-body.environment",
      "environment",
    ],
    [
      "local.components.api-get-1.returnValues.response-status",
      "response-status",
    ],
    [
      "local.components.find-1.returnValues.models[0].title",
      "models[0].title",
    ],
    ["local.components.x.returnValues.model._id", "model._id"],
    // Not a whole reference: left as written.
    ["local.components.x.returnValues", "local.components.x.returnValues"],
    ["something.else", "something.else"],
  ])("%s is %s", (inner: string, name: string) => {
    expect(shortReferenceName(inner)).toBe(name);
  });

  test("a value names each reference in it and keeps the rest as typed", () => {
    expect(nameTemplateValue("{{local.variables.prefix}}-critical")).toBe(
      "prefix-critical",
    );
    expect(nameTemplateValue("plain text")).toBe("plain text");
    expect(nameTemplateValue("{{#each x}}{{this}}{{/each}}")).toBe(
      "{{#each x}}{{this}}{{/each}}",
    );
  });
});

describe("what a case's output is called", () => {
  test("is equal to is named by its value alone", () => {
    expect(
      getSwitchCaseLabel(aCase("case-1", "==", "Critical Incident"), 0),
    ).toBe("Critical Incident");
    expect(getSwitchCaseLabel(aCase("case-1", "==", "  production "), 0)).toBe(
      "production",
    );
    // The strict operators a hand-written workflow may hold read the same.
    expect(getSwitchCaseLabel(aCase("case-1", "===", "production"), 0)).toBe(
      "production",
    );
  });

  test("any other comparison is named by the comparison and the value", () => {
    expect(getSwitchCaseLabel(aCase("case-1", "contains", "timeout"), 0)).toBe(
      "contains timeout",
    );
    expect(getSwitchCaseLabel(aCase("case-1", ">", "500", "number"), 0)).toBe(
      "is greater than 500",
    );
    expect(getSwitchCaseLabel(aCase("case-1", "!=", "production"), 0)).toBe(
      "is not equal to production",
    );
  });

  test("a comparison that needs no value is named by the comparison", () => {
    expect(getSwitchCaseLabel(aCase("case-1", "is empty"), 0)).toBe(
      "is empty",
    );
    expect(getSwitchCaseLabel(aCase("case-1", "is not empty"), 0)).toBe(
      "is not empty",
    );
    expect(getSwitchCaseLabel(IS_TRUE, 0)).toBe("is true");
    expect(
      getSwitchCaseLabel(
        aCase("case-1", "==", "false", ConditionValueType.Boolean),
        0,
      ),
    ).toBe("is false");
  });

  test("a case that does not say yet is named by its place", () => {
    expect(getSwitchCaseLabel(aCase("case-1", "=="), 0)).toBe("Case 1");
    expect(getSwitchCaseLabel(aCase("case-9", "==", "  "), 2)).toBe("Case 3");
    expect(getSwitchCaseLabel(aCase("case-2", "~=", "x"), 1)).toBe("Case 2");
  });

  test("a reference is named by what it reads, never by a resolved value", () => {
    expect(
      getSwitchCaseLabel(
        aCase("case-1", "==", "{{global.variables.CRITICAL_SEVERITY}}"),
        0,
      ),
    ).toBe("CRITICAL_SEVERITY");
  });

  test("a long name is cut, at a whole character", () => {
    const label: string = getSwitchCaseLabel(
      aCase("case-1", "==", `${"x".repeat(38)}🚨🚨🚨`),
      0,
    );

    expect(Array.from(label)).toHaveLength(SWITCH_CASE_LABEL_MAX_LENGTH);
    expect(label.endsWith("…")).toBe(true);
    expect(label).toContain("🚨");
    // No half of an emoji.
    expect(label).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});

describe("the step's outputs", () => {
  test("one per case, in the order the cases are checked, then Default", () => {
    const ports: Array<Port> = getSwitchOutPorts({
      value: SEVERITY,
      cases: toStoredSwitchCases([
        aCase("case-2", "==", "Critical Incident"),
        aCase("case-1", "==", "Major Incident"),
      ]),
    });

    expect(
      ports.map((port: Port): string => {
        return `${port.id}:${port.title}`;
      }),
    ).toEqual([
      "case-2:Critical Incident",
      "case-1:Major Incident",
      `${SWITCH_DEFAULT_PORT_ID}:Default`,
    ]);
    expect(ports[ports.length - 1]).toEqual(SWITCH_DEFAULT_PORT);
  });

  test("each says when it runs: the first case alone, a later one only when none above matched", () => {
    const ports: Array<Port> = getSwitchOutPorts({
      cases: toStoredSwitchCases([
        aCase("case-1", "<", "300", "number"),
        aCase("case-2", "<", "500", "number"),
        aCase("case-3", "=="),
      ]),
    });

    expect(ports[0]?.description).toBe(
      "Runs next when the value is less than 300.",
    );
    expect(ports[1]?.description).toBe(
      "Runs next when the value is less than 500 and no case above it matches.",
    );
    expect(ports[2]?.description).toBe(
      "Runs next when this case matches. It is not set up yet.",
    );
    expect(ports[3]?.description).toBe("Runs next when no case matches.");
  });

  test("a step with no cases, or none that can be read, still has Default", () => {
    for (const args of [
      undefined,
      null,
      {},
      { cases: [] },
      { cases: "nonsense" },
    ]) {
      expect(getSwitchOutPorts(args as JSONObject | undefined)).toEqual([
        SWITCH_DEFAULT_PORT,
      ]);
    }
  });

  test("a case's output is its id, its name and when it runs", () => {
    expect(getSwitchCasePort(aCase("case-5", "contains", "timeout"), 1)).toEqual(
      {
        id: "case-5",
        title: "contains timeout",
        description:
          "Runs next when the value contains “timeout” and no case above it matches.",
      },
    );
  });
});

const SWEEP_VALUES: Array<string> = [
  "",
  " ",
  "production",
  "Production",
  "prod",
  "200",
  "200.0",
  "10",
  "9",
  "-1",
  "0",
  "true",
  "false",
  "[]",
  "{}",
  '{"a":1}',
  "{{local.components.webhook-1.returnValues.request-body.missing}}",
];

const SWEEP_TYPES: Array<string> = [
  "",
  ConditionValueType.Text,
  ConditionValueType.Number,
  ConditionValueType.Boolean,
];

describe("which case a value takes", () => {
  test("a case matches exactly when If / Else would say Yes: every comparison, every way of comparing, every value", () => {
    let checked: number = 0;
    const disagreements: Array<string> = [];

    for (const comparison of CONDITION_COMPARISONS as Array<ConditionComparison>) {
      for (const compareAs of SWEEP_TYPES) {
        for (const value of SWEEP_VALUES) {
          const compareWith: string =
            comparison.fixedCompareWith || (comparison.usesCompareWith ? value : "");

          for (const valueToCheck of SWEEP_VALUES) {
            const ifElse: boolean = evaluateCondition({
              valueToCheck: valueToCheck,
              operator: comparison.operator,
              compareWith: compareWith,
              valueToCheckType: compareAs,
              compareWithType: compareAs,
            });

            const evaluation: SwitchEvaluation = evaluateSwitch({
              valueToCheck: valueToCheck,
              cases: [
                aCase("case-1", comparison.operator, compareWith, compareAs),
              ],
            });

            checked++;

            if ((evaluation.matched !== null) !== ifElse) {
              disagreements.push(
                `${valueToCheck} ${comparison.operator} ${compareWith} as ${compareAs || "(unset)"}`,
              );
            }
          }
        }
      }
    }

    expect(checked).toBeGreaterThan(10000);
    expect(disagreements).toEqual([]);
  });

  test("values that are not text are compared as If / Else compares them", () => {
    const values: Array<JSONValue | undefined> = [
      undefined,
      null,
      0,
      500,
      true,
      false,
      [],
      { a: 1 },
    ];

    for (const valueToCheck of values) {
      for (const switchCase of [
        aCase("case-1", "==", "500", "number"),
        aCase("case-1", "is empty"),
        IS_TRUE,
        aCase("case-1", "contains", "a"),
      ]) {
        expect({
          valueToCheck,
          switchCase,
          matched:
            evaluateSwitch({ valueToCheck, cases: [switchCase] }).matched !==
            null,
        }).toEqual({
          valueToCheck,
          switchCase,
          matched: evaluateCondition({
            valueToCheck: valueToCheck,
            operator: switchCase.comparison,
            compareWith: switchCase.value,
            valueToCheckType: switchCase.compareAs,
            compareWithType: switchCase.compareAs,
          }),
        });
      }
    }
  });

  test("the first case that matches wins, and nothing after it is checked", () => {
    const evaluation: SwitchEvaluation = evaluateSwitch({
      valueToCheck: "Critical Incident",
      cases: [
        aCase("case-1", "==", "Major Incident"),
        aCase("case-2", "contains", "Critical"),
        aCase("case-3", "==", "Critical Incident"),
        aCase("case-4", "is not empty"),
      ],
    });

    expect(evaluation.matched?.index).toBe(1);
    expect(evaluation.matched?.switchCase.id).toBe("case-2");
    expect(
      evaluation.checks.map(
        (check: { index: number; isMatch: boolean }): string => {
          return `${check.index}:${check.isMatch}`;
        },
      ),
    ).toEqual(["0:false", "1:true"]);
  });

  test("no fallthrough: a match never also takes the cases below it", () => {
    const evaluation: SwitchEvaluation = evaluateSwitch({
      valueToCheck: "x",
      cases: [aCase("case-1", "==", "x"), aCase("case-2", "==", "x")],
    });

    expect(evaluation.matched?.switchCase.id).toBe("case-1");
    expect(evaluation.checks).toHaveLength(1);
  });

  test("the order of the cases decides: a narrower case must come before a wider one", () => {
    const ranges: Array<SwitchCase> = [
      aCase("case-1", "<", "300", "number"),
      aCase("case-2", "<", "500", "number"),
    ];

    const take: (status: number) => string | null = (
      status: number,
    ): string | null => {
      return (
        evaluateSwitch({ valueToCheck: status, cases: ranges }).matched
          ?.switchCase.id || null
      );
    };

    expect(take(200)).toBe("case-1");
    expect(take(404)).toBe("case-2");
    expect(take(503)).toBeNull();

    // The wider case first: the narrower one is never reached.
    expect(
      evaluateSwitch({
        valueToCheck: 200,
        cases: [ranges[1] as SwitchCase, ranges[0] as SwitchCase],
      }).matched?.switchCase.id,
    ).toBe("case-2");
  });

  test("when no case matches, Default is taken after every case was checked", () => {
    const evaluation: SwitchEvaluation = evaluateSwitch({
      valueToCheck: "Minor Incident",
      cases: [
        aCase("case-1", "==", "Critical Incident"),
        aCase("case-2", "==", "Major Incident"),
      ],
    });

    expect(evaluation.matched).toBeNull();
    expect(evaluation.checks).toHaveLength(2);
  });

  test("with no cases at all, Default is taken", () => {
    expect(evaluateSwitch({ valueToCheck: "x", cases: [] })).toEqual({
      matched: null,
      checks: [],
    });
  });

  test("capital letters count, as text, as in If / Else", () => {
    expect(
      evaluateSwitch({
        valueToCheck: "critical incident",
        cases: [aCase("case-1", "==", "Critical Incident")],
      }).matched,
    ).toBeNull();
  });

  test("a case whose comparison the step does not know stops the step, whichever case would have matched", () => {
    const cases: Array<SwitchCase> = [
      aCase("case-1", "==", "x"),
      aCase("case-2", "~=", "y"),
    ];

    expect(() => {
      evaluateSwitch({ valueToCheck: "x", cases: cases });
    }).toThrow(BadDataException);

    expect(() => {
      evaluateSwitch({ valueToCheck: "x", cases: cases });
    }).toThrow(
      'Switch / Case cannot compare case 2 with "~=". Open the step and choose a comparison for it, such as is equal to.',
    );

    expect(findSwitchCaseWithUnknownComparison(cases)).toEqual({
      index: 1,
      switchCase: cases[1],
    });
    expect(
      findSwitchCaseWithUnknownComparison([aCase("case-1", "contains", "x")]),
    ).toBeNull();
  });

  test("the message about an unknown comparison quotes at most a sentence of it", () => {
    const message: string = getUnknownSwitchComparisonMessage({
      index: 0,
      switchCase: aCase("case-1", "x".repeat(500)),
    });

    expect(message.length).toBeLessThan(200);
    expect(message).toContain("…");
  });
});

describe("why the step went the way it did", () => {
  const CASES: Array<SwitchCase> = [
    aCase("case-1", "==", "Critical Incident"),
    aCase("case-2", "==", "Major Incident"),
    aCase("case-3", ">=", "500", "number"),
    aCase("case-4", "is empty"),
    aCase("case-5", "contains", "x"),
  ];

  type ReasonForFunction = (index: number | null) => string;

  const reasonFor: ReasonForFunction = (index: number | null): string => {
    return describeSwitchEvaluation({
      evaluation: {
        matched:
          index === null
            ? null
            : { index: index, switchCase: CASES[index] as SwitchCase },
        checks: [],
      },
      configuredCases: CASES,
    });
  };

  test("the first case: which one, and what it asked", () => {
    expect(reasonFor(0)).toBe(
      "Case 1 matched: the value is equal to “Critical Incident”.",
    );
  });

  test("a later case: and that the ones above it did not", () => {
    expect(reasonFor(1)).toBe(
      "Case 2 matched: the value is equal to “Major Incident”. Case 1 did not.",
    );
    expect(reasonFor(2)).toBe(
      "Case 3 matched: the value is greater than or equal to 500. Cases 1 and 2 did not.",
    );
    expect(reasonFor(3)).toBe(
      "Case 4 matched: the value is empty. Cases 1 to 3 did not.",
    );
    expect(reasonFor(4)).toBe(
      "Case 5 matched: the value contains “x”. Cases 1 to 4 did not.",
    );
  });

  test("Default: none of the cases matched", () => {
    expect(reasonFor(null)).toBe(
      "None of the 5 cases matched, so the step took Default.",
    );
    expect(
      describeSwitchEvaluation({
        evaluation: { matched: null, checks: [] },
        configuredCases: [CASES[0] as SwitchCase],
      }),
    ).toBe("The one case did not match, so the step took Default.");
    expect(
      describeSwitchEvaluation({
        evaluation: { matched: null, checks: [] },
        configuredCases: [],
      }),
    ).toBe("This step has no cases, so it took Default.");
  });

  test("names a case as configured, never by the value a run resolved it to", () => {
    const configured: Array<SwitchCase> = [
      aCase("case-1", "==", "{{global.variables.DEPLOY_TOKEN}}"),
    ];
    const resolved: Array<SwitchCase> = [
      aCase("case-1", "==", "s3cr3t-t0ken-value"),
    ];

    const evaluation: SwitchEvaluation = evaluateSwitch({
      valueToCheck: "s3cr3t-t0ken-value",
      cases: resolved,
    });

    const reason: string = describeSwitchEvaluation({
      evaluation: evaluation,
      configuredCases: configured,
    });

    expect(reason).toBe("Case 1 matched: the value is equal to DEPLOY_TOKEN.");
    expect(reason).not.toContain("s3cr3t");

    const line: string = describeSwitchCaseCheck({
      check: evaluation.checks[0]!,
      configuredCases: configured,
    });

    expect(line).toBe("Case 1 (DEPLOY_TOKEN): matched.");
    expect(line).not.toContain("s3cr3t");
  });

  test("one line of the run's log per case checked", () => {
    const evaluation: SwitchEvaluation = evaluateSwitch({
      valueToCheck: "Major Incident",
      cases: CASES,
    });

    expect(
      evaluation.checks.map(
        (check: SwitchEvaluation["checks"][number]): string => {
          return describeSwitchCaseCheck({
            check: check,
            configuredCases: CASES,
          });
        },
      ),
    ).toEqual([
      "Case 1 (Critical Incident): no match.",
      "Case 2 (Major Incident): matched.",
    ]);
  });
});

describe("cases that can never be taken", () => {
  test("a case that asks the same as one above it is never taken", () => {
    expect(
      findShadowedSwitchCases([
        aCase("case-1", "==", "Critical Incident"),
        aCase("case-2", "==", "Major Incident"),
        aCase("case-3", "==", "Critical Incident"),
      ]),
    ).toEqual([{ index: 2, sameAsIndex: 0 }]);
  });

  test("the same value compared another way is a different case", () => {
    expect(
      findShadowedSwitchCases([
        aCase("case-1", "==", "200", "text"),
        aCase("case-2", "==", "200", "number"),
        aCase("case-3", "contains", "200", "text"),
        aCase("case-4", "==", "201", "text"),
      ]),
    ).toEqual([]);
  });

  test("a second is empty is never taken, whatever its value says", () => {
    expect(
      findShadowedSwitchCases([
        aCase("case-1", "is empty", "", "text"),
        aCase("case-2", "is empty", "left over", "number"),
      ]),
    ).toEqual([{ index: 1, sameAsIndex: 0 }]);
  });

  test("a missing compare-as and text are the same way of comparing", () => {
    expect(
      findShadowedSwitchCases([
        aCase("case-1", "==", "x", ""),
        aCase("case-2", "==", "x", "text"),
      ]),
    ).toEqual([{ index: 1, sameAsIndex: 0 }]);
  });

  test("cases that are not set up yet are not counted: two new cases are not a mistake", () => {
    expect(findShadowedSwitchCases(getStarterSwitchCases())).toEqual([]);
    expect(
      findShadowedSwitchCases([aCase("case-1", "~=", "x"), aCase("case-2", "~=", "x")]),
    ).toEqual([]);
  });

  test("is told once, against the first case it repeats", () => {
    expect(
      findShadowedSwitchCases([
        aCase("case-1", "==", "x"),
        aCase("case-2", "==", "x"),
        aCase("case-3", "==", "x"),
      ]),
    ).toEqual([
      { index: 1, sameAsIndex: 0 },
      { index: 2, sameAsIndex: 0 },
    ]);
  });
});

describe("the stored shape the settings save", () => {
  test("is plain JSON a graph can hold", () => {
    const stored: JSONValue = toStoredSwitchCases(getStarterSwitchCases());

    expect(JSON.parse(JSON.stringify(stored))).toEqual(stored);
    expect(Array.isArray(stored)).toBe(true);
    expect((stored as Array<JSONObject>)[0]).toEqual({
      id: "case-1",
      comparison: "==",
      value: "",
      compareAs: "text",
    });
  });
});
