import RunbookStepType, {
  RUNNER_EXECUTED_STEP_TYPES,
} from "../../../Types/Runbook/RunbookStepType";
import {
  GLOBAL_RUNNER_MAX_EXECUTION_TIMEOUT_IN_MS,
  GLOBAL_RUNNER_STEP_TYPES,
  MAX_GLOBAL_RUNNER_JOBS_PER_PROJECT,
  canGlobalRunnersRunStepType,
  clampGlobalRunnerExecutionTimeoutInMs,
} from "../../../Types/Runner/GlobalRunnerWork";
import { describe, expect, test } from "@jest/globals";

/*
 * What a global Runner - one OneUptime runs for every project - may run. It
 * is the one list the server routes, enqueues and serves by, the Runner
 * re-checks and the step editor offers the global choice by, so a change to
 * it is a change to what every project's steps can do on a shared host.
 */

describe("what global Runners run", () => {
  test("JavaScript steps only: the one step type that runs in a sandbox of its own", () => {
    /*
     * A shell (Bash), an SSH hop and a Kubernetes call with a project's
     * credential cannot be kept apart from other projects' steps on one
     * host: they reach that host's files, processes and network, or need a
     * project's credentials. Adding one here needs an isolation story first
     * (a per-step container, no shared network) - and the docs, the picker
     * and the claim all follow this list.
     */
    expect([...GLOBAL_RUNNER_STEP_TYPES]).toEqual([RunbookStepType.JavaScript]);
  });

  test.each(Object.values(RunbookStepType))(
    "%s: may a global Runner run it?",
    (stepType: RunbookStepType) => {
      expect(canGlobalRunnersRunStepType(stepType)).toBe(
        stepType === RunbookStepType.JavaScript,
      );
    },
  );

  test("every type a global Runner runs is one a Runner runs at all", () => {
    for (const stepType of GLOBAL_RUNNER_STEP_TYPES) {
      expect(RUNNER_EXECUTED_STEP_TYPES).toContain(stepType);
    }
  });

  test("anything that is not a step type is refused", () => {
    for (const value of [
      undefined,
      null,
      "",
      "javascript",
      "JavaScript ",
      42,
      {},
      [RunbookStepType.JavaScript],
    ]) {
      expect(canGlobalRunnersRunStepType(value)).toBe(false);
    }
  });
});

describe("how long a step runs on a global Runner", () => {
  test("five minutes at most", () => {
    expect(GLOBAL_RUNNER_MAX_EXECUTION_TIMEOUT_IN_MS).toBe(5 * 60 * 1000);
  });

  test("a shorter timeout is kept", () => {
    expect(clampGlobalRunnerExecutionTimeoutInMs(30_000)).toBe(30_000);
    expect(clampGlobalRunnerExecutionTimeoutInMs(1)).toBe(1);
  });

  test("a longer timeout is held to the most", () => {
    expect(clampGlobalRunnerExecutionTimeoutInMs(60 * 60 * 1000)).toBe(
      GLOBAL_RUNNER_MAX_EXECUTION_TIMEOUT_IN_MS,
    );
  });

  test("a timeout that is no number gets the most, never no limit", () => {
    expect(clampGlobalRunnerExecutionTimeoutInMs(NaN)).toBe(
      GLOBAL_RUNNER_MAX_EXECUTION_TIMEOUT_IN_MS,
    );
    expect(clampGlobalRunnerExecutionTimeoutInMs(Infinity)).toBe(
      GLOBAL_RUNNER_MAX_EXECUTION_TIMEOUT_IN_MS,
    );
    expect(clampGlobalRunnerExecutionTimeoutInMs(0)).toBe(
      GLOBAL_RUNNER_MAX_EXECUTION_TIMEOUT_IN_MS,
    );
    expect(clampGlobalRunnerExecutionTimeoutInMs(-5)).toBe(
      GLOBAL_RUNNER_MAX_EXECUTION_TIMEOUT_IN_MS,
    );
  });

  test("a fraction is rounded", () => {
    expect(clampGlobalRunnerExecutionTimeoutInMs(1500.6)).toBe(1501);
  });
});

describe("sharing global Runners between projects", () => {
  test("at most three of one project's steps run on them at once", () => {
    expect(MAX_GLOBAL_RUNNER_JOBS_PER_PROJECT).toBe(3);
  });
});
