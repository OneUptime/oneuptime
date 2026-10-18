import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The account's own count of wrong two factor codes (TwoFactorWrongCodes):
 * its schedule, what a waiting caller is told, what it asks of Valkey, and
 * that it refuses to check a code whenever it cannot count it. What Valkey
 * answers to it - the Lua, the expiry, codes sent at the same moment - is
 * TwoFactorWrongCodesValkey.test.ts.
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
import logger from "../../../Server/Utils/Logger";
import TwoFactorWrongCodes, {
  FIRST_WAIT_SECONDS,
  LONGEST_WAIT_SECONDS,
  OWNER_TOLD_AT_MOST_ONCE_IN_SECONDS,
  TwoFactorCodeCheck,
  TwoFactorCodeCheckOutcome,
  TwoFactorCodeKind,
  WRONG_CODES_BEFORE_WAITING,
  WRONG_CODES_FORGOTTEN_AFTER_SECONDS,
} from "../../../Server/Utils/TwoFactorWrongCodes";
import ObjectID from "../../../Types/ObjectID";

const USER_ID: ObjectID = new ObjectID("8f1c2d3e-4a5b-4c6d-8e7f-90a1b2c3d4e5");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e",
);

type EvalArguments = Array<unknown>;

/*
 * A stand-in for the client: records what is asked of it and answers what a
 * test says. Valkey's own answers are the other suite's business.
 */
class StandInClient {
  public evalCalls: Array<EvalArguments> = [];
  public delCalls: Array<Array<string>> = [];
  public setCalls: Array<Array<unknown>> = [];
  public evalAnswer: () => Promise<unknown> = (): Promise<unknown> => {
    return Promise.resolve([1, 1, 0]);
  };
  public delAnswer: () => Promise<unknown> = (): Promise<unknown> => {
    return Promise.resolve(1);
  };
  public setAnswer: () => Promise<unknown> = (): Promise<unknown> => {
    return Promise.resolve("OK");
  };

  public eval(...args: EvalArguments): Promise<unknown> {
    this.evalCalls.push(args);
    return this.evalAnswer();
  }

  public del(...keys: Array<string>): Promise<unknown> {
    this.delCalls.push(keys);
    return this.delAnswer();
  }

  public set(...args: Array<unknown>): Promise<unknown> {
    this.setCalls.push(args);
    return this.setAnswer();
  }
}

let client: StandInClient;

beforeEach(() => {
  client = new StandInClient();

  jest.mocked(Redis.getClient).mockReturnValue(client as never);
  jest.mocked(Redis.isConnected).mockReturnValue(true);
  jest.mocked(logger.warn).mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the schedule", () => {
  test("the shipped numbers: five free wrong codes, then a minute, doubling, up to an hour, forgotten after a day", () => {
    expect(WRONG_CODES_BEFORE_WAITING).toBe(5);
    expect(FIRST_WAIT_SECONDS).toBe(60);
    expect(LONGEST_WAIT_SECONDS).toBe(60 * 60);
    expect(WRONG_CODES_FORGOTTEN_AFTER_SECONDS).toBe(24 * 60 * 60);
    expect(OWNER_TOLD_AT_MOST_ONCE_IN_SECONDS).toBe(24 * 60 * 60);
  });

  test.each([
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0],
    [5, 60],
    [6, 120],
    [7, 240],
    [8, 480],
    [9, 960],
    [10, 1920],
    [11, 3600],
    [12, 3600],
    [50, 3600],
    [100000, 3600],
  ])(
    "after %i wrong codes in a row the next code waits %i seconds",
    (wrongCodesInARow: number, waitSeconds: number) => {
      expect(TwoFactorWrongCodes.getWaitSecondsAfter(wrongCodesInARow)).toBe(
        waitSeconds,
      );
    },
  );

  test("the wait never shrinks as wrong codes add up, and never passes the longest wait", () => {
    let previous: number = 0;

    for (let wrong: number = 0; wrong <= 200; wrong++) {
      const wait: number = TwoFactorWrongCodes.getWaitSecondsAfter(wrong);

      expect(wait).toBeGreaterThanOrEqual(previous);
      expect(wait).toBeLessThanOrEqual(LONGEST_WAIT_SECONDS);

      previous = wait;
    }
  });

  test("a day holds no more than a few dozen checked codes, however they are spaced", () => {
    /*
     * The fastest anybody can go: every code the moment its wait ends,
     * starting from nothing.
     */
    let elapsedSeconds: number = 0;
    let checked: number = 0;

    while (elapsedSeconds < 24 * 60 * 60) {
      checked++;
      elapsedSeconds += TwoFactorWrongCodes.getWaitSecondsAfter(checked);
    }

    expect(checked).toBeLessThanOrEqual(5 + 6 + 24);
  });
});

describe("what a waiting caller is told", () => {
  test.each([
    [1, "1 minute"],
    [59, "1 minute"],
    [60, "1 minute"],
    [61, "2 minutes"],
    [960, "16 minutes"],
    [3540, "59 minutes"],
    [3541, "1 hour"],
    [3600, "1 hour"],
    [7200, "2 hours"],
  ])("a wait of %i seconds reads %s", (seconds: number, words: string) => {
    expect(TwoFactorWrongCodes.describeWait(seconds)).toBe(words);
  });

  test("an authenticator code: how long, the backup code, and what to do if it was not them", () => {
    expect(
      TwoFactorWrongCodes.getWaitingMessage(
        TwoFactorCodeKind.AuthenticatorCode,
        240,
      ),
    ).toBe(
      "Too many wrong codes have been entered for this account. Please wait 4 minutes before you try another code, or use a backup code. If you did not enter these codes, reset your password.",
    );
  });

  test("a backup code: its own words", () => {
    expect(
      TwoFactorWrongCodes.getWaitingMessage(TwoFactorCodeKind.BackupCode, 60),
    ).toBe(
      "Too many wrong backup codes have been entered for this account. Please wait 1 minute before you try another one. If you did not enter these codes, reset your password.",
    );
  });
});

describe("what it asks of Valkey", () => {
  test("one evaluation, on the account's key for the kind of code, with the schedule's numbers and the time", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);

    await TwoFactorWrongCodes.startCheck({
      userId: USER_ID,
      kind: TwoFactorCodeKind.AuthenticatorCode,
    });

    expect(client.evalCalls).toHaveLength(1);

    const [script, keyCount, ...rest] = client.evalCalls[0]!;

    expect(typeof script).toBe("string");
    expect(keyCount).toBe(1);
    expect(rest).toEqual([
      TwoFactorWrongCodes.getKey(TwoFactorCodeKind.AuthenticatorCode, USER_ID),
      "1800000000000",
      "5",
      "60000",
      "3600000",
      "86400",
    ]);
  });

  test("each kind of code, and each account, has a key of its own", () => {
    const keys: Array<string> = [
      TwoFactorWrongCodes.getKey(TwoFactorCodeKind.AuthenticatorCode, USER_ID),
      TwoFactorWrongCodes.getKey(TwoFactorCodeKind.BackupCode, USER_ID),
      TwoFactorWrongCodes.getToldKey(USER_ID),
      TwoFactorWrongCodes.getKey(
        TwoFactorCodeKind.AuthenticatorCode,
        OTHER_USER_ID,
      ),
      TwoFactorWrongCodes.getKey(TwoFactorCodeKind.BackupCode, OTHER_USER_ID),
      TwoFactorWrongCodes.getToldKey(OTHER_USER_ID),
    ];

    expect(new Set(keys).size).toBe(keys.length);
  });

  test("an account's keys share the hash tag of its id, so a cluster keeps them on one node", () => {
    const tag: string = `{${USER_ID.toString()}}`;

    for (const key of [
      TwoFactorWrongCodes.getKey(TwoFactorCodeKind.AuthenticatorCode, USER_ID),
      TwoFactorWrongCodes.getKey(TwoFactorCodeKind.BackupCode, USER_ID),
      TwoFactorWrongCodes.getToldKey(USER_ID),
    ]) {
      expect(key.startsWith("identity:two-factor-wrong-codes:")).toBe(true);
      expect(key.indexOf("{")).toBe(key.indexOf(tag));
      expect(key.split("{")).toHaveLength(2);
    }
  });

  test("an allowed code says how many wrong codes it would make, and how long the next would wait", async () => {
    client.evalAnswer = (): Promise<unknown> => {
      return Promise.resolve([1, 6, 120000]);
    };

    const check: TwoFactorCodeCheck = await TwoFactorWrongCodes.startCheck({
      userId: USER_ID,
      kind: TwoFactorCodeKind.AuthenticatorCode,
    });

    expect(check).toEqual({
      outcome: TwoFactorCodeCheckOutcome.Allowed,
      wrongCodesInARow: 6,
      waitSeconds: 120,
    });
  });

  test("a refused code says how long is left, rounded up, and never less than a second", async () => {
    client.evalAnswer = (): Promise<unknown> => {
      return Promise.resolve([0, 7, 1500]);
    };

    expect(
      await TwoFactorWrongCodes.startCheck({
        userId: USER_ID,
        kind: TwoFactorCodeKind.BackupCode,
      }),
    ).toEqual({
      outcome: TwoFactorCodeCheckOutcome.Waiting,
      wrongCodesInARow: 7,
      waitSeconds: 2,
    });

    client.evalAnswer = (): Promise<unknown> => {
      return Promise.resolve([0, 5, 0]);
    };

    expect(
      (
        await TwoFactorWrongCodes.startCheck({
          userId: USER_ID,
          kind: TwoFactorCodeKind.BackupCode,
        })
      ).waitSeconds,
    ).toBe(1);
  });
});

describe("no count, no check", () => {
  const unavailable: TwoFactorCodeCheck = {
    outcome: TwoFactorCodeCheckOutcome.CounterUnavailable,
    wrongCodesInARow: 0,
    waitSeconds: 0,
  };

  test("no client", async () => {
    jest.mocked(Redis.getClient).mockReturnValue(null);

    expect(
      await TwoFactorWrongCodes.startCheck({
        userId: USER_ID,
        kind: TwoFactorCodeKind.AuthenticatorCode,
      }),
    ).toEqual(unavailable);
  });

  test("a client that is not connected", async () => {
    jest.mocked(Redis.isConnected).mockReturnValue(false);

    expect(
      await TwoFactorWrongCodes.startCheck({
        userId: USER_ID,
        kind: TwoFactorCodeKind.AuthenticatorCode,
      }),
    ).toEqual(unavailable);
    expect(client.evalCalls).toHaveLength(0);
  });

  test("an evaluation that fails", async () => {
    client.evalAnswer = (): Promise<unknown> => {
      return Promise.reject(new Error("READONLY You can't write"));
    };

    expect(
      await TwoFactorWrongCodes.startCheck({
        userId: USER_ID,
        kind: TwoFactorCodeKind.BackupCode,
      }),
    ).toEqual(unavailable);
  });

  test.each([
    [null],
    ["OK"],
    [[1, 2]],
    [[1, 2, 3, 4]],
    [[1, "2", 3]],
    [[1, 2, Number.NaN]],
    [{ 0: 1, 1: 2, 2: 3 }],
  ])("an answer that is not the script's: %p", async (answer: unknown) => {
    client.evalAnswer = (): Promise<unknown> => {
      return Promise.resolve(answer);
    };

    expect(
      await TwoFactorWrongCodes.startCheck({
        userId: USER_ID,
        kind: TwoFactorCodeKind.AuthenticatorCode,
      }),
    ).toEqual(unavailable);
  });

  test("a failing count is logged once a minute, not once a request", async () => {
    let now: number = 1_900_000_000_000;
    jest.spyOn(Date, "now").mockImplementation((): number => {
      return now;
    });

    client.evalAnswer = (): Promise<unknown> => {
      return Promise.reject(new Error("connection lost"));
    };

    for (let index: number = 0; index < 20; index++) {
      await TwoFactorWrongCodes.startCheck({
        userId: USER_ID,
        kind: TwoFactorCodeKind.AuthenticatorCode,
      });
    }

    const linesAfterTheFirstMinute: number = jest.mocked(logger.warn).mock
      .calls.length;

    expect(linesAfterTheFirstMinute).toBeLessThanOrEqual(2);

    now += 61 * 1000;

    await TwoFactorWrongCodes.startCheck({
      userId: USER_ID,
      kind: TwoFactorCodeKind.AuthenticatorCode,
    });

    expect(jest.mocked(logger.warn).mock.calls.length).toBeGreaterThan(
      linesAfterTheFirstMinute,
    );
  });
});

describe("forgetting an account's wrong codes", () => {
  test("removes both kinds of count, in one command", async () => {
    await TwoFactorWrongCodes.forget(USER_ID);

    expect(client.delCalls).toEqual([
      [
        TwoFactorWrongCodes.getKey(
          TwoFactorCodeKind.AuthenticatorCode,
          USER_ID,
        ),
        TwoFactorWrongCodes.getKey(TwoFactorCodeKind.BackupCode, USER_ID),
      ],
    ]);
  });

  test("leaves whether the owner was told today alone, so a sign-in in between sends no second mail that day", async () => {
    await TwoFactorWrongCodes.forget(USER_ID);

    expect(client.delCalls.flat()).not.toContain(
      TwoFactorWrongCodes.getToldKey(USER_ID),
    );
  });

  test("never throws: what called it has already succeeded", async () => {
    client.delAnswer = (): Promise<unknown> => {
      return Promise.reject(new Error("connection lost"));
    };

    await expect(TwoFactorWrongCodes.forget(USER_ID)).resolves.toBeUndefined();

    jest.mocked(Redis.getClient).mockReturnValue(null);

    await expect(TwoFactorWrongCodes.forget(USER_ID)).resolves.toBeUndefined();

    jest.mocked(Redis.getClient).mockReturnValue(client as never);
    jest.mocked(Redis.isConnected).mockReturnValue(false);

    await expect(TwoFactorWrongCodes.forget(USER_ID)).resolves.toBeUndefined();
  });
});

describe("telling the owner", () => {
  test("not while the codes are still free: nothing is even asked of Valkey", async () => {
    for (let wrong: number = 0; wrong < WRONG_CODES_BEFORE_WAITING; wrong++) {
      expect(
        await TwoFactorWrongCodes.shouldTellOwner({
          userId: USER_ID,
          wrongCodesInARow: wrong,
        }),
      ).toBe(false);
    }

    expect(client.setCalls).toHaveLength(0);
  });

  test("once the waits begin, through one SET NX that lasts a day", async () => {
    expect(
      await TwoFactorWrongCodes.shouldTellOwner({
        userId: USER_ID,
        wrongCodesInARow: WRONG_CODES_BEFORE_WAITING,
      }),
    ).toBe(true);

    expect(client.setCalls).toHaveLength(1);

    const [key, , expiry, seconds, onlyIfNew] = client.setCalls[0]!;

    expect(key).toBe(TwoFactorWrongCodes.getToldKey(USER_ID));
    expect(expiry).toBe("EX");
    expect(seconds).toBe(24 * 60 * 60);
    expect(onlyIfNew).toBe("NX");
  });

  test("not again while the day's mark stands", async () => {
    client.setAnswer = (): Promise<unknown> => {
      return Promise.resolve(null);
    };

    expect(
      await TwoFactorWrongCodes.shouldTellOwner({
        userId: USER_ID,
        wrongCodesInARow: 9,
      }),
    ).toBe(false);
  });

  test("not when Valkey cannot say whether they were told: an unbounded run of mails is worse than one missed", async () => {
    client.setAnswer = (): Promise<unknown> => {
      return Promise.reject(new Error("connection lost"));
    };

    expect(
      await TwoFactorWrongCodes.shouldTellOwner({
        userId: USER_ID,
        wrongCodesInARow: 5,
      }),
    ).toBe(false);

    jest.mocked(Redis.getClient).mockReturnValue(null);

    expect(
      await TwoFactorWrongCodes.shouldTellOwner({
        userId: USER_ID,
        wrongCodesInARow: 5,
      }),
    ).toBe(false);
  });
});
