import { DropGreenlockTables1809181850000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809181850000-DropGreenlockTables";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { DataSource, QueryRunner } from "typeorm";

/*
 * DropGreenlockTables1809181850000 against a real Postgres (#8990).
 *
 * Opt in with RUN_POSTGRES_DROP_GREENLOCK_TABLES_TESTS=true and the normal
 * database credentials; DROP_GREENLOCK_TABLES_TEST_DATABASE_HOST / _PORT /
 * _NAME point it at a database other than the local development one. It
 * needs nothing migrated: it works in a schema of its own, with a "User"
 * table of its own for the tables' keys to point at, and drops the schema
 * afterwards.
 *
 * What it pins:
 *   - down() makes both tables as the last migrations left them, keys to
 *     "User" included, and they take a row as the Greenlock store wrote one;
 *   - up() drops both, rows and all, and with them their keys' triggers on
 *     "User", which keeps working;
 *   - up() again, and up() where the tables never were, change nothing;
 *   - while another transaction reads "User", up() waits no longer than
 *     its lock_timeout for the lock it needs there, and then fails as a
 *     lock wait (55P03), which SchemaMigrationRunner rolls back and tries
 *     again - it never parks "User"'s readers behind it for long; with the
 *     reader gone, it drops them.
 */

// describe.skip's type is the one both branches share.
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_DROP_GREENLOCK_TABLES_TESTS"] === "true"
    ? describe
    : describe.skip;

const LOCK_NOT_AVAILABLE: string = "55P03";

describePostgres("DropGreenlockTables1809181850000 (Postgres)", () => {
  const schema: string = `drop_greenlock_${Date.now().toString(36)}`;

  let database: DataSource;

  const connect: () => DataSource = (): DataSource => {
    return new DataSource({
      type: "postgres",
      host:
        process.env["DROP_GREENLOCK_TABLES_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["DROP_GREENLOCK_TABLES_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["DROP_GREENLOCK_TABLES_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
  };

  const tablesThere: () => Promise<Array<string>> = async (): Promise<
    Array<string>
  > => {
    const rows: Array<{ name: string }> = await database.query(
      `SELECT table_name AS "name" FROM information_schema.tables WHERE table_schema = $1 AND table_name LIKE 'Greenlock%' ORDER BY table_name`,
      [schema],
    );

    return rows.map((row: { name: string }): string => {
      return row.name;
    });
  };

  const run: (
    step: (runner: QueryRunner) => Promise<void>,
  ) => Promise<void> = async (
    step: (runner: QueryRunner) => Promise<void>,
  ): Promise<void> => {
    const runner: QueryRunner = database.createQueryRunner();

    try {
      await runner.startTransaction();
      await step(runner);
      await runner.commitTransaction();
    } catch (err) {
      await runner.rollbackTransaction();
      throw err;
    } finally {
      await runner.release();
    }
  };

  beforeAll(async () => {
    database = connect();
    await database.initialize();

    await database.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(
      `CREATE TABLE "${schema}"."User" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying, CONSTRAINT "PK_${schema}_user" PRIMARY KEY ("_id"))`,
    );
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  test("down() makes both tables as the last migrations left them, and they take the store's rows", async () => {
    await run(async (runner: QueryRunner) => {
      await new DropGreenlockTables1809181850000().down(runner);
    });

    expect(await tablesThere()).toEqual([
      "GreenlockCertificate",
      "GreenlockChallenge",
    ]);

    const columns: Array<{ table: string; column: string; type: string }> =
      await database.query(
        `SELECT table_name AS "table", column_name AS "column", data_type AS "type" FROM information_schema.columns WHERE table_schema = $1 AND table_name LIKE 'Greenlock%' AND column_name IN ('createdAt', 'updatedAt', 'deletedAt') ORDER BY 1, 2`,
        [schema],
      );

    expect(columns).toHaveLength(6);

    for (const column of columns) {
      expect(column.type).toBe("timestamp with time zone");
    }

    const keys: Array<{ name: string; onDelete: string }> =
      await database.query(
        `SELECT con.conname AS "name", con.confdeltype AS "onDelete" FROM pg_constraint con JOIN pg_namespace ns ON ns.oid = con.connamespace WHERE ns.nspname = $1 AND con.contype = 'f' ORDER BY 1`,
        [schema],
      );

    // "n": ON DELETE SET NULL.
    expect(keys).toEqual([
      { name: "FK_7517f5a285255f031b0f6d9663c", onDelete: "n" },
      { name: "FK_895b9b802ed002a3804136bacf1", onDelete: "n" },
    ]);

    const user: Array<{ _id: string }> = await database.query(
      `INSERT INTO "User" ("name") VALUES ('admin') RETURNING "_id"`,
    );

    await database.query(
      `INSERT INTO "GreenlockCertificate" ("version", "key", "blob", "isKeyPair", "deletedByUserId") VALUES (1, 'status.acme.com', '{"privateKeyPem":"-----BEGIN EC PRIVATE KEY-----"}', true, $1)`,
      [user[0]!._id],
    );
    await database.query(
      `INSERT INTO "GreenlockChallenge" ("version", "key", "token", "challenge") VALUES (1, 'status.acme.com', 'token', 'challenge')`,
    );
  });

  test('up() drops both tables, the old keys with them, and "User" keeps working', async () => {
    await run(async (runner: QueryRunner) => {
      await new DropGreenlockTables1809181850000().up(runner);
    });

    expect(await tablesThere()).toEqual([]);

    // No trigger of the dropped keys is left on "User": deleting one works.
    const triggers: Array<{ count: number }> = await database.query(
      `SELECT COUNT(*)::int AS "count" FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = $1 AND c.relname = 'User' AND t.tgisinternal`,
      [schema],
    );

    expect(triggers[0]!.count).toBe(0);

    await database.query(`DELETE FROM "User"`);
  });

  test("up() again, and up() where the tables never were, change nothing", async () => {
    await run(async (runner: QueryRunner) => {
      await new DropGreenlockTables1809181850000().up(runner);
    });
    await run(async (runner: QueryRunner) => {
      await new DropGreenlockTables1809181850000().up(runner);
    });

    expect(await tablesThere()).toEqual([]);
  });

  test('behind a reader of "User", up() waits only its lock_timeout, and fails as a lock wait to be tried again', async () => {
    await run(async (runner: QueryRunner) => {
      await new DropGreenlockTables1809181850000().down(runner);
    });

    const reader: QueryRunner = database.createQueryRunner();

    await reader.startTransaction();
    // ACCESS SHARE on "User", held until the reader ends.
    await reader.query(`SELECT COUNT(*) FROM "User"`);

    const startedAt: number = Date.now();
    let error: unknown = null;

    try {
      await run(async (runner: QueryRunner) => {
        // What SchemaMigrationRunner gives every migration statement.
        await runner.query(`SET LOCAL lock_timeout = 2000`);
        await new DropGreenlockTables1809181850000().up(runner);
      });
    } catch (err) {
      error = err;
    }

    const waitedInMs: number = Date.now() - startedAt;

    await reader.rollbackTransaction();
    await reader.release();

    const code: unknown =
      (error as { code?: unknown } | null)?.code ??
      (error as { driverError?: { code?: unknown } } | null)?.driverError?.code;

    expect(code).toBe(LOCK_NOT_AVAILABLE);
    expect(waitedInMs).toBeLessThan(10000);

    // Rolled back: both tables are still there, for the next try.
    expect(await tablesThere()).toEqual([
      "GreenlockCertificate",
      "GreenlockChallenge",
    ]);

    // The next try, with nobody reading "User", drops them.
    await run(async (runner: QueryRunner) => {
      await runner.query(`SET LOCAL lock_timeout = 2000`);
      await new DropGreenlockTables1809181850000().up(runner);
    });

    expect(await tablesThere()).toEqual([]);
  });
});
