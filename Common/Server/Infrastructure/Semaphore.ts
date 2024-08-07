import Redis, { ClientType } from "./Redis";
import { Mutex } from "redis-semaphore";

export type SemaphoreMutex = Mutex;

export default class Semaphore {
  // returns the mutex id
  public static async lock(data: {
    key: string;
    lockTimeout?: number;
  }): Promise<SemaphoreMutex> {
    if (!data.lockTimeout) {
      data.lockTimeout = 1000;
    }

    const { key } = data;

    const client: ClientType | null = Redis.getClient();

    if (!client) {
      throw new Error("Redis client is not connected");
    }

    const mutex: SemaphoreMutex = new Mutex(client, key, {
      lockTimeout: data.lockTimeout,
    });

    await mutex.acquire();

    return mutex;
  }

  public static async release(mutex: SemaphoreMutex): Promise<void> {
    await mutex.release();
  }
}
