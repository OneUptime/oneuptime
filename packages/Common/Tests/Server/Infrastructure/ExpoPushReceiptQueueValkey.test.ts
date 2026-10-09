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

import Redis from "../../../Server/Infrastructure/Redis";
import {
  EXPO_PUSH_RECEIPT_FIRST_CHECK_AFTER_MS,
  EXPO_PUSH_RECEIPTS_KEPT_FOR_MS,
  ExpoPushReceiptQueue,
  PendingExpoPushReceipt,
} from "../../../Server/Infrastructure/ExpoPushReceiptQueue";
import getTestRedisConnectionOptions from "../TestingUtils/Redis/TestRedisOptions";

/*
 * The queue of pushes whose Expo receipts have not been read yet, against a
 * real Valkey: sorted-set ordering, LIMIT, exclusive bounds and negative
 * ranks are Redis's, and the in-memory stand-in the unit suite uses
 * (ExpoPushReceiptQueue.test.ts) only imitates them.
 *
 * It needs Valkey: CI's test-setup.sh starts one on localhost:6310, which
 * TestRedisOptions points at. Locally, a disposable one:
 *
 *   docker run -d --rm -p 16391:6379 valkey/valkey:9.1-alpine
 *   EXPO_PUSH_RECEIPTS_TEST_REDIS_URL=redis://localhost:16391 \
 *     npx jest Tests/Server/Infrastructure/ExpoPushReceiptQueueValkey.test.ts
 *
 * Only this suite's own keys (a prefix of its own) are touched, and they are
 * removed afterwards.
 */

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;

const KEY_PREFIX: string = `expo-push-receipts-test-${process.pid}-${Date.now()}`;

const SENT_AT: number = Date.UTC(2026, 9, 8, 9, 0, 0);

const redisUrl: string | undefined =
  process.env["EXPO_PUSH_RECEIPTS_TEST_REDIS_URL"];

function connection(): RedisClient {
  return redisUrl
    ? new RedisClient(redisUrl, { lazyConnect: true })
    : new RedisClient(getTestRedisConnectionOptions());
}

// A worker of its own: its own connection, as each worker process has.
function workerQueue(client: RedisClient): ExpoPushReceiptQueue {
  const queue: ExpoPushReceiptQueue = new ExpoPushReceiptQueue({
    keyPrefix: KEY_PREFIX,
  });

  (queue as unknown as { getClient: () => RedisClient }).getClient =
    (): RedisClient => {
      return client;
    };

  return queue;
}

function receiptNumber(
  index: number,
  sentAt: number = SENT_AT,
): PendingExpoPushReceipt {
  return {
    receiptId: `c0ffee00-0000-4000-8000-${String(index).padStart(12, "0")}`,
    deviceToken: `ExponentPushToken[valkey-phone-${String(index).padStart(6, "0")}]`,
    via: index % 2 === 0 ? "relay" : "expo",
    sentAt: sentAt,
    attempts: 0,
  };
}

let clientA: RedisClient;
let clientB: RedisClient;
let queue: ExpoPushReceiptQueue;
let otherWorker: ExpoPushReceiptQueue;

async function removeOwnKeys(): Promise<void> {
  const keys: Array<string> = await clientA.keys(`${KEY_PREFIX}:*`);

  if (keys.length > 0) {
    await clientA.del(...keys);
  }
}

beforeAll(async () => {
  clientA = connection();
  clientB = connection();
  await clientA.connect();
  await clientB.connect();

  // The product's own queue reads Redis through the shared client.
  jest
    .spyOn(Redis, "getClient")
    .mockReturnValue(clientA as unknown as ReturnType<typeof Redis.getClient>);
  jest.spyOn(Redis, "isConnected").mockReturnValue(true);
});

beforeEach(async () => {
  await removeOwnKeys();
  queue = workerQueue(clientA);
  otherWorker = workerQueue(clientB);
});

afterAll(async () => {
  await removeOwnKeys();
  clientA.disconnect();
  clientB.disconnect();
  jest.restoreAllMocks();
});

describe("the receipts queue on a real Valkey", () => {
  test("each push is due 15 minutes after it was sent, the longest due first", async () => {
    const late: PendingExpoPushReceipt = receiptNumber(1, SENT_AT + 2 * MINUTE);
    const early: PendingExpoPushReceipt = receiptNumber(2, SENT_AT);
    const notYet: PendingExpoPushReceipt = receiptNumber(3, SENT_AT + HOUR);

    expect(await queue.add([late, early, notYet], SENT_AT)).toBe(3);

    expect(
      await clientA.zscore(
        queue.getPendingKey(),
        ExpoPushReceiptQueue.serialize(early),
      ),
    ).toBe(String(SENT_AT + EXPO_PUSH_RECEIPT_FIRST_CHECK_AFTER_MS));

    const now: number = SENT_AT + 20 * MINUTE;

    expect(await queue.claimDue({ now: now, limit: 1 })).toEqual([early]);
    expect(await queue.claimDue({ now: now, limit: 10 })).toEqual([late]);
    expect(await queue.claimDue({ now: now, limit: 10 })).toEqual([]);
    expect(await clientA.zcard(queue.getPendingKey())).toBe(1);
  });

  test("two workers taking receipts at once never take the same one", async () => {
    const receipts: Array<PendingExpoPushReceipt> = Array.from(
      { length: 400 },
      (_value: unknown, index: number) => {
        return receiptNumber(index + 1);
      },
    );

    await queue.add(receipts, SENT_AT);

    const takenBy: Map<string, number> = new Map<string, number>();
    const now: number = SENT_AT + HOUR;

    for (let round: number = 0; round < 10; round++) {
      const [mine, theirs] = await Promise.all([
        queue.claimDue({ now: now, limit: 150 }),
        otherWorker.claimDue({ now: now, limit: 150 }),
      ]);

      for (const taken of [...mine, ...theirs]) {
        takenBy.set(taken.receiptId, (takenBy.get(taken.receiptId) || 0) + 1);
      }

      if (mine.length === 0 && theirs.length === 0) {
        break;
      }
    }

    expect(takenBy.size).toBe(400);
    expect(
      Array.from(takenBy.values()).every((count: number) => {
        return count === 1;
      }),
    ).toBe(true);
  });

  test("what was due more than a day ago is cleared when a send is kept; what is due within the day stays", async () => {
    const now: number = SENT_AT + 3 * 24 * HOUR;
    const key: string = queue.getPendingKey();

    await clientA.zadd(key, now - EXPO_PUSH_RECEIPTS_KEPT_FOR_MS - 1, "stale");
    await clientA.zadd(key, now - EXPO_PUSH_RECEIPTS_KEPT_FOR_MS, "a day");

    await queue.add([receiptNumber(1, now)], now);

    expect(await clientA.zrange(key, 0, -1)).toEqual([
      "a day",
      ExpoPushReceiptQueue.serialize(receiptNumber(1, now)),
    ]);
  });

  test("the set expires two days after it was last written", async () => {
    await queue.add([receiptNumber(1)], SENT_AT);

    const ttl: number = await clientA.pttl(queue.getPendingKey());

    expect(ttl).toBeGreaterThan(2 * EXPO_PUSH_RECEIPTS_KEPT_FOR_MS - MINUTE);
    expect(ttl).toBeLessThanOrEqual(2 * EXPO_PUSH_RECEIPTS_KEPT_FOR_MS);
  });

  test("a receipt looked for again waits twice as long after its push, and the given-up ones are gone", async () => {
    const now: number = SENT_AT + 15 * MINUTE;

    expect(
      await queue.checkAgainLater(
        [receiptNumber(1), { ...receiptNumber(2), attempts: 7 }],
        now,
      ),
    ).toEqual({ rescheduled: 1, expired: 1 });

    expect(
      await clientA.zrange(queue.getPendingKey(), 0, -1, "WITHSCORES"),
    ).toEqual([
      ExpoPushReceiptQueue.serialize({ ...receiptNumber(1), attempts: 1 }),
      String(SENT_AT + 30 * MINUTE),
    ]);
  });

  test("when a token last registered is kept for a day and an hour, under a key that does not name it", async () => {
    const token: string = receiptNumber(1).deviceToken;

    await queue.noteTokenRegistered(token, SENT_AT + 3 * MINUTE);

    expect(await otherWorker.getTokenRegisteredAt(token)).toBe(
      SENT_AT + 3 * MINUTE,
    );

    const keys: Array<string> = await clientA.keys(`${KEY_PREFIX}:registered:*`);

    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain(token);
    expect(await clientA.ttl(keys[0]!)).toBeGreaterThan(25 * 60 * 60 - 60);
  });

  test("the product's queue reads and writes through the shared client", async () => {
    const productLike: ExpoPushReceiptQueue = new ExpoPushReceiptQueue({
      keyPrefix: KEY_PREFIX,
    });

    await productLike.add([receiptNumber(5)], SENT_AT);

    expect(
      await productLike.claimDue({ now: SENT_AT + HOUR, limit: 10 }),
    ).toEqual([receiptNumber(5)]);
  });
});
