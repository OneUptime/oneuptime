import DatabaseService from "../../../Server/Services/DatabaseService";
import UserService from "../../../Server/Services/UserService";
import UserSessionService from "../../../Server/Services/UserSessionService";
import UserTotpAuthService from "../../../Server/Services/UserTotpAuthService";
import UserWebAuthnService from "../../../Server/Services/UserWebAuthnService";
import UserTwoFactorBackupCodeService from "../../../Server/Services/UserTwoFactorBackupCodeService";
import logger from "../../../Server/Utils/Logger";
import User from "../../../Models/DatabaseModels/User";
import ColumnLength from "../../../Types/Database/ColumnLength";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import HashedString from "../../../Types/HashedString";
import ObjectID from "../../../Types/ObjectID";
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
 * UserService.setTwoFactorAuthRequired / resetTwoFactorAuth, and the three
 * hooks that had to be DELETED for them to work at all.
 *
 * These are the two write paths behind Admin Dashboard > Users > (a user) >
 * Authentication, plus the bulk actions on the user list. Everything here is a
 * property that can regress while the page still renders and the request still
 * returns 200:
 *
 *  - "require two factor auth" is a promise about who can sign in. If the
 *    session revocation stops happening, or stops being awaited, or its reason
 *    string outgrows the ShortText column it is written into, the flag is set
 *    and every already-signed-in session sails on refreshing itself
 *    indefinitely. The page says "Required". Nothing says otherwise.
 *  - "reset two factor auth" is the lost-device fix. If it also cleared
 *    `enableTwoFactorAuth`, an operator helping with a lost phone would
 *    silently take the account OFF two factor auth, and the request that asked
 *    for a fresh QR code would have quietly downgraded the account instead.
 *  - three hooks used to refuse exactly the states this feature creates on
 *    purpose. They are gone, and "gone" is a thing tests have to hold in place:
 *    each of them looked like a safety guard, so each of them is a plausible
 *    thing for a future reader to put back.
 *
 * Sibling file: UserAuthenticationService.test.ts already covers
 * getAuthenticationStatus (including the tri-state), setPassword and
 * sendPasswordResetLink. Nothing here duplicates that -- this file is about the
 * two mutating methods and the removed hooks.
 *
 * Everything stubs at this service's own boundary -- findOneBy / updateOneById
 * / findBy on the UserService singleton, plus the two authenticator services
 * and UserSessionService -- so the assertions are about what these methods ASK
 * for. No database is involved.
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

type BuildUserFunction = (data: {
  id: ObjectID;
  enableTwoFactorAuth?: boolean | undefined;
  email?: string | undefined;
}) => User;

const buildUser: BuildUserFunction = (data: {
  id: ObjectID;
  enableTwoFactorAuth?: boolean | undefined;
  email?: string | undefined;
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

  if (data.email !== undefined) {
    user.email = new Email(data.email);
  }

  return user;
};

describe("UserService -- admin-controlled two factor auth", () => {
  /*
   * TWO DISTINCT IDS ON PURPOSE, and the distinction is the only thing keeping
   * a whole family of assertions in this file honest.
   *
   * `userId` is what the CALLER asked about -- the id in the admin route's
   * URL. `foundUserId` is the id on the row `findOneBy` actually resolves.
   * Both methods under test look the row up and then key every subsequent
   * operation on `user.id!`, never on `data.userId`, which is what stops a
   * lookup that resolves something else (a soft-delete filter, a tenancy
   * scope, a future `findOneBy` overload) from ending with an update, a
   * delete, or a session revocation aimed at an id nobody confirmed exists.
   *
   * If the fixture made these two the same value -- the obvious way to write
   * it -- then `updateOneById({ id: data.userId })` and `updateOneById({ id:
   * user.id! })` would be indistinguishable, and every "against the right
   * user" assertion below would pass for either. They are generated
   * separately so that they cannot be.
   */
  let userId: ObjectID;
  let foundUserId: ObjectID;
  let findOneBySpy: any;
  let findBySpy: any;
  let updateOneByIdSpy: any;
  let updateBySpy: any;
  let revokeSessionsSpy: any;
  let totpDeleteBySpy: any;
  let webAuthnDeleteBySpy: any;
  let totpCountBySpy: any;
  let webAuthnCountBySpy: any;
  let totpFindBySpy: any;
  let webAuthnFindBySpy: any;
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

    /*
     * Returns ONE row, not an empty list, and that is load-bearing rather than
     * incidental.
     *
     * The guard this suite exists to prove is gone read its users through
     * `findBy` and threw from INSIDE `for (const user of users)`. Stub that to
     * `[]` and a verbatim restoration of the guard iterates zero times, throws
     * nothing, and every "the guard stays deleted" test below stays green
     * while the feature is dead. A non-empty list is what makes those tests
     * able to fail.
     */
    findBySpy = getJestSpyOn(UserService, "findBy").mockImplementation(
      async (): Promise<Array<User>> => {
        return [buildUser({ id: foundUserId })];
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
     * name -- see the reset case below.
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
     * resetTwoFactorAuth clears the user's two factor BACKUP codes as well as
     * their authenticators -- a reset that left a printed list of recovery
     * codes alive would not have revoked the second-factor material it exists
     * to revoke. Un-stubbed, the real service reaches a repository this suite
     * does not connect and every resetTwoFactorAuth test below fails with
     * "Database not connected" rather than anything it was checking.
     *
     * That the delete HAPPENS, for the right user, and before the session
     * revocation, is asserted in
     * Common/Tests/Server/Services/UserTwoFactorBackupCodeAdminSurface.test.ts
     * -- this file only has to let the method run.
     */
    getJestSpyOn(
      UserTwoFactorBackupCodeService,
      "deleteAllForUser",
    ).mockImplementation(async (): Promise<void> => {
      return undefined;
    });

    /*
     * The two probes the DELETED guards used to make. They are stubbed rather
     * than left real so that "was this consulted at all?" is answerable, which
     * is how the removal is held in place: a guard that came back would have to
     * ask one of these two services how many verified factors the user has.
     */
    totpCountBySpy = getJestSpyOn(UserTotpAuthService, "countBy");
    webAuthnCountBySpy = getJestSpyOn(UserWebAuthnService, "countBy");
    totpFindBySpy = getJestSpyOn(UserTotpAuthService, "findBy");
    webAuthnFindBySpy = getJestSpyOn(UserWebAuthnService, "findBy");

    for (const spy of [
      totpCountBySpy,
      webAuthnCountBySpy,
      totpFindBySpy,
      webAuthnFindBySpy,
    ]) {
      spy.mockImplementation(async (): Promise<any> => {
        return undefined;
      });
    }

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
   * that is genuinely blocked. Used by the "is it awaited?" cases: after this,
   * a method that did NOT await its dependency has definitely finished.
   */
  const flushMicrotasks: FlushMicrotasksFunction = async (): Promise<void> => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  };

  type AuthenticatorProbeSpiesFunction = () => Array<any>;

  const authenticatorProbeSpies: AuthenticatorProbeSpiesFunction =
    (): Array<any> => {
      return [
        totpCountBySpy,
        webAuthnCountBySpy,
        totpFindBySpy,
        webAuthnFindBySpy,
      ];
    };

  describe("setTwoFactorAuthRequired", () => {
    test("enabling writes exactly one column: enableTwoFactorAuth true", async () => {
      /*
       * The key set is pinned rather than only the value, so a later edit
       * cannot smuggle another column into an update whose URL says it is
       * about one flag. This method runs as root, which means every column on
       * `User` is writable through it -- isMasterAdmin, email, password -- and
       * a stray key here would be an admin route that changes something its
       * name does not mention.
       */
      resolveUser(buildUser({ id: foundUserId, enableTwoFactorAuth: false }));

      await UserService.setTwoFactorAuthRequired({
        userId: userId,
        isRequired: true,
      });

      expect(updateOneByIdSpy).toHaveBeenCalledTimes(1);

      const call: any = updateOneByIdSpy.mock.calls[0][0];

      expect(Object.keys(call.data)).toEqual(["enableTwoFactorAuth"]);
      expect(call.data.enableTwoFactorAuth).toBe(true);
    });

    test("disabling writes exactly one column: enableTwoFactorAuth false", async () => {
      /*
       * The mirror, so the test above cannot be satisfied by hard-coding true.
       * `false` has to be WRITTEN, not omitted -- an update that simply left the
       * key off would leave the requirement in place while the page reported it
       * lifted.
       */
      resolveUser(buildUser({ id: foundUserId, enableTwoFactorAuth: true }));

      await UserService.setTwoFactorAuthRequired({
        userId: userId,
        isRequired: false,
      });

      expect(updateOneByIdSpy).toHaveBeenCalledTimes(1);

      const call: any = updateOneByIdSpy.mock.calls[0][0];

      expect(Object.keys(call.data)).toEqual(["enableTwoFactorAuth"]);
      expect(call.data.enableTwoFactorAuth).toBe(false);
    });

    test("writes as root, against the id that was actually found", async () => {
      /*
       * Two separate facts. Root, because a master admin acts outside any
       * project and `enableTwoFactorAuth` has an empty update ACL -- without it
       * the write is refused for everyone. And against the FOUND row's id
       * rather than the requested one, so a lookup that ever resolves something
       * else (a soft-delete filter, a tenancy scope) cannot end with this method
       * writing to an id it never confirmed exists.
       *
       * The second fact only exists because the lookup here resolves a row
       * whose id is NOT the requested one. With a fixture that returned the
       * requested id back, `id: data.userId` and `id: user.id!` would produce
       * byte-identical calls and this assertion would be decoration.
       */
      resolveUser(buildUser({ id: foundUserId, enableTwoFactorAuth: false }));

      await UserService.setTwoFactorAuthRequired({
        userId: userId,
        isRequired: true,
      });

      const call: any = updateOneByIdSpy.mock.calls[0][0];
      const violations: Array<string> = [];

      if (call.id.toString() !== foundUserId.toString()) {
        violations.push(
          `updateOneById targeted ${call.id.toString()}, not the found user ${foundUserId.toString()}`,
        );
      }

      if (call.props.isRoot !== true) {
        violations.push(
          "updateOneById did not run with props { isRoot: true }",
        );
      }

      expect(violations).toEqual([]);

      // The lookup itself is a root read of the requested id.
      expect(findOneBySpy.mock.calls[0][0].query).toEqual({ _id: userId });
      expect(findOneBySpy.mock.calls[0][0].props).toEqual({ isRoot: true });
    });

    test("ENABLING revokes every session, with a reason short enough to store", async () => {
      /*
       * Two failures in one place, and the second is invisible until it fires.
       *
       * `getUserMiddleware` validates an access token statelessly and never
       * looks at `UserSession`, so somebody already signed in keeps working for
       * the rest of that token's life whatever is written here. Revoking is what
       * stops POST /refresh-token -- which DOES check `isRevoked` -- from
       * renewing it forever. Without it, "require two factor auth" is a promise
       * the product does not keep for anybody currently signed in.
       *
       * And `UserSession.revokedReason` is a ShortText column. A reason longer
       * than that fails the very UPDATE that is supposed to be closing the
       * window, so a well-meant, more descriptive string would turn a security
       * action into an exception -- asserted against ColumnLength itself rather
       * than a copied number, so a change to the column moves this with it.
       */
      resolveUser(buildUser({ id: foundUserId, enableTwoFactorAuth: false }));

      await UserService.setTwoFactorAuthRequired({
        userId: userId,
        isRequired: true,
      });

      expect(revokeSessionsSpy).toHaveBeenCalledTimes(1);

      const revokedUserId: any = revokeSessionsSpy.mock.calls[0][0];
      const options: any = revokeSessionsSpy.mock.calls[0][1];

      expect(revokedUserId.toString()).toBe(foundUserId.toString());

      const reason: string = options.reason as string;

      expect(typeof reason).toBe("string");
      expect(reason.length).toBeGreaterThan(0);
      expect(reason.length).toBeLessThanOrEqual(ColumnLength.ShortText);
    });

    test("DISABLING does not revoke sessions", async () => {
      /*
       * The asymmetry is deliberate, not an oversight. Relaxing a requirement
       * opens no window -- nobody's access got wider because they were asked for
       * LESS -- and signing the whole company out to give them less to do would
       * be gratuitous. Somebody "tidying up" this method into a symmetric
       * revoke-either-way would log every user of a project out for a change
       * that costs them nothing.
       */
      resolveUser(buildUser({ id: foundUserId, enableTwoFactorAuth: true }));

      await UserService.setTwoFactorAuthRequired({
        userId: userId,
        isRequired: false,
      });

      expect(updateOneByIdSpy).toHaveBeenCalledTimes(1);
      expect(revokeSessionsSpy).not.toHaveBeenCalled();
    });

    test("does not resolve until the revocation has actually settled", async () => {
      /*
       * A fire-and-forget revocation would still call the spy, so every
       * assertion above would keep passing while the guarantee evaporated: the
       * route would answer 200, the UI would say "required", and the revocation
       * could fail afterwards with nobody listening. Worse, the admin's next
       * action (a reset, say) would race a revocation still in flight.
       *
       * So the await is pinned directly, by blocking the revocation on a gate
       * this test holds and checking the method has not finished.
       */
      resolveUser(buildUser({ id: foundUserId, enableTwoFactorAuth: false }));

      let releaseRevocation: () => void = (): void => {
        return undefined;
      };

      const revocationGate: Promise<void> = new Promise<void>(
        (resolve: () => void) => {
          releaseRevocation = resolve;
        },
      );

      revokeSessionsSpy.mockImplementation(async (): Promise<void> => {
        await revocationGate;
      });

      let settled: boolean = false;

      const pending: Promise<void> = UserService.setTwoFactorAuthRequired({
        userId: userId,
        isRequired: true,
      }).then((): void => {
        settled = true;
      });

      await flushMicrotasks();

      expect(revokeSessionsSpy).toHaveBeenCalledTimes(1);
      expect(settled).toBe(false);

      releaseRevocation();
      await pending;

      expect(settled).toBe(true);
    });

    test("throws NotFoundException for a user that does not exist, writing and revoking nothing", async () => {
      /*
       * A missing row must not degrade into a no-op that reports success: an
       * operator acting on a mistyped or stale id would be told two factor auth
       * is now required of somebody, and nobody would be any safer. And nothing
       * may run before the row is confirmed -- an update keyed on an id that
       * does not exist is silent, but a revocation is not, and it would sign out
       * whoever that id belongs to.
       */
      resolveUser(null);

      await expect(
        UserService.setTwoFactorAuthRequired({
          userId: userId,
          isRequired: true,
        }),
      ).rejects.toThrow(NotFoundException);

      expect(updateOneByIdSpy).not.toHaveBeenCalled();
      expect(revokeSessionsSpy).not.toHaveBeenCalled();
    });

    test("logs the change, naming the user it was made against", async () => {
      /*
       * This is one human changing how another human signs in. The user id has
       * to be in the line, or the log records that SOMEBODY's two factor auth
       * requirement changed and an incident review has nothing to go on.
       */
      resolveUser(buildUser({ id: foundUserId, enableTwoFactorAuth: false }));

      await UserService.setTwoFactorAuthRequired({
        userId: userId,
        isRequired: true,
      });

      const lines: Array<string> = loggerInfoSpy.mock.calls.map(
        (call: Array<unknown>): string => {
          return String(call[0]);
        },
      );

      const namingLines: Array<string> = lines.filter(
        (line: string): boolean => {
          return line.includes(foundUserId.toString());
        },
      );

      expect(namingLines.length).toBeGreaterThan(0);
    });

    test("REGRESSION: enabling succeeds for a user with ZERO verified factors", async () => {
      /*
       * THE CASE THE WHOLE FEATURE TURNS ON, and the one that used to be
       * impossible.
       *
       * `UserService.onBeforeUpdate` used to refuse any update setting
       * `enableTwoFactorAuth` on an account with no verified authenticator --
       * "Please verify two factor authentication method before you enable two
       * factor authentication." That guard fired for exactly the users an admin
       * mandate exists for: the ones who have never set two factor auth up. An
       * admin could therefore only require it from people who had already
       * volunteered, which is the opposite of what a mandate is.
       *
       * The guard is gone because its premise dissolved: login now sends an
       * account in this state through ENROLMENT rather than refusing it.
       *
       * The update is routed through the real hook here on purpose. Stubbing
       * `updateOneById` alone would make this pass whether the guard exists or
       * not -- the guard lives inside the write path, so the write path is what
       * has to run.
       */
      resolveUser(buildUser({ id: foundUserId, enableTwoFactorAuth: false }));

      updateOneByIdSpy.mockImplementation(
        async (update: any): Promise<void> => {
          await (
            UserService as unknown as {
              onBeforeUpdate: (updateBy: unknown) => Promise<unknown>;
            }
          ).onBeforeUpdate({
            query: { _id: update.id },
            data: update.data,
            props: update.props,
            limit: 1,
            skip: 0,
          });
        },
      );

      await expect(
        UserService.setTwoFactorAuthRequired({
          userId: userId,
          isRequired: true,
        }),
      ).resolves.toBeUndefined();

      expect(updateOneByIdSpy).toHaveBeenCalledTimes(1);
      expect(revokeSessionsSpy).toHaveBeenCalledTimes(1);
    });

    test("enabling for a user who already has it enabled is idempotent", async () => {
      /*
       * Bulk "require two factor auth" over a selection will always include
       * people who already have it. Short-circuiting on "no change" would look
       * like an optimisation and would quietly drop the session revocation --
       * the half of this method that is doing security work -- for precisely the
       * users an operator was re-asserting the requirement over.
       */
      resolveUser(buildUser({ id: foundUserId, enableTwoFactorAuth: true }));

      await UserService.setTwoFactorAuthRequired({
        userId: userId,
        isRequired: true,
      });

      expect(updateOneByIdSpy).toHaveBeenCalledTimes(1);
      expect(updateOneByIdSpy.mock.calls[0][0].data.enableTwoFactorAuth).toBe(
        true,
      );
      expect(revokeSessionsSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("resetTwoFactorAuth", () => {
    type DeleteCallForFunction = (spy: any) => any;

    const deleteCallFor: DeleteCallForFunction = (spy: any): any => {
      return spy.mock.calls[0][0];
    };

    test("deletes every authenticator app row for the user, as root, unbounded", async () => {
      /*
       * `LIMIT_MAX` rather than a page: a partial delete leaves the user holding
       * an authenticator that still works, so "reset because the phone was
       * stolen" would leave the thief's factor in place. Root because the
       * operator is not the row's owner and has no project-scoped path to it.
       */
      resolveUser(buildUser({ id: foundUserId, enableTwoFactorAuth: true }));

      await UserService.resetTwoFactorAuth({ userId: userId });

      expect(totpDeleteBySpy).toHaveBeenCalledTimes(1);

      const call: any = deleteCallFor(totpDeleteBySpy);

      expect(call.query).toEqual({ userId: foundUserId });
      expect(call.props).toEqual({ isRoot: true });
      expect(call.limit).toBe(LIMIT_MAX);
      expect(call.skip).toBe(0);
    });

    test("deletes every security key row for the user, in the same shape", async () => {
      /*
       * Both tables or neither. Clearing only the TOTP rows would report a
       * successful reset while the user's security key still satisfies login --
       * which is fine for a lost phone and useless for a lost laptop, and the
       * operator cannot tell the two apart from the button they pressed.
       */
      resolveUser(buildUser({ id: foundUserId, enableTwoFactorAuth: true }));

      await UserService.resetTwoFactorAuth({ userId: userId });

      expect(webAuthnDeleteBySpy).toHaveBeenCalledTimes(1);

      const call: any = deleteCallFor(webAuthnDeleteBySpy);

      expect(call.query).toEqual({ userId: foundUserId });
      expect(call.props).toEqual({ isRoot: true });
      expect(call.limit).toBe(LIMIT_MAX);
      expect(call.skip).toBe(0);
    });

    test("the delete queries carry NO isVerified predicate", async () => {
      /*
       * The tempting-but-wrong filter. `countVerifiedTwoFactorAuthMethods`
       * three methods up DOES filter on `isVerified: true`, so copying that
       * shape down here reads as consistency -- and it is the bug.
       *
       * `UserTotpAuthService.onBeforeCreate` writes `isVerified: false` and only
       * the enrolment step flips it, so every abandoned QR scan leaves a row
       * behind forever. A reset that skipped those would hand the user back the
       * very QR code they could not finish rather than a fresh one, which is
       * exactly the thing they came for help about.
       *
       * Asserted as the exact query object, not "isVerified is not true": a
       * `isVerified: false` predicate would be just as wrong in the other
       * direction, deleting the abandoned rows and keeping the working one.
       */
      resolveUser(buildUser({ id: foundUserId, enableTwoFactorAuth: true }));

      await UserService.resetTwoFactorAuth({ userId: userId });

      const violations: Array<string> = [];

      for (const spy of [totpDeleteBySpy, webAuthnDeleteBySpy]) {
        const query: any = deleteCallFor(spy).query;
        const keys: Array<string> = Object.keys(query);

        if (keys.length !== 1 || keys[0] !== "userId") {
          violations.push(
            `a reset delete queried on [${keys.join(", ")}] rather than on userId alone`,
          );
        }
      }

      expect(violations).toEqual([]);
    });

    test("does NOT touch enableTwoFactorAuth", async () => {
      /*
       * "Reset" means clear the configuration and KEEP the requirement: the
       * account lands on a new QR code at its next sign-in, which is the whole
       * point. Clearing the flag as well would answer "my phone is gone" by
       * silently taking the account off two factor auth -- a downgrade nobody
       * asked for, on a page whose other button is literally "require two factor
       * auth", and an operator helping with a lost phone would have no reason to
       * notice.
       *
       * Asserted as "no user update at all", which is the stronger and simpler
       * fact: this method has no business writing to the User row.
       *
       * BOTH write entry points are checked, not just the one this method
       * happens to use. Asserting only `updateOneById` would leave the claim
       * resting on a method name: a rewrite reaching for `updateBy` directly --
       * the natural shape if somebody ever wanted to clear the flag for a whole
       * selection at once -- would clear `enableTwoFactorAuth` in exactly the
       * way this test exists to forbid and would not be seen at all.
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
    });

    test("revokes every session, with a reason short enough to store", async () => {
      /*
       * A session that survives a reset is a session that never has to prove the
       * second factor again -- so "reset because the device was stolen" would do
       * nothing at all about the person holding the stolen device, while
       * reporting success.
       *
       * Same ShortText bound as the enable path, for the same reason: an
       * over-long reason fails the write that closes the window.
       */
      resolveUser(buildUser({ id: foundUserId, enableTwoFactorAuth: true }));

      await UserService.resetTwoFactorAuth({ userId: userId });

      expect(revokeSessionsSpy).toHaveBeenCalledTimes(1);

      const revokedUserId: any = revokeSessionsSpy.mock.calls[0][0];
      const reason: string = revokeSessionsSpy.mock.calls[0][1]
        .reason as string;

      expect(revokedUserId.toString()).toBe(foundUserId.toString());
      expect(typeof reason).toBe("string");
      expect(reason.length).toBeGreaterThan(0);
      expect(reason.length).toBeLessThanOrEqual(ColumnLength.ShortText);
    });

    test("both deletes complete BEFORE the revocation", async () => {
      /*
       * Ordering, not just presence. Revoking first would open a window between
       * the revocation and the deletes in which the user (or whoever has their
       * device) can sign in again using the authenticator that is about to be
       * removed -- and come out the other side with a live session and no
       * pending enrolment. The window is small and entirely real: the deletes
       * are two round trips.
       */
      resolveUser(buildUser({ id: foundUserId, enableTwoFactorAuth: true }));

      await UserService.resetTwoFactorAuth({ userId: userId });

      const totpOrder: number = totpDeleteBySpy.mock
        .invocationCallOrder[0] as number;
      const webAuthnOrder: number = webAuthnDeleteBySpy.mock
        .invocationCallOrder[0] as number;
      const revokeOrder: number = revokeSessionsSpy.mock
        .invocationCallOrder[0] as number;

      const violations: Array<string> = [];

      if (!(totpOrder < revokeOrder)) {
        violations.push(
          "sessions were revoked before the authenticator app rows were deleted",
        );
      }

      if (!(webAuthnOrder < revokeOrder)) {
        violations.push(
          "sessions were revoked before the security key rows were deleted",
        );
      }

      expect(violations).toEqual([]);
    });

    test("throws NotFoundException for a user that does not exist, deleting nothing", async () => {
      /*
       * The delete queries are keyed on `userId`, so a missing row would make
       * them harmless no-ops -- which is precisely why the check has to be
       * explicit. Without it an operator on a mistyped id is told the reset
       * worked, walks away, and the person who actually needs it is still
       * locked out.
       */
      resolveUser(null);

      await expect(
        UserService.resetTwoFactorAuth({ userId: userId }),
      ).rejects.toThrow(NotFoundException);

      expect(totpDeleteBySpy).not.toHaveBeenCalled();
      expect(webAuthnDeleteBySpy).not.toHaveBeenCalled();
      expect(revokeSessionsSpy).not.toHaveBeenCalled();
    });

    test("is a successful no-op for a user with no factors at all", async () => {
      /*
       * The operator pressing this button does not know what the user has set
       * up -- that is why they are on the page. Refusing "there is nothing to
       * reset" would turn an idempotent repair into an error the operator has to
       * interpret, and it is also the state a half-finished previous reset
       * leaves behind, where pressing it again is the obvious thing to do.
       */
      resolveUser(buildUser({ id: foundUserId, enableTwoFactorAuth: true }));

      totpDeleteBySpy.mockImplementation(async (): Promise<number> => {
        return 0;
      });

      webAuthnDeleteBySpy.mockImplementation(async (): Promise<number> => {
        return 0;
      });

      await expect(
        UserService.resetTwoFactorAuth({ userId: userId }),
      ).resolves.toBeUndefined();

      expect(totpDeleteBySpy).toHaveBeenCalledTimes(1);
      expect(webAuthnDeleteBySpy).toHaveBeenCalledTimes(1);
      expect(revokeSessionsSpy).toHaveBeenCalledTimes(1);
    });

    test("resets an Enabled - Pending Setup account with one abandoned enrolment", async () => {
      /*
       * The state an admin mandate creates, plus one QR code the user started
       * and never finished. Nothing is verified, so any implementation that
       * reasoned about verified factors -- a guard refusing to remove the "last"
       * one, or a filtered delete -- behaves differently here than in the
       * ordinary case, and this is the account least able to absorb a mistake:
       * it is already unable to sign in without completing enrolment.
       */
      resolveUser(buildUser({ id: foundUserId, enableTwoFactorAuth: true }));

      totpDeleteBySpy.mockImplementation(async (): Promise<number> => {
        // One unverified row cleared.
        return 1;
      });

      await expect(
        UserService.resetTwoFactorAuth({ userId: userId }),
      ).resolves.toBeUndefined();

      expect(deleteCallFor(totpDeleteBySpy).query).toEqual({
        userId: foundUserId,
      });
      expect(updateOneByIdSpy).not.toHaveBeenCalled();
      expect(revokeSessionsSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("the removed hooks", () => {
    type CallOnBeforeUpdateFunction = (updateBy: unknown) => Promise<any>;

    /*
     * `onBeforeUpdate` is protected, so it is reached through a cast. Driving
     * the hook directly is the point: it is where the deleted guard lived, and
     * a test that went through `updateOneById` would be testing a stub.
     */
    const callOnBeforeUpdate: CallOnBeforeUpdateFunction = async (
      updateBy: unknown,
    ): Promise<any> => {
      return await (
        UserService as unknown as {
          onBeforeUpdate: (u: unknown) => Promise<unknown>;
        }
      ).onBeforeUpdate(updateBy);
    };

    /*
     * ---------------------------------------------------------------------
     * The guard that REPLACED the deleted one, and the reason it had to
     * exist at all.
     *
     * `enableTwoFactorAuth` carries `update: [Permission.CurrentUser]`
     * (Common/Models/DatabaseModels/User.ts) and the User table's row ACL
     * scopes updates to the caller's own id, so every signed-in user can
     * write their own copy of this flag through the ordinary CRUD API -- and
     * the product ships the button that does it, at Dashboard > Profile >
     * Two Factor Authentication.
     *
     * Without the guard the whole feature is self-undoing: the admin requires
     * two factor auth, the user is marched through enrolment at their next
     * sign-in, and then from the session they just earned they flip the
     * toggle back off and delete the factor -- which the removal of the
     * onBeforeDelete guards now also permits. The account is password-only
     * again and the Authentication page reports the mandate as simply absent.
     * ---------------------------------------------------------------------
     */
    test("onBeforeUpdate refuses to let a non-root caller turn the requirement OFF", async () => {
      await expect(
        callOnBeforeUpdate({
          query: { _id: userId },
          data: { enableTwoFactorAuth: false },
          props: {},
        }),
      ).rejects.toThrow(BadDataException);
    });

    test("the refusal names an administrator, so the user knows who to ask", async () => {
      /*
       * The message is the only thing the user sees when the profile toggle
       * refuses. "Bad data" would send them to support with nothing to say.
       */
      await expect(
        callOnBeforeUpdate({
          query: { _id: userId },
          data: { enableTwoFactorAuth: false },
          props: {},
        }),
      ).rejects.toThrow(/administrator/i);
    });

    test("a ROOT caller may turn the requirement off -- that is the admin endpoint", async () => {
      /*
       * setTwoFactorAuthRequired({ isRequired: false }) writes with
       * props.isRoot, so the guard must not catch it. If it did, the admin's
       * "Do Not Require" button would fail for every user.
       */
      await expect(
        callOnBeforeUpdate({
          query: { _id: userId },
          data: { enableTwoFactorAuth: false },
          props: { isRoot: true },
        }),
      ).resolves.toBeDefined();
    });

    test("a non-root caller may still turn the requirement ON for themselves", async () => {
      /*
       * Self-service enrolment stays. The guard is deliberately one-way: it
       * bounds who can WEAKEN an account, not who can strengthen one.
       */
      await expect(
        callOnBeforeUpdate({
          query: { _id: userId },
          data: { enableTwoFactorAuth: true },
          props: {},
        }),
      ).resolves.toBeDefined();
    });

    test("an unrelated non-root update is untouched by the guard", async () => {
      /*
       * The guard keys on the value being exactly `false`, so an update that
       * does not mention the column at all must sail through -- otherwise
       * every profile edit in the product starts failing.
       */
      await expect(
        callOnBeforeUpdate({
          query: { _id: userId },
          data: { name: "Someone" },
          props: {},
        }),
      ).resolves.toBeDefined();
    });

    test("onBeforeUpdate allows enableTwoFactorAuth: true for a user with no verified factor", async () => {
      /*
       * The deleted guard, asserted at its own level.
       *
       * It threw "Please verify two factor authentication method before you
       * enable two factor authentication." for exactly this update, which made
       * an admin mandate impossible for the users it was meant for -- and would
       * ALSO have made the Login enrolment flow's own write fail, since that
       * write happens before any factor is verified.
       */
      await expect(
        callOnBeforeUpdate({
          query: { _id: userId },
          data: { enableTwoFactorAuth: true },
          props: { isRoot: true },
          limit: 1,
          skip: 0,
        }),
      ).resolves.toBeDefined();
    });

    test("that same update issues no probes into the authenticator tables", async () => {
      /*
       * The guard's fingerprint, and a second line of defence behind the test
       * above. A resurrected guard has to ask one of these two services how
       * many factors the user has before it can decide to throw, so "no probe
       * was made" catches a reinstated check even in a form that happens to
       * let this particular update through.
       *
       * Note the spy list below covers `countBy` and `findBy`, NOT `findOneBy`
       * -- and the original guard probed with `findOneBy`, which
       * DatabaseService routes through a private `_findBy` rather than the
       * public method spied here. So this assertion alone would NOT have
       * caught the guard in its original form. What catches that is the
       * non-empty `findBy` stub in beforeEach, which lets the restored guard
       * actually reach its throw.
       *
       * It is also a cost assertion in its own right: `onBeforeUpdate` runs on
       * EVERY user update in the product -- lastActive being written on every
       * authenticated request included -- so two extra COUNT queries here would
       * be two extra queries on one of the hottest paths there is.
       */
      await callOnBeforeUpdate({
        query: { _id: userId },
        data: { enableTwoFactorAuth: true },
        props: { isRoot: true },
        limit: 1,
        skip: 0,
      });

      const violations: Array<string> = [];

      for (const spy of authenticatorProbeSpies()) {
        if (spy.mock.calls.length > 0) {
          violations.push(
            `onBeforeUpdate made ${spy.mock.calls.length} call(s) into an authenticator service`,
          );
        }
      }

      expect(violations).toEqual([]);
      expect(findBySpy).not.toHaveBeenCalled();
    });

    test("onBeforeUpdate still carries the affected users forward for a password update", async () => {
      /*
       * REGRESSION GUARD FOR THE DELETION ITSELF. The removed block sat directly
       * beside this one, and this one is load-bearing in a way that is entirely
       * invisible from `onBeforeUpdate`: `onUpdateSuccess` iterates
       * `carryForward` to revoke sessions and send the "Password Changed." mail.
       * An empty carryForward is not an error -- the loop simply runs zero
       * times, so a password change would silently stop signing out the stolen
       * session it exists to kill, and stop telling the user anything happened.
       *
       * The SELECT is pinned as well as the rows, and that half is not
       * decoration. `onUpdateSuccess` addresses the mail with `user.email!` --
       * a non-null assertion over a column it did not fetch itself. Narrowing
       * this select to `_id` alone still produces a carryForward of the right
       * length with the right ids, so every assertion about the rows keeps
       * passing while every "Password Changed." mail goes out to `undefined`.
       * Because `findBy` is stubbed here, the returned row's own `email` proves
       * nothing about that; only the select does.
       */
      const affected: User = buildUser({
        id: foundUserId,
        email: "user@example.com",
      });

      findBySpy.mockImplementation(async (): Promise<Array<User>> => {
        return [affected];
      });

      const result: any = await callOnBeforeUpdate({
        query: { _id: userId },
        data: { password: new HashedString("a-perfectly-fine-password") },
        props: { isRoot: true },
        limit: 1,
        skip: 0,
      });

      expect(findBySpy).toHaveBeenCalledTimes(1);
      expect(result.carryForward).toHaveLength(1);
      expect(result.carryForward[0].id.toString()).toBe(foundUserId.toString());

      const select: any = findBySpy.mock.calls[0][0].select;
      const violations: Array<string> = [];

      for (const column of ["_id", "email"]) {
        if (select[column] !== true) {
          violations.push(
            `onBeforeUpdate did not carry ${column} forward for a password update; onUpdateSuccess needs it`,
          );
        }
      }

      expect(violations).toEqual([]);
    });

    test("neither authenticator service overrides onBeforeDelete any more", async () => {
      /*
       * Both services used to refuse the deletion of a user's LAST verified
       * factor while `enableTwoFactorAuth` was on, advising them to "disable two
       * factor auth before deleting this item".
       *
       * Both halves of that stopped being true. The advice is impossible to
       * follow for a user whose two factor auth was MANDATED -- they cannot turn
       * the requirement off -- so the guard did not protect them, it stranded
       * them on an authenticator they may have been trying to replace, and it
       * would have made `resetTwoFactorAuth` throw on the one account that needs
       * it most. And the lockout it protected against no longer exists: an
       * account required to use two factor auth with nothing set up is now sent
       * through enrolment at its next sign-in, so deleting the last factor costs
       * a QR code, not an account.
       *
       * (It was also wrong on its own terms -- it counted the factors that
       * existed BEFORE the delete, once per item, inside a loop over the whole
       * delete set, so removing two verified factors in one call passed the
       * check twice and landed in the state it existed to prevent.)
       *
       * Identity against `DatabaseService.prototype` is the robust form: it does
       * not care what a reinstated guard would decide, only that the two
       * services still inherit the placeholder.
       */
      const violations: Array<string> = [];

      const inherited: unknown = (DatabaseService.prototype as any)
        .onBeforeDelete;

      if ((UserTotpAuthService as any).onBeforeDelete !== inherited) {
        violations.push("UserTotpAuthService overrides onBeforeDelete again");
      }

      if ((UserWebAuthnService as any).onBeforeDelete !== inherited) {
        violations.push("UserWebAuthnService overrides onBeforeDelete again");
      }

      expect(violations).toEqual([]);
    });

    test("the override comparison can actually detect an override", async () => {
      /*
       * Pairs with the test above so it cannot pass vacuously. If
       * `DatabaseService.prototype.onBeforeDelete` were ever undefined, or the
       * decorator started producing a fresh function per access, the identity
       * check would compare two nothings and report success no matter what the
       * two services did.
       *
       * `UserService` genuinely DOES override `onBeforeDelete` (it refuses to
       * delete a user who is still a member of a project), so it is the control:
       * the comparison must come out different for it.
       */
      const inherited: unknown = (DatabaseService.prototype as any)
        .onBeforeDelete;

      expect(typeof inherited).toBe("function");
      expect((UserService as any).onBeforeDelete).not.toBe(inherited);
    });

    test("deleting the last verified factor of a mandated account no longer throws", async () => {
      /*
       * The removal expressed as behaviour rather than as identity, because
       * behaviour is what the product depends on. This is precisely the call
       * `resetTwoFactorAuth` makes for a user whose two factor auth is REQUIRED
       * and whose only factor is verified -- the lost-phone case -- and the old
       * guard turned it into "Please disable two factor auth before deleting
       * this item", advice that user could not act on.
       */
      const deleteBy: unknown = {
        query: { userId: userId },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      };

      for (const service of [UserTotpAuthService, UserWebAuthnService]) {
        await expect(
          (
            service as unknown as {
              onBeforeDelete: (d: unknown) => Promise<unknown>;
            }
          ).onBeforeDelete(deleteBy),
        ).resolves.toBeDefined();
      }

      // ...and it reached that answer without consulting anything.
      const violations: Array<string> = [];

      for (const spy of authenticatorProbeSpies()) {
        if (spy.mock.calls.length > 0) {
          violations.push(
            "onBeforeDelete probed an authenticator service before allowing the delete",
          );
        }
      }

      expect(violations).toEqual([]);
      expect(findOneBySpy).not.toHaveBeenCalled();
    });
  });
});
