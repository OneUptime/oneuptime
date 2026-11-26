import SecurityCaseAiAction from "../../../../../../Models/DatabaseModels/SecurityCaseAiAction";
import SecurityPlaybookRun from "../../../../../../Models/DatabaseModels/SecurityPlaybookRun";
import { summarizeSecurityCaseAiTrackRecord } from "../../../../../../Server/Utils/AI/Security/Response/SecurityCaseAiTrackRecordReader";
import SecurityCaseResponseLook from "../../../../../../Server/Utils/AI/Security/Response/SecurityCaseResponseLook";
import ObjectID from "../../../../../../Types/ObjectID";
import {
  SecurityCaseAiActionKind,
  SecurityCaseAiActionReason,
  SecurityCaseAiActionStatus,
} from "../../../../../../Types/SecurityCase/SecurityCaseAi";
import SecurityCaseStepCheckState from "../../../../../../Types/SecurityCase/SecurityCaseStepCheckState";
import { SecurityEntityType } from "../../../../../../Types/SecurityCase/SecurityEntity";
import { SecurityPlaybookActionType } from "../../../../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import SecurityPlaybookRunStatus, {
  SecurityPlaybookStepStatus,
} from "../../../../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import {
  SecurityPlaybookApprovalDecision,
  SecurityPlaybookStepResult,
  SecurityPlaybookTarget,
  SecurityPlaybookTargetReason,
  SecurityPlaybookTargetState,
} from "../../../../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import { computeSecurityAiOverviewMeasures } from "../../../../../../Utils/SecurityCase/SecurityAiOverviewMeasures";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT CAME OF WHAT ONEUPTIME AI DID (#10352): how a row of its log settles
 * from the engine's run - done on its own or once approved, turned down,
 * failed, undone by a person, or found protected - how often the same step
 * held on similar cases, and the figures Security Events' Overview draws.
 */

const NOW: Date = new Date("2026-11-22T12:00:00.000Z");
const PERSON_ID: string = "44444444-4444-4444-8444-444444444444";
const ADDRESS: string = "35.196.249.14";

function row(
  status: SecurityCaseAiActionStatus,
  overrides: Partial<SecurityCaseAiAction> = {},
): SecurityCaseAiAction {
  const action: SecurityCaseAiAction = new SecurityCaseAiAction(
    new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-000000000001"),
  );
  action.kind = SecurityCaseAiActionKind.BlockAddress;
  action.status = status;
  action.reason = SecurityCaseAiActionReason.OnItsOwn;
  action.createdAt = new Date("2026-11-22T11:00:00.000Z");
  action.securityPlaybookRunId = new ObjectID(
    "55555555-5555-4555-8555-555555555555",
  );
  Object.assign(action, overrides);
  return action;
}

function target(
  state: SecurityPlaybookTargetState,
  extra: Partial<SecurityPlaybookTarget> = {},
): SecurityPlaybookTarget {
  return {
    type: SecurityEntityType.IpAddress,
    value: ADDRESS,
    reason: SecurityPlaybookTargetReason.OnTheCase,
    state,
    ...extra,
  };
}

function run(
  status: SecurityPlaybookRunStatus,
  result: Partial<SecurityPlaybookStepResult> = {},
  extra: Partial<SecurityPlaybookRun> = {},
): SecurityPlaybookRun {
  const playbookRun: SecurityPlaybookRun = new SecurityPlaybookRun(
    new ObjectID("55555555-5555-4555-8555-555555555555"),
  );
  playbookRun.status = status;
  playbookRun.steps = [
    {
      id: "step-1",
      action: SecurityPlaybookActionType.BlockAddress,
      config: { blockAction: "Block", duration: "OneDay" },
      requiresApproval: false,
      continueOnFailure: false,
      onlyIfThreatIntelMatched: false,
    },
  ] as never;
  playbookRun.stepResults = [
    {
      stepId: "step-1",
      action: SecurityPlaybookActionType.BlockAddress,
      status: SecurityPlaybookStepStatus.Succeeded,
      ...result,
    },
  ] as never;
  Object.assign(playbookRun, extra);
  return playbookRun;
}

function settle(
  action: SecurityCaseAiAction,
  playbookRun: SecurityPlaybookRun | undefined,
): Partial<SecurityCaseAiAction> | null {
  return SecurityCaseResponseLook.settleRow({
    row: action,
    run: playbookRun,
    now: NOW,
  });
}

describe("a row of OneUptime AI's log, settled from its run", () => {
  test("done on its own", () => {
    const completedAt: Date = new Date("2026-11-22T11:01:00.000Z");

    expect(
      settle(
        row(SecurityCaseAiActionStatus.Doing),
        run(SecurityPlaybookRunStatus.Succeeded, {}, { completedAt }),
      ),
    ).toEqual({
      status: SecurityCaseAiActionStatus.Done,
      reason: SecurityCaseAiActionReason.OnItsOwn,
      doneAt: completedAt,
    });
  });

  test("done once a person approved it: who, and when", () => {
    const decidedAt: string = "2026-11-22T11:05:00.000Z";

    expect(
      settle(
        row(SecurityCaseAiActionStatus.Asked, {
          askedAt: new Date("2026-11-22T11:00:00.000Z"),
        }),
        run(SecurityPlaybookRunStatus.Succeeded, {
          approval: {
            decision: SecurityPlaybookApprovalDecision.Approved,
            decidedByUserId: PERSON_ID,
            decidedAt,
          },
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        status: SecurityCaseAiActionStatus.Done,
        reason: SecurityCaseAiActionReason.Approved,
        decidedAt: new Date(decidedAt),
        decidedByUserId: new ObjectID(PERSON_ID),
      }),
    );
  });

  test("waiting for approval: asked, once", () => {
    expect(
      settle(
        row(SecurityCaseAiActionStatus.Doing),
        run(SecurityPlaybookRunStatus.WaitingForApproval),
      ),
    ).toEqual({ status: SecurityCaseAiActionStatus.Asked, askedAt: NOW });
    expect(
      settle(
        row(SecurityCaseAiActionStatus.Asked),
        run(SecurityPlaybookRunStatus.WaitingForApproval),
      ),
    ).toBeNull();
  });

  test("turned down by a person", () => {
    expect(
      settle(
        row(SecurityCaseAiActionStatus.Asked),
        run(SecurityPlaybookRunStatus.Cancelled, {
          approval: {
            decision: SecurityPlaybookApprovalDecision.Rejected,
            decidedByUserId: PERSON_ID,
            decidedAt: "2026-11-22T11:05:00.000Z",
          },
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        status: SecurityCaseAiActionStatus.Declined,
        reason: SecurityCaseAiActionReason.DeclinedByPerson,
        decidedByUserId: new ObjectID(PERSON_ID),
      }),
    );
  });

  test("failed, with the engine's error", () => {
    const update: Partial<SecurityCaseAiAction> | null = settle(
      row(SecurityCaseAiActionStatus.Doing),
      run(
        SecurityPlaybookRunStatus.Failed,
        { status: SecurityPlaybookStepStatus.Failed },
        { errorMessage: "Not enforced anywhere." },
      ),
    );

    expect(update?.status).toBe(SecurityCaseAiActionStatus.Failed);
    expect(update?.reason).toBe(SecurityCaseAiActionReason.EngineFailed);
    expect(JSON.stringify(update?.evidence)).toContain(
      "Not enforced anywhere.",
    );
  });

  test("skipped as protected: left, never done", () => {
    expect(
      settle(
        row(SecurityCaseAiActionStatus.Doing),
        run(SecurityPlaybookRunStatus.Succeeded, {
          status: SecurityPlaybookStepStatus.Skipped,
          targets: [target(SecurityPlaybookTargetState.Protected)],
        }),
      ),
    ).toEqual({
      status: SecurityCaseAiActionStatus.Left,
      reason: SecurityCaseAiActionReason.ProtectedTarget,
    });
  });

  test("skipped as already blocked: left, saying so", () => {
    expect(
      settle(
        row(SecurityCaseAiActionStatus.Doing),
        run(SecurityPlaybookRunStatus.Succeeded, {
          status: SecurityPlaybookStepStatus.Skipped,
          targets: [target(SecurityPlaybookTargetState.AlreadyDone)],
        }),
      ),
    ).toEqual({
      status: SecurityCaseAiActionStatus.Left,
      reason: SecurityCaseAiActionReason.AlreadyBlocked,
    });
  });

  test("a step it did that a person undid, from the run", () => {
    expect(
      settle(
        row(SecurityCaseAiActionStatus.Done),
        run(SecurityPlaybookRunStatus.Succeeded, {
          targets: [
            target(SecurityPlaybookTargetState.Undone, {
              undoneByUserId: PERSON_ID,
              undoneAt: "2026-11-22T11:30:00.000Z",
            }),
          ],
        }),
      ),
    ).toEqual({
      status: SecurityCaseAiActionStatus.Undone,
      reason: SecurityCaseAiActionReason.UndoneByPerson,
      undoneAt: new Date("2026-11-22T11:30:00.000Z"),
      undoneByUserId: new ObjectID(PERSON_ID),
    });
    expect(
      settle(
        row(SecurityCaseAiActionStatus.Done),
        run(SecurityPlaybookRunStatus.Succeeded, {
          targets: [target(SecurityPlaybookTargetState.Done)],
        }),
      ),
    ).toBeNull();
  });

  test("recorded and never started, ten minutes on: a look stopped part way, so it failed", () => {
    expect(
      settle(
        row(SecurityCaseAiActionStatus.Doing, {
          securityPlaybookRunId: undefined as never,
          createdAt: new Date("2026-11-22T11:49:00.000Z"),
        }),
        undefined,
      ),
    ).toEqual({
      status: SecurityCaseAiActionStatus.Failed,
      reason: SecurityCaseAiActionReason.EngineFailed,
    });
    // A moment ago: it may still be starting.
    expect(
      settle(
        row(SecurityCaseAiActionStatus.Doing, {
          securityPlaybookRunId: undefined as never,
          createdAt: new Date("2026-11-22T11:58:00.000Z"),
        }),
        undefined,
      ),
    ).toBeNull();
  });
});

describe("a step's track record on similar cases", () => {
  test("a case counts once: held when OneUptime verified it, not when it stopped holding", () => {
    expect(
      summarizeSecurityCaseAiTrackRecord([
        { securityCaseId: "a", state: SecurityCaseStepCheckState.Verified },
        { securityCaseId: "a", state: SecurityCaseStepCheckState.Verified },
        { securityCaseId: "b", state: SecurityCaseStepCheckState.Verified },
        { securityCaseId: "b", state: SecurityCaseStepCheckState.Regressed },
        { securityCaseId: "c", state: SecurityCaseStepCheckState.Verified },
        // Never seen done: not a case the step was tried on.
        { securityCaseId: "d", state: SecurityCaseStepCheckState.NotDone },
      ]),
    ).toEqual({ similar: 3, held: 2 });
    expect(summarizeSecurityCaseAiTrackRecord([])).toEqual({
      similar: 0,
      held: 0,
    });
  });
});

describe("the Overview's figures", () => {
  const opened: Date = new Date("2026-11-20T10:00:00.000Z");
  const minutes: (count: number) => Date = (count: number): Date => {
    return new Date(opened.getTime() + count * 60 * 1000);
  };

  test("what it resolved, and the times to contain and close with it and without", () => {
    const measures: ReturnType<typeof computeSecurityAiOverviewMeasures> =
      computeSecurityAiOverviewMeasures({
        cases: [
          // Worked and closed by OneUptime AI.
          {
            createdAt: opened,
            aiTookCaseAt: minutes(1),
            containedAt: minutes(10),
            closedAt: minutes(100),
            aiClosedAt: minutes(100),
          },
          // Worked by it, closed by a person.
          {
            createdAt: opened,
            aiTookCaseAt: minutes(1),
            containedAt: minutes(20),
            closedAt: minutes(200),
          },
          // A person's alone.
          {
            createdAt: opened,
            containedAt: minutes(90),
            closedAt: minutes(600),
          },
          // Still open.
          { createdAt: opened },
        ],
        actions: [],
      });

    expect(measures).toEqual(
      expect.objectContaining({
        casesWorkedByAi: 2,
        casesResolvedByAi: 1,
        meanTimeToContainWithAiInMinutes: 15,
        meanTimeToContainWithoutAiInMinutes: 90,
        meanTimeToCloseWithAiInMinutes: 150,
        meanTimeToCloseWithoutAiInMinutes: 600,
        hasActivity: true,
      }),
    );
  });

  test("the approvals it asked, how soon people answered, and the steps they undid", () => {
    const asked: Date = new Date("2026-11-21T10:00:00.000Z");
    const measures: ReturnType<typeof computeSecurityAiOverviewMeasures> =
      computeSecurityAiOverviewMeasures({
        cases: [],
        actions: [
          {
            status: SecurityCaseAiActionStatus.Done,
            askedAt: asked,
            decidedAt: new Date(asked.getTime() + 4 * 60 * 1000),
          },
          {
            status: SecurityCaseAiActionStatus.Declined,
            askedAt: asked,
            decidedAt: new Date(asked.getTime() + 10 * 60 * 1000),
          },
          {
            status: SecurityCaseAiActionStatus.Done,
            askedAt: asked,
            decidedAt: new Date(asked.getTime() + 30 * 60 * 1000),
          },
          // Still waiting.
          { status: SecurityCaseAiActionStatus.Asked, askedAt: asked },
          // Done on its own, then undone by a person.
          {
            status: SecurityCaseAiActionStatus.Undone,
            undoneAt: new Date("2026-11-21T11:00:00.000Z"),
          },
        ],
      });

    expect(measures).toEqual(
      expect.objectContaining({
        approvalsAsked: 4,
        approvalsAnswered: 3,
        medianTimeToAnswerInMinutes: 10,
        stepsUndone: 1,
        hasActivity: true,
      }),
    );
  });

  test("nothing to show while OneUptime AI has worked no case", () => {
    expect(
      computeSecurityAiOverviewMeasures({
        cases: [{ createdAt: opened, closedAt: minutes(60) }],
        actions: [],
      }),
    ).toEqual(
      expect.objectContaining({
        casesWorkedByAi: 0,
        meanTimeToCloseWithAiInMinutes: null,
        meanTimeToCloseWithoutAiInMinutes: 60,
        medianTimeToAnswerInMinutes: null,
        hasActivity: false,
      }),
    );
  });
});
