import {
  DELETED_BY_USER_TABLES,
  DeletedByUserTable,
  DropDeletedByUserColumns1809187480000,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187480000-DropDeletedByUserColumns";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { DataSource, QueryRunner } from "typeorm";

/*
 * DropDeletedByUserColumns1809187480000 against a real Postgres (#10469).
 *
 * Opt in with RUN_POSTGRES_DROP_DELETED_BY_USER_COLUMNS_TESTS=true and the
 * normal database credentials; DROP_DELETED_BY_USER_COLUMNS_TEST_DATABASE_
 * HOST / _PORT / _NAME point it at a database other than the local
 * development one. It needs nothing migrated: it works in a schema of its
 * own, with a "User" table and three of the migration's tables as the
 * migrations made them - a column, and a key to "User" that sets it to
 * null - and drops the schema afterwards.
 *
 * What it pins:
 *   - up() drops each table's key and column, its rows stay, and the keys'
 *     triggers go from "User": a user is deleted with no table to visit;
 *   - up() again changes nothing, and asks for no lock;
 *   - a run that stopped part way is finished by the next, which alters
 *     only the tables that still have the column;
 *   - behind a reader of "User", a statement waits only its lock_timeout and
 *     fails as a lock wait (55P03), which SchemaMigrationRunner tries again,
 *     and its table is left exactly as it was; with the reader gone, the
 *     next run drops it.
 *
 * Locally, against a throwaway container:
 *
 *   docker run -d --name drop-deleted-by-pg -e POSTGRES_PASSWORD=password \
 *     -e POSTGRES_DB=oneuptimedb -p 127.0.0.1:55433:5432 postgres:15
 *   RUN_POSTGRES_DROP_DELETED_BY_USER_COLUMNS_TESTS=true \
 *   DROP_DELETED_BY_USER_COLUMNS_TEST_DATABASE_HOST=127.0.0.1 \
 *   DROP_DELETED_BY_USER_COLUMNS_TEST_DATABASE_PORT=55433 \
 *   DATABASE_PASSWORD=password \
 *     npx jest Tests/Server/Infrastructure/Postgres/DropDeletedByUserColumnsPostgres.test.ts
 *   docker rm -f drop-deleted-by-pg
 */

// describe.skip's type is the one both branches share.
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_DROP_DELETED_BY_USER_COLUMNS_TESTS"] === "true"
    ? describe
    : describe.skip;

const LOCK_NOT_AVAILABLE: string = "55P03";

// Two tables with a key, and one of the two models that never had one.
const KEYED: Array<string> = ["Label", "Monitor"];
const UNKEYED: string = "GlobalSSOProject";
const TABLES: Array<string> = [...KEYED, UNKEYED];

function entryOf(table: string): DeletedByUserTable {
  const entry: DeletedByUserTable | undefined = DELETED_BY_USER_TABLES.find(
    (candidate: DeletedByUserTable): boolean => {
      return candidate.table === table;
    },
  );

  if (!entry) {
    throw new Error(`${table} is not one the migration drops from`);
  }

  return entry;
}

describePostgres("DropDeletedByUserColumns1809187480000 (Postgres)", () => {
  const schema: string = `drop_deleted_by_${Date.now().toString(36)}`;

  let database: DataSource;
  let userId: string = "";

  const connect: () => DataSource = (): DataSource => {
    return new DataSource({
      type: "postgres",
      host:
        process.env["DROP_DELETED_BY_USER_COLUMNS_TEST_DATABASE_HOST"] ||
        "localhost",
      port: Number(
        process.env["DROP_DELETED_BY_USER_COLUMNS_TEST_DATABASE_PORT"] ||
          "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["DROP_DELETED_BY_USER_COLUMNS_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
  };

  // The tables of this schema that still have the column.
  const withTheColumn: () => Promise<Array<string>> = async (): Promise<
    Array<string>
  > => {
    const rows: Array<{ name: string }> = await database.query(
      `SELECT table_name AS "name" FROM information_schema.columns WHERE table_schema = $1 AND column_name = 'deletedByUserId' ORDER BY table_name`,
      [schema],
    );

    return rows.map((row: { name: string }): string => {
      return row.name;
    });
  };

  // The keys of this schema's tables, by name.
  const keys: () => Promise<Array<string>> = async (): Promise<
    Array<string>
  > => {
    const rows: Array<{ name: string }> = await database.query(
      `SELECT con.conname AS "name" FROM pg_constraint con JOIN pg_namespace ns ON ns.oid = con.connamespace WHERE ns.nspname = $1 AND con.contype = 'f' ORDER BY 1`,
      [schema],
    );

    return rows.map((row: { name: string }): string => {
      return row.name;
    });
  };

  // The column and key a table had, as the migrations made them.
  const giveTheColumn: (table: string) => Promise<void> = async (
    table: string,
  ): Promise<void> => {
    await database.query(
      `ALTER TABLE "${schema}"."${table}" ADD "deletedByUserId" uuid`,
    );

    const foreignKey: string | null = entryOf(table).foreignKey;

    if (foreignKey) {
      await database.query(
        `ALTER TABLE "${schema}"."${table}" ADD CONSTRAINT "${foreignKey}" FOREIGN KEY ("deletedByUserId") REFERENCES "${schema}"."User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
      );
    }

    await database.query(
      `UPDATE "${schema}"."${table}" SET "deletedByUserId" = $1`,
      [userId],
    );
  };

  /*
   * up(), as the runner runs a migration with transaction = false: on a
   * connection of its own, in no transaction, with `lockTimeout` if given.
   * Returns the ALTER TABLE statements it made.
   */
  const up: (lockTimeoutInMs?: number) => Promise<Array<string>> = async (
    lockTimeoutInMs?: number,
  ): Promise<Array<string>> => {
    const runner: QueryRunner = database.createQueryRunner();
    const altered: Array<string> = [];

    try {
      if (lockTimeoutInMs) {
        await runner.query(`SET lock_timeout = ${lockTimeoutInMs}`);
      }

      const query: QueryRunner["query"] = runner.query.bind(runner);

      runner.query = (async (
        statement: string,
        parameters?: Array<unknown>,
      ): Promise<unknown> => {
        if (statement.startsWith("ALTER TABLE")) {
          altered.push(statement);
        }

        return await query(statement, parameters);
      }) as QueryRunner["query"];

      await new DropDeletedByUserColumns1809187480000().up(runner);
    } finally {
      // The pool's next user of this connection waits as long as it did.
      if (lockTimeoutInMs) {
        await runner.query(`RESET lock_timeout`);
      }

      await runner.release();
    }

    return altered;
  };

  beforeAll(async () => {
    database = connect();
    await database.initialize();

    await database.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(
      `CREATE TABLE "${schema}"."User" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying, CONSTRAINT "PK_${schema}_user" PRIMARY KEY ("_id"))`,
    );

    const user: Array<{ _id: string }> = await database.query(
      `INSERT INTO "${schema}"."User" ("name") VALUES ('Alex') RETURNING "_id"`,
    );
    userId = user[0]!._id;

    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying, CONSTRAINT "PK_${schema}_${table}" PRIMARY KEY ("_id"))`,
      );
      await database.query(
        `INSERT INTO "${schema}"."${table}" ("name") VALUES ('one'), ('two')`,
      );
      await giveTheColumn(table);
    }
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  test('the tables start as the migrations made them: the column, and a key to "User" that sets it to null', async () => {
    expect(await withTheColumn()).toEqual([...TABLES].sort());
    expect(await keys()).toEqual(
      KEYED.map((table: string): string => {
        return entryOf(table).foreignKey!;
      }).sort(),
    );

    const onDelete: Array<{ action: string }> = await database.query(
      `SELECT con.confdeltype AS "action" FROM pg_constraint con JOIN pg_namespace ns ON ns.oid = con.connamespace WHERE ns.nspname = $1 AND con.contype = 'f'`,
      [schema],
    );

    // "n": ON DELETE SET NULL.
    expect(
      onDelete.map((row: { action: string }): string => {
        return row.action;
      }),
    ).toEqual(["n", "n"]);
  });

  test("up() drops each table's key and column, keeps its rows, and \"User\" loses the keys' triggers", async () => {
    const altered: Array<string> = await up();

    expect(altered).toHaveLength(TABLES.length);
    expect(await withTheColumn()).toEqual([]);
    expect(await keys()).toEqual([]);

    for (const table of TABLES) {
      const rows: Array<{ count: number }> = await database.query(
        `SELECT COUNT(*)::int AS "count" FROM "${schema}"."${table}"`,
      );

      expect([table, rows[0]!.count]).toEqual([table, 2]);
    }

    // No trigger of the dropped keys is left on "User".
    const triggers: Array<{ count: number }> = await database.query(
      `SELECT COUNT(*)::int AS "count" FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = $1 AND c.relname = 'User' AND t.tgisinternal`,
      [schema],
    );

    expect(triggers[0]!.count).toBe(0);
  });

  test("up() again changes nothing, and asks no table for its lock", async () => {
    expect(await up()).toEqual([]);
    expect(await withTheColumn()).toEqual([]);
  });

  test("a run that stopped part way is finished by the next, which alters only the tables left", async () => {
    await giveTheColumn("Label");
    await giveTheColumn("Monitor");

    // The stopped run had dropped Monitor's.
    await database.query(
      `ALTER TABLE "${schema}"."Monitor" DROP CONSTRAINT "${entryOf("Monitor").foreignKey}", DROP COLUMN "deletedByUserId"`,
    );

    const altered: Array<string> = await up();

    expect(altered).toHaveLength(1);
    expect(altered[0]).toContain('ALTER TABLE "Label"');
    expect(await withTheColumn()).toEqual([]);
    expect(await keys()).toEqual([]);
  });

  test('behind a reader of "User", a statement waits only its lock_timeout and leaves its table as it was; the next run drops it', async () => {
    await giveTheColumn("Label");

    const reader: QueryRunner = database.createQueryRunner();

    await reader.startTransaction();
    // ACCESS SHARE on "User", held until the reader ends.
    await reader.query(`SELECT COUNT(*) FROM "${schema}"."User"`);

    let error: unknown = null;

    try {
      // What SchemaMigrationRunner gives every migration statement, shorter.
      await up(500);
    } catch (err) {
      error = err;
    }

    await reader.rollbackTransaction();
    await reader.release();

    const code: unknown =
      (error as { code?: unknown } | null)?.code ??
      (error as { driverError?: { code?: unknown } } | null)?.driverError?.code;

    expect(code).toBe(LOCK_NOT_AVAILABLE);

    // Its one statement did nothing: the column and the key are both there.
    expect(await withTheColumn()).toEqual(["Label"]);
    expect(await keys()).toEqual([entryOf("Label").foreignKey!]);

    // The next try, with nobody reading "User", drops them.
    expect(await up(500)).toHaveLength(1);
    expect(await withTheColumn()).toEqual([]);
    expect(await keys()).toEqual([]);

    // And a user is deleted with no table left to set to null.
    await database.query(`DELETE FROM "${schema}"."User"`);
  });
});
