import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn(),
      isConnected: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

import Redis from "../../../Server/Infrastructure/Redis";
import logger from "../../../Server/Utils/Logger";
import DefaultExpoPushReceiptQueue, {
  EXPO_PUSH_RECEIPT_FIRST_CHECK_AFTER_MS,
  EXPO_PUSH_RECEIPT_MIN_RETRY_AFTER_MS,
  EXPO_PUSH_RECEIPTS_KEPT_FOR_MS,
  ExpoPushReceiptQueue,
  MAX_PENDING_EXPO_PUSH_RECEIPTS,
  PendingExpoPushReceipt,
} from "../../../Server/Infrastructure/ExpoPushReceiptQueue";
import FakeSortedSetRedis from "../TestingUtils/Redis/FakeSortedSetRedis";
import { createHash } from "crypto";

/*
 * The pushes whose Expo receipts have not been read yet: one Redis sorted
 * set, scored by when each receipt is next looked for.
 *
 * Expo answers a push with a ticket at once and with a receipt - whether
 * Apple or Google took it - a few minutes later, and it is in the receipt
 * that Expo usually says a phone is gone. These tests pin what the queue
 * promises the receipt check (ExpoPushReceiptService.test.ts):
 *  - a receipt is first looked for 15 minutes after its push (Expo's
 *    advice), then twice as long after each time, never after Expo has
 *    cleared it (24 hours);
 *  - the due receipts are taken a batch at a time, the longest due first,
 *    each by exactly one worker;
 *  - nothing grows without bound when nothing reads it, and a Redis that is
 *    down never fails the page that was being sent;
 *  - the push token never appears in a key name.
 *
 * Redis here is an in-memory stand-in with Redis's own ordering and bounds
 * (FakeSortedSetRedis); ExpoPushReceiptQueueValkey.test.ts runs the same
 * promises against a real Valkey.
 */

type MockedFn = ReturnType<typeof jest.fn>;

const getClientMock: MockedFn = Redis.getClient as unknown as MockedFn;
const isConnectedMock: MockedFn = Redis.isConnected as unknown as MockedFn;
const loggerMock: Record<"debug" | "info" | "warn" | "error", MockedFn> =
  logger as unknown as Record<"debug" | "info" | "warn" | "error", MockedFn>;

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;

const SENT_AT: number = Date.UTC(2026, 9, 8, 12, 0, 0);

const TOKEN: string = "ExponentPushToken[queue-phone-0000000001]";

let redis: FakeSortedSetRedis;
let queue: ExpoPushReceiptQueue;

function receipt(
  overrides: Partial<PendingExpoPushReceipt> = {},
): PendingExpoPushReceipt {
  return {
    receiptId: "8e3c2a52-4d8e-4b4f-9a39-000000000001",
    deviceToken: TOKEN,
    via: "expo",
    sentAt: SENT_AT,
    attempts: 0,
    ...overrides,
  };
}

function receiptNumber(index: number, sentAt: number = SENT_AT): PendingExpoPushReceipt {
  return receipt({
    receiptId: `8e3c2a52-4d8e-4b4f-9a39-${String(index).padStart(12, "0")}`,
    sentAt: sentAt,
  });
}

function pending(): Array<[PendingExpoPushReceipt, number]> {
  return redis
    .ordered(queue.getPendingKey())
    .map((entry: [string, number]): [PendingExpoPushReceipt, number] => {
      return [ExpoPushReceiptQueue.parse(entry[0])!, entry[1]];
    });
}

beforeEach(() => {
  jest.clearAllMocks();
  redis = new FakeSortedSetRedis();
  getClientMock.mockReturnValue(redis);
  isConnectedMock.mockReturnValue(true);
  queue = new ExpoPushReceiptQueue({ keyPrefix: "test-receipts" });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("when a receipt is looked for (getNextCheckAt)", () => {
  test("Expo's advice and the day it keeps receipts", () => {
    expect(EXPO_PUSH_RECEIPT_FIRST_CHECK_AFTER_MS).toBe(15 * MINUTE);
    expect(EXPO_PUSH_RECEIPTS_KEPT_FOR_MS).toBe(24 * HOUR);
    expect(EXPO_PUSH_RECEIPT_MIN_RETRY_AFTER_MS).toBe(5 * MINUTE);
  });

  test.each([
    [1, 30 * MINUTE],
    [2, 1 * HOUR],
    [3, 2 * HOUR],
    [4, 4 * HOUR],
    [5, 8 * HOUR],
    [6, 16 * HOUR],
  ])(
    "after %d look(s), checked on time: again %d ms after the push",
    (attempts: number, afterSend: number) => {
      expect(
        ExpoPushReceiptQueue.getNextCheckAt({
          sentAt: SENT_AT,
          attempts: attempts,
          now: SENT_AT + EXPO_PUSH_RECEIPT_FIRST_CHECK_AFTER_MS,
        }),
      ).toBe(SENT_AT + afterSend);
    },
  );

  test("after seven looks it would be past the day Expo keeps it: given up", () => {
    expect(
      ExpoPushReceiptQueue.getNextCheckAt({
        sentAt: SENT_AT,
        attempts: 7,
        now: SENT_AT + 16 * HOUR,
      }),
    ).toBeNull();
  });

  test("a look that ran late (the workers were down) waits five minutes, not none", () => {
    const now: number = SENT_AT + 3 * HOUR;

    expect(
      ExpoPushReceiptQueue.getNextCheckAt({
        sentAt: SENT_AT,
        attempts: 1,
        now: now,
      }),
    ).toBe(now + 5 * MINUTE);
  });

  test("never after Expo has cleared it", () => {
    expect(
      ExpoPushReceiptQueue.getNextCheckAt({
        sentAt: SENT_AT,
        attempts: 1,
        now: SENT_AT + 24 * HOUR - 4 * MINUTE,
      }),
    ).toBeNull();
  });

  test("up to the last moment Expo still has it", () => {
    expect(
      ExpoPushReceiptQueue.getNextCheckAt({
        sentAt: SENT_AT,
        attempts: 1,
        now: SENT_AT + 24 * HOUR - 5 * MINUTE,
      }),
    ).toBe(SENT_AT + 24 * HOUR);
  });
});

describe("a pending receipt as stored (serialize, parse)", () => {
  test("is read back as it was written, with and without the rows it belongs to", () => {
    const bare: PendingExpoPushReceipt = receipt({ via: "relay", attempts: 3 });
    const full: PendingExpoPushReceipt = receipt({
      pushNotificationLogId: "7f000000-0000-4000-8000-000000000101",
      userOnCallLogTimelineId: "7f000000-0000-4000-8000-000000000102",
    });

    expect(
      ExpoPushReceiptQueue.parse(ExpoPushReceiptQueue.serialize(bare)),
    ).toEqual(bare);
    expect(
      ExpoPushReceiptQueue.parse(ExpoPushReceiptQueue.serialize(full)),
    ).toEqual(full);
  });

  test("holds exactly its fields, in one order: the same receipt is the same member", () => {
    const withExtra: PendingExpoPushReceipt = {
      ...receipt(),
      ...({ somethingElse: "x" } as object),
    } as PendingExpoPushReceipt;

    expect(JSON.parse(ExpoPushReceiptQueue.serialize(withExtra))).toEqual({
      receiptId: receipt().receiptId,
      deviceToken: TOKEN,
      via: "expo",
      sentAt: SENT_AT,
      attempts: 0,
    });
    expect(ExpoPushReceiptQueue.serialize(receipt())).toBe(
      ExpoPushReceiptQueue.serialize({ ...receipt() }),
    );
  });

  test.each([
    ["text that is not JSON", "not json"],
    ["a list", "[1,2]"],
    ["null", "null"],
    ["a number", "42"],
    ["no receipt id", JSON.stringify({ ...receipt(), receiptId: undefined })],
    ["an empty receipt id", JSON.stringify({ ...receipt(), receiptId: "" })],
    ["no token", JSON.stringify({ ...receipt(), deviceToken: undefined })],
    ["an empty token", JSON.stringify({ ...receipt(), deviceToken: "" })],
    ["another way of sending", JSON.stringify({ ...receipt(), via: "web" })],
    ["a sent time as text", JSON.stringify({ ...receipt(), sentAt: "today" })],
    ["no sent time", JSON.stringify({ ...receipt(), sentAt: null })],
    ["a negative count of looks", JSON.stringify({ ...receipt(), attempts: -1 })],
    ["a fractional count of looks", JSON.stringify({ ...receipt(), attempts: 1.5 })],
    ["a count of looks as text", JSON.stringify({ ...receipt(), attempts: "1" })],
  ])("%s is not a pending receipt", (_name: string, member: string) => {
    expect(ExpoPushReceiptQueue.parse(member)).toBeNull();
  });

  test("row ids that are empty or not text are left out", () => {
    expect(
      ExpoPushReceiptQueue.parse(
        JSON.stringify({
          ...receipt(),
          pushNotificationLogId: "",
          userOnCallLogTimelineId: 42,
        }),
      ),
    ).toEqual(receipt());
  });
});

describe("keeping a send's receipts to read (add)", () => {
  test("each is first looked for 15 minutes after its push, in one round trip", async () => {
    const first: PendingExpoPushReceipt = receiptNumber(1);
    const second: PendingExpoPushReceipt = receiptNumber(2, SENT_AT + MINUTE);

    expect(await queue.add([first, second], SENT_AT + MINUTE)).toBe(2);

    expect(pending()).toEqual([
      [first, SENT_AT + 15 * MINUTE],
      [second, SENT_AT + 16 * MINUTE],
    ]);
    // A pipeline: one exec for the whole send, however many devices.
    expect(
      redis.calls.filter((call: string) => {
        return call === "exec";
      }),
    ).toHaveLength(1);
  });

  test("nothing to keep: Redis is not touched", async () => {
    expect(await queue.add([])).toBe(0);
    expect(redis.calls).toEqual([]);
  });

  test("Redis not connected: nothing is kept, nothing throws, and it is logged", async () => {
    isConnectedMock.mockReturnValue(false);

    expect(await queue.add([receipt()])).toBe(0);
    expect(redis.calls).toEqual([]);
    expect(getClientMock).not.toHaveBeenCalled();
    expect(loggerMock.debug).toHaveBeenCalledTimes(1);
  });

  test("a Redis that fails mid-way never fails the page being sent", async () => {
    redis.failing.add("exec");

    await expect(queue.add([receipt()])).resolves.toBe(0);
    expect(loggerMock.error).toHaveBeenCalledTimes(1);
  });

  test("what was due more than a day ago - nobody read it - is cleared", async () => {
    const now: number = SENT_AT + 3 * 24 * HOUR;
    const key: string = queue.getPendingKey();

    // Due a day and a millisecond ago, exactly a day ago, and just now.
    await redis.zadd(key, now - 24 * HOUR - 1, "stale");
    await redis.zadd(key, now - 24 * HOUR, "a day");
    await redis.zadd(key, now - 1, "recent");

    await queue.add([receiptNumber(9, now)], now);

    expect(
      redis.ordered(key).map((entry: [string, number]) => {
        return entry[0];
      }),
    ).toEqual(["a day", "recent", ExpoPushReceiptQueue.serialize(receiptNumber(9, now))]);
  });

  test("a backlog nobody reads is capped, and the receipts due first make way", async () => {
    const key: string = queue.getPendingKey();
    const set: Map<string, number> = new Map<string, number>();

    for (let index: number = 0; index < MAX_PENDING_EXPO_PUSH_RECEIPTS; index++) {
      set.set(`backlog-${String(index).padStart(6, "0")}`, SENT_AT + index);
    }

    redis.sortedSets.set(key, set);

    const newest: PendingExpoPushReceipt = receiptNumber(1, SENT_AT + 10 * HOUR);
    const next: PendingExpoPushReceipt = receiptNumber(2, SENT_AT + 10 * HOUR);

    await queue.add([newest, next], SENT_AT + 10 * HOUR);

    expect(redis.zcard(key)).toBe(MAX_PENDING_EXPO_PUSH_RECEIPTS);
    expect(set.has("backlog-000000")).toBe(false);
    expect(set.has("backlog-000001")).toBe(false);
    expect(set.has("backlog-000002")).toBe(true);
    expect(set.has(ExpoPushReceiptQueue.serialize(newest))).toBe(true);
    expect(set.has(ExpoPushReceiptQueue.serialize(next))).toBe(true);
  });

  test("the set expires two days after it was last written, if nothing ever reads it", async () => {
    await queue.add([receipt()]);

    expect(redis.expiries.get(queue.getPendingKey())).toBe(48 * HOUR);
  });

  test("a queue's keys are its own", async () => {
    const other: ExpoPushReceiptQueue = new ExpoPushReceiptQueue({
      keyPrefix: "other-receipts",
    });

    await queue.add([receiptNumber(1)]);
    await other.add([receiptNumber(2)]);

    expect(redis.zcard("test-receipts:pending")).toBe(1);
    expect(redis.zcard("other-receipts:pending")).toBe(1);
  });

  test("the product's queue", () => {
    expect(DefaultExpoPushReceiptQueue).toBeInstanceOf(ExpoPushReceiptQueue);
    expect(DefaultExpoPushReceiptQueue.getPendingKey()).toBe(
      "expo-push-receipts:pending",
    );
  });
});

describe("taking the receipts that are due (claimDue)", () => {
  test("only the due ones, the longest due first, up to the limit; taken out of the queue", async () => {
    const receipts: Array<PendingExpoPushReceipt> = [
      receiptNumber(1, SENT_AT + 2 * MINUTE),
      receiptNumber(2, SENT_AT),
      receiptNumber(3, SENT_AT + MINUTE),
      receiptNumber(4, SENT_AT + 30 * MINUTE),
    ];

    await queue.add(receipts, SENT_AT);

    const now: number = SENT_AT + 17 * MINUTE;

    expect(await queue.claimDue({ now: now, limit: 2 })).toEqual([
      receipts[1],
      receipts[2],
    ]);
    expect(await queue.claimDue({ now: now, limit: 10 })).toEqual([
      receipts[0],
    ]);
    expect(await queue.claimDue({ now: now, limit: 10 })).toEqual([]);

    // Not due yet: still waiting.
    expect(pending()).toEqual([[receipts[3], SENT_AT + 45 * MINUTE]]);
  });

  test("due exactly now counts as due", async () => {
    await queue.add([receipt()], SENT_AT);

    expect(
      await queue.claimDue({
        now: SENT_AT + EXPO_PUSH_RECEIPT_FIRST_CHECK_AFTER_MS,
        limit: 1,
      }),
    ).toEqual([receipt()]);
  });

  test("before 15 minutes have passed, nothing is due", async () => {
    await queue.add([receipt()], SENT_AT);

    expect(
      await queue.claimDue({ now: SENT_AT + 15 * MINUTE - 1, limit: 10 }),
    ).toEqual([]);
  });

  test("each receipt is taken by exactly one worker", async () => {
    const receipts: Array<PendingExpoPushReceipt> = [1, 2, 3, 4].map(
      (index: number) => {
        return receiptNumber(index);
      },
    );

    await queue.add(receipts, SENT_AT);

    // Another worker takes the second and fourth between our read and our ZREM.
    redis.beforeZrem = (members: Array<string>): void => {
      redis.sortedSets.get(queue.getPendingKey())!.delete(members[1]!);
      redis.sortedSets.get(queue.getPendingKey())!.delete(members[3]!);
    };

    expect(
      await queue.claimDue({ now: SENT_AT + HOUR, limit: 10 }),
    ).toEqual([receipts[0], receipts[2]]);
  });

  test("an entry that cannot be read is dropped and said, the others still taken", async () => {
    await queue.add([receipt()], SENT_AT);
    await redis.zadd(queue.getPendingKey(), SENT_AT, "{damaged");

    expect(await queue.claimDue({ now: SENT_AT + HOUR, limit: 10 })).toEqual([
      receipt(),
    ]);
    expect(redis.zcard(queue.getPendingKey())).toBe(0);
    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
  });

  test("a limit of nothing takes nothing, and asks Redis nothing", async () => {
    await queue.add([receipt()], SENT_AT);
    redis.calls.length = 0;

    expect(await queue.claimDue({ now: SENT_AT + HOUR, limit: 0 })).toEqual([]);
    expect(redis.calls).toEqual([]);
  });

  test("Redis not connected: nothing to take", async () => {
    isConnectedMock.mockReturnValue(false);

    expect(await queue.claimDue({ now: SENT_AT + HOUR, limit: 10 })).toEqual(
      [],
    );
  });

  test("a Redis that fails is the run's failure, said to its caller", async () => {
    redis.failing.add("zrangebyscore");

    await expect(
      queue.claimDue({ now: SENT_AT + HOUR, limit: 10 }),
    ).rejects.toThrow("zrangebyscore failed");
  });
});

describe("looking for a receipt again later (checkAgainLater)", () => {
  test("each is looked for again twice as long after its push, one look more", async () => {
    const now: number = SENT_AT + 15 * MINUTE;

    const outcome: { rescheduled: number; expired: number } =
      await queue.checkAgainLater(
        [receipt(), receiptNumber(2, SENT_AT - 15 * MINUTE)],
        now,
      );

    expect(outcome).toEqual({ rescheduled: 2, expired: 0 });
    expect(pending()).toEqual([
      [{ ...receiptNumber(2, SENT_AT - 15 * MINUTE), attempts: 1 }, SENT_AT + 15 * MINUTE + 5 * MINUTE],
      [{ ...receipt(), attempts: 1 }, SENT_AT + 30 * MINUTE],
    ]);
  });

  test("past the day Expo keeps receipts: given up, and not kept", async () => {
    const outcome: { rescheduled: number; expired: number } =
      await queue.checkAgainLater(
        [receipt({ attempts: 6 }), receipt({ receiptId: "a-b", attempts: 1 })],
        SENT_AT + 16 * HOUR,
      );

    expect(outcome).toEqual({ rescheduled: 1, expired: 1 });
    expect(pending()).toEqual([
      [receipt({ receiptId: "a-b", attempts: 2 }), SENT_AT + 16 * HOUR + 5 * MINUTE],
    ]);
  });

  test("nothing to look for again: Redis is not touched", async () => {
    expect(await queue.checkAgainLater([], SENT_AT)).toEqual({
      rescheduled: 0,
      expired: 0,
    });
    expect(redis.calls).toEqual([]);
  });

  test("Redis not connected: they cannot be kept, and count as given up", async () => {
    isConnectedMock.mockReturnValue(false);

    expect(
      await queue.checkAgainLater([receipt(), receiptNumber(2)], SENT_AT),
    ).toEqual({ rescheduled: 0, expired: 2 });
  });

  test("the set's expiry is renewed with them", async () => {
    await queue.checkAgainLater([receipt()], SENT_AT + 15 * MINUTE);

    expect(redis.expiries.get(queue.getPendingKey())).toBe(48 * HOUR);
  });
});

describe("when a token last registered (noteTokenRegistered, getTokenRegisteredAt)", () => {
  test("is kept for a day and an hour, and read back", async () => {
    await queue.noteTokenRegistered(TOKEN, SENT_AT + 7 * MINUTE);

    expect(await queue.getTokenRegisteredAt(TOKEN)).toBe(SENT_AT + 7 * MINUTE);

    const stored: { value: string; ttlSeconds: number } = redis.strings.get(
      queue.getTokenRegisteredKey(TOKEN),
    )!;

    expect(stored).toEqual({
      value: String(SENT_AT + 7 * MINUTE),
      ttlSeconds: 25 * 60 * 60,
    });
  });

  test("its key is a hash of the token: the token never appears in a key name", () => {
    const key: string = queue.getTokenRegisteredKey(TOKEN);

    expect(key).toBe(
      `test-receipts:registered:${createHash("sha256").update(TOKEN).digest("hex")}`,
    );
    expect(key).not.toContain(TOKEN);
    expect(key).not.toContain("queue-phone");
  });

  test("a token that never registered (or not within the day) has no time", async () => {
    expect(await queue.getTokenRegisteredAt(TOKEN)).toBeNull();
  });

  test("a stored time that is not a number is no time", async () => {
    await redis.set(queue.getTokenRegisteredKey(TOKEN), "garbage", "EX", 60);

    expect(await queue.getTokenRegisteredAt(TOKEN)).toBeNull();
  });

  test("Redis not connected: nothing is noted, and no time is known", async () => {
    isConnectedMock.mockReturnValue(false);

    await queue.noteTokenRegistered(TOKEN);

    expect(redis.calls).toEqual([]);
    expect(await queue.getTokenRegisteredAt(TOKEN)).toBeNull();
  });

  test("a Redis that fails never fails the registration", async () => {
    redis.failing.add("set");

    await expect(queue.noteTokenRegistered(TOKEN)).resolves.toBeUndefined();
    expect(loggerMock.error).toHaveBeenCalledTimes(1);
  });

  test("no token, nothing noted", async () => {
    await queue.noteTokenRegistered("");

    expect(redis.calls).toEqual([]);
  });
});
