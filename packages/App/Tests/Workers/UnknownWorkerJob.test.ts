/*
 * Issue #5546: the Worker queue failed every run of
 * "SecurityHunts:RunScheduledHunts" and
 * "AIAgent:FindPullRequestsToReviewInProduction", once a minute each, with
 * "No job found with name". The stack trace's lines are 14.0.97's, and both
 * crons first shipped in 14.0.98 and 14.0.99: servers on 14.0.99 scheduled
 * them, and a worker still on 14.0.97 took the runs.
 *
 * A worker that has no job by a name now never fails the job for that:
 *   - a scheduled run a running server claims is skipped, with a warning that
 *     names both releases;
 *   - a scheduled run nobody claims has its schedule retired;
 *   - a job queued once goes back to the queue for a worker that has it.
 *
 * The schedule claims are Queue's (QueueScheduleClaims.test.ts in Common);
 * here they answer as a test says. The real thing, on a real Valkey, is
 * UnknownWorkerJobValkey.test.ts.
 */

jest.mock("Common/Server/Infrastructure/Queue", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Infrastructure/Queue",
  );

  return {
    __esModule: true,
    ...actual,
    default: { retireUnclaimedSchedule: jest.fn() },
  };
});

jest.mock("Common/Server/Infrastructure/QueueWorker", () => {
  // The job is handed its deadline, as the real time limit hands it.
  const { default: JobDeadline } = jest.requireActual(
    "Common/Server/Utils/JobDeadline",
  );

  return {
    __esModule: true,
    default: {
      runJobWithTimeout: jest.fn(
        async (
          _timeoutInMs: number,
          callback: (deadline: unknown) => Promise<void>,
        ) => {
          await callback(new JobDeadline());
        },
      ),
    },
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

// The worker of the report.
jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    ...jest.requireActual("Common/Server/EnvironmentConfig"),
    AppVersion: "14.0.97",
  };
});

import runWorkerJob from "../../FeatureSet/Workers/Utils/RunWorkerJob";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import UnknownWorkerJob from "../../FeatureSet/Workers/Utils/UnknownWorkerJob";
import JobDictionary from "../../FeatureSet/Workers/Utils/JobDictionary";
import Queue, { QueueJob } from "Common/Server/Infrastructure/Queue";
import QueueWorker from "Common/Server/Infrastructure/QueueWorker";
import UnknownQueueJob from "Common/Server/Infrastructure/UnknownQueueJob";
import logger from "Common/Server/Utils/Logger";

const MINUTE: number = 60 * 1000;

const retireUnclaimedSchedule: jest.Mock =
  Queue.retireUnclaimedSchedule as unknown as jest.Mock;

type FakeJob = QueueJob & { moveToDelayed: jest.Mock };

/*
 * A run as the report shows it: "Options" and "Repeat key" from the Health
 * page, for 03:08 CST on Nov 02 2026.
 */
function runFromTheReport(
  name: string,
  repeatJobKey: string,
  repeatJobId: string,
): FakeJob {
  return {
    id: `repeat:${repeatJobKey}:1793610480000`,
    name,
    data: {},
    timestamp: 1793610446535,
    repeatJobKey,
    opts: {
      attempts: 0,
      prevMillis: 1793610480000,
      removeOnFail: { count: 100 },
      jobId: `repeat:${repeatJobKey}:1793610480000`,
      repeat: { count: 1, jobId: repeatJobId, pattern: "* * * * *" },
      removeOnComplete: { count: 500 },
      timestamp: 1793610446535,
      delay: 33465,
      backoff: null,
    },
    moveToDelayed: jest.fn().mockResolvedValue(undefined),
  } as unknown as FakeJob;
}

const SECURITY_HUNTS_RUN: () => FakeJob = (): FakeJob => {
  return runFromTheReport(
    "SecurityHunts:RunScheduledHunts",
    "208750ac869e9af73fe7ea424f11d73c",
    "SecurityHunts-RunScheduledHunts",
  );
};

const PRODUCTION_REVIEW_RUN: () => FakeJob = (): FakeJob => {
  return runFromTheReport(
    "AIAgent:FindPullRequestsToReviewInProduction",
    "582322e68c5f5236724d07d1df201221",
    "AIAgent-FindPullRequestsToReviewInProduction",
  );
};

function queuedOnce(name: string, queuedAt: number = Date.now()): FakeJob {
  return {
    id: `${name}-1`,
    name,
    data: { projectId: "5f0d8d1e-1111-4111-8111-111111111111" },
    timestamp: queuedAt,
    opts: { attempts: 1 },
    moveToDelayed: jest.fn().mockResolvedValue(undefined),
  } as unknown as FakeJob;
}

async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }

  throw new Error("expected the job to throw");
}

beforeEach(() => {
  jest.clearAllMocks();
  (
    UnknownQueueJob as unknown as { lastWarnedAt: Map<string, number> }
  ).lastWarnedAt.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a scheduled run of a cron this worker does not have", () => {
  test("the report's SecurityHunts run is skipped, not failed, when a 14.0.99 server schedules it", async () => {
    retireUnclaimedSchedule.mockResolvedValue({
      claimedBy: "14.0.99",
      removedCount: 0,
    });

    await expect(runWorkerJob(SECURITY_HUNTS_RUN(), "lock")).resolves.toBe(
      undefined,
    );

    expect(retireUnclaimedSchedule).toHaveBeenCalledWith(
      "Worker",
      "SecurityHunts:RunScheduledHunts",
    );
    expect(QueueWorker.runJobWithTimeout).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  test("the report's production review run is skipped the same way", async () => {
    retireUnclaimedSchedule.mockResolvedValue({
      claimedBy: "14.0.99",
      removedCount: 0,
    });

    await expect(
      runWorkerJob(PRODUCTION_REVIEW_RUN(), "lock"),
    ).resolves.toBeUndefined();
  });

  test("the warning says which release this worker runs and which one schedules the cron", async () => {
    retireUnclaimedSchedule.mockResolvedValue({
      claimedBy: "14.0.99",
      removedCount: 0,
    });

    await runWorkerJob(SECURITY_HUNTS_RUN(), "lock");

    expect(logger.warn).toHaveBeenCalledTimes(1);

    const warning: string = jest.mocked(logger.warn).mock
      .calls[0]![0] as string;

    expect(warning).toContain(
      'Skipped a run of "SecurityHunts:RunScheduledHunts": this worker runs OneUptime 14.0.97, which has no job by that name',
    );
    expect(warning).toContain(
      "a server running OneUptime 14.0.99 schedules it",
    );
    expect(warning).toContain(
      "Run the same release of OneUptime on every server (app and worker).",
    );
    expect(warning).not.toContain("No job found");
  });

  test("an every-minute cron warns once every fifteen minutes, not once a minute", async () => {
    retireUnclaimedSchedule.mockResolvedValue({
      claimedBy: "14.0.99",
      removedCount: 0,
    });

    let now: number = 1793610480000;
    jest.spyOn(Date, "now").mockImplementation(() => {
      return now;
    });

    for (let minute: number = 0; minute < 15; minute++) {
      await runWorkerJob(SECURITY_HUNTS_RUN(), "lock");
      now += MINUTE;
    }

    expect(logger.warn).toHaveBeenCalledTimes(1);

    await runWorkerJob(SECURITY_HUNTS_RUN(), "lock");
    expect(logger.warn).toHaveBeenCalledTimes(2);

    // Each cron has its own warning.
    await runWorkerJob(PRODUCTION_REVIEW_RUN(), "lock");
    expect(logger.warn).toHaveBeenCalledTimes(3);
  });

  test("a server that does not say its release is still named as another release", async () => {
    retireUnclaimedSchedule.mockResolvedValue({
      claimedBy: "unknown",
      removedCount: 0,
    });

    await runWorkerJob(SECURITY_HUNTS_RUN(), "lock");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "a server running a release of OneUptime that does not say its version schedules it",
      ),
    );
  });

  test("a schedule no running server claims is retired, and the worker says so once", async () => {
    retireUnclaimedSchedule.mockResolvedValue({
      claimedBy: null,
      removedCount: 1,
    });

    await expect(
      runWorkerJob(
        runFromTheReport(
          "AIAgent:TimeoutStuckTasks",
          "6f1ed002ab5595859014ebf0951522d9",
          "AIAgent-TimeoutStuckTasks",
        ),
        "lock",
      ),
    ).resolves.toBeUndefined();

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining(
        'Removed the schedule of "AIAgent:TimeoutStuckTasks": no running OneUptime server schedules it any more',
      ),
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("a run whose schedule another worker already retired is skipped quietly", async () => {
    retireUnclaimedSchedule.mockResolvedValue({
      claimedBy: null,
      removedCount: 0,
    });

    await expect(
      runWorkerJob(SECURITY_HUNTS_RUN(), "lock"),
    ).resolves.toBeUndefined();

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("when it cannot tell whether a server still schedules the cron, it skips the run and keeps the schedule", async () => {
    retireUnclaimedSchedule.mockRejectedValue(
      new Error("Connection is closed."),
    );

    await expect(
      runWorkerJob(SECURITY_HUNTS_RUN(), "lock"),
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        'Skipped a run of "SecurityHunts:RunScheduledHunts", which this worker has no job for',
      ),
    );
  });

  test("a scheduled run is never handed back: two runs of one cron must not pile up", async () => {
    retireUnclaimedSchedule.mockResolvedValue({
      claimedBy: "14.0.99",
      removedCount: 0,
    });
    const run: FakeJob = SECURITY_HUNTS_RUN();

    await runWorkerJob(run, "lock");

    expect(run.moveToDelayed).not.toHaveBeenCalled();
  });
});

describe("a job queued once that this worker does not have", () => {
  test("goes back to the queue for a worker that has it, instead of failing", async () => {
    const job: FakeJob = queuedOnce("SecurityHunts:RunProjectHunts");

    const error: Error = await rejectionOf(runWorkerJob(job, "lock"));

    expect(error.name).toBe("DelayedError");
    expect(job.moveToDelayed).toHaveBeenCalledWith(expect.any(Number), "lock");
    expect(retireUnclaimedSchedule).not.toHaveBeenCalled();
    expect(QueueWorker.runJobWithTimeout).not.toHaveBeenCalled();
  });

  test("fails once nobody has run it for thirty minutes, saying why", async () => {
    const job: FakeJob = queuedOnce(
      "OnCallDutyPolicy:BackfillNotificationRulesForNewSeverities",
      Date.now() - 31 * MINUTE,
    );

    const error: Error = await rejectionOf(runWorkerJob(job, "lock"));

    expect(error.name).toBe("UnrecoverableError");
    expect(error.message).toContain(
      'No worker ran a job named "OnCallDutyPolicy:BackfillNotificationRulesForNewSeverities" within 30 minutes',
    );
    expect(error.message).toContain("This worker runs OneUptime 14.0.97");
    expect(job.moveToDelayed).not.toHaveBeenCalled();
  });

  test("a name every object inherits, such as toString, is not taken for a job", async () => {
    const job: FakeJob = queuedOnce("toString");

    const error: Error = await rejectionOf(runWorkerJob(job, "lock"));

    expect(error.name).toBe("DelayedError");
    expect(QueueWorker.runJobWithTimeout).not.toHaveBeenCalled();
  });
});

describe("a job this worker has", () => {
  test("runs as before, under its timeout", async () => {
    const handler: jest.Mock = jest.fn(async () => {});
    JobDictionary.setJobFunction(
      "Incident:KeepCurrentStateConsistent",
      handler,
    );
    JobDictionary.setTimeoutInMs("Incident:KeepCurrentStateConsistent", 90_000);

    const run: FakeJob = runFromTheReport(
      "Incident:KeepCurrentStateConsistent",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "Incident-KeepCurrentStateConsistent",
    );

    await runWorkerJob(run, "lock");

    expect(QueueWorker.runJobWithTimeout).toHaveBeenCalledWith(
      90_000,
      expect.any(Function),
    );
    // With the deadline its time limit gives it (JobDeadline).
    expect(handler).toHaveBeenCalledWith(run, expect.any(JobDeadline));
    expect(retireUnclaimedSchedule).not.toHaveBeenCalled();
    expect(run.moveToDelayed).not.toHaveBeenCalled();
  });

  test("still fails when its own work fails", async () => {
    JobDictionary.setJobFunction("Failing:Job", async () => {
      throw new Error("Postgres is not reachable");
    });

    await expect(
      runWorkerJob(queuedOnce("Failing:Job"), "lock"),
    ).rejects.toThrow("Postgres is not reachable");
  });
});

describe("UnknownWorkerJob.isScheduledRun", () => {
  test("a run a schedule made has a repeat key or repeat options", () => {
    expect(UnknownWorkerJob.isScheduledRun(SECURITY_HUNTS_RUN())).toBe(true);
    expect(
      UnknownWorkerJob.isScheduledRun({
        name: "x",
        repeatJobKey: "k",
        opts: {},
      } as unknown as QueueJob),
    ).toBe(true);
    expect(
      UnknownWorkerJob.isScheduledRun({
        name: "x",
        opts: { repeat: { pattern: "* * * * *" } },
      } as unknown as QueueJob),
    ).toBe(true);
  });

  test("a job queued once has neither", () => {
    expect(UnknownWorkerJob.isScheduledRun(queuedOnce("x"))).toBe(false);
    expect(
      UnknownWorkerJob.isScheduledRun({ name: "x" } as unknown as QueueJob),
    ).toBe(false);
  });
});
