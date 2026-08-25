import UserService from "../../../Server/Services/UserService";
import UserSessionService from "../../../Server/Services/UserSessionService";
import UserTotpAuthService from "../../../Server/Services/UserTotpAuthService";
import UserTwoFactorBackupCodeService from "../../../Server/Services/UserTwoFactorBackupCodeService";
import UserWebAuthnService from "../../../Server/Services/UserWebAuthnService";
import logger from "../../../Server/Utils/Logger";
import User from "../../../Models/DatabaseModels/User";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import TwoFactorAuthStatus from "../../../Types/TwoFactorAuthStatus";
import UserAuthenticationStatus from "../../../Types/UserAuthenticationStatus";
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
 * The two UserService methods that backup codes had to be threaded into:
 * resetTwoFactorAuth and getAuthenticationStatus.
 *
 * Backup codes are password-equivalent credentials that live in a table
 * neither of these methods knew about until now, and the two ways of getting
 * the wiring wrong fail in opposite directions -- one leaves a credential
 * alive that everybody believes is gone, the other kills an account by
 * counting a credential twice:
 *
 *  - resetTwoFactorAuth is the lost-device fix, and an operator presses it
 *    believing it revokes the account's second-factor material. A reset that
 *    cleared the TOTP secret and the security keys but left a printed list of
 *    recovery codes behind would have revoked NOTHING from a thief who took
 *    the phone and the paper beside it -- while reporting success, logging
 *    success, and leaving the Authentication page looking exactly as it does
 *    after a reset that worked. Nothing in the product surfaces the leftover
 *    rows; only this test does.
 *  - getAuthenticationStatus has to report the codes WITHOUT letting them
 *    count as a configured factor. Folding them into
 *    verifiedTwoFactorAuthMethodCount is the single most natural-looking edit
 *    anybody will ever make to that method, it makes the page read more
 *    "complete", and it locks people out permanently. The long comment on
 *    "backup codes do not make an account look configured" below is the whole
 *    reason this file exists.
 *
 * SIBLING FILES, so nothing here is duplicated:
 *
 *  - UserTwoFactorAuthAdmin.test.ts owns resetTwoFactorAuth and
 *    setTwoFactorAuthRequired as they were BEFORE backup codes: the TOTP and
 *    WebAuthn delete shapes (LIMIT_MAX, root, no isVerified predicate), the
 *    revocation reason's ShortText bound, and the three deleted hooks. This
 *    file adds only the backup-code step and the properties that step can
 *    break.
 *  - UserAuthenticationService.test.ts owns getAuthenticationStatus's
 *    password, email-verification and reset-link fields, and the tri-state as
 *    derived from TOTP and WebAuthn alone. This file adds only
 *    unusedTwoFactorBackupCodeCount and the separation between it and the
 *    method count.
 *  - The code generation, hashing and single-use consumption of the codes
 *    themselves are not here at all; they belong to
 *    Common/Server/Utils/TwoFactorBackupCode.ts and its service.
 *
 * Everything stubs at each service's own public boundary -- findOneBy /
 * updateOneById / updateBy on the UserService singleton, deleteBy and countBy
 * on the two authenticator services, deleteAllForUser and countUnusedForUser
 * on UserTwoFactorBackupCodeService, plus UserSessionService -- so every
 * assertion is about what these two methods ASK for. Deliberately NOT mocked:
 * UserService.deriveTwoFactorAuthStatus, which is a pure static and is the
 * thing under test in the tri-state cases -- stubbing it would leave this file
 * asserting that a mock returns what the mock was told to return. No database
 * is involved.
 * ---------------------------------------------------------------------------
 */

/*
 * A spy plus the name to blame in a violation message, so a failure says WHICH
 * write entry point was used rather than only that one of them was.
 */
type NamedSpy = {
  name: string;
  spy: any;
};

/*
 * One row of the tri-state matrix: verified authenticator apps, verified
 * security keys, unused backup codes, and the status the trio must produce.
 * Declared as a tuple type rather than inferred so the callback's parameters
 * can carry real types instead of `number | TwoFactorAuthStatus`.
 */
type TwoFactorStatusCase = [number, number, number, TwoFactorAuthStatus];

type BuildUserFunction = (data: {
  id: ObjectID;
  enableTwoFactorAuth?: boolean | undefined;
}) => User;

const buildUser: BuildUserFunction = (data: {
  id: ObjectID;
  enableTwoFactorAuth?: boolean | undefined;
}): User => {
  const user: User = new User();
  user.id = data.id;

  /*
   * Assigned only when supplied, so an omitted column is genuinely absent --
   * the shape a `select` that did not ask for it produces -- rather than
   * explicitly undefined.
   */
  if (data.enableTwoFactorAuth !== undefined) {
    user.enableTwoFactorAuth = data.enableTwoFactorAuth;
  }

  return user;
};

describe("UserService -- the admin surfaces backup codes plug into", () => {
  /*
   * TWO DISTINCT IDS ON PURPOSE, exactly as in UserTwoFactorAuthAdmin.test.ts,
   * and for this file the distinction earns its keep twice over.
   *
   * `userId` is what the CALLER asked about -- the id in the admin route's
   * URL. `foundUserId` is the id on the row `findOneBy` actually resolves.
   * `resetTwoFactorAuth` looks the row up and then keys every delete and the
   * revocation on `user.id!`, never on `data.userId`, and the newest of those
   * deletes destroys credentials. If the fixture made the two ids the same
   * value -- the obvious way to write it -- then `deleteAllForUser({ userId:
   * data.userId })` and `deleteAllForUser({ userId: user.id! })` would produce
   * byte-identical calls, and a backup-code delete aimed at an id nobody
   * confirmed exists would be indistinguishable from a correct one.
   */
  let userId: ObjectID;
  let foundUserId: ObjectID;
  let findOneBySpy: any;
  let updateOneByIdSpy: any;
  let updateBySpy: any;
  let revokeSessionsSpy: any;
  let totpDeleteBySpy: any;
  let webAuthnDeleteBySpy: any;
  let totpCountBySpy: any;
  let webAuthnCountBySpy: any;
  let backupCodeDeleteAllSpy: any;
  let backupCodeCountUnusedSpy: any;
  let loggerInfoSpy: any;

  beforeEach(() => {
    jest.restoreAllMocks();

    userId = ObjectID.generate();
    foundUserId = ObjectID.generate();

    findOneBySpy = getJestSpyOn(UserService, "findOneBy").mockImplementation(
      async (): Promise<User | null> => {
        return null;
      },
    );

    updateOneByIdSpy = getJestSpyOn(
      UserService,
      "updateOneById",
    ).mockImplementation(async (): Promise<void> => {
      return undefined;
    });

    /*
     * The OTHER write entry point on this service. `updateOneById` is the one
     * these methods use today, but `updateBy` is what it funnels into, so
     * spying on both is what lets "this method writes nothing to the User row"
     * be asserted as a fact about the service rather than about one method
     * name.
     */
    updateBySpy = getJestSpyOn(UserService, "updateBy").mockImplementation(
      async (): Promise<number> => {
        return 0;
      },
    );

    revokeSessionsSpy = getJestSpyOn(
      UserSessionService,
      "revokeAllSessionsByUserId",
    ).mockImplementation(async (): Promise<void> => {
      return undefined;
    });

    totpDeleteBySpy = getJestSpyOn(
      UserTotpAuthService,
      "deleteBy",
    ).mockImplementation(async (): Promise<number> => {
      return 0;
    });

    webAuthnDeleteBySpy = getJestSpyOn(
      UserWebAuthnService,
      "deleteBy",
    ).mockImplementation(async (): Promise<number> => {
      return 0;
    });

    /*
     * getAuthenticationStatus counts this user's verified authenticators to
     * derive the tri-state. Stubbed to zero by default so every test that is
     * not ABOUT the authenticator side keeps describing a user with nothing
     * set up; the cases that care override them.
     */
    totpCountBySpy = getJestSpyOn(
      UserTotpAuthService,
      "countBy",
    ).mockImplementation(async (): Promise<PositiveNumber> => {
      return new PositiveNumber(0);
    });

    webAuthnCountBySpy = getJestSpyOn(
      UserWebAuthnService,
      "countBy",
    ).mockImplementation(async (): Promise<PositiveNumber> => {
      return new PositiveNumber(0);
    });

    /*
     * The two new dependencies, stubbed at the backup-code service's own
     * public surface rather than at its `deleteBy` / `countBy` underneath.
     * That boundary is the contract UserService depends on: how
     * `deleteAllForUser` pages the delete and how `countUnusedForUser` spells
     * "usedAt IS NULL" are that service's business, and they have their own
     * tests. What this file is entitled to assert is that UserService calls
     * them, for the right user, at the right moment.
     */
    backupCodeDeleteAllSpy = getJestSpyOn(
      UserTwoFactorBackupCodeService,
      "deleteAllForUser",
    ).mockImplementation(async (): Promise<void> => {
      return undefined;
    });

    backupCodeCountUnusedSpy = getJestSpyOn(
      UserTwoFactorBackupCodeService,
      "countUnusedForUser",
    ).mockImplementation(async (): Promise<number> => {
      return 0;
    });

    loggerInfoSpy = getJestSpyOn(logger, "info").mockImplementation(
      (): void => {
        return undefined;
      },
    );

    /*
     * The deliberate-failure cases below hand a rejection to the CaptureSpan
     * decorator, which records it. That is correct behaviour, and it is also a
     * stack trace on stderr for a test that passed -- silenced so a genuine
     * error in this suite's output is still worth reading.
     */
    getJestSpyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  type ResolveUserFunction = (user: User | null) => void;

  // Makes the next (and every subsequent) findOneBy return this row.
  const resolveUser: ResolveUserFunction = (user: User | null): void => {
    findOneBySpy.mockImplementation(async (): Promise<User | null> => {
      return user;
    });
  };

  type FlushMicrotasksFunction = () => Promise<void>;

  /*
   * Lets every already-scheduled continuation run without advancing anything
   * that is genuinely blocked. Used by the "is it awaited?" case: after this,
   * a method that did NOT await its dependency has definitely finished.
   */
  const flushMicrotasks: FlushMicrotasksFunction = async (): Promise<void> => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  };

  describe("resetTwoFactorAuth -- the backup codes go with the authenticators", () => {
    test("deletes the user's backup codes, keyed on the SAME id the authenticator deletes use", async () => {
      /*
       * Two facts in one place, and the second is the one a same-id fixture
       * would hide.
       *
       * That the codes are deleted at all is the point of the step: a code
       * signs somebody in on its own, so a reset that skipped them would have
       * revoked nothing from whoever is holding the stolen device and the
       * printed list beside it.
       *
       * And it must be the RESOLVED user's id, not the requested one. Every
       * other delete in this method is keyed on `user.id!` -- the id of a row
       * that was actually confirmed to exist -- so a backup-code delete keyed
       * on `data.userId` would silently disagree with its two neighbours the
       * moment the lookup ever resolves something else (a soft-delete filter,
       * a tenancy scope, a future findOneBy overload). The failure mode is not
       * an exception: it is a reset that clears two of the three tables for
       * one user and none of the third, reported as a success.
       *
       * Compared against the TOTP delete's own target rather than only against
       * the fixture, so the assertion states the invariant that matters --
       * these deletes all describe one account -- instead of restating a
       * constant.
       */
      resolveUser(buildUser({ id: foundUserId, enableTwoFactorAuth: true }));

      await UserService.resetTwoFactorAuth({ userId: userId });

      expect(backupCodeDeleteAllSpy).toHaveBeenCalledTimes(1);

      const call: any = backupCodeDeleteAllSpy.mock.calls[0][0];
      const totpTargetId: string =
        totpDeleteBySpy.mock.calls[0][0].query.userId.toString();
      const webAuthnTargetId: string =
        webAuthnDeleteBySpy.mock.calls[0][0].query.userId.toString();

      const violations: Array<string> = [];

      if (call.userId.toString() !== foundUserId.toString()) {
        violations.push(
          `the backup code delete targeted ${call.userId.toString()}, not the found user ${foundUserId.toString()}`,
        );
      }

      if (call.userId.toString() !== totpTargetId) {
        violations.push(
          "the backup code delete and the authenticator app delete targeted different users",
        );
      }

      if (call.userId.toString() !== webAuthnTargetId) {
        violations.push(
          "the backup code delete and the security key delete targeted different users",
        );
      }

      expect(violations).toEqual([]);
    });

    test("the backup code delete carries nothing but the owner", async () => {
      /*
       * The tempting extra predicate is `usedAt`: "only delete the codes that
       * are still usable" reads as tidy and is wrong in both directions. Spent
       * rows are what the profile page counts to say "3 of 10 remaining" and
       * what a user asking "did somebody else get in?" reads a timestamp off,
       * so a filtered delete would leave the account claiming a set it no
       * longer has -- and would leave the reset visibly half-done to anybody
       * who looked at the table.
       *
       * Asserted as the exact argument object rather than as "no usedAt key",
       * so a filter in the other direction (deleting only the spent rows and
       * keeping every live code) is caught by the same line.
       */
      resolveUser(buildUser({ id: foundUserId, enableTwoFactorAuth: true }));

      await UserService.resetTwoFactorAuth({ userId: userId });

      expect(backupCodeDeleteAllSpy.mock.calls[0][0]).toEqual({
        userId: foundUserId,
      });
    });

    test("the backup codes are gone BEFORE the sessions are revoked", async () => {
      /*
       * Ordering, not just presence, and for exactly the reason the two
       * existing deletes are ordered ahead of the revocation.
       *
       * Revoking first opens a window between the revocation and the delete in
       * which a still-live backup code is a WORKING second factor: whoever
       * holds the password and the list signs in through
       * POST /verify-backup-code, spends one code, and comes out with a fresh
       * session on the far side of a reset that was supposed to have locked
       * them out. The window is small and entirely real -- each delete is a
       * round trip to Postgres -- and it is worse for codes than for the
       * authenticators, because a code needs no device at all: a photograph of
       * the printed list is enough.
       *
       * The revocation is also the LAST thing that can fail. Ordered as it is,
       * a crash mid-reset leaves the credentials destroyed and some sessions
       * alive, which the next attempt fixes. Ordered the other way it leaves
       * the sessions killed and the credentials intact, which nothing fixes
       * and nobody notices.
       */
      resolveUser(buildUser({ id: foundUserId, enableTwoFactorAuth: true }));

      await UserService.resetTwoFactorAuth({ userId: userId });

      const backupCodeOrder: number = backupCodeDeleteAllSpy.mock
        .invocationCallOrder[0] as number;
      const revokeOrder: number = revokeSessionsSpy.mock
        .invocationCallOrder[0] as number;
      const lookupOrder: number = findOneBySpy.mock
        .invocationCallOrder[0] as number;

      const violations: Array<string> = [];

      if (!(backupCodeOrder < revokeOrder)) {
        violations.push(
          "sessions were revoked before the backup codes were deleted, leaving a live code as a working second factor",
        );
      }

      if (!(lookupOrder < backupCodeOrder)) {
        violations.push(
          "backup codes were deleted before the user row was confirmed to exist",
        );
      }

      expect(violations).toEqual([]);
    });

    test("does not resolve until the backup code delete has actually settled", async () => {
      /*
       * A fire-and-forget delete would still call the spy, so every assertion
       * above would keep passing while the guarantee evaporated. The reset
       * would answer 200, the operator would tell the user "you are safe now",
       * and the delete could fail afterwards with nobody listening -- an
       * unhandled rejection in a log nobody reads, and ten working recovery
       * codes still in the table.
       *
       * It also matters for the ORDERING above, which is only meaningful if
       * each step completes before the next begins: an unawaited delete
       * running concurrently with the revocation reopens the same window this
       * file just closed.
       *
       * So the await is pinned directly, by blocking the delete on a gate this
       * test holds and checking the method has not finished.
       */
      resolveUser(buildUser({ id: foundUserId, enableTwoFactorAuth: true }));

      let releaseDelete: () => void = (): void => {
        return undefined;
      };

      const deleteGate: Promise<void> = new Promise<void>(
        (resolve: () => void) => {
          releaseDelete = resolve;
        },
      );

      backupCodeDeleteAllSpy.mockImplementation(async (): Promise<void> => {
        await deleteGate;
      });

      let settled: boolean = false;

      const pending: Promise<void> = UserService.resetTwoFactorAuth({
        userId: userId,
      }).then((): void => {
        settled = true;
      });

      await flushMicrotasks();

      const violations: Array<string> = [];

      if (backupCodeDeleteAllSpy.mock.calls.length !== 1) {
        violations.push(
          `the backup code delete was called ${backupCodeDeleteAllSpy.mock.calls.length} time(s), expected once`,
        );
      }

      if (settled) {
        violations.push(
          "resetTwoFactorAuth resolved while the backup code delete was still in flight",
        );
      }

      if (revokeSessionsSpy.mock.calls.length !== 0) {
        violations.push(
          "sessions were revoked while the backup code delete was still in flight",
        );
      }

      expect(violations).toEqual([]);

      releaseDelete();
      await pending;

      expect(settled).toBe(true);
    });

    test("throws NotFoundException for a user that does not exist, deleting no backup codes", async () => {
      /*
       * `deleteAllForUser` is keyed on `userId`, so a missing row would make it
       * a harmless no-op -- which is precisely why the check has to stay
       * explicit rather than being left to the delete. An operator acting on a
       * mistyped or stale id would otherwise be told the reset worked, walk
       * away, and the person who actually needs it is still locked out holding
       * codes they were told were void.
       *
       * The revocation is checked alongside because it is the one step that is
       * NOT harmless against a wrong id: it signs out whoever that id really
       * belongs to.
       */
      resolveUser(null);

      await expect(
        UserService.resetTwoFactorAuth({ userId: userId }),
      ).rejects.toThrow(NotFoundException);

      const violations: Array<string> = [];

      const untouched: Array<NamedSpy> = [
        { name: "deleteAllForUser", spy: backupCodeDeleteAllSpy },
        { name: "UserTotpAuthService.deleteBy", spy: totpDeleteBySpy },
        { name: "UserWebAuthnService.deleteBy", spy: webAuthnDeleteBySpy },
        { name: "revokeAllSessionsByUserId", spy: revokeSessionsSpy },
      ];

      for (const entry of untouched) {
        if (entry.spy.mock.calls.length > 0) {
          violations.push(`${entry.name} ran for a user that does not exist`);
        }
      }

      expect(violations).toEqual([]);
    });

    test("still does NOT touch enableTwoFactorAuth now that the codes go too", async () => {
      /*
       * UserTwoFactorAuthAdmin.test.ts asserts this for the method as it was
       * before backup codes existed. It is re-asserted here, with the new
       * delete in place, because the new delete is what makes clearing the
       * flag look reasonable: after this method runs, the account has NO
       * second-factor material of any kind left -- no authenticator, no
       * security key, and now no recovery codes either -- and "there is
       * nothing to satisfy the requirement with, so lift the requirement" is a
       * short, sympathetic-looking edit to write directly underneath the line
       * that deleted the codes.
       *
       * It is also the one edit that turns a lost phone into a silent
       * downgrade. "Reset" means clear the configuration and KEEP the
       * requirement: the account lands on a new QR code at its next sign-in,
       * which is the whole point. An operator helping with a lost phone would
       * have no reason to notice that the mandate quietly went away.
       *
       * Asserted as "no user update at all" through BOTH write entry points,
       * which is the stronger and simpler fact: this method has no business
       * writing to the User row through any of them.
       */
      resolveUser(buildUser({ id: foundUserId, enableTwoFactorAuth: true }));

      await UserService.resetTwoFactorAuth({ userId: userId });

      const writeEntryPoints: Array<NamedSpy> = [
        { name: "updateOneById", spy: updateOneByIdSpy },
        { name: "updateBy", spy: updateBySpy },
      ];

      const violations: Array<string> = [];

      for (const entryPoint of writeEntryPoints) {
        for (const call of entryPoint.spy.mock.calls) {
          const keys: Array<string> = Object.keys(call[0]?.data || {});

          violations.push(
            `resetTwoFactorAuth wrote to the User row via ${entryPoint.name} with data keys [${keys.join(", ")}]`,
          );
        }
      }

      expect(violations).toEqual([]);

      /*
       * ...and the backup codes really were part of this run, so the above is
       * a statement about the new method rather than about the old one.
       */
      expect(backupCodeDeleteAllSpy).toHaveBeenCalledTimes(1);
    });

    test("is a successful no-op for a user who never generated any codes", async () => {
      /*
       * The operator pressing this button does not know what the user has set
       * up -- that is why they are on the page -- and most accounts have no
       * backup codes at all. Refusing, or short-circuiting the rest of the
       * reset, because there was nothing to delete would turn the ordinary
       * case into an error the operator has to interpret, on the one page
       * where interpreting an error wrongly means leaving somebody locked out.
       */
      resolveUser(buildUser({ id: foundUserId, enableTwoFactorAuth: true }));

      await expect(
        UserService.resetTwoFactorAuth({ userId: userId }),
      ).resolves.toBeUndefined();

      expect(backupCodeDeleteAllSpy).toHaveBeenCalledTimes(1);
      expect(revokeSessionsSpy).toHaveBeenCalledTimes(1);
      expect(loggerInfoSpy.mock.calls.length).toBeGreaterThan(0);
    });
  });

  describe("getAuthenticationStatus -- reporting the codes without counting them", () => {
    type StatusForFunction = () => Promise<UserAuthenticationStatus>;

    const statusFor: StatusForFunction =
      async (): Promise<UserAuthenticationStatus> => {
        return await UserService.getAuthenticationStatus(userId);
      };

    test("reports unusedTwoFactorBackupCodeCount straight from countUnusedForUser", async () => {
      /*
       * The number an operator reads off a lost-phone ticket to decide whether
       * they are needed at all. A user with codes left should be told to use
       * one; only a user with none needs the reset button, which signs them
       * out everywhere and marches them through enrolment. Reporting a
       * hard-coded zero, or the TOTAL rather than the UNUSED count, points the
       * operator at the wrong half of that decision -- and the second mistake
       * is invisible, because a user who has spent all ten codes and a user
       * holding ten both have a total of ten.
       */
      resolveUser(buildUser({ id: foundUserId, enableTwoFactorAuth: true }));

      backupCodeCountUnusedSpy.mockResolvedValue(7 as never);

      const status: UserAuthenticationStatus = await statusFor();

      expect(backupCodeCountUnusedSpy).toHaveBeenCalledTimes(1);
      expect(status.unusedTwoFactorBackupCodeCount).toBe(7);
    });

    test("the backup code count describes the same user as the method counts", async () => {
      /*
       * Three probes go out for one page -- verified TOTP rows, verified
       * security keys, unused backup codes -- and they must all be about the
       * same account. A page that mixed one user's authenticators with
       * another's recovery codes would be a coherent-looking screen that is
       * true of nobody, and the operator's next click on it revokes or resets
       * somebody's access.
       *
       * Written as a comparison between the three calls rather than against
       * the fixture, because that is the invariant: whichever id this method
       * decides to key its reads on, it has to use one id.
       */
      resolveUser(buildUser({ id: foundUserId, enableTwoFactorAuth: true }));

      await statusFor();

      const totpProbeId: string =
        totpCountBySpy.mock.calls[0][0].query.userId.toString();
      const webAuthnProbeId: string =
        webAuthnCountBySpy.mock.calls[0][0].query.userId.toString();
      const backupProbeId: string =
        backupCodeCountUnusedSpy.mock.calls[0][0].userId.toString();

      const violations: Array<string> = [];

      if (backupProbeId !== totpProbeId) {
        violations.push(
          `the backup code count is about ${backupProbeId} but the authenticator app count is about ${totpProbeId}`,
        );
      }

      if (backupProbeId !== webAuthnProbeId) {
        violations.push(
          `the backup code count is about ${backupProbeId} but the security key count is about ${webAuthnProbeId}`,
        );
      }

      expect(violations).toEqual([]);
    });

    test("backup codes do NOT make an account look configured", async () => {
      /*
       * -------------------------------------------------------------------
       * THE ONE THAT MATTERS, and the reason this whole file exists.
       *
       * The account here is the exact shape a reset leaves behind, or that a
       * user creates by generating codes before enrolling: two factor auth
       * REQUIRED, zero verified authenticators, ten unused backup codes.
       *
       * The edit this test forbids is one line long and looks like a bug fix.
       * `verifiedTwoFactorAuthMethodCount` is described as "how many ways can
       * this person satisfy the second factor", and a backup code manifestly
       * IS one of those ways -- so adding the code count to it makes the
       * Authentication page stop saying "Enabled - Pending Setup" about
       * somebody who is visibly holding ten working credentials. The page
       * reads better afterwards. Everything still renders. No test that only
       * checks fields in isolation would notice.
       *
       * What it actually does is lock the account out for good.
       *
       * That count feeds `deriveTwoFactorAuthStatus`, and the status decides
       * which door login opens. Non-zero means EnabledConfigured, and
       * EnabledConfigured means /login sends the user to the two factor
       * CHALLENGE screen instead of through enrolment. The challenge screen
       * asks for a code from an authenticator that does not exist. The only
       * thing the user can answer it with is a backup code -- so they spend
       * one, get in, and land in a product that offers them no enrolment step
       * because the server believes they are already configured. Next
       * sign-in: another code. Ten sign-ins later there are none left, the
       * challenge screen has nothing behind it at all, and the account needs
       * an administrator -- who is the person this page was built for, now
       * looking at a page that told them everything was fine.
       *
       * Backup codes are the way BACK IN to an account that has a factor it
       * cannot currently reach. They are not the factor. The two numbers stay
       * separate so that the page can say both things at once: "cannot sign in
       * unaided" AND "has ten codes to sign in with", which is precisely the
       * pair an operator needs and precisely the pair that a single summed
       * count destroys.
       *
       * All three fields are pinned together, because the bug shows up as a
       * DISAGREEMENT between them rather than in any one of them: ten codes
       * reported correctly, and a method count that quietly includes them.
       * -------------------------------------------------------------------
       */
      resolveUser(buildUser({ id: foundUserId, enableTwoFactorAuth: true }));

      backupCodeCountUnusedSpy.mockResolvedValue(10 as never);

      const status: UserAuthenticationStatus = await statusFor();

      const violations: Array<string> = [];

      if (status.verifiedTwoFactorAuthMethodCount !== 0) {
        violations.push(
          `ten backup codes were counted as ${status.verifiedTwoFactorAuthMethodCount} verified two factor method(s); login would send this account to a challenge screen it cannot answer`,
        );
      }

      if (
        status.twoFactorAuthStatus !== TwoFactorAuthStatus.EnabledPendingSetup
      ) {
        violations.push(
          `an account with no verified factor and ten backup codes reported ${status.twoFactorAuthStatus} instead of ${TwoFactorAuthStatus.EnabledPendingSetup}; it would never be offered enrolment again`,
        );
      }

      if (status.unusedTwoFactorBackupCodeCount !== 10) {
        violations.push(
          `the ten backup codes were reported as ${status.unusedTwoFactorBackupCodeCount}; the operator cannot tell whether this user can recover unaided`,
        );
      }

      // The requirement itself is untouched by any of this.
      if (status.isTwoFactorAuthEnabled !== true) {
        violations.push(
          "the two factor auth requirement was reported as off for an account that has it on",
        );
      }

      expect(violations).toEqual([]);
    });

    /*
     * The same invariant swept across the range, so it cannot be satisfied by
     * a special case at ten, and in BOTH directions: codes must not promote
     * EnabledPendingSetup to EnabledConfigured, and must not be needed to
     * reach EnabledConfigured either. The rows with a verified factor AND
     * codes are the ordinary healthy account -- if a summed count were ever
     * introduced they would still pass, which is why the zero-factor rows
     * above them are the load-bearing ones.
     */
    const twoFactorStatusCases: Array<TwoFactorStatusCase> = [
      [0, 0, 0, TwoFactorAuthStatus.EnabledPendingSetup],
      [0, 0, 1, TwoFactorAuthStatus.EnabledPendingSetup],
      [0, 0, 3, TwoFactorAuthStatus.EnabledPendingSetup],
      [0, 0, 10, TwoFactorAuthStatus.EnabledPendingSetup],
      [1, 0, 0, TwoFactorAuthStatus.EnabledConfigured],
      [1, 0, 10, TwoFactorAuthStatus.EnabledConfigured],
      [0, 1, 10, TwoFactorAuthStatus.EnabledConfigured],
      [2, 1, 10, TwoFactorAuthStatus.EnabledConfigured],
    ];

    test.each(twoFactorStatusCases)(
      "%p verified apps + %p verified keys + %p unused backup codes reads as %s",
      async (
        verifiedTotpCount: number,
        verifiedWebAuthnCount: number,
        unusedBackupCodeCount: number,
        expectedStatus: TwoFactorAuthStatus,
      ): Promise<void> => {
        resolveUser(buildUser({ id: foundUserId, enableTwoFactorAuth: true }));

        totpCountBySpy.mockResolvedValue(
          new PositiveNumber(verifiedTotpCount) as never,
        );
        webAuthnCountBySpy.mockResolvedValue(
          new PositiveNumber(verifiedWebAuthnCount) as never,
        );
        backupCodeCountUnusedSpy.mockResolvedValue(
          unusedBackupCodeCount as never,
        );

        const status: UserAuthenticationStatus = await statusFor();

        const violations: Array<string> = [];

        if (status.twoFactorAuthStatus !== expectedStatus) {
          violations.push(
            `status was ${status.twoFactorAuthStatus}, expected ${expectedStatus}`,
          );
        }

        if (
          status.verifiedTwoFactorAuthMethodCount !==
          verifiedTotpCount + verifiedWebAuthnCount
        ) {
          violations.push(
            `the verified method count was ${status.verifiedTwoFactorAuthMethodCount}, expected ${verifiedTotpCount + verifiedWebAuthnCount} -- the backup codes leaked into it`,
          );
        }

        if (status.unusedTwoFactorBackupCodeCount !== unusedBackupCodeCount) {
          violations.push(
            `the unused backup code count was ${status.unusedTwoFactorBackupCodeCount}, expected ${unusedBackupCodeCount}`,
          );
        }

        expect(violations).toEqual([]);
      },
    );

    test("codes on an account with the requirement OFF still read NotEnabled", async () => {
      /*
       * Generating backup codes is deliberately NOT gated on
       * `enableTwoFactorAuth` -- doing it before turning two factor auth on is
       * the sensible order -- so "has codes, has no requirement" is a state
       * the product creates on purpose, not a corruption.
       *
       * It must not read as two factor auth being on. An operator told
       * "Enabled" about an account that login waves straight through on a
       * password alone has been told the opposite of the truth about the only
       * thing this page exists to report, and would have no reason to ask why
       * a compromise happened without a second factor being involved.
       */
      resolveUser(buildUser({ id: foundUserId, enableTwoFactorAuth: false }));

      backupCodeCountUnusedSpy.mockResolvedValue(10 as never);

      const status: UserAuthenticationStatus = await statusFor();

      const violations: Array<string> = [];

      if (status.twoFactorAuthStatus !== TwoFactorAuthStatus.NotEnabled) {
        violations.push(
          `an account with ten backup codes and no requirement reported ${status.twoFactorAuthStatus}`,
        );
      }

      if (status.isTwoFactorAuthEnabled !== false) {
        violations.push(
          "backup codes made isTwoFactorAuthEnabled read true for an account with the requirement off",
        );
      }

      if (status.unusedTwoFactorBackupCodeCount !== 10) {
        violations.push(
          "the codes an unrequired account holds were not reported at all",
        );
      }

      expect(violations).toEqual([]);
    });

    test("throws NotFoundException for a user that does not exist, counting nothing", async () => {
      /*
       * Returning a status object full of zeroes for an id that does not exist
       * would render an ordinary-looking page describing nobody, and
       * "unusedTwoFactorBackupCodeCount: 0" is the reading that sends an
       * operator straight to the reset button. They have to be told, not shown
       * defaults.
       *
       * The count is asserted as not-called rather than merely not-reported,
       * because a probe issued before the row is confirmed is a query per
       * mistyped id on an endpoint an operator can hold down.
       */
      resolveUser(null);

      await expect(UserService.getAuthenticationStatus(userId)).rejects.toThrow(
        NotFoundException,
      );

      const violations: Array<string> = [];

      const probes: Array<NamedSpy> = [
        { name: "countUnusedForUser", spy: backupCodeCountUnusedSpy },
        { name: "UserTotpAuthService.countBy", spy: totpCountBySpy },
        { name: "UserWebAuthnService.countBy", spy: webAuthnCountBySpy },
      ];

      for (const probe of probes) {
        if (probe.spy.mock.calls.length > 0) {
          violations.push(
            `${probe.name} was queried for a user that does not exist`,
          );
        }
      }

      expect(violations).toEqual([]);
    });

    test("reading the status deletes nothing", async () => {
      /*
       * A read path, asserted as one. `getAuthenticationStatus` and
       * `resetTwoFactorAuth` are the two halves of the same admin page and
       * they now share a dependency, so this pins the direction of that
       * dependency: the page an operator opens to LOOK at an account must
       * never be the thing that voids its recovery codes.
       */
      resolveUser(buildUser({ id: foundUserId, enableTwoFactorAuth: true }));

      await statusFor();

      expect(backupCodeDeleteAllSpy).not.toHaveBeenCalled();
      expect(updateOneByIdSpy).not.toHaveBeenCalled();
      expect(revokeSessionsSpy).not.toHaveBeenCalled();
    });
  });
});
