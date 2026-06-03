import Redis, { ClientType } from "./Redis";
import { Mutex, LockOptions } from "redis-semaphore";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export type SemaphoreMutex = Mutex;

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
}
