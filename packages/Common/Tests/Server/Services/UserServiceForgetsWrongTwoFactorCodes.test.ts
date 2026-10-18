import DatabaseConfig from "../../../Server/DatabaseConfig";
import Redis from "../../../Server/Infrastructure/Redis";
import MailService from "../../../Server/Services/MailService";
import UserService from "../../../Server/Services/UserService";
import UserSessionService from "../../../Server/Services/UserSessionService";
import UserTotpAuthService from "../../../Server/Services/UserTotpAuthService";
import UserTwoFactorBackupCodeService from "../../../Server/Services/UserTwoFactorBackupCodeService";
import UserWebAuthnService from "../../../Server/Services/UserWebAuthnService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import logger from "../../../Server/Utils/Logger";
import TwoFactorWrongCodes from "../../../Server/Utils/TwoFactorWrongCodes";
import User from "../../../Models/DatabaseModels/User";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import Email from "../../../Types/Email";
import HashedString from "../../../Types/HashedString";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * A NEW PASSWORD, OR A MASTER ADMIN'S RESET OF TWO FACTOR AUTHENTICATION,
 * ENDS ANY WAIT FOR WRONG TWO FACTOR CODES.
 *
 * Wrong second-step codes are counted for the account once the password is
 * right (Utils/TwoFactorWrongCodes), and after five in a row each next code
 * waits. Whoever entered them held the password; once it changes they hold
 * nothing, and the owner who changed it must sign in at once. A reset is how
 * an administrator lets somebody back in, so it must not leave them waiting
 * behind codes for an app they no longer have.
 *
 * UserService owns both: `onUpdateSuccess`, which every password change goes
 * through (the reset link, the profile page, Set Password in the Admin
 * Dashboard), and `resetTwoFactorAuth`. No database: the services they call
 * are jest.spyOn stubs, and the protected hook is reached through a
 * structural cast.
 * ---------------------------------------------------------------------------
 */

const USER_ID: ObjectID = new ObjectID("3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "4d5e6f7a-8b9c-4dae-8f10-2b3c4d5e6f70",
);

interface UserServiceInternals {
  onUpdateSuccess: (
    onUpdate: OnUpdate<User>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<User>>;
}

function userService(): UserServiceInternals {
  return UserService as unknown as UserServiceInternals;
}

function carried(id: ObjectID, email: string): User {
  const user: User = new User();
  user.id = id;
  user.email = new Email(email);
  return user;
}

function updateOf(
  patch: Record<string, unknown>,
  carryForward: Array<User>,
): OnUpdate<User> {
  const updateBy: UpdateBy<User> = {
    query: { _id: USER_ID.toString() } as unknown as UpdateBy<User>["query"],
    data: patch as unknown as UpdateBy<User>["data"],
    props: { isRoot: true },
    limit: 1,
    skip: 0,
  };

  return { updateBy, carryForward };
}

let forget: jest.SpyInstance;
let revokeAllSessionsByUserId: jest.SpyInstance;
let order: Array<string>;

beforeEach(() => {
  order = [];

  forget = jest
    .spyOn(TwoFactorWrongCodes, "forget")
    .mockImplementation(async (userId: ObjectID): Promise<void> => {
      order.push(`forget ${userId.toString()}`);
    });

  revokeAllSessionsByUserId = jest
    .spyOn(UserSessionService, "revokeAllSessionsByUserId")
    .mockImplementation(async (userId: ObjectID): Promise<void> => {
      order.push(`revoke ${userId.toString()}`);
    });

  jest
    .spyOn(DatabaseConfig, "getHost")
    .mockResolvedValue(new Hostname("oneuptime.example.com"));
  jest
    .spyOn(DatabaseConfig, "getHttpProtocol")
    .mockResolvedValue(Protocol.HTTPS);
  jest.spyOn(MailService, "sendMail").mockResolvedValue(undefined as never);
  jest.spyOn(logger, "info").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a new password ends the wait", () => {
  test("the user whose password changed has their wrong codes forgotten, after their sessions end", async () => {
    await userService().onUpdateSuccess(
      updateOf({ password: new HashedString("a new password") }, [
        carried(USER_ID, "owner@example.com"),
      ]),
      [USER_ID],
    );

    expect(forget).toHaveBeenCalledTimes(1);
    expect(forget).toHaveBeenCalledWith(USER_ID);
    expect(order).toEqual([
      `revoke ${USER_ID.toString()}`,
      `forget ${USER_ID.toString()}`,
    ]);
  });

  test("every user a password write reached", async () => {
    await userService().onUpdateSuccess(
      updateOf({ password: new HashedString("a new password") }, [
        carried(USER_ID, "owner@example.com"),
        carried(OTHER_USER_ID, "other@example.com"),
      ]),
      [USER_ID, OTHER_USER_ID],
    );

    expect(forget).toHaveBeenCalledTimes(2);
    expect(forget).toHaveBeenCalledWith(USER_ID);
    expect(forget).toHaveBeenCalledWith(OTHER_USER_ID);
  });

  test.each([
    ["a new name", { name: "Renamed" }],
    ["a block", { isBlocked: true }],
    ["a time zone", { timezone: "Europe/London" }],
  ])(
    "%s is not a new password: the wait stands",
    async (_name: string, patch: Record<string, unknown>) => {
      await userService().onUpdateSuccess(updateOf(patch, []), [USER_ID]);

      expect(forget).not.toHaveBeenCalled();
    },
  );

  test("a password change still completes when the count cannot be cleared", async () => {
    forget.mockRestore();

    const failingClient: Record<string, unknown> = {
      del: (): Promise<number> => {
        return Promise.reject(new Error("connection lost"));
      },
    };

    jest.spyOn(Redis, "getClient").mockReturnValue(failingClient as never);
    jest.spyOn(Redis, "isConnected").mockReturnValue(true);
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });

    await expect(
      userService().onUpdateSuccess(
        updateOf({ password: new HashedString("a new password") }, [
          carried(USER_ID, "owner@example.com"),
        ]),
        [USER_ID],
      ),
    ).resolves.toBeDefined();

    expect(revokeAllSessionsByUserId).toHaveBeenCalledWith(USER_ID, {
      reason: "Password changed",
    });
  });
});

describe("a master admin's reset of two factor authentication ends the wait", () => {
  beforeEach(() => {
    jest
      .spyOn(UserTotpAuthService, "deleteBy")
      .mockImplementation(async (): Promise<number> => {
        order.push("delete authenticator apps");
        return 0;
      });
    jest
      .spyOn(UserWebAuthnService, "deleteBy")
      .mockImplementation(async (): Promise<number> => {
        order.push("delete security keys");
        return 0;
      });
    jest
      .spyOn(UserTwoFactorBackupCodeService, "deleteAllForUser")
      .mockImplementation(async (): Promise<void> => {
        order.push("delete backup codes");
      });
  });

  test("the user found, not merely the id asked about, has their wrong codes forgotten - last, after everything else", async () => {
    const found: User = new User();
    found.id = OTHER_USER_ID;

    jest.spyOn(UserService, "findOneBy").mockResolvedValue(found as never);

    await UserService.resetTwoFactorAuth({ userId: USER_ID });

    expect(forget).toHaveBeenCalledTimes(1);
    expect(forget).toHaveBeenCalledWith(OTHER_USER_ID);
    expect(order).toEqual([
      "delete authenticator apps",
      "delete security keys",
      "delete backup codes",
      `revoke ${OTHER_USER_ID.toString()}`,
      `forget ${OTHER_USER_ID.toString()}`,
    ]);
  });

  test("a user who does not exist: nothing is forgotten", async () => {
    jest.spyOn(UserService, "findOneBy").mockResolvedValue(null as never);

    await expect(
      UserService.resetTwoFactorAuth({ userId: USER_ID }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(forget).not.toHaveBeenCalled();
  });
});
