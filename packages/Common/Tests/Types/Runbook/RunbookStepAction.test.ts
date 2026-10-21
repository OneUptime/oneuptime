import RunbookExecutionStatus from "../../../Types/Runbook/RunbookExecutionStatus";
import { RunbookStep } from "../../../Types/Runbook/RunbookStep";
import {
  decideRunbookStepAction,
  getStepAwaitingUser,
  isStepExecutionSettled,
  RunbookStepAction,
  RunbookStepActionDecision,
} from "../../../Types/Runbook/RunbookStepAction";
import { RunbookStepExecutionState } from "../../../Types/Runbook/RunbookStepExecution";
import RunbookStepExecutionStatus from "../../../Types/Runbook/RunbookStepExecutionStatus";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import { describe, expect, test } from "@jest/globals";

/*
 * Regression: complete and skip used to accept any step of a live execution.
 * The execution loop walks past every step already Completed or Skipped, so
 * completing a Manual "L2 approval" step while the run was still paused on
 * step one meant the run never stopped there — the approval gate was gone.
 * These pin who may do what to which step.
 */

type MakeStepFunction = (
  id: string,
  type: RunbookStepType,
  overrides?: Partial<RunbookStep>,
) => RunbookStep;

const makeStep: MakeStepFunction = (
  id: string,
  type: RunbookStepType,
  overrides: Partial<RunbookStep> = {},
): RunbookStep => {
  return {
    id,
    order: 0,
    type,
    title: `Step ${id}`,
    config: {} as RunbookStep["config"],
    ...overrides,
  };
};

function state(
  step: RunbookStep,
  status: RunbookStepExecutionStatus,
): RunbookStepExecutionState {
  return { step, status };
}

type DecideFunction = (
  action: RunbookStepAction,
  executionStatus: RunbookExecutionStatus,
  stepExecutions: Array<RunbookStepExecutionState>,
  stepId: string,
) => RunbookStepActionDecision;

const decide: DecideFunction = (
  action: RunbookStepAction,
  executionStatus: RunbookExecutionStatus,
  stepExecutions: Array<RunbookStepExecutionState>,
  stepId: string,
): RunbookStepActionDecision => {
  return decideRunbookStepAction({
    action,
    executionStatus,
    stepExecutions,
    stepId,
  });
};

function reasonOf(decision: RunbookStepActionDecision): string {
  if (decision.allowed) {
    throw new Error("Expected the action to be refused, but it was allowed");
  }
  return decision.reason;
}

/*
 * Paused on step "check" (a Manual step), with later steps: a Manual
 * "L2 approval", an automated step gated on approval, and a plain automated
 * step. "done" already ran.
 */
function pausedOnManualStep(): Array<RunbookStepExecutionState> {
  return [
    state(
      makeStep("done", RunbookStepType.HttpRequest),
      RunbookStepExecutionStatus.Completed,
    ),
    state(
      makeStep("check", RunbookStepType.Manual, {
        title: "Check the dashboards",
      }),
      RunbookStepExecutionStatus.WaitingForUser,
    ),
    state(
      makeStep("l2", RunbookStepType.Manual, { title: "L2 approval" }),
      RunbookStepExecutionStatus.Pending,
    ),
    state(
      makeStep("restart", RunbookStepType.Bash, {
        title: "Restart the web tier",
        requireApproval: true,
      }),
      RunbookStepExecutionStatus.Pending,
    ),
    state(
      makeStep("notify", RunbookStepType.HttpRequest, {
        title: "Post to Slack",
      }),
      RunbookStepExecutionStatus.Pending,
    ),
  ];
}

describe("getStepAwaitingUser", () => {
  test("is the WaitingForUser step a paused execution stopped on", () => {
    expect(
      getStepAwaitingUser({
        executionStatus: RunbookExecutionStatus.WaitingForManualStep,
        stepExecutions: pausedOnManualStep(),
      })?.step.id,
    ).toBe("check");
  });

  test("walks past a tolerated failure, as the execution loop does", () => {
    const stepExecutions: Array<RunbookStepExecutionState> = [
      state(
        makeStep("flaky", RunbookStepType.HttpRequest, {
          continueOnFailure: true,
        }),
        RunbookStepExecutionStatus.Failed,
      ),
      state(
        makeStep("gate", RunbookStepType.Manual),
        RunbookStepExecutionStatus.WaitingForUser,
      ),
    ];

    expect(
      getStepAwaitingUser({
        executionStatus: RunbookExecutionStatus.WaitingForManualStep,
        stepExecutions,
      })?.step.id,
    ).toBe("gate");
  });

  test.each([
    RunbookExecutionStatus.Scheduled,
    RunbookExecutionStatus.Running,
    RunbookExecutionStatus.Completed,
    RunbookExecutionStatus.Failed,
    RunbookExecutionStatus.Cancelled,
  ])(
    "is nothing while the execution is %s, even with a WaitingForUser step",
    (executionStatus: RunbookExecutionStatus) => {
      expect(
        getStepAwaitingUser({
          executionStatus,
          stepExecutions: pausedOnManualStep(),
        }),
      ).toBeUndefined();
    },
  );

  test("is nothing when an earlier step has not settled — the loop would not stop on the later one", () => {
    const stepExecutions: Array<RunbookStepExecutionState> = [
      state(
        makeStep("first", RunbookStepType.Bash),
        RunbookStepExecutionStatus.Pending,
      ),
      state(
        makeStep("gate", RunbookStepType.Manual),
        RunbookStepExecutionStatus.WaitingForUser,
      ),
    ];

    expect(
      getStepAwaitingUser({
        executionStatus: RunbookExecutionStatus.WaitingForManualStep,
        stepExecutions,
      }),
    ).toBeUndefined();
  });

  test("is nothing behind a blocking failure", () => {
    const stepExecutions: Array<RunbookStepExecutionState> = [
      state(
        makeStep("broken", RunbookStepType.HttpRequest),
        RunbookStepExecutionStatus.Failed,
      ),
      state(
        makeStep("gate", RunbookStepType.Manual),
        RunbookStepExecutionStatus.WaitingForUser,
      ),
    ];

    expect(
      getStepAwaitingUser({
        executionStatus: RunbookExecutionStatus.WaitingForManualStep,
        stepExecutions,
      }),
    ).toBeUndefined();
  });
});

describe("isStepExecutionSettled", () => {
  test.each([
    [RunbookStepExecutionStatus.Completed, false, true],
    [RunbookStepExecutionStatus.Skipped, false, true],
    [RunbookStepExecutionStatus.Failed, true, true],
    [RunbookStepExecutionStatus.Failed, false, false],
    [RunbookStepExecutionStatus.Pending, false, false],
    [RunbookStepExecutionStatus.Running, false, false],
    [RunbookStepExecutionStatus.WaitingForUser, false, false],
  ])(
    "%s (continueOnFailure: %s) settled: %s",
    (
      status: RunbookStepExecutionStatus,
      continueOnFailure: boolean,
      settled: boolean,
    ) => {
      expect(
        isStepExecutionSettled(
          state(
            makeStep("s", RunbookStepType.HttpRequest, { continueOnFailure }),
            status,
          ),
        ),
      ).toBe(settled);
    },
  );
});

describe("completing a step", () => {
  test("the step the execution is paused on can be completed, and that resumes the run", () => {
    expect(
      decide(
        RunbookStepAction.Complete,
        RunbookExecutionStatus.WaitingForManualStep,
        pausedOnManualStep(),
        "check",
      ),
    ).toEqual({ allowed: true, resumesExecution: true });
  });

  test("an approval step that ran and is waiting can be approved, and that resumes the run", () => {
    const stepExecutions: Array<RunbookStepExecutionState> = [
      state(
        makeStep("analyze", RunbookStepType.AI, { requireApproval: true }),
        RunbookStepExecutionStatus.WaitingForUser,
      ),
      state(
        makeStep("remediate", RunbookStepType.Bash),
        RunbookStepExecutionStatus.Pending,
      ),
    ];

    expect(
      decide(
        RunbookStepAction.Complete,
        RunbookExecutionStatus.WaitingForManualStep,
        stepExecutions,
        "analyze",
      ),
    ).toEqual({ allowed: true, resumesExecution: true });
  });

  test("REGRESSION: a later Manual approval step cannot be pre-approved while the run is paused on an earlier one", () => {
    const reason: string = reasonOf(
      decide(
        RunbookStepAction.Complete,
        RunbookExecutionStatus.WaitingForManualStep,
        pausedOnManualStep(),
        "l2",
      ),
    );

    expect(reason).toContain('Step "L2 approval" has not been reached yet');
    expect(reason).toContain('waiting on "Check the dashboards"');
  });

  test("a later requireApproval step cannot be approved before it has run", () => {
    expect(
      reasonOf(
        decide(
          RunbookStepAction.Complete,
          RunbookExecutionStatus.WaitingForManualStep,
          pausedOnManualStep(),
          "restart",
        ),
      ),
    ).toContain("has not been reached yet");
  });

  test("a later plain automated step cannot be marked complete", () => {
    expect(
      decide(
        RunbookStepAction.Complete,
        RunbookExecutionStatus.WaitingForManualStep,
        pausedOnManualStep(),
        "notify",
      ).allowed,
    ).toBe(false);
  });

  test.each([RunbookExecutionStatus.Scheduled, RunbookExecutionStatus.Running])(
    "REGRESSION: nothing can be completed ahead of the run while it is %s",
    (executionStatus: RunbookExecutionStatus) => {
      const stepExecutions: Array<RunbookStepExecutionState> = [
        state(
          makeStep("first", RunbookStepType.Bash),
          executionStatus === RunbookExecutionStatus.Running
            ? RunbookStepExecutionStatus.Running
            : RunbookStepExecutionStatus.Pending,
        ),
        state(
          makeStep("gate", RunbookStepType.Manual, { title: "L2 approval" }),
          RunbookStepExecutionStatus.Pending,
        ),
      ];

      const reason: string = reasonOf(
        decide(
          RunbookStepAction.Complete,
          executionStatus,
          stepExecutions,
          "gate",
        ),
      );

      expect(reason).toContain("has not been reached yet");
      expect(reason).toContain("not waiting on a step right now");
    },
  );

  test("a WaitingForUser step is not completable while the execution is not parked on it", () => {
    /*
     * A Worker re-running a paused execution flips it to Running before it
     * reaches the waiting step and parks it again. Resuming in that window
     * would start a second loop alongside the one already running.
     */
    const stepExecutions: Array<RunbookStepExecutionState> = [
      state(
        makeStep("gate", RunbookStepType.Manual),
        RunbookStepExecutionStatus.WaitingForUser,
      ),
    ];

    expect(
      decide(
        RunbookStepAction.Complete,
        RunbookExecutionStatus.Running,
        stepExecutions,
        "gate",
      ).allowed,
    ).toBe(false);
  });

  test("a step that is already done cannot be completed again", () => {
    expect(
      reasonOf(
        decide(
          RunbookStepAction.Complete,
          RunbookExecutionStatus.WaitingForManualStep,
          pausedOnManualStep(),
          "done",
        ),
      ),
    ).toBe('Step "Step done" is already Completed.');
  });
});

describe("skipping a step", () => {
  test("the step the execution is paused on can be skipped, and that resumes the run", () => {
    expect(
      decide(
        RunbookStepAction.Skip,
        RunbookExecutionStatus.WaitingForManualStep,
        pausedOnManualStep(),
        "check",
      ),
    ).toEqual({ allowed: true, resumesExecution: true });
  });

  test("a later plain automated step can be skipped ahead of time, without resuming the run", () => {
    expect(
      decide(
        RunbookStepAction.Skip,
        RunbookExecutionStatus.WaitingForManualStep,
        pausedOnManualStep(),
        "notify",
      ),
    ).toEqual({ allowed: true, resumesExecution: false });
  });

  test("REGRESSION: a later Manual step cannot be skipped ahead of time", () => {
    expect(
      reasonOf(
        decide(
          RunbookStepAction.Skip,
          RunbookExecutionStatus.WaitingForManualStep,
          pausedOnManualStep(),
          "l2",
        ),
      ),
    ).toContain(
      'Step "L2 approval" is a manual step, so it can only be completed or skipped once the execution reaches it.',
    );
  });

  test("REGRESSION: a later requireApproval step cannot be skipped ahead of time", () => {
    expect(
      reasonOf(
        decide(
          RunbookStepAction.Skip,
          RunbookExecutionStatus.WaitingForManualStep,
          pausedOnManualStep(),
          "restart",
        ),
      ),
    ).toContain('Step "Restart the web tier" requires approval');
  });

  test.each([RunbookExecutionStatus.Scheduled, RunbookExecutionStatus.Running])(
    "a pending automated step cannot be skipped while the execution is %s — the Worker would write over it",
    (executionStatus: RunbookExecutionStatus) => {
      const stepExecutions: Array<RunbookStepExecutionState> = [
        state(
          makeStep("first", RunbookStepType.Bash),
          RunbookStepExecutionStatus.Running,
        ),
        state(
          makeStep("later", RunbookStepType.HttpRequest),
          RunbookStepExecutionStatus.Pending,
        ),
      ];

      expect(
        reasonOf(
          decide(
            RunbookStepAction.Skip,
            executionStatus,
            stepExecutions,
            "later",
          ),
        ),
      ).toContain(
        "can only be skipped ahead of time while the execution is paused",
      );
    },
  );

  test("a step that is running cannot be skipped", () => {
    const stepExecutions: Array<RunbookStepExecutionState> = [
      state(
        makeStep("first", RunbookStepType.Bash),
        RunbookStepExecutionStatus.Running,
      ),
    ];

    expect(
      decide(
        RunbookStepAction.Skip,
        RunbookExecutionStatus.Running,
        stepExecutions,
        "first",
      ).allowed,
    ).toBe(false);
  });

  test("a step that is already done cannot be skipped", () => {
    expect(
      reasonOf(
        decide(
          RunbookStepAction.Skip,
          RunbookExecutionStatus.WaitingForManualStep,
          pausedOnManualStep(),
          "done",
        ),
      ),
    ).toBe('Step "Step done" is already Completed.');
  });

  test("a pending step ahead of the paused step is refused on an inconsistent row", () => {
    /*
     * Cannot come out of the execution loop — everything before the step it
     * stopped on is settled — but a row that says so must not be advanced.
     */
    const stepExecutions: Array<RunbookStepExecutionState> = [
      state(
        makeStep("first", RunbookStepType.Bash),
        RunbookStepExecutionStatus.Pending,
      ),
      state(
        makeStep("gate", RunbookStepType.Manual),
        RunbookStepExecutionStatus.WaitingForUser,
      ),
    ];

    expect(
      decide(
        RunbookStepAction.Skip,
        RunbookExecutionStatus.WaitingForManualStep,
        stepExecutions,
        "first",
      ).allowed,
    ).toBe(false);
    expect(
      decide(
        RunbookStepAction.Skip,
        RunbookExecutionStatus.WaitingForManualStep,
        stepExecutions,
        "gate",
      ).allowed,
    ).toBe(false);
  });
});

describe("either action", () => {
  test.each([
    [RunbookStepAction.Complete, RunbookExecutionStatus.Completed],
    [RunbookStepAction.Complete, RunbookExecutionStatus.Failed],
    [RunbookStepAction.Complete, RunbookExecutionStatus.Cancelled],
    [RunbookStepAction.Skip, RunbookExecutionStatus.Completed],
    [RunbookStepAction.Skip, RunbookExecutionStatus.Failed],
    [RunbookStepAction.Skip, RunbookExecutionStatus.Cancelled],
  ])(
    "%s is refused on a %s execution",
    (action: RunbookStepAction, executionStatus: RunbookExecutionStatus) => {
      expect(
        reasonOf(
          decide(action, executionStatus, pausedOnManualStep(), "check"),
        ),
      ).toBe(`Cannot update step on a ${executionStatus} execution`);
    },
  );

  test.each([RunbookStepAction.Complete, RunbookStepAction.Skip])(
    "%s is refused for a step that is not in the execution",
    (action: RunbookStepAction) => {
      expect(
        reasonOf(
          decide(
            action,
            RunbookExecutionStatus.WaitingForManualStep,
            pausedOnManualStep(),
            "no-such-step",
          ),
        ),
      ).toBe("This step is not part of this execution.");
    },
  );
});

/*
 * A step that asks for approval before it runs (requireApprovalBeforeRunning):
 * the run stops before it, with nothing of it run. Approving it (Complete)
 * lets it run; skipping it keeps it from running. Like a Manual step, it is
 * a stop for a person, so nobody approves or skips it before the run
 * reaches it.
 */
describe("a step that asks for approval before it runs", () => {
  function pausedBeforeApproval(): Array<RunbookStepExecutionState> {
    return [
      state(
        makeStep("diagnose", RunbookStepType.Bash),
        RunbookStepExecutionStatus.Completed,
      ),
      state(
        makeStep("restart", RunbookStepType.Kubernetes, {
          title: "Restart checkout",
          requireApprovalBeforeRunning: true,
        }),
        RunbookStepExecutionStatus.WaitingForUser,
      ),
      state(
        makeStep("notify", RunbookStepType.HttpRequest, {
          title: "Post to Slack",
        }),
        RunbookStepExecutionStatus.Pending,
      ),
    ];
  }

  test("the run waits on it before it runs", () => {
    expect(
      getStepAwaitingUser({
        executionStatus: RunbookExecutionStatus.WaitingForManualStep,
        stepExecutions: pausedBeforeApproval(),
      })?.step.id,
    ).toBe("restart");
  });

  test("approving it (Complete) is allowed, and resumes the run so it runs", () => {
    expect(
      decide(
        RunbookStepAction.Complete,
        RunbookExecutionStatus.WaitingForManualStep,
        pausedBeforeApproval(),
        "restart",
      ),
    ).toEqual({ allowed: true, resumesExecution: true });
  });

  test("skipping it is allowed, and resumes the run without it", () => {
    expect(
      decide(
        RunbookStepAction.Skip,
        RunbookExecutionStatus.WaitingForManualStep,
        pausedBeforeApproval(),
        "restart",
      ),
    ).toEqual({ allowed: true, resumesExecution: true });
  });

  test("a later plain step can be skipped ahead of time while the run waits for the approval", () => {
    expect(
      decide(
        RunbookStepAction.Skip,
        RunbookExecutionStatus.WaitingForManualStep,
        pausedBeforeApproval(),
        "notify",
      ),
    ).toEqual({ allowed: true, resumesExecution: false });
  });

  test("REGRESSION: a later one cannot be approved before the run reaches it", () => {
    const stepExecutions: Array<RunbookStepExecutionState> = [
      state(
        makeStep("check", RunbookStepType.Manual, {
          title: "Check the dashboards",
        }),
        RunbookStepExecutionStatus.WaitingForUser,
      ),
      state(
        makeStep("restart", RunbookStepType.Kubernetes, {
          title: "Restart checkout",
          requireApprovalBeforeRunning: true,
        }),
        RunbookStepExecutionStatus.Pending,
      ),
    ];

    const reason: string = reasonOf(
      decide(
        RunbookStepAction.Complete,
        RunbookExecutionStatus.WaitingForManualStep,
        stepExecutions,
        "restart",
      ),
    );

    expect(reason).toContain(
      'Step "Restart checkout" has not been reached yet',
    );
    expect(reason).toContain('waiting on "Check the dashboards"');
  });

  test("REGRESSION: a later one cannot be skipped ahead of time - its stop would go with it", () => {
    const stepExecutions: Array<RunbookStepExecutionState> = [
      state(
        makeStep("check", RunbookStepType.Manual, {
          title: "Check the dashboards",
        }),
        RunbookStepExecutionStatus.WaitingForUser,
      ),
      state(
        makeStep("restart", RunbookStepType.Kubernetes, {
          title: "Restart checkout",
          requireApprovalBeforeRunning: true,
        }),
        RunbookStepExecutionStatus.Pending,
      ),
      state(
        makeStep("scale", RunbookStepType.Kubernetes, {
          title: "Scale up",
        }),
        RunbookStepExecutionStatus.Pending,
      ),
    ];

    expect(
      reasonOf(
        decide(
          RunbookStepAction.Skip,
          RunbookExecutionStatus.WaitingForManualStep,
          stepExecutions,
          "restart",
        ),
      ),
    ).toBe(
      'Step "Restart checkout" needs approval before it runs, so it can only be approved or skipped once the execution reaches it. This execution is waiting on "Check the dashboards".',
    );
  });

  test("once approved and queued to run, nothing more can be done to it", () => {
    const stepExecutions: Array<RunbookStepExecutionState> =
      pausedBeforeApproval();
    stepExecutions[1] = {
      ...stepExecutions[1]!,
      status: RunbookStepExecutionStatus.Pending,
      approvedAt: "2026-10-20T10:00:00.000Z",
      approvedByUserId: "30000000-0000-4000-8000-0000000000c1",
    };

    for (const action of [RunbookStepAction.Complete, RunbookStepAction.Skip]) {
      expect(
        decide(
          action,
          RunbookExecutionStatus.Scheduled,
          stepExecutions,
          "restart",
        ).allowed,
      ).toBe(false);
    }
  });

  test("while it runs after the approval, it cannot be skipped", () => {
    const stepExecutions: Array<RunbookStepExecutionState> =
      pausedBeforeApproval();
    stepExecutions[1] = {
      ...stepExecutions[1]!,
      status: RunbookStepExecutionStatus.Running,
      approvedAt: "2026-10-20T10:00:00.000Z",
    };

    expect(
      decide(
        RunbookStepAction.Skip,
        RunbookExecutionStatus.Running,
        stepExecutions,
        "restart",
      ).allowed,
    ).toBe(false);
  });

  test("the flag on a Manual step changes nothing: it is a manual step", () => {
    const stepExecutions: Array<RunbookStepExecutionState> = [
      state(
        makeStep("check", RunbookStepType.Manual, {
          title: "Check the dashboards",
        }),
        RunbookStepExecutionStatus.WaitingForUser,
      ),
      state(
        makeStep("l2", RunbookStepType.Manual, {
          title: "L2 approval",
          requireApprovalBeforeRunning: true,
        }),
        RunbookStepExecutionStatus.Pending,
      ),
    ];

    expect(
      reasonOf(
        decide(
          RunbookStepAction.Skip,
          RunbookExecutionStatus.WaitingForManualStep,
          stepExecutions,
          "l2",
        ),
      ),
    ).toContain('Step "L2 approval" is a manual step');
  });
});
