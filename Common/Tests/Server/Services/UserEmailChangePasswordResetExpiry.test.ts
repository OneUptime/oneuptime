import UserService from "../../../Server/Services/UserService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import User from "../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import HashedString from "../../../Types/HashedString";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A PASSWORD RESET LINK MUST NOT SURVIVE THE ADDRESS IT WAS MAILED TO.
 *
 * The bug this file pins down, reported against oneuptime.com as "Broken
 * Authentication Leads To Account Takeover":
 *
 *   1. Somebody who can read the victim's mailbox requests a password reset
 *      and DOES NOT click the link. The account is untouched, so nothing looks
 *      wrong to the victim -- this is the step that makes the whole thing
 *      work.
 *   2. The victim realises the mailbox is compromised and moves the account to
 *      an address the attacker cannot read. This is the standard remedy, and
 *      the product's own "You have changed your email" mail implies it worked.
 *   3. The attacker spends the link from step 1. `POST /reset-password` finds
 *      the account BY TOKEN HASH ALONE -- it never looks at the email address
 *      on the row -- so it sets a new password on the account at its NEW
 *      address, and the victim loses the account they had just rescued.
 *
 * The fix is one invariant, enforced in `UserService.onBeforeUpdate`: writing a
 * DIFFERENT email address to a user row clears `resetPasswordToken` and
 * `resetPasswordExpires` on that row first. Every test below is about some way
 * that invariant can be broken while the product still appears to work:
 *
 *  - clearing AFTER the email write (in `onUpdateSuccess`) leaves a window in
 *    which the new address is committed and the old link still redeemable, so
 *    the assertions below are about the state of the row when `onBeforeUpdate`
 *    RETURNS, before the caller's UPDATE has run at all;
 *  - clearing by adding the two columns to `updateBy.data` would look correct
 *    and pass a naive test, but `resetPasswordToken` is declared `update: []`,
 *    so the permission check that runs after this hook would reject the whole
 *    write and no user could change their own email again. Hence the explicit
 *    test that `updateBy.data` is left alone;
 *  - clearing on EVERY email write, rather than on a change, would let a SCIM
 *    directory sync -- which rewrites `email` with the value it already has on
 *    every push -- silently invalidate a reset link a user is part-way through
 *    using.
 *
 * No database is involved. `findBy` and `updateOneById` on the UserService
 * singleton are jest.spyOn stubs, and the hook -- protected, but an ordinary
 * prototype method at runtime -- is reached through a structural cast.
 * ---------------------------------------------------------------------------
 */

const USER_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const THIRD_USER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const OLD_EMAIL: string = "victim@compromised-mailbox.example.com";
const NEW_EMAIL: string = "victim@rescued-mailbox.example.com";

// The digest a live reset link would have left on the row.
const PENDING_TOKEN_HASH: string = "a-live-reset-token-digest";

interface UserServiceInternals {
  onBeforeUpdate: (updateBy: UpdateBy<User>) => Promise<OnUpdate<User>>;
}

function userService(): UserServiceInternals {
  return UserService as unknown as UserServiceInternals;
}

type PersistedUserData = {
  id?: ObjectID | undefined;
  email?: string | undefined;
};

/*
 * A row as `onBeforeUpdate`'s own `findBy` returns it: `_id` and `email` only,
 * because that is precisely what the hook selects. `email` is omitted when the
 * caller asks for it, which is the shape a column the caller may not read
 * comes back as.
 */
function persistedUser(data: PersistedUserData = {}): User {
  const user: User = new User();

  if (data.id !== undefined) {
    user.id = data.id;
    user._id = data.id.toString();
  }

  if (data.email !== undefined) {
    user.email = new Email(data.email);
  }

  return user;
}

type UpdatePayloadData = {
  patch: Record<string, unknown>;
  query?: Record<string, unknown> | undefined;
  props?: DatabaseCommonInteractionProps | undefined;
};

/* An ordinary signed-in user editing their own profile: no root, no role. */
function currentUserProps(): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
  };
}

function updatePayload(data: UpdatePayloadData): UpdateBy<User> {
  return {
    query: (data.query || {
      _id: USER_ID.toString(),
    }) as unknown as UpdateBy<User>["query"],
    data: data.patch as unknown as UpdateBy<User>["data"],
    props: data.props || currentUserProps(),
    limit: 10,
    skip: 0,
  };
}

type Stubs = {
  findBy: jest.SpyInstance;
  updateOneById: jest.SpyInstance;
};

let stubs: Stubs;

describe("UserService.onBeforeUpdate — a password reset link dies with the address it was mailed to", () => {
  beforeEach(() => {
    stubs = {
      findBy: jest
        .spyOn(UserService, "findBy")
        .mockResolvedValue([
          persistedUser({ id: USER_ID, email: OLD_EMAIL }),
        ] as never),
      updateOneById: jest
        .spyOn(UserService, "updateOneById")
        .mockResolvedValue(undefined as never),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("the reported attack", () => {
    test("a link minted before the address change is gone once the address changes", async () => {
      /*
       * The end-to-end shape of the report, with the row standing in for the
       * database. What matters is the LAST line: after the victim moves the
       * account, `/reset-password`'s lookup -- `findOneBy({ resetPasswordToken:
       * <hash> })` -- has nothing left to match, so the link the attacker is
       * holding resolves to no user and the endpoint answers "Invalid link".
       */
      const row: {
        email: string;
        resetPasswordToken: string | null;
        resetPasswordExpires: Date | null;
      } = {
        email: OLD_EMAIL,
        // Step 1: the attacker requested a reset and never spent the link.
        resetPasswordToken: PENDING_TOKEN_HASH,
        resetPasswordExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };

      stubs.findBy.mockResolvedValue([
        persistedUser({ id: USER_ID, email: row.email }),
      ] as never);

      stubs.updateOneById.mockImplementation(
        (updateBy: { data: Record<string, unknown> }): Promise<number> => {
          if ("resetPasswordToken" in updateBy.data) {
            row.resetPasswordToken = updateBy.data["resetPasswordToken"] as
              | string
              | null;
          }

          if ("resetPasswordExpires" in updateBy.data) {
            row.resetPasswordExpires = updateBy.data[
              "resetPasswordExpires"
            ] as Date | null;
          }

          return Promise.resolve(1);
        },
      );

      // Step 2: the victim moves the account to a mailbox the attacker cannot read.
      await userService().onBeforeUpdate(
        updatePayload({ patch: { email: new Email(NEW_EMAIL) } }),
      );

      // Step 3: there is no longer anything for the attacker's link to match.
      expect(row.resetPasswordToken).toBeNull();
      expect(row.resetPasswordExpires).toBeNull();
    });

    test("the link is dead BEFORE the new address is written, not after", async () => {
      /*
       * The ordering is the security property, not an implementation detail.
       * Clearing in `onUpdateSuccess` would also make the test above pass while
       * leaving an interval -- however short -- in which the account answers to
       * the new address and the old link still works. `onBeforeUpdate` returns
       * to the caller BEFORE the caller's UPDATE runs, so asserting the write
       * has already happened by the time it returns is asserting that no such
       * interval exists.
       */
      await userService().onBeforeUpdate(
        updatePayload({ patch: { email: new Email(NEW_EMAIL) } }),
      );

      expect(stubs.updateOneById).toHaveBeenCalledTimes(1);
    });
  });

  describe("what the clearing write looks like", () => {
    test("it nulls both the token and its expiry, and touches nothing else", async () => {
      await userService().onBeforeUpdate(
        updatePayload({ patch: { email: new Email(NEW_EMAIL) } }),
      );

      const write: Record<string, unknown> = (
        stubs.updateOneById.mock.calls[0]![0] as unknown as {
          data: Record<string, unknown>;
        }
      ).data;

      expect(write).toEqual({
        resetPasswordToken: null,
        resetPasswordExpires: null,
      });
    });

    test("it is aimed at the row whose address is changing", async () => {
      await userService().onBeforeUpdate(
        updatePayload({ patch: { email: new Email(NEW_EMAIL) } }),
      );

      const write: { id: ObjectID } = stubs.updateOneById.mock
        .calls[0]![0] as unknown as { id: ObjectID };

      expect(write.id.toString()).toBe(USER_ID.toString());
    });

    test("it is a root, hook-free write", async () => {
      /*
       * Root because `resetPasswordToken` carries `update: []` -- there is no
       * permission that can write it, so the ordinary caller's props would be
       * refused. Hook-free because this IS the update hook: re-entering it
       * would send this write looking for an email change of its own.
       */
      await userService().onBeforeUpdate(
        updatePayload({ patch: { email: new Email(NEW_EMAIL) } }),
      );

      const write: { props: DatabaseCommonInteractionProps } = stubs
        .updateOneById.mock.calls[0]![0] as unknown as {
        props: DatabaseCommonInteractionProps;
      };

      expect(write.props.isRoot).toBe(true);
      expect(write.props.ignoreHooks).toBe(true);
    });

    test("the caller's own update is left exactly as it was", async () => {
      /*
       * The tempting one-line fix is to fold the two nulls into `updateBy.data`
       * so they ride along on the caller's UPDATE. It cannot be done here:
       * `ModelPermission.checkUpdateQueryPermissions` runs AFTER this hook and
       * refuses any column whose `update` list is empty, so a user changing
       * their own email would get a permission error instead of an email
       * change -- a regression that no test about tokens would catch.
       */
      const payload: UpdateBy<User> = updatePayload({
        patch: { email: new Email(NEW_EMAIL) },
      });

      await userService().onBeforeUpdate(payload);

      expect(Object.keys(payload.data)).toEqual(["email"]);
    });

    test("an ordinary user changing their own address still gets the token cleared", async () => {
      /*
       * The victim in the report is not an admin. The clearing write must not
       * inherit the caller's props, or it would be refused for exactly the
       * person the fix exists to protect.
       */
      await userService().onBeforeUpdate(
        updatePayload({
          patch: { email: new Email(NEW_EMAIL) },
          props: currentUserProps(),
        }),
      );

      expect(stubs.updateOneById).toHaveBeenCalledTimes(1);
    });
  });

  describe("writes that must NOT invalidate a pending link", () => {
    test("re-writing the address the account already has", async () => {
      /*
       * SCIM pushes `email` on every sync whether or not it changed (see
       * App/FeatureSet/Identity/API/SCIM.ts, which updates whenever the email
       * OR the name is present). If those cleared tokens, a directory sync
       * firing between "send me a reset link" and "here is my new password"
       * would break the reset for no reason at all.
       */
      await userService().onBeforeUpdate(
        updatePayload({ patch: { email: new Email(OLD_EMAIL) } }),
      );

      expect(stubs.updateOneById).not.toHaveBeenCalled();
    });

    test("re-writing the same address in different case", async () => {
      /*
       * The address the user types is not necessarily the one on the row,
       * character for character. Today `Email` lowercases on construction so
       * the two agree by the time they get here; the comparison lowercases as
       * well, so this keeps holding if a raw string ever reaches `data.email`.
       */
      stubs.findBy.mockResolvedValue([
        persistedUser({ id: USER_ID, email: "Victim@Example.com" }),
      ] as never);

      await userService().onBeforeUpdate(
        updatePayload({ patch: { email: new Email("victim@example.com") } }),
      );

      expect(stubs.updateOneById).not.toHaveBeenCalled();
    });

    test("a password change, which has its own session revocation", async () => {
      await userService().onBeforeUpdate(
        updatePayload({
          patch: { password: new HashedString("a-new-password") },
        }),
      );

      expect(stubs.updateOneById).not.toHaveBeenCalled();
    });

    test("a profile edit that does not touch the address at all", async () => {
      await userService().onBeforeUpdate(
        updatePayload({ patch: { name: new Name("Victim") } }),
      );

      expect(stubs.findBy).not.toHaveBeenCalled();
      expect(stubs.updateOneById).not.toHaveBeenCalled();
    });
  });

  describe("updates that match more than one row", () => {
    test("every row whose address changes is cleared, and only those", async () => {
      /*
       * `updateBy.query` is a query, not an id, so one call can carry the same
       * new address onto several rows -- and the ones already at that address
       * are not changing. A fix written against `updateOneById` alone would
       * quietly clear only the first.
       */
      stubs.findBy.mockResolvedValue([
        persistedUser({ id: USER_ID, email: OLD_EMAIL }),
        persistedUser({ id: OTHER_USER_ID, email: NEW_EMAIL }),
        persistedUser({ id: THIRD_USER_ID, email: "third@example.com" }),
      ] as never);

      await userService().onBeforeUpdate(
        updatePayload({
          patch: { email: new Email(NEW_EMAIL) },
          query: { isEmailVerified: true },
        }),
      );

      const clearedIds: Array<string> = stubs.updateOneById.mock.calls.map(
        (call: Array<unknown>) => {
          return (call[0] as { id: ObjectID }).id.toString();
        },
      );

      expect(clearedIds).toEqual([
        USER_ID.toString(),
        THIRD_USER_ID.toString(),
      ]);
    });

    test("a row that came back without an id is skipped rather than throwing", async () => {
      stubs.findBy.mockResolvedValue([
        persistedUser({ email: OLD_EMAIL }),
        persistedUser({ id: USER_ID, email: OLD_EMAIL }),
      ] as never);

      await expect(
        userService().onBeforeUpdate(
          updatePayload({ patch: { email: new Email(NEW_EMAIL) } }),
        ),
      ).resolves.toBeDefined();

      expect(stubs.updateOneById).toHaveBeenCalledTimes(1);
    });
  });

  describe("fail-closed behaviour", () => {
    test("a row whose address could not be read is treated as changed", async () => {
      /*
       * `email` comes back absent only when the caller could not read the
       * column. There is then no way to tell whether the address is changing,
       * and the two answers are not equally bad: guessing "unchanged" leaves a
       * live reset link on an account that may have just moved, while guessing
       * "changed" costs the user one more trip to the forgot-password page.
       */
      stubs.findBy.mockResolvedValue([persistedUser({ id: USER_ID })] as never);

      await userService().onBeforeUpdate(
        updatePayload({ patch: { email: new Email(NEW_EMAIL) } }),
      );

      expect(stubs.updateOneById).toHaveBeenCalledTimes(1);
    });
  });

  describe("the rest of the hook still works", () => {
    test("carryForward still holds the rows as they were before the write", async () => {
      /*
       * `onUpdateSuccess` diffs `carryForward` against the re-read rows to
       * decide whether to send the "please verify your new address" mail and
       * clear `isEmailVerified`. Clearing tokens must not disturb that: if
       * carryForward came back empty, an email change would silently stop
       * requiring re-verification.
       */
      const result: OnUpdate<User> = await userService().onBeforeUpdate(
        updatePayload({ patch: { email: new Email(NEW_EMAIL) } }),
      );

      expect(result.carryForward).toHaveLength(1);
      expect((result.carryForward as Array<User>)[0]!.email!.toString()).toBe(
        OLD_EMAIL,
      );
    });

    test("the rows are loaded once, not once per concern", async () => {
      await userService().onBeforeUpdate(
        updatePayload({ patch: { email: new Email(NEW_EMAIL) } }),
      );

      expect(stubs.findBy).toHaveBeenCalledTimes(1);
    });

    test("turning off two factor auth as a non-root caller is still refused", async () => {
      /*
       * The guard that lives immediately after the new code in the same hook.
       * Cheap to assert here, and it is the thing an edit to this method is
       * most likely to displace.
       */
      await expect(
        userService().onBeforeUpdate(
          updatePayload({ patch: { enableTwoFactorAuth: false } }),
        ),
      ).rejects.toThrow(
        "Only an administrator can turn off two factor authentication for this account.",
      );
    });
  });
});
