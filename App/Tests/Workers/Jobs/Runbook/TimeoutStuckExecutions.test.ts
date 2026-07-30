import ObjectID from "Common/Types/ObjectID";
import RunbookExecution from "Common/Models/DatabaseModels/RunbookExecution";
import RunbookExecutionStatus from "Common/Types/Runbook/RunbookExecutionStatus";
import RunbookStepExecutionStatus from "Common/Types/Runbook/RunbookStepExecutionStatus";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import { JSONArray } from "Common/Types/JSON";
import { RunbookStep } from "Common/Types/Runbook/RunbookStep";
import { RunbookStepExecutionState } from "Common/Types/Runbook/RunbookStepExecution";
import { STUCK_EXECUTION_GRACE_IN_MS } from "Common/Types/Runbook/RunbookExecutionDeadline";
import { describe, expect, test, beforeEach } from "@jest/globals";

/*
 * A runbook execution runs inside one queue job, so a Worker that dies mid-run
 * and never gets the job redelivered leaves the row Running with nobody
 * advancing it — the person who ran the runbook during an incident watches a
 * spinner forever. This suite drives the sweep that ends that state, and pins
 * the thing that makes it safe: it must not touch an execution that is still
 * inside the window its own steps were configured for.
 *
 * The job registers itself via RunCron at import time and exports nothing, so
 * the Cron util is mocked to capture the handler (same recorder the other
 * App/Tests/Workers/Jobs suites use) and each test drives one full tick.
 */

type CronHandler = () => Promise<void>;

const mockCapturedJobs: Record<string, CronHandler> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (jobName: string, _options: unknown, runFunction: CronHandler): void => {
        mockCapturedJobs[jobName] = runFunction;
      },
    ),
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/RunbookExecutionService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      updateOneById: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/RunbookAgentJobService", () => {
  return {
    __esModule: true,
    default: {
      cancelJobsForExecution: jest.fn(),
    },
  };
});

// Imported AFTER the mocks above (jest hoists them) so the job registers into the recorder.
import "../../../../FeatureSet/Workers/Jobs/Runbook/TimeoutStuckExecutions";
import RunbookExecutionService from "Common/Server/Services/RunbookExecutionService";
import RunbookAgentJobService from "Common/Server/Services/RunbookAgentJobService";

const findBy: jest.Mock =
  RunbookExecutionService.findBy as unknown as jest.Mock;
const updateOneById: jest.Mock =
  RunbookExecutionService.updateOneById as unknown as jest.Mock;
const cancelJobsForExecution: jest.Mock =
  RunbookAgentJobService.cancelJobsForExecution as unknown as jest.Mock;

const JOB_NAME: string = "Runbook:TimeoutStuckExecutions";

function runTick(): Promise<void> {
  return mockCapturedJobs[JOB_NAME]!();
}

function makeStep(
  type: RunbookStepType,
  config: Record<string, unknown> = {},
): RunbookStep {
  return {
    id: "step-1",
    order: 1,
    type,
    title: "Restore the database",
    config: config as never,
  };
}

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}

function makeExecution(
  stepExecutions: Array<RunbookStepExecutionState>,
  updatedAt: Date,
): RunbookExecution {
  const execution: RunbookExecution = new RunbookExecution();
  execution._id = "exec-1";
  execution.projectId = new ObjectID("proj-1");
  execution.runbookNameSnapshot = "Restore runbook";
  execution.stepExecutions = stepExecutions as unknown as JSONArray;
  execution.updatedAt = updatedAt;
  return execution;
}

function lastUpdateData(): Record<string, unknown> {
  const call: Array<unknown> = updateOneById.mock.calls[0]!;
  return (call[0] as { data: Record<string, unknown> }).data;
}

describe("Runbook:TimeoutStuckExecutions", () => {
  beforeEach(() => {
    findBy.mockReset();
    updateOneById.mockReset().mockResolvedValue(undefined);
    cancelJobsForExecution.mockReset().mockResolvedValue(undefined);
  });

  test("only Running executions are swept", async () => {
    /*
     * Scheduled runs are queued but not yet picked up — with steps that may
     * now run for an hour each, a healthy backlog legitimately sits Scheduled.
     * WaitingForManualStep is an intended unbounded wait on a human.
     */
    findBy.mockResolvedValue([]);

    await runTick();

    const query: Record<string, unknown> = (
      findBy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;
    expect(query["status"]).toBe(RunbookExecutionStatus.Running);
  });

  test("an execution still inside its step's window is left alone", async () => {
    /*
     * The regression that matters most: the docs tell people to raise the
     * timeout for a database restore. Forty minutes into an hour-long step,
     * a Worker is plausibly still on it.
     */
    findBy.mockResolvedValue([
      makeExecution(
        [
          {
            step: makeStep(RunbookStepType.Bash, {
              timeoutInMs: 60 * 60_000,
              claimTimeoutInMs: 60_000,
            }),
            status: RunbookStepExecutionStatus.Running,
            startedAt: minutesAgo(40).toISOString(),
          },
        ],
        minutesAgo(40),
      ),
    ]);

    await runTick();

    expect(updateOneById).not.toHaveBeenCalled();
    expect(cancelJobsForExecution).not.toHaveBeenCalled();
  });

  test("an execution past its step's window is failed with a reason naming the step", async () => {
    findBy.mockResolvedValue([
      makeExecution(
        [
          {
            step: makeStep(RunbookStepType.Bash, {
              timeoutInMs: 60_000,
              claimTimeoutInMs: 60_000,
            }),
            status: RunbookStepExecutionStatus.Running,
            startedAt: minutesAgo(90).toISOString(),
          },
        ],
        minutesAgo(90),
      ),
    ]);

    await runTick();

    const data: Record<string, unknown> = lastUpdateData();
    expect(data["status"]).toBe(RunbookExecutionStatus.Failed);
    expect(data["completedAt"]).toBeInstanceOf(Date);
    expect(String(data["failureReason"])).toContain("Restore the database");
    expect(String(data["failureReason"])).toContain("restarted");
  });

  test("the interrupted step is failed too, and warns that it may have partially run", async () => {
    /*
     * Leaving a Running step under a Failed execution would read as "still
     * going" on the timeline. And the operator needs to know the script may
     * have done half its work before the Worker vanished.
     */
    const stepExecutions: Array<RunbookStepExecutionState> = [
      {
        step: makeStep(RunbookStepType.Bash, { timeoutInMs: 60_000 }),
        status: RunbookStepExecutionStatus.Running,
        startedAt: minutesAgo(90).toISOString(),
      },
    ];
    findBy.mockResolvedValue([makeExecution(stepExecutions, minutesAgo(90))]);

    await runTick();

    const persisted: Array<RunbookStepExecutionState> = lastUpdateData()[
      "stepExecutions"
    ] as unknown as Array<RunbookStepExecutionState>;

    expect(persisted[0]!.status).toBe(RunbookStepExecutionStatus.Failed);
    expect(persisted[0]!.completedAt).toBeTruthy();
    expect(persisted[0]!.errorMessage).toContain("partially run");
  });

  test("outstanding agent jobs are cancelled so no agent starts work nobody is reading", async () => {
    findBy.mockResolvedValue([
      makeExecution(
        [
          {
            step: makeStep(RunbookStepType.Bash, { timeoutInMs: 60_000 }),
            status: RunbookStepExecutionStatus.Running,
            startedAt: minutesAgo(90).toISOString(),
          },
        ],
        minutesAgo(90),
      ),
    ]);

    await runTick();

    expect(cancelJobsForExecution).toHaveBeenCalledWith({
      runbookExecutionId: new ObjectID("exec-1"),
    });
  });

  test("an execution whose Worker died between steps is failed on the grace margin alone", async () => {
    // No step is Running, so nothing is in flight and no allowance is owed.
    findBy.mockResolvedValue([
      makeExecution(
        [
          {
            step: makeStep(RunbookStepType.Bash),
            status: RunbookStepExecutionStatus.Completed,
          },
          {
            step: makeStep(RunbookStepType.Bash),
            status: RunbookStepExecutionStatus.Pending,
          },
        ],
        new Date(Date.now() - STUCK_EXECUTION_GRACE_IN_MS - 60_000),
      ),
    ]);

    await runTick();

    const data: Record<string, unknown> = lastUpdateData();
    expect(data["status"]).toBe(RunbookExecutionStatus.Failed);
    expect(String(data["failureReason"])).toContain("stopped making progress");
  });

  test("one execution that blows up does not stop the rest of the sweep", async () => {
    const stuck: Array<RunbookStepExecutionState> = [
      {
        step: makeStep(RunbookStepType.Bash, { timeoutInMs: 60_000 }),
        status: RunbookStepExecutionStatus.Running,
        startedAt: minutesAgo(90).toISOString(),
      },
    ];
    const first: RunbookExecution = makeExecution(stuck, minutesAgo(90));
    const second: RunbookExecution = makeExecution(stuck, minutesAgo(90));
    second._id = "exec-2";
    findBy.mockResolvedValue([first, second]);

    updateOneById
      .mockRejectedValueOnce(new Error("database went away"))
      .mockResolvedValue(undefined);

    await runTick();

    expect(updateOneById).toHaveBeenCalledTimes(2);
  });

  test("a tick with nothing to do issues no writes", async () => {
    findBy.mockResolvedValue([]);

    await runTick();

    expect(updateOneById).not.toHaveBeenCalled();
    expect(cancelJobsForExecution).not.toHaveBeenCalled();
  });
});
