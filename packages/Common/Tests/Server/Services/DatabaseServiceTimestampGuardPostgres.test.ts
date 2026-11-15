/** @timezone Asia/Kolkata */

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
import Entities from "../../../Models/DatabaseModels/Index";
import SecurityEventConnection from "../../../Models/DatabaseModels/SecurityEventConnection";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import DatabaseService from "../../../Server/Services/DatabaseService";
import ObjectID from "../../../Types/ObjectID";
import { DataSource, EntityMetadata } from "typeorm";
import { ColumnMetadata } from "typeorm/metadata/ColumnMetadata";

/*
 * A HOOK-FREE WRITE GUARDED ON A TIMESTAMP THE DATABASE STAMPED (#8173), ON
 * POSTGRES.
 *
 * compareAndSetColumnsByIdWithoutHooks, updateColumnsByIdWithoutHooks and
 * updateColumnsByIdIfUnlockedWithoutHooks take an `expectedData` guard:
 * write only while the row still holds what the caller read. node-postgres
 * reads a timestamptz to the millisecond and drops the microseconds
 * Postgres keeps; a value a statement stamps with now() keeps them. Compared
 * exactly, a guard on such a value as it was read never matched it, and the
 * write was refused on every attempt with no error. A Date on a timestamp
 * column is now compared with the column cut to the millisecond, the
 * precision it was read at. DatabaseServiceCompareAndSetColumns.test.ts pins
 * the statement; this runs it, through the real services and TypeORM's real
 * metadata, against rows Postgres stamped.
 *
 * The process runs in Asia/Kolkata and every Postgres session in
 * America/New_York, so neither zone can stand in for the other.
 *
 * Needs only a bare Postgres: CI's Common test job sets the flag for the one
 * test-setup.sh starts. The model's table is made from its own column
 * metadata in a schema of its own, dropped afterwards. Locally, against a
 * throwaway container:
 *
 *   docker run -d --name timestamp-guard-pg -e POSTGRES_PASSWORD=password \
 *     -e POSTGRES_DB=oneuptimedb -p 127.0.0.1:55432:5432 postgres:15
 *   RUN_POSTGRES_TIMESTAMP_GUARD_TESTS=true \
 *   TIMESTAMP_GUARD_TEST_DATABASE_HOST=127.0.0.1 \
 *   TIMESTAMP_GUARD_TEST_DATABASE_PORT=55432 \
 *   DATABASE_PASSWORD=password \
 *     npx jest Tests/Server/Services/DatabaseServiceTimestampGuardPostgres.test.ts
 *   docker rm -f timestamp-guard-pg
 */

const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_TIMESTAMP_GUARD_TESTS"] === "true"
    ? describe
    : describe.skip;

const SCHEMA: string = `timestamp_guard_${process.pid}_${Date.now()}`;

const SESSION_TIME_ZONE: string = "America/New_York";

// A stamp with microseconds, as now() leaves one; read, it is .123.
const STAMPED_SQL: string = "'2026-11-15 10:00:00.123456+00'";
const AS_READ: Date = new Date("2026-11-15T10:00:00.123Z");

describePostgres(
  "a hook-free write guarded on a timestamp, on Postgres",
  () => {
    let database: DataSource;
    let service: DatabaseService<SecurityEventConnection>;

    const table: () => string = (): string => {
      return `"${SCHEMA}"."${database.getMetadata(SecurityEventConnection).tableName}"`;
    };

    // A connection last polled at `polledAtSql`, an SQL expression: now(), or a literal.
    async function insertPolledAt(polledAtSql: string): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();

      await database.query(
        `INSERT INTO ${table()} ("_id", "projectId", "name", "lastPolledAt") VALUES ($1, $2, 'Before', ${polledAtSql})`,
        [id.toString(), ObjectID.generate().toString()],
      );

      return id;
    }

    // The row as a service reads it: through TypeORM, its dates to the millisecond.
    async function read(id: ObjectID): Promise<SecurityEventConnection> {
      const row: SecurityEventConnection | null = await database
        .getRepository(SecurityEventConnection)
        .findOne({
          where: { _id: id.toString() },
          select: { _id: true, name: true, lastPolledAt: true },
        });

      if (!row) {
        throw new Error(`no connection ${id.toString()}`);
      }

      return row;
    }

    // What Postgres holds, to the microsecond, in UTC.
    async function storedPolledAt(id: ObjectID): Promise<string | null> {
      const rows: Array<{ polledAt: string | null }> = await database.query(
        `SELECT to_char("lastPolledAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "polledAt" FROM ${table()} WHERE "_id" = $1`,
        [id.toString()],
      );

      return rows[0]!.polledAt;
    }

    async function claim(
      id: ObjectID,
      expectedPolledAt: unknown,
    ): Promise<boolean> {
      return await service.compareAndSetColumnsByIdWithoutHooks({
        id: id,
        data: { name: "Claimed" },
        expectedData: {
          lastPolledAt: expectedPolledAt as Date,
        },
      });
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host: process.env["TIMESTAMP_GUARD_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["TIMESTAMP_GUARD_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["TIMESTAMP_GUARD_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema: SCHEMA,
        synchronize: false,
        extra: {
          options: `-c search_path=${SCHEMA} -c TimeZone=${SESSION_TIME_ZONE}`,
        },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${SCHEMA}"`);

      /*
       * The model's own columns, typed as TypeORM types them (a date is a
       * timestamptz), without the foreign keys: the rows stand alone.
       */
      const metadata: EntityMetadata = database.getMetadata(
        SecurityEventConnection,
      );
      const columns: Map<string, string> = new Map<string, string>();

      for (const column of metadata.columns as Array<ColumnMetadata>) {
        if (columns.has(column.databaseName)) {
          continue;
        }

        let definition: string = database.driver.normalizeType(column);

        if (column.isPrimary) {
          definition += " PRIMARY KEY";
        } else if (column.isCreateDate || column.isUpdateDate) {
          definition += " NOT NULL DEFAULT now()";
        } else if (column.isVersion) {
          definition += " NOT NULL DEFAULT 1";
        }

        columns.set(column.databaseName, definition);
      }

      await database.query(
        `CREATE TABLE ${table()} (${Array.from(columns.entries())
          .map(([name, definition]: [string, string]): string => {
            return `"${name}" ${definition}`;
          })
          .join(", ")})`,
      );
    }, 120_000);

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
        await database.destroy();
      }
    });

    beforeEach(async () => {
      await database.query(`TRUNCATE ${table()}`);

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      service = new DatabaseService<SecurityEventConnection>(
        SecurityEventConnection,
      );
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("the premise: the stamp keeps microseconds, a read gives the millisecond, and the column is a timestamptz", async () => {
      const id: ObjectID = await insertPolledAt(STAMPED_SQL);

      expect(await storedPolledAt(id)).toBe("2026-11-15T10:00:00.123456Z");
      expect((await read(id)).lastPolledAt?.toISOString()).toBe(
        AS_READ.toISOString(),
      );

      const rows: Array<{ zone: string; type: string }> = await database.query(
        `SELECT current_setting('TimeZone') AS zone, data_type AS type FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = 'lastPolledAt'`,
        [SCHEMA, database.getMetadata(SecurityEventConnection).tableName],
      );

      expect(rows[0]).toEqual({
        zone: SESSION_TIME_ZONE,
        type: "timestamp with time zone",
      });
      expect(new Date().getTimezoneOffset()).toBe(-330);
    });

    test("the guard on the stamp as it was read holds, and the write lands (#8173)", async () => {
      const id: ObjectID = await insertPolledAt(STAMPED_SQL);

      await expect(claim(id, (await read(id)).lastPolledAt)).resolves.toBe(
        true,
      );

      expect((await read(id)).name).toBe("Claimed");
      // The guarded column is left exactly as it was, microseconds and all.
      expect(await storedPolledAt(id)).toBe("2026-11-15T10:00:00.123456Z");
    });

    test("so does one on a stamp of now() itself, as FirstPagedAt stamps one", async () => {
      const id: ObjectID = await insertPolledAt("now()");
      const asRead: Date = (await read(id)).lastPolledAt!;

      // What is stored is what was read, and the microseconds after it.
      expect((await storedPolledAt(id))!.slice(0, 23)).toBe(
        asRead.toISOString().slice(0, 23),
      );

      await expect(claim(id, asRead)).resolves.toBe(true);
      expect((await read(id)).name).toBe("Claimed");
    });

    test("the last microsecond of a millisecond is still that millisecond", async () => {
      const id: ObjectID = await insertPolledAt(
        "'2026-11-15 10:00:00.123999+00'",
      );

      expect((await read(id)).lastPolledAt?.toISOString()).toBe(
        AS_READ.toISOString(),
      );
      await expect(claim(id, AS_READ)).resolves.toBe(true);
    });

    test("a millisecond either side is another value, and refused: nothing is written", async () => {
      const id: ObjectID = await insertPolledAt(STAMPED_SQL);

      for (const expected of [
        new Date(AS_READ.getTime() - 1),
        new Date(AS_READ.getTime() + 1),
      ]) {
        await expect(claim(id, expected)).resolves.toBe(false);
      }

      expect((await read(id)).name).toBe("Before");
    });

    test("a stamp another writer moves on after the read refuses the write: the guard still guards", async () => {
      const id: ObjectID = await insertPolledAt(STAMPED_SQL);
      const asRead: Date = (await read(id)).lastPolledAt!;

      await database.query(
        `UPDATE ${table()} SET "lastPolledAt" = now() WHERE "_id" = $1`,
        [id.toString()],
      );

      await expect(claim(id, asRead)).resolves.toBe(false);
      expect((await read(id)).name).toBe("Before");
    });

    test("a value written from JavaScript, whole milliseconds, is guarded exactly as before", async () => {
      const id: ObjectID = await insertPolledAt("NULL");

      await service.updateColumnsByIdWithoutHooks({
        id: id,
        data: { lastPolledAt: AS_READ },
      });

      expect(await storedPolledAt(id)).toBe("2026-11-15T10:00:00.123000Z");

      await expect(claim(id, new Date(AS_READ.getTime() + 1))).resolves.toBe(
        false,
      );
      await expect(claim(id, AS_READ)).resolves.toBe(true);
    });

    test("a null guard holds only while the column has no value", async () => {
      const empty: ObjectID = await insertPolledAt("NULL");
      const stamped: ObjectID = await insertPolledAt(STAMPED_SQL);

      await expect(claim(stamped, null)).resolves.toBe(false);
      await expect(claim(empty, null)).resolves.toBe(true);

      // And a Date guard never holds on a column with no value.
      const alsoEmpty: ObjectID = await insertPolledAt("NULL");
      await expect(claim(alsoEmpty, AS_READ)).resolves.toBe(false);
    });

    test("text the caller chose is compared exactly, as it was written: to the microsecond it holds", async () => {
      const id: ObjectID = await insertPolledAt(STAMPED_SQL);

      // Cut to the millisecond, the text is not the stored value.
      await expect(claim(id, "2026-11-15T10:00:00.123Z")).resolves.toBe(false);
      await expect(claim(id, "2026-11-15T10:00:00.123456Z")).resolves.toBe(
        true,
      );
    });

    test("the plain write and the write that yields to a lock are guarded the same way", async () => {
      const plain: ObjectID = await insertPolledAt(STAMPED_SQL);
      const unlocked: ObjectID = await insertPolledAt(STAMPED_SQL);

      await service.updateColumnsByIdWithoutHooks({
        id: plain,
        data: { name: "Claimed" },
        expectedData: { lastPolledAt: (await read(plain)).lastPolledAt! },
      });

      await expect(
        service.updateColumnsByIdIfUnlockedWithoutHooks({
          id: unlocked,
          data: { name: "Claimed" },
          expectedData: { lastPolledAt: (await read(unlocked)).lastPolledAt! },
        }),
      ).resolves.toBe(true);

      expect((await read(plain)).name).toBe("Claimed");
      expect((await read(unlocked)).name).toBe("Claimed");

      // A millisecond off, neither writes.
      await service.updateColumnsByIdWithoutHooks({
        id: plain,
        data: { name: "Again" },
        expectedData: { lastPolledAt: new Date(AS_READ.getTime() + 1) },
      });

      await expect(
        service.updateColumnsByIdIfUnlockedWithoutHooks({
          id: unlocked,
          data: { name: "Again" },
          expectedData: { lastPolledAt: new Date(AS_READ.getTime() + 1) },
        }),
      ).resolves.toBe(false);

      expect((await read(plain)).name).toBe("Claimed");
      expect((await read(unlocked)).name).toBe("Claimed");
    });

    test("a guard on a stamp still matches the row by its id alone: another row in the same millisecond is never written", async () => {
      const target: ObjectID = await insertPolledAt(STAMPED_SQL);
      const neighbour: ObjectID = await insertPolledAt(STAMPED_SQL);

      await expect(claim(target, AS_READ)).resolves.toBe(true);

      expect((await read(target)).name).toBe("Claimed");
      expect((await read(neighbour)).name).toBe("Before");
    });
  },
);
