import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import TelemetryIngestionKeyRefusalService, {
  MAX_TELEMETRY_INGEST_REFUSAL_ROWS_PER_STATEMENT,
  MAX_TELEMETRY_INGEST_REFUSED_COUNT,
  TelemetryIngestRefusalBatch,
  TelemetryIngestRefusalUpsert,
  buildTelemetryIngestRefusalUpsert,
} from "../../../Server/Services/TelemetryIngestionKeyRefusalService";
import logger from "../../../Server/Utils/Logger";
import { TelemetryIngestRefusalCounter } from "../../../Server/Utils/Telemetry/TelemetryIngestRefusalRecorder";
import ObjectID from "../../../Types/ObjectID";
import { TelemetryIngestRefusalReason } from "../../../Types/Telemetry/TelemetryIngestRefusal";
import TelemetryIngestSurface from "../../../Types/Telemetry/TelemetryIngestSurface";
import { DataSource, EntityManager } from "typeorm";

/*
 * What ingest refused, counted against a real Postgres (issue #6378).
 *
 * TelemetryIngestionKeyRefusalService.addRefusals is hand-written SQL - an
 * INSERT ... SELECT FROM (VALUES ...) WHERE EXISTS ... ON CONFLICT DO UPDATE
 * a statement - and the unit suites replace manager.query with a mock, so a
 * renamed column, a unique index that no longer matches the ON CONFLICT
 * target or a cast Postgres reads differently would pass them, and then fail
 * every write of the counts the RUM setup check and the key's page read.
 * Here the real service runs against structure-only clones of the MIGRATED
 * tables:
 *
 *   - the migrated table keeps one row per key, reason and surface (the
 *     unique index ON CONFLICT names), and its rows go with their key and
 *     their project;
 *   - a first refusal inserts its row, and a later batch adds to it: counts
 *     summed, the earliest first and the latest last kept, out of order too;
 *   - batches that share a row in one call are added together first, which
 *     Postgres requires;
 *   - a key that is gone, or another project's, is skipped and the rest of
 *     its statement still written;
 *   - the count stops at the integer column's bound;
 *   - more rows than one statement takes go as several, and all are written;
 *   - writers on one row at once (two ingest pods) add up;
 *   - a flood of refusals counted by TelemetryIngestRefusalCounter is ONE
 *     statement.
 *
 * Opt in with RUN_POSTGRES_TELEMETRY_INGEST_REFUSAL_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database right after its drift check. Credentials from
 * DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * TELEMETRY_INGEST_REFUSAL_TEST_DATABASE_NAME or DATABASE_NAME, endpoint
 * from TELEMETRY_INGEST_REFUSAL_TEST_DATABASE_HOST / _PORT (default
 * localhost:5400). Every table and row lives in a unique schema that is
 * dropped afterwards; search_path holds only that schema, so a statement
 * naming a table that was not cloned fails loudly instead of touching real
 * data.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_TELEMETRY_INGEST_REFUSAL_TESTS"] === "true"
    ? describe
    : describe.skip;

interface RefusalRow {
  projectId: string;
  telemetryIngestionKeyId: string;
  reason: string;
  surface: string;
  refusedCount: number;
  firstRefusedAt: Date;
  lastRefusedAt: Date;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const TEN_O_CLOCK: Date = new Date("2026-11-09T10:00:00.000Z");

function minutesAfterTen(minutes: number): Date {
  return new Date(TEN_O_CLOCK.getTime() + minutes * 60 * 1000);
}

describePostgres(
  "refused telemetry counted per ingestion key, in Postgres",
  () => {
    const schema: string = `ingest_refusal_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;
    let database: DataSource;

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["TELEMETRY_INGEST_REFUSAL_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["TELEMETRY_INGEST_REFUSAL_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["TELEMETRY_INGEST_REFUSAL_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: {
          options: `-c search_path=${schema}`,
        },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of [
        "TelemetryIngestionKey",
        "TelemetryIngestionKeyRefusal",
      ]) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      /*
       * A key fixture names only its id and its project. The refusal table
       * stays as migrated: its NOT NULL columns and defaults are what the
       * upsert has to satisfy.
       */
      const columns: Array<{ column_name: string }> = await database.query(
        `SELECT column_name FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'TelemetryIngestionKey' AND is_nullable = 'NO' AND column_name NOT IN ('_id', 'projectId')`,
        [schema],
      );

      for (const column of columns) {
        await database.query(
          `ALTER TABLE "${schema}"."TelemetryIngestionKey" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
        );
      }

      expect(
        (await database.query("SELECT current_schema()"))[0].current_schema,
      ).toBe(schema);
    });

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    beforeEach(async () => {
      for (const level of ["debug", "info", "warn"] as const) {
        jest.spyOn(logger, level).mockImplementation(() => {
          return undefined as never;
        });
      }
      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      await database.query(
        `DELETE FROM "${schema}"."TelemetryIngestionKeyRefusal"`,
      );
      await database.query(`DELETE FROM "${schema}"."TelemetryIngestionKey"`);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    async function insertKey(projectId: ObjectID): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      await database.query(
        `INSERT INTO "${schema}"."TelemetryIngestionKey" ("_id", "projectId") VALUES ($1, $2)`,
        [id.toString(), projectId.toString()],
      );
      return id;
    }

    function batch(
      data: Pick<
        TelemetryIngestRefusalBatch,
        "projectId" | "telemetryIngestionKeyId"
      > &
        Partial<TelemetryIngestRefusalBatch>,
    ): TelemetryIngestRefusalBatch {
      return {
        reason: TelemetryIngestRefusalReason.KeyDisabled,
        surface: TelemetryIngestSurface.OtelTraces,
        count: 1,
        firstRefusedAt: TEN_O_CLOCK,
        lastRefusedAt: TEN_O_CLOCK,
        ...data,
      };
    }

    async function readRows(): Promise<Array<RefusalRow>> {
      return database.query(
        `SELECT "projectId", "telemetryIngestionKeyId", "reason", "surface", "refusedCount", "firstRefusedAt", "lastRefusedAt", "version", "createdAt", "updatedAt"
        FROM "${schema}"."TelemetryIngestionKeyRefusal"
        ORDER BY "telemetryIngestionKeyId", "reason", "surface"`,
      );
    }

    // The upserts the service sent, from a spy on the manager it writes with.
    function countUpserts(spy: jest.SpyInstance): number {
      return spy.mock.calls.filter((call: Array<unknown>): boolean => {
        return String(call[0]).startsWith(
          'INSERT INTO "TelemetryIngestionKeyRefusal"',
        );
      }).length;
    }

    test("the migrated table keeps one row per key, reason and surface, and its rows go with their key and project", async () => {
      const indexes: Array<{ indexdef: string }> = await database.query(
        `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'TelemetryIngestionKeyRefusal'`,
      );

      const unique: Array<string> = indexes
        .map((index: { indexdef: string }): string => {
          return index.indexdef;
        })
        .filter((definition: string): boolean => {
          return definition.startsWith("CREATE UNIQUE INDEX");
        });

      // The primary key's, and the one the upsert's ON CONFLICT names, on exactly its columns.
      expect(unique).toHaveLength(2);
      expect(
        unique.filter((definition: string): boolean => {
          return definition.endsWith(
            'USING btree ("telemetryIngestionKeyId", reason, surface)',
          );
        }),
      ).toHaveLength(1);

      const foreignKeys: Array<{
        columnName: string;
        referenced: string;
        onDelete: string;
      }> = await database.query(
        `SELECT
          (SELECT string_agg(attribute.attname::text, ',') FROM pg_attribute AS attribute
            WHERE attribute.attrelid = constraint_row.conrelid AND attribute.attnum = ANY (constraint_row.conkey)) AS "columnName",
          (SELECT referenced.relname::text FROM pg_class AS referenced WHERE referenced.oid = constraint_row.confrelid) AS "referenced",
          constraint_row.confdeltype::text AS "onDelete"
        FROM pg_constraint AS constraint_row
        JOIN pg_class AS own ON own.oid = constraint_row.conrelid
        JOIN pg_namespace AS namespace ON namespace.oid = own.relnamespace
        WHERE namespace.nspname = 'public' AND own.relname = 'TelemetryIngestionKeyRefusal' AND constraint_row.contype = 'f'
        ORDER BY 1`,
      );

      // "c": ON DELETE CASCADE. A deleted key, or project, takes its counts with it.
      expect(foreignKeys).toEqual([
        { columnName: "deletedByUserId", referenced: "User", onDelete: "n" },
        { columnName: "projectId", referenced: "Project", onDelete: "c" },
        {
          columnName: "telemetryIngestionKeyId",
          referenced: "TelemetryIngestionKey",
          onDelete: "c",
        },
      ]);
    });

    test("a first refusal inserts its row", async () => {
      const projectId: ObjectID = ObjectID.generate();
      const keyId: ObjectID = await insertKey(projectId);

      await TelemetryIngestionKeyRefusalService.addRefusals([
        batch({
          projectId,
          telemetryIngestionKeyId: keyId,
          count: 3,
          firstRefusedAt: TEN_O_CLOCK,
          lastRefusedAt: minutesAfterTen(2),
        }),
      ]);

      const rows: Array<RefusalRow> = await readRows();

      expect(rows).toEqual([
        expect.objectContaining({
          projectId: projectId.toString(),
          telemetryIngestionKeyId: keyId.toString(),
          reason: TelemetryIngestRefusalReason.KeyDisabled,
          surface: TelemetryIngestSurface.OtelTraces,
          refusedCount: 3,
          firstRefusedAt: TEN_O_CLOCK,
          lastRefusedAt: minutesAfterTen(2),
          version: 1,
        }),
      ]);
      expect(rows[0]!.createdAt).toBeInstanceOf(Date);
      expect(rows[0]!.updatedAt).toBeInstanceOf(Date);
    });

    test("a later batch adds to the row: the count summed, the earliest first and the latest last kept", async () => {
      const projectId: ObjectID = ObjectID.generate();
      const keyId: ObjectID = await insertKey(projectId);

      await TelemetryIngestionKeyRefusalService.addRefusals([
        batch({
          projectId,
          telemetryIngestionKeyId: keyId,
          count: 3,
          firstRefusedAt: TEN_O_CLOCK,
          lastRefusedAt: minutesAfterTen(1),
        }),
      ]);
      const inserted: RefusalRow | undefined = (await readRows())[0];
      expect(inserted).toBeDefined();

      // Another pod's batch, begun earlier and ended later.
      await TelemetryIngestionKeyRefusalService.addRefusals([
        batch({
          projectId,
          telemetryIngestionKeyId: keyId,
          count: 4,
          firstRefusedAt: minutesAfterTen(-2),
          lastRefusedAt: minutesAfterTen(5),
        }),
      ]);

      // A late write of refusals in between moves neither end.
      await TelemetryIngestionKeyRefusalService.addRefusals([
        batch({
          projectId,
          telemetryIngestionKeyId: keyId,
          count: 1,
          firstRefusedAt: minutesAfterTen(2),
          lastRefusedAt: minutesAfterTen(3),
        }),
      ]);

      const rows: Array<RefusalRow> = await readRows();

      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual(
        expect.objectContaining({
          refusedCount: 8,
          firstRefusedAt: minutesAfterTen(-2),
          lastRefusedAt: minutesAfterTen(5),
          version: 1,
          createdAt: inserted!.createdAt,
        }),
      );
      expect(rows[0]!.updatedAt.getTime()).toBeGreaterThanOrEqual(
        inserted!.updatedAt.getTime(),
      );
    });

    test("each reason and each surface of a key has a row of its own", async () => {
      const projectId: ObjectID = ObjectID.generate();
      const keyId: ObjectID = await insertKey(projectId);

      await TelemetryIngestionKeyRefusalService.addRefusals([
        batch({ projectId, telemetryIngestionKeyId: keyId, count: 1 }),
        batch({
          projectId,
          telemetryIngestionKeyId: keyId,
          reason: TelemetryIngestRefusalReason.OriginNotAllowed,
          count: 2,
        }),
        batch({
          projectId,
          telemetryIngestionKeyId: keyId,
          surface: TelemetryIngestSurface.OtelLogs,
          count: 4,
        }),
      ]);

      expect(
        (await readRows()).map((row: RefusalRow): string => {
          return `${row.reason} ${row.surface} ${row.refusedCount}`;
        }),
      ).toEqual([
        "key-disabled otel-logs 4",
        "key-disabled otel-traces 1",
        "origin-not-allowed otel-traces 2",
      ]);
    });

    test("batches that share a row in one call are added together, which Postgres requires", async () => {
      const projectId: ObjectID = ObjectID.generate();
      const keyId: ObjectID = await insertKey(projectId);
      const sameRow: Array<TelemetryIngestRefusalBatch> = [
        batch({
          projectId,
          telemetryIngestionKeyId: keyId,
          count: 2,
          firstRefusedAt: TEN_O_CLOCK,
          lastRefusedAt: TEN_O_CLOCK,
        }),
        batch({
          projectId,
          telemetryIngestionKeyId: keyId,
          count: 5,
          firstRefusedAt: minutesAfterTen(-60),
          lastRefusedAt: minutesAfterTen(60),
        }),
      ];

      // Unmerged, one statement would update the same row twice.
      const unmerged: TelemetryIngestRefusalUpsert =
        buildTelemetryIngestRefusalUpsert(sameRow);
      await expect(
        database.query(unmerged.query, unmerged.parameters),
      ).rejects.toThrow("cannot affect row a second time");

      await TelemetryIngestionKeyRefusalService.addRefusals(sameRow);

      expect(await readRows()).toEqual([
        expect.objectContaining({
          refusedCount: 7,
          firstRefusedAt: minutesAfterTen(-60),
          lastRefusedAt: minutesAfterTen(60),
        }),
      ]);
    });

    test("a key that is gone, or another project's, is skipped, and the rest of the statement is written", async () => {
      const projectId: ObjectID = ObjectID.generate();
      const keyId: ObjectID = await insertKey(projectId);
      const otherProjectsKeyId: ObjectID = await insertKey(ObjectID.generate());
      const goneKeyId: ObjectID = ObjectID.generate();
      const manager: EntityManager = database.manager;
      const querySpy: jest.SpyInstance = jest.spyOn(manager, "query");

      await TelemetryIngestionKeyRefusalService.addRefusals([
        batch({ projectId, telemetryIngestionKeyId: goneKeyId, count: 9 }),
        batch({
          projectId,
          telemetryIngestionKeyId: otherProjectsKeyId,
          count: 9,
        }),
        batch({ projectId, telemetryIngestionKeyId: keyId, count: 2 }),
      ]);

      // One statement, which wrote the one key of this project.
      expect(countUpserts(querySpy)).toBe(1);
      expect(
        (await readRows()).map((row: RefusalRow): string => {
          return `${row.telemetryIngestionKeyId} ${row.refusedCount}`;
        }),
      ).toEqual([`${keyId.toString()} 2`]);
    });

    test("the count stops at the integer column's bound instead of failing", async () => {
      const projectId: ObjectID = ObjectID.generate();
      const keyId: ObjectID = await insertKey(projectId);
      const otherKeyId: ObjectID = await insertKey(projectId);

      await TelemetryIngestionKeyRefusalService.addRefusals([
        batch({
          projectId,
          telemetryIngestionKeyId: keyId,
          count: MAX_TELEMETRY_INGEST_REFUSED_COUNT - 5,
        }),
        // A batch above the bound is stored at the bound.
        batch({
          projectId,
          telemetryIngestionKeyId: otherKeyId,
          count: Number.MAX_SAFE_INTEGER,
        }),
      ]);
      await TelemetryIngestionKeyRefusalService.addRefusals([
        batch({ projectId, telemetryIngestionKeyId: keyId, count: 10 }),
        batch({
          projectId,
          telemetryIngestionKeyId: otherKeyId,
          count: MAX_TELEMETRY_INGEST_REFUSED_COUNT,
        }),
      ]);

      const counts: Array<number> = (await readRows()).map(
        (row: RefusalRow): number => {
          return row.refusedCount;
        },
      );

      expect(counts).toEqual([
        MAX_TELEMETRY_INGEST_REFUSED_COUNT,
        MAX_TELEMETRY_INGEST_REFUSED_COUNT,
      ]);
    });

    test("more rows than one statement takes go as several statements, and every row is written", async () => {
      const projectId: ObjectID = ObjectID.generate();
      const keyCount: number =
        2 * MAX_TELEMETRY_INGEST_REFUSAL_ROWS_PER_STATEMENT + 1;

      await database.query(
        `INSERT INTO "${schema}"."TelemetryIngestionKey" ("_id", "projectId")
        SELECT gen_random_uuid(), $1::uuid FROM generate_series(1, $2::integer)`,
        [projectId.toString(), keyCount],
      );
      const keys: Array<{ _id: string }> = await database.query(
        `SELECT "_id" FROM "${schema}"."TelemetryIngestionKey" WHERE "projectId" = $1`,
        [projectId.toString()],
      );
      expect(keys).toHaveLength(keyCount);

      const manager: EntityManager = database.manager;
      const querySpy: jest.SpyInstance = jest.spyOn(manager, "query");

      await TelemetryIngestionKeyRefusalService.addRefusals(
        keys.map((key: { _id: string }): TelemetryIngestRefusalBatch => {
          return batch({
            projectId,
            telemetryIngestionKeyId: new ObjectID(key._id),
            count: 2,
          });
        }),
      );

      expect(countUpserts(querySpy)).toBe(3);

      const totals: Array<{ rows: string; refused: string }> =
        await database.query(
          `SELECT count(*) AS "rows", sum("refusedCount") AS "refused" FROM "${schema}"."TelemetryIngestionKeyRefusal"`,
        );
      expect(totals[0]).toEqual({
        rows: String(keyCount),
        refused: String(2 * keyCount),
      });
    });

    test("writers on one row at once, as two ingest pods are, add up", async () => {
      const projectId: ObjectID = ObjectID.generate();
      const keyId: ObjectID = await insertKey(projectId);
      const writers: number = 8;

      await Promise.all(
        Array.from(
          { length: writers },
          (_: unknown, index: number): Promise<void> => {
            return TelemetryIngestionKeyRefusalService.addRefusals([
              batch({
                projectId,
                telemetryIngestionKeyId: keyId,
                count: 3,
                firstRefusedAt: minutesAfterTen(index),
                lastRefusedAt: minutesAfterTen(index),
              }),
            ]);
          },
        ),
      );

      expect(await readRows()).toEqual([
        expect.objectContaining({
          refusedCount: 3 * writers,
          firstRefusedAt: TEN_O_CLOCK,
          lastRefusedAt: minutesAfterTen(writers - 1),
        }),
      ]);
    });

    test("a flood of refusals, counted by the recorder, is written in one statement", async () => {
      const projectId: ObjectID = ObjectID.generate();
      const keyId: ObjectID = await insertKey(projectId);
      const writes: Array<number> = [];
      const counter: TelemetryIngestRefusalCounter =
        new TelemetryIngestRefusalCounter(
          async (
            batches: Array<TelemetryIngestRefusalBatch>,
          ): Promise<void> => {
            writes.push(batches.length);
            await TelemetryIngestionKeyRefusalService.addRefusals(batches);
          },
          (): number => {
            return minutesAfterTen(1).getTime();
          },
        );
      const manager: EntityManager = database.manager;
      const querySpy: jest.SpyInstance = jest.spyOn(manager, "query");

      try {
        for (let index: number = 0; index < 10000; index++) {
          counter.record({
            projectId,
            ingestionKeyId: keyId,
            reason:
              index % 2 === 0
                ? TelemetryIngestRefusalReason.KeyDisabled
                : TelemetryIngestRefusalReason.OriginNotAllowed,
            surface: TelemetryIngestSurface.OtelLogs,
          });
        }

        await counter.flushAll();
      } finally {
        counter.reset();
      }

      // One write of the two rows, as one statement.
      expect(writes).toEqual([2]);
      expect(countUpserts(querySpy)).toBe(1);
      expect(
        (await readRows()).map((row: RefusalRow): string => {
          return `${row.reason} ${row.surface} ${row.refusedCount}`;
        }),
      ).toEqual([
        "key-disabled otel-logs 5000",
        "origin-not-allowed otel-logs 5000",
      ]);
    });
  },
);
