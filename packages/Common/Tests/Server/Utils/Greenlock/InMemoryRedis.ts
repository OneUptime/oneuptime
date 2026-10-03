/**
 * Redis, in memory, for the certificate order suites: the name locks
 * (Semaphore) and the keys GlobalCache keeps - the on-demand order windows,
 * the order budgets and the failed-order records.
 *
 * It behaves as Redis does for what these suites rely on: a held lock refuses
 * at once (one acquire attempt), SET NX writes only a missing key, and
 * incrementIfBelow adds nothing once its limit is reached. Keys never expire
 * on their own; a test moves to a new window by changing the clock, or calls
 * clearCache. goDown makes every call fail, as a Redis that is down does.
 */

import Semaphore, {
  SemaphoreLockTimeoutError,
  SemaphoreMutex,
} from "../../../../Server/Infrastructure/Semaphore";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import { jest } from "@jest/globals";

export type LockRequest = {
  key: string;
  namespace: string;
  lockTimeout?: number | undefined;
  acquireAttemptsLimit?: number | undefined;
};

export type InMemoryRedis = {
  // "namespace-key" of every lock held now.
  heldLocks: Set<string>;
  // Every lock asked for, in order, granted or not.
  lockRequests: Array<LockRequest>;
  // Every cache key, as "namespace-key", with its value.
  cache: Map<string, string>;
  // From now on every lock and cache call fails.
  goDown: () => void;
  clearCache: () => void;
};

export function useInMemoryRedis(): InMemoryRedis {
  let isDown: boolean = false;

  const redis: InMemoryRedis = {
    heldLocks: new Set<string>(),
    lockRequests: [],
    cache: new Map<string, string>(),
    goDown: (): void => {
      isDown = true;
    },
    clearCache: (): void => {
      redis.cache.clear();
    },
  };

  const failWhenDown: () => void = (): void => {
    if (isDown) {
      throw new Error("Cache is not connected");
    }
  };

  const fullKey: (namespace: string, key: string) => string = (
    namespace: string,
    key: string,
  ): string => {
    return `${namespace}-${key}`;
  };

  jest
    .spyOn(Semaphore, "lock")
    .mockImplementation((async (data: LockRequest) => {
      redis.lockRequests.push(data);
      failWhenDown();

      const key: string = fullKey(data.namespace, data.key);

      if (redis.heldLocks.has(key)) {
        throw new SemaphoreLockTimeoutError(`Acquire mutex ${key} timeout`);
      }

      redis.heldLocks.add(key);

      return { key: key } as unknown as SemaphoreMutex;
    }) as never);

  jest
    .spyOn(Semaphore, "release")
    .mockImplementation((async (mutex: SemaphoreMutex) => {
      redis.heldLocks.delete((mutex as unknown as { key: string }).key);
    }) as never);

  jest
    .spyOn(GlobalCache, "getString")
    .mockImplementation((async (namespace: string, key: string) => {
      failWhenDown();
      return redis.cache.get(fullKey(namespace, key)) ?? null;
    }) as never);

  jest
    .spyOn(GlobalCache, "getStrings")
    .mockImplementation((async (namespace: string, keys: Array<string>) => {
      failWhenDown();
      return keys.map((key: string) => {
        return redis.cache.get(fullKey(namespace, key)) ?? null;
      });
    }) as never);

  jest
    .spyOn(GlobalCache, "setString")
    .mockImplementation((async (
      namespace: string,
      key: string,
      value: string,
    ): Promise<void> => {
      failWhenDown();
      redis.cache.set(fullKey(namespace, key), value);
    }) as never);

  jest
    .spyOn(GlobalCache, "setStringIfNotExists")
    .mockImplementation((async (
      namespace: string,
      key: string,
      value: string,
    ): Promise<boolean> => {
      failWhenDown();

      if (redis.cache.has(fullKey(namespace, key))) {
        return false;
      }

      redis.cache.set(fullKey(namespace, key), value);
      return true;
    }) as never);

  jest
    .spyOn(GlobalCache, "deleteKey")
    .mockImplementation((async (
      namespace: string,
      key: string,
    ): Promise<void> => {
      failWhenDown();
      redis.cache.delete(fullKey(namespace, key));
    }) as never);

  jest
    .spyOn(GlobalCache, "incrementWithExpiry")
    .mockImplementation((async (
      namespace: string,
      key: string,
    ): Promise<number> => {
      failWhenDown();

      const count: number =
        Number(redis.cache.get(fullKey(namespace, key)) || "0") + 1;

      redis.cache.set(fullKey(namespace, key), String(count));
      return count;
    }) as never);

  jest
    .spyOn(GlobalCache, "incrementIfBelow")
    .mockImplementation((async (
      namespace: string,
      key: string,
      options: { limit: number },
    ): Promise<number | null> => {
      failWhenDown();

      const current: number = Number(
        redis.cache.get(fullKey(namespace, key)) || "0",
      );

      if (current >= options.limit) {
        return null;
      }

      redis.cache.set(fullKey(namespace, key), String(current + 1));
      return current + 1;
    }) as never);

  return redis;
}
