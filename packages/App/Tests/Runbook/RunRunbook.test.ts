import ObjectID from "Common/Types/ObjectID";
import { JSONObject } from "Common/Types/JSON";
import RunbookExecutionStatus from "Common/Types/Runbook/RunbookExecutionStatus";
import RunbookStepExecutionStatus from "Common/Types/Runbook/RunbookStepExecutionStatus";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import { RunbookStep } from "Common/Types/Runbook/RunbookStep";
import { RunbookStepExecutionState } from "Common/Types/Runbook/RunbookStepExecution";
import RunbookExecutionService from "Common/Server/Services/RunbookExecutionService";
import RunbookExecution from "Common/Models/DatabaseModels/RunbookExecution";
import logger from "Common/Server/Utils/Logger";
import {
  RunbookStepAction,
  applyRunbookStepAction,
} from "Common/Types/Runbook/RunbookStepAction";
import {
  APPROVAL_AFTER_LAST_STEP_TITLE,
  RunbookStepWait,
  getRunbookStepWait,
} from "Common/Types/Runbook/RunbookStepApproval";
import { RunbookStarterClass } from "Common/Server/Utils/Runbook/RunbookStarter";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

/*
 * The Queue module pulls in BullMQ at import time (via QueueRunbook); the
 * state machine under test never needs a real queue.
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {
      getQueue: jest.fn().mockReturnValue({
        add: jest.fn().mockResolvedValue(undefined),
      }),
    },
    QueueName: {
      Runbook: "Runbook",
    },
  };
});

/*
 * Step executors are exercised by their own suites; here they are stubs so
 * the tests drive ONLY the execution state machine.
 */
jest.mock("../../FeatureSet/Runbook/Services/StepExecutors", () => {
  return {
    __esModule: true,
    runJavaScriptStep: jest.fn(),
    runHttpStep: jest.fn(),
    runBashStep: jest.fn(),
    truncate: (s: string): string => {
      return s;
    },
  };
});

jest.mock("../../FeatureSet/Runbook/Services/AIStepExecutor", () => {
  return {
    __esModule: true,
    runAiStep: jest.fn(),
  };
});

// Import AFTER the jest.mock calls above (they are hoisted by jest).
import RunRunbook from "../../FeatureSet/Runbook/Services/RunRunbook";
import {
  runBashStep,
  runHttpStep,
} from "../../FeatureSet/Runbook/Services/StepExecutors";
import { runAiStep } from "../../FeatureSet/Runbook/Services/AIStepExecutor";

const runHttpStepMock: jest.Mock = runHttpStep as unknown as jest.Mock;
const runBashStepMock: jest.Mock = runBashStep as unknown as jest.Mock;
const runAiStepMock: jest.Mock = runAiStep as unknown as jest.Mock;

let stepCounter: number = 0;

function makeStep(
  type: RunbookStepType,
  overrides: Partial<RunbookStep> = {},
): RunbookStep {
  stepCounter++;
  return {
    id: `step-${stepCounter}`,
    order: stepCounter,
    type,
    title: `Step ${stepCounter}`,
    config: {} as never,
    ...overrides,
  };
}

function pending(step: RunbookStep): RunbookStepExecutionState {
  return { step, status: RunbookStepExecutionStatus.Pending };
}

function makeExecution(
  stepExecutions: Array<RunbookStepExecutionState>,
  overrides: Partial<Record<string, unknown>> = {},
): RunbookExecution {
  return {
    _id: "exec1",
    projectId: new ObjectID("proj1"),
    runbookId: new ObjectID("rb1"),
    runbookNameSnapshot: "Test Runbook",
    status: RunbookExecutionStatus.Scheduled,
    stepExecutions,
    startedAt: undefined,
    ...overrides,
  } as unknown as RunbookExecution;
}

interface UpdateCall {
  status?: RunbookExecutionStatus;
  stepExecutions?: Array<RunbookStepExecutionState>;
  failureReason?: string;
  startedAt?: Date;
  completedAt?: Date;
}

function getUpdates(updateSpy: jest.SpyInstance): Array<UpdateCall> {
  return updateSpy.mock.calls.map((call: Array<unknown>) => {
    return (call[0] as { data: JSONObject }).data as unknown as UpdateCall;
  });
}

function lastStatusUpdate(updateSpy: jest.SpyInstance): UpdateCall {
  const updates: Array<UpdateCall> = getUpdates(updateSpy).filter(
    (u: UpdateCall) => {
      return u.status !== undefined;
    },
  );
  return updates[updates.length - 1]!;
}

async function run(
  execution: RunbookExecution | null,
): Promise<jest.SpyInstance> {
  jest
    .spyOn(RunbookExecutionService, "findOneById")
    .mockResolvedValue(execution);
  const updateSpy: jest.SpyInstance = jest
    .spyOn(RunbookExecutionService, "updateOneById")
    .mockResolvedValue(undefined as never);

  await new RunRunbook().runExecution({
    runbookExecutionId: new ObjectID("exec1"),
  });

  return updateSpy;
}

describe("RunRunbook state machine", () => {
  beforeEach(() => {
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    runHttpStepMock.mockReset();
    runBashStepMock.mockReset();
    runAiStepMock.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a missing execution logs a warning and writes nothing", async () => {
    const updateSpy: jest.SpyInstance = await run(null);

    expect(updateSpy).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  test.each([
    RunbookExecutionStatus.Completed,
    RunbookExecutionStatus.Failed,
    RunbookExecutionStatus.Cancelled,
  ])(
    "a terminal execution (%s) is left untouched",
    async (status: RunbookExecutionStatus) => {
      const updateSpy: jest.SpyInstance = await run(
        makeExecution([pending(makeStep(RunbookStepType.HttpRequest))], {
          status,
        }),
      );

      expect(updateSpy).not.toHaveBeenCalled();
      expect(runHttpStepMock).not.toHaveBeenCalled();
    },
  );

  test("an execution with no steps completes immediately", async () => {
    const updateSpy: jest.SpyInstance = await run(makeExecution([]));

    const updates: Array<UpdateCall> = getUpdates(updateSpy);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.status).toBe(RunbookExecutionStatus.Completed);
    expect(updates[0]!.completedAt).toBeInstanceOf(Date);
  });

  test("the first run stamps startedAt and moves to Running", async () => {
    runHttpStepMock.mockResolvedValue({ success: true, output: "ok" });

    const updateSpy: jest.SpyInstance = await run(
      makeExecution([pending(makeStep(RunbookStepType.HttpRequest))]),
    );

    const first: UpdateCall = getUpdates(updateSpy)[0]!;
    expect(first.status).toBe(RunbookExecutionStatus.Running);
    expect(first.startedAt).toBeInstanceOf(Date);
  });

  /*
   * An HTTP request step fills in the runbook variables it names: it is
   * handed the run's context - the project, and the runbook its own
   * variables are read from - as the steps a Runner runs are.
   */
  test("an HTTP request step is handed the run's context, for its variables", async () => {
    runHttpStepMock.mockResolvedValue({ success: true, output: "ok" });

    const step: RunbookStepExecutionState = pending(
      makeStep(RunbookStepType.HttpRequest),
    );

    await run(makeExecution([step]));

    expect(runHttpStepMock).toHaveBeenCalledTimes(1);

    const call: Array<unknown> = runHttpStepMock.mock.calls[0]!;
    const ctx: { projectId?: unknown; runbookId?: unknown } = call[1] as {
      projectId?: unknown;
      runbookId?: unknown;
    };

    expect(call[0]).toEqual(step.step);
    expect(String(ctx.projectId)).toBe(new ObjectID("proj1").toString());
    expect(String(ctx.runbookId)).toBe(new ObjectID("rb1").toString());
  });

  test("a manual step pauses the run as WaitingForManualStep", async () => {
    const manual: RunbookStepExecutionState = pending(
      makeStep(RunbookStepType.Manual),
    );
    const later: RunbookStepExecutionState = pending(
      makeStep(RunbookStepType.HttpRequest),
    );

    const updateSpy: jest.SpyInstance = await run(
      makeExecution([manual, later]),
    );

    expect(manual.status).toBe(RunbookStepExecutionStatus.WaitingForUser);
    expect(later.status).toBe(RunbookStepExecutionStatus.Pending);
    expect(runHttpStepMock).not.toHaveBeenCalled();
    expect(lastStatusUpdate(updateSpy).status).toBe(
      RunbookExecutionStatus.WaitingForManualStep,
    );
  });

  test("successful automated steps run in order and complete the execution", async () => {
    runHttpStepMock.mockResolvedValue({ success: true, output: "http ok" });
    runBashStepMock.mockResolvedValue({ success: true, output: "bash ok" });

    const stepA: RunbookStepExecutionState = pending(
      makeStep(RunbookStepType.HttpRequest),
    );
    const stepB: RunbookStepExecutionState = pending(
      makeStep(RunbookStepType.Bash),
    );

    const updateSpy: jest.SpyInstance = await run(
      makeExecution([stepA, stepB]),
    );

    expect(stepA.status).toBe(RunbookStepExecutionStatus.Completed);
    expect(stepA.output).toBe("http ok");
    expect(stepB.status).toBe(RunbookStepExecutionStatus.Completed);
    expect(stepB.output).toBe("bash ok");

    expect(lastStatusUpdate(updateSpy).status).toBe(
      RunbookExecutionStatus.Completed,
    );
    // The final write stamps completedAt on the execution.
    const updates: Array<UpdateCall> = getUpdates(updateSpy);
    expect(updates[updates.length - 1]!.completedAt).toBeInstanceOf(Date);
  });

  test("a failing step stops the run and records why", async () => {
    runHttpStepMock.mockResolvedValue({
      success: false,
      output: "",
      errorMessage: "HTTP 503",
    });

    const failing: RunbookStepExecutionState = pending(
      makeStep(RunbookStepType.HttpRequest, { title: "Call flaky API" }),
    );
    const never: RunbookStepExecutionState = pending(
      makeStep(RunbookStepType.Bash),
    );

    const updateSpy: jest.SpyInstance = await run(
      makeExecution([failing, never]),
    );

    expect(failing.status).toBe(RunbookStepExecutionStatus.Failed);
    expect(failing.errorMessage).toBe("HTTP 503");
    expect(never.status).toBe(RunbookStepExecutionStatus.Pending);
    expect(runBashStepMock).not.toHaveBeenCalled();

    const last: UpdateCall = lastStatusUpdate(updateSpy);
    expect(last.status).toBe(RunbookExecutionStatus.Failed);
    expect(last.failureReason).toContain("Call flaky API");
    expect(last.failureReason).toContain("HTTP 503");
  });

  test("continueOnFailure lets the run finish despite a failed step", async () => {
    runHttpStepMock.mockResolvedValue({
      success: false,
      output: "",
      errorMessage: "HTTP 500",
    });
    runBashStepMock.mockResolvedValue({ success: true, output: "recovered" });

    const tolerated: RunbookStepExecutionState = pending(
      makeStep(RunbookStepType.HttpRequest, { continueOnFailure: true }),
    );
    const next: RunbookStepExecutionState = pending(
      makeStep(RunbookStepType.Bash),
    );

    const updateSpy: jest.SpyInstance = await run(
      makeExecution([tolerated, next]),
    );

    expect(tolerated.status).toBe(RunbookStepExecutionStatus.Failed);
    expect(next.status).toBe(RunbookStepExecutionStatus.Completed);
    expect(lastStatusUpdate(updateSpy).status).toBe(
      RunbookExecutionStatus.Completed,
    );
  });

  test("requireApproval pauses after a successful step instead of advancing", async () => {
    runHttpStepMock.mockResolvedValue({ success: true, output: "done" });

    const gated: RunbookStepExecutionState = pending(
      makeStep(RunbookStepType.HttpRequest, { requireApproval: true }),
    );
    const next: RunbookStepExecutionState = pending(
      makeStep(RunbookStepType.Bash),
    );

    const updateSpy: jest.SpyInstance = await run(makeExecution([gated, next]));

    expect(gated.status).toBe(RunbookStepExecutionStatus.WaitingForUser);
    expect(gated.output).toBe("done");
    expect(next.status).toBe(RunbookStepExecutionStatus.Pending);
    expect(runBashStepMock).not.toHaveBeenCalled();
    expect(lastStatusUpdate(updateSpy).status).toBe(
      RunbookExecutionStatus.WaitingForManualStep,
    );
  });

  test("a step left Running by a crashed worker is re-executed on resume", async () => {
    /*
     * Crash recovery: a worker that died mid-step leaves it persisted as
     * Running. The loop must treat that like Pending and run it again —
     * treating it as terminal would silently skip the step and complete the
     * runbook without ever doing its work.
     */
    runBashStepMock.mockResolvedValue({ success: true, output: "re-ran" });

    const interrupted: RunbookStepExecutionState = {
      step: makeStep(RunbookStepType.Bash),
      status: RunbookStepExecutionStatus.Running,
      startedAt: new Date().toISOString(),
    };

    const updateSpy: jest.SpyInstance = await run(
      makeExecution([interrupted], {
        status: RunbookExecutionStatus.Running,
        startedAt: new Date(),
      }),
    );

    expect(runBashStepMock).toHaveBeenCalledTimes(1);
    expect(interrupted.status).toBe(RunbookStepExecutionStatus.Completed);
    expect(interrupted.output).toBe("re-ran");
    expect(lastStatusUpdate(updateSpy).status).toBe(
      RunbookExecutionStatus.Completed,
    );
  });

  test("resume skips steps that are already done", async () => {
    runBashStepMock.mockResolvedValue({ success: true, output: "second" });

    const done: RunbookStepExecutionState = {
      step: makeStep(RunbookStepType.HttpRequest),
      status: RunbookStepExecutionStatus.Completed,
      output: "already ran",
    };
    const todo: RunbookStepExecutionState = pending(
      makeStep(RunbookStepType.Bash),
    );

    await run(
      makeExecution([done, todo], {
        status: RunbookExecutionStatus.WaitingForManualStep,
        startedAt: new Date(),
      }),
    );

    expect(runHttpStepMock).not.toHaveBeenCalled();
    expect(runBashStepMock).toHaveBeenCalledTimes(1);
    expect(done.output).toBe("already ran");
    expect(todo.status).toBe(RunbookStepExecutionStatus.Completed);
  });

  test("resume over an already-failed blocking step fails the run without re-running it", async () => {
    const failed: RunbookStepExecutionState = {
      step: makeStep(RunbookStepType.HttpRequest, { title: "Broken" }),
      status: RunbookStepExecutionStatus.Failed,
      errorMessage: "boom",
    };
    const never: RunbookStepExecutionState = pending(
      makeStep(RunbookStepType.Bash),
    );

    const updateSpy: jest.SpyInstance = await run(
      makeExecution([failed, never], { startedAt: new Date() }),
    );

    expect(runHttpStepMock).not.toHaveBeenCalled();
    expect(runBashStepMock).not.toHaveBeenCalled();
    expect(lastStatusUpdate(updateSpy).status).toBe(
      RunbookExecutionStatus.Failed,
    );
  });

  test("resume over an already-failed continueOnFailure step keeps going", async () => {
    runBashStepMock.mockResolvedValue({ success: true, output: "" });

    const failed: RunbookStepExecutionState = {
      step: makeStep(RunbookStepType.HttpRequest, {
        continueOnFailure: true,
      }),
      status: RunbookStepExecutionStatus.Failed,
      errorMessage: "boom",
    };
    const todo: RunbookStepExecutionState = pending(
      makeStep(RunbookStepType.Bash),
    );

    const updateSpy: jest.SpyInstance = await run(
      makeExecution([failed, todo], { startedAt: new Date() }),
    );

    expect(runBashStepMock).toHaveBeenCalledTimes(1);
    expect(lastStatusUpdate(updateSpy).status).toBe(
      RunbookExecutionStatus.Completed,
    );
  });

  test("a run that turns terminal mid-flight stops at the next step boundary", async () => {
    /*
     * Nothing can interrupt a step that is already running, so a cancel — or
     * the stuck-execution sweep failing this run after the Worker went quiet —
     * lands while step one is in flight. The step array held in memory is
     * stale by then: carrying on would write the Cancelled steps back as
     * Pending and keep dispatching scripts for a run the operator was told
     * had stopped.
     */
    runBashStepMock.mockResolvedValue({ success: true, output: "first" });

    const first: RunbookStepExecutionState = pending(
      makeStep(RunbookStepType.Bash),
    );
    const second: RunbookStepExecutionState = pending(
      makeStep(RunbookStepType.Bash),
    );
    const execution: RunbookExecution = makeExecution([first, second], {
      status: RunbookExecutionStatus.Running,
      startedAt: new Date(),
    });

    jest
      .spyOn(RunbookExecutionService, "findOneById")
      .mockResolvedValueOnce(execution)
      .mockResolvedValueOnce(execution)
      .mockResolvedValueOnce({
        status: RunbookExecutionStatus.Cancelled,
      } as unknown as RunbookExecution);
    const updateSpy: jest.SpyInstance = jest
      .spyOn(RunbookExecutionService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await new RunRunbook().runExecution({
      runbookExecutionId: new ObjectID("exec1"),
    });

    expect(runBashStepMock).toHaveBeenCalledTimes(1);
    expect(second.status).toBe(RunbookStepExecutionStatus.Pending);
    expect(lastStatusUpdate(updateSpy).status).not.toBe(
      RunbookExecutionStatus.Completed,
    );
  });

  test("an execution that vanishes mid-run stops rather than writing to a deleted row", async () => {
    runBashStepMock.mockResolvedValue({ success: true, output: "first" });

    const first: RunbookStepExecutionState = pending(
      makeStep(RunbookStepType.Bash),
    );
    const second: RunbookStepExecutionState = pending(
      makeStep(RunbookStepType.Bash),
    );
    const execution: RunbookExecution = makeExecution([first, second], {
      status: RunbookExecutionStatus.Running,
      startedAt: new Date(),
    });

    jest
      .spyOn(RunbookExecutionService, "findOneById")
      .mockResolvedValueOnce(execution)
      .mockResolvedValueOnce(execution)
      .mockResolvedValueOnce(null);
    jest
      .spyOn(RunbookExecutionService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await new RunRunbook().runExecution({
      runbookExecutionId: new ObjectID("exec1"),
    });

    expect(runBashStepMock).toHaveBeenCalledTimes(1);
    expect(second.status).toBe(RunbookStepExecutionStatus.Pending);
  });

  test("skipped steps count as done", async () => {
    const skipped: RunbookStepExecutionState = {
      step: makeStep(RunbookStepType.Manual),
      status: RunbookStepExecutionStatus.Skipped,
    };

    const updateSpy: jest.SpyInstance = await run(
      makeExecution([skipped], { startedAt: new Date() }),
    );

    expect(lastStatusUpdate(updateSpy).status).toBe(
      RunbookExecutionStatus.Completed,
    );
  });

  test("an executor that throws marks the step failed with the thrown message", async () => {
    runHttpStepMock.mockRejectedValue(new Error("executor exploded"));

    const step: RunbookStepExecutionState = pending(
      makeStep(RunbookStepType.HttpRequest),
    );

    const updateSpy: jest.SpyInstance = await run(makeExecution([step]));

    expect(step.status).toBe(RunbookStepExecutionStatus.Failed);
    expect(step.errorMessage).toBe("executor exploded");
    expect(lastStatusUpdate(updateSpy).status).toBe(
      RunbookExecutionStatus.Failed,
    );
  });

  test("an unknown step type fails the step instead of crashing the run", async () => {
    const weird: RunbookStepExecutionState = pending(
      makeStep("Quantum" as RunbookStepType),
    );

    const updateSpy: jest.SpyInstance = await run(makeExecution([weird]));

    expect(weird.status).toBe(RunbookStepExecutionStatus.Failed);
    expect(weird.errorMessage).toContain("Unknown step type");
    expect(lastStatusUpdate(updateSpy).status).toBe(
      RunbookExecutionStatus.Failed,
    );
  });

  test("a ResourceCommand step is never run by the Worker", async () => {
    /*
     * ResourceCommand belongs to an infrastructure resource's own AI agent.
     * A runbook row that somehow names it (it is never offered by the
     * editor) fails instead of reaching any executor.
     */
    const resourceStep: RunbookStepExecutionState = pending(
      makeStep(RunbookStepType.ResourceCommand),
    );

    const updateSpy: jest.SpyInstance = await run(
      makeExecution([resourceStep]),
    );

    expect(resourceStep.status).toBe(RunbookStepExecutionStatus.Failed);
    expect(resourceStep.errorMessage).toContain(
      "Unknown step type: ResourceCommand",
    );
    expect(runBashStepMock).not.toHaveBeenCalled();
    expect(runHttpStepMock).not.toHaveBeenCalled();
    expect(runAiStepMock).not.toHaveBeenCalled();
    expect(lastStatusUpdate(updateSpy).status).toBe(
      RunbookExecutionStatus.Failed,
    );
  });

  test("AI steps receive the trigger identifiers and everything about earlier steps", async () => {
    runHttpStepMock.mockResolvedValue({ success: true, output: "first out" });
    runAiStepMock.mockResolvedValue({ success: true, output: "analysis" });

    const first: RunbookStepExecutionState = pending(
      makeStep(RunbookStepType.HttpRequest),
    );
    const ai: RunbookStepExecutionState = pending(makeStep(RunbookStepType.AI));

    const incidentId: ObjectID = new ObjectID("inc1");
    const userId: ObjectID = new ObjectID("user1");

    const updateSpy: jest.SpyInstance = await run(
      makeExecution([first, ai], {
        incidentId,
        triggeredByUserId: userId,
      }),
    );

    expect(runAiStepMock).toHaveBeenCalledTimes(1);
    const ctx: Record<string, unknown> = runAiStepMock.mock
      .calls[0]![1] as Record<string, unknown>;

    expect((ctx["incidentId"] as ObjectID).toString()).toBe(
      incidentId.toString(),
    );
    expect((ctx["triggeredByUserId"] as ObjectID).toString()).toBe(
      userId.toString(),
    );
    expect(ctx["runbookName"]).toBe("Test Runbook");

    const previous: Array<RunbookStepExecutionState> = ctx[
      "previousStepExecutions"
    ] as Array<RunbookStepExecutionState>;
    expect(previous).toHaveLength(1);
    expect(previous[0]!.output).toBe("first out");
    expect(previous[0]!.status).toBe(RunbookStepExecutionStatus.Completed);

    expect(ai.status).toBe(RunbookStepExecutionStatus.Completed);
    expect(ai.output).toBe("analysis");
    expect(lastStatusUpdate(updateSpy).status).toBe(
      RunbookExecutionStatus.Completed,
    );
  });

  test("a failing AI step behaves like any automated failure", async () => {
    runAiStepMock.mockResolvedValue({
      success: false,
      output: "",
      errorMessage: "No LLM provider configured for this project.",
    });

    const ai: RunbookStepExecutionState = pending(
      makeStep(RunbookStepType.AI, { title: "Analyze" }),
    );

    const updateSpy: jest.SpyInstance = await run(makeExecution([ai]));

    expect(ai.status).toBe(RunbookStepExecutionStatus.Failed);
    expect(ai.errorMessage).toContain("No LLM provider configured");

    const last: UpdateCall = lastStatusUpdate(updateSpy);
    expect(last.status).toBe(RunbookExecutionStatus.Failed);
    expect(last.failureReason).toContain("Analyze");
  });

  test("a run resumed after an approval picks up from Scheduled and leaves a step skipped ahead of time alone", async () => {
    /*
     * What the step routes hand the loop when a person approves the step the
     * run was paused on: that step Completed, a later automated step skipped
     * ahead of time, and the execution queued again as Scheduled. It has run
     * before, so startedAt is already set.
     */
    runHttpStepMock.mockResolvedValue({ success: true, output: "posted" });

    const approved: RunbookStepExecutionState = {
      step: makeStep(RunbookStepType.Manual),
      status: RunbookStepExecutionStatus.Completed,
    };
    const skippedAhead: RunbookStepExecutionState = {
      step: makeStep(RunbookStepType.Bash),
      status: RunbookStepExecutionStatus.Skipped,
    };
    const next: RunbookStepExecutionState = pending(
      makeStep(RunbookStepType.HttpRequest),
    );

    const updateSpy: jest.SpyInstance = await run(
      makeExecution([approved, skippedAhead, next], {
        status: RunbookExecutionStatus.Scheduled,
        startedAt: new Date(),
      }),
    );

    const first: UpdateCall = getUpdates(updateSpy)[0]!;
    expect(first.status).toBe(RunbookExecutionStatus.Running);
    expect(first.startedAt).toBeUndefined();

    expect(runBashStepMock).not.toHaveBeenCalled();
    expect(skippedAhead.status).toBe(RunbookStepExecutionStatus.Skipped);
    expect(runHttpStepMock).toHaveBeenCalledTimes(1);
    expect(next.status).toBe(RunbookStepExecutionStatus.Completed);
    expect(lastStatusUpdate(updateSpy).status).toBe(
      RunbookExecutionStatus.Completed,
    );
  });

  test("a resumed run stops again at the next gate it reaches", async () => {
    /*
     * The gate the routes refuse to pre-approve: still Pending when the run
     * is resumed past the step before it, so the loop pauses on it.
     */
    const approved: RunbookStepExecutionState = {
      step: makeStep(RunbookStepType.Manual),
      status: RunbookStepExecutionStatus.Completed,
    };
    const l2Approval: RunbookStepExecutionState = pending(
      makeStep(RunbookStepType.Manual, { title: "L2 approval" }),
    );
    const remediation: RunbookStepExecutionState = pending(
      makeStep(RunbookStepType.Bash),
    );

    const updateSpy: jest.SpyInstance = await run(
      makeExecution([approved, l2Approval, remediation], {
        status: RunbookExecutionStatus.Scheduled,
        startedAt: new Date(),
      }),
    );

    expect(l2Approval.status).toBe(RunbookStepExecutionStatus.WaitingForUser);
    expect(remediation.status).toBe(RunbookStepExecutionStatus.Pending);
    expect(runBashStepMock).not.toHaveBeenCalled();
    expect(lastStatusUpdate(updateSpy).status).toBe(
      RunbookExecutionStatus.WaitingForManualStep,
    );
  });

  test("a WaitingForUser step on resume re-persists the pause and stops", async () => {
    const waiting: RunbookStepExecutionState = {
      step: makeStep(RunbookStepType.Manual),
      status: RunbookStepExecutionStatus.WaitingForUser,
    };
    const later: RunbookStepExecutionState = pending(
      makeStep(RunbookStepType.Bash),
    );

    const updateSpy: jest.SpyInstance = await run(
      makeExecution([waiting, later], {
        status: RunbookExecutionStatus.WaitingForManualStep,
        startedAt: new Date(),
      }),
    );

    expect(runBashStepMock).not.toHaveBeenCalled();
    expect(lastStatusUpdate(updateSpy).status).toBe(
      RunbookExecutionStatus.WaitingForManualStep,
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * A run that ends while one of its steps is in flight.
 *
 * Cancel Execution writes the run Cancelled and its unfinished steps
 * Cancelled while a step may still be running - on the Worker (an HTTP or AI
 * step) or on a Runner, whose job the cancel marks Cancelled too. The
 * stuck-execution sweep can fail a run the same way. The loop used to write
 * the step's result straight back when the step returned: the status
 * Running and its own copy of the steps, so the cancelled steps were Pending
 * again and it went on to run them. A run cancelled during an HTTP step
 * finished Completed; one cancelled during a Runner step came back Failed,
 * because the cancelled job reads as a failed step.
 *
 * These tests keep the row the way the database would - every write lands
 * on it, every read sees it - so a write that revives a finished run is seen
 * here, which mocks answering the same row each time cannot show.
 * ---------------------------------------------------------------------------
 */

interface StoredRow {
  status: RunbookExecutionStatus;
  stepExecutions: Array<RunbookStepExecutionState>;
  failureReason?: string | undefined;
  startedAt?: Date | undefined;
  completedAt?: Date | undefined;
}

const SWEEP_REASON: string =
  "This runbook execution stopped making progress because the server running it restarted or stopped responding. Run the runbook again to retry it.";

function copyOf<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/*
 * The execution's row, as the database holds it: findOneById reads a copy of
 * it, updateOneById writes onto it.
 */
function storeRow(stepExecutions: Array<RunbookStepExecutionState>): {
  row: StoredRow;
  updateSpy: jest.SpyInstance;
} {
  const row: StoredRow = {
    status: RunbookExecutionStatus.Scheduled,
    stepExecutions: copyOf(stepExecutions),
  };

  jest
    .spyOn(RunbookExecutionService, "findOneById")
    .mockImplementation((async () => {
      return {
        _id: "exec1",
        projectId: new ObjectID("proj1"),
        runbookId: new ObjectID("rb1"),
        runbookNameSnapshot: "Test Runbook",
        ...copyOf(row),
      } as unknown as RunbookExecution;
    }) as never);

  const updateSpy: jest.SpyInstance = jest
    .spyOn(RunbookExecutionService, "updateOneById")
    .mockImplementation((async (args: { data: JSONObject }) => {
      Object.assign(row, copyOf(args.data));
    }) as never);

  return { row, updateSpy };
}

// What the cancel route writes (API/Runbook.ts cancelExecution).
function cancelRow(row: StoredRow): void {
  row.status = RunbookExecutionStatus.Cancelled;
  row.completedAt = new Date();

  for (const stepExecution of row.stepExecutions) {
    if (
      stepExecution.status === RunbookStepExecutionStatus.Pending ||
      stepExecution.status === RunbookStepExecutionStatus.Running ||
      stepExecution.status === RunbookStepExecutionStatus.WaitingForUser
    ) {
      stepExecution.status = RunbookStepExecutionStatus.Cancelled;
    }
  }
}

// What the stuck-execution sweep writes (Jobs/Runbook/TimeoutStuckExecutions).
function sweepRow(row: StoredRow): void {
  row.status = RunbookExecutionStatus.Failed;
  row.failureReason = SWEEP_REASON;
  row.completedAt = new Date();
}

function statusesOf(row: StoredRow): Array<RunbookStepExecutionStatus> {
  return row.stepExecutions.map(
    (stepExecution: RunbookStepExecutionState): RunbookStepExecutionStatus => {
      return stepExecution.status;
    },
  );
}

async function runStored(): Promise<void> {
  await new RunRunbook().runExecution({
    runbookExecutionId: new ObjectID("exec1"),
  });
}

describe("RunRunbook: a run that ends while a step is in flight", () => {
  beforeEach(() => {
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    runHttpStepMock.mockReset();
    runBashStepMock.mockReset();
    runAiStepMock.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a run nobody ends still runs every step and completes (control)", async () => {
    const { row } = storeRow([
      pending(makeStep(RunbookStepType.HttpRequest)),
      pending(makeStep(RunbookStepType.HttpRequest)),
    ]);

    runHttpStepMock.mockResolvedValue({ success: true, output: "ok" });

    await runStored();

    expect(runHttpStepMock).toHaveBeenCalledTimes(2);
    expect(row.status).toBe(RunbookExecutionStatus.Completed);
    expect(statusesOf(row)).toEqual([
      RunbookStepExecutionStatus.Completed,
      RunbookStepExecutionStatus.Completed,
    ]);
  });

  test("cancelled during a Worker step: it stays Cancelled and no later step runs", async () => {
    const { row, updateSpy } = storeRow([
      pending(makeStep(RunbookStepType.HttpRequest)),
      pending(makeStep(RunbookStepType.HttpRequest)),
      pending(makeStep(RunbookStepType.HttpRequest)),
    ]);
    let writesBeforeCancel: number = 0;

    runHttpStepMock.mockImplementation(async () => {
      writesBeforeCancel = updateSpy.mock.calls.length;
      cancelRow(row);
      return { success: true, output: "HTTP 200" };
    });

    await runStored();

    expect(runHttpStepMock).toHaveBeenCalledTimes(1);
    expect(row.status).toBe(RunbookExecutionStatus.Cancelled);
    expect(statusesOf(row)).toEqual([
      RunbookStepExecutionStatus.Cancelled,
      RunbookStepExecutionStatus.Cancelled,
      RunbookStepExecutionStatus.Cancelled,
    ]);
    // Nothing is written once the run has been cancelled.
    expect(updateSpy.mock.calls.length).toBe(writesBeforeCancel);
  });

  test("cancelled during a Runner step: the cancelled job does not turn the run into Failed", async () => {
    const { row } = storeRow([
      pending(makeStep(RunbookStepType.Bash)),
      pending(makeStep(RunbookStepType.Bash)),
    ]);

    runBashStepMock.mockImplementation(async () => {
      cancelRow(row);
      // What dispatchToAgent returns for the job the cancel marked Cancelled.
      return {
        success: false,
        output: "",
        errorMessage: "Step ended with status Cancelled",
      };
    });

    await runStored();

    expect(runBashStepMock).toHaveBeenCalledTimes(1);
    expect(row.status).toBe(RunbookExecutionStatus.Cancelled);
    expect(row.failureReason).toBeUndefined();
    expect(statusesOf(row)).toEqual([
      RunbookStepExecutionStatus.Cancelled,
      RunbookStepExecutionStatus.Cancelled,
    ]);
  });

  test("cancelled during a step that may fail: Continue on failure does not carry the run on", async () => {
    const { row } = storeRow([
      pending(makeStep(RunbookStepType.Bash, { continueOnFailure: true })),
      pending(makeStep(RunbookStepType.Bash)),
    ]);

    runBashStepMock.mockImplementation(async () => {
      cancelRow(row);
      return {
        success: false,
        output: "",
        errorMessage: "Step ended with status Cancelled",
      };
    });

    await runStored();

    expect(runBashStepMock).toHaveBeenCalledTimes(1);
    expect(row.status).toBe(RunbookExecutionStatus.Cancelled);
  });

  test("cancelled during a step that requires approval: the run is not paused again", async () => {
    const { row } = storeRow([
      pending(makeStep(RunbookStepType.HttpRequest, { requireApproval: true })),
      pending(makeStep(RunbookStepType.HttpRequest)),
    ]);

    runHttpStepMock.mockImplementation(async () => {
      cancelRow(row);
      return { success: true, output: "HTTP 200" };
    });

    await runStored();

    expect(runHttpStepMock).toHaveBeenCalledTimes(1);
    expect(row.status).toBe(RunbookExecutionStatus.Cancelled);
    expect(statusesOf(row)).not.toContain(
      RunbookStepExecutionStatus.WaitingForUser,
    );
  });

  test("cancelled during an AI step: it stays Cancelled", async () => {
    const { row } = storeRow([
      pending(makeStep(RunbookStepType.AI)),
      pending(makeStep(RunbookStepType.HttpRequest)),
    ]);

    runAiStepMock.mockImplementation(async () => {
      cancelRow(row);
      return { success: true, output: "Looks safe to fail over." };
    });

    await runStored();

    expect(runAiStepMock).toHaveBeenCalledTimes(1);
    expect(runHttpStepMock).not.toHaveBeenCalled();
    expect(row.status).toBe(RunbookExecutionStatus.Cancelled);
  });

  test("failed by the stuck-execution sweep during a step: the sweep's reason stands", async () => {
    const { row } = storeRow([
      pending(makeStep(RunbookStepType.HttpRequest)),
      pending(makeStep(RunbookStepType.HttpRequest)),
    ]);

    runHttpStepMock.mockImplementation(async () => {
      sweepRow(row);
      return { success: true, output: "HTTP 200" };
    });

    await runStored();

    expect(runHttpStepMock).toHaveBeenCalledTimes(1);
    expect(row.status).toBe(RunbookExecutionStatus.Failed);
    expect(row.failureReason).toBe(SWEEP_REASON);
  });

  test("a run cancelled while it waits on a person is not touched when the Worker picks it up", async () => {
    const { row, updateSpy } = storeRow([
      pending(makeStep(RunbookStepType.Manual)),
      pending(makeStep(RunbookStepType.HttpRequest)),
    ]);

    // The run reaches the Manual step and pauses.
    await runStored();
    expect(row.status).toBe(RunbookExecutionStatus.WaitingForManualStep);

    // Cancelled while paused; a stray redelivery then reaches the Worker.
    cancelRow(row);
    const writes: number = updateSpy.mock.calls.length;

    await runStored();

    expect(runHttpStepMock).not.toHaveBeenCalled();
    expect(row.status).toBe(RunbookExecutionStatus.Cancelled);
    expect(updateSpy.mock.calls.length).toBe(writes);
  });
});

/*
 * ---------------------------------------------------------------------------
 * A STEP ASKS FOR APPROVAL BEFORE IT RUNS.
 *
 * "Require approval before running this step" (requireApprovalBeforeRunning)
 * stops the run before the step - nothing of it runs, no Runner is handed its
 * job - until someone approves it (it then runs) or skips it (it never runs).
 * The person's decision is written the way the step routes write it
 * (applyRunbookStepAction) and the run queued again as Scheduled; the Worker
 * then picks it up, here by running the loop again over the stored row.
 *
 * Runs started before approvals moved keep their copy of the steps, with the
 * old requireApproval ("after this step"): they still stop after such a step
 * - one waiting at the upgrade is approved as before and goes on to the next
 * step without asking again. Runs started now from a runbook still saved the
 * old way take its steps as RunbookStarter reads them, so they stop before
 * the next step: the same point in the run.
 * ---------------------------------------------------------------------------
 */

const APPROVER_ID: string = "30000000-0000-4000-8000-0000000000c1";

// What the step routes write for a person's decision, and the run queued again.
function decideStep(
  row: StoredRow,
  index: number,
  action: RunbookStepAction,
): void {
  applyRunbookStepAction({
    stepExecution: row.stepExecutions[index]!,
    action,
    at: new Date(),
    userId: APPROVER_ID,
  });
  row.status = RunbookExecutionStatus.Scheduled;
}

function asks(
  type: RunbookStepType,
  overrides: Partial<RunbookStep> = {},
): RunbookStep {
  return makeStep(type, { requireApprovalBeforeRunning: true, ...overrides });
}

describe("RunRunbook: a step that asks for approval before it runs", () => {
  beforeEach(() => {
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    runHttpStepMock.mockReset();
    runBashStepMock.mockReset();
    runAiStepMock.mockReset();
    runHttpStepMock.mockResolvedValue({ success: true, output: "HTTP 200" });
    runBashStepMock.mockResolvedValue({ success: true, output: "done" });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the first step: the run stops before anything runs, and the step is not started", async () => {
    const { row } = storeRow([
      pending(asks(RunbookStepType.Bash)),
      pending(makeStep(RunbookStepType.HttpRequest)),
    ]);

    await runStored();

    expect(runBashStepMock).not.toHaveBeenCalled();
    expect(runHttpStepMock).not.toHaveBeenCalled();
    expect(row.status).toBe(RunbookExecutionStatus.WaitingForManualStep);
    expect(statusesOf(row)).toEqual([
      RunbookStepExecutionStatus.WaitingForUser,
      RunbookStepExecutionStatus.Pending,
    ]);
    // Nothing of it ran: no start, no output.
    expect(row.stepExecutions[0]!.startedAt).toBeUndefined();
    expect(row.stepExecutions[0]!.output).toBeUndefined();
    expect(getRunbookStepWait(row.stepExecutions[0])).toBe(
      RunbookStepWait.ApprovalToRun,
    );
  });

  test("a middle step: the steps before it run, then the run stops before it", async () => {
    const { row } = storeRow([
      pending(makeStep(RunbookStepType.HttpRequest)),
      pending(asks(RunbookStepType.Bash)),
      pending(makeStep(RunbookStepType.HttpRequest)),
    ]);

    await runStored();

    expect(runHttpStepMock).toHaveBeenCalledTimes(1);
    expect(runBashStepMock).not.toHaveBeenCalled();
    expect(statusesOf(row)).toEqual([
      RunbookStepExecutionStatus.Completed,
      RunbookStepExecutionStatus.WaitingForUser,
      RunbookStepExecutionStatus.Pending,
    ]);
    expect(row.status).toBe(RunbookExecutionStatus.WaitingForManualStep);
  });

  test("the last step: every step before it runs, and the run waits before it finishes", async () => {
    const { row } = storeRow([
      pending(makeStep(RunbookStepType.HttpRequest)),
      pending(asks(RunbookStepType.Bash)),
    ]);

    await runStored();

    expect(runHttpStepMock).toHaveBeenCalledTimes(1);
    expect(runBashStepMock).not.toHaveBeenCalled();
    expect(row.status).toBe(RunbookExecutionStatus.WaitingForManualStep);
    expect(row.completedAt).toBeUndefined();
  });

  test("approved, it runs - its Runner gets the job only now - and the run goes on to the end", async () => {
    const { row } = storeRow([
      pending(makeStep(RunbookStepType.HttpRequest)),
      pending(asks(RunbookStepType.Bash)),
      pending(makeStep(RunbookStepType.HttpRequest)),
    ]);

    await runStored();
    expect(runBashStepMock).not.toHaveBeenCalled();

    decideStep(row, 1, RunbookStepAction.Complete);
    expect(row.stepExecutions[1]!.status).toBe(
      RunbookStepExecutionStatus.Pending,
    );

    await runStored();

    expect(runBashStepMock).toHaveBeenCalledTimes(1);
    expect(runHttpStepMock).toHaveBeenCalledTimes(2);
    expect(row.status).toBe(RunbookExecutionStatus.Completed);
    expect(statusesOf(row)).toEqual([
      RunbookStepExecutionStatus.Completed,
      RunbookStepExecutionStatus.Completed,
      RunbookStepExecutionStatus.Completed,
    ]);
    // Who approved it, and when, stay on the step that ran.
    expect(row.stepExecutions[1]!.approvedByUserId).toBe(APPROVER_ID);
    expect(row.stepExecutions[1]!.approvedAt).toEqual(expect.any(String));
    expect(row.stepExecutions[1]!.output).toBe("done");
    expect(row.stepExecutions[1]!.completedByUserId).toBeUndefined();
  });

  test("skipped, it never runs, and the run goes on without it", async () => {
    const { row } = storeRow([
      pending(asks(RunbookStepType.Bash)),
      pending(makeStep(RunbookStepType.HttpRequest)),
    ]);

    await runStored();
    decideStep(row, 0, RunbookStepAction.Skip);
    await runStored();

    expect(runBashStepMock).not.toHaveBeenCalled();
    expect(runHttpStepMock).toHaveBeenCalledTimes(1);
    expect(statusesOf(row)).toEqual([
      RunbookStepExecutionStatus.Skipped,
      RunbookStepExecutionStatus.Completed,
    ]);
    expect(row.stepExecutions[0]!.completedByUserId).toBe(APPROVER_ID);
    expect(row.status).toBe(RunbookExecutionStatus.Completed);
  });

  test("the last step skipped: the run completes with it never run", async () => {
    const { row } = storeRow([
      pending(makeStep(RunbookStepType.HttpRequest)),
      pending(asks(RunbookStepType.Bash)),
    ]);

    await runStored();
    decideStep(row, 1, RunbookStepAction.Skip);
    await runStored();

    expect(runBashStepMock).not.toHaveBeenCalled();
    expect(row.status).toBe(RunbookExecutionStatus.Completed);
  });

  test("with Continue on failure on the step before: it fails, and the run still stops before the step that asks", async () => {
    runHttpStepMock.mockResolvedValue({
      success: false,
      output: "",
      errorMessage: "HTTP 503",
    });
    const { row } = storeRow([
      pending(
        makeStep(RunbookStepType.HttpRequest, { continueOnFailure: true }),
      ),
      pending(asks(RunbookStepType.Bash)),
    ]);

    await runStored();

    expect(runBashStepMock).not.toHaveBeenCalled();
    expect(statusesOf(row)).toEqual([
      RunbookStepExecutionStatus.Failed,
      RunbookStepExecutionStatus.WaitingForUser,
    ]);
    expect(row.status).toBe(RunbookExecutionStatus.WaitingForManualStep);
  });

  test("with Continue on failure on the step itself: approved, it fails, and the run goes on", async () => {
    runBashStepMock.mockResolvedValue({
      success: false,
      output: "",
      errorMessage: "exit 1",
    });
    const { row } = storeRow([
      pending(asks(RunbookStepType.Bash, { continueOnFailure: true })),
      pending(makeStep(RunbookStepType.HttpRequest)),
    ]);

    await runStored();
    decideStep(row, 0, RunbookStepAction.Complete);
    await runStored();

    expect(runBashStepMock).toHaveBeenCalledTimes(1);
    expect(runHttpStepMock).toHaveBeenCalledTimes(1);
    expect(statusesOf(row)).toEqual([
      RunbookStepExecutionStatus.Failed,
      RunbookStepExecutionStatus.Completed,
    ]);
    expect(row.status).toBe(RunbookExecutionStatus.Completed);
  });

  test("approved without Continue on failure, it fails: the run fails with its reason", async () => {
    runBashStepMock.mockResolvedValue({
      success: false,
      output: "",
      errorMessage: "exit 1",
    });
    const { row } = storeRow([
      pending(asks(RunbookStepType.Bash, { title: "Restart checkout" })),
      pending(makeStep(RunbookStepType.HttpRequest)),
    ]);

    await runStored();
    decideStep(row, 0, RunbookStepAction.Complete);
    await runStored();

    expect(runHttpStepMock).not.toHaveBeenCalled();
    expect(row.status).toBe(RunbookExecutionStatus.Failed);
    expect(row.failureReason).toBe('Step "Restart checkout" failed: exit 1');
  });

  test("with Manual steps: each stop in its turn - the Manual step, then the approval, then the next Manual step", async () => {
    const { row } = storeRow([
      pending(makeStep(RunbookStepType.Manual)),
      pending(asks(RunbookStepType.Bash)),
      pending(makeStep(RunbookStepType.Manual)),
      pending(makeStep(RunbookStepType.HttpRequest)),
    ]);

    await runStored();
    expect(statusesOf(row)[0]).toBe(RunbookStepExecutionStatus.WaitingForUser);
    expect(getRunbookStepWait(row.stepExecutions[0])).toBe(
      RunbookStepWait.Manual,
    );

    decideStep(row, 0, RunbookStepAction.Complete);
    await runStored();
    expect(runBashStepMock).not.toHaveBeenCalled();
    expect(getRunbookStepWait(row.stepExecutions[1])).toBe(
      RunbookStepWait.ApprovalToRun,
    );

    decideStep(row, 1, RunbookStepAction.Complete);
    await runStored();
    expect(runBashStepMock).toHaveBeenCalledTimes(1);
    expect(getRunbookStepWait(row.stepExecutions[2])).toBe(
      RunbookStepWait.Manual,
    );
    expect(runHttpStepMock).not.toHaveBeenCalled();

    decideStep(row, 2, RunbookStepAction.Complete);
    await runStored();
    expect(runHttpStepMock).toHaveBeenCalledTimes(1);
    expect(row.status).toBe(RunbookExecutionStatus.Completed);
  });

  test("two steps in a row that ask: the run stops before each", async () => {
    const { row } = storeRow([
      pending(asks(RunbookStepType.Bash)),
      pending(asks(RunbookStepType.HttpRequest)),
    ]);

    await runStored();
    decideStep(row, 0, RunbookStepAction.Complete);
    await runStored();

    expect(runBashStepMock).toHaveBeenCalledTimes(1);
    expect(runHttpStepMock).not.toHaveBeenCalled();
    expect(getRunbookStepWait(row.stepExecutions[1])).toBe(
      RunbookStepWait.ApprovalToRun,
    );

    decideStep(row, 1, RunbookStepAction.Complete);
    await runStored();

    expect(runHttpStepMock).toHaveBeenCalledTimes(1);
    expect(row.status).toBe(RunbookExecutionStatus.Completed);
  });

  test("the flag on a Manual step stops it once, as a Manual step", async () => {
    const { row } = storeRow([
      pending(asks(RunbookStepType.Manual)),
      pending(makeStep(RunbookStepType.HttpRequest)),
    ]);

    await runStored();
    expect(getRunbookStepWait(row.stepExecutions[0])).toBe(
      RunbookStepWait.Manual,
    );

    decideStep(row, 0, RunbookStepAction.Complete);
    expect(row.stepExecutions[0]!.status).toBe(
      RunbookStepExecutionStatus.Completed,
    );
    await runStored();

    expect(runHttpStepMock).toHaveBeenCalledTimes(1);
    expect(row.status).toBe(RunbookExecutionStatus.Completed);
  });

  test("a redelivered run waiting for an approval stays waiting, and nothing runs", async () => {
    const { row, updateSpy } = storeRow([
      pending(asks(RunbookStepType.Bash)),
      pending(makeStep(RunbookStepType.HttpRequest)),
    ]);

    await runStored();
    const writes: number = updateSpy.mock.calls.length;

    // The Worker is handed the same run again while it still waits.
    await runStored();

    expect(runBashStepMock).not.toHaveBeenCalled();
    expect(row.status).toBe(RunbookExecutionStatus.WaitingForManualStep);
    expect(statusesOf(row)[0]).toBe(RunbookStepExecutionStatus.WaitingForUser);
    expect(updateSpy.mock.calls.length).toBeGreaterThan(writes);
  });

  test("a run cancelled while it waits for an approval is not touched when the Worker picks it up", async () => {
    const { row, updateSpy } = storeRow([
      pending(asks(RunbookStepType.Bash)),
      pending(makeStep(RunbookStepType.HttpRequest)),
    ]);

    await runStored();
    cancelRow(row);
    const writes: number = updateSpy.mock.calls.length;

    await runStored();

    expect(runBashStepMock).not.toHaveBeenCalled();
    expect(row.status).toBe(RunbookExecutionStatus.Cancelled);
    expect(updateSpy.mock.calls.length).toBe(writes);
  });

  test("a step approved before a Worker crashed mid-step runs again on resume without asking again", async () => {
    const approved: RunbookStepExecutionState = {
      step: asks(RunbookStepType.Bash),
      status: RunbookStepExecutionStatus.Running,
      approvedAt: "2026-10-20T10:00:00.000Z",
      approvedByUserId: APPROVER_ID,
    };
    const { row } = storeRow([approved]);

    await runStored();

    expect(runBashStepMock).toHaveBeenCalledTimes(1);
    expect(row.status).toBe(RunbookExecutionStatus.Completed);
  });
});

describe("RunRunbook: runs started before approvals moved, and runbooks still saved the old way", () => {
  beforeEach(() => {
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    runHttpStepMock.mockReset();
    runBashStepMock.mockReset();
    runAiStepMock.mockReset();
    runHttpStepMock.mockResolvedValue({ success: true, output: "HTTP 200" });
    runBashStepMock.mockResolvedValue({ success: true, output: "done" });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a run started before: its old approval after a step still stops it after that step, and approving it goes on without asking again", async () => {
    const { row } = storeRow([
      pending(makeStep(RunbookStepType.HttpRequest, { requireApproval: true })),
      pending(makeStep(RunbookStepType.Bash)),
    ]);

    await runStored();

    // The step ran, then the run stopped - as it always did.
    expect(runHttpStepMock).toHaveBeenCalledTimes(1);
    expect(runBashStepMock).not.toHaveBeenCalled();
    expect(row.stepExecutions[0]!.output).toBe("HTTP 200");
    expect(getRunbookStepWait(row.stepExecutions[0])).toBe(
      RunbookStepWait.ApprovalToContinue,
    );

    decideStep(row, 0, RunbookStepAction.Complete);
    expect(row.stepExecutions[0]!.status).toBe(
      RunbookStepExecutionStatus.Completed,
    );
    await runStored();

    expect(runHttpStepMock).toHaveBeenCalledTimes(1);
    expect(runBashStepMock).toHaveBeenCalledTimes(1);
    expect(row.status).toBe(RunbookExecutionStatus.Completed);
  });

  test("a run waiting for the old approval at the upgrade: approved after it, it goes on to the next step and finishes", async () => {
    // The row as the old loop left it: the step ran and waits for approval.
    const { row } = storeRow([
      {
        step: makeStep(RunbookStepType.AI, { requireApproval: true }),
        status: RunbookStepExecutionStatus.WaitingForUser,
        startedAt: "2026-10-20T09:00:00.000Z",
        completedAt: "2026-10-20T09:00:05.000Z",
        output: "PROCEED: the replica is healthy.",
      },
      pending(makeStep(RunbookStepType.Bash)),
      pending(makeStep(RunbookStepType.HttpRequest)),
    ]);
    row.status = RunbookExecutionStatus.WaitingForManualStep;

    decideStep(row, 0, RunbookStepAction.Complete);
    await runStored();

    expect(runAiStepMock).not.toHaveBeenCalled();
    expect(runBashStepMock).toHaveBeenCalledTimes(1);
    expect(runHttpStepMock).toHaveBeenCalledTimes(1);
    expect(statusesOf(row)).toEqual([
      RunbookStepExecutionStatus.Completed,
      RunbookStepExecutionStatus.Completed,
      RunbookStepExecutionStatus.Completed,
    ]);
    expect(row.status).toBe(RunbookExecutionStatus.Completed);
  });

  test("a run started now from a runbook still saved the old way stops at the same point: before the step its approval held back", async () => {
    const saved: Array<RunbookStep> = [
      { ...makeStep(RunbookStepType.HttpRequest), requireApproval: true },
      makeStep(RunbookStepType.Bash),
    ];
    saved[0]!.order = 0;
    saved[1]!.order = 1;

    const { row } = storeRow(RunbookStarterClass.getStepExecutions(saved));

    // Nothing of the old flag is left in the run's copy of the steps.
    expect(JSON.stringify(row.stepExecutions)).not.toContain(
      '"requireApproval"',
    );

    await runStored();

    expect(runHttpStepMock).toHaveBeenCalledTimes(1);
    expect(runBashStepMock).not.toHaveBeenCalled();
    expect(getRunbookStepWait(row.stepExecutions[1])).toBe(
      RunbookStepWait.ApprovalToRun,
    );

    decideStep(row, 1, RunbookStepAction.Complete);
    await runStored();

    expect(runBashStepMock).toHaveBeenCalledTimes(1);
    expect(row.status).toBe(RunbookExecutionStatus.Completed);
  });

  test("a runbook whose last step asked for approval after it: the run waits at the end on 'Approve the result', then completes", async () => {
    const saved: Array<RunbookStep> = [
      { ...makeStep(RunbookStepType.HttpRequest), requireApproval: true },
    ];
    saved[0]!.order = 0;

    const { row } = storeRow(RunbookStarterClass.getStepExecutions(saved));

    expect(row.stepExecutions).toHaveLength(2);
    expect(row.stepExecutions[1]!.step.title).toBe(
      APPROVAL_AFTER_LAST_STEP_TITLE,
    );

    await runStored();

    expect(runHttpStepMock).toHaveBeenCalledTimes(1);
    expect(row.status).toBe(RunbookExecutionStatus.WaitingForManualStep);
    expect(row.completedAt).toBeUndefined();
    expect(getRunbookStepWait(row.stepExecutions[1])).toBe(
      RunbookStepWait.Manual,
    );

    decideStep(row, 1, RunbookStepAction.Complete);
    await runStored();

    expect(row.status).toBe(RunbookExecutionStatus.Completed);
  });
});
