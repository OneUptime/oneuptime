import Semaphore, {
  SemaphoreMutex,
} from "../../../../Server/Infrastructure/Semaphore";
import logger from "../../../../Server/Utils/Logger";
import MonitorEvaluationLock, {
  MONITOR_EVALUATION_LOCK_CHECK_AFTER_MS,
  MONITOR_EVALUATION_LOCK_LOST_MESSAGE,
  MONITOR_EVALUATION_LOCK_NAMESPACE,
  MONITOR_EVALUATION_LOCK_REFRESH_INTERVAL_MS,
  MONITOR_EVALUATION_LOCK_TIMEOUT_MS,
} from "../../../../Server/Utils/Monitor/MonitorEvaluationLock";
import ServerException from "../../../../Types/Exception/ServerException";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { SpyInstance } from "jest-mock";

/*
 * THE LOCK A MONITOR'S EVALUATION HOLDS (issue #10108), unit by unit: what
 * it asks Valkey for, when keep() asks again, and how a loss stops the
 * evaluation instead of letting it write without the lock. The lock under a
 * real slow evaluation, over the real redis-semaphore, is
 * App/Tests/Workers/Jobs/TelemetryMonitor/GroupedMetricMonitorLock.test.ts.
 */

const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

interface FakeMutex {
  isAcquired: boolean;
  identifier: string;
}

let lockOptions: Parameters<typeof Semaphore.lock>[0] | undefined;
let mutex: FakeMutex;
let nowMs: number;

function acquire(): Promise<MonitorEvaluationLock> {
  return MonitorEvaluationLock.acquire({
    monitorId: MONITOR_ID,
    acquireTimeout: 2000,
    retryInterval: 100,
    acquireAttemptsLimit: 20,
  });
}

async function expectLost(lock: MonitorEvaluationLock): Promise<void> {
  let caught: unknown = null;

  try {
    await lock.keep();
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(ServerException);
  expect((caught as Error).message).toBe(MONITOR_EVALUATION_LOCK_LOST_MESSAGE);
}

beforeEach(() => {
  nowMs = 1_000_000;
  jest.spyOn(Date, "now").mockImplementation((): number => {
    return nowMs;
  });

  mutex = { isAcquired: true, identifier: "holder-1" };
  lockOptions = undefined;

  jest
    .spyOn(Semaphore, "lock")
    .mockImplementation(
      async (
        options: Parameters<typeof Semaphore.lock>[0],
      ): Promise<SemaphoreMutex> => {
        lockOptions = options;
        return mutex as unknown as SemaphoreMutex;
      },
    );
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);
  jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("MonitorEvaluationLock", () => {
  test("takes the monitor's lock as it always was, refreshed every second, and told of a loss", async () => {
    await acquire();

    expect(lockOptions).toMatchObject({
      key: MONITOR_ID.toString(),
      namespace: MONITOR_EVALUATION_LOCK_NAMESPACE,
      lockTimeout: MONITOR_EVALUATION_LOCK_TIMEOUT_MS,
      refreshInterval: MONITOR_EVALUATION_LOCK_REFRESH_INTERVAL_MS,
      acquireTimeout: 2000,
      retryInterval: 100,
      acquireAttemptsLimit: 20,
    });
    // A late refresh has four of the five seconds.
    expect(MONITOR_EVALUATION_LOCK_TIMEOUT_MS).toBe(5000);
    expect(MONITOR_EVALUATION_LOCK_REFRESH_INTERVAL_MS).toBe(1000);
    expect(MONITOR_EVALUATION_LOCK_CHECK_AFTER_MS).toBe(4000);
    expect(typeof lockOptions?.onLockLost).toBe("function");
  });

  test("a lock another holder keeps is refused as before", async () => {
    jest
      .spyOn(Semaphore, "lock")
      .mockRejectedValue(new Error("Acquire mutex timeout"));

    await expect(acquire()).rejects.toThrow("Acquire mutex timeout");
  });

  test("keep() asks Valkey nothing while the lock cannot have run out", async () => {
    const keepLock: SpyInstance<typeof Semaphore.keepLock> = jest
      .spyOn(Semaphore, "keepLock")
      .mockResolvedValue(true);
    const lock: MonitorEvaluationLock = await acquire();

    nowMs += MONITOR_EVALUATION_LOCK_CHECK_AFTER_MS - 1;
    await lock.keep();

    expect(keepLock).not.toHaveBeenCalled();
  });

  test("keep() re-asserts a lock not known held for four seconds, and carries on while it is", async () => {
    const keepLock: SpyInstance<typeof Semaphore.keepLock> = jest
      .spyOn(Semaphore, "keepLock")
      .mockResolvedValue(true);
    const lock: MonitorEvaluationLock = await acquire();

    nowMs += MONITOR_EVALUATION_LOCK_CHECK_AFTER_MS;
    await lock.keep();

    expect(keepLock).toHaveBeenCalledTimes(1);
    expect(keepLock.mock.calls[0]![0]).toBe(mutex);

    // Known held again from then: the next keep() asks nothing.
    nowMs += 10;
    await lock.keep();
    expect(keepLock).toHaveBeenCalledTimes(1);
    expect(lock.isLost()).toBe(false);
  });

  test("a lock that ran out while the loop was stalled stops the evaluation at keep()", async () => {
    jest.spyOn(Semaphore, "keepLock").mockResolvedValue(false);
    const lock: MonitorEvaluationLock = await acquire();

    // The event loop was held for longer than the lock lasts.
    nowMs += MONITOR_EVALUATION_LOCK_TIMEOUT_MS + 1_000;

    await expectLost(lock);
    expect(lock.isLost()).toBe(true);
    // And at every keep() after, without asking again.
    await expectLost(lock);
    expect(Semaphore.keepLock).toHaveBeenCalledTimes(1);
  });

  test("a loss the refresh timer finds stops the evaluation, said once", async () => {
    const lock: MonitorEvaluationLock = await acquire();

    // What redis-semaphore does when a refresh finds the key gone.
    mutex.isAcquired = false;
    lockOptions!.onLockLost!(
      new Error(
        "Lost mutex for key mutex:MonitorResourceUtil.monitorResource-x",
      ),
    );

    await expectLost(lock);
    await expectLost(lock);

    const lines: Array<string> = (
      logger.error as unknown as jest.Mock
    ).mock.calls.map((call: Array<unknown>): string => {
      return String(call[0]);
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(MONITOR_ID.toString());
    expect(lines[0]).toContain("lost its lock");
  });

  test("a lock the library no longer holds is lost, even before the timer said so", async () => {
    const lock: MonitorEvaluationLock = await acquire();

    mutex.isAcquired = false;

    await expectLost(lock);
  });

  test("Valkey that cannot be reached cannot vouch for the lock: the evaluation stops", async () => {
    jest
      .spyOn(Semaphore, "keepLock")
      .mockRejectedValue(new Error("Connection is closed."));
    const lock: MonitorEvaluationLock = await acquire();

    nowMs += MONITOR_EVALUATION_LOCK_CHECK_AFTER_MS;

    await expectLost(lock);
  });

  test("once given back, keep() lets the evaluation write what it writes without the lock", async () => {
    const lock: MonitorEvaluationLock = await acquire();

    await lock.release();

    nowMs += MONITOR_EVALUATION_LOCK_TIMEOUT_MS * 10;
    await lock.keep();

    expect(Semaphore.release).toHaveBeenCalledTimes(1);

    // Given back once, however often it is asked.
    await lock.release();
    expect(Semaphore.release).toHaveBeenCalledTimes(1);
  });

  test("a lock that cannot be given back is logged, never thrown: it runs out", async () => {
    jest
      .spyOn(Semaphore, "release")
      .mockRejectedValue(new Error("Connection is closed."));
    const lock: MonitorEvaluationLock = await acquire();

    await expect(lock.release()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
