import Entities from "../../../Models/DatabaseModels/Index";
import User from "../../../Models/DatabaseModels/User";
import { EncryptionSecret } from "../../../Server/EnvironmentConfig";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import UserService from "../../../Server/Services/UserService";
import HashedString from "../../../Types/HashedString";
import ObjectID from "../../../Types/ObjectID";
import { DataSource } from "typeorm";

/*
 * AN ACCOUNT'S SIGN-IN LINKS, AGAINST POSTGRES
 * (UserService.findByMagicLinkToken and consumeMagicLinkToken, the
 * AddMagicLinkLogin migration; Types/Accounts/MagicLink).
 *
 * Opt in with RUN_POSTGRES_USER_MAGIC_LINK_TESTS=true against a database the
 * migrations have run on (USER_MAGIC_LINK_TEST_DATABASE_*). The real tables
 * are cloned into an isolated schema; nothing else is touched.
 *
 *   - a link is found by its token's hash while it works, and reading it
 *     spends nothing;
 *   - a link signs in once: the row no longer holds it afterwards, and the
 *     same link again finds nothing;
 *   - many requests racing with one link: exactly one spends it;
 *   - an expired link, a link of another account, a link of a removed
 *     account and a token that is not the link find nothing and spend
 *     nothing;
 *   - a newer link replaces the older one;
 *   - no account holds a link until one is asked for, and the server takes
 *     sign-in links until a master admin turns them off - the one that
 *     existed before the column too.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_USER_MAGIC_LINK_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = ["User", "GlobalConfig"];

describePostgres("an account's sign-in links against Postgres", () => {
  const schema: string = `user_magic_link_test_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  const userId: ObjectID = ObjectID.generate();
  const otherUserId: ObjectID = ObjectID.generate();
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

  // An account's stored link: the hash of `value`, live for `minutes` (negative: expired).
  const storeLink: (
    value: string,
    minutes: number,
    accountId?: ObjectID,
  ) => Promise<void> = async (
    value: string,
    minutes: number,
    accountId?: ObjectID,
  ): Promise<void> => {
    await query(
      `UPDATE "${schema}"."User" SET "magicLinkToken" = $1, "magicLinkExpires" = NOW() + make_interval(mins => $2) WHERE "_id" = $3`,
      [await hashOf(value), minutes, (accountId || userId).toString()],
    );
  };

  const storedRow: (accountId?: ObjectID) => Promise<{
    magicLinkToken: string | null;
    magicLinkExpires: Date | null;
  }> = async (
    accountId?: ObjectID,
  ): Promise<{
    magicLinkToken: string | null;
    magicLinkExpires: Date | null;
  }> => {
    const rows: Array<{
      magicLinkToken: string | null;
      magicLinkExpires: Date | null;
    }> = await query(
      `SELECT "magicLinkToken", "magicLinkExpires" FROM "${schema}"."User" WHERE "_id" = $1`,
      [(accountId || userId).toString()],
    );

    return rows[0]!;
  };

  const find: (value: string) => Promise<User | null> = async (
    value: string,
  ): Promise<User | null> => {
    return await UserService.findByMagicLinkToken({
      token: value,
      select: { _id: true, email: true, isEmailVerified: true },
    });
  };

  const consume: (
    value: string,
    accountId?: ObjectID,
  ) => Promise<boolean> = async (
    value: string,
    accountId?: ObjectID,
  ): Promise<boolean> => {
    return await UserService.consumeMagicLinkToken({
      userId: accountId || userId,
      token: value,
    });
  };

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["USER_MAGIC_LINK_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["USER_MAGIC_LINK_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["USER_MAGIC_LINK_TEST_DATABASE_NAME"] ||
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

    // No row names the new columns: what they hold is the migration's.
    await query(
      `INSERT INTO "${schema}"."User" ("_id", "email", "slug", "version") VALUES ($1, 'ada@example.com', 'ada', 1), ($2, 'eve@example.com', 'eve', 1)`,
      [userId.toString(), otherUserId.toString()],
    );
    await query(
      `INSERT INTO "${schema}"."GlobalConfig" ("_id", "version") VALUES ($1, 1)`,
      [ObjectID.getZeroObjectID().toString()],
    );
  });

  afterAll(async () => {
    jest.restoreAllMocks();

    if (database?.isInitialized) {
      await query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  test("no account holds a link until one is asked for, and the server takes them until a master admin turns them off", async () => {
    expect(await storedRow()).toEqual({
      magicLinkToken: null,
      magicLinkExpires: null,
    });

    const configs: Array<{ disableMagicLinkLogin: boolean | null }> =
      await query(
        `SELECT "disableMagicLinkLogin" FROM "${schema}"."GlobalConfig"`,
      );

    expect(configs).toEqual([{ disableMagicLinkLogin: false }]);
  });

  test("a live link is found by its token's hash, and finding it spends nothing", async () => {
    await storeLink(token, 15);

    const user: User | null = await find(token);

    expect(user?.id?.toString()).toBe(userId.toString());
    expect(user?.email?.toString()).toBe("ada@example.com");
    expect((await storedRow()).magicLinkToken).toBe(await hashOf(token));
    expect(await find(token)).not.toBeNull();
  });

  test("a live link is spent once, and the row no longer holds it", async () => {
    await storeLink(token, 15);

    expect(await consume(token)).toBe(true);
    expect(await storedRow()).toEqual({
      magicLinkToken: null,
      magicLinkExpires: null,
    });

    expect(await consume(token)).toBe(false);
    expect(await find(token)).toBeNull();
  });

  test("many requests racing with one link: exactly one spends it", async () => {
    await storeLink(token, 15);

    const results: Array<boolean> = await Promise.all(
      Array.from({ length: 8 }, (): Promise<boolean> => {
        return consume(token);
      }),
    );

    expect(
      results.filter((spent: boolean): boolean => {
        return spent;
      }),
    ).toHaveLength(1);
    expect((await storedRow()).magicLinkToken).toBeNull();
  });

  test("an expired link finds nothing and is not spent", async () => {
    await storeLink(token, -1);

    expect(await find(token)).toBeNull();
    expect(await consume(token)).toBe(false);
    expect((await storedRow()).magicLinkToken).toBe(await hashOf(token));
  });

  test("a link spends only on its own account", async () => {
    await storeLink(token, 15);

    expect(await consume(token, otherUserId)).toBe(false);
    expect((await storedRow()).magicLinkToken).toBe(await hashOf(token));
  });

  test("a token that is not the link finds nothing and spends nothing", async () => {
    await storeLink(token, 15);

    expect(await find("1c2e7b6f-4d30-4f8b-8c9d-2e3f4a5b6c7d")).toBeNull();
    expect(await consume("1c2e7b6f-4d30-4f8b-8c9d-2e3f4a5b6c7d")).toBe(false);
    expect((await storedRow()).magicLinkToken).toBe(await hashOf(token));
  });

  test("a removed account's link finds nothing and is not spent", async () => {
    await storeLink(token, 15);
    await query(
      `UPDATE "${schema}"."User" SET "deletedAt" = NOW() WHERE "_id" = $1`,
      [userId.toString()],
    );

    expect(await find(token)).toBeNull();
    expect(await consume(token)).toBe(false);
  });

  test("a newer link replaces the older one", async () => {
    const newer: string = "2d3f8c7a-5e41-4a9c-9dae-3f4a5b6c7d8e";

    await storeLink(token, 15);
    await storeLink(newer, 15);

    expect(await find(token)).toBeNull();
    expect(await consume(token)).toBe(false);
    expect(await consume(newer)).toBe(true);
  });

  test("the same token stored on two accounts spends only on the account named", async () => {
    await storeLink(token, 15);
    await storeLink(token, 15, otherUserId);

    expect(await consume(token, otherUserId)).toBe(true);
    expect((await storedRow(otherUserId)).magicLinkToken).toBeNull();
    expect((await storedRow()).magicLinkToken).toBe(await hashOf(token));
  });
});
