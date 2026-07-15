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
