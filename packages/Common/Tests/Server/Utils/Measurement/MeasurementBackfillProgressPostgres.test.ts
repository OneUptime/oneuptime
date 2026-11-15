import AlertMeasurement from "../../../../Models/DatabaseModels/AlertMeasurement";
import Entities from "../../../../Models/DatabaseModels/Index";
import IncidentMeasurement from "../../../../Models/DatabaseModels/IncidentMeasurement";
import ScheduledMaintenanceMeasurement from "../../../../Models/DatabaseModels/ScheduledMaintenanceMeasurement";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import logger from "../../../../Server/Utils/Logger";
import MeasurementBackfillProgress, {
  MeasurementBackfillCursor,
  MeasurementBackfillProgressWrite,
} from "../../../../Server/Utils/Measurement/MeasurementBackfillProgress";
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
import { DataSource, QueryRunner } from "typeorm";

/*
 * A MEASUREMENT BACKFILL'S WRITES AGAINST POSTGRES
 * (MeasurementBackfillProgress, #8105).
 *
 * Every write of a walk - each page's cursor, and the completion stamp - is
 * one statement that writes only while the measurement's
 * backfillRequestedAt is still the stamp the walk read, so an edit of the
 * measurement made while it is walked (a new stamp, the cursor and the
 * completion cleared) always wins. The unit suites fake the connection, so
 * only a database shows:
 *
 *   - that the guard compares to the millisecond: a request stamped by the
 *     database itself (FirstPagedAt's now()) keeps microseconds that
 *     node-postgres drops when the walk reads it, and an exact comparison
 *     refuses every write of that walk (as
 *     compareAndSetColumnsByIdWithoutHooks did, until it too compared a
 *     timestamp to the millisecond, #8173);
 *   - that there is no window between the guard and the write: an edit that
 *     commits while the walk's write waits for the row is still never
 *     written over;
 *   - that a refused write is reported as refused through TypeORM;
 *   - that the cursor's two columns - the createdAt and the id of the
 *     record a page ended on (#8171) - are written together, and that an
 *     edit's clearing of both is never written over.
 *
 * Opt in with RUN_POSTGRES_MEASUREMENT_BACKFILL_PROGRESS_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database right after its drift check. The three measurement
 * tables' STRUCTURE is cloned into a unique schema (search_path holds only
 * that schema) that is dropped afterwards. Credentials from
 * DATABASE_USERNAME / DATABASE_PASSWORD, database from
 * MEASUREMENT_BACKFILL_PROGRESS_TEST_DATABASE_NAME or DATABASE_NAME,
 * endpoint from MEASUREMENT_BACKFILL_PROGRESS_TEST_DATABASE_HOST / _PORT
 * (default localhost:5400, Scripts/Dev/docker-compose.dev.yml).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_MEASUREMENT_BACKFILL_PROGRESS_TESTS"] === "true"
    ? describe
    : describe.skip;

// A write that waits on a row for longer than this fails, never hangs.
const LOCK_TIMEOUT_MS: number = 5000;

const TABLES: Array<string> = [
  "IncidentMeasurement",
  "AlertMeasurement",
  "ScheduledMaintenanceMeasurement",
];

// What one measurement row holds of its backfill.
interface StoredBackfill {
  backfillRequestedAt: Date | null;
  backfillCursorCreatedAt: Date | null;
  backfillCursorId: string | null;
  backfillCompletedAt: Date | null;
  version: number | null;
  updatedAt: Date | null;
}

describePostgres("MeasurementBackfillProgress against Postgres", () => {
  const schema: string = `measurement_backfill_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  let database: DataSource;
  let service: DatabaseService<IncidentMeasurement>;

  const UPDATED_AT: Date = new Date("2020-01-01T00:00:00.000Z");
  const CURSOR: MeasurementBackfillCursor = {
    createdAt: new Date("2026-06-01T09:00:00.000Z"),
    id: new ObjectID("33333333-3333-4333-8333-333333333333"),
  };
  const LATER_CURSOR: MeasurementBackfillCursor = {
    createdAt: new Date("2026-06-02T09:00:00.000Z"),
    id: new ObjectID("44444444-4444-4444-8444-444444444444"),
  };
  const COMPLETED_AT: Date = new Date("2026-07-01T00:05:00.000Z");

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["MEASUREMENT_BACKFILL_PROGRESS_TEST_DATABASE_HOST"] ||
        "localhost",
      port: Number(
        process.env["MEASUREMENT_BACKFILL_PROGRESS_TEST_DATABASE_PORT"] ||
          "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["MEASUREMENT_BACKFILL_PROGRESS_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: {
        options: `-c search_path=${schema} -c lock_timeout=${LOCK_TIMEOUT_MS}`,
      },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
      // A fixture names only what the statement touches; the key stays NOT NULL.
      const columns: Array<{ column_name: string }> = await database.query(
        `SELECT column_name FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2 AND is_nullable = 'NO' AND column_name <> '_id'`,
        [schema, table],
      );
      for (const column of columns) {
        await database.query(
          `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
        );
      }
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
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    service = new DatabaseService<IncidentMeasurement>(IncidentMeasurement);

    for (const table of TABLES) {
      await database.query(`DELETE FROM "${schema}"."${table}"`);
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // A measurement asked to be worked out, as the services ask: stamped, cursor and completion empty.
  async function insertMeasurement(input?: {
    table?: string;
    requestedAt?: Date;
  }): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    await database.query(
      `INSERT INTO "${schema}"."${input?.table || "IncidentMeasurement"}" ("_id", "projectId", "name", "backfillRequestedAt", "version", "updatedAt") VALUES ($1, $2, 'Time to acknowledge', $3, 1, $4)`,
      [
        id.toString(),
        ObjectID.generate().toString(),
        input?.requestedAt || new Date("2026-07-01T00:00:00.123Z"),
        UPDATED_AT,
      ],
    );
    return id;
  }

  /*
   * An edit of what the measurement means, as onUpdatePermitted writes it
   * through updateOneById: a new stamp, the cursor and the completion
   * cleared - with the version and updatedAt the update moves too.
   */
  const EDIT_SQL: string = `UPDATE "IncidentMeasurement" SET "backfillRequestedAt" = $2, "backfillCursorCreatedAt" = NULL, "backfillCursorId" = NULL, "backfillCompletedAt" = NULL, "version" = "version" + 1, "updatedAt" = now() WHERE "_id" = $1`;

  async function edit(id: ObjectID, requestedAt: Date): Promise<void> {
    await database.query(EDIT_SQL, [id.toString(), requestedAt]);
  }

  // backfillRequestedAt as the walk reads it: through TypeORM, as findBy reads it.
  async function readRequest(id: ObjectID): Promise<Date> {
    const row: IncidentMeasurement | null = await database
      .getRepository(IncidentMeasurement)
      .findOne({
        where: { _id: id.toString() } as never,
        select: { _id: true, backfillRequestedAt: true } as never,
      });

    expect(row?.backfillRequestedAt).toBeInstanceOf(Date);
    return row!.backfillRequestedAt!;
  }

  async function readBackfill(
    id: ObjectID,
    table: string = "IncidentMeasurement",
  ): Promise<StoredBackfill> {
    const rows: Array<StoredBackfill> = await database.query(
      `SELECT "backfillRequestedAt", "backfillCursorCreatedAt", "backfillCursorId"::text AS "backfillCursorId", "backfillCompletedAt", "version", "updatedAt" FROM "${schema}"."${table}" WHERE "_id" = $1`,
      [id.toString()],
    );
    return rows[0]!;
  }

  // The microseconds Postgres keeps past the millisecond of the stored request.
  async function storedMicroseconds(id: ObjectID): Promise<number> {
    const rows: Array<{ microseconds: string }> = await database.query(
      `SELECT (EXTRACT(MICROSECONDS FROM "backfillRequestedAt")::bigint % 1000)::text AS "microseconds" FROM "IncidentMeasurement" WHERE "_id" = $1`,
      [id.toString()],
    );
    return Number(rows[0]!.microseconds);
  }

  function save(
    write: MeasurementBackfillProgressWrite,
    on: DatabaseService<BaseModel> = service as unknown as DatabaseService<BaseModel>,
  ): Promise<boolean> {
    return MeasurementBackfillProgress.save({ service: on, write: write });
  }

  describe("while the request is the one the walk read", () => {
    test("a page's cursor is written and reported written, leaving the request, the version and updatedAt alone", async () => {
      const id: ObjectID = await insertMeasurement();
      const requestedAt: Date = await readRequest(id);

      await expect(
        save({
          measurementId: id,
          requestedAt: requestedAt,
          cursor: CURSOR,
        }),
      ).resolves.toBe(true);

      const row: StoredBackfill = await readBackfill(id);
      expect(row.backfillCursorCreatedAt?.toISOString()).toBe(
        CURSOR.createdAt.toISOString(),
      );
      expect(row.backfillCursorId).toBe(CURSOR.id.toString());
      expect(row.backfillCompletedAt).toBeNull();
      expect(row.backfillRequestedAt?.toISOString()).toBe(
        requestedAt.toISOString(),
      );
      // Nobody edited the measurement.
      expect(row.version).toBe(1);
      expect(row.updatedAt?.toISOString()).toBe(UPDATED_AT.toISOString());
    });

    test("page after page, then the completion: each written, and the walk ends completed where it stopped", async () => {
      const id: ObjectID = await insertMeasurement();
      const requestedAt: Date = await readRequest(id);

      const answers: Array<boolean> = [
        await save({
          measurementId: id,
          requestedAt: requestedAt,
          cursor: CURSOR,
        }),
        await save({
          measurementId: id,
          requestedAt: requestedAt,
          cursor: LATER_CURSOR,
        }),
        await save({
          measurementId: id,
          requestedAt: requestedAt,
          cursor: LATER_CURSOR,
          completedAt: COMPLETED_AT,
        }),
      ];

      expect(answers).toEqual([true, true, true]);

      const row: StoredBackfill = await readBackfill(id);
      expect(row.backfillCursorCreatedAt?.toISOString()).toBe(
        LATER_CURSOR.createdAt.toISOString(),
      );
      expect(row.backfillCursorId).toBe(LATER_CURSOR.id.toString());
      expect(row.backfillCompletedAt?.toISOString()).toBe(
        COMPLETED_AT.toISOString(),
      );
    });

    test("a completion with no cursor - a project with nothing in it - keeps the cursor the walk had", async () => {
      const id: ObjectID = await insertMeasurement();
      const requestedAt: Date = await readRequest(id);

      await save({
        measurementId: id,
        requestedAt: requestedAt,
        cursor: CURSOR,
      });

      await expect(
        save({
          measurementId: id,
          requestedAt: requestedAt,
          completedAt: COMPLETED_AT,
        }),
      ).resolves.toBe(true);

      const row: StoredBackfill = await readBackfill(id);
      expect(row.backfillCursorCreatedAt?.toISOString()).toBe(
        CURSOR.createdAt.toISOString(),
      );
      expect(row.backfillCursorId).toBe(CURSOR.id.toString());
      expect(row.backfillCompletedAt?.toISOString()).toBe(
        COMPLETED_AT.toISOString(),
      );
    });

    test.each(TABLES)("%s takes the write", async (table: string) => {
      const id: ObjectID = await insertMeasurement({ table: table });
      const requestedAt: Date = new Date("2026-07-01T00:00:00.123Z");
      const tableService: DatabaseService<BaseModel> =
        new DatabaseService<BaseModel>(
          {
            IncidentMeasurement: IncidentMeasurement,
            AlertMeasurement: AlertMeasurement,
            ScheduledMaintenanceMeasurement: ScheduledMaintenanceMeasurement,
          }[table] as unknown as { new (): BaseModel },
        );

      await expect(
        save(
          {
            measurementId: id,
            requestedAt: requestedAt,
            cursor: CURSOR,
            completedAt: COMPLETED_AT,
          },
          tableService,
        ),
      ).resolves.toBe(true);

      const row: StoredBackfill = await readBackfill(id, table);
      expect(row.backfillCompletedAt?.toISOString()).toBe(
        COMPLETED_AT.toISOString(),
      );
    });
  });

  describe("a request the database stamped, with microseconds", () => {
    test("the walk reads it to the millisecond, and its writes still land", async () => {
      const id: ObjectID = await insertMeasurement();
      await database.query(
        `UPDATE "IncidentMeasurement" SET "backfillRequestedAt" = '2026-07-01 00:00:00.123456+00' WHERE "_id" = $1`,
        [id.toString()],
      );

      const requestedAt: Date = await readRequest(id);

      // What makes an exact comparison fail: the read dropped 456 microseconds.
      expect(requestedAt.toISOString()).toBe("2026-07-01T00:00:00.123Z");
      expect(await storedMicroseconds(id)).toBe(456);

      await expect(
        save({
          measurementId: id,
          requestedAt: requestedAt,
          cursor: CURSOR,
        }),
      ).resolves.toBe(true);
      await expect(
        save({
          measurementId: id,
          requestedAt: requestedAt,
          cursor: CURSOR,
          completedAt: COMPLETED_AT,
        }),
      ).resolves.toBe(true);

      expect((await readBackfill(id)).backfillCompletedAt?.toISOString()).toBe(
        COMPLETED_AT.toISOString(),
      );
    });

    test("compared exactly, the same write is refused - why the stamp is compared to the millisecond", async () => {
      const id: ObjectID = await insertMeasurement();
      await database.query(
        `UPDATE "IncidentMeasurement" SET "backfillRequestedAt" = '2026-07-01 00:00:00.123456+00' WHERE "_id" = $1`,
        [id.toString()],
      );

      // The guard as compareAndSetColumnsByIdWithoutHooks wrote it before #8173.
      const written: Array<{ _id: string }> = await database.query(
        `WITH "saved" AS (UPDATE "IncidentMeasurement" SET "backfillCursorCreatedAt" = $1 WHERE "_id" = $2 AND "backfillRequestedAt" IS NOT DISTINCT FROM $3 RETURNING "_id") SELECT "_id" FROM "saved"`,
        [CURSOR.createdAt, id.toString(), await readRequest(id)],
      );

      expect(written).toEqual([]);

      const cleared: StoredBackfill = await readBackfill(id);
      expect(cleared.backfillCursorCreatedAt).toBeNull();
      expect(cleared.backfillCursorId).toBeNull();
    });

    test("compareAndSetColumnsByIdWithoutHooks now compares a timestamp to the millisecond too (#8173): the same write lands", async () => {
      const id: ObjectID = await insertMeasurement();
      await database.query(
        `UPDATE "IncidentMeasurement" SET "backfillRequestedAt" = '2026-07-01 00:00:00.123456+00' WHERE "_id" = $1`,
        [id.toString()],
      );

      await expect(
        service.compareAndSetColumnsByIdWithoutHooks({
          id: id,
          data: { backfillCursorCreatedAt: CURSOR.createdAt },
          expectedData: { backfillRequestedAt: await readRequest(id) },
          skipUpdateDateColumn: true,
        }),
      ).resolves.toBe(true);

      expect(
        (await readBackfill(id)).backfillCursorCreatedAt?.toISOString(),
      ).toBe(CURSOR.createdAt.toISOString());

      // A millisecond off is still another request.
      await expect(
        service.compareAndSetColumnsByIdWithoutHooks({
          id: id,
          data: { backfillCursorCreatedAt: LATER_CURSOR.createdAt },
          expectedData: {
            backfillRequestedAt: new Date("2026-07-01T00:00:00.124Z"),
          },
          skipUpdateDateColumn: true,
        }),
      ).resolves.toBe(false);

      expect(
        (await readBackfill(id)).backfillCursorCreatedAt?.toISOString(),
      ).toBe(CURSOR.createdAt.toISOString());
    });

    test("FirstPagedAt's own re-request (now()) is walked to completion", async () => {
      const id: ObjectID = await insertMeasurement();
      // What FirstPagedAt.backfill sets on every measurement it asks for again.
      await database.query(
        `UPDATE "IncidentMeasurement" SET "backfillRequestedAt" = now(), "backfillCursorCreatedAt" = NULL, "backfillCursorId" = NULL, "backfillCompletedAt" = NULL WHERE "_id" = $1`,
        [id.toString()],
      );

      const requestedAt: Date = await readRequest(id);

      await expect(
        save({
          measurementId: id,
          requestedAt: requestedAt,
          cursor: CURSOR,
        }),
      ).resolves.toBe(true);
      await expect(
        save({
          measurementId: id,
          requestedAt: requestedAt,
          cursor: LATER_CURSOR,
          completedAt: COMPLETED_AT,
        }),
      ).resolves.toBe(true);

      const row: StoredBackfill = await readBackfill(id);
      expect(row.backfillCursorCreatedAt?.toISOString()).toBe(
        LATER_CURSOR.createdAt.toISOString(),
      );
      expect(row.backfillCursorId).toBe(LATER_CURSOR.id.toString());
      expect(row.backfillCompletedAt?.toISOString()).toBe(
        COMPLETED_AT.toISOString(),
      );
    });

    test("one millisecond either side of the stamp is another request, and refused", async () => {
      const id: ObjectID = await insertMeasurement();
      await database.query(
        `UPDATE "IncidentMeasurement" SET "backfillRequestedAt" = '2026-07-01 00:00:00.123999+00' WHERE "_id" = $1`,
        [id.toString()],
      );

      for (const requestedAt of [
        new Date("2026-07-01T00:00:00.122Z"),
        new Date("2026-07-01T00:00:00.124Z"),
      ]) {
        await expect(
          save({
            measurementId: id,
            requestedAt: requestedAt,
            cursor: CURSOR,
          }),
        ).resolves.toBe(false);
      }

      await expect(
        save({
          measurementId: id,
          requestedAt: new Date("2026-07-01T00:00:00.123Z"),
          cursor: CURSOR,
        }),
      ).resolves.toBe(true);
    });
  });

  describe("an edit made while the measurement is walked always wins", () => {
    const EDITED_AT: Date = new Date("2026-07-01T00:02:00.000Z");
    const EDITED_AGAIN_AT: Date = new Date("2026-07-01T00:03:00.000Z");

    test("an edit before the walk's first write: the cursor is refused, and the edit's walk starts from nothing", async () => {
      const id: ObjectID = await insertMeasurement();
      const requestedAt: Date = await readRequest(id);

      await edit(id, EDITED_AT);

      await expect(
        save({
          measurementId: id,
          requestedAt: requestedAt,
          cursor: CURSOR,
        }),
      ).resolves.toBe(false);

      const row: StoredBackfill = await readBackfill(id);
      expect(row.backfillRequestedAt?.toISOString()).toBe(
        EDITED_AT.toISOString(),
      );
      expect(row.backfillCursorCreatedAt).toBeNull();
      expect(row.backfillCursorId).toBeNull();
      expect(row.backfillCompletedAt).toBeNull();
    });

    test("an edit between two pages: the next cursor is refused, and the cleared cursor stays cleared", async () => {
      const id: ObjectID = await insertMeasurement();
      const requestedAt: Date = await readRequest(id);

      await expect(
        save({
          measurementId: id,
          requestedAt: requestedAt,
          cursor: CURSOR,
        }),
      ).resolves.toBe(true);

      await edit(id, EDITED_AT);

      await expect(
        save({
          measurementId: id,
          requestedAt: requestedAt,
          cursor: LATER_CURSOR,
        }),
      ).resolves.toBe(false);

      const cleared: StoredBackfill = await readBackfill(id);
      expect(cleared.backfillCursorCreatedAt).toBeNull();
      expect(cleared.backfillCursorId).toBeNull();
    });

    test("an edit just before the completion: the completion is refused, and the measurement is still asked for", async () => {
      const id: ObjectID = await insertMeasurement();
      const requestedAt: Date = await readRequest(id);

      await save({
        measurementId: id,
        requestedAt: requestedAt,
        cursor: CURSOR,
      });
      await edit(id, EDITED_AT);

      await expect(
        save({
          measurementId: id,
          requestedAt: requestedAt,
          cursor: LATER_CURSOR,
          completedAt: COMPLETED_AT,
        }),
      ).resolves.toBe(false);

      const row: StoredBackfill = await readBackfill(id);
      expect(row.backfillCompletedAt).toBeNull();
      expect(row.backfillCursorCreatedAt).toBeNull();
      expect(row.backfillCursorId).toBeNull();
      expect(row.backfillRequestedAt?.toISOString()).toBe(
        EDITED_AT.toISOString(),
      );
    });

    test("two edits in a row: the first walk is refused, the walk of the first edit is refused after the second, the second's walk is written", async () => {
      const id: ObjectID = await insertMeasurement();
      const firstRequest: Date = await readRequest(id);

      await edit(id, EDITED_AT);
      const secondRequest: Date = await readRequest(id);
      await edit(id, EDITED_AGAIN_AT);

      const answers: Array<boolean> = [];
      for (const requestedAt of [firstRequest, secondRequest]) {
        answers.push(
          await save({
            measurementId: id,
            requestedAt: requestedAt,
            cursor: CURSOR,
            completedAt: COMPLETED_AT,
          }),
        );
      }

      expect(answers).toEqual([false, false]);
      expect((await readBackfill(id)).backfillCompletedAt).toBeNull();

      await expect(
        save({
          measurementId: id,
          requestedAt: await readRequest(id),
          cursor: CURSOR,
          completedAt: COMPLETED_AT,
        }),
      ).resolves.toBe(true);

      const row: StoredBackfill = await readBackfill(id);
      expect(row.backfillRequestedAt?.toISOString()).toBe(
        EDITED_AGAIN_AT.toISOString(),
      );
      expect(row.backfillCompletedAt?.toISOString()).toBe(
        COMPLETED_AT.toISOString(),
      );
    });

    test("an edit that commits while the walk's write waits for the row is still never written over", async () => {
      const id: ObjectID = await insertMeasurement();
      const requestedAt: Date = await readRequest(id);

      // The edit, written and holding the row, not yet committed.
      const editor: QueryRunner = database.createQueryRunner();
      await editor.connect();
      await editor.startTransaction();
      await editor.query(EDIT_SQL, [id.toString(), EDITED_AT]);

      let settled: boolean = false;
      const completion: Promise<boolean> = save({
        measurementId: id,
        requestedAt: requestedAt,
        cursor: LATER_CURSOR,
        completedAt: COMPLETED_AT,
      }).finally(() => {
        settled = true;
      });

      try {
        // The completion waits for the edit's lock...
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 500);
        });
        expect(settled).toBe(false);
      } finally {
        // ...which commits.
        await editor.commitTransaction();
        await editor.release();
      }

      /*
       * Postgres judges the guard again on the row the edit committed: the
       * stamp is the edit's now, so the completion is refused.
       */
      await expect(completion).resolves.toBe(false);

      const row: StoredBackfill = await readBackfill(id);
      expect(row.backfillRequestedAt?.toISOString()).toBe(
        EDITED_AT.toISOString(),
      );
      expect(row.backfillCompletedAt).toBeNull();
      expect(row.backfillCursorCreatedAt).toBeNull();
      expect(row.backfillCursorId).toBeNull();
    });

    test("an edit that rolls back while the walk's write waits leaves the walk's write to land", async () => {
      const id: ObjectID = await insertMeasurement();
      const requestedAt: Date = await readRequest(id);

      const editor: QueryRunner = database.createQueryRunner();
      await editor.connect();
      await editor.startTransaction();
      await editor.query(EDIT_SQL, [id.toString(), EDITED_AT]);

      const completion: Promise<boolean> = save({
        measurementId: id,
        requestedAt: requestedAt,
        cursor: LATER_CURSOR,
        completedAt: COMPLETED_AT,
      });

      try {
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 200);
        });
      } finally {
        await editor.rollbackTransaction();
        await editor.release();
      }

      await expect(completion).resolves.toBe(true);
      expect((await readBackfill(id)).backfillCompletedAt?.toISOString()).toBe(
        COMPLETED_AT.toISOString(),
      );
    });

    test("a walk's write that lands first is undone by the edit that follows it", async () => {
      const id: ObjectID = await insertMeasurement();
      const requestedAt: Date = await readRequest(id);

      await expect(
        save({
          measurementId: id,
          requestedAt: requestedAt,
          cursor: LATER_CURSOR,
          completedAt: COMPLETED_AT,
        }),
      ).resolves.toBe(true);

      await edit(id, EDITED_AT);

      const row: StoredBackfill = await readBackfill(id);
      expect(row.backfillCompletedAt).toBeNull();
      expect(row.backfillCursorCreatedAt).toBeNull();
      expect(row.backfillCursorId).toBeNull();
    });
  });

  test("a measurement that is gone takes no write, and says so", async () => {
    await expect(
      save({
        measurementId: ObjectID.generate(),
        requestedAt: new Date("2026-07-01T00:00:00.123Z"),
        cursor: CURSOR,
      }),
    ).resolves.toBe(false);
  });
});
