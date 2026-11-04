import { EncryptionSecret } from "../../../Server/EnvironmentConfig";
import StatusPagePrivateUserService from "../../../Server/Services/StatusPagePrivateUserService";
import StatusPagePrivateUserSessionService, {
  SessionMetadata,
} from "../../../Server/Services/StatusPagePrivateUserSessionService";
import StatusPagePrivateUser from "../../../Models/DatabaseModels/StatusPagePrivateUser";
import StatusPagePrivateUserSession from "../../../Models/DatabaseModels/StatusPagePrivateUserSession";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "../../../Types/Email";
import HashedString from "../../../Types/HashedString";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * ---------------------------------------------------------------------------
 * A PRIVATE USER'S NEW PASSWORD ENDS WHAT WAS SENT AND SIGNED IN BEFORE IT,
 * HOWEVER IT IS SET.
 *
 * Somebody sets a new password because somebody else may have the old one, or
 * may be reading their mail. So when it is stored:
 *
 *   - their sign-in link (Types/StatusPage/StatusPageMagicLink) ends. It stands
 *     in for the password, and signs in outright for up to fifteen minutes;
 *   - their reset link ends. Whoever holds it could otherwise set another
 *     password, for up to a day, undoing this one;
 *   - their sessions end, and with them any SSO login code not yet exchanged.
 *     A session otherwise goes on for as long as it is used, and a page's reader
 *     who resets their password to lock somebody out has not locked them out.
 *
 * A private user's password changes two ways: their reset link's page, written
 * by OneUptime as root, and a teammate writing it through the API, whose
 * permissions do not reach the links' columns (update: []). So every test here
 * runs the real update path - the real permission checks, the real hooks, the
 * real hash - over rows held in memory, and a test of the hooks alone would not
 * do: hooks that added these columns before the column check ran would end the
 * links in that test, and refuse the teammate's write here.
 *
 * The same writes against Postgres are
 * StatusPagePrivateUserMagicLinkPostgres.test.ts, and the reset link's page,
 * through its route, is StatusPageNewPassword.test.ts in App.
 * ---------------------------------------------------------------------------
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "56000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "56000000-0000-4000-8000-000000000002",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "56000000-0000-4000-8000-000000000100",
);
const USER_ID: ObjectID = new ObjectID("56000000-0000-4000-8000-0000000000aa");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "56000000-0000-4000-8000-0000000000bb",
);
const UNREACHED_USER_ID: ObjectID = new ObjectID(
  "56000000-0000-4000-8000-0000000000cc",
);
const TEAMMATE_ID: ObjectID = new ObjectID(
  "56000000-0000-4000-8000-0000000000dd",
);

const LINK_TOKEN: string = "6f1c7e4a-2b3d-4c5e-8f90-a1b2c3d4e5f6";
const RESET_TOKEN: string = "7a2d8f5b-3c4e-4d6f-9a01-b2c3d4e5f6a7";
const REFRESH_TOKEN: string = "8b3e9a6c-4d5f-4e7a-ab12-c3d4e5f6a7b8";
const LOGIN_CODE: string = "9c4fab7d-5e6a-4f8b-bc23-d4e5f6a7b8c9";

const ONE_DAY_IN_MILLISECONDS: number = 24 * 60 * 60 * 1000;
const FIFTEEN_MINUTES_IN_MILLISECONDS: number = 15 * 60 * 1000;

const NEW_PASSWORD: string = "a brand new passphrase";

const LOGIN_CODE_PURPOSE: Record<string, string> = {
  oneuptimeStatusPageSessionPurpose: "login-code",
};

// A row of either table, as Postgres would hold it.
type Row = Record<string, unknown>;

let users: Array<Row>;
let sessions: Array<Row>;

let linkHash: string;
let resetLinkHash: string;
let refreshTokenHash: string;

// What happened, in order: each write to either table.
let order: Array<string>;

// Whether either of the reader's links still worked when their sessions began to end.
let linkLiveAsSessionsEnded: Array<boolean>;

let userWrites: jest.Mock;
let sessionWrites: jest.Mock;

function userRow(
  id: ObjectID,
  email: string,
  link: string,
  resetLink: string,
): Row {
  return {
    _id: id.toString(),
    projectId: PROJECT_ID.toString(),
    statusPageId: STATUS_PAGE_ID.toString(),
    email: new Email(email),
    password: "the old password's hash",
    passwordSalt: "the old password's salt",
    isSsoUser: false,
    resetPasswordToken: resetLink,
    resetPasswordExpires: new Date(Date.now() + ONE_DAY_IN_MILLISECONDS),
    magicLinkToken: link,
    magicLinkExpires: new Date(Date.now() + FIFTEEN_MINUTES_IN_MILLISECONDS),
    deletedAt: null,
  };
}

function sessionRow(
  id: string,
  userId: ObjectID,
  refreshToken: string,
  extra: Row = {},
): Row {
  return {
    _id: id,
    projectId: PROJECT_ID.toString(),
    statusPageId: STATUS_PAGE_ID.toString(),
    statusPagePrivateUserId: userId.toString(),
    refreshToken: refreshToken,
    refreshTokenExpiresAt: new Date(Date.now() + ONE_DAY_IN_MILLISECONDS),
    isRevoked: false,
    revokedAt: null,
    revokedReason: null,
    additionalInfo: {},
    ...extra,
  };
}

function userOf(id: ObjectID): Row {
  return users.find((user: Row): boolean => {
    return user["_id"] === id.toString();
  })!;
}

function sessionsOf(id: ObjectID): Array<Row> {
  return sessions.filter((session: Row): boolean => {
    return session["statusPagePrivateUserId"] === id.toString();
  });
}

function isSignInLinkLive(id: ObjectID): boolean {
  const user: Row = userOf(id);

  return Boolean(user["magicLinkToken"] && user["magicLinkExpires"]);
}

function isResetLinkLive(id: ObjectID): boolean {
  const user: Row = userOf(id);

  return Boolean(user["resetPasswordToken"] && user["resetPasswordExpires"]);
}

// Whether a term of a query holds for a value: a value, or the ids it names.
function holds(term: unknown, value: unknown): boolean {
  if (term instanceof FindOperator) {
    return Object.values(term.objectLiteralParameters || {})
      .flat()
      .map(String)
      .includes(String(value));
  }

  if (typeof term === "boolean" || term === null) {
    return term === value;
  }

  return String(term) === String(value);
}

function read<TModel>(
  rows: () => Array<Row>,
  model: new () => TModel,
): (findBy: unknown) => Promise<Array<TModel>> {
  return async (findBy: unknown): Promise<Array<TModel>> => {
    const options: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
    } = findBy as {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
    };

    return rows()
      .filter((row: Row): boolean => {
        return (
          !row["deletedAt"] &&
          Object.keys(options.query).every((column: string): boolean => {
            return holds(options.query[column], row[column]);
          })
        );
      })
      .map((row: Row): TModel => {
        const item: TModel = new model();

        for (const column of Object.keys(options.select)) {
          if (options.select[column] && row[column] !== undefined) {
            (item as unknown as Record<string, unknown>)[column] = row[column];
          }
        }

        return item;
      });
  };
}

function writer(
  name: string,
  rows: () => Array<Row>,
  onWrite?: (row: Row) => void,
): jest.Mock {
  return jest.fn(
    async (
      criteria: Record<string, unknown>,
      values: Record<string, unknown>,
    ): Promise<{ affected: number }> => {
      const row: Row | undefined = rows().find((candidate: Row): boolean => {
        return Object.keys(criteria).every((column: string): boolean => {
          const term: unknown = criteria[column];

          // The spending write's own predicate: its operators are checked in the link's suite.
          return term instanceof FindOperator
            ? true
            : holds(term, candidate[column]);
        });
      });

      if (!row) {
        return { affected: 0 };
      }

      onWrite?.(row);
      order.push(`${name} ${String(row["_id"])}`);
      Object.assign(row, values);

      return { affected: 1 };
    },
  ) as unknown as jest.Mock;
}

function teammate(projectId: ObjectID): DatabaseCommonInteractionProps {
  return {
    userId: TEAMMATE_ID,
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: projectId,
        permissions: [
          {
            _type: "UserPermission",
            permission: Permission.ProjectMember,
            labelIds: [],
            isBlockPermission: false,
          } as UserPermission,
        ],
      },
    },
  };
}

function newPassword(): HashedString {
  return new HashedString(NEW_PASSWORD);
}

beforeEach(async () => {
  linkHash = await HashedString.hashValue(LINK_TOKEN, EncryptionSecret);
  resetLinkHash = await HashedString.hashValue(RESET_TOKEN, EncryptionSecret);
  refreshTokenHash = await HashedString.hashValue(
    REFRESH_TOKEN,
    EncryptionSecret,
  );

  users = [
    userRow(USER_ID, "reader@example.com", linkHash, resetLinkHash),
    userRow(
      OTHER_USER_ID,
      "other@example.com",
      "another reader's link",
      "another reader's reset link",
    ),
    {
      ...userRow(
        UNREACHED_USER_ID,
        "unreached@example.com",
        "a third reader's link",
        "a third reader's reset link",
      ),
      email: new Email("unreached@elsewhere.example.com"),
    },
  ];

  sessions = [
    sessionRow(
      "56000000-0000-4000-8000-0000000001a1",
      USER_ID,
      refreshTokenHash,
    ),
    sessionRow(
      "56000000-0000-4000-8000-0000000001a2",
      USER_ID,
      "the reader's session on another device",
    ),
    sessionRow(
      "56000000-0000-4000-8000-0000000001a3",
      USER_ID,
      await HashedString.hashValue(LOGIN_CODE, EncryptionSecret),
      { additionalInfo: LOGIN_CODE_PURPOSE },
    ),
    sessionRow(
      "56000000-0000-4000-8000-0000000001b1",
      OTHER_USER_ID,
      "another reader's session",
    ),
    sessionRow(
      "56000000-0000-4000-8000-0000000001c1",
      UNREACHED_USER_ID,
      "a third reader's session",
    ),
  ];

  order = [];
  linkLiveAsSessionsEnded = [];

  jest
    .spyOn(
      StatusPagePrivateUserService as unknown as { _findBy: () => unknown },
      "_findBy",
    )
    .mockImplementation(
      read((): Array<Row> => {
        return users;
      }, StatusPagePrivateUser) as never,
    );

  jest
    .spyOn(
      StatusPagePrivateUserSessionService as unknown as {
        _findBy: () => unknown;
      },
      "_findBy",
    )
    .mockImplementation(
      read((): Array<Row> => {
        return sessions;
      }, StatusPagePrivateUserSession) as never,
    );

  userWrites = writer("write user", (): Array<Row> => {
    return users;
  });

  sessionWrites = writer(
    "end session",
    (): Array<Row> => {
      return sessions;
    },
    (session: Row): void => {
      const userId: ObjectID = new ObjectID(
        session["statusPagePrivateUserId"] as string,
      );

      linkLiveAsSessionsEnded.push(
        isSignInLinkLive(userId) || isResetLinkLive(userId),
      );
    },
  );

  jest
    .spyOn(StatusPagePrivateUserService, "getRepository")
    .mockReturnValue({ update: userWrites } as never);

  jest
    .spyOn(StatusPagePrivateUserSessionService, "getRepository")
    .mockReturnValue({ update: sessionWrites } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

interface RowWrite {
  criteria: Record<string, unknown>;
  values: Record<string, unknown>;
}

function writesTo(mock: jest.Mock): Array<RowWrite> {
  return mock.mock.calls.map((call: Array<unknown>): RowWrite => {
    return {
      criteria: call[0] as Record<string, unknown>,
      values: call[1] as Record<string, unknown>,
    };
  });
}

async function writeAs(
  props: DatabaseCommonInteractionProps,
  data: Record<string, unknown>,
): Promise<number> {
  return await StatusPagePrivateUserService.updateOneById({
    id: USER_ID,
    data: data as never,
    props: props,
  });
}

// What POST /status-page-api/reset-password reads a link by: its hash and the page.
async function readerTheResetLinkFinds(): Promise<StatusPagePrivateUser | null> {
  return await StatusPagePrivateUserService.findOneBy({
    query: { statusPageId: STATUS_PAGE_ID, resetPasswordToken: resetLinkHash },
    select: { _id: true },
    props: { isRoot: true },
  });
}

const WAYS_A_PASSWORD_CHANGES: Array<[string, () => Promise<unknown>]> = [
  [
    "their reset link's page, as the route writes it",
    (): Promise<unknown> => {
      return writeAs(
        { isRoot: true },
        {
          password: newPassword(),
          resetPasswordToken: null,
          resetPasswordExpires: null,
        },
      );
    },
  ],
  [
    "a teammate through the API, who may not write the links' columns",
    (): Promise<unknown> => {
      return writeAs(teammate(PROJECT_ID), { password: newPassword() });
    },
  ],
  [
    "OneUptime itself, with nothing else in the write",
    (): Promise<unknown> => {
      return writeAs({ isRoot: true }, { password: newPassword() });
    },
  ],
];

describe("every way a private user's password changes", () => {
  test.each(WAYS_A_PASSWORD_CHANGES)(
    "%s: both links end, in the very write that sets the password",
    async (_name: string, changePassword: () => Promise<unknown>) => {
      await changePassword();

      expect(userOf(USER_ID)["magicLinkToken"]).toBeNull();
      expect(userOf(USER_ID)["magicLinkExpires"]).toBeNull();
      expect(userOf(USER_ID)["resetPasswordToken"]).toBeNull();
      expect(userOf(USER_ID)["resetPasswordExpires"]).toBeNull();

      /*
       * One UPDATE, so there is no instant at which the new password is stored
       * and a link still works - and a link sent a moment before the write is
       * on the row for it to clear, whichever got there first.
       */
      expect(writesTo(userWrites)).toHaveLength(1);
      expect(writesTo(userWrites)[0]!.criteria["_id"]).toBe(USER_ID.toString());
      expect(writesTo(userWrites)[0]!.values).toEqual(
        expect.objectContaining({
          password: expect.any(String),
          passwordSalt: expect.any(String),
          magicLinkToken: null,
          magicLinkExpires: null,
          resetPasswordToken: null,
          resetPasswordExpires: null,
        }),
      );
      expect(writesTo(userWrites)[0]!.values["password"]).not.toBe(
        NEW_PASSWORD,
      );
    },
  );

  test.each(WAYS_A_PASSWORD_CHANGES)(
    "%s: neither link finds the reader any more",
    async (_name: string, changePassword: () => Promise<unknown>) => {
      expect((await readerTheResetLinkFinds())?.id?.toString()).toBe(
        USER_ID.toString(),
      );

      await changePassword();

      expect(await readerTheResetLinkFinds()).toBeNull();
      expect(
        await StatusPagePrivateUserService.consumeMagicLinkToken({
          statusPageId: STATUS_PAGE_ID,
          token: LINK_TOKEN,
        }),
      ).toBeNull();
    },
  );

  test.each(WAYS_A_PASSWORD_CHANGES)(
    "%s: every session of theirs ends, saying why, and no other reader's",
    async (_name: string, changePassword: () => Promise<unknown>) => {
      await changePassword();

      for (const session of sessionsOf(USER_ID)) {
        expect(session["isRevoked"]).toBe(true);
        expect(session["revokedAt"]).toBeInstanceOf(Date);
        expect(session["revokedReason"]).toBe("Password changed");
      }

      for (const session of [
        ...sessionsOf(OTHER_USER_ID),
        ...sessionsOf(UNREACHED_USER_ID),
      ]) {
        expect(session["isRevoked"]).toBe(false);
      }
    },
  );

  test.each(WAYS_A_PASSWORD_CHANGES)(
    "%s: a session no longer renews",
    async (_name: string, changePassword: () => Promise<unknown>) => {
      expect(
        await StatusPagePrivateUserSessionService.findActiveSessionByRefreshToken(
          REFRESH_TOKEN,
        ),
      ).not.toBeNull();

      await changePassword();

      expect(
        await StatusPagePrivateUserSessionService.findActiveSessionByRefreshToken(
          REFRESH_TOKEN,
        ),
      ).toBeNull();
    },
  );

  test.each(WAYS_A_PASSWORD_CHANGES)(
    "%s: an SSO login code not yet exchanged no longer signs in",
    async (_name: string, changePassword: () => Promise<unknown>) => {
      await changePassword();

      const exchanged: SessionMetadata | null =
        await StatusPagePrivateUserSessionService.exchangeLoginCode(
          LOGIN_CODE,
          { statusPageId: STATUS_PAGE_ID },
        );

      expect(exchanged).toBeNull();
    },
  );

  test("the links are gone before the sessions start to end", async () => {
    await writeAs(teammate(PROJECT_ID), { password: newPassword() });

    expect(order[0]).toBe(`write user ${USER_ID.toString()}`);
    expect(order.slice(1).sort()).toEqual(
      sessionsOf(USER_ID)
        .map((session: Row): string => {
          return `end session ${String(session["_id"])}`;
        })
        .sort(),
    );
    expect(linkLiveAsSessionsEnded).toEqual([false, false, false]);
  });

  test("a session that already ended keeps when and why it did", async () => {
    const ended: Row = sessionsOf(USER_ID)[1]!;
    const endedAt: Date = new Date("2026-01-01T00:00:00.000Z");

    ended["isRevoked"] = true;
    ended["revokedAt"] = endedAt;
    ended["revokedReason"] = "User logged out";

    await writeAs({ isRoot: true }, { password: newPassword() });

    expect(ended["revokedAt"]).toBe(endedAt);
    expect(ended["revokedReason"]).toBe("User logged out");
    expect(sessionsOf(USER_ID)[0]!["revokedReason"]).toBe("Password changed");
  });

  test("a write that reaches several readers ends the links and sessions of each, and of no other", async () => {
    await StatusPagePrivateUserService.updateBy({
      query: { email: new Email("reader@example.com") },
      data: { password: newPassword() } as never,
      limit: 10,
      skip: 0,
      props: { isRoot: true },
    });

    await StatusPagePrivateUserService.updateBy({
      query: { email: new Email("other@example.com") },
      data: { password: newPassword() } as never,
      limit: 10,
      skip: 0,
      props: { isRoot: true },
    });

    for (const id of [USER_ID, OTHER_USER_ID]) {
      expect(isSignInLinkLive(id)).toBe(false);
      expect(isResetLinkLive(id)).toBe(false);
      expect(
        sessionsOf(id).every((session: Row): boolean => {
          return session["isRevoked"] === true;
        }),
      ).toBe(true);
    }

    expect(isSignInLinkLive(UNREACHED_USER_ID)).toBe(true);
    expect(isResetLinkLive(UNREACHED_USER_ID)).toBe(true);
    expect(sessionsOf(UNREACHED_USER_ID)[0]!["isRevoked"]).toBe(false);
  });

  test("a reader with no links and no sessions: the write is the same, and nothing is held against it", async () => {
    userOf(USER_ID)["magicLinkToken"] = null;
    userOf(USER_ID)["magicLinkExpires"] = null;
    userOf(USER_ID)["resetPasswordToken"] = null;
    userOf(USER_ID)["resetPasswordExpires"] = null;
    sessions = sessions.filter((session: Row): boolean => {
      return session["statusPagePrivateUserId"] !== USER_ID.toString();
    });

    expect(await writeAs({ isRoot: true }, { password: newPassword() })).toBe(
      1,
    );

    expect(userOf(USER_ID)["password"]).not.toBe("the old password's hash");
    expect(writesTo(sessionWrites)).toHaveLength(0);
  });

  test("links asked for after the new password work: only what came before it ends", async () => {
    await writeAs({ isRoot: true }, { password: newPassword() });

    userOf(USER_ID)["magicLinkToken"] = linkHash;
    userOf(USER_ID)["magicLinkExpires"] = new Date(
      Date.now() + FIFTEEN_MINUTES_IN_MILLISECONDS,
    );

    const signedIn: StatusPagePrivateUser | null =
      await StatusPagePrivateUserService.consumeMagicLinkToken({
        statusPageId: STATUS_PAGE_ID,
        token: LINK_TOKEN,
      });

    expect(signedIn?.id?.toString()).toBe(USER_ID.toString());
  });
});

describe("only a new password does", () => {
  test("a new email address ends the links, as it did, and leaves the sessions", async () => {
    await writeAs(teammate(PROJECT_ID), {
      email: new Email("moved@example.com"),
    });

    expect(isSignInLinkLive(USER_ID)).toBe(false);
    expect(isResetLinkLive(USER_ID)).toBe(false);
    expect(
      sessionsOf(USER_ID).every((session: Row): boolean => {
        return session["isRevoked"] === false;
      }),
    ).toBe(true);
  });

  test("the same email address again leaves the links and the sessions", async () => {
    await writeAs(teammate(PROJECT_ID), {
      email: new Email("reader@example.com"),
    });

    expect(isSignInLinkLive(USER_ID)).toBe(true);
    expect(isResetLinkLive(USER_ID)).toBe(true);
    expect(
      sessionsOf(USER_ID).every((session: Row): boolean => {
        return session["isRevoked"] === false;
      }),
    ).toBe(true);
    expect(writesTo(userWrites)[0]!.values).not.toHaveProperty(
      "magicLinkToken",
    );
    expect(writesTo(userWrites)[0]!.values).not.toHaveProperty(
      "resetPasswordToken",
    );
  });

  test("a password write the database fails leaves the links and sessions with the old password", async () => {
    userWrites.mockImplementation(async (): Promise<never> => {
      throw new Error("connection lost");
    });

    await expect(
      writeAs({ isRoot: true }, { password: newPassword() }),
    ).rejects.toThrow("connection lost");

    expect(isSignInLinkLive(USER_ID)).toBe(true);
    expect(isResetLinkLive(USER_ID)).toBe(true);
    expect(userOf(USER_ID)["password"]).toBe("the old password's hash");
    expect(writesTo(sessionWrites)).toHaveLength(0);
  });

  test("a teammate of another project writes nothing, and ends nothing", async () => {
    await writeAs(teammate(OTHER_PROJECT_ID), {
      password: newPassword(),
    }).catch(() => {
      // Refused or a write of no rows: either way, nothing may change.
    });

    expect(writesTo(userWrites)).toHaveLength(0);
    expect(writesTo(sessionWrites)).toHaveLength(0);
    expect(userOf(USER_ID)["password"]).toBe("the old password's hash");
    expect(isSignInLinkLive(USER_ID)).toBe(true);
    expect(isResetLinkLive(USER_ID)).toBe(true);
  });
});

describe("the links' columns stay OneUptime's to write", () => {
  test.each([
    [
      "store a sign-in link of their choosing",
      "magicLinkToken",
      { magicLinkToken: "chosen by them" },
    ],
    [
      "keep a sign-in link alive for longer",
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
    "a teammate cannot %s by sending it with a new password: nothing is written",
    async (_name: string, column: string, sent: Record<string, unknown>) => {
      await expect(
        writeAs(teammate(PROJECT_ID), { password: newPassword(), ...sent }),
      ).rejects.toThrow(`User is not allowed to update on ${column} column`);

      expect(writesTo(userWrites)).toHaveLength(0);
      expect(writesTo(sessionWrites)).toHaveLength(0);
      expect(isSignInLinkLive(USER_ID)).toBe(true);
      expect(isResetLinkLive(USER_ID)).toBe(true);
      expect(userOf(USER_ID)["password"]).toBe("the old password's hash");
    },
  );

  test.each(["magicLinkToken", "resetPasswordToken"])(
    "a teammate cannot end a link without a new password: %s",
    async (column: string) => {
      await expect(
        writeAs(teammate(PROJECT_ID), { [column]: null }),
      ).rejects.toThrow(`User is not allowed to update on ${column} column`);

      expect(writesTo(userWrites)).toHaveLength(0);
      expect(isSignInLinkLive(USER_ID)).toBe(true);
      expect(isResetLinkLive(USER_ID)).toBe(true);
    },
  );
});
