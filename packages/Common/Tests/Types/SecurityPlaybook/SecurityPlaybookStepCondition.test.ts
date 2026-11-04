import BadDataException from "../../../Types/Exception/BadDataException";
import {
  SECURITY_PLAYBOOK_ACTIONS,
  SecurityPlaybookActionDefinition,
  SecurityPlaybookActionType,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import { SecurityPlaybookStepStatus } from "../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import {
  SECURITY_PLAYBOOK_MAX_CONDITIONS_PER_STEP,
  SecurityPlaybookConditionMatch,
  SecurityPlaybookStepCondition,
  SecurityPlaybookStepOutcome,
  SecurityPlaybookStepRunIf,
  buildSecurityPlaybookStepRunIf,
  describeSecurityPlaybookStepOutcome,
  doesStepResultMeetOutcome,
  evaluateSecurityPlaybookStepCondition,
  getSecurityPlaybookConditionMatch,
  getSecurityPlaybookFinds,
  getSecurityPlaybookStepConditions,
  getSecurityPlaybookStepOutcomes,
  isSecurityPlaybookConditionMatch,
  isSecurityPlaybookStepConditionGroup,
  isSecurityPlaybookStepOutcome,
  readSecurityPlaybookStepCondition,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookStepCondition";
import { describe, expect, test } from "@jest/globals";

/*
 * BRANCHING: what a later step can wait on, how a stored condition is read,
 * and when it holds against a run.
 */

const LOOKS_SOMETHING_UP: Array<SecurityPlaybookActionType> = [
  SecurityPlaybookActionType.CheckThreatIntel,
  SecurityPlaybookActionType.LookUpEntityActivity,
];

describe("the results a later step can wait on", () => {
  test("a step that looks something up finds something or nothing; a Stop step has none; any other step succeeds", () => {
    for (const action of SECURITY_PLAYBOOK_ACTIONS) {
      const outcomes: Array<SecurityPlaybookStepOutcome> =
        getSecurityPlaybookStepOutcomes({
          action: action.type,
          continueOnFailure: false,
        });

      expect([action.type, outcomes]).toEqual([
        action.type,
        action.type === SecurityPlaybookActionType.StopRun
          ? []
          : LOOKS_SOMETHING_UP.includes(action.type)
            ? [
                SecurityPlaybookStepOutcome.Found,
                SecurityPlaybookStepOutcome.FoundNothing,
              ]
            : [SecurityPlaybookStepOutcome.Succeeded],
      ]);
    }
  });

  test("a Stop step has no result to wait on, even one said to carry on: nothing after it runs", () => {
    for (const continueOnFailure of [true, false]) {
      expect(
        getSecurityPlaybookStepOutcomes({
          action: SecurityPlaybookActionType.StopRun,
          continueOnFailure,
        }),
      ).toEqual([]);
    }
  });

  test("failed is a result only for a step that carries on when it fails", () => {
    for (const action of SECURITY_PLAYBOOK_ACTIONS) {
      if (action.type === SecurityPlaybookActionType.StopRun) {
        continue;
      }

      expect(
        getSecurityPlaybookStepOutcomes({
          action: action.type,
          continueOnFailure: true,
        }),
      ).toContain(SecurityPlaybookStepOutcome.Failed);
      expect(
        getSecurityPlaybookStepOutcomes({
          action: action.type,
          continueOnFailure: false,
        }),
      ).not.toContain(SecurityPlaybookStepOutcome.Failed);
    }
  });

  test("only the steps that look something up say what they find", () => {
    for (const action of SECURITY_PLAYBOOK_ACTIONS) {
      expect([
        action.type,
        Boolean(getSecurityPlaybookFinds(action.type)),
      ]).toEqual([action.type, LOOKS_SOMETHING_UP.includes(action.type)]);
    }

    expect(getSecurityPlaybookFinds(undefined)).toBeUndefined();
    expect(getSecurityPlaybookFinds("Not An Action")).toBeUndefined();
  });

  test("each result reads as a few words a sentence about the step can end with", () => {
    expect(
      describeSecurityPlaybookStepOutcome(
        SecurityPlaybookActionType.CheckThreatIntel,
        SecurityPlaybookStepOutcome.Found,
      ),
    ).toBe("found a known-bad entity");
    expect(
      describeSecurityPlaybookStepOutcome(
        SecurityPlaybookActionType.CheckThreatIntel,
        SecurityPlaybookStepOutcome.FoundNothing,
      ),
    ).toBe("found nothing known-bad");
    expect(
      describeSecurityPlaybookStepOutcome(
        SecurityPlaybookActionType.LookUpEntityActivity,
        SecurityPlaybookStepOutcome.Found,
      ),
    ).toBe("found activity");
    expect(
      describeSecurityPlaybookStepOutcome(
        SecurityPlaybookActionType.LookUpEntityActivity,
        SecurityPlaybookStepOutcome.FoundNothing,
      ),
    ).toBe("found no activity");
    expect(
      describeSecurityPlaybookStepOutcome(
        SecurityPlaybookActionType.SuspendOktaUser,
        SecurityPlaybookStepOutcome.Succeeded,
      ),
    ).toBe("succeeded");
    expect(
      describeSecurityPlaybookStepOutcome(
        SecurityPlaybookActionType.PostToSlack,
        SecurityPlaybookStepOutcome.Failed,
      ),
    ).toBe("failed");
  });

  test("every result a step can have reads as words of its own", () => {
    const phrases: Set<string> = new Set<string>();

    for (const action of SECURITY_PLAYBOOK_ACTIONS) {
      for (const outcome of getSecurityPlaybookStepOutcomes({
        action: action.type,
        continueOnFailure: true,
      })) {
        const phrase: string = describeSecurityPlaybookStepOutcome(
          action.type,
          outcome,
        );

        expect(phrase.length).toBeGreaterThan(3);
        phrases.add(phrase);
      }
    }

    expect([...phrases].sort()).toEqual([
      "failed",
      "found a known-bad entity",
      "found activity",
      "found no activity",
      "found nothing known-bad",
      "succeeded",
    ]);
  });

  test("knows its own results, and nothing else", () => {
    for (const outcome of Object.values(SecurityPlaybookStepOutcome)) {
      expect(isSecurityPlaybookStepOutcome(outcome)).toBe(true);
    }

    expect(isSecurityPlaybookStepOutcome("found")).toBe(false);
    expect(isSecurityPlaybookStepOutcome(undefined)).toBe(false);
    expect(isSecurityPlaybookStepOutcome(1)).toBe(false);
  });
});

describe("readSecurityPlaybookStepCondition", () => {
  const LABEL: string = "Step 3 (Suspend the user in Okta)";

  test("no condition, null, an empty value or an empty object is a step that always runs", () => {
    for (const value of [undefined, null, "", {}, { stepId: "" }]) {
      expect(readSecurityPlaybookStepCondition(value as never, LABEL)).toBe(
        undefined,
      );
    }
  });

  test("reads the step it waits on, trimmed, and the result", () => {
    expect(
      readSecurityPlaybookStepCondition(
        { stepId: "  step-1 ", outcome: "Found Nothing", extra: "dropped" },
        LABEL,
      ),
    ).toEqual({
      stepId: "step-1",
      outcome: SecurityPlaybookStepOutcome.FoundNothing,
    });
  });

  test("refuses one that is there but cannot be read, naming the step: dropped, the step would run always", () => {
    const cases: Array<[unknown, RegExp]> = [
      ["after step 1", /when it runs is not something a playbook can read/],
      [["step-1"], /when it runs is not something a playbook can read/],
      [{ outcome: "Found" }, /choose the earlier step it runs after/],
      [
        { stepId: "x".repeat(101), outcome: "Found" },
        /choose the earlier step/,
      ],
      [{ stepId: "step-1" }, /choose which result of the earlier step/],
      [
        { stepId: "step-1", outcome: "Matched" },
        /choose which result of the earlier step/,
      ],
    ];

    for (const [value, message] of cases) {
      expect(() => {
        return readSecurityPlaybookStepCondition(value as never, LABEL);
      }).toThrow(BadDataException);
      expect(() => {
        return readSecurityPlaybookStepCondition(value as never, LABEL);
      }).toThrow(message);
      expect(() => {
        return readSecurityPlaybookStepCondition(value as never, LABEL);
      }).toThrow(/^Step 3 \(Suspend the user in Okta\): /);
    }
  });
});

describe("a step that waits on several results", () => {
  const FOUND: SecurityPlaybookStepCondition = {
    stepId: "check",
    outcome: SecurityPlaybookStepOutcome.Found,
  };
  const ACTIVITY: SecurityPlaybookStepCondition = {
    stepId: "activity",
    outcome: SecurityPlaybookStepOutcome.FoundNothing,
  };

  test("built from the results picked: none always runs, one is stored as a step always stored it, two or more are a group", () => {
    expect(buildSecurityPlaybookStepRunIf([])).toBeUndefined();
    expect(buildSecurityPlaybookStepRunIf([FOUND])).toEqual(FOUND);
    expect(
      buildSecurityPlaybookStepRunIf(
        [FOUND],
        SecurityPlaybookConditionMatch.Any,
      ),
    ).toEqual(FOUND);
    expect(buildSecurityPlaybookStepRunIf([FOUND, ACTIVITY])).toEqual({
      match: SecurityPlaybookConditionMatch.All,
      conditions: [FOUND, ACTIVITY],
    });
    expect(
      buildSecurityPlaybookStepRunIf(
        [ACTIVITY, FOUND],
        SecurityPlaybookConditionMatch.Any,
      ),
    ).toEqual({
      match: SecurityPlaybookConditionMatch.Any,
      conditions: [ACTIVITY, FOUND],
    });
  });

  test("the same result picked twice is one; a group left with one is that one", () => {
    expect(
      buildSecurityPlaybookStepRunIf([FOUND, { ...FOUND }, ACTIVITY, FOUND]),
    ).toEqual({
      match: SecurityPlaybookConditionMatch.All,
      conditions: [FOUND, ACTIVITY],
    });
    expect(buildSecurityPlaybookStepRunIf([FOUND, { ...FOUND }])).toEqual(
      FOUND,
    );
  });

  test("its results and how it reads them, whatever it holds", () => {
    const group: SecurityPlaybookStepRunIf = {
      match: SecurityPlaybookConditionMatch.Any,
      conditions: [FOUND, ACTIVITY],
    };

    expect(getSecurityPlaybookStepConditions(undefined)).toEqual([]);
    expect(getSecurityPlaybookStepConditions(null)).toEqual([]);
    expect(getSecurityPlaybookStepConditions(FOUND)).toEqual([FOUND]);
    expect(getSecurityPlaybookStepConditions(group)).toEqual([FOUND, ACTIVITY]);

    // One result, or none, reads as all of them.
    expect(getSecurityPlaybookConditionMatch(undefined)).toBe(
      SecurityPlaybookConditionMatch.All,
    );
    expect(getSecurityPlaybookConditionMatch(FOUND)).toBe(
      SecurityPlaybookConditionMatch.All,
    );
    expect(getSecurityPlaybookConditionMatch(group)).toBe(
      SecurityPlaybookConditionMatch.Any,
    );

    expect(isSecurityPlaybookStepConditionGroup(group)).toBe(true);
    expect(isSecurityPlaybookStepConditionGroup(FOUND)).toBe(false);
    expect(isSecurityPlaybookStepConditionGroup(undefined)).toBe(false);
  });

  test("knows how a group reads, and nothing else", () => {
    expect(isSecurityPlaybookConditionMatch("All")).toBe(true);
    expect(isSecurityPlaybookConditionMatch("Any")).toBe(true);

    for (const value of ["all", "ANY", "Either", "", null, undefined, 1]) {
      expect(isSecurityPlaybookConditionMatch(value)).toBe(false);
    }
  });
});

describe("readSecurityPlaybookStepCondition, a group", () => {
  const LABEL: string = "Step 4 (Page on-call)";

  test("reads each result, trimmed, and how they are read", () => {
    expect(
      readSecurityPlaybookStepCondition(
        {
          match: "Any",
          conditions: [
            { stepId: " step-1 ", outcome: "Found", extra: "dropped" },
            { stepId: "step-2", outcome: "Succeeded" },
          ],
          extra: "dropped",
        },
        LABEL,
      ),
    ).toEqual({
      match: SecurityPlaybookConditionMatch.Any,
      conditions: [
        { stepId: "step-1", outcome: SecurityPlaybookStepOutcome.Found },
        { stepId: "step-2", outcome: SecurityPlaybookStepOutcome.Succeeded },
      ],
    });
  });

  test("a group that does not say how it reads waits on all of them", () => {
    for (const match of [undefined, null]) {
      expect(
        readSecurityPlaybookStepCondition(
          {
            ...(match === undefined ? {} : { match }),
            conditions: [
              { stepId: "step-1", outcome: "Found" },
              { stepId: "step-2", outcome: "Succeeded" },
            ],
          },
          LABEL,
        ),
      ).toEqual({
        match: SecurityPlaybookConditionMatch.All,
        conditions: [
          { stepId: "step-1", outcome: SecurityPlaybookStepOutcome.Found },
          { stepId: "step-2", outcome: SecurityPlaybookStepOutcome.Succeeded },
        ],
      });
    }
  });

  test("a group of one is that one result, stored as before; an empty one, or one of empty results, always runs", () => {
    expect(
      readSecurityPlaybookStepCondition(
        {
          match: "Any",
          conditions: [
            { stepId: "step-1", outcome: "Found" },
            { stepId: "step-1", outcome: "Found" },
          ],
        },
        LABEL,
      ),
    ).toEqual({ stepId: "step-1", outcome: SecurityPlaybookStepOutcome.Found });

    expect(
      readSecurityPlaybookStepCondition(
        { match: "All", conditions: [] },
        LABEL,
      ),
    ).toBeUndefined();
    expect(
      readSecurityPlaybookStepCondition(
        { match: "All", conditions: [null, {}, { stepId: "" }] },
        LABEL,
      ),
    ).toBeUndefined();
  });

  test(`reads up to ${SECURITY_PLAYBOOK_MAX_CONDITIONS_PER_STEP} results, and refuses more`, () => {
    const conditions: Array<{ stepId: string; outcome: string }> = [];

    for (
      let index: number = 0;
      index <= SECURITY_PLAYBOOK_MAX_CONDITIONS_PER_STEP;
      index++
    ) {
      conditions.push({ stepId: `step-${index}`, outcome: "Succeeded" });
    }

    expect(
      getSecurityPlaybookStepConditions(
        readSecurityPlaybookStepCondition(
          {
            match: "All",
            conditions: conditions.slice(
              0,
              SECURITY_PLAYBOOK_MAX_CONDITIONS_PER_STEP,
            ),
          },
          LABEL,
        ),
      ),
    ).toHaveLength(SECURITY_PLAYBOOK_MAX_CONDITIONS_PER_STEP);

    expect(() => {
      return readSecurityPlaybookStepCondition(
        { match: "All", conditions },
        LABEL,
      );
    }).toThrow(
      `Step 4 (Page on-call): a step waits on at most ${SECURITY_PLAYBOOK_MAX_CONDITIONS_PER_STEP} results of earlier steps.`,
    );
  });

  test("refuses one that is there but cannot be read, naming the step: dropped, the step would run always", () => {
    const cases: Array<[unknown, RegExp]> = [
      [
        { match: "All", conditions: "step-1" },
        /when it runs is not something a playbook can read/,
      ],
      [
        { match: "All", conditions: { stepId: "step-1", outcome: "Found" } },
        /when it runs is not something a playbook can read/,
      ],
      [
        {
          match: "Either",
          conditions: [{ stepId: "step-1", outcome: "Found" }],
        },
        /choose whether it runs after all of the results it waits on, or any one of them/,
      ],
      [
        {
          match: "Any",
          conditions: [
            { stepId: "step-1", outcome: "Found" },
            { stepId: "step-2", outcome: "Matched" },
          ],
        },
        /choose which result of the earlier step/,
      ],
      [
        {
          match: "Any",
          conditions: [{ stepId: "step-1", outcome: "Found" }, "step-2"],
        },
        /when it runs is not something a playbook can read/,
      ],
      [
        {
          match: "Any",
          conditions: [{ outcome: "Found" }],
        },
        /choose the earlier step it runs after/,
      ],
    ];

    for (const [value, message] of cases) {
      expect(() => {
        return readSecurityPlaybookStepCondition(value as never, LABEL);
      }).toThrow(BadDataException);
      expect(() => {
        return readSecurityPlaybookStepCondition(value as never, LABEL);
      }).toThrow(message);
      expect(() => {
        return readSecurityPlaybookStepCondition(value as never, LABEL);
      }).toThrow(/^Step 4 \(Page on-call\): /);
    }
  });
});

describe("doesStepResultMeetOutcome", () => {
  const STATUSES: Array<SecurityPlaybookStepStatus> = Object.values(
    SecurityPlaybookStepStatus,
  );

  test("succeeded and failed read the step's status", () => {
    for (const status of STATUSES) {
      expect([
        status,
        doesStepResultMeetOutcome(
          { status },
          SecurityPlaybookStepOutcome.Succeeded,
        ),
        doesStepResultMeetOutcome(
          { status },
          SecurityPlaybookStepOutcome.Failed,
        ),
      ]).toEqual([
        status,
        status === SecurityPlaybookStepStatus.Succeeded,
        status === SecurityPlaybookStepStatus.Failed,
      ]);
    }
  });

  test("found and found nothing hold only for a step that succeeded and said which", () => {
    for (const status of STATUSES) {
      for (const found of [true, false, undefined]) {
        const succeeded: boolean =
          status === SecurityPlaybookStepStatus.Succeeded;

        expect([
          status,
          found,
          doesStepResultMeetOutcome(
            { status, found },
            SecurityPlaybookStepOutcome.Found,
          ),
          doesStepResultMeetOutcome(
            { status, found },
            SecurityPlaybookStepOutcome.FoundNothing,
          ),
        ]).toEqual([
          status,
          found,
          succeeded && found === true,
          succeeded && found === false,
        ]);
      }
    }
  });
});

describe("evaluateSecurityPlaybookStepCondition", () => {
  const STEPS: Array<{ id: string; action: SecurityPlaybookActionType }> = [
    { id: "check", action: SecurityPlaybookActionType.CheckThreatIntel },
    { id: "suspend", action: SecurityPlaybookActionType.SuspendOktaUser },
    { id: "note", action: SecurityPlaybookActionType.AddCaseNote },
  ];

  function evaluate(
    condition: SecurityPlaybookStepRunIf | undefined,
    results: Array<{ status: SecurityPlaybookStepStatus; found?: boolean }>,
    index: number = 2,
  ): { holds: boolean; reason?: string | undefined } {
    return evaluateSecurityPlaybookStepCondition({
      condition,
      index,
      steps: STEPS,
      results,
    });
  }

  test("a step that waits on nothing always runs", () => {
    expect(evaluate(undefined, [])).toEqual({ holds: true });
  });

  test("holds on the result it waits on", () => {
    expect(
      evaluate(
        { stepId: "check", outcome: SecurityPlaybookStepOutcome.Found },
        [
          { status: SecurityPlaybookStepStatus.Succeeded, found: true },
          { status: SecurityPlaybookStepStatus.Succeeded },
        ],
      ),
    ).toEqual({ holds: true });
  });

  test("says which step and which result when it does not hold", () => {
    expect(
      evaluate(
        { stepId: "check", outcome: SecurityPlaybookStepOutcome.Found },
        [
          { status: SecurityPlaybookStepStatus.Succeeded, found: false },
          { status: SecurityPlaybookStepStatus.Skipped },
        ],
      ),
    ).toEqual({
      holds: false,
      reason:
        "Skipped: it runs only if step 1 (Check entities against threat intel) found a known-bad entity.",
    });

    expect(
      evaluate(
        { stepId: "suspend", outcome: SecurityPlaybookStepOutcome.Failed },
        [
          { status: SecurityPlaybookStepStatus.Succeeded, found: true },
          { status: SecurityPlaybookStepStatus.Succeeded },
        ],
      ).reason,
    ).toBe(
      "Skipped: it runs only if step 2 (Suspend the user in Okta) failed.",
    );
  });

  test("a step it waits on that never ended - skipped, rejected, pending, gone from the results - is no result", () => {
    for (const status of [
      SecurityPlaybookStepStatus.Skipped,
      SecurityPlaybookStepStatus.Rejected,
      SecurityPlaybookStepStatus.Pending,
      SecurityPlaybookStepStatus.WaitingForApproval,
    ]) {
      for (const outcome of Object.values(SecurityPlaybookStepOutcome)) {
        expect(
          evaluate({ stepId: "check", outcome }, [{ status, found: true }])
            .holds,
        ).toBe(false);
      }
    }

    expect(
      evaluate(
        { stepId: "check", outcome: SecurityPlaybookStepOutcome.FoundNothing },
        [],
      ).holds,
    ).toBe(false);
  });

  test("a step that is not before it - itself, a later one, one that is gone - never lets it run", () => {
    const reason: string =
      "Skipped: the step it runs after is not before it in this run.";

    for (const stepId of ["note", "deleted-step"]) {
      expect(
        evaluate({ stepId, outcome: SecurityPlaybookStepOutcome.Succeeded }, [
          { status: SecurityPlaybookStepStatus.Succeeded, found: true },
          { status: SecurityPlaybookStepStatus.Succeeded },
          { status: SecurityPlaybookStepStatus.Succeeded },
        ]),
      ).toEqual({ holds: false, reason });
    }

    // The note waits on the suspend step, which comes after it here.
    expect(
      evaluate(
        { stepId: "suspend", outcome: SecurityPlaybookStepOutcome.Succeeded },
        [{ status: SecurityPlaybookStepStatus.Succeeded }],
        0,
      ),
    ).toEqual({ holds: false, reason });
  });

  test("waiting on all of several results, it runs only when every one happened, and says each when one did not", () => {
    const all: SecurityPlaybookStepRunIf = {
      match: SecurityPlaybookConditionMatch.All,
      conditions: [
        { stepId: "check", outcome: SecurityPlaybookStepOutcome.Found },
        { stepId: "suspend", outcome: SecurityPlaybookStepOutcome.Succeeded },
      ],
    };

    expect(
      evaluate(all, [
        { status: SecurityPlaybookStepStatus.Succeeded, found: true },
        { status: SecurityPlaybookStepStatus.Succeeded },
      ]),
    ).toEqual({ holds: true });

    const reason: string =
      "Skipped: it runs only if step 1 (Check entities against threat intel) found a known-bad entity and step 2 (Suspend the user in Okta) succeeded.";

    for (const results of [
      [
        { status: SecurityPlaybookStepStatus.Succeeded, found: false },
        { status: SecurityPlaybookStepStatus.Succeeded },
      ],
      [
        { status: SecurityPlaybookStepStatus.Succeeded, found: true },
        { status: SecurityPlaybookStepStatus.Skipped },
      ],
      [
        { status: SecurityPlaybookStepStatus.Succeeded, found: false },
        { status: SecurityPlaybookStepStatus.Rejected },
      ],
    ]) {
      expect(evaluate(all, results)).toEqual({ holds: false, reason });
    }
  });

  test("waiting on any one of several results, it runs when one happened, and says them with or when none did", () => {
    const any: SecurityPlaybookStepRunIf = {
      match: SecurityPlaybookConditionMatch.Any,
      conditions: [
        { stepId: "check", outcome: SecurityPlaybookStepOutcome.Found },
        { stepId: "suspend", outcome: SecurityPlaybookStepOutcome.Succeeded },
      ],
    };

    for (const results of [
      [
        { status: SecurityPlaybookStepStatus.Succeeded, found: true },
        { status: SecurityPlaybookStepStatus.Skipped },
      ],
      [
        { status: SecurityPlaybookStepStatus.Succeeded, found: false },
        { status: SecurityPlaybookStepStatus.Succeeded },
      ],
      [
        { status: SecurityPlaybookStepStatus.Succeeded, found: true },
        { status: SecurityPlaybookStepStatus.Succeeded },
      ],
    ]) {
      expect(evaluate(any, results)).toEqual({ holds: true });
    }

    expect(
      evaluate(any, [
        { status: SecurityPlaybookStepStatus.Succeeded, found: false },
        { status: SecurityPlaybookStepStatus.Skipped },
      ]),
    ).toEqual({
      holds: false,
      reason:
        "Skipped: it runs only if step 1 (Check entities against threat intel) found a known-bad entity or step 2 (Suspend the user in Okta) succeeded.",
    });
  });

  test("three results read as a list: a, b and c", () => {
    expect(
      evaluateSecurityPlaybookStepCondition({
        condition: {
          match: SecurityPlaybookConditionMatch.Any,
          conditions: [
            { stepId: "check", outcome: SecurityPlaybookStepOutcome.Found },
            {
              stepId: "suspend",
              outcome: SecurityPlaybookStepOutcome.Failed,
            },
            { stepId: "note", outcome: SecurityPlaybookStepOutcome.Succeeded },
          ],
        },
        index: 3,
        steps: [
          ...STEPS,
          { id: "page", action: SecurityPlaybookActionType.PageOnCall },
        ],
        results: [
          { status: SecurityPlaybookStepStatus.Succeeded, found: false },
          { status: SecurityPlaybookStepStatus.Succeeded },
          { status: SecurityPlaybookStepStatus.Failed },
        ],
      }).reason,
    ).toBe(
      "Skipped: it runs only if step 1 (Check entities against threat intel) found a known-bad entity, step 2 (Suspend the user in Okta) failed or step 3 (Add a note) succeeded.",
    );
  });

  test("a group with a step that is not before it never lets it run, even on any one", () => {
    expect(
      evaluate(
        {
          match: SecurityPlaybookConditionMatch.Any,
          conditions: [
            { stepId: "check", outcome: SecurityPlaybookStepOutcome.Found },
            { stepId: "gone", outcome: SecurityPlaybookStepOutcome.Succeeded },
          ],
        },
        [
          { status: SecurityPlaybookStepStatus.Succeeded, found: true },
          { status: SecurityPlaybookStepStatus.Succeeded },
        ],
      ),
    ).toEqual({
      holds: false,
      reason: "Skipped: a step it runs after is not before it in this run.",
    });
  });

  test("an action this build does not know is named as written", () => {
    expect(
      evaluateSecurityPlaybookStepCondition({
        condition: {
          stepId: "old",
          outcome: SecurityPlaybookStepOutcome.Succeeded,
        },
        index: 1,
        steps: [
          { id: "old", action: "Retired Action" as SecurityPlaybookActionType },
          STEPS[2]!,
        ],
        results: [{ status: SecurityPlaybookStepStatus.Failed }],
      }).reason,
    ).toBe("Skipped: it runs only if step 1 (Retired Action) succeeded.");
  });
});

describe("the actions that look something up", () => {
  test("are Investigate steps, and none of them acts on anything outside OneUptime", () => {
    for (const type of LOOKS_SOMETHING_UP) {
      const definition: SecurityPlaybookActionDefinition | undefined =
        SECURITY_PLAYBOOK_ACTIONS.find(
          (action: SecurityPlaybookActionDefinition): boolean => {
            return action.type === type;
          },
        );

      expect(definition?.category).toBe("Investigate");
      expect(definition?.connectionProvider).toBeUndefined();
      expect(definition?.isDisruptive).toBe(false);
    }
  });
});
