import getTestRedisConnectionOptions from "./TestRedisOptions";
import { Redis, RedisOptions } from "ioredis";

/*
 * A connection of a suite's own to a real Valkey, for suites that check what
 * Redis itself does - SET NX, expiry, Lua - rather than a stand-in's idea of
 * it. By default the one CI starts (test-setup.sh, localhost:6310); `url`
 * picks another, such as a disposable local one:
 *
 *   docker run -d --rm -p 16391:6379 valkey/valkey:9.1-alpine
 *
 * It gives up at once rather than retrying, so a suite run without a Valkey
 * fails with the connection error instead of hanging. Exported for packages
 * that do not depend on ioredis themselves (App's tests reach it through
 * Common).
 */
export type TestRedisClient = Redis;

export async function connectTestRedis(
  url?: string | undefined,
): Promise<TestRedisClient> {
  const options: RedisOptions = {
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    retryStrategy: (): null => {
      return null;
    },
  };

  const client: Redis = url
    ? new Redis(url, options)
    : new Redis({ ...getTestRedisConnectionOptions(), ...options });

  await client.connect();

  return client;
}
