import RemediationExecutor, {
  RemediationExecutionResult,
} from "../../../../Server/Utils/AI/SRE/RemediationExecutor";
import RemediationPolicy, {
  PER_SUBJECT_EXECUTION_CAP,
} from "../../../../Server/Utils/AI/SRE/RemediationPolicy";
import AIRemediationActionService from "../../../../Server/Services/AIRemediationActionService";
import RunbookService from "../../../../Server/Services/RunbookService";
import RunbookRuleEngineService from "../../../../Server/Services/RunbookRuleEngineService";
import AIRemediationAction from "../../../../Models/DatabaseModels/AIRemediationAction";
import Runbook from "../../../../Models/DatabaseModels/Runbook";
import RunbookExecution from "../../../../Models/DatabaseModels/RunbookExecution";
import AIRemediationActionType from "../../../../Types/AI/AIRemediationActionType";
import AIRemediationActionStatus from "../../../../Types/AI/AIRemediationActionStatus";
import AIRemediationDecisionMode from "../../../../Types/AI/AIRemediationDecisionMode";
import RunbookStepType from "../../../../Types/Runbook/RunbookStepType";
import { RunbookStep } from "../../../../Types/Runbook/RunbookStep";
import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * The executor's transition logic (invariant 5: CAS transitions, no double
 * execution under concurrency). Under test with mocked services: a lost
 * Proposed→Approved CAS refuses and dispatches NOTHING; expired proposals
 * are swept to Expired and refused; budget refusals leave the action
 * Approved with errorMessage set; the human path stamps approvedByUserId
 * while the auto path never does; Command actions are materialized as a
 * single-step AI-authored runbook; and autoExecute refuses RequireApproval
 * actions outright (invariant 2 hardening).
 */

const actionId: ObjectID = ObjectID.generate();
const projectId: ObjectID = ObjectID.generate();
const incidentId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();
const runbookId: ObjectID = ObjectID.generate();
const executionId: ObjectID = ObjectID.generate();

type ActionOverrides = Partial<Record<keyof AIRemediationAction, unknown>>;

function fakeAction(overrides: ActionOverrides = {}): AIRemediationAction {
  return {
    _id: actionId.toString(),
    projectId,
    incidentId,
    actionType: AIRemediationActionType.Runbook,
    title: "Restart the API pods",
    rationale: "The RCA shows the pods are wedged.",
    runbookId,
    status: AIRemediationActionStatus.Proposed,
    decisionMode: AIRemediationDecisionMode.RequireApproval,
    expiresAt: OneUptimeDate.getSomeHoursAfter(1),
    ...overrides,
  } as unknown as AIRemediationAction;
}

function allowBudgets(): void {
  jest.spyOn(RemediationPolicy, "getDailyExecutionBudget").mockResolvedValue({
    allowed: true,
    limit: 10,
    paused: false,
    executionsToday: 0,
  });
  jest
    .spyOn(RemediationPolicy, "getSubjectExecutionCount")
    .mockResolvedValue(0);
}

describe("RemediationExecutor.approveAndExecute", () => {
  let transitionSpy: jest.SpyInstance;
  let updateSpy: jest.SpyInstance;
  let startRunbookSpy: jest.SpyInstance;

  beforeEach(() => {
    jest
      .spyOn(RemediationPolicy, "isLaneEnabledForProject")
      .mockResolvedValue(true);
    transitionSpy = jest
      .spyOn(AIRemediationActionService, "attemptStatusTransition")
      .mockResolvedValue(1);
    updateSpy = jest
      .spyOn(AIRemediationActionService, "updateOneById")
      .mockResolvedValue(undefined as never);
    startRunbookSpy = jest
      .spyOn(RunbookRuleEngineService, "startRunbookFor")
      .mockResolvedValue({
        _id: executionId.toString(),
      } as unknown as RunbookExecution);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("happy path: CAS Approved then Executing, dispatch with attribution, store the execution id", async () => {
    jest
      .spyOn(AIRemediationActionService, "findOneById")
      .mockResolvedValue(fakeAction());
    allowBudgets();

    const result: RemediationExecutionResult =
      await RemediationExecutor.approveAndExecute({
        actionId,
        byUserId: userId,
      });

    expect(result.ok).toBe(true);

    // CAS 1: Proposed→Approved with the approver stamped (human path).
    expect(transitionSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        fromStatus: AIRemediationActionStatus.Proposed,
        set: expect.objectContaining({
          status: AIRemediationActionStatus.Approved,
          approvedByUserId: userId,
          approvedAt: expect.any(Date),
        }),
      }),
    );

    // CAS 2: Approved→Executing with executedAt (the budgeted timestamp).
    expect(transitionSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        fromStatus: AIRemediationActionStatus.Approved,
        set: expect.objectContaining({
          status: AIRemediationActionStatus.Executing,
          executedAt: expect.any(Date),
        }),
      }),
    );

    // Dispatch carries full attribution (invariant 4).
    expect(startRunbookSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId,
        runbookId,
        linkage: { incidentId },
        triggeredByUserId: userId,
        triggeredByAiRemediationActionId: actionId,
      }),
    );

    // The execution id lands on the action row.
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: actionId,
        data: expect.objectContaining({
          runbookExecutionId: expect.any(ObjectID),
        }),
      }),
    );
  });

  test("double-approve: a lost Proposed→Approved CAS refuses and dispatches NOTHING", async () => {
    jest
      .spyOn(AIRemediationActionService, "findOneById")
      .mockResolvedValue(fakeAction());
    allowBudgets();

    // The concurrent approver already won the transition.
    transitionSpy.mockResolvedValue(0);

    const result: RemediationExecutionResult =
      await RemediationExecutor.approveAndExecute({
        actionId,
        byUserId: userId,
      });

    expect(result.ok).toBe(false);
    expect(result.refusalReason).toMatch(/no longer pending/i);
    expect(transitionSpy).toHaveBeenCalledTimes(1);
    expect(startRunbookSpy).not.toHaveBeenCalled();
  });

  test("expired proposals are CAS'd to Expired and refused, never approved", async () => {
    jest
      .spyOn(AIRemediationActionService, "findOneById")
      .mockResolvedValue(
        fakeAction({ expiresAt: OneUptimeDate.getSomeHoursAgo(1) }),
      );
    allowBudgets();

    const result: RemediationExecutionResult =
      await RemediationExecutor.approveAndExecute({
        actionId,
        byUserId: userId,
      });

    expect(result.ok).toBe(false);
    expect(result.refusalReason).toMatch(/expired/i);

    expect(transitionSpy).toHaveBeenCalledTimes(1);
    expect(transitionSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        fromStatus: AIRemediationActionStatus.Proposed,
        set: { status: AIRemediationActionStatus.Expired },
      }),
    );
    expect(startRunbookSpy).not.toHaveBeenCalled();
  });

  test("a daily-budget refusal leaves the action Approved with errorMessage set", async () => {
    jest
      .spyOn(AIRemediationActionService, "findOneById")
      .mockResolvedValue(fakeAction());
    jest.spyOn(RemediationPolicy, "getDailyExecutionBudget").mockResolvedValue({
      allowed: false,
      limit: 10,
      paused: false,
      executionsToday: 10,
    });
    const subjectCountSpy: jest.SpyInstance = jest.spyOn(
      RemediationPolicy,
      "getSubjectExecutionCount",
    );

    const result: RemediationExecutionResult =
      await RemediationExecutor.approveAndExecute({
        actionId,
        byUserId: userId,
      });

    expect(result.ok).toBe(false);
    expect(result.refusalReason).toMatch(
      /daily AI remediation execution limit/i,
    );

    // Approved happened; Executing never did.
    expect(transitionSpy).toHaveBeenCalledTimes(1);
    expect(transitionSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        fromStatus: AIRemediationActionStatus.Proposed,
      }),
    );

    // The refusal reason lands on the (still Approved) row.
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: actionId,
        data: { errorMessage: result.refusalReason },
      }),
    );

    expect(subjectCountSpy).not.toHaveBeenCalled();
    expect(startRunbookSpy).not.toHaveBeenCalled();
  });

  test("the per-subject cap refuses the same way (Approved + errorMessage)", async () => {
    jest
      .spyOn(AIRemediationActionService, "findOneById")
      .mockResolvedValue(fakeAction());
    jest.spyOn(RemediationPolicy, "getDailyExecutionBudget").mockResolvedValue({
      allowed: true,
      limit: 10,
      paused: false,
      executionsToday: 0,
    });
    jest
      .spyOn(RemediationPolicy, "getSubjectExecutionCount")
      .mockResolvedValue(PER_SUBJECT_EXECUTION_CAP);

    const result: RemediationExecutionResult =
      await RemediationExecutor.approveAndExecute({
        actionId,
        byUserId: userId,
      });

    expect(result.ok).toBe(false);
    expect(result.refusalReason).toMatch(/per-subject cap/i);
    expect(transitionSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { errorMessage: result.refusalReason },
      }),
    );
    expect(startRunbookSpy).not.toHaveBeenCalled();
  });

  test("a disabled lane refuses before any transition", async () => {
    jest
      .spyOn(AIRemediationActionService, "findOneById")
      .mockResolvedValue(fakeAction());
    jest
      .spyOn(RemediationPolicy, "isLaneEnabledForProject")
      .mockResolvedValue(false);

    const result: RemediationExecutionResult =
      await RemediationExecutor.approveAndExecute({
        actionId,
        byUserId: userId,
      });

    expect(result.ok).toBe(false);
    expect(result.refusalReason).toMatch(/not enabled/i);
    expect(transitionSpy).not.toHaveBeenCalled();
  });

  test("a missing action refuses cleanly", async () => {
    jest
      .spyOn(AIRemediationActionService, "findOneById")
      .mockResolvedValue(null);

    const result: RemediationExecutionResult =
      await RemediationExecutor.approveAndExecute({
        actionId,
        byUserId: userId,
      });

    expect(result.ok).toBe(false);
    expect(result.refusalReason).toMatch(/not found/i);
    expect(transitionSpy).not.toHaveBeenCalled();
  });

  test("startRunbookFor returning null marks the action Failed", async () => {
    jest
      .spyOn(AIRemediationActionService, "findOneById")
      .mockResolvedValue(fakeAction());
    allowBudgets();
    startRunbookSpy.mockResolvedValue(null);

    const result: RemediationExecutionResult =
      await RemediationExecutor.approveAndExecute({
        actionId,
        byUserId: userId,
      });

    expect(result.ok).toBe(false);
    expect(result.refusalReason).toMatch(/could not be started/i);

    // The final transition is Executing→Failed with the reason.
    expect(transitionSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        fromStatus: AIRemediationActionStatus.Executing,
        set: expect.objectContaining({
          status: AIRemediationActionStatus.Failed,
          errorMessage: expect.stringMatching(/could not be started/i),
        }),
      }),
    );
  });

  test("Command actions materialize a single-step AI-authored runbook first", async () => {
    const agentId: ObjectID = ObjectID.generate();
    const materializedRunbookId: ObjectID = ObjectID.generate();

    jest.spyOn(AIRemediationActionService, "findOneById").mockResolvedValue(
      fakeAction({
        actionType: AIRemediationActionType.Command,
        runbookId: undefined,
        runbookAgentId: agentId,
        commandScript: "systemctl restart api-server",
      }),
    );
    allowBudgets();

    const createSpy: jest.SpyInstance = jest
      .spyOn(RunbookService, "create")
      .mockResolvedValue({
        _id: materializedRunbookId.toString(),
      } as unknown as Runbook);

    const result: RemediationExecutionResult =
      await RemediationExecutor.approveAndExecute({
        actionId,
        byUserId: userId,
      });

    expect(result.ok).toBe(true);

    // The materialized runbook: AI-authored, enabled, one Bash step.
    const createdRunbook: Runbook = createSpy.mock.calls[0]?.[0]?.data;
    expect(createdRunbook.isCreatedByAi).toBe(true);
    expect(createdRunbook.isEnabled).toBe(true);
    expect(createdRunbook.name).toMatch(/^AI remediation: /);
    expect(createdRunbook.description).toMatch(
      new RegExp(
        `Materialized from AIRemediationAction ${actionId.toString()}`,
      ),
    );

    const steps: Array<RunbookStep> =
      createdRunbook.steps as unknown as Array<RunbookStep>;
    expect(steps).toHaveLength(1);
    expect(steps[0]).toEqual(
      expect.objectContaining({
        order: 1,
        type: RunbookStepType.Bash,
        title: "Restart the API pods",
        config: {
          script: "systemctl restart api-server",
          agentId: agentId.toString(),
          timeoutInMs: 120000,
        },
      }),
    );
    expect(steps[0]?.id).toBeTruthy();

    // Dispatch targets the materialized runbook.
    expect(startRunbookSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        runbookId: materializedRunbookId,
        triggeredByAiRemediationActionId: actionId,
      }),
    );

    // Both the materialized runbook and the execution land on the row.
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          runbookId: materializedRunbookId,
          runbookExecutionId: expect.any(ObjectID),
        }),
      }),
    );
  });

  test("a Command action missing its script fails instead of dispatching", async () => {
    jest.spyOn(AIRemediationActionService, "findOneById").mockResolvedValue(
      fakeAction({
        actionType: AIRemediationActionType.Command,
        runbookId: undefined,
        runbookAgentId: ObjectID.generate(),
        commandScript: undefined,
      }),
    );
    allowBudgets();

    const result: RemediationExecutionResult =
      await RemediationExecutor.approveAndExecute({
        actionId,
        byUserId: userId,
      });

    expect(result.ok).toBe(false);
    expect(transitionSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        fromStatus: AIRemediationActionStatus.Executing,
        set: expect.objectContaining({
          status: AIRemediationActionStatus.Failed,
        }),
      }),
    );
    expect(startRunbookSpy).not.toHaveBeenCalled();
  });
});

describe("RemediationExecutor.autoExecute", () => {
  let transitionSpy: jest.SpyInstance;
  let startRunbookSpy: jest.SpyInstance;

  beforeEach(() => {
    jest
      .spyOn(RemediationPolicy, "isLaneEnabledForProject")
      .mockResolvedValue(true);
    transitionSpy = jest
      .spyOn(AIRemediationActionService, "attemptStatusTransition")
      .mockResolvedValue(1);
    jest
      .spyOn(AIRemediationActionService, "updateOneById")
      .mockResolvedValue(undefined as never);
    startRunbookSpy = jest
      .spyOn(RunbookRuleEngineService, "startRunbookFor")
      .mockResolvedValue({
        _id: executionId.toString(),
      } as unknown as RunbookExecution);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("refuses RequireApproval actions outright — no flag, no transition, no dispatch", async () => {
    jest.spyOn(AIRemediationActionService, "findOneById").mockResolvedValue(
      fakeAction({
        decisionMode: AIRemediationDecisionMode.RequireApproval,
      }),
    );
    allowBudgets();

    await RemediationExecutor.autoExecute({ actionId });

    expect(transitionSpy).not.toHaveBeenCalled();
    expect(startRunbookSpy).not.toHaveBeenCalled();
  });

  test("the auto path stamps approvedAt but NEVER approvedByUserId", async () => {
    jest.spyOn(AIRemediationActionService, "findOneById").mockResolvedValue(
      fakeAction({
        decisionMode: AIRemediationDecisionMode.AutoApproved,
      }),
    );
    allowBudgets();

    await RemediationExecutor.autoExecute({ actionId });

    expect(transitionSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        fromStatus: AIRemediationActionStatus.Proposed,
        set: {
          status: AIRemediationActionStatus.Approved,
          approvedAt: expect.any(Date),
        },
      }),
    );

    // No approver is attributed on the execution either.
    expect(startRunbookSpy).toHaveBeenCalledWith(
      expect.not.objectContaining({
        triggeredByUserId: expect.anything(),
      }),
    );
  });

  test("never throws — a hard service failure is swallowed and logged", async () => {
    jest
      .spyOn(AIRemediationActionService, "findOneById")
      .mockRejectedValue(new Error("db down"));

    await expect(
      RemediationExecutor.autoExecute({ actionId }),
    ).resolves.toBeUndefined();
  });
});
