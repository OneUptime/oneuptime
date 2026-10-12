/*
 * The Switch / Case settings, as data (Workflow/Switch/SwitchModel): reading
 * the stored settings, what each edit writes back, what a case still needs,
 * what is worth knowing about it, which removed cases took a connection
 * with them, and the step's one line on the canvas.
 *
 * Each case is an If / Else condition without its value to check, so these
 * also hold that choosing a comparison for a case does exactly what choosing
 * it in If / Else does: a number comparison compares numbers, is true
 * compares true or false, is empty hides the value and keeps it to put back.
 */

import {
  ADD_CASE_LABEL,
  CASES_LABEL,
  CaseComparisonChange,
  OutputConnections,
  RemovedConnectedCase,
  SwitchErrors,
  SwitchState,
  addCase,
  caseShowsCompareAs,
  changeCaseCompareAs,
  changeCaseComparison,
  changeCaseValue,
  getCaseCompareAs,
  getCaseErrors,
  getCaseNotes,
  getRemovedConnectedCases,
  hasSwitchErrors,
  moveCase,
  patchForCases,
  putCaseBack,
  readSwitchState,
  removeCase,
  summarizeSwitch,
  validateSwitch,
} from "../../../../../UI/Components/Workflow/Switch/SwitchModel";
import {
  ConditionNote,
  ConditionNoteTone,
  patchForComparison,
  readConditionState,
} from "../../../../../UI/Components/Workflow/Condition/ConditionModel";
import { JSONObject } from "../../../../../Types/JSON";
import {
  CONDITION_ARGUMENT_IDS,
  ConditionOperator,
  ConditionValueType,
} from "../../../../../Types/Workflow/Components/Condition";
import {
  CONDITION_COMPARISONS,
  ConditionComparison,
  ConditionComparisonId,
} from "../../../../../Types/Workflow/Components/ConditionComparison";
import {
  SwitchCase,
  createSwitchCase,
  getStarterSwitchCases,
  readSwitchCases,
} from "../../../../../Types/Workflow/Components/SwitchCases";
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

describe("reading the settings", () => {
  test("the value to check and the cases, as stored", () => {
    const state: SwitchState = readSwitchState({
      value: SEVERITY,
      cases: [{ id: "case-1", comparison: "==", value: "Critical Incident" }],
    });

    expect(state).toEqual({
      valueToCheck: SEVERITY,
      cases: [aCase("case-1", "==", "Critical Incident", "")],
      isReadable: true,
    });
  });

  test("a new step: nothing to check yet, and no cases until it was given its starters", () => {
    expect(readSwitchState(undefined)).toEqual({
      valueToCheck: undefined,
      cases: [],
      isReadable: true,
    });
  });

  test("cases that are not a list are said to be unreadable", () => {
    expect(readSwitchState({ cases: { id: "x" } }).isReadable).toBe(false);
  });

  test("an edit writes the whole list, as it is saved", () => {
    expect(patchForCases([aCase("case-1", "==", "x")])).toEqual({
      cases: [
        { id: "case-1", comparison: "==", value: "x", compareAs: "text" },
      ],
    });
  });
});

describe("adding, removing, moving and putting back cases", () => {
  test("a new case goes at the end, is equal to, as text, with a fresh id", () => {
    const cases: Array<SwitchCase> = addCase(getStarterSwitchCases(), [
      "case-1",
      "case-2",
    ]);

    expect(cases).toHaveLength(3);
    expect(cases[2]).toEqual(createSwitchCase("case-3"));
  });

  test("never takes the id of a case removed while the settings are open", () => {
    // case-3 was removed: its connection is still on the canvas until Save.
    expect(
      addCase(getStarterSwitchCases(), ["case-1", "case-2", "case-3"])[2]?.id,
    ).toBe("case-4");
  });

  test("removing takes out that case alone", () => {
    expect(
      removeCase(
        [aCase("case-1", "=="), aCase("case-2", "=="), aCase("case-3", "==")],
        "case-2",
      ).map((switchCase: SwitchCase): string => {
        return switchCase.id;
      }),
    ).toEqual(["case-1", "case-3"]);
  });

  test("the last case can be removed too, leaving none", () => {
    expect(removeCase([aCase("case-1", "==")], "case-1")).toEqual([]);
  });

  test("moving a case keeps every case, in the new order, ids and all", () => {
    const cases: Array<SwitchCase> = [
      aCase("case-1", "==", "a"),
      aCase("case-2", "==", "b"),
      aCase("case-3", "==", "c"),
    ];

    expect(
      moveCase(cases, 2, 0).map((switchCase: SwitchCase): string => {
        return `${switchCase.id}:${switchCase.value}`;
      }),
    ).toEqual(["case-3:c", "case-1:a", "case-2:b"]);
    expect(
      moveCase(cases, 0, 2).map((switchCase: SwitchCase): string => {
        return switchCase.id;
      }),
    ).toEqual(["case-2", "case-3", "case-1"]);
  });

  test("a move to the same place, or out of range, changes nothing", () => {
    const cases: Array<SwitchCase> = [
      aCase("case-1", "=="),
      aCase("case-2", "=="),
    ];

    expect(moveCase(cases, 1, 1)).toBe(cases);
    expect(moveCase(cases, -1, 0)).toBe(cases);
    expect(moveCase(cases, 0, 5)).toBe(cases);
  });

  test("a case put back goes where it was, or at the end of a shorter list", () => {
    const removed: SwitchCase = aCase("case-2", "==", "b");
    const remaining: Array<SwitchCase> = [
      aCase("case-1", "==", "a"),
      aCase("case-3", "==", "c"),
    ];

    expect(
      putCaseBack(remaining, removed, 1).map((switchCase: SwitchCase) => {
        return switchCase.id;
      }),
    ).toEqual(["case-1", "case-2", "case-3"]);

    expect(
      putCaseBack([], removed, 4).map((switchCase: SwitchCase) => {
        return switchCase.id;
      }),
    ).toEqual(["case-2"]);
  });

  test("a case already in the list is not put back twice", () => {
    const cases: Array<SwitchCase> = [aCase("case-1", "==")];

    expect(putCaseBack(cases, aCase("case-1", "=="), 0)).toBe(cases);
  });
});

describe("choosing a case's comparison does what it does in If / Else", () => {
  test("for every comparison, from every comparison: the same comparison, value and Compare as", () => {
    let checked: number = 0;

    for (const from of CONDITION_COMPARISONS as Array<ConditionComparison>) {
      for (const to of CONDITION_COMPARISONS as Array<ConditionComparison>) {
        const before: SwitchCase = aCase(
          "case-1",
          from.operator,
          from.fixedCompareWith || "42",
          from.fixedCompareWith
            ? ConditionValueType.Boolean
            : ConditionValueType.Text,
        );

        const asSwitch: CaseComparisonChange = changeCaseComparison({
          cases: [before],
          id: "case-1",
          next: to.id,
          valueToCheck: SEVERITY,
        });

        const ifElseArgs: JSONObject = {
          [CONDITION_ARGUMENT_IDS.valueToCheck]: SEVERITY,
          [CONDITION_ARGUMENT_IDS.comparison]: before.comparison,
          [CONDITION_ARGUMENT_IDS.compareWith]: before.value,
          [CONDITION_ARGUMENT_IDS.valueToCheckType]: before.compareAs,
          [CONDITION_ARGUMENT_IDS.compareWithType]: before.compareAs,
        };

        const asIfElse: JSONObject = {
          ...ifElseArgs,
          ...patchForComparison({
            state: readConditionState(ifElseArgs),
            next: to.id,
          }).patch,
        };

        expect({
          from: from.id,
          to: to.id,
          after: asSwitch.cases[0],
        }).toEqual({
          from: from.id,
          to: to.id,
          after: {
            id: "case-1",
            comparison: String(asIfElse[CONDITION_ARGUMENT_IDS.comparison]),
            value: String(asIfElse[CONDITION_ARGUMENT_IDS.compareWith]),
            compareAs: String(
              asIfElse[CONDITION_ARGUMENT_IDS.valueToCheckType],
            ),
          },
        });

        checked++;
      }
    }

    expect(checked).toBe(CONDITION_COMPARISONS.length ** 2);
  });

  test("a number comparison compares numbers", () => {
    const change: CaseComparisonChange = changeCaseComparison({
      cases: [aCase("case-1", "==", "500")],
      id: "case-1",
      next: ConditionComparisonId.GreaterThan,
      valueToCheck: SEVERITY,
    });

    expect(change.cases[0]).toEqual(
      aCase("case-1", ConditionOperator.GreaterThan, "500", "number"),
    );
  });

  test("is true sets the value and compares true or false", () => {
    expect(
      changeCaseComparison({
        cases: [aCase("case-1", "==", "x")],
        id: "case-1",
        next: ConditionComparisonId.IsTrue,
        valueToCheck: SEVERITY,
      }).cases[0],
    ).toEqual(aCase("case-1", "==", "true", "boolean"));
  });

  test("is empty hides the value, and keeps it to put back when a comparison that uses one is chosen again", () => {
    const hidden: CaseComparisonChange = changeCaseComparison({
      cases: [aCase("case-1", "==", "production")],
      id: "case-1",
      next: ConditionComparisonId.IsEmpty,
      valueToCheck: SEVERITY,
    });

    expect(hidden.cases[0]?.value).toBe("");
    expect(hidden.hiddenValue).toBe("production");

    const shown: CaseComparisonChange = changeCaseComparison({
      cases: hidden.cases,
      id: "case-1",
      next: ConditionComparisonId.Contains,
      valueToCheck: SEVERITY,
      hiddenValue: hidden.hiddenValue,
    });

    expect(shown.cases[0]).toEqual(
      aCase("case-1", ConditionOperator.Contains, "production", "text"),
    );
  });

  test("only the case chosen for changes", () => {
    const cases: Array<SwitchCase> = [
      aCase("case-1", "==", "a"),
      aCase("case-2", "==", "b"),
    ];

    const change: CaseComparisonChange = changeCaseComparison({
      cases: cases,
      id: "case-2",
      next: ConditionComparisonId.Contains,
      valueToCheck: SEVERITY,
    });

    expect(change.cases[0]).toBe(cases[0]);
    expect(change.cases[1]?.comparison).toBe(ConditionOperator.Contains);
  });

  test("a case that is not there changes nothing", () => {
    const cases: Array<SwitchCase> = [aCase("case-1", "==")];

    expect(
      changeCaseComparison({
        cases: cases,
        id: "case-9",
        next: ConditionComparisonId.Contains,
        valueToCheck: SEVERITY,
      }).cases,
    ).toBe(cases);
  });

  test("typing a value and choosing how to compare touch that case alone", () => {
    const cases: Array<SwitchCase> = [
      aCase("case-1", "==", "a"),
      aCase("case-2", "==", "b"),
    ];

    expect(changeCaseValue(cases, "case-2", "c")).toEqual([
      cases[0],
      aCase("case-2", "==", "c"),
    ]);
    expect(
      changeCaseCompareAs(cases, "case-1", ConditionValueType.Number),
    ).toEqual([aCase("case-1", "==", "a", "number"), cases[1]]);
  });
});

describe("Compare as, case by case", () => {
  test("decides something for is equal to and the number comparisons, as in If / Else", () => {
    expect(caseShowsCompareAs(SEVERITY, aCase("case-1", "==", "x"))).toBe(true);
    expect(
      caseShowsCompareAs(SEVERITY, aCase("case-1", ">", "5", "number")),
    ).toBe(true);
    expect(caseShowsCompareAs(SEVERITY, aCase("case-1", "is empty"))).toBe(
      false,
    );
    expect(
      caseShowsCompareAs(
        SEVERITY,
        aCase("case-1", "==", "true", ConditionValueType.Boolean),
      ),
    ).toBe(false);
    expect(
      caseShowsCompareAs(SEVERITY, aCase("case-1", "contains", "x", "text")),
    ).toBe(false);
    // A text comparison a workflow compares some other way shows it, to change.
    expect(
      caseShowsCompareAs(SEVERITY, aCase("case-1", "contains", "x", "number")),
    ).toBe(true);
  });

  test("reads one type for both values, or none for a type the settings no longer offer", () => {
    expect(getCaseCompareAs(SEVERITY, aCase("case-1", "==", "x", ""))).toBe(
      ConditionValueType.Text,
    );
    expect(
      getCaseCompareAs(SEVERITY, aCase("case-1", ">", "5", "number")),
    ).toBe(ConditionValueType.Number);
    expect(
      getCaseCompareAs(SEVERITY, aCase("case-1", "==", "x", "null")),
    ).toBeNull();
  });
});

describe("what a case still needs, and what the settings need", () => {
  test("a comparison the step knows", () => {
    expect(getCaseErrors(SEVERITY, aCase("case-1", "~=", "x"))).toEqual({
      comparison: "Choose a comparison.",
    });
  });

  test("a value, when its comparison uses one", () => {
    expect(getCaseErrors(SEVERITY, aCase("case-1", "==", ""))).toEqual({
      value: "Type or pick what to compare with.",
    });
    expect(getCaseErrors(SEVERITY, aCase("case-1", "==", "   "))).toEqual({
      value: "Type or pick what to compare with.",
    });
    expect(getCaseErrors(SEVERITY, aCase("case-1", "is empty"))).toEqual({});
    expect(getCaseErrors(SEVERITY, aCase("case-1", "==", "x"))).toEqual({});
  });

  test("the step needs a value to check, readable cases and every case set up", () => {
    const errors: SwitchErrors = validateSwitch(
      readSwitchState({
        cases: [
          { id: "case-1", comparison: "==", value: "a" },
          { id: "case-2", comparison: "==", value: "" },
        ],
      }),
    );

    expect(errors).toEqual({
      valueToCheck: "Pick or type the value to check.",
      cases: { "case-2": { value: "Type or pick what to compare with." } },
    });
    expect(hasSwitchErrors(errors)).toBe(true);
  });

  test("a step that is set up has nothing to fix", () => {
    const errors: SwitchErrors = validateSwitch(
      readSwitchState({
        value: SEVERITY,
        cases: [{ id: "case-1", comparison: "==", value: "Critical Incident" }],
      }),
    );

    expect(errors).toEqual({ cases: {} });
    expect(hasSwitchErrors(errors)).toBe(false);
  });

  test("a new step, with its two empty starter cases, is not set up yet", () => {
    const errors: SwitchErrors = validateSwitch(
      readSwitchState({ cases: getStarterSwitchCases() as never }),
    );

    expect(Object.keys(errors.cases)).toEqual(["case-1", "case-2"]);
    expect(hasSwitchErrors(errors)).toBe(true);
  });

  test("cases that cannot be read must be added again", () => {
    const errors: SwitchErrors = validateSwitch(
      readSwitchState({ value: "x", cases: "nonsense" }),
    );

    expect(errors.unreadableCases).toBe(
      "The cases saved for this step could not be read. Add the cases again.",
    );
    // Said once: not also as "no cases".
    expect(errors.noCases).toBeUndefined();
    expect(hasSwitchErrors(errors)).toBe(true);
  });

  test("a step with no case at all needs one: every run would take Default", () => {
    for (const cases of [[], undefined]) {
      const errors: SwitchErrors = validateSwitch(
        readSwitchState({ value: "x", cases: cases }),
      );

      expect(errors.noCases).toBe(
        "Add a case for each way the workflow can go.",
      );
      expect(hasSwitchErrors(errors)).toBe(true);
    }
  });
});

describe("what is worth knowing about a case", () => {
  test("a value that will not compare as it reads: text compared as a number", () => {
    const notes: Array<ConditionNote> = getCaseNotes(
      SEVERITY,
      aCase("case-1", ">", "five hundred", "number"),
    );

    expect(notes).toHaveLength(1);
    expect(notes[0]?.tone).toBe(ConditionNoteTone.Warning);
    expect(notes[0]?.text).toBe(
      '"five hundred" is not a number, so it is compared as 0.',
    );
  });

  test("only the case's own value: the value to check is the step's, not the case's", () => {
    expect(
      getCaseNotes("not a number", aCase("case-1", ">", "5", "number")),
    ).toEqual([]);
  });

  test("nothing for a case that compares as it reads", () => {
    expect(getCaseNotes(SEVERITY, aCase("case-1", "==", "x"))).toEqual([]);
  });
});

describe("cases taken out that had a connection", () => {
  const ORIGINAL: Array<SwitchCase> = [
    aCase("case-1", "==", "Critical Incident"),
    aCase("case-2", "==", "Major Incident"),
    aCase("case-3", "==", "Minor Incident"),
  ];

  const CONNECTIONS: OutputConnections = {
    "case-1": [
      { componentId: "slack-critical", title: "Send Message to Slack" },
    ],
    "case-2": [
      { componentId: "slack-major", title: "Send Message to Slack" },
      { componentId: "log-1", title: "Log" },
    ],
    default: [{ componentId: "log-2", title: "Log" }],
  };

  test("are listed with where they led, as they were named, in their old order", () => {
    const removed: Array<RemovedConnectedCase> = getRemovedConnectedCases({
      originalCases: ORIGINAL,
      cases: [ORIGINAL[2] as SwitchCase],
      connections: CONNECTIONS,
    });

    expect(removed).toEqual([
      {
        switchCase: ORIGINAL[0],
        index: 0,
        label: "Critical Incident",
        steps: CONNECTIONS["case-1"],
      },
      {
        switchCase: ORIGINAL[1],
        index: 1,
        label: "Major Incident",
        steps: CONNECTIONS["case-2"],
      },
    ]);
  });

  test("a removed case that led nowhere disconnects nothing, so it is not listed", () => {
    expect(
      getRemovedConnectedCases({
        originalCases: ORIGINAL,
        cases: [ORIGINAL[0] as SwitchCase, ORIGINAL[1] as SwitchCase],
        connections: CONNECTIONS,
      }),
    ).toEqual([]);
  });

  test("a case renamed or moved keeps its connection, so it is not listed", () => {
    expect(
      getRemovedConnectedCases({
        originalCases: ORIGINAL,
        cases: [
          { ...(ORIGINAL[1] as SwitchCase), value: "Renamed" },
          ORIGINAL[0] as SwitchCase,
          ORIGINAL[2] as SwitchCase,
        ],
        connections: CONNECTIONS,
      }),
    ).toEqual([]);
  });

  test("put back, it is no longer listed", () => {
    const remaining: Array<SwitchCase> = removeCase(ORIGINAL, "case-1");

    expect(
      getRemovedConnectedCases({
        originalCases: ORIGINAL,
        cases: putCaseBack(remaining, ORIGINAL[0] as SwitchCase, 0),
        connections: CONNECTIONS,
      }),
    ).toEqual([]);
  });

  test("without knowing the connections, nothing is listed", () => {
    expect(
      getRemovedConnectedCases({
        originalCases: ORIGINAL,
        cases: [],
        connections: undefined,
      }),
    ).toEqual([]);
  });
});

describe("the step in one line, on the canvas", () => {
  test("what it checks, by the field it reads, and against how many cases", () => {
    expect(
      summarizeSwitch({
        value: SEVERITY,
        cases: [
          { id: "case-1", comparison: "==", value: "a" },
          { id: "case-2", comparison: "==", value: "b" },
        ],
      }),
    ).toBe("Checks incidentSeverity.name against 2 cases");
  });

  test("one case, in the singular", () => {
    expect(
      summarizeSwitch({
        value: "{{local.variables.environment}}",
        cases: [{ id: "case-1", comparison: "==", value: "a" }],
      }),
    ).toBe("Checks environment against 1 case");
  });

  test("a value typed out, or text with values in it, as written", () => {
    expect(summarizeSwitch({ value: "production", cases: [] })).toBe(
      "Checks production against 0 cases",
    );
    expect(
      summarizeSwitch({
        value: "{{local.variables.region}}-{{local.variables.tier}}",
        cases: [],
      }),
    ).toBe("Checks region-tier against 0 cases");
  });

  test("a long value, cut", () => {
    const summary: string | null = summarizeSwitch({
      value: "x".repeat(200),
      cases: [],
    });

    expect(summary).toContain("…");
    expect((summary || "").length).toBeLessThan(80);
  });

  test("nothing until the value to check is set: the step keeps its description", () => {
    expect(summarizeSwitch(undefined)).toBeNull();
    expect(summarizeSwitch({ value: "   ", cases: [] })).toBeNull();
  });
});

describe("the labels the settings use", () => {
  test("are the step's own names for its settings", () => {
    expect(CASES_LABEL).toBe("Cases");
    expect(ADD_CASE_LABEL).toBe("Add case");
  });

  test("starter cases read back as the step stores them", () => {
    expect(
      readSwitchCases(patchForCases(getStarterSwitchCases())["cases"]),
    ).toEqual(getStarterSwitchCases());
  });
});
