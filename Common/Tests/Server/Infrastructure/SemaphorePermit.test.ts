import Redis, { ClientType } from "../../../Server/Infrastructure/Redis";
import Semaphore, {
  SemaphorePermit,
} from "../../../Server/Infrastructure/Semaphore";
import { Semaphore as RedisSemaphore } from "redis-semaphore";
import { afterEach, describe, expect, test } from "@jest/globals";

interface MockPermit {
  acquire: jest.Mock;
  release: jest.Mock;
}

jest.mock("redis-semaphore", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "redis-semaphore",
  ) as Record<string, unknown>;

  return {
    ...actual,
    Semaphore: jest.fn().mockImplementation((): MockPermit => {
      return {
        acquire: jest.fn(async (): Promise<void> => {}),
        release: jest.fn(async (): Promise<void> => {}),
      };
    }),
  };
});

const redisSemaphoreConstructor: jest.MockedClass<typeof RedisSemaphore> =
  RedisSemaphore as jest.MockedClass<typeof RedisSemaphore>;

function mockRedisClient(): ClientType {
  const client: ClientType = {} as ClientType;
  jest.spyOn(Redis, "getClient").mockReturnValue(client);
  return client;
}

function lastMockPermit(): MockPermit {
  const result: unknown = redisSemaphoreConstructor.mock.results.at(-1)?.value;
  return result as MockPermit;
}

afterEach(() => {
  jest.restoreAllMocks();
  redisSemaphoreConstructor.mockClear();
});

describe("Semaphore distributed permits", () => {
  test("constructs and acquires a fixed-size project pool with all options", async () => {
    const client: ClientType = mockRedisClient();

    const permit: SemaphorePermit = await Semaphore.acquirePermit({
      key: "project-1",
      namespace: "workflow-ai",
      limit: 3,
      lockTimeout: 65_000,
      acquireTimeout: 250,
      acquireAttemptsLimit: 1,
      retryInterval: 50,
    });

    expect(redisSemaphoreConstructor).toHaveBeenCalledWith(
      client,
      "workflow-ai-project-1",
      3,
      {
        lockTimeout: 65_000,
        acquireTimeout: 250,
        acquireAttemptsLimit: 1,
        retryInterval: 50,
      },
    );
    expect(lastMockPermit().acquire).toHaveBeenCalledTimes(1);
    expect(permit).toBe(lastMockPermit());
  });

  test("uses the existing five-second lock default when none is supplied", async () => {
    mockRedisClient();

    await Semaphore.acquirePermit({
      key: "project-1",
      namespace: "workflow-ai",
      limit: 3,
    });

    expect(redisSemaphoreConstructor).toHaveBeenCalledWith(
      expect.anything(),
      "workflow-ai-project-1",
      3,
      { lockTimeout: 5_000 },
    );
  });

  test.each([0, -1, 1.5])(
    "rejects invalid permit limit %p",
    async (limit: number) => {
      const getClient: jest.SpyInstance = jest.spyOn(Redis, "getClient");

      await expect(
        Semaphore.acquirePermit({
          key: "project-1",
          namespace: "workflow-ai",
          limit,
        }),
      ).rejects.toThrow(/positive integer/i);

      expect(getClient).not.toHaveBeenCalled();
      expect(redisSemaphoreConstructor).not.toHaveBeenCalled();
    },
  );

  test("rejects when Redis is not connected", async () => {
    jest.spyOn(Redis, "getClient").mockReturnValue(null);

    await expect(
      Semaphore.acquirePermit({
        key: "project-1",
        namespace: "workflow-ai",
        limit: 3,
      }),
    ).rejects.toThrow(/Redis client is not connected/i);

    expect(redisSemaphoreConstructor).not.toHaveBeenCalled();
  });

  test("propagates acquisition failures without returning an unheld permit", async () => {
    mockRedisClient();
    const acquireError: Error = new Error("pool is full");
    redisSemaphoreConstructor.mockImplementationOnce(() => {
      return {
        acquire: jest.fn(async (): Promise<void> => {
          throw acquireError;
        }),
        release: jest.fn(async (): Promise<void> => {}),
      } as unknown as RedisSemaphore;
    });

    await expect(
      Semaphore.acquirePermit({
        key: "project-1",
        namespace: "workflow-ai",
        limit: 3,
      }),
    ).rejects.toBe(acquireError);
  });

  test("releases the exact acquired permit", async () => {
    mockRedisClient();
    const permit: SemaphorePermit = await Semaphore.acquirePermit({
      key: "project-1",
      namespace: "workflow-ai",
      limit: 3,
    });

    await Semaphore.releasePermit(permit);

    expect(lastMockPermit().release).toHaveBeenCalledTimes(1);
  });
});
