import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import logger from "../../../../Server/Utils/Logger";
import OnCallPolicyRunRetries from "../../../../Server/Utils/OnCall/OnCallPolicyRunRetries";
import DatabaseNotConnectedException from "../../../../Types/Exception/DatabaseNotConnectedException";
import ObjectID from "../../../../Types/ObjectID";
import { OnCallPolicyRunFailures } from "../../../../Types/OnCallDutyPolicy/OnCallPolicyRunRetry";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHERE A POLICY RUN'S FAILED TRIES ARE KEPT BETWEEN TICKS (issue #8167).
 *
 * The worker's ticks run on any replica, and a replica restarts: a run's
 * failed tries are kept in Redis, so the next tick knows how many there
 * were and when to try again, wherever it runs. Nothing here throws - a
 * Redis that is down reads as no failures, and the run is tried as it was
 * before it had any.
 */

const RUN_A: ObjectID = new ObjectID("81670000-0000-4000-8000-0000000000a1");
const RUN_B: ObjectID = new ObjectID("81670000-0000-4000-8000-0000000000b1");
const RUN_C: ObjectID = new ObjectID("81670000-0000-4000-8000-0000000000c1");

const FAILURES: OnCallPolicyRunFailures = {
  failedTries: 3,
  firstFailedAt: new Date("2026-11-15T03:00:00.000Z"),
  lastFailedAt: new Date("2026-11-15T03:03:00.000Z"),
  retryAt: new Date("2026-11-15T03:07:00.000Z"),
  lastError: "Connection terminated unexpectedly",
};

// Redis, in memory: what is kept, under the namespace and the key.
let kept: Map<string, { value: string; expiresInSeconds?: number }>;

beforeEach(() => {
  kept = new Map();

  jest.spyOn(logger, "debug").mockImplementation((() => {}) as never);

  jest.spyOn(GlobalCache, "setString").mockImplementation((async (
    namespace: string,
    key: string,
    value: string,
    options?: { expiresInSeconds: number },
  ) => {
    kept.set(`${namespace}-${key}`, {
      value: value,
      ...(options ? { expiresInSeconds: options.expiresInSeconds } : {}),
    });
  }) as never);

  jest.spyOn(GlobalCache, "getStrings").mockImplementation((async (
    namespace: string,
    keys: Array<string>,
  ) => {
    return keys.map((key: string) => {
      return kept.get(`${namespace}-${key}`)?.value || null;
    });
  }) as never);

  jest.spyOn(GlobalCache, "deleteKey").mockImplementation((async (
    namespace: string,
    key: string,
  ) => {
    kept.delete(`${namespace}-${key}`);
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("keeping a run's failures", () => {
  test("what is kept is read back as it was", async () => {
    await OnCallPolicyRunRetries.remember(RUN_A, FAILURES);

    const read: Map<string, OnCallPolicyRunFailures> =
      await OnCallPolicyRunRetries.read([RUN_A]);

    expect(read.get(RUN_A.toString())).toEqual(FAILURES);
  });

  test("is kept long past a run's last try", async () => {
    await OnCallPolicyRunRetries.remember(RUN_A, FAILURES);

    expect(
      kept.get(`${OnCallPolicyRunRetries.CACHE_NAMESPACE}-${RUN_A.toString()}`)
        ?.expiresInSeconds,
    ).toBe(6 * 60 * 60);
  });

  test("a page of runs is read in one round trip, and only runs with failures are in it", async () => {
    await OnCallPolicyRunRetries.remember(RUN_B, FAILURES);

    const read: Map<string, OnCallPolicyRunFailures> =
      await OnCallPolicyRunRetries.read([RUN_A, RUN_B, null, RUN_C, undefined]);

    expect(GlobalCache.getStrings).toHaveBeenCalledTimes(1);
    expect(GlobalCache.getStrings).toHaveBeenCalledWith(
      OnCallPolicyRunRetries.CACHE_NAMESPACE,
      [RUN_A.toString(), RUN_B.toString(), RUN_C.toString()],
    );
    expect(Array.from(read.keys())).toEqual([RUN_B.toString()]);
  });

  test("no runs is no round trip", async () => {
    expect((await OnCallPolicyRunRetries.read([])).size).toBe(0);
    expect(GlobalCache.getStrings).not.toHaveBeenCalled();
  });

  test("a run whose try went through is forgotten", async () => {
    await OnCallPolicyRunRetries.remember(RUN_A, FAILURES);
    await OnCallPolicyRunRetries.forget(RUN_A);

    expect((await OnCallPolicyRunRetries.read([RUN_A])).size).toBe(0);
  });

  test("a run with no id is neither kept nor forgotten", async () => {
    await OnCallPolicyRunRetries.remember(null, FAILURES);
    await OnCallPolicyRunRetries.forget(undefined);

    expect(GlobalCache.setString).not.toHaveBeenCalled();
    expect(GlobalCache.deleteKey).not.toHaveBeenCalled();
  });
});

describe("a Redis that is down", () => {
  test("reads as no failures: the run is tried", async () => {
    jest
      .spyOn(GlobalCache, "getStrings")
      .mockRejectedValue(
        new DatabaseNotConnectedException("Cache is not connected") as never,
      );

    await expect(OnCallPolicyRunRetries.read([RUN_A])).resolves.toEqual(
      new Map(),
    );
  });

  test("keeps nothing, and does not throw", async () => {
    jest
      .spyOn(GlobalCache, "setString")
      .mockRejectedValue(new Error("Connection is closed.") as never);
    jest
      .spyOn(GlobalCache, "deleteKey")
      .mockRejectedValue(new Error("Connection is closed.") as never);

    await expect(
      OnCallPolicyRunRetries.remember(RUN_A, FAILURES),
    ).resolves.toBeUndefined();
    await expect(OnCallPolicyRunRetries.forget(RUN_A)).resolves.toBeUndefined();
  });
});

describe("what is read back", () => {
  test.each([
    ["nothing", null],
    ["an empty string", ""],
    ["not JSON", "{oops"],
    ["JSON that is not failures", '"hello"'],
    [
      "no tries",
      JSON.stringify({
        failedTries: 0,
        firstFailedAt: 1,
        lastFailedAt: 1,
        retryAt: 1,
      }),
    ],
    [
      "a count that is not a whole number",
      JSON.stringify({
        failedTries: 1.5,
        firstFailedAt: 1,
        lastFailedAt: 1,
        retryAt: 1,
      }),
    ],
    [
      "a moment missing",
      JSON.stringify({ failedTries: 2, firstFailedAt: 1, lastFailedAt: 1 }),
    ],
    [
      "a moment that is not one",
      JSON.stringify({
        failedTries: 2,
        firstFailedAt: "soon",
        lastFailedAt: 1,
        retryAt: 1,
      }),
    ],
  ])("is no failures for %s", (_name: string, value: string | null) => {
    expect(OnCallPolicyRunRetries.fromCacheValue(value)).toBeNull();
  });

  test("a kept error that is not text reads as none", () => {
    expect(
      OnCallPolicyRunRetries.fromCacheValue(
        JSON.stringify({
          failedTries: 2,
          firstFailedAt: 1,
          lastFailedAt: 2,
          retryAt: 3,
          lastError: 42,
        }),
      )?.lastError,
    ).toBe("");
  });

  test("moments are kept as milliseconds", () => {
    expect(JSON.parse(OnCallPolicyRunRetries.toCacheValue(FAILURES))).toEqual({
      failedTries: 3,
      firstFailedAt: FAILURES.firstFailedAt.getTime(),
      lastFailedAt: FAILURES.lastFailedAt.getTime(),
      retryAt: FAILURES.retryAt.getTime(),
      lastError: "Connection terminated unexpectedly",
    });
  });
});
