import Semaphore, {
  SemaphoreLockTimeoutError,
  SemaphorePermit,
} from "../../../../Server/Infrastructure/Semaphore";
import SubscriberNotificationRunLimit from "../../../../Server/Utils/StatusPage/SubscriberNotificationRunLimit";
import SubscriberNotificationTiming from "../../../../Server/Utils/StatusPage/SubscriberNotificationTiming";
import logger from "../../../../Server/Utils/Logger";
import { JSONObject } from "../../../../Types/JSON";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * The subscriber jobs run every minute on the shared Worker queue and await
 * their sends, so their runs overlap; without a bound, slow sends during an
 * outage could hold most of the Worker consumer's slots and starve on-call
 * escalation and every other cron. A run takes one of a few permits per job
 * first (SubscriberNotificationRunLimit), and returns at once when they are
 * all taken.
 */

const JOB_NAME: string = "IncidentPublicNote:SendNotificationToSubscribers";

// The nine subscriber jobs, and the Worker consumer's default concurrency.
const SUBSCRIBER_JOB_COUNT: number = 9;
const DEFAULT_WORKER_CONCURRENCY: number = 100;

let acquire: SpyInstance<typeof Semaphore.acquirePermit>;
let release: SpyInstance<typeof Semaphore.releasePermit>;
let permit: SemaphorePermit;

beforeEach(() => {
  permit = { identifier: "permit-1" } as unknown as SemaphorePermit;

  acquire = jest
    .spyOn(Semaphore, "acquirePermit")
    .mockResolvedValue(permit as never);
  release = jest
    .spyOn(Semaphore, "releasePermit")
    .mockResolvedValue(undefined as never);

  jest.spyOn(logger, "warn").mockImplementation((() => {}) as never);
  jest.spyOn(logger, "debug").mockImplementation((() => {}) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SubscriberNotificationRunLimit", () => {
  test("keeps the nine jobs well inside the Worker consumer's slots", () => {
    expect(
      SubscriberNotificationRunLimit.MAX_CONCURRENT_RUNS_PER_JOB *
        SUBSCRIBER_JOB_COUNT,
    ).toBeLessThanOrEqual(DEFAULT_WORKER_CONCURRENCY / 2);
    expect(
      SubscriberNotificationRunLimit.MAX_CONCURRENT_RUNS_PER_JOB,
    ).toBeGreaterThanOrEqual(2);
  });

  test("a dead worker's permit lapses long before the job timeout", () => {
    expect(SubscriberNotificationRunLimit.PERMIT_TTL_IN_MS).toBeLessThan(
      SubscriberNotificationTiming.JOB_TIMEOUT_IN_MS / 5,
    );
  });

  test("runs while holding one of the job's permits, and gives it back after", async () => {
    const order: Array<string> = [];
    acquire.mockImplementation((async () => {
      order.push("acquire");
      return permit;
    }) as never);
    release.mockImplementation((async () => {
      order.push("release");
    }) as never);

    await SubscriberNotificationRunLimit.limit(JOB_NAME, async () => {
      order.push("run");
    })();

    expect(order).toEqual(["acquire", "run", "release"]);
    expect(release).toHaveBeenCalledWith(permit);

    const options: JSONObject = acquire.mock.calls[0]![0] as JSONObject;
    expect(options).toEqual(
      expect.objectContaining({
        key: JOB_NAME,
        namespace: SubscriberNotificationRunLimit.NAMESPACE,
        limit: SubscriberNotificationRunLimit.MAX_CONCURRENT_RUNS_PER_JOB,
        lockTimeout: SubscriberNotificationRunLimit.PERMIT_TTL_IN_MS,
        acquireAttemptsLimit: 1,
      }),
    );
  });

  test("each job has its own permits", async () => {
    await SubscriberNotificationRunLimit.limit("Job:A", async () => {})();
    await SubscriberNotificationRunLimit.limit("Job:B", async () => {})();

    expect(
      acquire.mock.calls.map((call: Array<unknown>): unknown => {
        return (call[0] as JSONObject)["key"];
      }),
    ).toEqual(["Job:A", "Job:B"]);
  });

  test("when every permit is taken, the run does not run: its notifications wait for the next", async () => {
    acquire.mockRejectedValue(
      new SemaphoreLockTimeoutError("Acquire semaphore timeout") as never,
    );
    const run: MockFunction = getJestMockFunction();

    await SubscriberNotificationRunLimit.limit(JOB_NAME, async () => {
      run();
    })();

    expect(run).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  test("gives the permit back when the run throws, and lets the error through", async () => {
    await expect(
      SubscriberNotificationRunLimit.limit(JOB_NAME, async () => {
        throw new Error("database hiccup");
      })(),
    ).rejects.toThrow("database hiccup");

    expect(release).toHaveBeenCalledWith(permit);
  });

  test("runs without a permit when Redis cannot be reached for one", async () => {
    acquire.mockRejectedValue(
      new Error("Redis client is not connected") as never,
    );
    const run: MockFunction = getJestMockFunction();

    await SubscriberNotificationRunLimit.limit(JOB_NAME, async () => {
      run();
    })();

    expect(run).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  test("a permit that cannot be given back does not fail the run: it lapses", async () => {
    release.mockRejectedValue(new Error("connection reset") as never);

    await expect(
      SubscriberNotificationRunLimit.limit(JOB_NAME, async () => {})(),
    ).resolves.toBeUndefined();
  });

  test("a permit lost while sending is logged, not thrown from a timer", async () => {
    await SubscriberNotificationRunLimit.limit(JOB_NAME, async () => {})();

    const onLockLost: (err: Error) => void = (
      acquire.mock.calls[0]![0] as { onLockLost: (err: Error) => void }
    ).onLockLost;

    expect(() => {
      onLockLost(new Error("Lost semaphore for key"));
    }).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("lost its run permit"),
    );
  });
});
