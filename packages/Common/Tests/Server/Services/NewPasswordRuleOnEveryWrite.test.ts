import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import StatusPagePrivateUserService from "../../../Server/Services/StatusPagePrivateUserService";
import UserService from "../../../Server/Services/UserService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import NewPasswordRule from "../../../Server/Utils/NewPasswordRule";
import StatusPagePrivateUser from "../../../Models/DatabaseModels/StatusPagePrivateUser";
import User from "../../../Models/DatabaseModels/User";
import BadDataException from "../../../Types/Exception/BadDataException";
import HashedString from "../../../Types/HashedString";
import { PASSWORD_RULE_MESSAGES } from "../../../Types/Password";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * The server keeps the one password rule on every write of a new password
 * (#9123), not only on sign-up: a reset link, Update Password, a master
 * admin's Create User or Set Password, a status page's reset link, and the
 * API all end in UserService's or StatusPagePrivateUserService's write hooks,
 * and a weak password is refused there before anything is read or written.
 *
 * And only a NEW password: a stored hash is not the rule's business, so a
 * password set before the rule keeps working (and is re-hashed in place on
 * sign-in) until its owner changes it.
 */

const STRONG_PASSWORD: string = "violet river lantern";

interface HookInternals<TModel extends DatabaseBaseModel> {
  onBeforeCreate: (createBy: CreateBy<TModel>) => Promise<OnCreate<TModel>>;
  onBeforeUpdate: (updateBy: UpdateBy<TModel>) => Promise<OnUpdate<TModel>>;
}

const userHooks: HookInternals<User> =
  UserService as unknown as HookInternals<User>;

const privateUserHooks: HookInternals<StatusPagePrivateUser> =
  StatusPagePrivateUserService as unknown as HookInternals<StatusPagePrivateUser>;

function passwordUpdate<TModel extends DatabaseBaseModel>(
  password: unknown,
): UpdateBy<TModel> {
  return {
    query: {
      _id: "11111111-1111-4111-8111-111111111111",
    } as unknown as UpdateBy<TModel>["query"],
    data: { password: password } as unknown as UpdateBy<TModel>["data"],
    props: { isRoot: true },
    limit: 1,
    skip: 0,
  };
}

function passwordCreate<TModel extends DatabaseBaseModel>(
  password: unknown,
): CreateBy<TModel> {
  return {
    data: { password: password } as unknown as CreateBy<TModel>["data"],
    props: { isRoot: true },
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("NewPasswordRule", () => {
  test("a write with no password is not the rule's business", () => {
    expect(NewPasswordRule.getRefusal(undefined)).toBeNull();
    expect(NewPasswordRule.getRefusal(null)).toBeNull();
  });

  test("a new password, as the plaintext somebody chose, is held to the rule", () => {
    expect(NewPasswordRule.getRefusal(new HashedString("abc123"))).toBe(
      PASSWORD_RULE_MESSAGES.tooShort,
    );
    expect(
      NewPasswordRule.getRefusal(new HashedString("password123456789")),
    ).toBe(PASSWORD_RULE_MESSAGES.predictable);
    expect(NewPasswordRule.getRefusal("abc123")).toBe(
      PASSWORD_RULE_MESSAGES.tooShort,
    );
    expect(
      NewPasswordRule.getRefusal(new HashedString(STRONG_PASSWORD)),
    ).toBeNull();
  });

  test("a stored hash is never judged: an existing short password keeps working", () => {
    expect(
      NewPasswordRule.getRefusal(new HashedString("a-stored-digest", true)),
    ).toBeNull();
  });

  test("assertMet throws the rule's sentence as a 400", () => {
    expect(() => {
      NewPasswordRule.assertMet(new HashedString("abc123"));
    }).toThrow(new BadDataException(PASSWORD_RULE_MESSAGES.tooShort));

    expect(() => {
      NewPasswordRule.assertMet(new HashedString(STRONG_PASSWORD));
    }).not.toThrow();
  });
});

describe("UserService refuses a weak new password on every write", () => {
  test("an update - a reset link, Update Password, Set Password - before any row is read", async () => {
    const findRows: SpyInstance<() => Promise<Array<User>>> = jest
      .spyOn(
        UserService as unknown as Record<string, () => Promise<Array<User>>>,
        "findRowsAndHoldUpdateToThem",
      )
      .mockResolvedValue([]);

    await expect(
      userHooks.onBeforeUpdate(
        passwordUpdate<User>(new HashedString("abc123")),
      ),
    ).rejects.toThrow(PASSWORD_RULE_MESSAGES.tooShort);

    expect(findRows).not.toHaveBeenCalled();
  });

  test("an update with a strong password goes on", async () => {
    jest
      .spyOn(
        UserService as unknown as Record<string, () => Promise<Array<User>>>,
        "findRowsAndHoldUpdateToThem",
      )
      .mockResolvedValue([]);

    await expect(
      userHooks.onBeforeUpdate(
        passwordUpdate<User>(new HashedString(STRONG_PASSWORD)),
      ),
    ).resolves.toBeDefined();
  });

  test("an update that stores a hash already made is not refused", async () => {
    jest
      .spyOn(
        UserService as unknown as Record<string, () => Promise<Array<User>>>,
        "findRowsAndHoldUpdateToThem",
      )
      .mockResolvedValue([]);

    await expect(
      userHooks.onBeforeUpdate(
        passwordUpdate<User>(new HashedString("short", true)),
      ),
    ).resolves.toBeDefined();
  });

  test("a create - sign-up, a master admin's Create User, the API", async () => {
    await expect(
      userHooks.onBeforeCreate(
        passwordCreate<User>(new HashedString("violet river")),
      ),
    ).rejects.toThrow(PASSWORD_RULE_MESSAGES.tooShort);

    await expect(
      userHooks.onBeforeCreate(passwordCreate<User>(new HashedString(""))),
    ).rejects.toThrow(PASSWORD_RULE_MESSAGES.required);
  });
});

describe("StatusPagePrivateUserService refuses a weak new password on every write", () => {
  test("an update - the status page's reset link, the API", async () => {
    await expect(
      privateUserHooks.onBeforeUpdate(
        passwordUpdate<StatusPagePrivateUser>(new HashedString("abc123")),
      ),
    ).rejects.toThrow(PASSWORD_RULE_MESSAGES.tooShort);

    await expect(
      privateUserHooks.onBeforeUpdate(
        passwordUpdate<StatusPagePrivateUser>(
          new HashedString("qwertyuiopasdfgh"),
        ),
      ),
    ).rejects.toThrow(PASSWORD_RULE_MESSAGES.predictable);
  });

  test("a create that starts with a password", async () => {
    await expect(
      privateUserHooks.onBeforeCreate(
        passwordCreate<StatusPagePrivateUser>(new HashedString("abc123")),
      ),
    ).rejects.toThrow(PASSWORD_RULE_MESSAGES.tooShort);
  });
});
