import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A SCHEDULED JOB RUNS ONE AT A TIME, AND STOPS AT ITS TIME LIMIT.
 *
 * BullMQ queues a cron's next run as soon as one starts. On a slow
 * database an every-minute job that took longer than a minute started a
 * second copy beside the first, then a third, each holding connections;
 * and the 5-minute time limit only marked a run failed while its work went
 * on. RunCron now takes a lock named after the job for each run, released
 * when the run ends however it ends, and hands the run its deadline.
 *
 * Valkey is played here by a lease store with real expiry on fake time, so
 * these runs meet the same lock a second worker would. CronLock.test.ts
 * pins the lease's keeping; CronLockValkey.test.ts runs it on a real Valkey.
 */

class MockLockTimeoutError extends Error {}

// Valkey's leases: key -> holder and when the lease lapses (fake time).
const mockLeases: Map<string, { holder: string; expiresAt: number }> =
  new Map();
let mockNextHolder: number = 0;
let mockValkeyDown: boolean = false;

jest.mock("Common/Server/Infrastructure/Semaphore", () => {
  type Held = { key: string; identifier: string; lockTimeout: number };

  const isHeldBy: (held: Held) => boolean = (held: Held): boolean => {
    const lease: { holder: string; expiresAt: number } | undefined =
      mockLeases.get(held.key);
    return Boolean(
      lease && lease.holder === held.identifier && lease.expiresAt > Date.now(),
    );
  };

  return {
    __esModule: true,
    SemaphoreLockTimeoutError: MockLockTimeoutError,
    default: {
      lock: jest.fn(
        async (data: {
          key: string;
          namespace: string;
          lockTimeout: number;
        }): Promise<Held> => {
          if (mockValkeyDown) {
            throw new Error("Redis client is not connected");
          }

          const key: string = `${data.namespace}-${data.key}`;
          const lease: { holder: string; expiresAt: number } | undefined =
            mockLeases.get(key);

          if (lease && lease.expiresAt > Date.now()) {
            throw new MockLockTimeoutError(`Acquire mutex ${key} timeout`);
          }

          const identifier: string = `run-${++mockNextHolder}`;
          mockLeases.set(key, {
            holder: identifier,
            expiresAt: Date.now() + data.lockTimeout,
          });

          return { key, identifier, lockTimeout: data.lockTimeout };
        },
      ),
      keepLock: jest.fn(async (held: Held): Promise<boolean> => {
        if (!isHeldBy(held)) {
          return false;
        }

        mockLeases.set(held.key, {
          holder: held.identifier,
          expiresAt: Date.now() + held.lockTimeout,
        });
        return true;
      }),
      release: jest.fn(async (held: Held): Promise<void> => {
        if (isHeldBy(held)) {
          mockLeases.delete(held.key);
        }
      }),
    },
  };
});

jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    QueueName: { Worker: "Worker" },
    default: { addJob: jest.fn(async () => {}) },
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

import Queue from "Common/Server/Infrastructure/Queue";
import Semaphore from "Common/Server/Infrastructure/Semaphore";
import QueueWorker from "Common/Server/Infrastructure/QueueWorker";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import TimeoutException from "Common/Types/Exception/TimeoutException";
import RunCron, {
  CronRunFunction,
  buildCronJobFunction,
} from "../../../FeatureSet/Workers/Utils/Cron";
import {
  CRON_LOCK_GRACE_MS,
  CRON_LOCK_KEEP_EVERY_MS,
  CRON_LOCK_LEASE_MS,
} from "../../../FeatureSet/Workers/Utils/CronLock";
import JobDictionary, {
  WorkerJobFunction,
} from "../../../FeatureSet/Workers/Utils/JobDictionary";

type AnyMock = jest.Mock<(...args: Array<any>) => any>;

const JOB_NAME: string = "TelemetryMonitor:MonitorTelemetryMonitor";
const FIVE_MINUTES: number = 5 * 60 * 1000;

interface Gate {
  promise: Promise<void>;
  open: () => void;
}

function gate(): Gate {
  let open!: () => void;
  const promise: Promise<void> = new Promise<void>((resolve: () => void) => {
    open = resolve;
  });
  return { promise, open };
}

async function settle(): Promise<void> {
  for (let tick: number = 0; tick < 20; tick++) {
    await Promise.resolve();
  }
}

// Moves fake time on in steps, letting each step's promises settle.
async function advance(ms: number, stepMs: number = 1000): Promise<void> {
  for (let elapsed: number = 0; elapsed < ms; elapsed += stepMs) {
    jest.advanceTimersByTime(Math.min(stepMs, ms - elapsed));
    await settle();
  }
}

// The job as the Worker queue runs it: with its time limit (RunWorkerJob).
function runAsQueueJob(job: WorkerJobFunction): Promise<void> {
  return QueueWorker.runJobWithTimeout(FIVE_MINUTES, (deadline: JobDeadline) => {
    return job(undefined, deadline);
  });
}

beforeEach(() => {
  // Node's performance and hrtime are read-only: Jest 28 cannot fake them.
  jest.useFakeTimers({ doNotFake: ["performance", "hrtime"] });
  jest.setSystemTime(new Date("2026-11-14T10:00:00.000Z"));
  mockLeases.clear();
  mockValkeyDown = false;
  (Semaphore.lock as unknown as AnyMock).mockClear();
  (Semaphore.release as unknown as AnyMock).mockClear();
  (Queue.addJob as unknown as AnyMock).mockClear();
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe("a run of a scheduled job", () => {
  test("skips while another run of the job is still going, and runs once it is done", async () => {
    const firstRun: Gate = gate();
    const runFunction: jest.Mock<CronRunFunction> = jest.fn(
      async (): Promise<void> => {
        if (runFunction.mock.calls.length === 1) {
          await firstRun.promise;
        }
      },
    );
    const job: WorkerJobFunction = buildCronJobFunction({
      jobName: JOB_NAME,
      options: {},
      runFunction,
    });

    // Minute 1 starts and is still going at minute 2, and minute 3.
    const minuteOne: Promise<void> = runAsQueueJob(job);
    await settle();
    await runAsQueueJob(job);
    await runAsQueueJob(job);
    expect(runFunction).toHaveBeenCalledTimes(1);

    firstRun.open();
    await minuteOne;

    // Minute 4 finds the lock free.
    await runAsQueueJob(job);
    expect(runFunction).toHaveBeenCalledTimes(2);
    expect(mockLeases.size).toBe(0);
  });

  test("keeps runs of different jobs apart only from themselves", async () => {
    const slow: Gate = gate();
    const first: jest.Mock<CronRunFunction> = jest.fn(async () => {
      await slow.promise;
    });
    const second: jest.Mock<CronRunFunction> = jest.fn(async () => {});

    const firstRun: Promise<void> = runAsQueueJob(
      buildCronJobFunction({ jobName: "A:Job", options: {}, runFunction: first }),
    );
    await settle();
    await runAsQueueJob(
      buildCronJobFunction({ jobName: "B:Job", options: {}, runFunction: second }),
    );

    expect(second).toHaveBeenCalledTimes(1);
    slow.open();
    await firstRun;
  });

  test("gives the lock back when the run throws, and the error still fails the job", async () => {
    const failure: Error = new Error("database unreachable");
    const runFunction: jest.Mock<CronRunFunction> = jest
      .fn<CronRunFunction>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValue(undefined);
    const job: WorkerJobFunction = buildCronJobFunction({
      jobName: JOB_NAME,
      options: {},
      runFunction,
    });

    await expect(runAsQueueJob(job)).rejects.toBe(failure);
    expect(mockLeases.size).toBe(0);

    await runAsQueueJob(job);
    expect(runFunction).toHaveBeenCalledTimes(2);
  });

  test("hands the run its deadline, which passes at the time limit and stops its loop", async () => {
    let pages: number = 0;
    let stoppedBecause: Error | null = null;
    let seen: JobDeadline | null = null;
    const startedAt: number = Date.now();

    const job: WorkerJobFunction = buildCronJobFunction({
      jobName: JOB_NAME,
      options: {},
      runFunction: async (deadline: JobDeadline): Promise<void> => {
        seen = deadline;

        while (!deadline.hasPassed()) {
          // A page every minute of a slow database.
          await new Promise<void>((resolve: () => void) => {
            setTimeout(resolve, 60 * 1000);
          });
          pages++;
        }

        stoppedBecause = deadline.getReason();
      },
    });

    const run: Promise<void> = runAsQueueJob(job);
    const failed: Promise<void> =
      expect(run).rejects.toBeInstanceOf(TimeoutException);

    await settle();
    expect(seen!.endsAt?.getTime()).toBe(startedAt + FIVE_MINUTES);

    await advance(FIVE_MINUTES);
    await failed;

    // The page in flight at the limit finishes, and the loop stops there.
    await advance(60 * 1000);
    expect(pages).toBe(5);
    expect(stoppedBecause).toBeInstanceOf(TimeoutException);

    // The run ended, so its lock is back: the next run starts at once.
    expect(mockLeases.size).toBe(0);
    await advance(10 * 60 * 1000);
    expect(pages).toBe(5);
  });

  test("gives the lock back after its time limit and the grace, though its work never ends", async () => {
    const hang: Gate = gate();
    const runFunction: jest.Mock<CronRunFunction> = jest.fn(
      async (): Promise<void> => {
        if (runFunction.mock.calls.length === 1) {
          // Checks no deadline and never returns: a query that never comes back.
          await hang.promise;
        }
      },
    );
    const job: WorkerJobFunction = buildCronJobFunction({
      jobName: JOB_NAME,
      options: {},
      runFunction,
    });

    const hung: Promise<void> = runAsQueueJob(job);
    const failed: Promise<void> =
      expect(hung).rejects.toBeInstanceOf(TimeoutException);

    // Every minute until the limit, the next run skips: the hung one holds it.
    for (let minute: number = 1; minute <= 5; minute++) {
      await advance(60 * 1000, CRON_LOCK_KEEP_EVERY_MS);
      if (minute < 5) {
        await runAsQueueJob(job);
      }
    }
    await failed;
    expect(runFunction).toHaveBeenCalledTimes(1);

    // Still held during the grace...
    await advance(CRON_LOCK_GRACE_MS - 1000);
    await runAsQueueJob(job);
    expect(runFunction).toHaveBeenCalledTimes(1);

    // ...and given back at its end.
    await advance(1000);
    await runAsQueueJob(job);
    expect(runFunction).toHaveBeenCalledTimes(2);

    hang.open();
    await settle();
  });

  test("whose worker died mid-run leaves a lease that lapses within one lease", async () => {
    // A worker took the lock and was killed: nothing keeps or gives it back.
    mockLeases.set(`cron-run-${JOB_NAME}`, {
      holder: "a-worker-that-died",
      expiresAt: Date.now() + CRON_LOCK_LEASE_MS,
    });

    const runFunction: jest.Mock<CronRunFunction> = jest.fn(async () => {});
    const job: WorkerJobFunction = buildCronJobFunction({
      jobName: JOB_NAME,
      options: {},
      runFunction,
    });

    await runAsQueueJob(job);
    expect(runFunction).not.toHaveBeenCalled();

    await advance(CRON_LOCK_LEASE_MS);
    await runAsQueueJob(job);
    expect(runFunction).toHaveBeenCalledTimes(1);
  });

  test("is stopped by its deadline when its lease lapses under it", async () => {
    let stoppedBecause: Error | null = null;

    const job: WorkerJobFunction = buildCronJobFunction({
      jobName: JOB_NAME,
      options: {},
      runFunction: async (deadline: JobDeadline): Promise<void> => {
        // Valkey restarted and lost every lease.
        mockLeases.clear();

        while (!deadline.hasPassed()) {
          await new Promise<void>((resolve: () => void) => {
            setTimeout(resolve, 1000);
          });
        }

        stoppedBecause = deadline.getReason();
      },
    });

    const run: Promise<void> = runAsQueueJob(job);
    await advance(CRON_LOCK_KEEP_EVERY_MS + 1000);
    await run;

    expect(stoppedBecause?.message).toContain("lock lapsed");
  });

  test("runs without the lock when Valkey cannot be reached", async () => {
    mockValkeyDown = true;
    const runFunction: jest.Mock<CronRunFunction> = jest.fn(async () => {});

    await runAsQueueJob(
      buildCronJobFunction({ jobName: JOB_NAME, options: {}, runFunction }),
    );

    expect(runFunction).toHaveBeenCalledTimes(1);
    expect(Semaphore.release).not.toHaveBeenCalled();
  });

  test("of a job that allows overlap takes no lock and runs beside another", async () => {
    const slow: Gate = gate();
    const runFunction: jest.Mock<CronRunFunction> = jest.fn(
      async (): Promise<void> => {
        if (runFunction.mock.calls.length === 1) {
          await slow.promise;
        }
      },
    );
    const job: WorkerJobFunction = buildCronJobFunction({
      jobName: JOB_NAME,
      options: { allowOverlap: true },
      runFunction,
    });

    const first: Promise<void> = runAsQueueJob(job);
    await settle();
    await runAsQueueJob(job);

    expect(runFunction).toHaveBeenCalledTimes(2);
    expect(Semaphore.lock).not.toHaveBeenCalled();
    slow.open();
    await first;
  });

  test("run outside the queue still runs out of time at the job's limit", async () => {
    JobDictionary.setTimeoutInMs("Outside:Queue", 2000);
    let seen: JobDeadline | null = null;
    const hang: Gate = gate();

    const job: WorkerJobFunction = buildCronJobFunction({
      jobName: "Outside:Queue",
      options: {},
      runFunction: async (deadline: JobDeadline): Promise<void> => {
        seen = deadline;
        await hang.promise;
      },
    });

    const run: Promise<void> = job();
    await settle();
    expect(seen!.endsAt?.getTime()).toBe(Date.now() + 2000);

    await advance(2000, 500);
    expect(seen!.hasPassed()).toBe(true);

    hang.open();
    await run;
    expect(mockLeases.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe("RunCron", () => {
  test("registers the locked run under the job's name, with its time limit and schedule", async () => {
    const runFunction: jest.Mock<CronRunFunction> = jest.fn(async () => {});

    RunCron(
      "Registered:Job",
      { schedule: "* * * * *", runOnStartup: true, timeoutInMS: 90 * 1000 },
      runFunction,
    );

    expect(JobDictionary.getTimeoutInMs("Registered:Job")).toBe(90 * 1000);
    expect(Queue.addJob).toHaveBeenCalledWith(
      "Worker",
      "Registered:Job",
      "Registered:Job",
      {},
      { scheduleAt: "* * * * *" },
    );
    // Run on startup: once now, as well as on its schedule.
    expect(Queue.addJob).toHaveBeenCalledWith(
      "Worker",
      "Registered:Job",
      "Registered:Job",
      {},
      {},
    );

    // What the queue runs is the locked run, not the bare function.
    const registered: WorkerJobFunction =
      JobDictionary.getJobFunction("Registered:Job");
    expect(registered).not.toBe(runFunction);

    await runAsQueueJob(registered);
    expect(runFunction).toHaveBeenCalledTimes(1);
    expect(Semaphore.lock).toHaveBeenCalledWith(
      expect.objectContaining({ key: "Registered:Job" }),
    );
  });
});
