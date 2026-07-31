import { RunbookStep } from "../../../Types/Runbook/RunbookStep";
import { RunbookStepExecutionState } from "../../../Types/Runbook/RunbookStepExecution";
import RunbookStepExecutionStatus from "../../../Types/Runbook/RunbookStepExecutionStatus";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import {
  STUCK_EXECUTION_GRACE_IN_MS,
  UNBOUNDED_STEP_ALLOWANCE_IN_MS,
  getRunningExecutionDeadline,
  getStepMaxRuntimeInMs,
} from "../../../Types/Runbook/RunbookExecutionDeadline";
import {
  DEFAULT_AGENT_CLAIM_TIMEOUT_IN_MS,
  DEFAULT_STEP_EXECUTION_TIMEOUT_IN_MS,
  MAX_STEP_EXECUTION_TIMEOUT_IN_MS,
  MIN_STEP_EXECUTION_TIMEOUT_IN_MS,
} from "../../../Types/Runbook/RunbookStepTimeout";
import { describe, expect, it } from "@jest/globals";

type MakeStepFunction = (
  type: RunbookStepType,
  config?: Record<string, unknown>,
) => RunbookStep;

const makeStep: MakeStepFunction = (
  type: RunbookStepType,
  config: Record<string, unknown> = {},
): RunbookStep => {
  return {
    id: "step-1",
    order: 1,
    type,
    title: `${type} step`,
    // The union config type is validated per-branch inside the module under test.
    config: config as RunbookStep["config"],
  };
};

describe("getStepMaxRuntimeInMs", () => {
  it("sums claim and execution defaults for a Bash step with no config", () => {
    expect(getStepMaxRuntimeInMs(makeStep(RunbookStepType.Bash))).toBe(
      DEFAULT_AGENT_CLAIM_TIMEOUT_IN_MS + DEFAULT_STEP_EXECUTION_TIMEOUT_IN_MS,
    );
  });

  it("sums claim and execution defaults for a JavaScript step with no config", () => {
    expect(getStepMaxRuntimeInMs(makeStep(RunbookStepType.JavaScript))).toBe(
      DEFAULT_AGENT_CLAIM_TIMEOUT_IN_MS + DEFAULT_STEP_EXECUTION_TIMEOUT_IN_MS,
    );
  });

  it("uses the configured claim and execution timeouts for a Bash step", () => {
    const step: RunbookStep = makeStep(RunbookStepType.Bash, {
      script: "echo hi",
      agentId: "agent-1",
      claimTimeoutInMs: 10_000,
      timeoutInMs: 20_000,
    });
    expect(getStepMaxRuntimeInMs(step)).toBe(30_000);
  });

  it("clamps an over-max execution timeout before summing", () => {
    const step: RunbookStep = makeStep(RunbookStepType.JavaScript, {
      script: "run()",
      agentId: "agent-1",
      claimTimeoutInMs: 5_000,
      timeoutInMs: MAX_STEP_EXECUTION_TIMEOUT_IN_MS + 1_000_000,
    });
    expect(getStepMaxRuntimeInMs(step)).toBe(
      5_000 + MAX_STEP_EXECUTION_TIMEOUT_IN_MS,
    );
  });

  it("clamps a below-min execution timeout up to the minimum", () => {
    const step: RunbookStep = makeStep(RunbookStepType.HttpRequest, {
      url: "https://example.com",
      method: "GET",
      timeoutInMs: 1,
    });
    expect(getStepMaxRuntimeInMs(step)).toBe(MIN_STEP_EXECUTION_TIMEOUT_IN_MS);
  });

  it("uses only the execution timeout for an HttpRequest step (no claim window)", () => {
    expect(getStepMaxRuntimeInMs(makeStep(RunbookStepType.HttpRequest))).toBe(
      DEFAULT_STEP_EXECUTION_TIMEOUT_IN_MS,
    );
  });

  it("returns zero for a Manual step (Running is a torn write, not a wait)", () => {
    expect(getStepMaxRuntimeInMs(makeStep(RunbookStepType.Manual))).toBe(0);
  });

  it("returns the unbounded allowance for an AI step whose runtime is not author-bounded", () => {
    expect(getStepMaxRuntimeInMs(makeStep(RunbookStepType.AI))).toBe(
      UNBOUNDED_STEP_ALLOWANCE_IN_MS,
    );
  });

  it("keeps the unbounded allowance equal to the max step execution timeout", () => {
    expect(UNBOUNDED_STEP_ALLOWANCE_IN_MS).toBe(
      MAX_STEP_EXECUTION_TIMEOUT_IN_MS,
    );
  });
});

describe("getRunningExecutionDeadline", () => {
  const executionUpdatedAt: Date = new Date("2026-07-31T12:00:00.000Z");

  type MakeExecutionFunction = (
    status: RunbookStepExecutionStatus,
    step: RunbookStep,
    startedAt?: string,
  ) => RunbookStepExecutionState;

  const makeExecution: MakeExecutionFunction = (
    status: RunbookStepExecutionStatus,
    step: RunbookStep,
    startedAt?: string,
  ): RunbookStepExecutionState => {
    // exactOptionalPropertyTypes: omit startedAt entirely rather than set undefined.
    if (startedAt === undefined) {
      return { step, status };
    }
    return { step, status, startedAt };
  };

  it("returns only the grace margin when no step is Running", () => {
    const deadline: Date = getRunningExecutionDeadline({
      stepExecutions: [
        makeExecution(
          RunbookStepExecutionStatus.Completed,
          makeStep(RunbookStepType.HttpRequest),
        ),
        makeExecution(
          RunbookStepExecutionStatus.Pending,
          makeStep(RunbookStepType.Bash),
        ),
      ],
      executionUpdatedAt,
    });

    expect(deadline.getTime()).toBe(
      executionUpdatedAt.getTime() + STUCK_EXECUTION_GRACE_IN_MS,
    );
  });

  it("returns grace margin for an empty step list", () => {
    const deadline: Date = getRunningExecutionDeadline({
      stepExecutions: [],
      executionUpdatedAt,
    });

    expect(deadline.getTime()).toBe(
      executionUpdatedAt.getTime() + STUCK_EXECUTION_GRACE_IN_MS,
    );
  });

  it("anchors on the running step's startedAt plus its runtime plus grace", () => {
    const startedAt: string = "2026-07-31T11:59:00.000Z";
    const step: RunbookStep = makeStep(RunbookStepType.HttpRequest, {
      url: "https://example.com",
      method: "GET",
      timeoutInMs: 20_000,
    });

    const deadline: Date = getRunningExecutionDeadline({
      stepExecutions: [
        makeExecution(RunbookStepExecutionStatus.Running, step, startedAt),
      ],
      executionUpdatedAt,
    });

    expect(deadline.getTime()).toBe(
      new Date(startedAt).getTime() + 20_000 + STUCK_EXECUTION_GRACE_IN_MS,
    );
  });

  it("falls back to executionUpdatedAt when the running step has no startedAt", () => {
    const step: RunbookStep = makeStep(RunbookStepType.HttpRequest, {
      url: "https://example.com",
      method: "GET",
      timeoutInMs: 20_000,
    });

    const deadline: Date = getRunningExecutionDeadline({
      stepExecutions: [makeExecution(RunbookStepExecutionStatus.Running, step)],
      executionUpdatedAt,
    });

    expect(deadline.getTime()).toBe(
      executionUpdatedAt.getTime() + 20_000 + STUCK_EXECUTION_GRACE_IN_MS,
    );
  });

  it("falls back to executionUpdatedAt when startedAt is unparseable", () => {
    const step: RunbookStep = makeStep(RunbookStepType.Manual);

    const deadline: Date = getRunningExecutionDeadline({
      stepExecutions: [
        makeExecution(
          RunbookStepExecutionStatus.Running,
          step,
          "not-a-real-date",
        ),
      ],
      executionUpdatedAt,
    });

    // Manual runtime is 0, so only the grace margin is added to the fallback anchor.
    expect(deadline.getTime()).toBe(
      executionUpdatedAt.getTime() + STUCK_EXECUTION_GRACE_IN_MS,
    );
  });

  it("picks the first Running step when several exist", () => {
    const runningHttp: RunbookStep = makeStep(RunbookStepType.HttpRequest, {
      url: "https://example.com",
      method: "GET",
      timeoutInMs: 5_000,
    });
    const runningAi: RunbookStep = makeStep(RunbookStepType.AI);
    const startedAt: string = "2026-07-31T11:59:30.000Z";

    const deadline: Date = getRunningExecutionDeadline({
      stepExecutions: [
        makeExecution(
          RunbookStepExecutionStatus.Completed,
          makeStep(RunbookStepType.Manual),
        ),
        makeExecution(
          RunbookStepExecutionStatus.Running,
          runningHttp,
          startedAt,
        ),
        makeExecution(RunbookStepExecutionStatus.Running, runningAi, startedAt),
      ],
      executionUpdatedAt,
    });

    // The HTTP step is found first, so its 5s runtime (not the AI allowance) is used.
    expect(deadline.getTime()).toBe(
      new Date(startedAt).getTime() + 5_000 + STUCK_EXECUTION_GRACE_IN_MS,
    );
  });

  it("gives an AI step the unbounded allowance on top of grace", () => {
    const startedAt: string = "2026-07-31T11:00:00.000Z";
    const deadline: Date = getRunningExecutionDeadline({
      stepExecutions: [
        makeExecution(
          RunbookStepExecutionStatus.Running,
          makeStep(RunbookStepType.AI),
          startedAt,
        ),
      ],
      executionUpdatedAt,
    });

    expect(deadline.getTime()).toBe(
      new Date(startedAt).getTime() +
        UNBOUNDED_STEP_ALLOWANCE_IN_MS +
        STUCK_EXECUTION_GRACE_IN_MS,
    );
  });

  it("keeps the grace margin at five minutes", () => {
    expect(STUCK_EXECUTION_GRACE_IN_MS).toBe(5 * 60 * 1000);
  });
});
