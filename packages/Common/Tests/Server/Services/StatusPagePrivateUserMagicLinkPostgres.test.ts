import Entities from "../../../Models/DatabaseModels/Index";
import StatusPagePrivateUser from "../../../Models/DatabaseModels/StatusPagePrivateUser";
import { EncryptionSecret } from "../../../Server/EnvironmentConfig";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import StatusPagePrivateUserService from "../../../Server/Services/StatusPagePrivateUserService";
import StatusPagePrivateUserSessionService from "../../../Server/Services/StatusPagePrivateUserSessionService";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "../../../Types/Email";
import HashedString from "../../../Types/HashedString";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import { DataSource } from "typeorm";

/*
 * A PRIVATE STATUS PAGE'S SIGN-IN LINKS, AGAINST POSTGRES
 * (StatusPagePrivateUserService.consumeMagicLinkToken, the
 * AddStatusPageMagicLinkLogin migration).
 *
 * Opt in with RUN_POSTGRES_STATUS_PAGE_MAGIC_LINK_TESTS=true against a
 * database the migrations have run on (STATUS_PAGE_MAGIC_LINK_TEST_DATABASE_*).
 * The real tables are cloned into an isolated schema; nothing else is
 * touched.
 *
 *   - a link signs in once: the row no longer holds it afterwards, and the
 *     same link again finds nothing;
 *   - many requests racing with one link: exactly one signs in;
 *   - an expired link, a link of another page, a link of a removed user and
 *     a token that is not the link sign nobody in, and spend nothing;
 *   - a newer link replaces the older one;
 *   - every status page takes links unless its team turns them off - the
 *     ones made before the column too - and no private user holds a link
 *     until one is asked for;
 *   - a new password ends the reader's sign-in link and reset link, in the write
 *     that stores it, and every session of theirs, whoever sets it, through the
 *     real update path - and no other reader's, and what is asked for or signed
 *     in afterwards works.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_STATUS_PAGE_MAGIC_LINK_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "StatusPage",
  "StatusPagePrivateUser",
  "StatusPagePrivateUserSession",
];

describePostgres("status page sign-in links against Postgres", () => {
  const schema: string = `status_page_magic_link_test_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  const projectId: ObjectID = ObjectID.generate();
  const statusPageId: ObjectID = ObjectID.generate();
  const otherStatusPageId: ObjectID = ObjectID.generate();
  const userId: ObjectID = ObjectID.generate();
  const token: string = "0b1d6a5e-3c2f-4e7a-9b8c-1d2e3f4a5b6c";
  let database: DataSource;

  const query: (sql: string, parameters?: Array<unknown>) => Promise<any> = (
    sql: string,
    parameters?: Array<unknown>,
  ): Promise<any> => {
    return database.query(sql, parameters);
  };

  const hashOf: (value: string) => Promise<string> = async (
    value: string,
  ): Promise<string> => {
    return await HashedString.hashValue(value, EncryptionSecret);
  };

  // The user's stored link: the hash of `value`, live for `minutes` (negative: expired).
  const storeLink: (value: string, minutes: number) => Promise<void> = async (
    value: string,
    minutes: number,
  ): Promise<void> => {
    await query(
      `UPDATE "${schema}"."StatusPagePrivateUser" SET "magicLinkToken" = $1, "magicLinkExpires" = NOW() + make_interval(mins => $2) WHERE "_id" = $3`,
      [await hashOf(value), minutes, userId.toString()],
    );
  };

  const storedRow: () => Promise<{
    magicLinkToken: string | null;
    magicLinkExpires: Date | null;
  }> = async (): Promise<{
    magicLinkToken: string | null;
    magicLinkExpires: Date | null;
  }> => {
    const rows: Array<{
      magicLinkToken: string | null;
      magicLinkExpires: Date | null;
    }> = await query(
      `SELECT "magicLinkToken", "magicLinkExpires" FROM "${schema}"."StatusPagePrivateUser" WHERE "_id" = $1`,
      [userId.toString()],
    );

    return rows[0]!;
  };

  const consume: (
    value: string,
    pageId?: ObjectID,
  ) => Promise<StatusPagePrivateUser | null> = async (
    value: string,
    pageId?: ObjectID,
  ): Promise<StatusPagePrivateUser | null> => {
    return await StatusPagePrivateUserService.consumeMagicLinkToken({
      statusPageId: pageId || statusPageId,
      token: value,
    });
  };

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["STATUS_PAGE_MAGIC_LINK_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["STATUS_PAGE_MAGIC_LINK_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["STATUS_PAGE_MAGIC_LINK_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await query(`CREATE SCHEMA "${schema}"`);

    for (const table of TABLES) {
      await query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
  });

  beforeEach(async () => {
    await query(
      `TRUNCATE ${TABLES.map((table: string): string => {
        return `"${schema}"."${table}"`;
      }).join(", ")}`,
    );

    // Neither row names the new columns: what they hold is the migration's.
    await query(
      `INSERT INTO "${schema}"."StatusPage" ("_id", "projectId", "name", "slug", "version") VALUES ($1, $2, 'Synthetic', 'synthetic', 1), ($3, $2, 'Other', 'other', 1)`,
      [
        statusPageId.toString(),
        projectId.toString(),
        otherStatusPageId.toString(),
      ],
    );
    await query(
      `INSERT INTO "${schema}"."StatusPagePrivateUser" ("_id", "projectId", "statusPageId", "email", "version") VALUES ($1, $2, $3, 'reader@example.com', 1)`,
      [userId.toString(), projectId.toString(), statusPageId.toString()],
    );
  });

  afterAll(async () => {
    jest.restoreAllMocks();

    if (database?.isInitialized) {
      await query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  test("every status page takes sign-in links until its team turns them off, and no reader holds a link until one is asked for", async () => {
    const pages: Array<{ enableMagicLinkLogin: boolean }> = await query(
      `SELECT "enableMagicLinkLogin" FROM "${schema}"."StatusPage"`,
    );

    expect(pages).toEqual([
      { enableMagicLinkLogin: true },
      { enableMagicLinkLogin: true },
    ]);
    expect(await storedRow()).toEqual({
      magicLinkToken: null,
      magicLinkExpires: null,
    });
  });

  test("a live link signs its reader in once, and the row no longer holds it", async () => {
    await storeLink(token, 15);

    const user: StatusPagePrivateUser | null = await consume(token);

    expect(user?.id?.toString()).toBe(userId.toString());
    expect(user?.email?.toString()).toBe("reader@example.com");
    expect(user?.statusPageId?.toString()).toBe(statusPageId.toString());
    expect(user?.projectId?.toString()).toBe(projectId.toString());
    expect(await storedRow()).toEqual({
      magicLinkToken: null,
      magicLinkExpires: null,
    });

    expect(await consume(token)).toBeNull();
  });

  test("many requests racing with one link: exactly one signs in", async () => {
    await storeLink(token, 15);

    const results: Array<StatusPagePrivateUser | null> = await Promise.all(
      Array.from({ length: 8 }, () => {
        return consume(token);
      }),
    );

    expect(
      results.filter((result: StatusPagePrivateUser | null): boolean => {
        return result !== null;
      }),
    ).toHaveLength(1);
    expect((await storedRow()).magicLinkToken).toBeNull();
  });

  test("an expired link signs nobody in, and is left as it was", async () => {
    await storeLink(token, -1);

    expect(await consume(token)).toBeNull();
    expect((await storedRow()).magicLinkToken).toBe(await hashOf(token));
  });

  test("a link signs nobody in on another status page", async () => {
    await storeLink(token, 15);

    expect(await consume(token, otherStatusPageId)).toBeNull();
    expect((await storedRow()).magicLinkToken).toBe(await hashOf(token));

    // And still works on its own.
    expect(await consume(token)).not.toBeNull();
  });

  test("a removed reader's link signs nobody in", async () => {
    await storeLink(token, 15);
    await query(
      `UPDATE "${schema}"."StatusPagePrivateUser" SET "deletedAt" = NOW() WHERE "_id" = $1`,
      [userId.toString()],
    );

    expect(await consume(token)).toBeNull();
  });

  test("a token that is not the link signs nobody in, and spends nothing", async () => {
    await storeLink(token, 15);

    expect(await consume("0b1d6a5e-3c2f-4e7a-9b8c-1d2e3f4a5b6d")).toBeNull();
    expect(await consume(token.toUpperCase())).toBeNull();
    expect((await storedRow()).magicLinkToken).toBe(await hashOf(token));
  });

  test("a newer link replaces the older one", async () => {
    const newer: string = "7c9e2a1b-4d3f-4a5b-8c6d-0e1f2a3b4c5d";

    await storeLink(token, 15);
    await storeLink(newer, 15);

    expect(await consume(token)).toBeNull();
    expect(await consume(newer)).not.toBeNull();
  });

  describe("a new password", () => {
    const otherUserId: ObjectID = ObjectID.generate();
    const otherToken: string = "3e4f9d8b-6f52-4bad-8ebf-4a5b6c7d8e9f";
    const resetToken: string = "4f5a0e9c-7a63-4cbe-9fca-5b6c7d8e9fa0";
    const otherResetToken: string = "5a6b1fad-8b74-4dcf-afdb-6c7d8e9fa0b1";
    const refreshToken: string = "6b7c20be-9c85-4ed0-b0ec-7d8e9fa0b1c2";
    const otherRefreshToken: string = "7c8d31cf-ad96-4fe1-81fd-8e9fa0b1c2d3";
    const loginCode: string = "8d9e42d0-bea7-40f2-920e-9fa0b1c2d3e4";
    const newPassword: string = "a brand new passphrase";

    const teammateProps: () => DatabaseCommonInteractionProps =
      (): DatabaseCommonInteractionProps => {
        return {
          userId: ObjectID.generate(),
          tenantId: projectId,
          userTenantAccessPermission: {
            [projectId.toString()]: {
              _type: "UserTenantAccessPermission",
              projectId: projectId,
              permissions: [
                {
                  _type: "UserPermission",
                  permission: Permission.StatusPageMember,
                  labelIds: [],
                  isBlockPermission: false,
                } as UserPermission,
              ],
            },
          },
        };
      };

    const write: (
      props: DatabaseCommonInteractionProps,
      data: Record<string, unknown>,
    ) => Promise<number> = async (
      props: DatabaseCommonInteractionProps,
      data: Record<string, unknown>,
    ): Promise<number> => {
      return await StatusPagePrivateUserService.updateOneById({
        id: userId,
        data: data as never,
        props: props,
      });
    };

    const storeLinks: (
      readerId: ObjectID,
      link: string,
      reset: string,
    ) => Promise<void> = async (
      readerId: ObjectID,
      link: string,
      reset: string,
    ): Promise<void> => {
      await query(
        `UPDATE "${schema}"."StatusPagePrivateUser" SET "magicLinkToken" = $1, "magicLinkExpires" = NOW() + interval '15 minutes', "resetPasswordToken" = $2, "resetPasswordExpires" = NOW() + interval '1 day' WHERE "_id" = $3`,
        [await hashOf(link), await hashOf(reset), readerId.toString()],
      );
    };

    interface StoredReader {
      password: string | null;
      passwordSalt: string | null;
      magicLinkToken: string | null;
      magicLinkExpires: Date | null;
      resetPasswordToken: string | null;
      resetPasswordExpires: Date | null;
    }

    const storedReader: (readerId: ObjectID) => Promise<StoredReader> = async (
      readerId: ObjectID,
    ): Promise<StoredReader> => {
      const rows: Array<StoredReader> = await query(
        `SELECT "password", "passwordSalt", "magicLinkToken", "magicLinkExpires", "resetPasswordToken", "resetPasswordExpires" FROM "${schema}"."StatusPagePrivateUser" WHERE "_id" = $1`,
        [readerId.toString()],
      );

      return rows[0]!;
    };

    const addSession: (
      readerId: ObjectID,
      value: string,
      additionalInfo?: Record<string, unknown>,
    ) => Promise<string> = async (
      readerId: ObjectID,
      value: string,
      additionalInfo: Record<string, unknown> = {},
    ): Promise<string> => {
      const sessionId: string = ObjectID.generate().toString();

      await query(
        `INSERT INTO "${schema}"."StatusPagePrivateUserSession" ("_id", "projectId", "statusPageId", "statusPagePrivateUserId", "refreshToken", "refreshTokenExpiresAt", "isRevoked", "additionalInfo", "version") VALUES ($1, $2, $3, $4, $5, NOW() + interval '1 day', false, $6, 1)`,
        [
          sessionId,
          projectId.toString(),
          statusPageId.toString(),
          readerId.toString(),
          await hashOf(value),
          JSON.stringify(additionalInfo),
        ],
      );

      return sessionId;
    };

    interface StoredSession {
      isRevoked: boolean;
      revokedAt: Date | null;
      revokedReason: string | null;
    }

    const storedSession: (sessionId: string) => Promise<StoredSession> = async (
      sessionId: string,
    ): Promise<StoredSession> => {
      const rows: Array<StoredSession> = await query(
        `SELECT "isRevoked", "revokedAt", "revokedReason" FROM "${schema}"."StatusPagePrivateUserSession" WHERE "_id" = $1`,
        [sessionId],
      );

      return rows[0]!;
    };

    const isSessionActive: (value: string) => Promise<boolean> = async (
      value: string,
    ): Promise<boolean> => {
      return Boolean(
        await StatusPagePrivateUserSessionService.findActiveSessionByRefreshToken(
          value,
        ),
      );
    };

    // What POST /status-page-api/reset-password reads a link by: its hash and the page.
    const readerTheResetLinkFinds: (
      value: string,
    ) => Promise<StatusPagePrivateUser | null> = async (
      value: string,
    ): Promise<StatusPagePrivateUser | null> => {
      return await StatusPagePrivateUserService.findOneBy({
        query: {
          statusPageId: statusPageId,
          resetPasswordToken: await hashOf(value),
        },
        select: { _id: true },
        props: { isRoot: true },
      });
    };

    let session: string;
    let loginCodeSession: string;
    let otherSession: string;

    beforeEach(async () => {
      await query(
        `INSERT INTO "${schema}"."StatusPagePrivateUser" ("_id", "projectId", "statusPageId", "email", "version") VALUES ($1, $2, $3, 'other@example.com', 1)`,
        [otherUserId.toString(), projectId.toString(), statusPageId.toString()],
      );

      await storeLinks(userId, token, resetToken);
      await storeLinks(otherUserId, otherToken, otherResetToken);

      session = await addSession(userId, refreshToken);
      loginCodeSession = await addSession(userId, loginCode, {
        oneuptimeStatusPageSessionPurpose: "login-code",
      });
      otherSession = await addSession(otherUserId, otherRefreshToken);
    });

    test.each<[string, () => Promise<unknown>]>([
      [
        "a teammate through the API, who may not write the links' columns",
        (): Promise<unknown> => {
          return write(teammateProps(), {
            password: new HashedString(newPassword),
          });
        },
      ],
      [
        "their reset link's page, as the route writes it",
        (): Promise<unknown> => {
          return write(
            { isRoot: true },
            {
              password: new HashedString(newPassword),
              resetPasswordToken: null,
              resetPasswordExpires: null,
            },
          );
        },
      ],
    ])(
      "set by %s ends the reader's links with the write that stores it, and their sessions, and no other reader's",
      async (_name: string, changePassword: () => Promise<unknown>) => {
        expect(await isSessionActive(refreshToken)).toBe(true);

        await changePassword();

        const stored: StoredReader = await storedReader(userId);

        expect(stored.password).toBeTruthy();
        expect(stored.password).not.toBe(newPassword);
        expect(stored.passwordSalt).toBeTruthy();
        expect(stored.magicLinkToken).toBeNull();
        expect(stored.magicLinkExpires).toBeNull();
        expect(stored.resetPasswordToken).toBeNull();
        expect(stored.resetPasswordExpires).toBeNull();

        expect(await consume(token)).toBeNull();
        expect(await readerTheResetLinkFinds(resetToken)).toBeNull();

        for (const ended of [session, loginCodeSession]) {
          const row: StoredSession = await storedSession(ended);

          expect(row.isRevoked).toBe(true);
          expect(row.revokedAt).toBeTruthy();
          expect(row.revokedReason).toBe("Password changed");
        }

        expect(await isSessionActive(refreshToken)).toBe(false);
        expect(
          await StatusPagePrivateUserSessionService.exchangeLoginCode(
            loginCode,
            { statusPageId: statusPageId },
          ),
        ).toBeNull();

        // Nobody else's.
        const other: StoredReader = await storedReader(otherUserId);

        expect(other.magicLinkToken).toBe(await hashOf(otherToken));
        expect(other.resetPasswordToken).toBe(await hashOf(otherResetToken));
        expect((await storedSession(otherSession)).isRevoked).toBe(false);
        expect(await isSessionActive(otherRefreshToken)).toBe(true);
      },
    );

    test("a session that already ended keeps when and why it did", async () => {
      await query(
        `UPDATE "${schema}"."StatusPagePrivateUserSession" SET "isRevoked" = true, "revokedAt" = '2026-01-01T00:00:00Z', "revokedReason" = 'User logged out' WHERE "_id" = $1`,
        [session],
      );

      await write(
        { isRoot: true },
        { password: new HashedString(newPassword) },
      );

      const row: StoredSession = await storedSession(session);

      expect(row.revokedReason).toBe("User logged out");
      expect(new Date(row.revokedAt!).toISOString()).toBe(
        "2026-01-01T00:00:00.000Z",
      );
    });

    test("what is asked for or signed in after it works", async () => {
      await write(
        { isRoot: true },
        { password: new HashedString(newPassword) },
      );

      const laterToken: string = "9eaf53e1-cfb8-4103-a31f-a0b1c2d3e4f5";
      const laterReset: string = "afb064f2-d0c9-4214-b420-b1c2d3e4f5a6";
      const laterRefresh: string = "b0c175a3-e1da-4325-8531-c2d3e4f5a6b7";

      await storeLinks(userId, laterToken, laterReset);
      await addSession(userId, laterRefresh);

      expect((await consume(laterToken))?.id?.toString()).toBe(
        userId.toString(),
      );
      expect((await readerTheResetLinkFinds(laterReset))?.id?.toString()).toBe(
        userId.toString(),
      );
      expect(await isSessionActive(laterRefresh)).toBe(true);
    });

    test("a teammate still may not write a link's columns: a new password sent with one is refused whole", async () => {
      const before: StoredReader = await storedReader(userId);

      await expect(
        write(teammateProps(), {
          password: new HashedString(newPassword),
          resetPasswordToken: "chosen by them",
        }),
      ).rejects.toThrow(
        "User is not allowed to update on resetPasswordToken column",
      );

      expect(await storedReader(userId)).toEqual(before);
      expect((await storedSession(session)).isRevoked).toBe(false);
    });

    test("a new email address ends the links, and leaves the sessions", async () => {
      await write(teammateProps(), { email: new Email("moved@example.com") });

      const stored: StoredReader = await storedReader(userId);

      expect(stored.magicLinkToken).toBeNull();
      expect(stored.resetPasswordToken).toBeNull();
      expect((await storedSession(session)).isRevoked).toBe(false);
    });

    test("the same email address again leaves the links and the sessions", async () => {
      await write(teammateProps(), { email: new Email("reader@example.com") });

      const stored: StoredReader = await storedReader(userId);

      expect(stored.magicLinkToken).toBe(await hashOf(token));
      expect(stored.resetPasswordToken).toBe(await hashOf(resetToken));
      expect((await storedSession(session)).isRevoked).toBe(false);
    });
  });
});
