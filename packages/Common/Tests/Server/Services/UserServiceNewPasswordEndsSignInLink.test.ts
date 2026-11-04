import { EncryptionSecret } from "../../../Server/EnvironmentConfig";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import MailService from "../../../Server/Services/MailService";
import UserService from "../../../Server/Services/UserService";
import UserSessionService from "../../../Server/Services/UserSessionService";
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
import Timezone from "../../../Types/Timezone";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * ---------------------------------------------------------------------------
 * A NEW PASSWORD ENDS THE ACCOUNT'S SIGN-IN LINK, HOWEVER IT IS SET.
 *
 * A sign-in link (Types/Accounts/MagicLink) stands in for the password, so it
 * cannot outlive one: somebody who holds a link when the owner changes their
 * password would still get past the first step of signing in, for up to
 * fifteen minutes, and - since the same change forgets the account's wrong two
 * factor codes - with a fresh count of wrong codes to try.
 *
 * A password changes three ways: the reset link's page, the profile page and a
 * master admin's Set Password. Only the first of them is OneUptime writing as
 * root; the profile page writes as the person, and `magicLinkToken` is declared
 * `update: []`, which no person may write. So every test here runs the real
 * update path - the real permission checks, the real hooks, the real hash -
 * over rows held in memory, and a test of the hook alone would not do: a hook
 * that adds the link's columns before the column check runs ends the link in
 * that test, and refuses everybody's password change here.
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

const NEW_PASSWORD: string = "a brand new passphrase";

// An account's row, as Postgres would hold it.
type AccountRow = Record<string, unknown>;

let accounts: Array<AccountRow>;

let linkHash: string;

function accountRow(id: ObjectID, email: string, link: string): AccountRow {
  return {
    _id: id.toString(),
    email: new Email(email),
    name: new Name("Ada Lovelace"),
    password: "the old password's hash",
    passwordSalt: "the old password's salt",
    isEmailVerified: true,
    timezone: null,
    resetPasswordToken: null,
    resetPasswordExpires: null,
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

// Whether the account's link still worked when its sessions ended and its codes went.
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

beforeEach(async () => {
  linkHash = await HashedString.hashValue(TOKEN, EncryptionSecret);

  accounts = [
    accountRow(USER_ID, "owner@example.com", linkHash),
    accountRow(OTHER_USER_ID, "other@example.com", "another account's link"),
    {
      ...accountRow(
        UNREACHED_USER_ID,
        "unreached@example.com",
        "a third account's link",
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
      linkLiveAfterTheWrite.push(isLinkLive(userId));
    });

  jest
    .spyOn(TwoFactorWrongCodes, "forget")
    .mockImplementation(async (userId: ObjectID): Promise<void> => {
      order.push(`forget wrong codes ${userId.toString()}`);
      linkLiveAfterTheWrite.push(isLinkLive(userId));
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

describe("only a new password ends it", () => {
  test.each([
    ["a new name", { name: new Name("Renamed") }],
    ["a time zone", { timezone: Timezone.EuropeLondon }],
  ])(
    "%s leaves the link working",
    async (_name: string, data: Record<string, unknown>) => {
      await writeAs({ userId: USER_ID }, data);

      expect(isLinkLive(USER_ID)).toBe(true);
      expect(writes()).toHaveLength(1);
      expect(writes()[0]!.values).not.toHaveProperty("magicLinkToken");
      expect(writes()[0]!.values).not.toHaveProperty("magicLinkExpires");
    },
  );

  test("a password write the database fails leaves the link with the old password", async () => {
    repositoryUpdate.mockImplementation(async (): Promise<never> => {
      throw new Error("connection lost");
    });

    await expect(
      writeAs({ userId: USER_ID }, { password: newPassword() }),
    ).rejects.toThrow("connection lost");

    expect(isLinkLive(USER_ID)).toBe(true);
    expect(accountOf(USER_ID)["password"]).toBe("the old password's hash");
    expect(order).toEqual([]);
  });
});

describe("the link's columns stay OneUptime's to write", () => {
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
  ])(
    "the owner cannot %s by sending it with a new password: nothing is written",
    async (_name: string, column: string, sent: Record<string, unknown>) => {
      await expect(
        writeAs({ userId: USER_ID }, { password: newPassword(), ...sent }),
      ).rejects.toThrow(`User is not allowed to update on ${column} column`);

      expect(writes()).toHaveLength(0);
      expect(isLinkLive(USER_ID)).toBe(true);
      expect(accountOf(USER_ID)["password"]).toBe("the old password's hash");
      expect(order).toEqual([]);
    },
  );

  test("the owner cannot end a link without a new password", async () => {
    await expect(
      writeAs({ userId: USER_ID }, { magicLinkToken: null }),
    ).rejects.toThrow("User is not allowed to update on magicLinkToken column");

    expect(writes()).toHaveLength(0);
    expect(isLinkLive(USER_ID)).toBe(true);
  });
});
