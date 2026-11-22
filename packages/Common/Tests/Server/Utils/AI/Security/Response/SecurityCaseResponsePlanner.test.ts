import {
  ResponderCase,
  ResponderInput,
  ResponderIntent,
  ResponderLogRow,
  ResponderPlan,
  ResponderWait,
  getQuietUntil,
  planSecurityCaseResponse,
} from "../../../../../../Server/Utils/AI/Security/Response/SecurityCaseResponsePlanner";
import {
  SECURITY_CASE_AI_DEFAULT_MODES,
  SECURITY_CASE_AI_PRIORITY_STEP_KEY,
  SecurityCaseAiActionKind,
  SecurityCaseAiActionReason,
  SecurityCaseAiActionStatus,
  SecurityCaseAiArea,
  SecurityCaseAiDecisionKind,
  SecurityCaseAiLimits,
  SecurityCaseAiMode,
  SecurityCaseHandOffReason,
} from "../../../../../../Types/SecurityCase/SecurityCaseAi";
import SecurityCaseAiVerdict from "../../../../../../Types/SecurityCase/SecurityCaseAiVerdict";
import SecurityCaseStage from "../../../../../../Types/SecurityCase/SecurityCaseStage";
import SecurityCaseStepCheckState from "../../../../../../Types/SecurityCase/SecurityCaseStepCheckState";
import SecurityCaseVerdict from "../../../../../../Types/SecurityCase/SecurityCaseVerdict";
import { SecurityEntityType } from "../../../../../../Types/SecurityCase/SecurityEntity";
import {
  ResponseActionKind,
  ResponsePhase,
  ResponsePlan,
  ResponseStep,
  ResponseStepCheck,
  ResponseStepCompletion,
} from "../../../../../../Utils/SecurityCase/ResponsePlan/ResponsePlanTypes";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT ONEUPTIME AI DOES NEXT ON A CASE IT WORKS (#10352): the planner, on
 * plans built by hand - each step kind, each setting, each hand-off. A
 * whole case worked from its real Response Plan is
 * SecurityCaseResponseEndToEnd.test.ts.
 */

const NOW: Date = new Date("2026-11-22T12:00:00.000Z");
const ADDRESS: string = "35.196.249.14";
const RULE_ID: string = "77777777-7777-4777-8777-777777777777";

const CONFIRMED: SecurityCaseAiLimits["stamps"] = {
  [SecurityCaseAiArea.Edge]: { at: "2026-11-20T10:00:00.000Z" },
};

function limits(
  modes: Partial<Record<SecurityCaseAiArea, SecurityCaseAiMode>> = {},
  stamps: SecurityCaseAiLimits["stamps"] = CONFIRMED,
): SecurityCaseAiLimits {
  return {
    isOn: true,
    modes: { ...SECURITY_CASE_AI_DEFAULT_MODES, ...modes },
    stamps,
  };
}

function step(
  key: string,
  phase: ResponsePhase,
  overrides: Partial<ResponseStep> = {},
): ResponseStep {
  return {
    key,
    phase,
    text: { template: key, values: {} },
    quotes: [],
    isOutsideOneUptime: false,
    completion: ResponseStepCompletion.ByTask,
    isDone: false,
    isCheckedByOneUptime: false,
    ...overrides,
  };
}

function check(
  stepKey: string,
  state: SecurityCaseStepCheckState,
  data: Record<string, string | number | boolean | null> = {},
  checkedAt: Date = NOW,
): ResponseStepCheck {
  return {
    stepKey,
    state,
    evidence: {
      sentence: { template: "A check", values: {} },
      facts: [],
      links: [],
      data,
    },
    checkedAt,
  };
}

function planOf(
  steps: Array<ResponseStep>,
  overrides: Partial<ResponsePlan> = {},
): ResponsePlan {
  return {
    steps,
    done: steps.filter((candidate: ResponseStep): boolean => {
      return candidate.isDone;
    }).length,
    total: steps.length,
    checked: 0,
    isReadyToMarkContained: false,
    isContainmentVerified: false,
    regressedStepKeys: [],
    ...overrides,
  };
}

function row(
  kind: SecurityCaseAiActionKind,
  status: SecurityCaseAiActionStatus,
  stepKey: string,
  overrides: Partial<ResponderLogRow> = {},
): ResponderLogRow {
  return {
    id: `${kind}-${status}-${stepKey}`,
    kind,
    status,
    reason: SecurityCaseAiActionReason.OnItsOwn,
    stepKey,
    target: null,
    createdAt: new Date("2026-11-22T11:00:00.000Z"),
    ...overrides,
  };
}

function input(
  overrides: Omit<Partial<ResponderInput>, "securityCase"> & {
    securityCase?: Partial<ResponderCase>;
  } = {},
): ResponderInput {
  const { securityCase, ...rest } = overrides;

  return {
    now: NOW,
    limits: limits(),
    hasScannersPolicyFinishedTrial: false,
    aiGate: null,
    securityCase: {
      stage: SecurityCaseStage.New,
      aiVerdict: SecurityCaseAiVerdict.LikelyMalicious,
      hasSteeringText: false,
      isAtHighestPriority: false,
      priorityToRaiseTo: null,
      isRaisingToHighestPriority: false,
      lastDetectedAt: new Date("2026-11-22T09:00:00.000Z"),
      createdAt: new Date("2026-11-22T08:00:00.000Z"),
      ...(securityCase || {}),
    },
    plan: planOf([]),
    log: [],
    hasBlockDestination: true,
    canContainUsers: true,
    canContainHosts: true,
    caseBlocks: [],
    ...rest,
  };
}

function intentOf(
  plan: ResponderPlan,
  kind: SecurityCaseAiActionKind,
): ResponderIntent | undefined {
  return plan.intents.find((intent: ResponderIntent): boolean => {
    return intent.kind === kind;
  });
}

const TAKE: ResponseStep = step("confirm:take", ResponsePhase.Confirm);
const BLOCK_KEY: string = `contain:block-ip:${ADDRESS}`;
const BLOCK: ResponseStep = step(BLOCK_KEY, ResponsePhase.Contain, {
  address: ADDRESS,
});

describe("what hands the case to people before anything is done", () => {
  test.each([
    SecurityCaseHandOffReason.AiOff,
    SecurityCaseHandOffReason.NoLlmProvider,
    SecurityCaseHandOffReason.OutOfCredits,
  ])("the project's AI stops it (%s)", (reason: SecurityCaseHandOffReason) => {
    const plan: ResponderPlan = planSecurityCaseResponse(
      input({ aiGate: reason, plan: planOf([TAKE, BLOCK]) }),
    );

    expect(plan.handOff).toEqual({ reason, stepKeys: [] });
    expect(plan.intents).toEqual([]);
  });

  test("text written to steer an AI", () => {
    expect(
      planSecurityCaseResponse(
        input({
          securityCase: { hasSteeringText: true },
          plan: planOf([TAKE, BLOCK]),
        }),
      ).handOff?.reason,
    ).toBe(SecurityCaseHandOffReason.SteeringText);
  });

  test("the project's highest priority", () => {
    expect(
      planSecurityCaseResponse(
        input({
          securityCase: { isAtHighestPriority: true },
          plan: planOf([TAKE, BLOCK]),
        }),
      ).handOff?.reason,
    ).toBe(SecurityCaseHandOffReason.HighestPriority);
  });

  test.each([SecurityCaseAiVerdict.Inconclusive, null])(
    "a read that cannot tell whether it is real (%s)",
    (aiVerdict: SecurityCaseAiVerdict | null) => {
      const plan: ResponderPlan = planSecurityCaseResponse(
        input({ securityCase: { aiVerdict }, plan: planOf([TAKE, BLOCK]) }),
      );

      expect(plan.handOff?.reason).toBe(
        SecurityCaseHandOffReason.NotLikelyMalicious,
      );
      expect(plan.intents).toEqual([]);
    },
  );
});

describe("what came of its own steps", () => {
  test.each([
    [SecurityCaseAiActionStatus.Declined, SecurityCaseHandOffReason.Declined],
    [SecurityCaseAiActionStatus.Undone, SecurityCaseHandOffReason.Declined],
    [SecurityCaseAiActionStatus.Failed, SecurityCaseHandOffReason.StepFailed],
  ])(
    "a step %s hands the case to people",
    (status: SecurityCaseAiActionStatus, reason: SecurityCaseHandOffReason) => {
      const plan: ResponderPlan = planSecurityCaseResponse(
        input({
          plan: planOf([TAKE, BLOCK]),
          log: [row(SecurityCaseAiActionKind.BlockAddress, status, BLOCK_KEY)],
        }),
      );

      expect(plan.handOff).toEqual({ reason, stepKeys: [BLOCK_KEY] });
      expect(plan.intents).toEqual([]);
    },
  );

  test("a block that does not hold is not tried again blindly", () => {
    const enforcedSince: Date = new Date("2026-11-22T11:00:00.000Z");
    const plan: ResponderPlan = planSecurityCaseResponse(
      input({
        plan: planOf([
          step(BLOCK_KEY, ResponsePhase.Contain, {
            address: ADDRESS,
            addressBlock: {
              id: "b1",
              value: ADDRESS,
              action: "Block",
              createdAt: enforcedSince,
              expiresAt: null,
              createdByName: "OneUptime AI",
              enforcedAt: ["Test destination"],
              enforcedSince,
              pendingAt: [],
              notAppliedAt: [],
            } as never,
            check: check(
              BLOCK_KEY,
              SecurityCaseStepCheckState.NotDone,
              {},
              new Date("2026-11-22T11:30:00.000Z"),
            ),
          }),
        ]),
        log: [
          row(
            SecurityCaseAiActionKind.BlockAddress,
            SecurityCaseAiActionStatus.Done,
            BLOCK_KEY,
            { doneAt: enforcedSince },
          ),
        ],
      }),
    );

    expect(plan.handOff).toEqual({
      reason: SecurityCaseHandOffReason.DidNotHold,
      stepKeys: [BLOCK_KEY],
    });
  });

  test("a containment that held and stopped holding goes to people", () => {
    const key: string = "contain:user:jane";
    const plan: ResponderPlan = planSecurityCaseResponse(
      input({
        plan: planOf([
          step(key, ResponsePhase.Contain, {
            check: check(key, SecurityCaseStepCheckState.Regressed),
          }),
        ]),
        log: [
          row(
            SecurityCaseAiActionKind.ContainAccount,
            SecurityCaseAiActionStatus.Done,
            key,
          ),
        ],
      }),
    );

    expect(plan.handOff?.reason).toBe(SecurityCaseHandOffReason.DidNotHold);
  });

  test("a step it did that is still being checked is waited on", () => {
    const plan: ResponderPlan = planSecurityCaseResponse(
      input({
        plan: planOf([BLOCK]),
        log: [
          row(
            SecurityCaseAiActionKind.BlockAddress,
            SecurityCaseAiActionStatus.Done,
            BLOCK_KEY,
          ),
        ],
      }),
    );

    expect(plan.handOff).toBeNull();
    expect(plan.waits).toEqual([ResponderWait.Check]);
  });

  test("a step waiting for approval, or on the engine, is waited on", () => {
    expect(
      planSecurityCaseResponse(
        input({
          plan: planOf([BLOCK]),
          log: [
            row(
              SecurityCaseAiActionKind.BlockAddress,
              SecurityCaseAiActionStatus.Asked,
              BLOCK_KEY,
            ),
          ],
        }),
      ).waits,
    ).toEqual([ResponderWait.Approval]);
    expect(
      planSecurityCaseResponse(
        input({
          plan: planOf([BLOCK]),
          log: [
            row(
              SecurityCaseAiActionKind.BlockAddress,
              SecurityCaseAiActionStatus.Doing,
              BLOCK_KEY,
            ),
          ],
        }),
      ).waits,
    ).toEqual([ResponderWait.Engine]);
  });
});

describe("each row of the settings", () => {
  test("Work the case on its own: it takes the case", () => {
    const take: ResponderIntent | undefined = intentOf(
      planSecurityCaseResponse(input({ plan: planOf([TAKE]) })),
      SecurityCaseAiActionKind.TakeCase,
    );

    expect(take).toEqual(
      expect.objectContaining({
        stepKey: TAKE.key,
        decision: SecurityCaseAiDecisionKind.Do,
        reason: SecurityCaseAiActionReason.OnItsOwn,
        mode: SecurityCaseAiMode.OnItsOwn,
      }),
    );
  });

  test.each([
    [SecurityCaseAiMode.Off, SecurityCaseAiDecisionKind.Leave],
    [SecurityCaseAiMode.Ask, SecurityCaseAiDecisionKind.Ask],
    [SecurityCaseAiMode.OnItsOwn, SecurityCaseAiDecisionKind.Do],
  ])(
    "Block addresses %s",
    (mode: SecurityCaseAiMode, decision: SecurityCaseAiDecisionKind) => {
      const block: ResponderIntent | undefined = intentOf(
        planSecurityCaseResponse(
          input({ limits: limits({ Edge: mode }), plan: planOf([BLOCK]) }),
        ),
        SecurityCaseAiActionKind.BlockAddress,
      );

      expect(block).toEqual(
        expect.objectContaining({
          decision,
          target: ADDRESS,
          stepKey: BLOCK_KEY,
        }),
      );
    },
  );

  test("Block addresses on its own, with no Security Admin's confirmation, asks", () => {
    const block: ResponderIntent | undefined = intentOf(
      planSecurityCaseResponse(
        input({
          limits: limits({ Edge: SecurityCaseAiMode.OnItsOwn }, {}),
          plan: planOf([BLOCK]),
        }),
      ),
      SecurityCaseAiActionKind.BlockAddress,
    );

    expect(block?.decision).toBe(SecurityCaseAiDecisionKind.Ask);
    expect(block?.reason).toBe(SecurityCaseAiActionReason.EdgeNotCleared);
  });

  test("with nothing enforcing the blocklist, the block is a person's", () => {
    const plan: ResponderPlan = planSecurityCaseResponse(
      input({ hasBlockDestination: false, plan: planOf([BLOCK]) }),
    );

    expect(intentOf(plan, SecurityCaseAiActionKind.BlockAddress)).toEqual(
      expect.objectContaining({
        decision: SecurityCaseAiDecisionKind.Leave,
        reason: SecurityCaseAiActionReason.NoBlockDestination,
      }),
    );
    // Nothing else to do: the case is people's, and they are told which step.
    expect(plan.handOff).toEqual({
      reason: SecurityCaseHandOffReason.OnlyPeopleCanDo,
      stepKeys: [BLOCK_KEY],
    });
  });

  test.each([
    ["contain:user:jane", SecurityCaseAiActionKind.ContainAccount, "Accounts"],
    ["contain:host:web-1", SecurityCaseAiActionKind.ContainHost, "Hosts"],
  ])(
    "%s goes by its own row",
    (key: string, kind: SecurityCaseAiActionKind, area: string) => {
      for (const [mode, decision] of [
        [SecurityCaseAiMode.Off, SecurityCaseAiDecisionKind.Leave],
        [SecurityCaseAiMode.Ask, SecurityCaseAiDecisionKind.Ask],
        [SecurityCaseAiMode.OnItsOwn, SecurityCaseAiDecisionKind.Do],
      ] as Array<[SecurityCaseAiMode, SecurityCaseAiDecisionKind]>) {
        expect(
          intentOf(
            planSecurityCaseResponse(
              input({
                limits: limits({ [area]: mode }),
                plan: planOf([step(key, ResponsePhase.Contain)]),
              }),
            ),
            kind,
          )?.decision,
        ).toBe(decision);
      }
    },
  );

  test("a user or host no playbook can contain is left to a person", () => {
    const plan: ResponderPlan = planSecurityCaseResponse(
      input({
        canContainUsers: false,
        plan: planOf([step("contain:user:jane", ResponsePhase.Contain)]),
      }),
    );

    expect(intentOf(plan, SecurityCaseAiActionKind.ContainAccount)).toEqual(
      expect.objectContaining({
        decision: SecurityCaseAiDecisionKind.Leave,
        reason: SecurityCaseAiActionReason.NoWayToDoIt,
      }),
    );
  });

  test("declaring an incident always asks, even with Work the case on its own", () => {
    const key: string = "contain:incident";
    const incident: ResponderIntent | undefined = intentOf(
      planSecurityCaseResponse(
        input({
          plan: planOf([
            step(key, ResponsePhase.Contain, {
              check: check(key, SecurityCaseStepCheckState.NotDone),
            }),
          ]),
        }),
      ),
      SecurityCaseAiActionKind.DeclareIncident,
    );

    expect(incident?.decision).toBe(SecurityCaseAiDecisionKind.Ask);
    expect(incident?.reason).toBe(SecurityCaseAiActionReason.AlwaysAsks);
  });

  test("Contained only once OneUptime verified every containment step", () => {
    const key: string = "contain:mark-contained";

    expect(
      intentOf(
        planSecurityCaseResponse(
          input({
            plan: planOf([step(key, ResponsePhase.Contain)], {
              isContainmentVerified: true,
            }),
          }),
        ),
        SecurityCaseAiActionKind.MarkContained,
      )?.decision,
    ).toBe(SecurityCaseAiDecisionKind.Do);

    // Every step done, one only ticked: a person says it is contained.
    expect(
      intentOf(
        planSecurityCaseResponse(
          input({
            plan: planOf([step(key, ResponsePhase.Contain)], {
              isReadyToMarkContained: true,
            }),
          }),
        ),
        SecurityCaseAiActionKind.MarkContained,
      ),
    ).toEqual(
      expect.objectContaining({
        decision: SecurityCaseAiDecisionKind.Leave,
        reason: SecurityCaseAiActionReason.NeedsJudgement,
      }),
    );
  });

  test("the priority the triage suggested is raised once, never lowered", () => {
    const priorityId: string = "88888888-8888-4888-8888-888888888888";
    const plan: ResponderPlan = planSecurityCaseResponse(
      input({
        securityCase: { priorityToRaiseTo: priorityId },
        plan: planOf([TAKE]),
      }),
    );

    expect(intentOf(plan, SecurityCaseAiActionKind.SetPriority)).toEqual(
      expect.objectContaining({
        stepKey: SECURITY_CASE_AI_PRIORITY_STEP_KEY,
        priorityId,
        decision: SecurityCaseAiDecisionKind.Do,
      }),
    );

    // Raised once: the log has it.
    expect(
      intentOf(
        planSecurityCaseResponse(
          input({
            securityCase: { priorityToRaiseTo: priorityId },
            plan: planOf([TAKE]),
            log: [
              row(
                SecurityCaseAiActionKind.SetPriority,
                SecurityCaseAiActionStatus.Done,
                SECURITY_CASE_AI_PRIORITY_STEP_KEY,
              ),
            ],
          }),
        ),
        SecurityCaseAiActionKind.SetPriority,
      ),
    ).toBeUndefined();
  });

  test("raised to the highest priority, the case goes to people once it is set", () => {
    const plan: ResponderPlan = planSecurityCaseResponse(
      input({
        securityCase: {
          priorityToRaiseTo: "highest",
          isRaisingToHighestPriority: true,
        },
        plan: planOf([TAKE, BLOCK]),
      }),
    );

    expect(
      plan.intents.map((intent: ResponderIntent) => {
        return intent.kind;
      }),
    ).toEqual([SecurityCaseAiActionKind.SetPriority]);
    expect(plan.handOff?.reason).toBe(
      SecurityCaseHandOffReason.HighestPriority,
    );
  });
});

describe("ruling out a false positive", () => {
  const key: string = `confirm:false-positive:${ADDRESS}`;

  test("done only when OneUptime's own facts leave no doubt", () => {
    expect(
      intentOf(
        planSecurityCaseResponse(
          input({
            plan: planOf([
              step(key, ResponsePhase.Confirm, {
                check: check(key, SecurityCaseStepCheckState.CannotTell, {
                  reason: "Judgement",
                  isOwnAddress: false,
                  signedInUsers: 0,
                }),
              }),
            ]),
          }),
        ),
        SecurityCaseAiActionKind.MarkStepDone,
      )?.decision,
    ).toBe(SecurityCaseAiDecisionKind.Do);
  });

  test.each([
    { isOwnAddress: true, signedInUsers: 0 },
    { isOwnAddress: false, signedInUsers: 2 },
  ])(
    "anything that speaks for the address leaves it to a person (%o)",
    (data: { isOwnAddress: boolean; signedInUsers: number }) => {
      const plan: ResponderPlan = planSecurityCaseResponse(
        input({
          plan: planOf([
            step(key, ResponsePhase.Confirm, {
              check: check(key, SecurityCaseStepCheckState.CannotTell, {
                reason: "Judgement",
                ...data,
              }),
            }),
          ]),
        }),
      );

      expect(intentOf(plan, SecurityCaseAiActionKind.StepForPeople)).toEqual(
        expect.objectContaining({
          decision: SecurityCaseAiDecisionKind.Leave,
          reason: SecurityCaseAiActionReason.NeedsJudgement,
        }),
      );
      expect(
        intentOf(plan, SecurityCaseAiActionKind.MarkStepDone),
      ).toBeUndefined();
    },
  );

  test("not checked yet: it waits for the check", () => {
    expect(
      planSecurityCaseResponse(
        input({ plan: planOf([step(key, ResponsePhase.Confirm)]) }),
      ).waits,
    ).toEqual([ResponderWait.Check]);
  });
});

describe("the fix", () => {
  const route: string = "fix:public-app:/api/files";

  test("it asks Fix With AI for the route's pull request, on its own by default", () => {
    const fix: ResponderIntent | undefined = intentOf(
      planSecurityCaseResponse(
        input({
          plan: planOf([
            step(route, ResponsePhase.Fix, {
              text: {
                template: "Fix the route",
                values: { route: "/api/files" },
              },
            }),
          ]),
        }),
      ),
      SecurityCaseAiActionKind.RequestCodeFix,
    );

    expect(fix).toEqual(
      expect.objectContaining({
        decision: SecurityCaseAiDecisionKind.Do,
        target: "/api/files",
      }),
    );
  });

  test("a fix that only looks done is a person's to confirm", () => {
    const plan: ResponderPlan = planSecurityCaseResponse(
      input({
        plan: planOf([
          step(route, ResponsePhase.Fix, {
            check: check(route, SecurityCaseStepCheckState.LooksDone),
          }),
        ]),
      }),
    );

    expect(intentOf(plan, SecurityCaseAiActionKind.StepForPeople)?.reason).toBe(
      SecurityCaseAiActionReason.FixLooksDone,
    );
  });

  test("the pull request it asked for is waited on until it ships and holds", () => {
    expect(
      planSecurityCaseResponse(
        input({
          plan: planOf([
            step(route, ResponsePhase.Fix, {
              check: check(route, SecurityCaseStepCheckState.NotDone),
            }),
          ]),
          log: [
            row(
              SecurityCaseAiActionKind.RequestCodeFix,
              SecurityCaseAiActionStatus.Done,
              route,
            ),
          ],
        }),
      ).waits,
    ).toEqual([ResponderWait.Fix]);
  });

  test("MFA is a person's to confirm; the account's changes are not checked", () => {
    const plan: ResponderPlan = planSecurityCaseResponse(
      input({
        plan: planOf([
          step("fix:brute-force", ResponsePhase.Fix, {
            check: check(
              "fix:brute-force",
              SecurityCaseStepCheckState.LooksDone,
            ),
          }),
          step("fix:account-changes", ResponsePhase.Fix),
        ]),
      }),
    );

    expect(
      plan.intents.map((intent: ResponderIntent): [string, string] => {
        return [intent.stepKey, intent.reason];
      }),
    ).toEqual([
      ["fix:brute-force", SecurityCaseAiActionReason.FixLooksDone],
      ["fix:account-changes", SecurityCaseAiActionReason.FixNotChecked],
    ]);
    expect(plan.handOff?.reason).toBe(
      SecurityCaseHandOffReason.OnlyPeopleCanDo,
    );
  });

  test("a step it left for the same reason is not logged again", () => {
    const plan: ResponderPlan = planSecurityCaseResponse(
      input({
        plan: planOf([step("fix:account-changes", ResponsePhase.Fix)]),
        log: [
          row(
            SecurityCaseAiActionKind.StepForPeople,
            SecurityCaseAiActionStatus.Left,
            "fix:account-changes",
            { reason: SecurityCaseAiActionReason.FixNotChecked },
          ),
        ],
      }),
    );

    expect(plan.intents).toEqual([]);
    expect(plan.handOff?.reason).toBe(
      SecurityCaseHandOffReason.OnlyPeopleCanDo,
    );
  });
});

describe("closing", () => {
  const close: ResponseStep = step("close", ResponsePhase.Close);
  const done: ResponseStep = step("confirm:take", ResponsePhase.Confirm, {
    isDone: true,
  });

  test("only once every other step is done", () => {
    const plan: ResponderPlan = planSecurityCaseResponse(
      input({
        securityCase: { lastDetectedAt: new Date("2026-11-20T00:00:00.000Z") },
        plan: planOf([TAKE, close]),
      }),
    );

    expect(intentOf(plan, SecurityCaseAiActionKind.CloseCase)).toBeUndefined();
  });

  test("after the quiet window, as True Positive, asked first by default", () => {
    const plan: ResponderPlan = planSecurityCaseResponse(
      input({
        securityCase: { lastDetectedAt: new Date("2026-11-21T11:00:00.000Z") },
        plan: planOf([done, close]),
      }),
    );

    expect(intentOf(plan, SecurityCaseAiActionKind.CloseCase)).toEqual(
      expect.objectContaining({
        decision: SecurityCaseAiDecisionKind.Ask,
        reason: SecurityCaseAiActionReason.SettingAsks,
        verdict: SecurityCaseVerdict.TruePositive,
      }),
    );
  });

  test("Close the case on its own closes it", () => {
    expect(
      intentOf(
        planSecurityCaseResponse(
          input({
            limits: limits({ Close: SecurityCaseAiMode.OnItsOwn }),
            securityCase: {
              lastDetectedAt: new Date("2026-11-21T11:00:00.000Z"),
            },
            plan: planOf([done, close]),
          }),
        ),
        SecurityCaseAiActionKind.CloseCase,
      )?.decision,
    ).toBe(SecurityCaseAiDecisionKind.Do);
  });

  test("while the detection fired in the last 24 hours, it waits", () => {
    const lastDetectedAt: Date = new Date("2026-11-22T06:00:00.000Z");
    const plan: ResponderPlan = planSecurityCaseResponse(
      input({
        securityCase: { lastDetectedAt },
        plan: planOf([done, close]),
      }),
    );

    expect(intentOf(plan, SecurityCaseAiActionKind.CloseCase)).toBeUndefined();
    expect(plan.waits).toEqual([ResponderWait.QuietWindow]);
    expect(plan.quietUntil).toEqual(new Date("2026-11-23T06:00:00.000Z"));
    expect(
      getQuietUntil({
        ...input().securityCase,
        lastDetectedAt: null,
        createdAt: lastDetectedAt,
      }),
    ).toEqual(new Date("2026-11-23T06:00:00.000Z"));
  });

  test("a closed case is finished", () => {
    const plan: ResponderPlan = planSecurityCaseResponse(
      input({
        securityCase: { stage: SecurityCaseStage.Closed },
        plan: planOf([done]),
      }),
    );

    expect(plan.isFinished).toBe(true);
    expect(plan.intents).toEqual([]);
  });
});

describe("a case it reads as a false positive or benign", () => {
  const close: ResponseStep = step("close", ResponsePhase.Close);
  const falsePositiveKey: string = `confirm:false-positive:${ADDRESS}`;
  const falsePositive: ResponseStep = step(
    falsePositiveKey,
    ResponsePhase.Confirm,
    {
      action: {
        kind: ResponseActionKind.AddRuleException,
        title: "Add Exception",
        detectionRuleId: RULE_ID,
        entity: { type: SecurityEntityType.IpAddress, value: ADDRESS },
      },
    },
  );

  test.each([
    [
      SecurityCaseAiVerdict.LikelyFalsePositive,
      SecurityCaseVerdict.FalsePositive,
    ],
    [SecurityCaseAiVerdict.LikelyBenign, SecurityCaseVerdict.BenignPositive],
  ])(
    "%s: closed with its verdict, as Close the case says",
    (aiVerdict: SecurityCaseAiVerdict, verdict: SecurityCaseVerdict) => {
      const plan: ResponderPlan = planSecurityCaseResponse(
        input({
          securityCase: { aiVerdict },
          plan: planOf([TAKE, BLOCK, falsePositive, close]),
        }),
      );

      // Nothing is contained or taken for a case that is not real: only the close.
      expect(plan.intents).toEqual([
        expect.objectContaining({
          kind: SecurityCaseAiActionKind.CloseCase,
          verdict,
          decision: SecurityCaseAiDecisionKind.Ask,
        }),
      ]);
    },
  );

  test("once closed: the case's blocks are lifted and its rule is offered an exception, each once", () => {
    const closedLog: Array<ResponderLogRow> = [
      row(
        SecurityCaseAiActionKind.CloseCase,
        SecurityCaseAiActionStatus.Done,
        "close",
        { reason: SecurityCaseAiActionReason.Approved },
      ),
    ];
    const plan: ResponderPlan = planSecurityCaseResponse(
      input({
        securityCase: {
          aiVerdict: SecurityCaseAiVerdict.LikelyFalsePositive,
          stage: SecurityCaseStage.Closed,
        },
        plan: planOf([falsePositive, close]),
        log: closedLog,
        caseBlocks: [{ id: "b1", value: ADDRESS }],
      }),
    );

    expect(plan.isFinished).toBe(true);
    expect(intentOf(plan, SecurityCaseAiActionKind.LiftBlock)).toEqual(
      expect.objectContaining({
        decision: SecurityCaseAiDecisionKind.Do,
        reason: SecurityCaseAiActionReason.Approved,
        blockIds: ["b1"],
        target: ADDRESS,
      }),
    );
    expect(intentOf(plan, SecurityCaseAiActionKind.OfferRuleException)).toEqual(
      expect.objectContaining({
        decision: SecurityCaseAiDecisionKind.Ask,
        reason: SecurityCaseAiActionReason.AlwaysAsks,
        detectionRuleId: RULE_ID,
        entity: { type: SecurityEntityType.IpAddress, value: ADDRESS },
      }),
    );

    // Done once: a later look adds neither again.
    expect(
      planSecurityCaseResponse(
        input({
          securityCase: {
            aiVerdict: SecurityCaseAiVerdict.LikelyFalsePositive,
            stage: SecurityCaseStage.Closed,
          },
          plan: planOf([falsePositive, close]),
          log: [
            ...closedLog,
            row(
              SecurityCaseAiActionKind.LiftBlock,
              SecurityCaseAiActionStatus.Done,
              "close",
            ),
            row(
              SecurityCaseAiActionKind.OfferRuleException,
              SecurityCaseAiActionStatus.Asked,
              falsePositiveKey,
            ),
          ],
          caseBlocks: [{ id: "b1", value: ADDRESS }],
        }),
      ).intents,
    ).toEqual([]);
  });

  test("a case a person closed is not OneUptime AI's to lift", () => {
    const plan: ResponderPlan = planSecurityCaseResponse(
      input({
        securityCase: {
          aiVerdict: SecurityCaseAiVerdict.LikelyFalsePositive,
          stage: SecurityCaseStage.Closed,
        },
        plan: planOf([falsePositive, close]),
        caseBlocks: [{ id: "b1", value: ADDRESS }],
      }),
    );

    expect(plan.intents).toEqual([]);
  });
});
