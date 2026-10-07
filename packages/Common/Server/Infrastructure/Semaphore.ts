import Redis, { ClientType } from "./Redis";
import {
  Mutex,
  LockOptions,
  Semaphore as RedisSemaphore,
} from "redis-semaphore";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export { TimeoutError as SemaphoreLockTimeoutError } from "redis-semaphore";

export type SemaphoreMutex = Mutex;
export type SemaphorePermit = RedisSemaphore;

export default class Semaphore {
  // returns the mutex id
  @CaptureSpan()
  public static async lock(data: {
    key: string;
    namespace: string;
    lockTimeout?: number | undefined;
    acquireTimeout?: number | undefined;
    acquireAttemptsLimit?: number | undefined;
    retryInterval?: number | undefined;
    /*
     * How often a held lock is re-asserted. redis-semaphore defaults to 80%
     * of lockTimeout, which is also how long `mutex.isAcquired` can go on
     * reading true after the lock was lost (a Valkey restart, an eviction):
     * it only changes when a refresh fails. A holder that polls isAcquired
     * between steps wants this well under lockTimeout. 0 never re-asserts
     * it: the lock lasts lockTimeout at most, so one a holder never gives
     * back (its work failed half way) runs out instead of being held for as
     * long as the process lives.
     */
    refreshInterval?: number | undefined;
    /*
     * Called when a refresh finds the lock gone. By default redis-semaphore
     * throws from its refresh timer, which nothing can catch and which ends
     * up as an unhandled rejection; a long-running holder should pass one.
     */
    onLockLost?: ((err: Error) => void) | undefined;
  }): Promise<SemaphoreMutex> {
    if (!data.lockTimeout) {
      data.lockTimeout = 5000;
    }

    const { key } = data;

    const client: ClientType | null = Redis.getClient();

    if (!client) {
      throw new Error("Redis client is not connected");
    }

    const lockOptions: LockOptions = {};

    if (data.lockTimeout) {
      lockOptions.lockTimeout = data.lockTimeout;
    }

    if (data.acquireTimeout) {
      lockOptions.acquireTimeout = data.acquireTimeout;
    }

    if (data.acquireAttemptsLimit) {
      lockOptions.acquireAttemptsLimit = data.acquireAttemptsLimit;
    }

    if (data.retryInterval) {
      lockOptions.retryInterval = data.retryInterval;
    }

    if (data.refreshInterval !== undefined) {
      lockOptions.refreshInterval = data.refreshInterval;
    }

    if (data.onLockLost) {
      lockOptions.onLockLost = data.onLockLost;
    }

    const mutex: SemaphoreMutex = new Mutex(
      client,
      data.namespace + "-" + key,
      lockOptions,
    );

    await mutex.acquire();

    return mutex;
  }

  @CaptureSpan()
  public static async release(mutex: SemaphoreMutex): Promise<void> {
    await mutex.release();
  }

  /**
   * Acquire one permit from a distributed, fixed-size concurrency pool.
   * Unlike lock(), up to `limit` callers may hold the key simultaneously.
   */
  @CaptureSpan()
  public static async acquirePermit(data: {
    key: string;
    namespace: string;
    limit: number;
    lockTimeout?: number | undefined;
    acquireTimeout?: number | undefined;
    acquireAttemptsLimit?: number | undefined;
    retryInterval?: number | undefined;
    /*
     * Called when a held permit could not be refreshed and has lapsed. By
     * default redis-semaphore throws from its refresh timer, which nothing
     * can catch; a holder that runs for long should pass one.
     */
    onLockLost?: ((err: Error) => void) | undefined;
  }): Promise<SemaphorePermit> {
    if (!Number.isInteger(data.limit) || data.limit <= 0) {
      throw new Error("Semaphore permit limit must be a positive integer");
    }

    const client: ClientType | null = Redis.getClient();

    if (!client) {
      throw new Error("Redis client is not connected");
    }

    const lockOptions: LockOptions = {
      lockTimeout: data.lockTimeout || 5000,
    };

    if (data.acquireTimeout !== undefined) {
      lockOptions.acquireTimeout = data.acquireTimeout;
    }

    if (data.acquireAttemptsLimit !== undefined) {
      lockOptions.acquireAttemptsLimit = data.acquireAttemptsLimit;
    }

    if (data.retryInterval !== undefined) {
      lockOptions.retryInterval = data.retryInterval;
    }

    if (data.onLockLost) {
      lockOptions.onLockLost = data.onLockLost;
    }

    const permit: SemaphorePermit = new RedisSemaphore(
      client,
      `${data.namespace}-${data.key}`,
      data.limit,
      lockOptions,
    );

    await permit.acquire();
    return permit;
  }

  @CaptureSpan()
  public static async releasePermit(permit: SemaphorePermit): Promise<void> {
    await permit.release();
  }
}
