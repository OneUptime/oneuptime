import Redis, { ClientType } from "./Redis";
import {
  Mutex,
  LockOptions,
  Semaphore as RedisSemaphore,
} from "redis-semaphore";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

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
