import RunbookStepExecutionStatus from "Common/Types/Runbook/RunbookStepExecutionStatus";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import { RunbookStep } from "Common/Types/Runbook/RunbookStep";
import { RunbookStepExecutionState } from "Common/Types/Runbook/RunbookStepExecution";
import {
  getRunningExecutionDeadline,
  getStepMaxRuntimeInMs,
  STUCK_EXECUTION_GRACE_IN_MS,
  UNBOUNDED_STEP_ALLOWANCE_IN_MS,
} from "Common/Types/Runbook/RunbookExecutionDeadline";
import {
  DEFAULT_AGENT_CLAIM_TIMEOUT_IN_MS,
  DEFAULT_STEP_EXECUTION_TIMEOUT_IN_MS,
  MAX_AGENT_CLAIM_TIMEOUT_IN_MS,
  MAX_STEP_EXECUTION_TIMEOUT_IN_MS,
} from "Common/Types/Runbook/RunbookStepTimeout";
import { describe, expect, test } from "@jest/globals";

const STEP_STARTED_AT: string = "2026-07-30T10:00:00.000Z";
const EXECUTION_UPDATED_AT: Date = new Date("2026-07-30T09:00:00.000Z");

function makeStep(
  type: RunbookStepType,
  config: Record<string, unknown> = {},
): RunbookStep {
  return {
    id: "step-1",
    order: 1,
    type,
    title: "A step",
    config: config as never,
  };
}

function running(
  step: RunbookStep,
  startedAt?: string,
): RunbookStepExecutionState {
  const state: RunbookStepExecutionState = {
    step,
    status: RunbookStepExecutionStatus.Running,
  };

  if (startedAt) {
    state.startedAt = startedAt;
  }

  return state;
}

describe("getStepMaxRuntimeInMs", () => {
  test.each([RunbookStepType.Bash, RunbookStepType.JavaScript])(
    "%s steps get the claim window plus the execution window",
    (type: RunbookStepType) => {
      /*
       * An agent step spends the claim window waiting to be picked up and the
       * execution window running. Charging it only the execution window would
       * fail live runs that are still legitimately waiting for their agent.
       */
      expect(
        getStepMaxRuntimeInMs(
          makeStep(type, { timeoutInMs: 600_000, claimTimeoutInMs: 900_000 }),
        ),
      ).toBe(1_500_000);
    },
  );

  test.each([RunbookStepType.Bash, RunbookStepType.JavaScript])(
    "%s steps with unset timeouts get the documented defaults",
    (type: RunbookStepType) => {
      expect(getStepMaxRuntimeInMs(makeStep(type))).toBe(
        DEFAULT_AGENT_CLAIM_TIMEOUT_IN_MS +
          DEFAULT_STEP_EXECUTION_TIMEOUT_IN_MS,
      );
    },
  );

  test("an out-of-range timeout is clamped the same way execution clamps it", () => {
    /*
     * Step configs are untyped JSON at rest, so a stored value can sit outside
     * the bounds. The sweep has to use the number the Worker will actually
     * honour, not the one on disk.
     */
    expect(
      getStepMaxRuntimeInMs(
        makeStep(RunbookStepType.Bash, {
          timeoutInMs: 24 * 60 * 60_000,
          claimTimeoutInMs: 24 * 60 * 60_000,
        }),
      ),
    ).toBe(MAX_AGENT_CLAIM_TIMEOUT_IN_MS + MAX_STEP_EXECUTION_TIMEOUT_IN_MS);
  });

  test("HTTP steps get only the execution window — there is no agent to wait for", () => {
    expect(
      getStepMaxRuntimeInMs(
        makeStep(RunbookStepType.HttpRequest, { timeoutInMs: 45_000 }),
      ),
    ).toBe(45_000);
  });

  test("AI steps, whose runtime the author cannot bound, get the ceiling", () => {
    expect(getStepMaxRuntimeInMs(makeStep(RunbookStepType.AI))).toBe(
      UNBOUNDED_STEP_ALLOWANCE_IN_MS,
    );
  });

  test("a Manual step found Running is a torn write, not a wait, so it gets no allowance", () => {
    expect(getStepMaxRuntimeInMs(makeStep(RunbookStepType.Manual))).toBe(0);
  });
});

describe("getRunningExecutionDeadline", () => {
  test("the deadline is the running step's own window plus the grace margin", () => {
    const deadline: Date = getRunningExecutionDeadline({
      stepExecutions: [
        running(
          makeStep(RunbookStepType.Bash, {
            timeoutInMs: 600_000,
            claimTimeoutInMs: 900_000,
          }),
          STEP_STARTED_AT,
        ),
      ],
      executionUpdatedAt: EXECUTION_UPDATED_AT,
    });

    expect(deadline.getTime()).toBe(
      new Date(STEP_STARTED_AT).getTime() +
        1_500_000 +
        STUCK_EXECUTION_GRACE_IN_MS,
    );
  });

  test("an hour-long step is still inside its window forty minutes in", () => {
    /*
     * The regression this guards: one global threshold would kill the
     * legitimate long restores the docs tell people to configure.
     */
    const startedAt: string = "2026-07-30T10:00:00.000Z";
    const fortyMinutesIn: Date = new Date("2026-07-30T10:40:00.000Z");

    const deadline: Date = getRunningExecutionDeadline({
      stepExecutions: [
        running(
          makeStep(RunbookStepType.Bash, {
            timeoutInMs: MAX_STEP_EXECUTION_TIMEOUT_IN_MS,
            claimTimeoutInMs: 60_000,
          }),
          startedAt,
        ),
      ],
      executionUpdatedAt: EXECUTION_UPDATED_AT,
    });

    expect(fortyMinutesIn.getTime()).toBeLessThan(deadline.getTime());
  });

  test("a one-second step is past its deadline six minutes in, not an hour", () => {
    const startedAt: string = "2026-07-30T10:00:00.000Z";
    const sixMinutesIn: Date = new Date("2026-07-30T10:06:00.000Z");

    const deadline: Date = getRunningExecutionDeadline({
      stepExecutions: [
        running(
          makeStep(RunbookStepType.HttpRequest, { timeoutInMs: 1_000 }),
          startedAt,
        ),
      ],
      executionUpdatedAt: EXECUTION_UPDATED_AT,
    });

    expect(sixMinutesIn.getTime()).toBeGreaterThan(deadline.getTime());
  });

  test("no Running step means nothing is executing — only the grace margin applies", () => {
    /*
     * The Worker died between steps. There is no work in flight to protect,
     * so the execution should not sit there for the length of a step window.
     */
    const deadline: Date = getRunningExecutionDeadline({
      stepExecutions: [
        {
          step: makeStep(RunbookStepType.Bash),
          status: RunbookStepExecutionStatus.Completed,
        },
        {
          step: makeStep(RunbookStepType.Bash),
          status: RunbookStepExecutionStatus.Pending,
        },
      ],
      executionUpdatedAt: EXECUTION_UPDATED_AT,
    });

    expect(deadline.getTime()).toBe(
      EXECUTION_UPDATED_AT.getTime() + STUCK_EXECUTION_GRACE_IN_MS,
    );
  });

  test("an empty step list falls back to the execution's own timestamp", () => {
    const deadline: Date = getRunningExecutionDeadline({
      stepExecutions: [],
      executionUpdatedAt: EXECUTION_UPDATED_AT,
    });

    expect(deadline.getTime()).toBe(
      EXECUTION_UPDATED_AT.getTime() + STUCK_EXECUTION_GRACE_IN_MS,
    );
  });

  test.each([undefined, "not a date"])(
    "a Running step with an unusable startedAt (%s) still gets its full allowance",
    (startedAt: string | undefined) => {
      /*
       * startedAt and updatedAt are written in the same statement, so falling
       * back to updatedAt keeps the step's window intact rather than expiring
       * it immediately.
       */
      const state: RunbookStepExecutionState = running(
        makeStep(RunbookStepType.HttpRequest, { timeoutInMs: 45_000 }),
      );
      if (startedAt) {
        state.startedAt = startedAt;
      }

      const deadline: Date = getRunningExecutionDeadline({
        stepExecutions: [state],
        executionUpdatedAt: EXECUTION_UPDATED_AT,
      });

      expect(deadline.getTime()).toBe(
        EXECUTION_UPDATED_AT.getTime() + 45_000 + STUCK_EXECUTION_GRACE_IN_MS,
      );
    },
  );

  test("the first Running step is the one that decides — later steps have not started", () => {
    const deadline: Date = getRunningExecutionDeadline({
      stepExecutions: [
        {
          step: makeStep(RunbookStepType.Bash),
          status: RunbookStepExecutionStatus.Completed,
        },
        running(
          makeStep(RunbookStepType.HttpRequest, { timeoutInMs: 45_000 }),
          STEP_STARTED_AT,
        ),
        {
          step: makeStep(RunbookStepType.AI),
          status: RunbookStepExecutionStatus.Pending,
        },
      ],
      executionUpdatedAt: EXECUTION_UPDATED_AT,
    });

    expect(deadline.getTime()).toBe(
      new Date(STEP_STARTED_AT).getTime() +
        45_000 +
        STUCK_EXECUTION_GRACE_IN_MS,
    );
  });

  test("the deadline always sits past the Worker's own claim + execution + 5s giveup", () => {
    /*
     * The Worker running the step times out at claim + execution + 5s and
     * writes the failure itself. The sweep must never beat it to the punch, or
     * two writers would race over the same execution.
     */
    const step: RunbookStep = makeStep(RunbookStepType.Bash, {
      timeoutInMs: 600_000,
      claimTimeoutInMs: 900_000,
    });
    const startedAtMs: number = new Date(STEP_STARTED_AT).getTime();

    const deadline: Date = getRunningExecutionDeadline({
      stepExecutions: [running(step, STEP_STARTED_AT)],
      executionUpdatedAt: EXECUTION_UPDATED_AT,
    });

    expect(deadline.getTime()).toBeGreaterThan(
      startedAtMs + getStepMaxRuntimeInMs(step) + 5_000,
    );
  });
});
