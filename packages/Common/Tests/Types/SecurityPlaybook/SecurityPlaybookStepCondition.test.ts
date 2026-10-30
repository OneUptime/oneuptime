import BadDataException from "../../../Types/Exception/BadDataException";
import {
  SECURITY_PLAYBOOK_ACTIONS,
  SecurityPlaybookActionDefinition,
  SecurityPlaybookActionType,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import { SecurityPlaybookStepStatus } from "../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import {
  SecurityPlaybookStepCondition,
  SecurityPlaybookStepOutcome,
  describeSecurityPlaybookStepOutcome,
  doesStepResultMeetOutcome,
  evaluateSecurityPlaybookStepCondition,
  getSecurityPlaybookFinds,
  getSecurityPlaybookStepOutcomes,
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
  test("a step that looks something up finds something or nothing; any other step succeeds", () => {
    for (const action of SECURITY_PLAYBOOK_ACTIONS) {
      const outcomes: Array<SecurityPlaybookStepOutcome> =
        getSecurityPlaybookStepOutcomes({
          action: action.type,
          continueOnFailure: false,
        });

      expect([action.type, outcomes]).toEqual([
        action.type,
        LOOKS_SOMETHING_UP.includes(action.type)
          ? [
              SecurityPlaybookStepOutcome.Found,
              SecurityPlaybookStepOutcome.FoundNothing,
            ]
          : [SecurityPlaybookStepOutcome.Succeeded],
      ]);
    }
  });

  test("failed is a result only for a step that carries on when it fails", () => {
    for (const action of SECURITY_PLAYBOOK_ACTIONS) {
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
      expect([action.type, Boolean(getSecurityPlaybookFinds(action.type))]).toEqual(
        [action.type, LOOKS_SOMETHING_UP.includes(action.type)],
      );
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
      [{ stepId: "x".repeat(101), outcome: "Found" }, /choose the earlier step/],
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
        doesStepResultMeetOutcome({ status }, SecurityPlaybookStepOutcome.Failed),
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
    condition: SecurityPlaybookStepCondition | undefined,
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
      evaluate({ stepId: "check", outcome: SecurityPlaybookStepOutcome.Found }, [
        { status: SecurityPlaybookStepStatus.Succeeded, found: true },
        { status: SecurityPlaybookStepStatus.Succeeded },
      ]),
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
    ).toBe("Skipped: it runs only if step 2 (Suspend the user in Okta) failed.");
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
        evaluate(
          { stepId, outcome: SecurityPlaybookStepOutcome.Succeeded },
          [
            { status: SecurityPlaybookStepStatus.Succeeded, found: true },
            { status: SecurityPlaybookStepStatus.Succeeded },
            { status: SecurityPlaybookStepStatus.Succeeded },
          ],
        ),
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
