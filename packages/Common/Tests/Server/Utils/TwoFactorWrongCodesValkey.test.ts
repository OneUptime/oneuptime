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
 * The account's count of wrong two factor codes, against a real Valkey: the
 * Lua that decides in one step whether a code may be checked and counts it,
 * the waits it hands out, the expiry that forgets wrong codes a day after the
 * last one, codes sent at the same moment, and the once-a-day mark for the
 * owner's email. TwoFactorWrongCodes.test.ts holds what is asked; here Valkey
 * answers it.
 *
 * It needs Valkey: CI's test-setup.sh starts one on localhost:6310. Locally,
 * a disposable one:
 *
 *   docker run -d --rm -p 16397:6379 valkey/valkey:9.1-alpine
 *   TWO_FACTOR_WRONG_CODES_TEST_REDIS_URL=redis://localhost:16397 \
 *     npx jest Tests/Server/Utils/TwoFactorWrongCodesValkey.test.ts
 *
 * Every account here is a fresh id, and the keys this suite wrote are removed
 * after each test.
 */

jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: { getClient: jest.fn(), isConnected: jest.fn() },
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
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import Redis from "../../../Server/Infrastructure/Redis";
import TwoFactorWrongCodes, {
  LONGEST_WAIT_SECONDS,
  TwoFactorCodeCheck,
  TwoFactorCodeCheckOutcome,
  TwoFactorCodeKind,
  WRONG_CODES_BEFORE_WAITING,
  WRONG_CODES_FORGOTTEN_AFTER_SECONDS,
} from "../../../Server/Utils/TwoFactorWrongCodes";
import ObjectID from "../../../Types/ObjectID";
import {
  TestRedisClient,
  connectTestRedis,
} from "../TestingUtils/Redis/TestRedisClient";

let client: TestRedisClient;
let now: number = 0;
const writtenUsers: Array<ObjectID> = [];

function newUser(): ObjectID {
  const userId: ObjectID = ObjectID.generate();
  writtenUsers.push(userId);
  return userId;
}

function check(
  userId: ObjectID,
  kind: TwoFactorCodeKind = TwoFactorCodeKind.AuthenticatorCode,
): Promise<TwoFactorCodeCheck> {
  return TwoFactorWrongCodes.startCheck({ userId, kind });
}

/*
 * Wrong codes entered one after another, each the moment it is allowed. The
 * clock is left at the last of them: inside the wait that follows it, when
 * there is one.
 */
async function wrongCodes(
  userId: ObjectID,
  count: number,
  kind: TwoFactorCodeKind = TwoFactorCodeKind.AuthenticatorCode,
): Promise<Array<TwoFactorCodeCheck>> {
  const checks: Array<TwoFactorCodeCheck> = [];

  for (let index: number = 0; index < count; index++) {
    if (index > 0) {
      now += checks[index - 1]!.waitSeconds * 1000;
    }

    const answer: TwoFactorCodeCheck = await check(userId, kind);

    expect(answer.outcome).toBe(TwoFactorCodeCheckOutcome.Allowed);

    checks.push(answer);
  }

  return checks;
}

beforeAll(async () => {
  client = await connectTestRedis(
    process.env["TWO_FACTOR_WRONG_CODES_TEST_REDIS_URL"],
  );
});

beforeEach(() => {
  jest.mocked(Redis.getClient).mockReturnValue(client);
  jest.mocked(Redis.isConnected).mockReturnValue(true);

  // A clock of the suite's own, moved by the tests: the time the Lua is told.
  now = Date.UTC(2026, 9, 18, 12, 0, 0);
  jest.spyOn(Date, "now").mockImplementation((): number => {
    return now;
  });
});

afterEach(async () => {
  jest.restoreAllMocks();

  for (const userId of writtenUsers) {
    await client.del(
      TwoFactorWrongCodes.getKey(TwoFactorCodeKind.AuthenticatorCode, userId),
      TwoFactorWrongCodes.getKey(TwoFactorCodeKind.BackupCode, userId),
      TwoFactorWrongCodes.getToldKey(userId),
    );
  }

  writtenUsers.length = 0;
});

afterAll(() => {
  client?.disconnect();
});

describe("the count Valkey keeps", () => {
  test("the first wrong codes are free, and the fifth starts the wait", async () => {
    const userId: ObjectID = newUser();

    const checks: Array<TwoFactorCodeCheck> = [];

    for (let index: number = 0; index < WRONG_CODES_BEFORE_WAITING; index++) {
      checks.push(await check(userId));
    }

    expect(checks).toEqual([
      {
        outcome: TwoFactorCodeCheckOutcome.Allowed,
        wrongCodesInARow: 1,
        waitSeconds: 0,
      },
      {
        outcome: TwoFactorCodeCheckOutcome.Allowed,
        wrongCodesInARow: 2,
        waitSeconds: 0,
      },
      {
        outcome: TwoFactorCodeCheckOutcome.Allowed,
        wrongCodesInARow: 3,
        waitSeconds: 0,
      },
      {
        outcome: TwoFactorCodeCheckOutcome.Allowed,
        wrongCodesInARow: 4,
        waitSeconds: 0,
      },
      {
        outcome: TwoFactorCodeCheckOutcome.Allowed,
        wrongCodesInARow: 5,
        waitSeconds: 60,
      },
    ]);

    expect(await check(userId)).toEqual({
      outcome: TwoFactorCodeCheckOutcome.Waiting,
      wrongCodesInARow: 5,
      waitSeconds: 60,
    });
  });

  test("the waits the Lua hands out are the schedule's, wrong code after wrong code", async () => {
    const userId: ObjectID = newUser();

    const checks: Array<TwoFactorCodeCheck> = await wrongCodes(userId, 20);

    expect(
      checks.map((answer: TwoFactorCodeCheck): number => {
        return answer.waitSeconds;
      }),
    ).toEqual(
      checks.map((answer: TwoFactorCodeCheck): number => {
        return TwoFactorWrongCodes.getWaitSecondsAfter(answer.wrongCodesInARow);
      }),
    );

    expect(
      checks.map((answer: TwoFactorCodeCheck): number => {
        return answer.wrongCodesInARow;
      }),
    ).toEqual(
      Array.from({ length: 20 }, (_value: unknown, index: number): number => {
        return index + 1;
      }),
    );

    expect(checks[checks.length - 1]!.waitSeconds).toBe(LONGEST_WAIT_SECONDS);
  });

  test("a code sent before the wait ends is refused, and the refusal changes nothing", async () => {
    const userId: ObjectID = newUser();

    await wrongCodes(userId, 6);

    // The sixth wrong code was just counted: the seventh waits two minutes.
    const key: string = TwoFactorWrongCodes.getKey(
      TwoFactorCodeKind.AuthenticatorCode,
      userId,
    );
    const stored: Record<string, string> = await client.hgetall(key);

    for (let index: number = 0; index < 50; index++) {
      now += 1000;

      const answer: TwoFactorCodeCheck = await check(userId);

      expect(answer.outcome).toBe(TwoFactorCodeCheckOutcome.Waiting);
      expect(answer.wrongCodesInARow).toBe(6);
      expect(answer.waitSeconds).toBe(120 - (index + 1));
    }

    expect(await client.hgetall(key)).toEqual(stored);

    now += 70 * 1000;

    expect((await check(userId)).outcome).toBe(
      TwoFactorCodeCheckOutcome.Allowed,
    );
  });

  test("one millisecond early is still early", async () => {
    const userId: ObjectID = newUser();

    for (let index: number = 0; index < WRONG_CODES_BEFORE_WAITING; index++) {
      await check(userId);
    }

    now += 60 * 1000 - 1;
    expect((await check(userId)).outcome).toBe(
      TwoFactorCodeCheckOutcome.Waiting,
    );

    now += 1;
    expect((await check(userId)).outcome).toBe(
      TwoFactorCodeCheckOutcome.Allowed,
    );
  });

  test("codes sent at the same moment are attempts in a row: five are checked, never more", async () => {
    const userId: ObjectID = newUser();

    const answers: Array<TwoFactorCodeCheck> = await Promise.all(
      Array.from({ length: 60 }, (): Promise<TwoFactorCodeCheck> => {
        return check(userId);
      }),
    );

    const allowed: Array<TwoFactorCodeCheck> = answers.filter(
      (answer: TwoFactorCodeCheck): boolean => {
        return answer.outcome === TwoFactorCodeCheckOutcome.Allowed;
      },
    );

    expect(allowed).toHaveLength(WRONG_CODES_BEFORE_WAITING);
    expect(
      allowed
        .map((answer: TwoFactorCodeCheck): number => {
          return answer.wrongCodesInARow;
        })
        .sort(),
    ).toEqual([1, 2, 3, 4, 5]);
  });

  test("wrong codes are forgotten a day after the last one: each counted code renews the expiry", async () => {
    const userId: ObjectID = newUser();
    const key: string = TwoFactorWrongCodes.getKey(
      TwoFactorCodeKind.AuthenticatorCode,
      userId,
    );

    await check(userId);

    expect(await client.ttl(key)).toBeGreaterThan(
      WRONG_CODES_FORGOTTEN_AFTER_SECONDS - 10,
    );
    expect(await client.ttl(key)).toBeLessThanOrEqual(
      WRONG_CODES_FORGOTTEN_AFTER_SECONDS,
    );

    await client.expire(key, 100);
    await check(userId);

    expect(await client.ttl(key)).toBeGreaterThan(
      WRONG_CODES_FORGOTTEN_AFTER_SECONDS - 10,
    );

    // A day's silence: the key is gone, and the next code is the first.
    await client.del(key);

    expect(await check(userId)).toEqual({
      outcome: TwoFactorCodeCheckOutcome.Allowed,
      wrongCodesInARow: 1,
      waitSeconds: 0,
    });
  });

  test("a refused code does not renew the expiry either", async () => {
    const userId: ObjectID = newUser();
    const key: string = TwoFactorWrongCodes.getKey(
      TwoFactorCodeKind.AuthenticatorCode,
      userId,
    );

    for (let index: number = 0; index < WRONG_CODES_BEFORE_WAITING; index++) {
      await check(userId);
    }

    await client.expire(key, 500);

    expect((await check(userId)).outcome).toBe(
      TwoFactorCodeCheckOutcome.Waiting,
    );
    expect(await client.ttl(key)).toBeLessThanOrEqual(500);
  });

  test("a longest wait never outlives the count: the key lives longer than any wait", () => {
    expect(WRONG_CODES_FORGOTTEN_AFTER_SECONDS).toBeGreaterThan(
      LONGEST_WAIT_SECONDS * 4,
    );
  });
});

describe("kinds and accounts are counted apart", () => {
  test("an account waiting on authenticator codes still has its backup codes checked", async () => {
    const userId: ObjectID = newUser();

    await wrongCodes(userId, 8);

    expect((await check(userId)).outcome).toBe(
      TwoFactorCodeCheckOutcome.Waiting,
    );

    expect(await check(userId, TwoFactorCodeKind.BackupCode)).toEqual({
      outcome: TwoFactorCodeCheckOutcome.Allowed,
      wrongCodesInARow: 1,
      waitSeconds: 0,
    });
  });

  test("and the other way round", async () => {
    const userId: ObjectID = newUser();

    await wrongCodes(userId, 6, TwoFactorCodeKind.BackupCode);

    expect((await check(userId, TwoFactorCodeKind.BackupCode)).outcome).toBe(
      TwoFactorCodeCheckOutcome.Waiting,
    );
    expect((await check(userId)).wrongCodesInARow).toBe(1);
  });

  test("another account's wrong codes are not this account's", async () => {
    const waiting: ObjectID = newUser();
    const other: ObjectID = newUser();

    await wrongCodes(waiting, 7);

    expect((await check(waiting)).outcome).toBe(
      TwoFactorCodeCheckOutcome.Waiting,
    );
    expect(await check(other)).toEqual({
      outcome: TwoFactorCodeCheckOutcome.Allowed,
      wrongCodesInARow: 1,
      waitSeconds: 0,
    });
  });
});

describe("forgetting", () => {
  test("ends the wait at once, for both kinds of code, and the next wrong code is the first again", async () => {
    const userId: ObjectID = newUser();

    await wrongCodes(userId, 9);
    await wrongCodes(userId, 7, TwoFactorCodeKind.BackupCode);

    expect((await check(userId)).outcome).toBe(
      TwoFactorCodeCheckOutcome.Waiting,
    );

    await TwoFactorWrongCodes.forget(userId);

    expect(await check(userId)).toEqual({
      outcome: TwoFactorCodeCheckOutcome.Allowed,
      wrongCodesInARow: 1,
      waitSeconds: 0,
    });
    expect(await check(userId, TwoFactorCodeKind.BackupCode)).toEqual({
      outcome: TwoFactorCodeCheckOutcome.Allowed,
      wrongCodesInARow: 1,
      waitSeconds: 0,
    });
  });

  test("touches no other account", async () => {
    const forgotten: ObjectID = newUser();
    const kept: ObjectID = newUser();

    await wrongCodes(forgotten, 6);
    await wrongCodes(kept, 6);

    await TwoFactorWrongCodes.forget(forgotten);

    expect((await check(kept)).outcome).toBe(
      TwoFactorCodeCheckOutcome.Waiting,
    );
  });
});

describe("the owner's email: once a day", () => {
  test("told when the waits begin, then not again that day, whatever else happens", async () => {
    const userId: ObjectID = newUser();

    expect(
      await TwoFactorWrongCodes.shouldTellOwner({
        userId,
        wrongCodesInARow: 4,
      }),
    ).toBe(false);

    expect(
      await TwoFactorWrongCodes.shouldTellOwner({
        userId,
        wrongCodesInARow: 5,
      }),
    ).toBe(true);

    for (const wrongCodesInARow of [5, 6, 12, 40]) {
      expect(
        await TwoFactorWrongCodes.shouldTellOwner({
          userId,
          wrongCodesInARow,
        }),
      ).toBe(false);
    }

    // A sign-in in between ends the wait, not the day's mark.
    await TwoFactorWrongCodes.forget(userId);

    expect(
      await TwoFactorWrongCodes.shouldTellOwner({
        userId,
        wrongCodesInARow: 5,
      }),
    ).toBe(false);

    const ttl: number = await client.ttl(TwoFactorWrongCodes.getToldKey(userId));

    expect(ttl).toBeGreaterThan(24 * 60 * 60 - 10);
    expect(ttl).toBeLessThanOrEqual(24 * 60 * 60);

    // The next day, the owner is told again.
    await client.del(TwoFactorWrongCodes.getToldKey(userId));

    expect(
      await TwoFactorWrongCodes.shouldTellOwner({
        userId,
        wrongCodesInARow: 6,
      }),
    ).toBe(true);
  });

  test("each account is told about its own codes", async () => {
    const first: ObjectID = newUser();
    const second: ObjectID = newUser();

    expect(
      await TwoFactorWrongCodes.shouldTellOwner({
        userId: first,
        wrongCodesInARow: 5,
      }),
    ).toBe(true);
    expect(
      await TwoFactorWrongCodes.shouldTellOwner({
        userId: second,
        wrongCodesInARow: 5,
      }),
    ).toBe(true);
  });
});
