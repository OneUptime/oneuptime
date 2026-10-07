import Redis, { ClientType } from "../../../Server/Infrastructure/Redis";
import Semaphore, {
  SemaphoreMutex,
} from "../../../Server/Infrastructure/Semaphore";
import { Mutex as RedisMutex } from "redis-semaphore";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * Companion to SemaphorePermit.test.ts, covering the OTHER half of Semaphore:
 * lock()/release(), the exclusive mutex.
 *
 * This is the primitive every cross-process critical section in the codebase
 * runs on -- project counters, timeline writes, the SLO sweep, and the
 * first-Master-Admin election (GHSA-3qqq-hprx-g2jw). What is pinned here is the
 * option plumbing between our wrapper and redis-semaphore: a lockTimeout or
 * acquireTimeout silently dropped on the way through would not fail any test
 * about election outcomes, it would just quietly turn a bounded wait into an
 * unbounded one, or a self-refreshing lock into one with the library default.
 */

interface MockMutex {
  acquire: jest.Mock;
  release: jest.Mock;
  tryAcquire: jest.Mock;
  identifier: string;
  isAcquired: boolean;
}

// What a re-assert of a held lock finds in Valkey: still the holder's, or not.
let stillHeld: boolean = true;

jest.mock("redis-semaphore", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "redis-semaphore",
  ) as Record<string, unknown>;

  return {
    ...actual,
    Mutex: jest.fn().mockImplementation((): MockMutex => {
      const mutex: MockMutex = {
        acquire: jest.fn(async (): Promise<void> => {}),
        release: jest.fn(async (): Promise<void> => {
          mutex.isAcquired = false;
        }),
        tryAcquire: jest.fn(async (): Promise<boolean> => {
          return stillHeld;
        }),
        identifier: `holder-${Math.random()}`,
        isAcquired: true,
      };
      return mutex;
    }),
  };
});

const redisMutexConstructor: jest.MockedClass<typeof RedisMutex> =
  RedisMutex as jest.MockedClass<typeof RedisMutex>;

function mockRedisClient(): ClientType {
  const client: ClientType = {} as ClientType;
  jest.spyOn(Redis, "getClient").mockReturnValue(client);
  return client;
}

function lastMockMutex(): MockMutex {
  /*
   * Indexed rather than .at(-1): this project targets es2017, so
   * Array.prototype.at is outside its lib.
   */
  const results: Array<{ value: unknown }> = redisMutexConstructor.mock.results;
  const result: unknown = results[results.length - 1]?.value;
  return result as MockMutex;
}

afterEach(() => {
  jest.restoreAllMocks();
  redisMutexConstructor.mockClear();
  stillHeld = true;
});

describe("Semaphore exclusive mutex", () => {
  test("constructs and acquires with every option forwarded", async () => {
    const client: ClientType = mockRedisClient();

    const mutex: SemaphoreMutex = await Semaphore.lock({
      key: "instance",
      namespace: "UserService.firstMasterAdminElection",
      lockTimeout: 10_000,
      acquireTimeout: 5_000,
      acquireAttemptsLimit: 4,
      retryInterval: 25,
    });

    expect(redisMutexConstructor).toHaveBeenCalledWith(
      client,
      "UserService.firstMasterAdminElection-instance",
      {
        lockTimeout: 10_000,
        acquireTimeout: 5_000,
        acquireAttemptsLimit: 4,
        retryInterval: 25,
      },
    );
    expect(lastMockMutex().acquire).toHaveBeenCalledTimes(1);
    expect(mutex).toBe(lastMockMutex());
  });

  /*
   * A long sweep that polls mutex.isAcquired between pages needs both: a
   * refresh interval short enough for the flag to be current (it only turns
   * false when a refresh finds the lock gone), and a lock-lost handler, or
   * redis-semaphore throws from its refresh timer where nothing can catch it.
   */
  test("forwards refreshInterval and onLockLost when the caller sets them", async () => {
    const client: ClientType = mockRedisClient();
    const onLockLost: (err: Error) => void = (): void => {};

    await Semaphore.lock({
      key: "Rum:PublishSessionReplayBudgetMetrics",
      namespace: "Workers.Cron",
      lockTimeout: 240_000,
      acquireAttemptsLimit: 1,
      refreshInterval: 30_000,
      onLockLost: onLockLost,
    });

    expect(redisMutexConstructor).toHaveBeenCalledWith(
      client,
      "Workers.Cron-Rum:PublishSessionReplayBudgetMetrics",
      {
        lockTimeout: 240_000,
        acquireAttemptsLimit: 1,
        refreshInterval: 30_000,
        onLockLost: onLockLost,
      },
    );
  });

  /*
   * A lock its holder may never give back - a write that fails between its
   * check and its end - asks for no refreshing at all, so it runs out after
   * lockTimeout instead of being kept alive by the process.
   */
  test("forwards a refreshInterval of 0, which turns refreshing off", async () => {
    const client: ClientType = mockRedisClient();

    await Semaphore.lock({
      key: "project-1",
      namespace: "ProjectSsoProviderChanges.keepAWayIn",
      lockTimeout: 15_000,
      refreshInterval: 0,
    });

    expect(redisMutexConstructor).toHaveBeenCalledWith(
      client,
      "ProjectSsoProviderChanges.keepAWayIn-project-1",
      {
        lockTimeout: 15_000,
        refreshInterval: 0,
      },
    );
  });

  test("leaves refreshInterval to redis-semaphore when the caller does not set it", async () => {
    mockRedisClient();

    await Semaphore.lock({
      key: "project-1",
      namespace: "ProjectService.incidentCounter",
      lockTimeout: 15_000,
    });

    const options: Record<string, unknown> = redisMutexConstructor.mock
      .calls[0]![2] as Record<string, unknown>;

    expect(
      Object.prototype.hasOwnProperty.call(options, "refreshInterval"),
    ).toBe(false);
  });

  test("composes the Redis key as namespace-key", async () => {
    mockRedisClient();

    await Semaphore.lock({
      key: "project-1",
      namespace: "ProjectService.incidentCounter",
    });

    /*
     * Callers coordinate purely by agreeing on this string. Two replicas that
     * compose it differently exclude nobody.
     */
    expect(redisMutexConstructor).toHaveBeenCalledWith(
      expect.anything(),
      "ProjectService.incidentCounter-project-1",
      expect.anything(),
    );
  });

  test("defaults lockTimeout to five seconds when none is supplied", async () => {
    mockRedisClient();

    await Semaphore.lock({
      key: "project-1",
      namespace: "ProjectService.incidentCounter",
    });

    expect(redisMutexConstructor).toHaveBeenCalledWith(
      expect.anything(),
      "ProjectService.incidentCounter-project-1",
      { lockTimeout: 5_000 },
    );
  });

  test("omits options the caller did not set rather than passing undefined", async () => {
    mockRedisClient();

    await Semaphore.lock({
      key: "project-1",
      namespace: "ProjectService.incidentCounter",
      acquireTimeout: 1_000,
    });

    const options: Record<string, unknown> = redisMutexConstructor.mock
      .calls[0]![2] as unknown as Record<string, unknown>;

    /*
     * redis-semaphore destructures its options with defaults, and an explicit
     * `undefined` does take the default -- but only because of how it is
     * written. Not passing the key at all is what actually guarantees the
     * library's own default applies.
     */
    expect(Object.keys(options).sort()).toEqual([
      "acquireTimeout",
      "lockTimeout",
    ]);
  });

  test("rejects when Redis is not connected", async () => {
    jest.spyOn(Redis, "getClient").mockReturnValue(null);

    await expect(
      Semaphore.lock({
        key: "instance",
        namespace: "UserService.firstMasterAdminElection",
      }),
    ).rejects.toThrow(/Redis client is not connected/i);

    /*
     * Callers treat a throw as "I do not hold the lock". Constructing a mutex
     * against a dead client and returning it would be worse than failing.
     */
    expect(redisMutexConstructor).not.toHaveBeenCalled();
  });

  test("propagates acquisition failures without returning an unheld mutex", async () => {
    mockRedisClient();
    const acquireError: Error = new Error("acquire timeout");
    redisMutexConstructor.mockImplementationOnce(() => {
      return {
        acquire: jest.fn(async (): Promise<void> => {
          throw acquireError;
        }),
        release: jest.fn(async (): Promise<void> => {}),
      } as unknown as RedisMutex;
    });

    /*
     * The load-bearing failure mode for the Master Admin election: a caller
     * that got a mutex handle back would run its critical section believing it
     * was serialized.
     */
    await expect(
      Semaphore.lock({
        key: "instance",
        namespace: "UserService.firstMasterAdminElection",
      }),
    ).rejects.toBe(acquireError);
  });

  test("releases the exact acquired mutex", async () => {
    mockRedisClient();

    const mutex: SemaphoreMutex = await Semaphore.lock({
      key: "instance",
      namespace: "UserService.firstMasterAdminElection",
    });

    await Semaphore.release(mutex);

    expect(lastMockMutex().release).toHaveBeenCalledTimes(1);
  });

  /*
   * A holder that keeps a lock at steps of its own - a long check, page by
   * page - re-asserts it for another lockTimeout without a refresh timer:
   * the same lock, named by the identifier it was taken with, is tried
   * again as one acquired already (redis-semaphore's acquiredExternally),
   * which re-asserts it in Valkey only while Valkey still holds it for
   * this holder.
   */
  test("keepLock re-asserts the held lock, by its key and identifier, for another lockTimeout, with no refresh timer", async () => {
    const client: ClientType = mockRedisClient();

    const mutex: SemaphoreMutex = await Semaphore.lock({
      key: "server",
      namespace: "ProjectSsoProviderChanges.keepAWayIn",
      lockTimeout: 10_000,
      refreshInterval: 0,
    });

    await expect(Semaphore.keepLock(mutex)).resolves.toBe(true);

    expect(redisMutexConstructor).toHaveBeenLastCalledWith(
      client,
      "ProjectSsoProviderChanges.keepAWayIn-server",
      {
        identifier: mutex.identifier,
        acquiredExternally: true,
        lockTimeout: 10_000,
        refreshInterval: 0,
      },
    );
    expect(lastMockMutex().tryAcquire).toHaveBeenCalledTimes(1);
    expect(lastMockMutex().acquire).not.toHaveBeenCalled();
  });

  test("keepLock answers false for a lock Valkey no longer holds for this holder", async () => {
    mockRedisClient();

    const mutex: SemaphoreMutex = await Semaphore.lock({
      key: "server",
      namespace: "ns",
    });
    stillHeld = false;

    await expect(Semaphore.keepLock(mutex)).resolves.toBe(false);
  });

  test("keepLock answers false for a lock given back, without asking Valkey", async () => {
    mockRedisClient();

    const mutex: SemaphoreMutex = await Semaphore.lock({
      key: "server",
      namespace: "ns",
    });
    await Semaphore.release(mutex);
    const constructed: number = redisMutexConstructor.mock.calls.length;

    await expect(Semaphore.keepLock(mutex)).resolves.toBe(false);
    expect(redisMutexConstructor.mock.calls.length).toBe(constructed);
  });

  test("keepLock refuses a lock it did not take, and throws when Valkey cannot be reached", async () => {
    mockRedisClient();

    await expect(
      Semaphore.keepLock({ isAcquired: true } as unknown as SemaphoreMutex),
    ).rejects.toThrow("Only a lock taken with Semaphore.lock can be kept.");

    const mutex: SemaphoreMutex = await Semaphore.lock({
      key: "server",
      namespace: "ns",
    });
    jest.spyOn(Redis, "getClient").mockReturnValue(null);

    await expect(Semaphore.keepLock(mutex)).rejects.toThrow(
      "Redis client is not connected",
    );
  });

  test("two different keys produce two independent mutexes", async () => {
    mockRedisClient();

    await Semaphore.lock({ key: "a", namespace: "ns" });
    await Semaphore.lock({ key: "b", namespace: "ns" });

    expect(redisMutexConstructor.mock.calls[0]![1]).toBe("ns-a");
    expect(redisMutexConstructor.mock.calls[1]![1]).toBe("ns-b");
  });
});
