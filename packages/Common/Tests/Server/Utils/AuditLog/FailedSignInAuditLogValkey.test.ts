import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The account's count of failed sign-ins (issue #6788), against a real
 * Valkey: the Lua that decides in one step whether an attempt is recorded,
 * the window that holds an account to FAILED_SIGN_INS_RECORDED_PER_WINDOW
 * entries however many networks the attempts come from, the attempts it
 * counts for the account's next entry, attempts made at the same moment,
 * and the expiry that forgets the count. FailedSignInAuditLog.test.ts holds
 * what is asked; here Valkey answers it.
 *
 * It needs Valkey: CI's test-setup.sh starts one on localhost:6310. Locally,
 * a disposable one:
 *
 *   docker run -d --rm -p 16397:6379 valkey/valkey:9.1-alpine
 *   FAILED_SIGN_IN_AUDIT_LOG_TEST_REDIS_URL=redis://localhost:16397 \
 *     npx jest Tests/Server/Utils/AuditLog/FailedSignInAuditLogValkey.test.ts
 *
 * Every account here is a fresh id, and the keys this suite wrote are
 * removed after each test.
 */

jest.mock("../../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: { getClient: jest.fn(), isConnected: jest.fn() },
  };
});

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import Redis from "../../../../Server/Infrastructure/Redis";
import FailedSignInAuditLog, {
  FailedSignInCount,
} from "../../../../Server/Utils/AuditLog/FailedSignInAuditLog";
import {
  FAILED_SIGN_IN_COUNT_KEPT_FOR_DAYS,
  FAILED_SIGN_IN_WINDOW_IN_MINUTES,
  FAILED_SIGN_INS_RECORDED_PER_WINDOW,
} from "../../../../Types/AuditLog/AuditLogSignInFailure";
import ObjectID from "../../../../Types/ObjectID";
import {
  TestRedisClient,
  connectTestRedis,
} from "../../TestingUtils/Redis/TestRedisClient";

const WINDOW_MS: number = FAILED_SIGN_IN_WINDOW_IN_MINUTES * 60 * 1000;
const START: number = Date.parse("2026-11-16T09:00:00.000Z");

let client: TestRedisClient;
const writtenUsers: Array<ObjectID> = [];

function newUser(): ObjectID {
  const userId: ObjectID = ObjectID.generate();
  writtenUsers.push(userId);
  return userId;
}

async function attempt(
  userId: ObjectID,
  at: number,
): Promise<FailedSignInCount> {
  const count: FailedSignInCount | null =
    await FailedSignInAuditLog.countAttempt({ userId, now: new Date(at) });

  expect(count).not.toBeNull();

  return count!;
}

beforeAll(async () => {
  client = await connectTestRedis(
    process.env["FAILED_SIGN_IN_AUDIT_LOG_TEST_REDIS_URL"],
  );
});

beforeEach(() => {
  jest.mocked(Redis.getClient).mockReturnValue(client);
  jest.mocked(Redis.isConnected).mockReturnValue(true);
});

afterEach(async () => {
  for (const userId of writtenUsers.splice(0)) {
    await client.del(FailedSignInAuditLog.getKey(userId));
  }
});

afterAll(async () => {
  await client.quit();
});

describe("an account's failed sign-ins in one window", () => {
  test("the first ones are recorded one by one, each standing for itself", async () => {
    const userId: ObjectID = newUser();

    for (
      let index: number = 0;
      index < FAILED_SIGN_INS_RECORDED_PER_WINDOW;
      index++
    ) {
      const count: FailedSignInCount = await attempt(
        userId,
        START + index * 1000,
      );

      expect(count.isRecorded).toBe(true);
      expect(count.attempts).toBe(1);
      expect(count.firstAttemptAt.getTime()).toBe(START + index * 1000);
    }
  });

  test("past the bound, they are counted rather than recorded", async () => {
    const userId: ObjectID = newUser();

    for (
      let index: number = 0;
      index < FAILED_SIGN_INS_RECORDED_PER_WINDOW;
      index++
    ) {
      await attempt(userId, START + index);
    }

    const firstHeldBack: number = START + 5000;

    expect(await attempt(userId, firstHeldBack)).toEqual({
      isRecorded: false,
      attempts: 1,
      firstAttemptAt: new Date(firstHeldBack),
    });
    expect(await attempt(userId, START + 6000)).toEqual({
      isRecorded: false,
      attempts: 2,
      firstAttemptAt: new Date(firstHeldBack),
    });
  });

  /*
   * A flood from many networks is one account's attempts all the same:
   * nothing the attempts carry splits the count.
   */
  test("a flood leaves the bound's entries, wherever it comes from", async () => {
    const userId: ObjectID = newUser();
    let recorded: number = 0;

    for (let index: number = 0; index < 500; index++) {
      if ((await attempt(userId, START + index * 100)).isRecorded) {
        recorded++;
      }
    }

    expect(recorded).toBe(FAILED_SIGN_INS_RECORDED_PER_WINDOW);
  });

  test("attempts made at the same moment are counted in turn, never past the bound", async () => {
    const userId: ObjectID = newUser();

    const counts: Array<FailedSignInCount> = await Promise.all(
      Array.from({ length: 40 }, (): Promise<FailedSignInCount> => {
        return attempt(userId, START);
      }),
    );

    expect(
      counts.filter((count: FailedSignInCount): boolean => {
        return count.isRecorded;
      }),
    ).toHaveLength(FAILED_SIGN_INS_RECORDED_PER_WINDOW);
    expect(
      counts
        .filter((count: FailedSignInCount): boolean => {
          return !count.isRecorded;
        })
        .map((count: FailedSignInCount): number => {
          return count.attempts;
        })
        .sort((a: number, b: number): number => {
          return a - b;
        }),
    ).toEqual(
      Array.from(
        { length: 40 - FAILED_SIGN_INS_RECORDED_PER_WINDOW },
        (_: unknown, index: number): number => {
          return index + 1;
        },
      ),
    );
  });

  test("each account has a count of its own", async () => {
    const flooded: ObjectID = newUser();
    const other: ObjectID = newUser();

    for (let index: number = 0; index < 30; index++) {
      await attempt(flooded, START + index);
    }

    expect((await attempt(other, START + 31)).isRecorded).toBe(true);
  });
});

describe("the next window", () => {
  test("its first attempt is recorded, standing for the ones counted before it", async () => {
    const userId: ObjectID = newUser();

    for (
      let index: number = 0;
      index < FAILED_SIGN_INS_RECORDED_PER_WINDOW + 25;
      index++
    ) {
      await attempt(userId, START + index * 1000);
    }

    const firstHeldBack: number =
      START + FAILED_SIGN_INS_RECORDED_PER_WINDOW * 1000;
    const next: FailedSignInCount = await attempt(userId, START + WINDOW_MS);

    expect(next).toEqual({
      isRecorded: true,
      attempts: 26,
      firstAttemptAt: new Date(firstHeldBack),
    });

    // Handed to that entry: the one after it stands for itself again.
    expect(await attempt(userId, START + WINDOW_MS + 1)).toEqual({
      isRecorded: true,
      attempts: 1,
      firstAttemptAt: new Date(START + WINDOW_MS + 1),
    });
  });

  test("starts with the first attempt after the window, not on the hour", async () => {
    const userId: ObjectID = newUser();

    for (
      let index: number = 0;
      index < FAILED_SIGN_INS_RECORDED_PER_WINDOW;
      index++
    ) {
      await attempt(userId, START);
    }

    // Still the first window, a millisecond before it ends.
    expect((await attempt(userId, START + WINDOW_MS - 1)).isRecorded).toBe(
      false,
    );

    const reopened: number = START + 3 * WINDOW_MS;

    for (
      let index: number = 0;
      index < FAILED_SIGN_INS_RECORDED_PER_WINDOW;
      index++
    ) {
      expect((await attempt(userId, reopened + index)).isRecorded).toBe(true);
    }

    expect((await attempt(userId, reopened + WINDOW_MS - 1)).isRecorded).toBe(
      false,
    );
  });
});

describe("how long the count is kept", () => {
  test("for thirty days after the last attempt", async () => {
    const userId: ObjectID = newUser();

    await attempt(userId, START);

    const seconds: number = await client.ttl(
      FailedSignInAuditLog.getKey(userId),
    );

    expect(seconds).toBeGreaterThan(
      FAILED_SIGN_IN_COUNT_KEPT_FOR_DAYS * 24 * 60 * 60 - 60,
    );
    expect(seconds).toBeLessThanOrEqual(
      FAILED_SIGN_IN_COUNT_KEPT_FOR_DAYS * 24 * 60 * 60,
    );
  });

  test("a count Valkey forgot starts over", async () => {
    const userId: ObjectID = newUser();

    for (let index: number = 0; index < 20; index++) {
      await attempt(userId, START + index);
    }

    await client.del(FailedSignInAuditLog.getKey(userId));

    expect(await attempt(userId, START + 21)).toEqual({
      isRecorded: true,
      attempts: 1,
      firstAttemptAt: new Date(START + 21),
    });
  });
});
