import UserTwoFactorBackupCodeService from "../../../Server/Services/UserTwoFactorBackupCodeService";
import TwoFactorBackupCode, {
  BackupCodeSetSize,
} from "../../../Server/Utils/TwoFactorBackupCode";
import logger from "../../../Server/Utils/Logger";
import UserTwoFactorBackupCode from "../../../Models/DatabaseModels/UserTwoFactorBackupCode";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
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
 * generateForUserIfNone -- minting a recovery set for an account that has
 * none, at the moment a second factor is enrolled.
 *
 * WHY THIS METHOD EXISTS AT ALL
 *
 * Backup codes shipped, and then essentially nobody had any: the only writer
 * was a button on the profile page that a user had to go and find, so
 * `countUnusedForUser` was zero for almost every account and the login page's
 * "use a backup code" link -- gated on that count -- rendered for almost
 * nobody. The reported symptom (issue #3382) was a two-factor screen with one
 * "Authenticator App" row and no way out of it. Enrolment is the moment the
 * user is already thinking about losing their phone, so enrolment is where the
 * codes are now made.
 *
 * WHAT THIS FILE IS GUARDING, AND WHY IT IS NOT `regenerateForUser`
 *
 * The tempting one-line implementation is to call `regenerateForUser` from the
 * enrolment paths. That would be a data-loss bug with a very long fuse:
 * enrolling a SECOND authenticator app, or adding a security key next to an
 * existing phone, is an enrolment too, and regeneration REPLACES -- so the ten
 * codes the user printed and filed away months ago would stop working, with
 * nothing on screen to say so. They would find out while locked out. The count
 * check below is the whole method, and the assertions that `create` and the
 * deletes were never touched for a user who already has rows are the ones that
 * would catch that edit.
 *
 * The second property is that the mint does NOT delete first. Two enrolments
 * finishing at the same instant can both read a zero count; if the second one
 * cleared the table, the codes the first one has ALREADY PUT ON THE USER'S
 * SCREEN would be dead before they finished writing them down. Writing without
 * deleting turns that race into two live sets -- more codes than intended, but
 * not a single lie. For the same reason the compensating delete on a failed
 * write removes only the ids this call created, never everything the user has.
 *
 * WHAT IS MOCKED, AND WHAT IS NOT
 *
 * The database is: `countBy`, `create`, `deleteBy` and `deleteOneById` are
 * spies, because what is under test is which of them are called and with what,
 * not what Postgres does with them.
 *
 * TwoFactorBackupCode is NOT mocked. The digests are checked against the real
 * hashing function, because a set stored under a different key -- or under the
 * wrong user's key -- is a set that has never worked and that is
 * indistinguishable, from the profile page, from a set that is simply unused.
 *
 * SIBLING FILES, so nothing here is duplicated:
 *
 *  - UserTwoFactorBackupCodeService.test.ts owns `regenerateForUser`,
 *    `consumeCode`, `countUnusedForUser`, `getStatusForUser`,
 *    `deleteAllForUser` and the `onBeforeCreate` hook.
 *  - UserTwoFactorBackupCodeAdminSurface.test.ts owns the UserService
 *    surfaces that read and clear these rows.
 *  - The crypto itself is Common/Tests/Server/Utils/TwoFactorBackupCode.test.ts.
 * ---------------------------------------------------------------------------
 */

const USER_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

/*
 * Deliberately `any`. The Common suite type-checks its tests (unlike the App
 * suite, which transpiles only), and jest's own `Mock` generic does not line up
 * with the loosely typed `mock.calls` reads below.
 */
let createSpy: any;
let countBySpy: any;
let deleteBySpy: any;
let deleteOneByIdSpy: any;
let deleteAllForUserSpy: any;

/* Every row `create` was asked to write, in order. */
let createdRows: Array<UserTwoFactorBackupCode> = [];

type StubExistingCountFunction = (existing: number) => void;

/* How many rows the user is holding when the guard runs. */
const stubExistingCount: StubExistingCountFunction = (
  existing: number,
): void => {
  countBySpy.mockImplementation(async (): Promise<PositiveNumber> => {
    return new PositiveNumber(existing);
  });
};

type CreatedIdsFunction = () => Array<string>;

const createdIds: CreatedIdsFunction = (): Array<string> => {
  return createdRows.map((row: UserTwoFactorBackupCode) => {
    return row.id?.toString() || "";
  });
};

type DeletedIdsFunction = () => Array<string>;

const deletedIds: DeletedIdsFunction = (): Array<string> => {
  return (deleteOneByIdSpy.mock.calls as Array<Array<any>>).map(
    (call: Array<any>) => {
      return String(call[0]?.id);
    },
  );
};

beforeEach(() => {
  jest.restoreAllMocks();

  createdRows = [];

  /*
   * The real `create` returns the saved row WITH its `_id`, and
   * `generateForUserIfNone` collects those ids so it can compensate by id
   * later. A stub that returned an id-less row would make every compensation
   * assertion below vacuously pass.
   */
  createSpy = getJestSpyOn(
    UserTwoFactorBackupCodeService,
    "create",
  ).mockImplementation(async (input: any): Promise<UserTwoFactorBackupCode> => {
    const row: UserTwoFactorBackupCode = input.data as UserTwoFactorBackupCode;
    row.id = ObjectID.generate();
    createdRows.push(row);
    return row;
  });

  countBySpy = getJestSpyOn(UserTwoFactorBackupCodeService, "countBy");
  stubExistingCount(0);

  deleteBySpy = getJestSpyOn(
    UserTwoFactorBackupCodeService,
    "deleteBy",
  ).mockImplementation(async (): Promise<number> => {
    return 0;
  });

  deleteOneByIdSpy = getJestSpyOn(
    UserTwoFactorBackupCodeService,
    "deleteOneById",
  ).mockImplementation(async (): Promise<number> => {
    return 1;
  });

  /*
   * Left calling through to the real implementation (which reaches the mocked
   * `deleteBy` above) so that "the whole set was wiped" can be asserted at
   * both levels: a future edit that reaches for `deleteAllForUser` and one
   * that reaches for `deleteBy` directly are the same bug.
   */
  deleteAllForUserSpy = getJestSpyOn(
    UserTwoFactorBackupCodeService,
    "deleteAllForUser",
  );

  /*
   * The deliberate-failure cases below hand a rejection to the CaptureSpan
   * decorator and to the service's own cleanup logging. That is correct
   * behaviour, and it is also a stack trace on stderr for a test that passed --
   * silenced so a genuine error in this suite's output is still worth reading.
   */
  getJestSpyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("generateForUserIfNone -- when the user already has codes", () => {
  /*
   * THE REASON THE METHOD IS NOT JUST `regenerateForUser`.
   *
   * Adding a second authenticator app, or a security key alongside a phone,
   * runs this exact path. A user who set up TOTP last year, printed the ten
   * codes and filed them in a drawer must still be holding ten working codes
   * afterwards. Returning null is how the API route knows to show nothing;
   * writing nothing is how the drawer stays true.
   */
  test("returns null and writes nothing at all", async () => {
    stubExistingCount(3);

    const codes: Array<string> | null =
      await UserTwoFactorBackupCodeService.generateForUserIfNone({
        userId: USER_ID,
      });

    expect(codes).toBeNull();
    expect(createSpy).not.toHaveBeenCalled();
  });

  /*
   * The failure this pins is silent and permanent: a regeneration slipped into
   * the enrolment path leaves the account with a fresh set the user never sees
   * (the route shows codes only when a set is RETURNED) and a printed list that
   * has quietly stopped working. Nothing on any screen changes.
   */
  test("does not delete the set the user is already holding", async () => {
    stubExistingCount(10);

    await UserTwoFactorBackupCodeService.generateForUserIfNone({
      userId: USER_ID,
    });

    expect(deleteAllForUserSpy).not.toHaveBeenCalled();
    expect(deleteBySpy).not.toHaveBeenCalled();
    expect(deleteOneByIdSpy).not.toHaveBeenCalled();
  });

  /*
   * One row is enough to mean "this account has a recovery route". A guard
   * written as "fewer than a full set" would top a user up to ten and hand back
   * the new codes only -- leaving them believing the returned list is all they
   * have while older, still-live codes stay in circulation.
   */
  test("treats even a single existing row as an existing set", async () => {
    stubExistingCount(1);

    await expect(
      UserTwoFactorBackupCodeService.generateForUserIfNone({
        userId: USER_ID,
      }),
    ).resolves.toBeNull();

    expect(createSpy).not.toHaveBeenCalled();
  });
});

describe("generateForUserIfNone -- minting for an account with none", () => {
  test("returns a full set of distinct plaintext codes", async () => {
    const codes: Array<string> | null =
      await UserTwoFactorBackupCodeService.generateForUserIfNone({
        userId: USER_ID,
      });

    expect(codes).toHaveLength(BackupCodeSetSize);
    expect(new Set(codes).size).toBe(BackupCodeSetSize);
    expect(createSpy).toHaveBeenCalledTimes(BackupCodeSetSize);
  });

  test("honours an explicit count", async () => {
    const codes: Array<string> | null =
      await UserTwoFactorBackupCodeService.generateForUserIfNone({
        userId: USER_ID,
        count: 4,
      });

    expect(codes).toHaveLength(4);
    expect(createSpy).toHaveBeenCalledTimes(4);
  });

  /*
   * THE ONE THAT MATTERS MOST. These codes are shown to the user exactly once,
   * on the screen that follows enrolment, and then the plaintext is gone
   * forever. If the row held anything other than the digest the login path
   * recomputes -- the code itself, a digest keyed to the wrong user -- the
   * user would be filing away a list that has never worked, and would discover
   * it while locked out.
   */
  test("stores the digest the login path will recompute, never the code", async () => {
    const codes: Array<string> | null =
      await UserTwoFactorBackupCodeService.generateForUserIfNone({
        userId: USER_ID,
      });

    const storedHashes: Array<string> = createdRows.map(
      (row: UserTwoFactorBackupCode) => {
        return row.codeHash || "";
      },
    );

    const expectedHashes: Array<string> = (codes || []).map((code: string) => {
      return TwoFactorBackupCode.hashCode({ code: code, userId: USER_ID });
    });

    expect(storedHashes).toEqual(expectedHashes);

    const leaked: Array<string> = (codes || []).filter((code: string) => {
      return storedHashes.includes(code);
    });

    expect(leaked).toEqual([]);
  });

  test("owns every row to the user it was asked for", async () => {
    await UserTwoFactorBackupCodeService.generateForUserIfNone({
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

  /*
   * A row minted with a `usedAt` already on it is a code the user can never
   * spend, counted against a total the profile page reports as if it were
   * spendable.
   */
  test("mints every row unused", async () => {
    await UserTwoFactorBackupCodeService.generateForUserIfNone({
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
   * Every write goes through `isRoot`. The model denies create to everybody --
   * including the code's own owner -- and these calls arrive from an enrolment
   * request whose props belong to a logged-in user, so the props have to be
   * replaced rather than forwarded or the whole mint fails permission checks.
   */
  test("writes as root, because nothing else is permitted to", async () => {
    await UserTwoFactorBackupCodeService.generateForUserIfNone({
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

  /*
   * THE DIFFERENCE FROM `regenerateForUser`, which opens by deleting.
   *
   * Two enrolments finishing together can both read a zero count. If this one
   * cleared the table first, the set the other call has already rendered onto
   * the user's screen would be dead while they were still copying it down --
   * and nothing would tell them. Not deleting makes the race end with two LIVE
   * sets instead, which is more codes than intended and no lie.
   */
  test("never deletes first, unlike a regeneration", async () => {
    await UserTwoFactorBackupCodeService.generateForUserIfNone({
      userId: USER_ID,
    });

    expect(deleteAllForUserSpy).not.toHaveBeenCalled();
    expect(deleteBySpy).not.toHaveBeenCalled();
    expect(deleteOneByIdSpy).not.toHaveBeenCalled();
  });

  /*
   * The guard is only as good as its query, and it has two halves that fail
   * differently.
   *
   * SCOPE: an unscoped count would read the whole table and refuse to mint for
   * anybody the moment one account had codes; a count that ran with the
   * caller's props rather than root would hit the model's empty read
   * permissions and either throw or come back zero -- and a zero here means
   * minting on top of a set the user already holds.
   *
   * UNUSED, NOT ALL. `usedAt IS NULL` has to be in the predicate, because the
   * question this guard answers is "does this account have a way back in" and
   * a user who has spent all ten of theirs does not. Counting spent rows as
   * codes would mean the one account that most needs a fresh set at enrolment
   * -- the one that has burned every code it had -- is the one guaranteed not
   * to get one. That is the same shape as the bug this whole change exists to
   * fix, so it is asserted on the query rather than inferred.
   */
  test("counts this user's UNUSED rows, as root, once", async () => {
    stubExistingCount(0);

    await UserTwoFactorBackupCodeService.generateForUserIfNone({
      userId: USER_ID,
    });

    expect(countBySpy).toHaveBeenCalledTimes(1);

    const call: { query: Record<string, any>; props: Record<string, unknown> } =
      (
        countBySpy.mock.calls[0] as Array<{
          query: Record<string, any>;
          props: Record<string, unknown>;
        }>
      )[0]!;

    expect(call.query["userId"]).toEqual(USER_ID);
    expect(Object.keys(call.query).sort()).toEqual(["usedAt", "userId"]);

    /*
     * A bare `usedAt: null` is DROPPED by TypeORM rather than compiled to
     * `IS NULL`, which would silently turn this back into a count of every
     * row. The predicate has to be the QueryHelper.isNull() sentinel, so its
     * presence is what is asserted rather than its literal value.
     */
    expect(call.query["usedAt"]).toBeDefined();
    expect(call.query["usedAt"]).not.toBeNull();

    expect(call.props).toEqual({ isRoot: true });
  });

  /*
   * The account that has burned every code it had is the one this guard used
   * to fail: it reads as "has codes" on a naive count, so enrolling a new
   * authenticator would mint nothing and the user would leave setup with a
   * recovery route made entirely of codes that no longer work.
   */
  test("mints for an account whose codes have all been spent", async () => {
    stubExistingCount(0);

    const codes: Array<string> | null =
      await UserTwoFactorBackupCodeService.generateForUserIfNone({
        userId: USER_ID,
      });

    expect(codes).not.toBeNull();
    expect(codes).toHaveLength(BackupCodeSetSize);
  });

  /*
   * Counted BEFORE anything is generated. A method that minted first and
   * checked afterwards would have written the rows it then decided it did not
   * want.
   */
  test("checks the count before writing anything", async () => {
    await UserTwoFactorBackupCodeService.generateForUserIfNone({
      userId: USER_ID,
    });

    const countOrder: number = countBySpy.mock.invocationCallOrder[0]!;
    const firstCreateOrder: number = createSpy.mock.invocationCallOrder[0]!;

    expect(countOrder).toBeLessThan(firstCreateOrder);
  });
});

describe("generateForUserIfNone -- when a write fails partway through", () => {
  type FailOnNthCreateFunction = (nth: number) => void;

  const failOnNthCreate: FailOnNthCreateFunction = (nth: number): void => {
    let created: number = 0;

    createSpy.mockImplementation(
      async (input: any): Promise<UserTwoFactorBackupCode> => {
        created++;

        if (created === nth) {
          throw new Error("Database not connected");
        }

        const row: UserTwoFactorBackupCode =
          input.data as UserTwoFactorBackupCode;
        row.id = ObjectID.generate();
        createdRows.push(row);
        return row;
      },
    );
  };

  /*
   * THE STATE THAT LOOKS LIKE THE GOOD ONE.
   *
   * A failure on the fifth insert leaves four rows the caller never returned to
   * anybody, because it threw. `getStatusForUser` would then report "4 backup
   * codes" to a user holding none of them -- and that is worse than reporting
   * zero, because zero is a warning the profile page already knows how to show
   * and the user can act on.
   */
  test("rethrows the original failure", async () => {
    failOnNthCreate(5);

    await expect(
      UserTwoFactorBackupCodeService.generateForUserIfNone({
        userId: USER_ID,
      }),
    ).rejects.toThrow("Database not connected");
  });

  /*
   * BY ID, and only the ids THIS call wrote.
   *
   * `deleteAllForUser` would be the easy compensation and is the wrong one: the
   * concurrent enrolment described above may have just written a set that the
   * other user's screen is displaying, and a blanket delete would take it with
   * this call's half-written one. The user would be left copying down ten codes
   * that were already gone.
   */
  test("compensates only the rows it actually wrote", async () => {
    failOnNthCreate(5);

    await expect(
      UserTwoFactorBackupCodeService.generateForUserIfNone({
        userId: USER_ID,
      }),
    ).rejects.toThrow("Database not connected");

    expect(createdRows).toHaveLength(4);
    expect(deletedIds()).toEqual(createdIds());

    expect(deleteAllForUserSpy).not.toHaveBeenCalled();
    expect(deleteBySpy).not.toHaveBeenCalled();
  });

  /*
   * The compensating delete faces the same permission wall as the write did.
   * Deleting with anything other than root would fail every time, turning the
   * rollback into a no-op that logs and moves on -- which is exactly the
   * partial set this whole branch exists to avoid, arrived at quietly.
   */
  test("compensates as root", async () => {
    failOnNthCreate(3);

    await expect(
      UserTwoFactorBackupCodeService.generateForUserIfNone({
        userId: USER_ID,
      }),
    ).rejects.toThrow("Database not connected");

    const violations: Array<unknown> = [];

    for (const call of deleteOneByIdSpy.mock.calls) {
      const input: any = (call as Array<unknown>)[0];

      if (input?.props?.isRoot !== true) {
        violations.push(input?.props);
      }
    }

    expect(violations).toEqual([]);
    expect(deleteOneByIdSpy.mock.calls.length).toBe(2);
  });

  /*
   * The cleanup runs AFTER the write that failed, or it cleans up nothing.
   */
  test("cleans up after the failure rather than before it", async () => {
    failOnNthCreate(5);

    await expect(
      UserTwoFactorBackupCodeService.generateForUserIfNone({
        userId: USER_ID,
      }),
    ).rejects.toThrow("Database not connected");

    const firstDeleteOrder: number = deleteOneByIdSpy.mock
      .invocationCallOrder[0] as number;
    const lastCreateOrder: number = createSpy.mock.invocationCallOrder[
      createSpy.mock.invocationCallOrder.length - 1
    ] as number;

    expect(firstDeleteOrder).toBeGreaterThan(lastCreateOrder);
  });

  /*
   * The ORIGINAL failure is what the caller has to see. Reporting the cleanup
   * error instead would tell an operator why the rollback did not happen while
   * hiding why the write did not -- and the second is the one they can act on.
   *
   * And one failing delete must not abandon the rest: every id that was written
   * is still attempted, because each row left behind is another code counted
   * against a user who has never seen it.
   */
  test("reports the write failure even when the cleanup also fails", async () => {
    failOnNthCreate(4);

    let firstCleanup: boolean = true;

    deleteOneByIdSpy.mockImplementation(async (): Promise<number> => {
      if (firstCleanup) {
        firstCleanup = false;
        throw new Error("the cleanup failed");
      }

      return 1;
    });

    await expect(
      UserTwoFactorBackupCodeService.generateForUserIfNone({
        userId: USER_ID,
      }),
    ).rejects.toThrow("Database not connected");

    expect(deletedIds()).toEqual(createdIds());
  });

  /*
   * Nothing was written, so there is nothing to compensate. A rollback that
   * fired anyway would be reaching for rows this call does not own -- and on
   * the `deleteAllForUser` shape it would delete a concurrent enrolment's set
   * on the way past.
   */
  test("does not delete anything when the very first write fails", async () => {
    failOnNthCreate(1);

    await expect(
      UserTwoFactorBackupCodeService.generateForUserIfNone({
        userId: USER_ID,
      }),
    ).rejects.toThrow("Database not connected");

    expect(createdRows).toEqual([]);
    expect(deleteOneByIdSpy).not.toHaveBeenCalled();
    expect(deleteAllForUserSpy).not.toHaveBeenCalled();
    expect(deleteBySpy).not.toHaveBeenCalled();
  });

  /*
   * A failure in the COUNT is not a licence to mint. The guard has not run, so
   * the account may well be holding a printed set; writing on top of it -- or
   * worse, compensating over it -- on the strength of a query that never
   * answered is how a database blip becomes lost recovery codes.
   */
  test("does not write when the count itself fails", async () => {
    countBySpy.mockImplementation(async (): Promise<PositiveNumber> => {
      throw new Error("Database not connected");
    });

    await expect(
      UserTwoFactorBackupCodeService.generateForUserIfNone({
        userId: USER_ID,
      }),
    ).rejects.toThrow("Database not connected");

    expect(createSpy).not.toHaveBeenCalled();
    expect(deleteOneByIdSpy).not.toHaveBeenCalled();
    expect(deleteBySpy).not.toHaveBeenCalled();
  });

  /*
   * A create that comes back without an id is the one failure this loop cannot
   * shrug off, because the id is the ONLY handle the compensation has.
   *
   * Skipping such a row looks harmless -- it is one row, and it was written
   * successfully. It is not: the row is in the database and absent from the
   * cleanup list, so a failure later in the same loop leaves it behind. That
   * is precisely the state the rollback exists to prevent, a code nobody has
   * ever seen that `getStatusForUser` counts as part of a recovery route, and
   * it would be reached silently. So the mint fails at that point instead, and
   * everything written up to it is removed.
   */
  test("fails the mint rather than losing track of a written row", async () => {
    let created: number = 0;

    createSpy.mockImplementation(
      async (input: any): Promise<UserTwoFactorBackupCode> => {
        created++;

        const row: UserTwoFactorBackupCode =
          input.data as UserTwoFactorBackupCode;

        /*
         * The third row comes back with no id, standing in for a driver or a
         * hook that dropped it. The first two are written normally, so the
         * assertion below can show they were cleaned up.
         */
        if (created !== 3) {
          row.id = ObjectID.generate();
        }

        return row;
      },
    );

    await expect(
      UserTwoFactorBackupCodeService.generateForUserIfNone({
        userId: USER_ID,
      }),
    ).rejects.toThrow(/id/i);

    /* It stopped there rather than writing the remaining seven. */
    expect(createSpy).toHaveBeenCalledTimes(3);

    /* And it took the two trackable rows with it. */
    expect(deleteOneByIdSpy).toHaveBeenCalledTimes(2);
  });
});
