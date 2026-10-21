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

/*
 * The run permits are shared by every project on the server, and a run sends
 * one notification at a time. So one project's notifications also take one
 * of a few per-project slots each: a tenant whose sends are slow - its own
 * mail server hangs, or it posts a burst of notes on a large page - holds at
 * most that many runs of a job, and the rest keep sending everyone else's.
 */
describe("SubscriberNotificationRunLimit.takeProjectSlot", () => {
  const PROJECT_ID: string = "10000000-0000-4000-8000-00000000000A";

  test("a project gets fewer slots than the job has runs", () => {
    expect(
      SubscriberNotificationRunLimit.MAX_CONCURRENT_SENDS_PER_PROJECT,
    ).toBeGreaterThanOrEqual(1);
    expect(
      SubscriberNotificationRunLimit.MAX_CONCURRENT_SENDS_PER_PROJECT,
    ).toBeLessThan(SubscriberNotificationRunLimit.MAX_CONCURRENT_RUNS_PER_JOB);
  });

  test("takes one of the project's slots for this job, and gives it back", async () => {
    const slot: Awaited<
      ReturnType<typeof SubscriberNotificationRunLimit.takeProjectSlot>
    > = await SubscriberNotificationRunLimit.takeProjectSlot({
      jobName: JOB_NAME,
      projectId: PROJECT_ID,
    });

    expect(slot).not.toBeNull();
    expect(acquire.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        // Per job and project; the project id as it is stored.
        key: `${JOB_NAME}:${PROJECT_ID.toLowerCase()}`,
        namespace: SubscriberNotificationRunLimit.PROJECT_NAMESPACE,
        limit: SubscriberNotificationRunLimit.MAX_CONCURRENT_SENDS_PER_PROJECT,
        lockTimeout: SubscriberNotificationRunLimit.PERMIT_TTL_IN_MS,
        acquireAttemptsLimit: 1,
      }),
    );

    await slot!.release();
    expect(release).toHaveBeenCalledWith(permit);
  });

  test("a project that already has its share being sent gets none: its notification waits", async () => {
    acquire.mockRejectedValue(
      new SemaphoreLockTimeoutError("Acquire semaphore timeout") as never,
    );

    await expect(
      SubscriberNotificationRunLimit.takeProjectSlot({
        jobName: JOB_NAME,
        projectId: PROJECT_ID,
      }),
    ).resolves.toBeNull();
  });

  test("sends without a slot when Redis cannot be reached, as a run does without its permit", async () => {
    acquire.mockRejectedValue(
      new Error("Redis client is not connected") as never,
    );

    const slot: Awaited<
      ReturnType<typeof SubscriberNotificationRunLimit.takeProjectSlot>
    > = await SubscriberNotificationRunLimit.takeProjectSlot({
      jobName: JOB_NAME,
      projectId: PROJECT_ID,
    });

    expect(slot).not.toBeNull();
    await slot!.release();
    expect(release).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  test("a notification without a project is not bounded by one", async () => {
    const slot: Awaited<
      ReturnType<typeof SubscriberNotificationRunLimit.takeProjectSlot>
    > = await SubscriberNotificationRunLimit.takeProjectSlot({
      jobName: JOB_NAME,
      projectId: undefined,
    });

    expect(slot).not.toBeNull();
    expect(acquire).not.toHaveBeenCalled();
  });

  test("a slot that cannot be given back does not throw: it lapses", async () => {
    release.mockRejectedValue(new Error("connection reset") as never);

    const slot: Awaited<
      ReturnType<typeof SubscriberNotificationRunLimit.takeProjectSlot>
    > = await SubscriberNotificationRunLimit.takeProjectSlot({
      jobName: JOB_NAME,
      projectId: PROJECT_ID,
    });

    await expect(slot!.release()).resolves.toBeUndefined();
  });
});
