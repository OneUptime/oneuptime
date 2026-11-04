import { EncryptionSecret } from "../../../Server/EnvironmentConfig";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import MailService from "../../../Server/Services/MailService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserService from "../../../Server/Services/UserService";
import UserSessionService from "../../../Server/Services/UserSessionService";
import UserTotpAuthService from "../../../Server/Services/UserTotpAuthService";
import UserTwoFactorBackupCodeService from "../../../Server/Services/UserTwoFactorBackupCodeService";
import UserWebAuthnService from "../../../Server/Services/UserWebAuthnService";
import logger from "../../../Server/Utils/Logger";
import TwoFactorWrongCodes from "../../../Server/Utils/TwoFactorWrongCodes";
import User from "../../../Models/DatabaseModels/User";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import { MAGIC_LINK_EXPIRY_MINUTES } from "../../../Types/Accounts/MagicLink";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "../../../Types/Email";
import HashedString from "../../../Types/HashedString";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import Timezone from "../../../Types/Timezone";
import UserAuthenticationStatus from "../../../Types/UserAuthenticationStatus";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * ---------------------------------------------------------------------------
 * A NEW PASSWORD ENDS THE ACCOUNT'S SIGN-IN LINK AND ITS RESET LINK, HOWEVER IT
 * IS SET.
 *
 * Both links are bearer credentials found by their token's hash alone, and both
 * were sent because of the password the account had then. Neither can outlive
 * it:
 *
 *   - a sign-in link (Types/Accounts/MagicLink) stands in for the password:
 *     somebody who holds one when the owner changes their password would still
 *     get past the first step of signing in, for up to fifteen minutes, and -
 *     since the same change forgets the account's wrong two factor codes - with
 *     a fresh count of wrong codes to try;
 *   - a reset link sets a password outright: somebody who holds one when the
 *     owner changes their password would, for up to a day, be able to set
 *     another one and sign the owner out - the password change they made to
 *     keep that person out is what they would undo.
 *
 * A password changes four ways: the reset link's page, the profile page, a
 * master admin's Set Password, and an invited person claiming their account at
 * sign up. Only some of them are OneUptime writing as root; the profile page
 * writes as the person, and both links' columns are declared `update: []`, which
 * no person may write. So every test here runs the real update path - the real
 * permission checks, the real hooks, the real hash - over rows held in memory,
 * and a test of the hook alone would not do: a hook that adds these columns
 * before the column check runs ends the links in that test, and refuses
 * everybody's password change here.
 *
 * The same write against Postgres is UserMagicLinkPostgres.test.ts, and the
 * reset link's page, through its route, MagicLinkLogin.test.ts.
 * ---------------------------------------------------------------------------
 */

const USER_ID: ObjectID = new ObjectID("7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "8b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e",
);
const UNREACHED_USER_ID: ObjectID = new ObjectID(
  "9c3d4e5f-6a7b-4c8d-ae9f-1a2b3c4d5e6f",
);

const TOKEN: string = "0b1d6a5e-3c2f-4e7a-9b8c-1d2e3f4a5b6c";
const RESET_TOKEN: string = "2d3f8c7a-5e41-4a9c-9dae-3f4a5b6c7d8e";

const ONE_DAY_IN_MILLISECONDS: number = 24 * 60 * 60 * 1000;

const NEW_PASSWORD: string = "a brand new passphrase";

// An account's row, as Postgres would hold it.
type AccountRow = Record<string, unknown>;

let accounts: Array<AccountRow>;

let linkHash: string;
let resetLinkHash: string;

function accountRow(
  id: ObjectID,
  email: string,
  link: string,
  resetLink: string,
): AccountRow {
  return {
    _id: id.toString(),
    email: new Email(email),
    name: new Name("Ada Lovelace"),
    password: "the old password's hash",
    passwordSalt: "the old password's salt",
    isEmailVerified: true,
    timezone: null,
    resetPasswordToken: resetLink,
    resetPasswordExpires: new Date(Date.now() + ONE_DAY_IN_MILLISECONDS),
    magicLinkToken: link,
    magicLinkExpires: new Date(
      Date.now() + MAGIC_LINK_EXPIRY_MINUTES * 60 * 1000,
    ),
  };
}

function accountOf(id: ObjectID): AccountRow {
  return accounts.find((account: AccountRow): boolean => {
    return account["_id"] === id.toString();
  })!;
}

// Whether a term of a query holds for a value: a value, or the ids it names.
function holds(term: unknown, value: unknown): boolean {
  if (term instanceof FindOperator) {
    return Object.values(term.objectLiteralParameters || {})
      .flat()
      .map(String)
      .includes(String(value));
  }

  return String(term) === String(value);
}

function read(findBy: unknown): Array<User> {
  const options: {
    query: Record<string, unknown>;
    select: Record<string, unknown>;
  } = findBy as {
    query: Record<string, unknown>;
    select: Record<string, unknown>;
  };

  return accounts
    .filter((account: AccountRow): boolean => {
      return Object.keys(options.query).every((column: string): boolean => {
        return holds(options.query[column], account[column]);
      });
    })
    .map((account: AccountRow): User => {
      const user: User = new User();

      for (const column of Object.keys(options.select)) {
        if (options.select[column] && account[column] !== undefined) {
          (user as unknown as Record<string, unknown>)[column] =
            account[column];
        }
      }

      return user;
    });
}

// What happened, in order: each write, each end of sessions, each forgetting.
let order: Array<string>;

// Whether either of the account's links still worked when its sessions ended and its codes went.
let linkLiveAfterTheWrite: Array<boolean>;

let repositoryUpdate: jest.Mock;

interface RowWrite {
  criteria: Record<string, unknown>;
  values: Record<string, unknown>;
}

function writes(): Array<RowWrite> {
  return repositoryUpdate.mock.calls.map((call: Array<unknown>): RowWrite => {
    return {
      criteria: call[0] as Record<string, unknown>,
      values: call[1] as Record<string, unknown>,
    };
  });
}

function isLinkLive(id: ObjectID): boolean {
  const account: AccountRow = accountOf(id);

  return Boolean(account["magicLinkToken"] && account["magicLinkExpires"]);
}

function isResetLinkLive(id: ObjectID): boolean {
  const account: AccountRow = accountOf(id);

  return Boolean(
    account["resetPasswordToken"] && account["resetPasswordExpires"],
  );
}

// What POST /reset-password reads a link by: its token's hash, and nothing else.
async function accountTheResetLinkFinds(): Promise<User | null> {
  return await UserService.findOneBy({
    query: { resetPasswordToken: resetLinkHash },
    select: { _id: true },
    props: { isRoot: true },
  });
}

beforeEach(async () => {
  linkHash = await HashedString.hashValue(TOKEN, EncryptionSecret);
  resetLinkHash = await HashedString.hashValue(RESET_TOKEN, EncryptionSecret);

  accounts = [
    accountRow(USER_ID, "owner@example.com", linkHash, resetLinkHash),
    accountRow(
      OTHER_USER_ID,
      "other@example.com",
      "another account's link",
      "another account's reset link",
    ),
    {
      ...accountRow(
        UNREACHED_USER_ID,
        "unreached@example.com",
        "a third account's link",
        "a third account's reset link",
      ),
      isEmailVerified: false,
    },
  ];

  order = [];
  linkLiveAfterTheWrite = [];

  jest
    .spyOn(UserService as unknown as { _findBy: () => unknown }, "_findBy")
    .mockImplementation((async (findBy: unknown): Promise<Array<User>> => {
      return read(findBy);
    }) as never);

  repositoryUpdate = jest.fn(
    async (
      criteria: Record<string, unknown>,
      values: Record<string, unknown>,
    ): Promise<{ affected: number }> => {
      const account: AccountRow | undefined = accounts.find(
        (candidate: AccountRow): boolean => {
          return candidate["_id"] === String(criteria["_id"]);
        },
      );

      if (!account) {
        return { affected: 0 };
      }

      order.push(`write ${String(criteria["_id"])}`);
      Object.assign(account, values);

      return { affected: 1 };
    },
  ) as unknown as jest.Mock;

  jest
    .spyOn(UserService, "getRepository")
    .mockReturnValue({ update: repositoryUpdate } as never);

  jest
    .spyOn(UserSessionService, "revokeAllSessionsByUserId")
    .mockImplementation(async (userId: ObjectID): Promise<void> => {
      order.push(`end sessions ${userId.toString()}`);
      linkLiveAfterTheWrite.push(isLinkLive(userId) || isResetLinkLive(userId));
    });

  jest
    .spyOn(TwoFactorWrongCodes, "forget")
    .mockImplementation(async (userId: ObjectID): Promise<void> => {
      order.push(`forget wrong codes ${userId.toString()}`);
      linkLiveAfterTheWrite.push(isLinkLive(userId) || isResetLinkLive(userId));
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

  // What the writes that verify an address go on to read: no projects to set up.
  jest.spyOn(TeamMemberService, "findBy").mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function writeAs(
  props: DatabaseCommonInteractionProps,
  data: Record<string, unknown>,
): Promise<number> {
  return await UserService.updateOneById({
    id: USER_ID,
    data: data as never,
    props: props,
  });
}

function newPassword(): HashedString {
  return new HashedString(NEW_PASSWORD);
}

const WAYS_A_PASSWORD_CHANGES: Array<[string, () => Promise<unknown>]> = [
  [
    "the profile page, as the signed-in owner",
    (): Promise<unknown> => {
      return writeAs({ userId: USER_ID }, { password: newPassword() });
    },
  ],
  [
    "a master admin's Set Password",
    (): Promise<unknown> => {
      return UserService.setPassword({
        userId: USER_ID,
        password: NEW_PASSWORD,
      });
    },
  ],
  [
    "a master admin writing the account through the API",
    (): Promise<unknown> => {
      return writeAs({ isMasterAdmin: true }, { password: newPassword() });
    },
  ],
  [
    "OneUptime itself, as the reset link's page does",
    (): Promise<unknown> => {
      return writeAs({ isRoot: true }, { password: newPassword() });
    },
  ],
  [
    "an invited person claiming their account at sign up",
    (): Promise<unknown> => {
      return UserService.updateOneByIdAndFetch({
        id: USER_ID,
        data: {
          password: newPassword(),
          name: new Name("Ada Lovelace"),
          isEmailVerified: true,
        } as never,
        select: { email: true, _id: true },
        props: { isRoot: true },
      });
    },
  ],
];

describe("every way a password changes ends the sign-in link", () => {
  test.each(WAYS_A_PASSWORD_CHANGES)(
    "%s: the link ends, in the very write that sets the password",
    async (_name: string, changePassword: () => Promise<unknown>) => {
      await changePassword();

      expect(accountOf(USER_ID)["magicLinkToken"]).toBeNull();
      expect(accountOf(USER_ID)["magicLinkExpires"]).toBeNull();

      /*
       * One UPDATE, so there is no instant at which the new password is
       * stored and the link still signs in - and a link sent a moment before
       * the write is on the row for it to clear, whichever got there first.
       */
      expect(writes()).toHaveLength(1);
      expect(writes()[0]!.criteria["_id"]).toBe(USER_ID.toString());
      expect(writes()[0]!.values).toEqual(
        expect.objectContaining({
          password: expect.any(String),
          passwordSalt: expect.any(String),
          magicLinkToken: null,
          magicLinkExpires: null,
        }),
      );
      expect(writes()[0]!.values["password"]).not.toBe(NEW_PASSWORD);
    },
  );

  test.each(WAYS_A_PASSWORD_CHANGES)(
    "%s: the link no longer finds the account",
    async (_name: string, changePassword: () => Promise<unknown>) => {
      const select: { _id: true } = { _id: true };

      expect(
        (
          await UserService.findByMagicLinkToken({
            token: TOKEN,
            select: select,
          })
        )?.id?.toString(),
      ).toBe(USER_ID.toString());

      await changePassword();

      expect(
        await UserService.findByMagicLinkToken({
          token: TOKEN,
          select: select,
        }),
      ).toBeNull();
    },
  );

  test("the link is gone before the sessions end and the wrong codes are forgotten", async () => {
    /*
     * Forgetting the wrong codes is safe only once nothing is left to enter
     * more with: whoever entered them held the old password or the link.
     */
    await writeAs({ userId: USER_ID }, { password: newPassword() });

    expect(order).toEqual([
      `write ${USER_ID.toString()}`,
      `end sessions ${USER_ID.toString()}`,
      `forget wrong codes ${USER_ID.toString()}`,
    ]);
    expect(linkLiveAfterTheWrite).toEqual([false, false]);
  });

  test("a write that reaches several accounts ends the link of each, and of no other", async () => {
    await UserService.updateBy({
      query: { isEmailVerified: true },
      data: { password: newPassword() } as never,
      limit: 10,
      skip: 0,
      props: { isRoot: true },
    });

    expect(isLinkLive(USER_ID)).toBe(false);
    expect(isLinkLive(OTHER_USER_ID)).toBe(false);
    expect(isLinkLive(UNREACHED_USER_ID)).toBe(true);
  });

  test("an account with no link: the write is the same, and nothing is held against it", async () => {
    accountOf(USER_ID)["magicLinkToken"] = null;
    accountOf(USER_ID)["magicLinkExpires"] = null;

    await writeAs({ userId: USER_ID }, { password: newPassword() });

    expect(accountOf(USER_ID)["password"]).not.toBe("the old password's hash");
    expect(accountOf(USER_ID)["magicLinkToken"]).toBeNull();
  });
});

describe("every way a password changes ends the reset link", () => {
  test.each(WAYS_A_PASSWORD_CHANGES)(
    "%s: the reset link ends, in the very write that sets the password",
    async (_name: string, changePassword: () => Promise<unknown>) => {
      await changePassword();

      expect(accountOf(USER_ID)["resetPasswordToken"]).toBeNull();
      expect(accountOf(USER_ID)["resetPasswordExpires"]).toBeNull();

      /*
       * One UPDATE, so there is no instant at which the new password is
       * stored and the old link can still replace it - and a link sent a
       * moment before the write is on the row for it to clear.
       */
      expect(writes()).toHaveLength(1);
      expect(writes()[0]!.values).toEqual(
        expect.objectContaining({
          password: expect.any(String),
          resetPasswordToken: null,
          resetPasswordExpires: null,
        }),
      );
    },
  );

  test.each(WAYS_A_PASSWORD_CHANGES)(
    "%s: the reset link no longer finds the account",
    async (_name: string, changePassword: () => Promise<unknown>) => {
      expect((await accountTheResetLinkFinds())?.id?.toString()).toBe(
        USER_ID.toString(),
      );

      await changePassword();

      expect(await accountTheResetLinkFinds()).toBeNull();
    },
  );

  test("the owner's new password survives: the holder of the link has nothing left to replace it with", async () => {
    await writeAs({ userId: USER_ID }, { password: newPassword() });

    const passwordTheOwnerSet: unknown = accountOf(USER_ID)["password"];

    expect(await accountTheResetLinkFinds()).toBeNull();
    expect(accountOf(USER_ID)["password"]).toBe(passwordTheOwnerSet);
    expect(passwordTheOwnerSet).not.toBe("the old password's hash");
  });

  test("a write that reaches several accounts ends the reset link of each, and of no other", async () => {
    await UserService.updateBy({
      query: { isEmailVerified: true },
      data: { password: newPassword() } as never,
      limit: 10,
      skip: 0,
      props: { isRoot: true },
    });

    expect(isResetLinkLive(USER_ID)).toBe(false);
    expect(isResetLinkLive(OTHER_USER_ID)).toBe(false);
    expect(isResetLinkLive(UNREACHED_USER_ID)).toBe(true);
  });

  test("an account with no reset link: the write is the same, and nothing is held against it", async () => {
    accountOf(USER_ID)["resetPasswordToken"] = null;
    accountOf(USER_ID)["resetPasswordExpires"] = null;

    await writeAs({ userId: USER_ID }, { password: newPassword() });

    expect(accountOf(USER_ID)["password"]).not.toBe("the old password's hash");
    expect(accountOf(USER_ID)["resetPasswordToken"]).toBeNull();
  });

  test("a reset link asked for after the new password works: only the links sent before it end", async () => {
    await writeAs({ userId: USER_ID }, { password: newPassword() });

    await UserService.sendPasswordResetLink({ userId: USER_ID });

    expect(isResetLinkLive(USER_ID)).toBe(true);
    expect(accountOf(USER_ID)["resetPasswordToken"]).not.toBe(resetLinkHash);
    expect(accountOf(USER_ID)["password"]).not.toBe("the old password's hash");
  });

  test("the admin's Authentication page stops reporting a pending link", async () => {
    jest
      .spyOn(UserTotpAuthService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(UserWebAuthnService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest
      .spyOn(UserTwoFactorBackupCodeService, "countUnusedForUser")
      .mockResolvedValue(0);

    const before: UserAuthenticationStatus =
      await UserService.getAuthenticationStatus(USER_ID);

    await writeAs({ userId: USER_ID }, { password: newPassword() });

    const after: UserAuthenticationStatus =
      await UserService.getAuthenticationStatus(USER_ID);

    expect(before.hasPendingPasswordResetLink).toBe(true);
    expect(after.hasPendingPasswordResetLink).toBe(false);
  });
});

describe("only a new password ends it", () => {
  test.each([
    ["a new name", { name: new Name("Renamed") }],
    ["a time zone", { timezone: Timezone.EuropeLondon }],
  ])(
    "%s leaves both links working",
    async (_name: string, data: Record<string, unknown>) => {
      await writeAs({ userId: USER_ID }, data);

      expect(isLinkLive(USER_ID)).toBe(true);
      expect(isResetLinkLive(USER_ID)).toBe(true);
      expect(writes()).toHaveLength(1);
      expect(writes()[0]!.values).not.toHaveProperty("magicLinkToken");
      expect(writes()[0]!.values).not.toHaveProperty("magicLinkExpires");
      expect(writes()[0]!.values).not.toHaveProperty("resetPasswordToken");
      expect(writes()[0]!.values).not.toHaveProperty("resetPasswordExpires");
    },
  );

  test("a password write the database fails leaves both links with the old password", async () => {
    repositoryUpdate.mockImplementation(async (): Promise<never> => {
      throw new Error("connection lost");
    });

    await expect(
      writeAs({ userId: USER_ID }, { password: newPassword() }),
    ).rejects.toThrow("connection lost");

    expect(isLinkLive(USER_ID)).toBe(true);
    expect(isResetLinkLive(USER_ID)).toBe(true);
    expect(accountOf(USER_ID)["password"]).toBe("the old password's hash");
    expect(order).toEqual([]);
  });
});

describe("the links' columns stay OneUptime's to write", () => {
  test.each([
    [
      "store a link of their choosing",
      "magicLinkToken",
      { magicLinkToken: "chosen by them" },
    ],
    [
      "keep a link alive for longer",
      "magicLinkExpires",
      { magicLinkExpires: new Date(2031, 0, 1) },
    ],
    [
      "store a reset link of their choosing",
      "resetPasswordToken",
      { resetPasswordToken: "chosen by them" },
    ],
    [
      "keep a reset link alive for longer",
      "resetPasswordExpires",
      { resetPasswordExpires: new Date(2031, 0, 1) },
    ],
  ])(
    "the owner cannot %s by sending it with a new password: nothing is written",
    async (_name: string, column: string, sent: Record<string, unknown>) => {
      await expect(
        writeAs({ userId: USER_ID }, { password: newPassword(), ...sent }),
      ).rejects.toThrow(`User is not allowed to update on ${column} column`);

      expect(writes()).toHaveLength(0);
      expect(isLinkLive(USER_ID)).toBe(true);
      expect(isResetLinkLive(USER_ID)).toBe(true);
      expect(accountOf(USER_ID)["password"]).toBe("the old password's hash");
      expect(order).toEqual([]);
    },
  );

  test.each(["magicLinkToken", "resetPasswordToken"])(
    "the owner cannot end a link without a new password: %s",
    async (column: string) => {
      await expect(
        writeAs({ userId: USER_ID }, { [column]: null }),
      ).rejects.toThrow(`User is not allowed to update on ${column} column`);

      expect(writes()).toHaveLength(0);
      expect(isLinkLive(USER_ID)).toBe(true);
      expect(isResetLinkLive(USER_ID)).toBe(true);
    },
  );
});
