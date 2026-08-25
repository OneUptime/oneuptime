import UserTwoFactorBackupCodeService, {
  TwoFactorBackupCodeStatus,
} from "../../../Server/Services/UserTwoFactorBackupCodeService";
import TwoFactorBackupCode, {
  BackupCodeSetSize,
} from "../../../Server/Utils/TwoFactorBackupCode";
import UserTwoFactorBackupCode from "../../../Models/DatabaseModels/UserTwoFactorBackupCode";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import BadDataException from "../../../Types/Exception/BadDataException";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { FindOperator } from "typeorm";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * UserTwoFactorBackupCodeService -- minting, spending and counting a user's
 * recovery codes.
 *
 * WHAT THIS FILE IS GUARDING
 *
 * "Single use" is the ONLY promise a backup code makes beyond being a secret.
 * A code that can be spent twice is a code that keeps working after the user
 * has watched somebody use it, and the obvious implementation -- find the row,
 * check `usedAt`, then update it -- gets that wrong under exactly the
 * conditions an attacker would arrange. `consumeCode` therefore does the whole
 * thing in ONE conditional UPDATE, and the assertions below are about the
 * shape of that statement rather than about a value it returns, because the
 * atomicity lives in the SQL and nowhere else.
 *
 * The second thing guarded here is regeneration. It must REPLACE, never add:
 * a user who regenerates after losing a printed list has to know the lost list
 * is dead, and "generate ten more" leaves it alive.
 *
 * WHAT IS MOCKED, AND WHAT IS NOT
 *
 * The database is. `getRepository` is stubbed down to a `manager.query` spy so
 * the exact SQL and its bound parameters can be inspected -- there is no
 * Postgres in this suite, and the statement is the thing under test.
 *
 * TwoFactorBackupCode is NOT mocked. The digests written by regeneration are
 * checked against the real hashing function, because a service that stored
 * something other than the digest the login path recomputes would produce a
 * set of codes that has never worked and cannot be told apart from a set that
 * has all been used.
 *
 * The crypto itself is covered by
 * Common/Tests/Server/Utils/TwoFactorBackupCode.test.ts; the admin surfaces
 * that call into this service are covered by
 * Common/Tests/Server/Services/UserTwoFactorBackupCodeAdminSurface.test.ts.
 * ---------------------------------------------------------------------------
 */

const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

/*
 * The postgres driver hands back `[rows, rowCount]` for an UPDATE rather than
 * a bare row array. Every stub here reproduces that shape, because getting it
 * wrong is precisely how a consumed code could read as "not consumed" (or, far
 * worse, the other way round).
 */
type UpdateResultFunction = (rowCount: number) => Array<unknown>;

const updateResult: UpdateResultFunction = (
  rowCount: number,
): Array<unknown> => {
  const rows: Array<{ _id: string }> = [];

  for (let index: number = 0; index < rowCount; index++) {
    rows.push({ _id: ObjectID.generate().toString() });
  }

  return [rows, rowCount];
};

/*
 * Deliberately `any`. The Common suite type-checks its tests (unlike the App
 * suite, which transpiles only), and jest's own `Mock` generic does not line
 * up with the loosely typed `mock.calls` reads below.
 */
let queryMock: any;
let createSpy: any;
let countBySpy: any;
let findOneBySpy: any;
let deleteBySpy: any;

/* Every row `create` was asked to write, in order. */
let createdRows: Array<UserTwoFactorBackupCode> = [];

type StubQueryFunction = (result: unknown) => void;

const stubQuery: StubQueryFunction = (result: unknown): void => {
  queryMock.mockResolvedValue(result as never);
};

beforeEach(() => {
  jest.restoreAllMocks();

  createdRows = [];

  queryMock = jest.fn();
  stubQuery(updateResult(0));

  getJestSpyOn(UserTwoFactorBackupCodeService, "getRepository").mockReturnValue(
    {
      manager: {
        query: (...args: Array<unknown>): unknown => {
          return queryMock(...args);
        },
      },
    } as never,
  );

  createSpy = getJestSpyOn(
    UserTwoFactorBackupCodeService,
    "create",
  ).mockImplementation(async (input: any): Promise<UserTwoFactorBackupCode> => {
    createdRows.push(input.data as UserTwoFactorBackupCode);
    return input.data as UserTwoFactorBackupCode;
  });

  countBySpy = getJestSpyOn(
    UserTwoFactorBackupCodeService,
    "countBy",
  ).mockImplementation(async (): Promise<PositiveNumber> => {
    return new PositiveNumber(0);
  });

  findOneBySpy = getJestSpyOn(
    UserTwoFactorBackupCodeService,
    "findOneBy",
  ).mockImplementation(async (): Promise<UserTwoFactorBackupCode | null> => {
    return null;
  });

  deleteBySpy = getJestSpyOn(
    UserTwoFactorBackupCodeService,
    "deleteBy",
  ).mockImplementation(async (): Promise<number> => {
    return 0;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("regenerateForUser -- minting a set", () => {
  test("returns a full set of plaintext codes", async () => {
    const codes: Array<string> =
      await UserTwoFactorBackupCodeService.regenerateForUser({
        userId: USER_ID,
      });

    expect(codes).toHaveLength(BackupCodeSetSize);
    expect(new Set(codes).size).toBe(BackupCodeSetSize);
  });

  test("honours an explicit count", async () => {
    const codes: Array<string> =
      await UserTwoFactorBackupCodeService.regenerateForUser({
        userId: USER_ID,
        count: 4,
      });

    expect(codes).toHaveLength(4);
    expect(createSpy).toHaveBeenCalledTimes(4);
  });

  /*
   * THE ONE THAT MATTERS MOST. If the row held anything other than the digest
   * the login path recomputes -- the plaintext, a differently keyed hash, a
   * digest computed for the wrong user -- then every code in the set would be
   * rejected at sign-in, and the user would find out at the worst possible
   * moment: locked out, holding a list they were told to trust.
   */
  test("stores the digest the login path will recompute, never the code", async () => {
    const codes: Array<string> =
      await UserTwoFactorBackupCodeService.regenerateForUser({
        userId: USER_ID,
      });

    const storedHashes: Array<string> = createdRows.map(
      (row: UserTwoFactorBackupCode) => {
        return row.codeHash || "";
      },
    );

    const expectedHashes: Array<string> = codes.map((code: string) => {
      return TwoFactorBackupCode.hashCode({ code: code, userId: USER_ID });
    });

    expect(storedHashes).toEqual(expectedHashes);

    const leaked: Array<string> = codes.filter((code: string) => {
      return storedHashes.includes(code);
    });

    expect(leaked).toEqual([]);
  });

  test("owns every row to the user it was asked for", async () => {
    await UserTwoFactorBackupCodeService.regenerateForUser({
      userId: USER_ID,
    });

    const violations: Array<string> = [];

    for (const row of createdRows) {
      if (row.userId?.toString() !== USER_ID.toString()) {
        violations.push(String(row.userId));
      }
    }

    expect(violations).toEqual([]);
  });

  test("mints every row unused", async () => {
    await UserTwoFactorBackupCodeService.regenerateForUser({
      userId: USER_ID,
    });

    const spent: Array<unknown> = createdRows
      .map((row: UserTwoFactorBackupCode) => {
        return row.usedAt;
      })
      .filter((usedAt: Date | undefined) => {
        return Boolean(usedAt);
      });

    expect(spent).toEqual([]);
  });

  /*
   * REPLACE, not add. A user regenerating after losing a printed list is
   * telling us that list may be in somebody else's hands; leaving those codes
   * alive would make the button they pressed a no-op against the exact threat
   * they pressed it for.
   */
  test("deletes the previous set before writing the new one", async () => {
    await UserTwoFactorBackupCodeService.regenerateForUser({
      userId: USER_ID,
    });

    expect(deleteBySpy).toHaveBeenCalledTimes(1);

    const deleteOrder: number = deleteBySpy.mock.invocationCallOrder[0]!;
    const firstCreateOrder: number = createSpy.mock.invocationCallOrder[0]!;

    expect(deleteOrder).toBeLessThan(firstCreateOrder);
  });

  test("deletes only this user's codes, and does not cap below the set size", async () => {
    await UserTwoFactorBackupCodeService.regenerateForUser({
      userId: USER_ID,
    });

    expect(deleteBySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { userId: USER_ID },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      }),
    );
  });

  /*
   * Every write goes through `isRoot`. The model denies create to everybody --
   * including the code's own owner -- because a caller who could supply a
   * `codeHash` would be choosing their own recovery credential.
   */
  test("writes as root, because nothing else is permitted to", async () => {
    await UserTwoFactorBackupCodeService.regenerateForUser({
      userId: USER_ID,
    });

    const violations: Array<unknown> = [];

    for (const call of createSpy.mock.calls) {
      const input: any = (call as Array<unknown>)[0];

      if (input?.props?.isRoot !== true) {
        violations.push(input?.props);
      }
    }

    expect(violations).toEqual([]);
  });
});

describe("regenerateForUser -- when a write fails partway through", () => {
  /*
   * THE STATE THAT LOOKS LIKE THE GOOD ONE.
   *
   * The old set is deleted first, then the new rows go in one at a time. A
   * failure on, say, the fifth insert would otherwise leave four rows behind
   * -- rows the caller never returned to anybody, because it threw. The
   * profile page would then read "4 backup codes" off the database and tell a
   * user they have a recovery route, when in fact they hold none of those four
   * codes and never saw them.
   *
   * That is worse than having no codes at all, because "you have no backup
   * codes" is a warning the page already shows and the user can act on.
   */
  test("leaves no codes behind rather than codes nobody has seen", async () => {
    let created: number = 0;

    createSpy.mockImplementation(
      async (input: any): Promise<UserTwoFactorBackupCode> => {
        created++;

        if (created === 5) {
          throw new Error("Database not connected");
        }

        createdRows.push(input.data as UserTwoFactorBackupCode);
        return input.data as UserTwoFactorBackupCode;
      },
    );

    await expect(
      UserTwoFactorBackupCodeService.regenerateForUser({ userId: USER_ID }),
    ).rejects.toThrow("Database not connected");

    const violations: Array<string> = [];

    /*
     * Twice: once to clear the previous set, once to compensate for the
     * partial write. Both scoped to this user.
     */
    if (deleteBySpy.mock.calls.length !== 2) {
      violations.push(
        `expected two deletes, saw ${String(deleteBySpy.mock.calls.length)}`,
      );
    }

    const lastDeleteOrder: number =
      deleteBySpy.mock.invocationCallOrder[
        deleteBySpy.mock.invocationCallOrder.length - 1
      ]!;
    const lastCreateOrder: number =
      createSpy.mock.invocationCallOrder[
        createSpy.mock.invocationCallOrder.length - 1
      ]!;

    if (lastDeleteOrder < lastCreateOrder) {
      violations.push(
        "the compensating delete ran before the failing write, so it cleaned up nothing",
      );
    }

    expect(violations).toEqual([]);
  });

  /*
   * The ORIGINAL failure is what the caller has to see. If the compensating
   * delete also fails, reporting that one instead would tell an operator why
   * the rollback did not happen while hiding why the write did not -- and the
   * second is the one they can act on.
   */
  test("reports the write failure even when the cleanup also fails", async () => {
    createSpy.mockImplementation(async (): Promise<UserTwoFactorBackupCode> => {
      throw new Error("the write failed");
    });

    let cleanupAttempted: boolean = false;

    deleteBySpy.mockImplementation(async (): Promise<number> => {
      if (cleanupAttempted) {
        throw new Error("the cleanup failed");
      }

      cleanupAttempted = true;
      return 0;
    });

    await expect(
      UserTwoFactorBackupCodeService.regenerateForUser({ userId: USER_ID }),
    ).rejects.toThrow("the write failed");
  });

  /*
   * A failure in the FIRST delete must not be compensated, because nothing has
   * been written yet -- and, more to the point, the old set is still intact.
   * Re-running a delete that has just failed buys nothing and could mask the
   * fact that the user's existing codes are untouched.
   */
  test("does not write or compensate when the initial delete fails", async () => {
    deleteBySpy.mockImplementation(async (): Promise<number> => {
      throw new Error("Database not connected");
    });

    await expect(
      UserTwoFactorBackupCodeService.regenerateForUser({ userId: USER_ID }),
    ).rejects.toThrow("Database not connected");

    expect(deleteBySpy).toHaveBeenCalledTimes(1);
    expect(createSpy).not.toHaveBeenCalled();
  });
});

describe("onBeforeCreate -- the second lock on the create path", () => {
  /*
   * The table permission is the first lock, and `isRoot` walks straight past
   * it -- which every internal caller uses. So the hook has to refuse the two
   * things that would silently produce an unusable or unowned credential.
   */
  type InvokeHookFunction = (
    data: Partial<UserTwoFactorBackupCode>,
  ) => Promise<CreateBy<UserTwoFactorBackupCode>>;

  const invokeHook: InvokeHookFunction = async (
    data: Partial<UserTwoFactorBackupCode>,
  ): Promise<CreateBy<UserTwoFactorBackupCode>> => {
    const row: UserTwoFactorBackupCode = new UserTwoFactorBackupCode();
    Object.assign(row, data);

    const createBy: CreateBy<UserTwoFactorBackupCode> = {
      data: row,
      props: { isRoot: true },
    } as CreateBy<UserTwoFactorBackupCode>;

    const result: { createBy: CreateBy<UserTwoFactorBackupCode> } = await (
      UserTwoFactorBackupCodeService as any
    ).onBeforeCreate(createBy);

    return result.createBy;
  };

  test("refuses a row with no owner", async () => {
    await expect(invokeHook({ codeHash: "a".repeat(64) })).rejects.toThrow(
      BadDataException,
    );
  });

  test("refuses a row with no digest", async () => {
    await expect(invokeHook({ userId: USER_ID })).rejects.toThrow(
      BadDataException,
    );
  });

  /*
   * A code that arrives already spent is a caller confused about which end of
   * the lifecycle it is at -- and would be a row the user can never use,
   * counted against their remaining total.
   */
  test("strips a usedAt that a caller tried to set", async () => {
    const createBy: CreateBy<UserTwoFactorBackupCode> = await invokeHook({
      userId: USER_ID,
      codeHash: "a".repeat(64),
      usedAt: new Date(),
    });

    expect(createBy.data.usedAt).toBeUndefined();
  });

  test("lets a well formed row through", async () => {
    const createBy: CreateBy<UserTwoFactorBackupCode> = await invokeHook({
      userId: USER_ID,
      codeHash: "a".repeat(64),
    });

    expect(createBy.data.userId).toEqual(USER_ID);
    expect(createBy.data.codeHash).toBe("a".repeat(64));
  });
});

describe("consumeCode -- spending one, exactly once", () => {
  test("reports success when the statement matched a row", async () => {
    stubQuery(updateResult(1));

    await expect(
      UserTwoFactorBackupCodeService.consumeCode({
        userId: USER_ID,
        code: "ABCDE-12345",
      }),
    ).resolves.toBe(true);
  });

  test("reports failure when the statement matched nothing", async () => {
    stubQuery(updateResult(0));

    await expect(
      UserTwoFactorBackupCodeService.consumeCode({
        userId: USER_ID,
        code: "ABCDE-12345",
      }),
    ).resolves.toBe(false);
  });

  /*
   * THE ATOMICITY. `usedAt IS NULL` has to be in the WHERE clause of the same
   * statement that sets it, or two sign-ins carrying the same code both read a
   * null and both get let in. There is no assertion available for "this is
   * atomic" other than looking at the SQL, so that is what this does.
   */
  test("decides single-use inside the statement, not around it", async () => {
    stubQuery(updateResult(1));

    await UserTwoFactorBackupCodeService.consumeCode({
      userId: USER_ID,
      code: "ABCDE-12345",
    });

    const sql: string = String(
      (queryMock.mock.calls[0] as Array<unknown>)[0],
    ).replace(/\s+/g, " ");

    expect(sql).toContain('UPDATE "UserTwoFactorBackupCode"');
    expect(sql).toContain('"usedAt" IS NULL');
    expect(sql).toContain('RETURNING "_id"');
  });

  /*
   * Soft-deleted rows are still physically present. Without this predicate, a
   * code from a set that regeneration replaced would keep signing people in --
   * which is the one thing regeneration exists to stop.
   */
  test("ignores soft-deleted rows", async () => {
    stubQuery(updateResult(1));

    await UserTwoFactorBackupCodeService.consumeCode({
      userId: USER_ID,
      code: "ABCDE-12345",
    });

    const sql: string = String(
      (queryMock.mock.calls[0] as Array<unknown>)[0],
    ).replace(/\s+/g, " ");

    expect(sql).toContain('"deletedAt" IS NULL');
  });

  test("scopes the statement to the owning user", async () => {
    stubQuery(updateResult(1));

    await UserTwoFactorBackupCodeService.consumeCode({
      userId: USER_ID,
      code: "ABCDE-12345",
    });

    const [sql, params] = queryMock.mock.calls[0] as [string, Array<unknown>];

    expect(String(sql).replace(/\s+/g, " ")).toContain('"userId" = $2');
    expect(params[1]).toBe(USER_ID.toString());
  });

  /*
   * Every value is bound, never interpolated. The code is caller-supplied, so
   * an interpolated statement here would be a SQL injection on an
   * unauthenticated route.
   */
  test("binds every value as a parameter", async () => {
    stubQuery(updateResult(1));

    await UserTwoFactorBackupCodeService.consumeCode({
      userId: USER_ID,
      code: '\'; DROP TABLE "User"; --',
    });

    const [sql, params] = queryMock.mock.calls[0] as [string, Array<unknown>];

    expect(sql).not.toContain("DROP TABLE");
    expect(params).toHaveLength(3);
    expect(params[0]).toBeInstanceOf(Date);
  });

  test("looks the code up by its digest, never by the code itself", async () => {
    stubQuery(updateResult(1));

    const code: string = "ABCDE-12345";

    await UserTwoFactorBackupCodeService.consumeCode({
      userId: USER_ID,
      code: code,
    });

    const params: Array<unknown> = (
      queryMock.mock.calls[0] as [string, Array<unknown>]
    )[1];

    expect(params[2]).toBe(
      TwoFactorBackupCode.hashCode({ code: code, userId: USER_ID }),
    );

    expect(params).not.toContain(code);
    expect(params).not.toContain("ABCDE12345");
  });

  /*
   * The user is typing off a printed list, months later, on whatever keyboard
   * they have. Each of these is a way to reject somebody who supplied exactly
   * the right secret.
   */
  test.each([
    "ABCDE-12345",
    "ABCDE12345",
    "abcde-12345",
    "  ABCDE 12345  ",
    "abcde\n12345",
  ])("accepts the code typed as %p", async (typed: string) => {
    stubQuery(updateResult(1));

    await UserTwoFactorBackupCodeService.consumeCode({
      userId: USER_ID,
      code: typed,
    });

    const params: Array<unknown> = (
      queryMock.mock.calls[0] as [string, Array<unknown>]
    )[1];

    expect(params[2]).toBe(
      TwoFactorBackupCode.hashCode({
        code: "ABCDE12345",
        userId: USER_ID,
      }),
    );
  });

  /*
   * Refused before the round trip. An empty submission cannot be anybody's
   * code, and this route is one an attacker can call.
   */
  test.each([
    ["", "empty"],
    ["   ", "whitespace"],
    ["---", "punctuation only"],
  ])(
    "refuses %p (%s) without touching the database",
    async (code: string, _label: string) => {
      await expect(
        UserTwoFactorBackupCodeService.consumeCode({
          userId: USER_ID,
          code: code,
        }),
      ).resolves.toBe(false);

      expect(queryMock).not.toHaveBeenCalled();
    },
  );

  test.each([[undefined], [null], [12345], [{}]])(
    "refuses the non-string submission %p without throwing",
    async (code: unknown) => {
      await expect(
        UserTwoFactorBackupCodeService.consumeCode({
          userId: USER_ID,
          code: code as string,
        }),
      ).resolves.toBe(false);

      expect(queryMock).not.toHaveBeenCalled();
    },
  );

  /*
   * The driver's return shape is not something this code controls. Anything
   * it does not recognise must read as "no code was spent" -- the direction
   * that refuses a login, never the direction that grants one.
   */
  test.each([
    [null, "null"],
    [undefined, "undefined"],
    [[], "an empty array"],
    [[[], 0], "zero rows"],
    [{}, "an object"],
    [["not an array", 1], "a non-array rows slot"],
  ])(
    "treats %p (%s) as nothing consumed",
    async (result: unknown, _label: string) => {
      stubQuery(result);

      await expect(
        UserTwoFactorBackupCodeService.consumeCode({
          userId: USER_ID,
          code: "ABCDE-12345",
        }),
      ).resolves.toBe(false);
    },
  );

  test("stamps usedAt rather than leaving the row looking unspent", async () => {
    stubQuery(updateResult(1));

    await UserTwoFactorBackupCodeService.consumeCode({
      userId: USER_ID,
      code: "ABCDE-12345",
    });

    const [sql, params] = queryMock.mock.calls[0] as [string, Array<unknown>];

    expect(String(sql).replace(/\s+/g, " ")).toContain('SET "usedAt" = $1');
    expect(params[0]).toBeInstanceOf(Date);
  });
});

describe("countUnusedForUser", () => {
  /*
   * `usedAt: null` on its own is DROPPED by TypeORM rather than compiled to
   * `IS NULL`, so the count would silently include spent codes -- and the
   * login page would offer a recovery route to somebody with nothing left to
   * recover with.
   */
  test("counts only codes that have not been spent", async () => {
    countBySpy.mockImplementation(async (): Promise<PositiveNumber> => {
      return new PositiveNumber(7);
    });

    const unused: number =
      await UserTwoFactorBackupCodeService.countUnusedForUser({
        userId: USER_ID,
      });

    expect(unused).toBe(7);

    const call: { query: Record<string, any>; props: Record<string, unknown> } =
      (
        countBySpy.mock.calls[0] as Array<{
          query: Record<string, any>;
          props: Record<string, unknown>;
        }>
      )[0]!;

    expect(call.query["userId"]).toEqual(USER_ID);
    expect(call.props).toEqual({ isRoot: true });

    /*
     * Compared through the SQL the operator emits rather than by deep equality
     * against `QueryHelper.isNull()`. Two calls to that helper build two
     * different closures, so `toEqual` compares function identity and fails on
     * a query that is in fact correct -- and the thing worth pinning is the
     * SQL anyway: a bare `usedAt: null` is DROPPED by TypeORM rather than
     * compiled to `IS NULL`, so the count would silently include spent codes
     * and the login page would offer a recovery route to somebody with nothing
     * left to recover with.
     */
    const usedAtOperator: any = call.query["usedAt"];

    expect(usedAtOperator).toBeInstanceOf(FindOperator);
    expect(usedAtOperator.type).toBe("raw");
    expect(usedAtOperator.getSql('"usedAt"')).toContain("IS NULL");
  });

  test("reports zero for a user with no codes", async () => {
    countBySpy.mockImplementation(async (): Promise<PositiveNumber> => {
      return new PositiveNumber(0);
    });

    await expect(
      UserTwoFactorBackupCodeService.countUnusedForUser({ userId: USER_ID }),
    ).resolves.toBe(0);
  });
});

describe("getStatusForUser", () => {
  test("short-circuits for a user who has never generated any", async () => {
    countBySpy.mockImplementation(async (): Promise<PositiveNumber> => {
      return new PositiveNumber(0);
    });

    const status: TwoFactorBackupCodeStatus =
      await UserTwoFactorBackupCodeService.getStatusForUser({
        userId: USER_ID,
      });

    expect(status).toEqual({ total: 0, unused: 0, generatedAt: null });

    /*
     * One count, then nothing. Reading the newest row for a `generatedAt` that
     * cannot exist is a query per page load for no answer.
     */
    expect(countBySpy).toHaveBeenCalledTimes(1);
    expect(findOneBySpy).not.toHaveBeenCalled();
  });

  test("reports the total, the unused count and when the set was minted", async () => {
    const generatedAt: Date = new Date("2026-01-02T03:04:05.000Z");

    let call: number = 0;

    countBySpy.mockImplementation(async (): Promise<PositiveNumber> => {
      call++;
      // First call is the total, second is the unused count.
      return new PositiveNumber(call === 1 ? 10 : 4);
    });

    findOneBySpy.mockImplementation(
      async (): Promise<UserTwoFactorBackupCode> => {
        const row: UserTwoFactorBackupCode = new UserTwoFactorBackupCode();
        row.createdAt = generatedAt;
        return row;
      },
    );

    const status: TwoFactorBackupCodeStatus =
      await UserTwoFactorBackupCodeService.getStatusForUser({
        userId: USER_ID,
      });

    expect(status).toEqual({
      total: 10,
      unused: 4,
      generatedAt: generatedAt,
    });
  });

  /*
   * The rows carry a credential digest and no caller needs it, so nothing that
   * a stray log line could print is ever loaded.
   */
  test("never selects the digest", async () => {
    let call: number = 0;

    countBySpy.mockImplementation(async (): Promise<PositiveNumber> => {
      call++;
      return new PositiveNumber(call === 1 ? 10 : 4);
    });

    findOneBySpy.mockImplementation(
      async (): Promise<UserTwoFactorBackupCode> => {
        return new UserTwoFactorBackupCode();
      },
    );

    await UserTwoFactorBackupCodeService.getStatusForUser({
      userId: USER_ID,
    });

    const select: Record<string, unknown> = (
      findOneBySpy.mock.calls[0] as Array<{ select: Record<string, unknown> }>
    )[0]!.select;

    expect(select["codeHash"]).toBeUndefined();
    expect(select).toEqual({ createdAt: true });
  });
});

describe("deleteAllForUser", () => {
  test("removes every code the user has, scoped to that user", async () => {
    await UserTwoFactorBackupCodeService.deleteAllForUser({ userId: USER_ID });

    expect(deleteBySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { userId: USER_ID },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      }),
    );
  });
});
