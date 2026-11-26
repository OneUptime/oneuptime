import Entities from "../../../../Models/DatabaseModels/Index";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ShortLink from "../../../../Models/DatabaseModels/ShortLink";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import UserSessionService from "../../../../Server/Services/UserSessionService";
import JobDeadline from "../../../../Server/Utils/JobDeadline";
import logger from "../../../../Server/Utils/Logger";
import OlderRowsPurge, {
  OLDER_ROWS_PURGE_BATCH_SIZE,
  OlderRowsPurgeSummary,
} from "../../../../Server/Utils/Retention/OlderRowsPurge";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource, Logger as QueryLogger } from "typeorm";

/*
 * DELETING THE ROWS OLDER THAN THEIR TABLE KEEPS THEM, ON POSTGRES (issue
 * #8894).
 *
 * The daily HardDelete:HardDeleteOlderItemsInDatabase deletes, for each
 * service that says how long its table keeps a row
 * (hardDeleteItemsOlderThanInDays), the rows whose column is older than
 * that (OlderRowsPurge). It used to delete 10,000 rows a statement with no
 * time budget. These are the real paths - the purge's batches, the
 * services' hardDeleteBy and their hooks - on real rows:
 *
 *   - a session 30 days past the expiry of its refresh token is gone for
 *     good (UserSessionService keeps them so long on every installation);
 *     one 29 days past, and a live one, stay;
 *   - a backlog goes 1000 rows a statement, one DELETE a batch, until a
 *     batch removes nothing;
 *   - a run out of time takes one batch of each table, and the next run the
 *     rest;
 *   - a table that keeps its rows for ever is never read, and a deadline
 *     that has passed deletes nothing;
 *   - the suite's purge reaches its own rows only: a session expired long
 *     ago in public, of a user the suite made there, is still there.
 *
 * Opt in with RUN_POSTGRES_OLDER_ROWS_PURGE_TESTS=true against a database
 * the registered migrations have been applied to - the Postgres Schema
 * Drift workflow's database right after its drift check - e.g.
 *
 *   RUN_POSTGRES_OLDER_ROWS_PURGE_TESTS=true \
 *   OLDER_ROWS_PURGE_TEST_DATABASE_HOST=127.0.0.1 \
 *   OLDER_ROWS_PURGE_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Utils/Retention/OlderRowsPurgePostgres.test.ts
 *
 * The purge is not per project: it takes every row of a table older than
 * its window. So it runs here against the STRUCTURE of the tables, and the
 * foreign keys between them, cloned from public into a uniquely named
 * schema - the only one on the search path - that is dropped afterwards;
 * every row is synthetic. Credentials from DATABASE_USERNAME /
 * DATABASE_PASSWORD, database from OLDER_ROWS_PURGE_TEST_DATABASE_NAME or
 * DATABASE_NAME.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_OLDER_ROWS_PURGE_TESTS"] === "true"
    ? describe
    : describe.skip;

const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;
const DAY: number = 24 * 60 * MINUTE;

const TABLES: Array<string> = ["User", "UserSession", "ShortLink"];

// A DELETE of sessions or short links, as TypeORM writes it (schema-qualified or not).
const DELETE_OF: (table: string) => RegExp = (table: string): RegExp => {
  return new RegExp(`^DELETE FROM (?:"[^"]*"\\.)?"${table}"`);
};

// A statement that reads or writes a table, schema-qualified or not.
const NAMES: (table: string) => RegExp = (table: string): RegExp => {
  return new RegExp(`(?:FROM|INTO|UPDATE) (?:"[^"]*"\\.)?"${table}"`);
};

interface ForeignKeyRow {
  table: string;
  name: string;
  definition: string;
}

interface Statement {
  sql: string;
  parameters: Array<unknown>;
}

describePostgres("the purge by age, on Postgres", () => {
  const schema: string = `older_rows_purge_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;

  let database: DataSource;
  let tokenCounter: number = 0;

  // The user the sentinel session in public belongs to, made by this suite.
  let publicUserId: string | null = null;

  // The statements sent while they are counted, or null.
  let statements: Array<Statement> | null = null;

  const statementCounter: QueryLogger = {
    logQuery: (sql: string, parameters?: Array<unknown>): void => {
      statements?.push({ sql: sql.trim(), parameters: parameters || [] });
    },
    logQueryError: (): void => {
      return undefined;
    },
    logQuerySlow: (): void => {
      return undefined;
    },
    logSchemaBuild: (): void => {
      return undefined;
    },
    logMigration: (): void => {
      return undefined;
    },
    log: (): void => {
      return undefined;
    },
  };

  const query: (sql: string, parameters?: Array<unknown>) => Promise<any> = (
    sql: string,
    parameters?: Array<unknown>,
  ): Promise<any> => {
    return database.query(sql, parameters);
  };

  const ago: (milliseconds: number) => Date = (milliseconds: number): Date => {
    return new Date(Date.now() - milliseconds);
  };

  const nextToken: () => string = (): string => {
    tokenCounter += 1;
    return `refresh-${tokenCounter}-${ObjectID.generate().toString()}`;
  };

  // Short links as OneUptime Cloud keeps them: 3 days (ShortLinkService, with billing on).
  const shortLinksAsOnCloud: () => DatabaseService<BaseModel> =
    (): DatabaseService<BaseModel> => {
      const service: DatabaseService<BaseModel> =
        new DatabaseService<BaseModel>(
          ShortLink as unknown as { new (): BaseModel },
        );
      service.hardDeleteItemsOlderThanInDays("createdAt", 3);
      return service;
    };

  const addUser: () => Promise<string> = async (): Promise<string> => {
    const id: string = ObjectID.generate().toString();

    await query(
      `INSERT INTO "${schema}"."User" ("_id", "version", "email", "slug") VALUES ($1, 1, $2, $3)`,
      [id, `${id}@example.com`, `user-${id}`],
    );

    return id;
  };

  const addSession: (data: {
    userId: string;
    refreshTokenExpiresAt: Date;
  }) => Promise<string> = async (data: {
    userId: string;
    refreshTokenExpiresAt: Date;
  }): Promise<string> => {
    const id: string = ObjectID.generate().toString();

    await query(
      `INSERT INTO "${schema}"."UserSession" ("_id", "version", "userId", "refreshToken", "refreshTokenExpiresAt")
       VALUES ($1, 1, $2, $3, $4)`,
      [id, data.userId, nextToken(), data.refreshTokenExpiresAt],
    );

    return id;
  };

  // `count` sessions whose refresh token expired at `expiredAt`, in one statement.
  const addSessions: (data: {
    userId: string;
    count: number;
    expiredAt: Date;
  }) => Promise<void> = async (data: {
    userId: string;
    count: number;
    expiredAt: Date;
  }): Promise<void> => {
    tokenCounter += 1;

    await query(
      `INSERT INTO "${schema}"."UserSession" ("_id", "version", "userId", "refreshToken", "refreshTokenExpiresAt")
       SELECT gen_random_uuid(), 1, $1, 'backlog-' || $4::text || '-' || n, $2
         FROM generate_series(1, $3::int) AS n`,
      [data.userId, data.expiredAt, data.count, String(tokenCounter)],
    );
  };

  // `count` short links made at `createdAt`, in one statement.
  const addShortLinks: (data: {
    count: number;
    createdAt: Date;
  }) => Promise<void> = async (data: {
    count: number;
    createdAt: Date;
  }): Promise<void> => {
    tokenCounter += 1;

    await query(
      `INSERT INTO "${schema}"."ShortLink" ("_id", "version", "shortId", "link", "createdAt")
       SELECT gen_random_uuid(), 1, 'l' || $3::text || '-' || n, 'https://status.example.com/incidents/' || n, $2
         FROM generate_series(1, $1::int) AS n`,
      [data.count, data.createdAt, String(tokenCounter)],
    );
  };

  const countOf: (table: string, where?: string) => Promise<number> = async (
    table: string,
    where?: string,
  ): Promise<number> => {
    const rows: Array<{ count: string }> = await query(
      `SELECT COUNT(*)::text AS "count" FROM "${schema}"."${table}"${where ? ` WHERE ${where}` : ""}`,
    );

    return Number(rows[0]?.count);
  };

  const sessionExists: (id: string) => Promise<boolean> = async (
    id: string,
  ): Promise<boolean> => {
    return (await countOf("UserSession", `"_id" = '${id}'`)) === 1;
  };

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["OLDER_ROWS_PURGE_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["OLDER_ROWS_PURGE_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["OLDER_ROWS_PURGE_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema}` },
      logger: statementCounter,
    });
    await database.initialize();

    /*
     * The migrated foreign keys between the cloned tables, read before the
     * clones exist, so their definitions name the referenced tables
     * without a schema - and so resolve to the clones once copied.
     */
    const foreignKeys: Array<ForeignKeyRow> = await query(
      `SELECT t.relname AS "table",
              c.conname AS "name",
              pg_get_constraintdef(c.oid) AS "definition"
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         JOIN pg_class r ON r.oid = c.confrelid
        WHERE n.nspname = 'public'
          AND c.contype = 'f'
          AND t.relname = ANY($1)
          AND r.relname = ANY($1)
        ORDER BY t.relname, c.conname`,
      [TABLES],
    );

    await query(`CREATE SCHEMA "${schema}"`);

    for (const table of TABLES) {
      await query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    for (const foreignKey of foreignKeys) {
      await query(
        `ALTER TABLE "${schema}"."${foreignKey.table}" ADD CONSTRAINT "${foreignKey.name}" ${foreignKey.definition.replace(
          /REFERENCES public\./g,
          "REFERENCES ",
        )}`,
      );
    }

    const currentSchema: Array<{ current_schema: string }> = await query(
      "SELECT current_schema()",
    );
    expect(currentSchema[0]?.current_schema).toBe(schema);
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      // The sentinel's user; its session goes with it (CASCADE).
      if (publicUserId) {
        await query(`DELETE FROM public."User" WHERE "_id" = $1`, [
          publicUserId,
        ]);
      }

      await query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
    for (const table of [...TABLES].reverse()) {
      await query(`DELETE FROM "${schema}"."${table}"`);
    }

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    for (const silenced of ["debug", "info", "warn"] as const) {
      jest.spyOn(logger, silenced).mockImplementation((): void => {
        return undefined;
      });
    }
  });

  afterEach(() => {
    statements = null;
    jest.restoreAllMocks();
  });

  test("copies the foreign keys between the tables as the migrations declare them", async () => {
    const copied: Array<{ table: string; referencedTable: string }> =
      await query(
        `SELECT t.relname AS "table", r.relname AS "referencedTable"
           FROM pg_constraint c
           JOIN pg_class t ON t.oid = c.conrelid
           JOIN pg_namespace n ON n.oid = t.relnamespace
           JOIN pg_class r ON r.oid = c.confrelid
           JOIN pg_namespace rn ON rn.oid = r.relnamespace
          WHERE n.nspname = $1 AND rn.nspname = $1 AND c.contype = 'f'
          ORDER BY 1, 2`,
        [schema],
      );

    /*
     * A session goes with its user; a user names who invited them
     * (createdByUserId). A short link names nobody: its only key to "User",
     * who deleted it, went with that column (#10469).
     */
    expect(copied).toEqual([
      { table: "User", referencedTable: "User" },
      { table: "UserSession", referencedTable: "User" },
    ]);
  });

  test("the sessions are kept 30 days past the expiry of their refresh token, on every installation", () => {
    expect(UserSessionService.hardDeleteItemByColumnName).toBe(
      "refreshTokenExpiresAt",
    );
    expect(UserSessionService.hardDeleteItemsOlderThanDays).toBe(30);
    expect(OlderRowsPurge.isPurged(UserSessionService)).toBe(true);
  });

  test("a session 30 days past its refresh token's expiry is gone for good; one 29 days past, and a live one, stay", async () => {
    const userId: string = await addUser();

    const expiredLongAgo: string = await addSession({
      userId,
      refreshTokenExpiresAt: ago(31 * DAY),
    });
    const expiredLately: string = await addSession({
      userId,
      refreshTokenExpiresAt: ago(29 * DAY),
    });
    const live: string = await addSession({
      userId,
      refreshTokenExpiresAt: new Date(Date.now() + 10 * DAY),
    });

    const summary: OlderRowsPurgeSummary = await OlderRowsPurge.run({
      services: [UserSessionService],
    });

    expect(summary).toEqual({
      tables: 1,
      purged: 1,
      purgedTables: [{ table: "UserSession", purged: 1 }],
      failedTables: 0,
      isCutShort: false,
    });
    expect(await sessionExists(expiredLongAgo)).toBe(false);
    expect(await sessionExists(expiredLately)).toBe(true);
    expect(await sessionExists(live)).toBe(true);
    // The user the sessions were of stays.
    expect(await countOf("User", `"_id" = '${userId}'`)).toBe(1);

    // A second run has nothing left to delete.
    expect(
      (await OlderRowsPurge.run({ services: [UserSessionService] })).purged,
    ).toBe(0);
  });

  test("a backlog goes 1000 rows a statement, one DELETE a batch, until a batch removes nothing", async () => {
    const userId: string = await addUser();

    await addSessions({
      userId,
      count: 2 * OLDER_ROWS_PURGE_BATCH_SIZE + 500,
      expiredAt: ago(40 * DAY),
    });
    await addSessions({ userId, count: 10, expiredAt: ago(29 * DAY) });
    await addSessions({
      userId,
      count: 10,
      expiredAt: new Date(Date.now() + DAY),
    });

    const removed: Array<number> = [];
    const deletesPerBatch: Array<number> = [];
    // The most ids one DELETE named.
    let largestDelete: number = 0;

    for (let batch: number = 0; batch < 10; batch++) {
      statements = [];
      removed.push(await OlderRowsPurge.purgeBatch(UserSessionService));

      const deletes: Array<Statement> = statements.filter(
        (statement: Statement): boolean => {
          return DELETE_OF("UserSession").test(statement.sql);
        },
      );
      deletesPerBatch.push(deletes.length);

      // The ids each DELETE binds, one parameter each or in an array.
      for (const statement of deletes) {
        const ids: Array<unknown> = statement.parameters
          .flatMap((parameter: unknown): Array<unknown> => {
            return Array.isArray(parameter) ? parameter : [parameter];
          })
          .filter((parameter: unknown): boolean => {
            return (
              typeof parameter === "string" && ObjectID.isValidUUID(parameter)
            );
          });

        largestDelete = Math.max(largestDelete, ids.length);
      }

      statements = null;

      if (removed[removed.length - 1] === 0) {
        break;
      }
    }

    expect(removed).toEqual([1000, 1000, 500, 0]);
    expect(deletesPerBatch).toEqual([1, 1, 1, 0]);
    expect(largestDelete).toBe(OLDER_ROWS_PURGE_BATCH_SIZE);

    // The ten 29 days past expiry and the ten live ones are all that is left.
    expect(await countOf("UserSession")).toBe(20);
  });

  test("a run out of time takes one batch of each table, and the next run the rest", async () => {
    const userId: string = await addUser();
    const shortLinks: DatabaseService<BaseModel> = shortLinksAsOnCloud();

    await addSessions({
      userId,
      count: OLDER_ROWS_PURGE_BATCH_SIZE + 250,
      expiredAt: ago(40 * DAY),
    });
    await addShortLinks({
      count: OLDER_ROWS_PURGE_BATCH_SIZE + 100,
      createdAt: ago(4 * DAY),
    });
    await addShortLinks({ count: 5, createdAt: ago(2 * DAY) });

    const cutShort: OlderRowsPurgeSummary = await OlderRowsPurge.run({
      services: [UserSessionService, shortLinks],
      timeBudgetMs: 0,
    });

    expect(cutShort).toEqual({
      tables: 2,
      purged: 2000,
      purgedTables: [
        { table: "UserSession", purged: 1000 },
        { table: "ShortLink", purged: 1000 },
      ],
      failedTables: 0,
      isCutShort: true,
    });
    expect(await countOf("UserSession")).toBe(250);
    expect(await countOf("ShortLink")).toBe(105);

    const next: OlderRowsPurgeSummary = await OlderRowsPurge.run({
      services: [UserSessionService, shortLinks],
    });

    expect(next.purgedTables).toEqual([
      { table: "UserSession", purged: 250 },
      { table: "ShortLink", purged: 100 },
    ]);
    expect(next.isCutShort).toBe(false);
    expect(await countOf("UserSession")).toBe(0);
    // The links made 2 days ago are within the 3 days.
    expect(await countOf("ShortLink")).toBe(5);
  });

  test("a table that keeps its rows for ever is never read", async () => {
    // ShortLinkService as it is where billing is off: no window.
    const shortLinks: DatabaseService<BaseModel> =
      new DatabaseService<BaseModel>(
        ShortLink as unknown as { new (): BaseModel },
      );
    const userId: string = await addUser();

    await addShortLinks({ count: 20, createdAt: ago(400 * DAY) });
    await addSession({ userId, refreshTokenExpiresAt: ago(45 * DAY) });

    statements = [];

    const summary: OlderRowsPurgeSummary = await OlderRowsPurge.run({
      services: [shortLinks, UserSessionService],
    });

    const shortLinkStatements: Array<Statement> = statements.filter(
      (statement: Statement): boolean => {
        return NAMES("ShortLink").test(statement.sql);
      },
    );
    statements = null;

    expect(summary.tables).toBe(1);
    expect(summary.purgedTables).toEqual([{ table: "UserSession", purged: 1 }]);
    expect(shortLinkStatements).toEqual([]);
    expect(await countOf("ShortLink")).toBe(20);
  });

  test("a deadline that has passed deletes nothing", async () => {
    const userId: string = await addUser();
    await addSessions({ userId, count: 5, expiredAt: ago(40 * DAY) });

    const deadline: JobDeadline = new JobDeadline();
    deadline.end(new Error("The run lost its lock."));

    const summary: OlderRowsPurgeSummary = await OlderRowsPurge.run({
      services: [UserSessionService],
      deadline,
    });

    expect(summary.isCutShort).toBe(true);
    expect(summary.purged).toBe(0);
    expect(await countOf("UserSession")).toBe(5);
  });

  test("reaches the suite's own rows only: a session expired long ago in public, of a user the suite made there, is still there", async () => {
    publicUserId = ObjectID.generate().toString();
    const publicSession: string = ObjectID.generate().toString();

    await query(
      `INSERT INTO public."User" ("_id", "version", "email", "slug") VALUES ($1, 1, $2, $3)`,
      [
        publicUserId,
        `older-rows-purge-${publicUserId}@example.com`,
        `older-rows-purge-${publicUserId}`,
      ],
    );
    await query(
      `INSERT INTO public."UserSession" ("_id", "version", "userId", "refreshToken", "refreshTokenExpiresAt")
       VALUES ($1, 1, $2, $3, $4)`,
      [publicSession, publicUserId, nextToken(), ago(400 * DAY)],
    );

    const userId: string = await addUser();
    const own: string = await addSession({
      userId,
      refreshTokenExpiresAt: ago(400 * DAY),
    });

    expect(
      (await OlderRowsPurge.run({ services: [UserSessionService] })).purged,
    ).toBe(1);
    expect(await sessionExists(own)).toBe(false);

    const inPublic: Array<{ count: string }> = await query(
      `SELECT COUNT(*)::text AS "count" FROM public."UserSession" WHERE "_id" = $1`,
      [publicSession],
    );

    expect(inPublic[0]?.count).toBe("1");
  });
});
