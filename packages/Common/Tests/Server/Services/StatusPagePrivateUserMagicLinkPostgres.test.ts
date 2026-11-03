import Entities from "../../../Models/DatabaseModels/Index";
import StatusPagePrivateUser from "../../../Models/DatabaseModels/StatusPagePrivateUser";
import { EncryptionSecret } from "../../../Server/EnvironmentConfig";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import StatusPagePrivateUserService from "../../../Server/Services/StatusPagePrivateUserService";
import HashedString from "../../../Types/HashedString";
import ObjectID from "../../../Types/ObjectID";
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
 *     until one is asked for.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_STATUS_PAGE_MAGIC_LINK_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = ["StatusPage", "StatusPagePrivateUser"];

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
});
