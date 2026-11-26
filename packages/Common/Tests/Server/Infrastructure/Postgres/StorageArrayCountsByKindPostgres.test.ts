import { AddStorageArrayCountsByKind1809187690000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187690000-AddStorageArrayCountsByKind";
import { MERGE_COUNTS_BY_KIND_SQL } from "../../../../Server/Services/StorageArrayService";
import ObjectID from "../../../../Types/ObjectID";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { DataSource, QueryRunner } from "typeorm";

/*
 * STORAGEARRAY.COUNTSBYKIND ON A REAL POSTGRES (#11000).
 *
 * A StorageArray table of the columns the migration and the merge read is
 * made in a schema of its own, as it was before the migration - without the
 * column - and filled with arrays of every kind of platform. Then:
 *
 *   - up() fills each FlashArray and FlashBlade with the counts of the kinds
 *     its platform reports, from the count columns, leaves out a NULL
 *     column, and leaves an array of another platform (or none yet) NULL;
 *   - re-running the backfill never overwrites counts already there;
 *   - the ingest's merge (StorageArrayService MERGE_COUNTS_BY_KIND_SQL)
 *     replaces only the kinds it brings, writes nothing when the row
 *     already holds them, never writes a deleted array, starts a NULL
 *     column, and yields at once instead of waiting on a row another
 *     transaction holds;
 *   - down() drops the column and up() adds it back.
 *
 * Opt in with RUN_POSTGRES_STORAGE_ARRAY_COUNTS_TESTS=true (the Common test
 * workflow does). It needs no migrated database: the schema it makes is
 * dropped after. Locally, against a throwaway container:
 *
 *   docker run -d --name storage-array-counts-pg -e POSTGRES_PASSWORD=password \
 *     -e POSTGRES_DB=oneuptimedb -p 127.0.0.1:55436:5432 postgres:15
 *   RUN_POSTGRES_STORAGE_ARRAY_COUNTS_TESTS=true \
 *   STORAGE_ARRAY_COUNTS_TEST_DATABASE_PORT=55436 DATABASE_PASSWORD=password \
 *     npx jest Tests/Server/Infrastructure/Postgres/StorageArrayCountsByKindPostgres.test.ts
 *   docker rm -f storage-array-counts-pg
 */

const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_STORAGE_ARRAY_COUNTS_TESTS"] === "true"
    ? describe
    : describe.skip;

interface ArrayRow {
  id: string;
  storageSystem: string | null;
  volumeCount?: number | null;
  hostCount?: number | null;
  podCount?: number | null;
  fileSystemCount?: number | null;
  bucketCount?: number | null;
  hardwareComponentCount?: number | null;
  deleted?: boolean;
}

describePostgres("StorageArray countsByKind against Postgres", () => {
  const schema: string = `storage_array_counts_test_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  const projectId: string = ObjectID.generate().toString();
  let database: DataSource;

  const connection: {
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
  } = {
    host: process.env["STORAGE_ARRAY_COUNTS_TEST_DATABASE_HOST"] || "localhost",
    port: Number(
      process.env["STORAGE_ARRAY_COUNTS_TEST_DATABASE_PORT"] || "5400",
    ),
    username: process.env["DATABASE_USERNAME"] || "postgres",
    password: process.env["DATABASE_PASSWORD"] || "password",
    database:
      process.env["STORAGE_ARRAY_COUNTS_TEST_DATABASE_NAME"] ||
      process.env["DATABASE_NAME"] ||
      "oneuptimedb",
  };

  const ARRAYS: Record<string, ArrayRow> = {
    flashArray: {
      id: ObjectID.generate().toString(),
      storageSystem: "purestorage.flasharray",
      volumeCount: 120,
      hostCount: 14,
      podCount: 0,
      fileSystemCount: 0,
      bucketCount: 0,
      hardwareComponentCount: 31,
    },
    flashArrayWithANullCount: {
      id: ObjectID.generate().toString(),
      storageSystem: "purestorage.flasharray",
      volumeCount: 3,
      hostCount: null,
      podCount: 1,
      hardwareComponentCount: 9,
    },
    flashBlade: {
      id: ObjectID.generate().toString(),
      storageSystem: "purestorage.flashblade",
      volumeCount: 0,
      hostCount: 0,
      podCount: 0,
      fileSystemCount: 6,
      bucketCount: 2,
      hardwareComponentCount: 18,
    },
    anotherPlatform: {
      id: ObjectID.generate().toString(),
      storageSystem: "netapp.ontap",
      volumeCount: 0,
    },
    notReportedYet: {
      id: ObjectID.generate().toString(),
      storageSystem: null,
    },
    deletedFlashArray: {
      id: ObjectID.generate().toString(),
      storageSystem: "purestorage.flasharray",
      volumeCount: 7,
      hostCount: 2,
      podCount: 0,
      hardwareComponentCount: 5,
      deleted: true,
    },
  };

  async function runInSchema(
    step: (queryRunner: QueryRunner) => Promise<void>,
  ): Promise<void> {
    const queryRunner: QueryRunner = database.createQueryRunner();
    try {
      await queryRunner.query(`SET search_path TO "${schema}"`);
      await step(queryRunner);
    } finally {
      await queryRunner.release();
    }
  }

  async function countsOf(id: string): Promise<unknown> {
    const rows: Array<{ countsByKind: unknown }> = await database.query(
      `SELECT "countsByKind" FROM "${schema}"."StorageArray" WHERE "_id" = $1`,
      [id],
    );
    expect(rows).toHaveLength(1);
    return rows[0]!.countsByKind;
  }

  async function merge(
    id: string,
    counts: Record<string, number>,
  ): Promise<Array<{ _id: string }>> {
    let rows: Array<{ _id: string }> = [];
    await runInSchema(async (queryRunner: QueryRunner): Promise<void> => {
      rows = await queryRunner.query(MERGE_COUNTS_BY_KIND_SQL, [
        id,
        JSON.stringify(counts),
      ]);
    });
    return rows;
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      ...connection,
      synchronize: false,
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    // The columns the migration and the merge read, as before the migration.
    await database.query(
      `CREATE TABLE "${schema}"."StorageArray" (
         "_id" uuid PRIMARY KEY,
         "version" integer NOT NULL DEFAULT 1,
         "projectId" uuid NOT NULL,
         "name" character varying NOT NULL,
         "slug" character varying NOT NULL,
         "storageSystem" character varying,
         "volumeCount" integer,
         "hostCount" integer,
         "podCount" integer,
         "fileSystemCount" integer,
         "bucketCount" integer,
         "hardwareComponentCount" integer,
         "deletedAt" timestamp with time zone
       )`,
    );

    let index: number = 0;
    for (const row of Object.values(ARRAYS)) {
      index++;
      await database.query(
        `INSERT INTO "${schema}"."StorageArray"
           ("_id", "version", "projectId", "name", "slug", "storageSystem",
            "volumeCount", "hostCount", "podCount", "fileSystemCount",
            "bucketCount", "hardwareComponentCount", "deletedAt")
         VALUES ($1, 1, $2, $3, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          row.id,
          projectId,
          `array-${index}`,
          row.storageSystem,
          row.volumeCount ?? null,
          row.hostCount ?? null,
          row.podCount ?? null,
          row.fileSystemCount ?? null,
          row.bucketCount ?? null,
          row.hardwareComponentCount ?? null,
          row.deleted ? new Date() : null,
        ],
      );
    }

    await runInSchema(async (queryRunner: QueryRunner): Promise<void> => {
      await new AddStorageArrayCountsByKind1809187690000().up(queryRunner);
    });
  }, 120_000);

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  test("adds a nullable jsonb column with no default", async () => {
    const columns: Array<{
      udt_name: string;
      is_nullable: string;
      column_default: string | null;
    }> = await database.query(
      `SELECT udt_name, is_nullable, column_default FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'StorageArray' AND column_name = 'countsByKind'`,
      [schema],
    );
    expect(columns).toEqual([
      { udt_name: "jsonb", is_nullable: "YES", column_default: null },
    ]);
  });

  test("a FlashArray gets its volumes, hosts, pods and hardware", async () => {
    expect(await countsOf(ARRAYS["flashArray"]!.id)).toEqual({
      Volume: 120,
      Host: 14,
      Pod: 0,
      Hardware: 31,
    });
  });

  test("a NULL count column leaves its kind out", async () => {
    expect(await countsOf(ARRAYS["flashArrayWithANullCount"]!.id)).toEqual({
      Volume: 3,
      Pod: 1,
      Hardware: 9,
    });
  });

  test("a FlashBlade gets its file systems, buckets and hardware, never a FlashArray's kinds", async () => {
    expect(await countsOf(ARRAYS["flashBlade"]!.id)).toEqual({
      FileSystem: 6,
      Bucket: 2,
      Hardware: 18,
    });
  });

  test("an array of another platform, or of none yet, keeps NULL", async () => {
    expect(await countsOf(ARRAYS["anotherPlatform"]!.id)).toBeNull();
    expect(await countsOf(ARRAYS["notReportedYet"]!.id)).toBeNull();
  });

  test("a deleted array is filled too, for the day it is restored", async () => {
    expect(await countsOf(ARRAYS["deletedFlashArray"]!.id)).toEqual({
      Volume: 7,
      Host: 2,
      Pod: 0,
      Hardware: 5,
    });
  });

  test("re-running the backfill never overwrites counts already there", async () => {
    const id: string = ARRAYS["flashArray"]!.id;
    await database.query(
      `UPDATE "${schema}"."StorageArray" SET "countsByKind" = $2::jsonb WHERE "_id" = $1`,
      [id, JSON.stringify({ Volume: 121, Host: 14, Pod: 0, Hardware: 31 })],
    );

    const statements: Array<string> = [];
    await runInSchema(async (queryRunner: QueryRunner): Promise<void> => {
      const recorder: QueryRunner = {
        query: async (sql: string): Promise<unknown> => {
          statements.push(sql);
          return [];
        },
      } as unknown as QueryRunner;
      await new AddStorageArrayCountsByKind1809187690000().up(recorder);
      for (const statement of statements.slice(1)) {
        await queryRunner.query(statement);
      }
    });

    expect(await countsOf(id)).toEqual({
      Volume: 121,
      Host: 14,
      Pod: 0,
      Hardware: 31,
    });
  });

  test("the ingest's merge replaces only the kinds it brings", async () => {
    const id: string = ARRAYS["flashBlade"]!.id;
    const written: Array<{ _id: string }> = await merge(id, { Bucket: 3 });
    expect(written).toEqual([{ _id: id }]);
    expect(await countsOf(id)).toEqual({
      FileSystem: 6,
      Bucket: 3,
      Hardware: 18,
    });
  });

  test("a kind whose last object was deleted is merged as 0, not dropped", async () => {
    const id: string = ARRAYS["flashBlade"]!.id;
    await merge(id, { Bucket: 0 });
    expect(await countsOf(id)).toEqual({
      FileSystem: 6,
      Bucket: 0,
      Hardware: 18,
    });
  });

  test("merging what the row already holds writes nothing", async () => {
    const id: string = ARRAYS["flashBlade"]!.id;
    const before: Array<{ xmin: string }> = await database.query(
      `SELECT xmin::text AS xmin FROM "${schema}"."StorageArray" WHERE "_id" = $1`,
      [id],
    );
    expect(await merge(id, { FileSystem: 6, Bucket: 0 })).toEqual([]);
    const after: Array<{ xmin: string }> = await database.query(
      `SELECT xmin::text AS xmin FROM "${schema}"."StorageArray" WHERE "_id" = $1`,
      [id],
    );
    // No new row version: the statement matched nothing.
    expect(after).toEqual(before);
  });

  test("a NULL column is started by the first merge, and a platform's own kind is kept as it came", async () => {
    const id: string = ARRAYS["anotherPlatform"]!.id;
    expect(await merge(id, { Aggregate: 4, Volume: 18 })).toEqual([
      { _id: id },
    ]);
    expect(await countsOf(id)).toEqual({ Aggregate: 4, Volume: 18 });
  });

  test("a deleted array is never merged into", async () => {
    const id: string = ARRAYS["deletedFlashArray"]!.id;
    expect(await merge(id, { Volume: 99 })).toEqual([]);
    expect(await countsOf(id)).toEqual({
      Volume: 7,
      Host: 2,
      Pod: 0,
      Hardware: 5,
    });
  });

  test("a row another transaction holds is skipped at once, never waited for", async () => {
    const id: string = ARRAYS["flashArray"]!.id;
    const holder: QueryRunner = database.createQueryRunner();
    await holder.connect();
    try {
      await holder.startTransaction();
      await holder.query(
        `SELECT "_id" FROM "${schema}"."StorageArray" WHERE "_id" = $1 FOR UPDATE`,
        [id],
      );

      /*
       * SKIP LOCKED: the merge answers while the row is still held. A
       * statement that waited for the lock would block here until the
       * holder let go - after this line - and never return.
       */
      expect(await merge(id, { Volume: 500 })).toEqual([]);
    } finally {
      await holder.rollbackTransaction();
      await holder.release();
    }

    // Once the row is free, the next batch's merge lands.
    expect(await merge(id, { Volume: 500 })).toEqual([{ _id: id }]);
    expect(await countsOf(id)).toEqual({
      Volume: 500,
      Host: 14,
      Pod: 0,
      Hardware: 31,
    });
  });

  test("down() drops the column, and up() adds it back", async () => {
    await runInSchema(async (queryRunner: QueryRunner): Promise<void> => {
      await new AddStorageArrayCountsByKind1809187690000().down(queryRunner);
    });
    const without: Array<unknown> = await database.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'StorageArray' AND column_name = 'countsByKind'`,
      [schema],
    );
    expect(without).toHaveLength(0);

    await runInSchema(async (queryRunner: QueryRunner): Promise<void> => {
      await new AddStorageArrayCountsByKind1809187690000().up(queryRunner);
    });
    expect(await countsOf(ARRAYS["flashArray"]!.id)).toEqual({
      Volume: 120,
      Host: 14,
      Pod: 0,
      Hardware: 31,
    });
  });
});
