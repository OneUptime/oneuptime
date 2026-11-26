import {
  SecurityCaseMatchBasis,
  SecurityCaseMatchedDetectionJson,
  SecurityCaseMatchesJson,
} from "../../../Types/SecurityCase/SecurityCaseMatches";
import SecurityCaseStage from "../../../Types/SecurityCase/SecurityCaseStage";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import { SecurityCaseStepCheckEvidence } from "../../../Types/SecurityCase/SecurityCaseStepCheckEvidence";
import SecurityCaseStepCheckState from "../../../Types/SecurityCase/SecurityCaseStepCheckState";
import SecurityEventRequestOutcome from "../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import {
  ResponsePlanInput,
  buildResponsePlan,
  getContainmentSteps,
} from "../../../Utils/SecurityCase/ResponsePlan/ResponsePlanBuilder";
import { readResponseStepChecks } from "../../../Utils/SecurityCase/ResponsePlan/ResponsePlanInputs";
import {
  ResponseActionKind,
  ResponsePlan,
  ResponseStep,
  ResponseStepCheck,
} from "../../../Utils/SecurityCase/ResponsePlan/ResponsePlanTypes";
import SecurityCaseStepCheck from "../../../Models/DatabaseModels/SecurityCaseStepCheck";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * A case's Response Plan with what OneUptime found when it checked the
 * steps itself (#10340). A step it verified - or found not needed - is
 * done by that check, apart from a person's tick; one that only looks
 * done, or that it cannot tell about, waits for a person. The plan counts
 * the steps OneUptime checked, says which stopped holding, and whether
 * every step that contains the threat is verified - what moves a case to
 * Contained.
 */

const ADDRESS: string = "35.196.249.14";
const USER: string = "alice@acme.com";
const RULE_ID: string = "44444444-4444-4444-8444-444444444444";

function detection(
  groupValue: string,
  groupByField: string,
): SecurityCaseMatchedDetectionJson {
  return {
    id: "66666666-6666-4666-8666-666666666666",
    source: "Detection Rule",
    title: `Detection — ${groupValue}`,
    severity: "Medium",
    groupValue,
    ruleName: "Rule",
    eventCount: 12,
    fireCount: 1,
    firstSeenAt: "2026-11-17T19:28:00.000Z",
    lastSeenAt: "2026-11-17T19:28:00.000Z",
    sampleMessage: "",
    isOpening: true,
    rule: {
      id: RULE_ID,
      name: "Rule",
      description: "",
      isEnabled: true,
      isRealTime: false,
      isCorrelation: false,
      threshold: 3,
      groupByField,
      distinctCountField: "",
      windowInMinutes: 5,
      sigmaRuleYaml: "",
      falsePositives: [],
      references: [],
      lookFor: [],
      responseSteps: [],
    },
    threatIntelFeedId: "",
    securityEventConnectionId: "",
    basis: SecurityCaseMatchBasis.RuleCondition,
    windowStart: "2026-11-17T19:22:00.000Z",
    windowEnd: "2026-11-17T19:29:00.000Z",
    events: [],
    isKept: false,
    keptPastRetentionCount: 0,
    hiddenEventCount: 0,
    matchedEventCount: 12,
    outcomes: { [SecurityEventRequestOutcome.Rejected]: 12 },
  };
}

function matches(
  opening: SecurityCaseMatchedDetectionJson,
): SecurityCaseMatchesJson {
  return {
    detections: [opening],
    detectionCount: 1,
    unreadableSources: [],
    failedSources: [],
  };
}

// CASE-52: a scanner's path traversal, nobody on it yet.
function scanner(
  overrides: Partial<ResponsePlanInput> = {},
): ResponsePlanInput {
  return {
    entities: [{ type: SecurityEntityType.IpAddress, value: ADDRESS }],
    mitreTactics: ["TA0001"],
    mitreTechniques: ["T1190"],
    isAssigned: false,
    hasIncident: false,
    stage: SecurityCaseStage.New,
    hasContainedStatus: true,
    matches: matches(detection(ADDRESS, "principalIp")),
    playbooks: [],
    ranPlaybookIds: [],
    tasks: [],
    ai: null,
    ...overrides,
  };
}

// A compromised account.
function account(
  overrides: Partial<ResponsePlanInput> = {},
): ResponsePlanInput {
  return scanner({
    entities: [{ type: SecurityEntityType.User, value: USER }],
    matches: matches({
      ...detection(USER, "principalUser"),
      outcomes: {},
    }),
    ...overrides,
  });
}

const EVIDENCE: SecurityCaseStepCheckEvidence = {
  sentence: { template: "What OneUptime found.", values: {} },
  facts: [],
  links: [],
  data: {},
};

function check(
  stepKey: string,
  state: SecurityCaseStepCheckState,
): ResponseStepCheck {
  return { stepKey, state, evidence: EVIDENCE };
}

function stepOf(plan: ResponsePlan, key: string): ResponseStep {
  const step: ResponseStep | undefined = plan.steps.find(
    (candidate: ResponseStep): boolean => {
      return candidate.key === key;
    },
  );

  expect({ key, found: Boolean(step) }).toEqual({ key, found: true });

  return step!;
}

describe("a step OneUptime checked", () => {
  test.each([
    [SecurityCaseStepCheckState.Verified, true],
    [SecurityCaseStepCheckState.NotNeeded, true],
    [SecurityCaseStepCheckState.LooksDone, false],
    [SecurityCaseStepCheckState.NotDone, false],
    [SecurityCaseStepCheckState.CannotTell, false],
    [SecurityCaseStepCheckState.Regressed, false],
  ])(
    "%s is done by the check: %s",
    (state: SecurityCaseStepCheckState, isDone: boolean) => {
      const plan: ResponsePlan = buildResponsePlan(
        scanner({ checks: [check("confirm:requests", state)] }),
      );
      const step: ResponseStep = stepOf(plan, "confirm:requests");

      expect(step.isDone).toBe(isDone);
      expect(step.isCheckedByOneUptime).toBe(isDone);
      expect(step.check?.state).toBe(state);
      expect(plan.checked).toBe(isDone ? 1 : 0);
    },
  );

  test("verified, its button has nothing left to do; a person's tick still counts, and stays theirs", () => {
    const plan: ResponsePlan = buildResponsePlan(
      scanner({
        checks: [
          check("confirm:requests", SecurityCaseStepCheckState.Verified),
        ],
        tasks: [
          {
            id: "t1",
            responseStepKey: `contain:block-ip:${ADDRESS}`,
            isDone: true,
            doneByName: "Jane Doe",
          },
        ],
      }),
    );

    expect(stepOf(plan, "confirm:requests").action).toBeUndefined();
    expect(stepOf(plan, `contain:block-ip:${ADDRESS}`).doneByName).toBe(
      "Jane Doe",
    );
    expect(plan.done).toBe(2);
    expect(plan.checked).toBe(1);
  });

  test("Declare Incident, not needed so far, keeps its button: anyone can still declare one", () => {
    const plan: ResponsePlan = buildResponsePlan(
      scanner({
        checks: [
          check("contain:incident", SecurityCaseStepCheckState.NotNeeded),
        ],
      }),
    );

    expect(stepOf(plan, "contain:incident").action?.kind).toBe(
      ResponseActionKind.DeclareIncident,
    );
  });

  test("a check of a step the plan no longer has is left out", () => {
    const plan: ResponsePlan = buildResponsePlan(
      scanner({
        checks: [
          check(
            "contain:block-ip:198.51.100.1",
            SecurityCaseStepCheckState.Verified,
          ),
        ],
      }),
    );

    expect(plan.checked).toBe(0);
  });
});

describe("the plan's own reading of its checks", () => {
  test("names the steps that stopped holding", () => {
    expect(
      buildResponsePlan(
        scanner({
          checks: [
            check(
              `contain:block-ip:${ADDRESS}`,
              SecurityCaseStepCheckState.Regressed,
            ),
            check("confirm:requests", SecurityCaseStepCheckState.Verified),
          ],
        }),
      ).regressedStepKeys,
    ).toEqual([`contain:block-ip:${ADDRESS}`]);
  });

  test("containment is verified once every step that contains the threat is, Declare Incident and Mark as Contained aside", () => {
    const verified: ResponsePlan = buildResponsePlan(
      account({
        checks: [
          check(`contain:user:${USER}`, SecurityCaseStepCheckState.Verified),
        ],
      }),
    );

    expect(
      getContainmentSteps(verified.steps).map((step: ResponseStep): string => {
        return step.key;
      }),
    ).toEqual([`contain:user:${USER}`]);
    expect(verified.isContainmentVerified).toBe(true);
  });

  test("a containment step that only looks done, or that a person ticked, verifies nothing", () => {
    expect(
      buildResponsePlan(
        scanner({
          checks: [
            check(
              `contain:block-ip:${ADDRESS}`,
              SecurityCaseStepCheckState.LooksDone,
            ),
          ],
        }),
      ).isContainmentVerified,
    ).toBe(false);
    expect(
      buildResponsePlan(
        account({
          tasks: [
            {
              id: "t1",
              responseStepKey: `contain:user:${USER}`,
              isDone: true,
            },
          ],
        }),
      ).isContainmentVerified,
    ).toBe(false);
  });
});

describe("a check's row, as the plan reads it", () => {
  function row(fields: Partial<SecurityCaseStepCheck>): SecurityCaseStepCheck {
    const model: SecurityCaseStepCheck = new SecurityCaseStepCheck();
    Object.assign(model, {
      stepKey: "confirm:requests",
      state: SecurityCaseStepCheckState.Verified,
      evidence: EVIDENCE as unknown as JSONObject,
      checkedAt: new Date("2026-11-17T20:00:00.000Z"),
      stateSince: new Date("2026-11-17T19:50:00.000Z"),
      ...fields,
    });
    return model;
  }

  test("keeps its state, evidence and moments", () => {
    expect(readResponseStepChecks([row({})])).toEqual([
      {
        stepKey: "confirm:requests",
        state: SecurityCaseStepCheckState.Verified,
        evidence: EVIDENCE,
        checkedAt: new Date("2026-11-17T20:00:00.000Z"),
        stateSince: new Date("2026-11-17T19:50:00.000Z"),
      },
    ]);
  });

  test("a state it does not know, or evidence with nothing to say, is never read as a step done", () => {
    expect(
      readResponseStepChecks([
        row({ state: "Probably" as SecurityCaseStepCheckState }),
        row({ evidence: { sentence: {} } as unknown as JSONObject }),
        row({ stepKey: " " }),
      ]),
    ).toEqual([]);
  });
});
