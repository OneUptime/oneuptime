import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Redis as RedisClient } from "ioredis";

jest.mock("../../../Server/Utils/Logger");

import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import Redis from "../../../Server/Infrastructure/Redis";
import getTestRedisConnectionOptions from "../TestingUtils/Redis/TestRedisOptions";

/*
 * A COUNTER THAT ADDS ONLY WHILE IT IS BELOW ITS LIMIT, ON A REAL VALKEY
 * (GlobalCache.incrementIfBelow).
 *
 * The unit suite (GlobalCache.test.ts) holds the evaluation's script and
 * arguments; only Valkey answers whether the Lua does what it says. Adding
 * several at once (`by`) is what an on-call fire drill's tests claim of the
 * project's hour together (#7012): all of them or none, never past the
 * limit, the expiry set by the add that made the counter - and one at a
 * time, as every other caller adds, is unchanged.
 *
 * It needs Valkey: CI's test-setup.sh starts one on localhost:6310, which
 * TestRedisOptions points at. Locally, a disposable one:
 *
 *   docker run -d --rm -p 16392:6379 valkey/valkey:9.1-alpine
 *   GLOBAL_CACHE_TEST_REDIS_URL=redis://localhost:16392 \
 *     npx jest Tests/Server/Infrastructure/GlobalCacheIncrementIfBelowValkey.test.ts
 *
 * Only this suite's own keys (a namespace of its own) are touched, and they
 * are removed afterwards.
 */

const NAMESPACE: string = `global-cache-increment-test-${process.pid}-${Date.now()}`;

const redisUrl: string | undefined = process.env["GLOBAL_CACHE_TEST_REDIS_URL"];

let client: RedisClient;
let keyNumber: number = 0;

function connection(): RedisClient {
  return redisUrl
    ? new RedisClient(redisUrl, { lazyConnect: true })
    : new RedisClient(getTestRedisConnectionOptions());
}

// A key of its own for each test.
function nextKey(): string {
  keyNumber += 1;
  return `counter-${keyNumber}`;
}

async function valueOf(key: string): Promise<string | null> {
  return await client.get(`${NAMESPACE}-${key}`);
}

beforeAll(async () => {
  client = connection();
  await client.connect();

  jest.spyOn(Redis, "getClient").mockReturnValue(client as never);
  jest.spyOn(Redis, "isConnected").mockReturnValue(true);
});

beforeEach(() => {
  jest.spyOn(Redis, "getClient").mockReturnValue(client as never);
  jest.spyOn(Redis, "isConnected").mockReturnValue(true);
});

afterAll(async () => {
  const keys: Array<string> = await client.keys(`${NAMESPACE}-*`);

  if (keys.length > 0) {
    await client.del(...keys);
  }

  client.disconnect();
  jest.restoreAllMocks();
});

describe("incrementIfBelow on a real Valkey", () => {
  test("one at a time: up to the limit, then refused, adding nothing", async () => {
    const key: string = nextKey();
    const counts: Array<number | null> = [];

    for (let add: number = 0; add < 4; add += 1) {
      counts.push(
        await GlobalCache.incrementIfBelow(NAMESPACE, key, {
          limit: 3,
          expiresInSeconds: 60,
        }),
      );
    }

    expect(counts).toEqual([1, 2, 3, null]);
    expect(await valueOf(key)).toBe("3");
  });

  test("several at once: all of them while they fit", async () => {
    const key: string = nextKey();

    expect(
      await GlobalCache.incrementIfBelow(NAMESPACE, key, {
        limit: 20,
        expiresInSeconds: 60,
        by: 3,
      }),
    ).toBe(3);
    expect(
      await GlobalCache.incrementIfBelow(NAMESPACE, key, {
        limit: 20,
        expiresInSeconds: 60,
        by: 17,
      }),
    ).toBe(20);
  });

  test("several at once that would go past the limit: none of them, and the counter is as it was", async () => {
    const key: string = nextKey();

    await GlobalCache.incrementIfBelow(NAMESPACE, key, {
      limit: 20,
      expiresInSeconds: 60,
      by: 18,
    });

    expect(
      await GlobalCache.incrementIfBelow(NAMESPACE, key, {
        limit: 20,
        expiresInSeconds: 60,
        by: 3,
      }),
    ).toBeNull();
    expect(await valueOf(key)).toBe("18");

    // What still fits is still taken.
    expect(
      await GlobalCache.incrementIfBelow(NAMESPACE, key, {
        limit: 20,
        expiresInSeconds: 60,
        by: 2,
      }),
    ).toBe(20);
  });

  test("the add that makes the counter sets its expiry, and a later one leaves it", async () => {
    const key: string = nextKey();

    await GlobalCache.incrementIfBelow(NAMESPACE, key, {
      limit: 20,
      expiresInSeconds: 120,
      by: 4,
    });

    const ttl: number = await client.ttl(`${NAMESPACE}-${key}`);

    expect(ttl).toBeGreaterThan(100);
    expect(ttl).toBeLessThanOrEqual(120);

    await GlobalCache.incrementIfBelow(NAMESPACE, key, {
      limit: 20,
      expiresInSeconds: 3600,
      by: 2,
    });

    expect(await client.ttl(`${NAMESPACE}-${key}`)).toBeLessThanOrEqual(120);
  });

  test("a refused first add makes no counter at all", async () => {
    const key: string = nextKey();

    expect(
      await GlobalCache.incrementIfBelow(NAMESPACE, key, {
        limit: 2,
        expiresInSeconds: 60,
        by: 3,
      }),
    ).toBeNull();
    expect(await valueOf(key)).toBeNull();
  });

  test("one at a time and several share a counter: the limit holds for both", async () => {
    const key: string = nextKey();

    await GlobalCache.incrementIfBelow(NAMESPACE, key, {
      limit: 5,
      expiresInSeconds: 60,
      by: 4,
    });

    expect(
      await GlobalCache.incrementIfBelow(NAMESPACE, key, {
        limit: 5,
        expiresInSeconds: 60,
      }),
    ).toBe(5);
    expect(
      await GlobalCache.incrementIfBelow(NAMESPACE, key, {
        limit: 5,
        expiresInSeconds: 60,
      }),
    ).toBeNull();
  });
});
