import {
  MAX_RUN_WATCH_POLLS,
  RunWatchDecision,
  decideRunWatch,
  isFailedRunStatus,
  isTerminalRunStatus,
} from "../../../../UI/Components/Workflow/RunStatusWatcher";
import WorkflowStatus from "../../../../Types/Workflow/WorkflowStatus";
import { describe, expect, test } from "@jest/globals";

describe("isTerminalRunStatus", () => {
  test("settles on the statuses a run never leaves", () => {
    expect(isTerminalRunStatus(WorkflowStatus.Success)).toBe(true);
    expect(isTerminalRunStatus(WorkflowStatus.Error)).toBe(true);
    expect(isTerminalRunStatus(WorkflowStatus.Timeout)).toBe(true);
    expect(isTerminalRunStatus(WorkflowStatus.WorkflowCountExceeded)).toBe(
      true,
    );
  });

  test("keeps watching while a run is still moving", () => {
    expect(isTerminalRunStatus(WorkflowStatus.Scheduled)).toBe(false);
    expect(isTerminalRunStatus(WorkflowStatus.Running)).toBe(false);
  });

  /*
   * Waiting is a Sleep step parking the run. It carries on afterwards, so it
   * is not an ending — but it is also not worth watching, which decideRunWatch
   * handles separately.
   */
  test("does not treat Waiting as an ending", () => {
    expect(isTerminalRunStatus(WorkflowStatus.Waiting)).toBe(false);
  });

  test("handles nothing at all", () => {
    expect(isTerminalRunStatus(null)).toBe(false);
    expect(isTerminalRunStatus(undefined)).toBe(false);
  });
});

describe("isFailedRunStatus", () => {
  test("is true only for the unhappy endings", () => {
    expect(isFailedRunStatus(WorkflowStatus.Error)).toBe(true);
    expect(isFailedRunStatus(WorkflowStatus.Timeout)).toBe(true);
    expect(isFailedRunStatus(WorkflowStatus.WorkflowCountExceeded)).toBe(true);

    expect(isFailedRunStatus(WorkflowStatus.Success)).toBe(false);
    expect(isFailedRunStatus(WorkflowStatus.Running)).toBe(false);
    expect(isFailedRunStatus(WorkflowStatus.Waiting)).toBe(false);
    expect(isFailedRunStatus(null)).toBe(false);
    expect(isFailedRunStatus(undefined)).toBe(false);
  });
});

describe("decideRunWatch", () => {
  test("keeps waiting while the run has not appeared yet", () => {
    const decision: RunWatchDecision = decideRunWatch({
      run: null,
      pollCount: 0,
    });

    expect(decision.shouldContinue).toBe(true);
    expect(decision.message).toMatch(/Starting/i);
  });

  test("keeps watching a running run and says so", () => {
    const decision: RunWatchDecision = decideRunWatch({
      run: { runId: "a", status: WorkflowStatus.Running },
      pollCount: 1,
    });

    expect(decision.shouldContinue).toBe(true);
    expect(decision.message).toMatch(/running/i);
  });

  test("keeps watching a scheduled run", () => {
    expect(
      decideRunWatch({
        run: { runId: "a", status: WorkflowStatus.Scheduled },
        pollCount: 1,
      }).shouldContinue,
    ).toBe(true);
  });

  test("stops on success with a plain statement", () => {
    const decision: RunWatchDecision = decideRunWatch({
      run: { runId: "a", status: WorkflowStatus.Success },
      pollCount: 3,
    });

    expect(decision.shouldContinue).toBe(false);
    expect(decision.message).toMatch(/finished successfully/i);
  });

  test("stops on failure and points at the logs", () => {
    const decision: RunWatchDecision = decideRunWatch({
      run: { runId: "a", status: WorkflowStatus.Error },
      pollCount: 3,
    });

    expect(decision.shouldContinue).toBe(false);
    expect(decision.message).toMatch(/run log/i);
  });

  test("stops on timeout", () => {
    expect(
      decideRunWatch({
        run: { runId: "a", status: WorkflowStatus.Timeout },
        pollCount: 3,
      }).shouldContinue,
    ).toBe(false);
  });

  test("stops following a run that went to sleep, and explains why", () => {
    const decision: RunWatchDecision = decideRunWatch({
      run: { runId: "a", status: WorkflowStatus.Waiting },
      pollCount: 3,
    });

    expect(decision.shouldContinue).toBe(false);
    expect(decision.message).toMatch(/sleeping/i);
    expect(decision.message).toMatch(/carry on/i);
  });

  test("gives up rather than polling forever", () => {
    const decision: RunWatchDecision = decideRunWatch({
      run: { runId: "a", status: WorkflowStatus.Running },
      pollCount: MAX_RUN_WATCH_POLLS,
    });

    expect(decision.shouldContinue).toBe(false);
    expect(decision.message).toMatch(/taking a while/i);
  });

  test("gives up even when the run never appeared", () => {
    const decision: RunWatchDecision = decideRunWatch({
      run: null,
      pollCount: MAX_RUN_WATCH_POLLS,
    });

    expect(decision.shouldContinue).toBe(false);
  });

  test("polls right up to the limit but not past it", () => {
    expect(
      decideRunWatch({
        run: { runId: "a", status: WorkflowStatus.Running },
        pollCount: MAX_RUN_WATCH_POLLS - 1,
      }).shouldContinue,
    ).toBe(true);
  });

  test("names the status when a run fails, so the strip is specific", () => {
    expect(
      decideRunWatch({
        run: { runId: "a", status: WorkflowStatus.Timeout },
        pollCount: 1,
      }).message,
    ).toMatch(/timeout/i);

    expect(
      decideRunWatch({
        run: { runId: "a", status: WorkflowStatus.WorkflowCountExceeded },
        pollCount: 1,
      }).message,
    ).toMatch(/workflow count exceeded/i);
  });

  test("names the status while a run is still going", () => {
    expect(
      decideRunWatch({
        run: { runId: "a", status: WorkflowStatus.Scheduled },
        pollCount: 1,
      }).message,
    ).toMatch(/scheduled/i);
  });

  /*
   * A status added later must not fall through to "keep polling with nothing
   * to say" — every one of them has to produce a line the strip can show.
   */
  test.each(Object.values(WorkflowStatus))(
    "has something to say about %s",
    (status: WorkflowStatus) => {
      const decision: RunWatchDecision = decideRunWatch({
        run: { runId: "a", status: status },
        pollCount: 0,
      });

      expect(typeof decision.message).toBe("string");
      expect(decision.message).not.toBe("");
    },
  );

  test("stops for every status a run does not leave", () => {
    const stillMoving: Array<WorkflowStatus> = Object.values(
      WorkflowStatus,
    ).filter((status: WorkflowStatus) => {
      return decideRunWatch({
        run: { runId: "a", status: status },
        pollCount: 0,
      }).shouldContinue;
    });

    expect(stillMoving).toEqual([
      WorkflowStatus.Scheduled,
      WorkflowStatus.Running,
    ]);
  });
});
