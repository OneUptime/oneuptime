import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ONE RUN OF A SCHEDULED JOB AT A TIME (CronLock).
 *
 * The lock is a lease kept while its run goes on, given back when the run
 * ends, and never held past GRACE_MS after the run's time limit - however
 * the run's work behaves - so it can never strand the job. Semaphore is
 * mocked here so each Valkey answer can be chosen; CronLockValkey.test.ts
 * runs the same lock on a real Valkey.
 */

class MockLockTimeoutError extends Error {}

jest.mock("Common/Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    SemaphoreLockTimeoutError: MockLockTimeoutError,
    default: {
      lock: jest.fn(),
      keepLock: jest.fn(),
      release: jest.fn(),
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

import Semaphore from "Common/Server/Infrastructure/Semaphore";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import CronLock, {
  CRON_LOCK_GRACE_MS,
  CRON_LOCK_KEEP_EVERY_MS,
  CRON_LOCK_LEASE_MS,
  CRON_LOCK_NAMESPACE,
  CronLockTake,
  CronLockTakeResult,
} from "../../../FeatureSet/Workers/Utils/CronLock";

type AnyMock = jest.Mock<(...args: Array<any>) => any>;

const semaphore: { lock: AnyMock; keepLock: AnyMock; release: AnyMock } =
  Semaphore as unknown as {
    lock: AnyMock;
    keepLock: AnyMock;
    release: AnyMock;
  };

const JOB_NAME: string = "OnCallDutyPolicyExecutionLog:ExecutePendingExecutions";

const mutex: { identifier: string } = { identifier: "held-by-this-run" };

// Lets the promises a timer callback started settle.
async function settle(): Promise<void> {
  for (let tick: number = 0; tick < 10; tick++) {
    await Promise.resolve();
  }
}

async function advance(ms: number): Promise<void> {
  jest.advanceTimersByTime(ms);
  await settle();
}

beforeEach(() => {
  // Node's performance and hrtime are read-only: Jest 28 cannot fake them.
  jest.useFakeTimers({ doNotFake: ["performance", "hrtime"] });
  semaphore.lock.mockReset();
  semaphore.keepLock.mockReset();
  semaphore.release.mockReset();
  semaphore.lock.mockResolvedValue(mutex);
  semaphore.keepLock.mockResolvedValue(true);
  semaphore.release.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe("CronLock.take", () => {
  test("takes a lease named after the job, in one try, kept by CronLock alone", async () => {
    const take: CronLockTake = await CronLock.take({
      jobName: JOB_NAME,
      deadline: new JobDeadline(),
    });

    expect(take.result).toBe(CronLockTakeResult.Taken);
    expect(semaphore.lock).toHaveBeenCalledTimes(1);
    expect(semaphore.lock).toHaveBeenCalledWith(
      expect.objectContaining({
        key: JOB_NAME,
        namespace: CRON_LOCK_NAMESPACE,
        lockTimeout: CRON_LOCK_LEASE_MS,
        acquireAttemptsLimit: 1,
        // Never redis-semaphore's own timer, which keeps it for ever.
        refreshInterval: 0,
      }),
    );

    await take.release();
  });

  test("says the lock is held when another run holds it, and gives nothing back", async () => {
    semaphore.lock.mockRejectedValue(new MockLockTimeoutError("held"));

    const take: CronLockTake = await CronLock.take({
      jobName: JOB_NAME,
      deadline: new JobDeadline(),
    });

    expect(take.result).toBe(CronLockTakeResult.HeldByAnotherRun);
    await take.release();
    expect(semaphore.release).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  test("says Valkey is unavailable on any other error, so the run goes on unlocked", async () => {
    semaphore.lock.mockRejectedValue(new Error("Redis client is not connected"));

    const take: CronLockTake = await CronLock.take({
      jobName: JOB_NAME,
      deadline: new JobDeadline(),
    });

    expect(take.result).toBe(CronLockTakeResult.Unavailable);
    await take.release();
    expect(semaphore.release).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe("a held lock", () => {
  test("is kept every KEEP_EVERY_MS for as long as its run goes on", async () => {
    const take: CronLockTake = await CronLock.take({
      jobName: JOB_NAME,
      deadline: new JobDeadline(),
    });

    expect(CRON_LOCK_KEEP_EVERY_MS * 3).toBeLessThanOrEqual(
      CRON_LOCK_LEASE_MS,
    );

    await advance(CRON_LOCK_KEEP_EVERY_MS - 1);
    expect(semaphore.keepLock).not.toHaveBeenCalled();

    await advance(1);
    expect(semaphore.keepLock).toHaveBeenCalledTimes(1);
    expect(semaphore.keepLock).toHaveBeenCalledWith(mutex);

    for (let tick: number = 0; tick < 3; tick++) {
      await advance(CRON_LOCK_KEEP_EVERY_MS);
    }
    expect(semaphore.keepLock).toHaveBeenCalledTimes(4);

    await take.release();
  });

  test("never starts a keep while the last one is still waiting on Valkey", async () => {
    let answer: (isKept: boolean) => void = () => {};
    semaphore.keepLock.mockImplementation(() => {
      return new Promise<boolean>((resolve: (isKept: boolean) => void) => {
        answer = resolve;
      });
    });

    const take: CronLockTake = await CronLock.take({
      jobName: JOB_NAME,
      deadline: new JobDeadline(),
    });

    // Valkey is slow: three ticks go by while the first keep waits.
    for (let tick: number = 0; tick < 3; tick++) {
      await advance(CRON_LOCK_KEEP_EVERY_MS);
    }
    expect(semaphore.keepLock).toHaveBeenCalledTimes(1);

    answer(true);
    await settle();
    await advance(CRON_LOCK_KEEP_EVERY_MS);
    expect(semaphore.keepLock).toHaveBeenCalledTimes(2);

    answer(true);
    await take.release();
  });

  test("is given back once, stops being kept, and leaves no timer behind", async () => {
    const take: CronLockTake = await CronLock.take({
      jobName: JOB_NAME,
      deadline: new JobDeadline(),
    });

    await take.release();
    await take.release();

    expect(semaphore.release).toHaveBeenCalledTimes(1);
    expect(semaphore.release).toHaveBeenCalledWith(mutex);
    expect(jest.getTimerCount()).toBe(0);

    await advance(CRON_LOCK_KEEP_EVERY_MS * 4);
    expect(semaphore.keepLock).not.toHaveBeenCalled();
  });

  test("a release Valkey refuses is logged, never thrown: the lease lapses anyway", async () => {
    semaphore.release.mockRejectedValue(new Error("connection reset"));

    const take: CronLockTake = await CronLock.take({
      jobName: JOB_NAME,
      deadline: new JobDeadline(),
    });

    await expect(take.release()).resolves.toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);
  });

  test("whose lease lapsed ends its run's deadline, and is kept no more", async () => {
    const deadline: JobDeadline = new JobDeadline();
    const take: CronLockTake = await CronLock.take({
      jobName: JOB_NAME,
      deadline: deadline,
    });

    semaphore.keepLock.mockResolvedValue(false);
    await advance(CRON_LOCK_KEEP_EVERY_MS);

    expect(deadline.hasPassed()).toBe(true);
    expect(deadline.getReason()?.message).toContain("lock lapsed");

    await advance(CRON_LOCK_KEEP_EVERY_MS * 4);
    expect(semaphore.keepLock).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);

    // Giving it back cannot take another run's lock: the release is by identifier.
    await take.release();
    expect(semaphore.release).toHaveBeenCalledTimes(1);
  });

  test("that cannot be kept for a moment (Valkey down) keeps its run going and tries again", async () => {
    const deadline: JobDeadline = new JobDeadline();
    const take: CronLockTake = await CronLock.take({
      jobName: JOB_NAME,
      deadline: deadline,
    });

    semaphore.keepLock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await advance(CRON_LOCK_KEEP_EVERY_MS);
    expect(deadline.hasPassed()).toBe(false);

    await advance(CRON_LOCK_KEEP_EVERY_MS);
    expect(semaphore.keepLock).toHaveBeenCalledTimes(2);
    expect(deadline.hasPassed()).toBe(false);

    await take.release();
  });

  test("is given back GRACE_MS after the run's time limit, though its work never ends", async () => {
    const deadline: JobDeadline = new JobDeadline();
    await CronLock.take({ jobName: JOB_NAME, deadline: deadline });

    // The run's time limit runs out; its work hangs and never gives it back.
    deadline.end();

    await advance(CRON_LOCK_GRACE_MS - 1);
    expect(semaphore.release).not.toHaveBeenCalled();

    await advance(1);
    expect(semaphore.release).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);

    // Not kept past that either.
    const keptBefore: number = semaphore.keepLock.mock.calls.length;
    await advance(CRON_LOCK_LEASE_MS * 2);
    expect(semaphore.keepLock.mock.calls.length).toBe(keptBefore);
  });

  test("a run that stops at its deadline gives the lock back then, without waiting out the grace", async () => {
    const deadline: JobDeadline = new JobDeadline();
    const take: CronLockTake = await CronLock.take({
      jobName: JOB_NAME,
      deadline: deadline,
    });

    deadline.end();
    await take.release();

    expect(semaphore.release).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);

    await advance(CRON_LOCK_GRACE_MS);
    expect(semaphore.release).toHaveBeenCalledTimes(1);
  });

  test("taken for a run whose deadline passed already is given back after the grace", async () => {
    const deadline: JobDeadline = new JobDeadline();
    deadline.end();

    await CronLock.take({ jobName: JOB_NAME, deadline: deadline });

    await advance(CRON_LOCK_GRACE_MS);
    expect(semaphore.release).toHaveBeenCalledTimes(1);
  });

  test("never holds the job longer than its time limit, the grace and one lease", () => {
    // What a run that hangs costs the next one, for the default 5-minute limit.
    const worstCaseMs: number =
      5 * 60 * 1000 + CRON_LOCK_GRACE_MS + CRON_LOCK_LEASE_MS;

    expect(worstCaseMs).toBeLessThanOrEqual(7 * 60 * 1000);
    expect(CRON_LOCK_GRACE_MS).toBeLessThan(CRON_LOCK_LEASE_MS);
  });
});
