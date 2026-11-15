import ObjectID from "Common/Types/ObjectID";
import { DataSource, QueryRunner } from "Common/node_modules/typeorm";

/*
 * THE MEASUREMENT BACKFILL, WALKED ON POSTGRES (#8171).
 *
 * Measurement:Backfill walks a project's incidents, alerts or scheduled
 * maintenance events a page at a time, after a cursor it saves on the
 * measurement. The cursor was the createdAt of a page's last record, read
 * from inclusively: when more than a page of records shared one createdAt -
 * every row one statement inserts gets the same now() - each page was the
 * same page, and the backfill never finished. It is now the record's
 * (createdAt, _id), read after (MeasurementBackfillPage) and written in the
 * compare-and-set held to the request the walk read
 * (MeasurementBackfillProgress, #8105).
 *
 * BackfillMeasurements.test.ts pins the job against tables in memory; this
 * runs the job itself - its cron handler, the real page read, the real
 * guarded write and the real read of the measurements still to backfill -
 * against the migrated tables' structure, with the records made the way
 * Postgres makes them: a run of rows inserted in one statement shares its
 * now() to the microsecond, which node-postgres reads to the millisecond.
 * Only working a record out (the measurement value services) is stood in
 * for, by a recorder. It pins:
 *
 *   - why the cursor had to change: the old read answers the same page
 *     again after a run longer than a page, and a pair compared with the
 *     createdAt as read answers a run within one millisecond again;
 *   - runs longer than a page at the start, in the middle and at the end of
 *     a project, the whole project as one run, a run longer than a tick's
 *     pages (the next tick resumes inside it), and one apart by
 *     microseconds: each record worked out once, the measurement finished;
 *   - a cursor saved before the id was kept, a cursor whose record was
 *     deleted - between ticks or between two pages, saved to the
 *     microsecond so the walk goes on right after it (#8388), or to the
 *     millisecond before that - and records deleted with a deletedAt;
 *   - an edit made while a run is walked: the walk's next write is
 *     refused, the cleared cursor stays cleared, and the next tick walks the
 *     edit from the beginning;
 *   - all three domains, and that a page is read by the index.
 *
 * Opt in with RUN_POSTGRES_MEASUREMENT_BACKFILL_WALK_TESTS=true against a
 * Postgres migrated to the current head - the Postgres Schema Drift
 * workflow's database right after its drift check. The six tables'
 * STRUCTURE is cloned into a unique schema (search_path holds only that
 * schema) that is dropped afterwards. Credentials from DATABASE_USERNAME /
 * DATABASE_PASSWORD, database from MEASUREMENT_BACKFILL_WALK_TEST_DATABASE_NAME
 * or DATABASE_NAME, endpoint from MEASUREMENT_BACKFILL_WALK_TEST_DATABASE_HOST
 * / _PORT (default localhost:5400, Scripts/Dev/docker-compose.dev.yml).
 */

type CronHandler = () => Promise<void>;

const mockCapturedJobs: Record<string, CronHandler> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (jobName: string, _options: unknown, runFunction: CronHandler): void => {
        mockCapturedJobs[jobName] = runFunction;
      },
    ),
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

/*
 * Each service the job reads and writes through, as the plain
 * DatabaseService of its model: its findBy, its table and its connection,
 * which the suite points at the clones.
 */
function mockDatabaseService(modelPath: string): {
  __esModule: true;
  default: unknown;
} {
  const DatabaseService: new (model: unknown) => unknown = jest.requireActual(
    "Common/Server/Services/DatabaseService",
  ).default;
  const model: unknown = jest.requireActual(modelPath).default;

  return { __esModule: true, default: new DatabaseService(model) };
}

jest.mock("Common/Server/Services/IncidentMeasurementService", () => {
  return mockDatabaseService(
    "Common/Models/DatabaseModels/IncidentMeasurement",
  );
});
jest.mock("Common/Server/Services/AlertMeasurementService", () => {
  return mockDatabaseService("Common/Models/DatabaseModels/AlertMeasurement");
});
jest.mock(
  "Common/Server/Services/ScheduledMaintenanceMeasurementService",
  () => {
    return mockDatabaseService(
      "Common/Models/DatabaseModels/ScheduledMaintenanceMeasurement",
    );
  },
);
jest.mock("Common/Server/Services/IncidentService", () => {
  return mockDatabaseService("Common/Models/DatabaseModels/Incident");
});
jest.mock("Common/Server/Services/AlertService", () => {
  return mockDatabaseService("Common/Models/DatabaseModels/Alert");
});
jest.mock("Common/Server/Services/ScheduledMaintenanceService", () => {
  return mockDatabaseService(
    "Common/Models/DatabaseModels/ScheduledMaintenance",
  );
});

jest.mock("Common/Server/Services/IncidentMeasurementValueService", () => {
  return { __esModule: true, default: { recomputeForIncident: jest.fn() } };
});
jest.mock("Common/Server/Services/AlertMeasurementValueService", () => {
  return { __esModule: true, default: { recomputeForAlert: jest.fn() } };
});
jest.mock(
  "Common/Server/Services/ScheduledMaintenanceMeasurementValueService",
  () => {
    return {
      __esModule: true,
      default: { recomputeForScheduledMaintenance: jest.fn() },
    };
  },
);

import Entities from "Common/Models/DatabaseModels/Index";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import IncidentMeasurementValueService from "Common/Server/Services/IncidentMeasurementValueService";
import AlertMeasurementValueService from "Common/Server/Services/AlertMeasurementValueService";
import ScheduledMaintenanceMeasurementValueService from "Common/Server/Services/ScheduledMaintenanceMeasurementValueService";
import logger from "Common/Server/Utils/Logger";
import MeasurementBackfillPage from "Common/Server/Utils/Measurement/MeasurementBackfillPage";

// Imported for its side effect: RunCron (mocked above) records the handler.
import "../../../../FeatureSet/Workers/Jobs/Measurement/BackfillMeasurements";

const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_MEASUREMENT_BACKFILL_WALK_TESTS"] === "true"
    ? describe
    : describe.skip;

// Mirrors the constants in the job.
const PAGE_SIZE: number = 500;
const MAX_PAGES_PER_RUN: number = 10;

const DASHES: RegExp = /-/g;

const incidentValues: { recomputeForIncident: jest.Mock } =
  IncidentMeasurementValueService as unknown as {
    recomputeForIncident: jest.Mock;
  };
const alertValues: { recomputeForAlert: jest.Mock } =
  AlertMeasurementValueService as unknown as { recomputeForAlert: jest.Mock };
const maintenanceValues: { recomputeForScheduledMaintenance: jest.Mock } =
  ScheduledMaintenanceMeasurementValueService as unknown as {
    recomputeForScheduledMaintenance: jest.Mock;
  };

const mockedLogger: { error: jest.Mock; warn: jest.Mock; info: jest.Mock } =
  logger as unknown as { error: jest.Mock; warn: jest.Mock; info: jest.Mock };

// One domain of the backfill: its records' table, its measurements' and who works a record out.
interface Domain {
  recordTable: string;
  measurementTable: string;
  recomputed: () => Array<string>;
}

function idsOf(mock: jest.Mock, key: string): Array<string> {
  return mock.mock.calls.map((call: Array<unknown>): string => {
    return (call[0] as Record<string, ObjectID>)[key]!.toString();
  });
}

const INCIDENTS: Domain = {
  recordTable: "Incident",
  measurementTable: "IncidentMeasurement",
  recomputed: (): Array<string> => {
    return idsOf(incidentValues.recomputeForIncident, "incidentId");
  },
};

const DOMAINS: Array<Domain> = [
  INCIDENTS,
  {
    recordTable: "Alert",
    measurementTable: "AlertMeasurement",
    recomputed: (): Array<string> => {
      return idsOf(alertValues.recomputeForAlert, "alertId");
    },
  },
  {
    recordTable: "ScheduledMaintenance",
    measurementTable: "ScheduledMaintenanceMeasurement",
    recomputed: (): Array<string> => {
      return idsOf(
        maintenanceValues.recomputeForScheduledMaintenance,
        "scheduledMaintenanceId",
      );
    },
  },
];

const TABLES: Array<string> = DOMAINS.flatMap(
  (domain: Domain): Array<string> => {
    return [domain.recordTable, domain.measurementTable];
  },
);

// What one measurement row holds of its backfill.
interface StoredBackfill {
  backfillRequestedAt: Date | null;
  backfillCursorCreatedAt: Date | null;
  backfillCursorId: string | null;
  backfillCompletedAt: Date | null;
}

async function runTick(): Promise<void> {
  const handler: CronHandler | undefined =
    mockCapturedJobs["Measurement:Backfill"];

  if (!handler) {
    throw new Error("Measurement:Backfill did not register a cron handler");
  }

  await handler();
}

// The ids worked out more than once, with how many times.
function repeatsOf(ids: Array<string>): Record<string, number> {
  const counts: Record<string, number> = {};
  const repeats: Record<string, number> = {};

  for (const id of ids) {
    counts[id] = (counts[id] || 0) + 1;

    if (counts[id]! > 1) {
      repeats[id] = counts[id]!;
    }
  }

  return repeats;
}

describePostgres("Measurement:Backfill against Postgres", () => {
  const schema: string = `measurement_backfill_walk_${ObjectID.generate()
    .toString()
    .replace(DASHES, "")}`;
  let database: DataSource;

  const PROJECT_ID: string = ObjectID.generate().toString();
  const OTHER_PROJECT_ID: string = ObjectID.generate().toString();
  const REQUESTED_AT: Date = new Date("2026-07-01T00:00:00.123Z");
  const EDITED_AT: Date = new Date("2026-07-01T00:02:00.000Z");

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["MEASUREMENT_BACKFILL_WALK_TEST_DATABASE_HOST"] ||
        "localhost",
      port: Number(
        process.env["MEASUREMENT_BACKFILL_WALK_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["MEASUREMENT_BACKFILL_WALK_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema}` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
      // A fixture names only what the walk reads; the key stays NOT NULL.
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
  }, 120000);

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    incidentValues.recomputeForIncident.mockResolvedValue(undefined);
    alertValues.recomputeForAlert.mockResolvedValue(undefined);
    maintenanceValues.recomputeForScheduledMaintenance.mockResolvedValue(
      undefined,
    );

    for (const table of TABLES) {
      await database.query(`DELETE FROM "${schema}"."${table}"`);
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * A run of `count` records inserted in one statement: each takes
   * createdAt's default, the statement's now(), to the microsecond - a bulk
   * import, or a migration that copies records.
   */
  async function insertRun(input: {
    count: number;
    table?: string;
    projectId?: string;
  }): Promise<void> {
    await database.query(
      `INSERT INTO "${input.table || "Incident"}" ("_id", "projectId") SELECT gen_random_uuid(), $1 FROM generate_series(1, $2)`,
      [input.projectId || PROJECT_ID, input.count],
    );
  }

  /*
   * `count` records a second apart, `fromSql` (an SQL timestamp) plus one
   * second, two seconds...: before the records there are with a negative
   * step.
   */
  async function insertSpaced(input: {
    count: number;
    fromSql: string;
    stepInSeconds: number;
    table?: string;
  }): Promise<void> {
    await database.query(
      `INSERT INTO "${input.table || "Incident"}" ("_id", "projectId", "createdAt") SELECT gen_random_uuid(), $1, (${input.fromSql}) + "step" * $3 * interval '1 second' FROM generate_series(1, $2) AS "step"`,
      [PROJECT_ID, input.count, input.stepInSeconds],
    );
  }

  // The records the walk is to visit, in its order: the project's, not deleted.
  async function orderedIds(
    table: string = "Incident",
  ): Promise<Array<string>> {
    const rows: Array<{ _id: string }> = await database.query(
      `SELECT "_id"::text AS "_id" FROM "${table}" WHERE "projectId" = $1 AND "deletedAt" IS NULL ORDER BY "createdAt", "_id"`,
      [PROJECT_ID],
    );

    return rows.map((row: { _id: string }): string => {
      return row._id;
    });
  }

  // A measurement asked to be worked out, as the services ask: stamped, cursor and completion empty.
  async function insertMeasurement(input?: {
    table?: string;
    cursorCreatedAt?: Date;
  }): Promise<string> {
    const id: string = ObjectID.generate().toString();

    await database.query(
      `INSERT INTO "${input?.table || "IncidentMeasurement"}" ("_id", "projectId", "name", "backfillRequestedAt", "backfillCursorCreatedAt", "version") VALUES ($1, $2, 'Time to acknowledge', $3, $4, 1)`,
      [id, PROJECT_ID, REQUESTED_AT, input?.cursorCreatedAt || null],
    );

    return id;
  }

  async function readBackfill(
    id: string,
    table: string = "IncidentMeasurement",
  ): Promise<StoredBackfill> {
    const rows: Array<StoredBackfill> = await database.query(
      `SELECT "backfillRequestedAt", "backfillCursorCreatedAt", "backfillCursorId"::text AS "backfillCursorId", "backfillCompletedAt" FROM "${table}" WHERE "_id" = $1`,
      [id],
    );

    return rows[0]!;
  }

  // What a measurement holds as its cursor's createdAt, to the microsecond (UTC).
  async function storedCursorExactly(
    id: string,
    table: string = "IncidentMeasurement",
  ): Promise<string | null> {
    const rows: Array<{ exactly: string | null }> = await database.query(
      `SELECT to_char("backfillCursorCreatedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "exactly" FROM "${table}" WHERE "_id" = $1`,
      [id],
    );

    return rows[0]!.exactly;
  }

  // A record's createdAt, to the microsecond (UTC).
  async function createdAtExactly(
    recordId: string,
    table: string = "Incident",
  ): Promise<string> {
    const rows: Array<{ exactly: string }> = await database.query(
      `SELECT to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "exactly" FROM "${table}" WHERE "_id" = $1`,
      [recordId],
    );

    return rows[0]!.exactly;
  }

  // The last record the walk visits, as a page reads it.
  async function lastRecord(
    table: string = "Incident",
  ): Promise<{ _id: string; createdAt: Date }> {
    const rows: Array<{ _id: string; createdAt: Date }> = await database.query(
      `SELECT "_id"::text AS "_id", "createdAt" FROM "${table}" WHERE "projectId" = $1 AND "deletedAt" IS NULL ORDER BY "createdAt" DESC, "_id" DESC LIMIT 1`,
      [PROJECT_ID],
    );

    return rows[0]!;
  }

  // Ticks until the measurement finishes, at most `ticks` of them; how many it took.
  async function walkToCompletion(
    id: string,
    ticks: number = 5,
    table: string = "IncidentMeasurement",
  ): Promise<number> {
    for (let tick: number = 1; tick <= ticks; tick++) {
      await runTick();

      if ((await readBackfill(id, table)).backfillCompletedAt) {
        return tick;
      }
    }

    throw new Error(`not finished after ${ticks} ticks`);
  }

  // Each record worked out once, in the walk's order; the measurement finished at the last.
  async function expectEachWorkedOutOnce(
    id: string,
    domain: Domain = INCIDENTS,
  ): Promise<void> {
    const ordered: Array<string> = await orderedIds(domain.recordTable);

    expect(ordered.length).toBeGreaterThan(0);
    expect(repeatsOf(domain.recomputed())).toEqual({});
    expect(domain.recomputed()).toEqual(ordered);

    const row: StoredBackfill = await readBackfill(id, domain.measurementTable);
    const last: { _id: string; createdAt: Date } = await lastRecord(
      domain.recordTable,
    );

    expect(row.backfillCompletedAt).toBeInstanceOf(Date);
    expect(row.backfillCursorId).toBe(last._id);
    expect(row.backfillCursorCreatedAt?.toISOString()).toBe(
      last.createdAt.toISOString(),
    );
    // And to the microsecond, as the record has it (#8388).
    expect(await storedCursorExactly(id, domain.measurementTable)).toBe(
      await createdAtExactly(last._id, domain.recordTable),
    );
    expect(mockedLogger.warn).not.toHaveBeenCalled();
    expect(mockedLogger.error).not.toHaveBeenCalled();
  }

  describe("why the cursor had to change", () => {
    test("a run inserted in one statement shares its createdAt to the microsecond", async () => {
      await insertRun({ count: 1200 });

      const rows: Array<{ moments: string; records: string }> =
        await database.query(
          `SELECT count(DISTINCT "createdAt")::text AS "moments", count(*)::text AS "records" FROM "Incident"`,
        );

      expect(rows[0]).toEqual({ moments: "1", records: "1200" });
    });

    test("the old read, from the cursor's createdAt on, answers the same page again after a run longer than a page", async () => {
      await insertRun({ count: 1200 });

      const read: (from: Date) => Promise<Array<string>> = async (
        from: Date,
      ): Promise<Array<string>> => {
        const rows: Array<{ _id: string }> = await database.query(
          `SELECT "_id"::text AS "_id", "createdAt" FROM "Incident" WHERE "projectId" = $1 AND "createdAt" >= $2 ORDER BY "createdAt" ASC LIMIT ${PAGE_SIZE}`,
          [PROJECT_ID, from],
        );
        return rows.map((row: { _id: string }): string => {
          return row._id;
        });
      };

      const first: Array<string> = await read(new Date(0));
      const cursor: Date = (await lastRecord()).createdAt;

      // The page after it starts where it started, and holds what it held.
      expect(new Set(await read(cursor))).toEqual(new Set(first));
    });

    test("a pair compared with the createdAt as read answers a run created within one millisecond again", async () => {
      await database.query(
        `INSERT INTO "Incident" ("_id", "projectId", "createdAt") SELECT gen_random_uuid(), $1, date_trunc('milliseconds', now()) + "step" * interval '1 microsecond' FROM generate_series(1, 800) AS "step"`,
        [PROJECT_ID],
      );

      const firstPage: Array<{ _id: string; createdAt: Date }> =
        await database.query(
          `SELECT "_id"::text AS "_id", "createdAt" FROM "Incident" WHERE "projectId" = $1 ORDER BY "createdAt", "_id" LIMIT ${PAGE_SIZE}`,
          [PROJECT_ID],
        );
      const last: { _id: string; createdAt: Date } =
        firstPage[firstPage.length - 1]!;

      const asRead: Array<{ _id: string }> = await database.query(
        `SELECT "_id"::text AS "_id" FROM "Incident" WHERE "projectId" = $1 AND ("createdAt", "_id") > ($2, $3) ORDER BY "createdAt", "_id"`,
        [PROJECT_ID, last.createdAt, last._id],
      );

      // Compared with the millisecond node-postgres read, the whole run is "after" it.
      expect(asRead.length).toBe(800);

      const page: Array<{ id: ObjectID }> = await MeasurementBackfillPage.read({
        service: {
          getModel: (): { tableName: string } => {
            return { tableName: "Incident" };
          },
          getRepository: () => {
            return { manager: database.manager };
          },
        },
        projectId: new ObjectID(PROJECT_ID),
        after: { createdAt: last.createdAt, id: new ObjectID(last._id) },
        limit: PAGE_SIZE,
      });

      // The page after the cursor record itself: the 300 after it.
      expect(page).toHaveLength(300);
      expect(
        page.some((record: { id: ObjectID }): boolean => {
          return firstPage.some((row: { _id: string }): boolean => {
            return row._id === record.id.toString();
          });
        }),
      ).toBe(false);
    });
  });

  describe("a run of records created at one moment, longer than a page", () => {
    test("at the start of the project", async () => {
      await insertRun({ count: 1200 });
      await insertSpaced({
        count: 300,
        fromSql: `SELECT max("createdAt") FROM "Incident"`,
        stepInSeconds: 1,
      });
      const id: string = await insertMeasurement();

      expect(await walkToCompletion(id)).toBe(1);
      await expectEachWorkedOutOnce(id);
    });

    test("in the middle of the project", async () => {
      await insertRun({ count: 1300 });
      await insertSpaced({
        count: 300,
        fromSql: `SELECT min("createdAt") FROM "Incident"`,
        stepInSeconds: -1,
      });
      await insertSpaced({
        count: 300,
        fromSql: `SELECT max("createdAt") FROM "Incident"`,
        stepInSeconds: 1,
      });
      const id: string = await insertMeasurement();

      expect(await walkToCompletion(id)).toBe(1);
      await expectEachWorkedOutOnce(id);
    });

    test("at the end of the project, the last page ending in it", async () => {
      await insertRun({ count: 1250 });
      await insertSpaced({
        count: 300,
        fromSql: `SELECT min("createdAt") FROM "Incident"`,
        stepInSeconds: -1,
      });
      const id: string = await insertMeasurement();

      expect(await walkToCompletion(id)).toBe(1);
      await expectEachWorkedOutOnce(id);
    });

    test("the whole project, as one run", async () => {
      await insertRun({ count: 2000 });
      const id: string = await insertMeasurement();

      expect(await walkToCompletion(id)).toBe(1);
      await expectEachWorkedOutOnce(id);
    });

    test("exactly a page long, and a page and one", async () => {
      await insertRun({ count: PAGE_SIZE });
      await insertSpaced({
        count: 1,
        fromSql: `SELECT max("createdAt") FROM "Incident"`,
        stepInSeconds: 1,
      });
      await insertRun({ count: PAGE_SIZE + 1 });
      const id: string = await insertMeasurement();

      expect(await walkToCompletion(id)).toBe(1);
      await expectEachWorkedOutOnce(id);
    });

    test("longer than one tick's pages: the next tick resumes inside the run, after the record the last ended on", async () => {
      await insertRun({ count: MAX_PAGES_PER_RUN * PAGE_SIZE + 1200 });
      const id: string = await insertMeasurement();
      const ordered: Array<string> = await orderedIds();

      await runTick();

      const afterFirstTick: StoredBackfill = await readBackfill(id);

      expect(afterFirstTick.backfillCompletedAt).toBeNull();
      expect(afterFirstTick.backfillCursorId).toBe(
        ordered[MAX_PAGES_PER_RUN * PAGE_SIZE - 1],
      );
      expect(INCIDENTS.recomputed()).toEqual(
        ordered.slice(0, MAX_PAGES_PER_RUN * PAGE_SIZE),
      );

      await runTick();

      await expectEachWorkedOutOnce(id);
    });

    test("created within one millisecond, microseconds apart: each record once, though a read keeps only the millisecond", async () => {
      await database.query(
        `INSERT INTO "Incident" ("_id", "projectId", "createdAt") SELECT gen_random_uuid(), $1, date_trunc('milliseconds', now()) + "step" * interval '1 microsecond' FROM generate_series(1, 900) AS "step"`,
        [PROJECT_ID],
      );
      const id: string = await insertMeasurement();

      expect(await walkToCompletion(id)).toBe(1);
      await expectEachWorkedOutOnce(id);
    });
  });

  describe("cursors and records as the walk finds them", () => {
    test("a cursor saved before the id was kept: read from its createdAt on, once, and saved with both columns after", async () => {
      await insertSpaced({
        count: 300,
        fromSql: `SELECT now()`,
        stepInSeconds: 1,
      });
      const ordered: Array<string> = await orderedIds();
      const boundary: Array<{ createdAt: Date }> = await database.query(
        `SELECT "createdAt" FROM "Incident" WHERE "_id" = $1`,
        [ordered[99]],
      );
      const id: string = await insertMeasurement({
        cursorCreatedAt: boundary[0]!.createdAt,
      });

      await runTick();

      expect(INCIDENTS.recomputed()).toEqual(ordered.slice(99));

      const row: StoredBackfill = await readBackfill(id);

      expect(row.backfillCompletedAt).toBeInstanceOf(Date);
      expect(row.backfillCursorId).toBe(ordered[299]);
    });

    /*
     * #8388. The run one statement inserted shares its now() to the
     * microsecond. Cut to the millisecond, the stored cursor stood before
     * the whole run once its record was gone, and the next tick worked the
     * first tick's 5,000 records out again; to the microsecond it stands
     * where the record stood.
     */
    test("a cursor whose record was deleted since: the walk goes on right after it, nothing read again (#8388)", async () => {
      await insertRun({ count: MAX_PAGES_PER_RUN * PAGE_SIZE + 600 });
      const id: string = await insertMeasurement();

      await runTick();

      const cursor: StoredBackfill = await readBackfill(id);
      const ordered: Array<string> = await orderedIds();
      const rest: Array<string> = ordered.slice(
        ordered.indexOf(cursor.backfillCursorId!) + 1,
      );

      // The stored cursor is the record's own createdAt, to the microsecond.
      expect(await storedCursorExactly(id)).toBe(
        await createdAtExactly(cursor.backfillCursorId!),
      );

      await database.query(`DELETE FROM "Incident" WHERE "_id" = $1`, [
        cursor.backfillCursorId,
      ]);
      incidentValues.recomputeForIncident.mockClear();

      expect(await walkToCompletion(id)).toBe(1);

      expect(INCIDENTS.recomputed()).toEqual(rest);
      expect(mockedLogger.warn).not.toHaveBeenCalled();
    });

    test("a cursor whose record was deleted between two pages of one tick: the next page goes on right after it", async () => {
      await insertRun({ count: 3 * PAGE_SIZE });
      const id: string = await insertMeasurement();
      const ordered: Array<string> = await orderedIds();

      // The first page's last record is deleted for good once it is worked out.
      incidentValues.recomputeForIncident.mockImplementation(
        async (data: { incidentId: ObjectID }): Promise<void> => {
          if (data.incidentId.toString() === ordered[PAGE_SIZE - 1]) {
            await database.query(`DELETE FROM "Incident" WHERE "_id" = $1`, [
              ordered[PAGE_SIZE - 1],
            ]);
          }
        },
      );

      expect(await walkToCompletion(id)).toBe(1);

      expect(INCIDENTS.recomputed()).toEqual(ordered);
      expect(repeatsOf(INCIDENTS.recomputed())).toEqual({});
    });

    test("the cursor is saved as the record has it, to the microsecond, page by page", async () => {
      await database.query(
        `INSERT INTO "Incident" ("_id", "projectId", "createdAt") SELECT gen_random_uuid(), $1, date_trunc('milliseconds', now()) + interval '123 microseconds' + "step" * interval '7 microseconds' FROM generate_series(1, $2) AS "step"`,
        [PROJECT_ID, MAX_PAGES_PER_RUN * PAGE_SIZE + 50],
      );
      const id: string = await insertMeasurement();
      const ordered: Array<string> = await orderedIds();

      await runTick();

      const cursor: StoredBackfill = await readBackfill(id);

      expect(cursor.backfillCursorId).toBe(
        ordered[MAX_PAGES_PER_RUN * PAGE_SIZE - 1],
      );
      const exactly: string = await createdAtExactly(cursor.backfillCursorId!);
      expect(await storedCursorExactly(id)).toBe(exactly);
      // Past its millisecond: what a Date would have cut.
      expect(exactly.slice(23, 26)).not.toBe("000");

      await runTick();

      await expectEachWorkedOutOnce(id);
      expect(await storedCursorExactly(id)).toBe(
        await createdAtExactly(ordered[ordered.length - 1]!),
      );
    });

    test("a cursor saved to the millisecond before #8388, its record gone: that millisecond is read again once, nothing passed over, and the next cursor is saved to the microsecond", async () => {
      // One statement's run, its moment past the millisecond, as now() mostly is.
      await database.query(
        `INSERT INTO "Incident" ("_id", "projectId", "createdAt") SELECT gen_random_uuid(), $1, date_trunc('milliseconds', now()) + interval '456 microseconds' FROM generate_series(1, 900)`,
        [PROJECT_ID],
      );
      const id: string = await insertMeasurement();
      const ordered: Array<string> = await orderedIds();
      const cursorRecord: string = ordered[299]!;

      // Saved by the walk as it was: the createdAt as node-postgres read it.
      const asRead: Array<{ createdAt: Date }> = await database.query(
        `SELECT "createdAt" FROM "Incident" WHERE "_id" = $1`,
        [cursorRecord],
      );
      await database.query(
        `UPDATE "IncidentMeasurement" SET "backfillCursorCreatedAt" = $2, "backfillCursorId" = $3 WHERE "_id" = $1`,
        [id, asRead[0]!.createdAt, cursorRecord],
      );
      await database.query(`DELETE FROM "Incident" WHERE "_id" = $1`, [
        cursorRecord,
      ]);

      expect(await walkToCompletion(id)).toBe(1);

      // The whole run, but the deleted record: the run shares one microsecond past that millisecond.
      expect(INCIDENTS.recomputed()).toEqual(
        ordered.filter((recordId: string): boolean => {
          return recordId !== cursorRecord;
        }),
      );
      expect(await storedCursorExactly(id)).toBe(
        await createdAtExactly(ordered[ordered.length - 1]!),
      );
    });

    test("a cursor whose record was deleted since, in records a second apart: the walk goes on right after it", async () => {
      await insertSpaced({
        count: MAX_PAGES_PER_RUN * PAGE_SIZE + 600,
        fromSql: `SELECT now()`,
        stepInSeconds: 1,
      });
      const id: string = await insertMeasurement();

      await runTick();

      const cursorId: string = (await readBackfill(id)).backfillCursorId!;
      const ordered: Array<string> = await orderedIds();
      const rest: Array<string> = ordered.slice(ordered.indexOf(cursorId) + 1);

      await database.query(`DELETE FROM "Incident" WHERE "_id" = $1`, [
        cursorId,
      ]);
      incidentValues.recomputeForIncident.mockClear();

      expect(await walkToCompletion(id)).toBe(1);
      // Nothing else shares the deleted record's millisecond: nothing is read again.
      expect(INCIDENTS.recomputed()).toEqual(rest);
    });

    test("a cursor whose record was deleted with a deletedAt: its own createdAt still places the next page", async () => {
      await insertRun({ count: MAX_PAGES_PER_RUN * PAGE_SIZE + 600 });
      const id: string = await insertMeasurement();

      await runTick();

      const cursorId: string = (await readBackfill(id)).backfillCursorId!;
      const ordered: Array<string> = await orderedIds();
      const rest: Array<string> = ordered.slice(ordered.indexOf(cursorId) + 1);

      await database.query(
        `UPDATE "Incident" SET "deletedAt" = now() WHERE "_id" = $1`,
        [cursorId],
      );
      incidentValues.recomputeForIncident.mockClear();

      expect(await walkToCompletion(id)).toBe(1);
      expect(INCIDENTS.recomputed()).toEqual(rest);
    });

    test("records deleted with a deletedAt are left out, the rest of the run each once", async () => {
      await insertRun({ count: 1100 });
      await database.query(
        `UPDATE "Incident" SET "deletedAt" = now() WHERE "_id" IN (SELECT "_id" FROM "Incident" ORDER BY "_id" LIMIT 300)`,
      );
      const id: string = await insertMeasurement();

      expect(await walkToCompletion(id)).toBe(1);
      await expectEachWorkedOutOnce(id);
      expect(INCIDENTS.recomputed()).toHaveLength(800);
    });

    test("another project's run is not walked", async () => {
      await insertRun({ count: 600 });
      await insertRun({ count: 700, projectId: OTHER_PROJECT_ID });
      const id: string = await insertMeasurement();

      expect(await walkToCompletion(id)).toBe(1);
      await expectEachWorkedOutOnce(id);
      expect(INCIDENTS.recomputed()).toHaveLength(600);
    });

    test.each(DOMAINS)(
      "$recordTable: a run longer than a page, worked out for its measurement",
      async (domain: Domain) => {
        await insertRun({ count: 1100, table: domain.recordTable });
        const id: string = await insertMeasurement({
          table: domain.measurementTable,
        });

        expect(await walkToCompletion(id, 5, domain.measurementTable)).toBe(1);
        await expectEachWorkedOutOnce(id, domain);
      },
    );
  });

  /*
   * #8105 with #8171: the cursor is now two columns, and an edit clears
   * both. Every write of the walk is still held to the request it read.
   */
  describe("an edit made while a run is walked always wins", () => {
    const EDIT_SQL: string = `UPDATE "IncidentMeasurement" SET "backfillRequestedAt" = $2, "backfillCursorCreatedAt" = NULL, "backfillCursorId" = NULL, "backfillCompletedAt" = NULL, "version" = "version" + 1, "updatedAt" = now() WHERE "_id" = $1`;

    // Lands the edit while the nth record of the tick (from 1) is worked out.
    function editOnRecompute(id: string, nth: number): void {
      let recomputed: number = 0;

      incidentValues.recomputeForIncident.mockImplementation(
        async (): Promise<void> => {
          recomputed++;

          if (recomputed === nth) {
            await database.query(EDIT_SQL, [id, EDITED_AT]);
          }
        },
      );
    }

    async function expectLeftForTheEdit(id: string): Promise<void> {
      const row: StoredBackfill = await readBackfill(id);

      expect(row.backfillRequestedAt?.toISOString()).toBe(
        EDITED_AT.toISOString(),
      );
      expect(row.backfillCursorCreatedAt).toBeNull();
      expect(row.backfillCursorId).toBeNull();
      expect(row.backfillCompletedAt).toBeNull();
    }

    async function expectNextTickWalksTheEditFromTheBeginning(
      id: string,
    ): Promise<void> {
      jest.clearAllMocks();
      incidentValues.recomputeForIncident.mockResolvedValue(undefined);

      await runTick();

      await expectEachWorkedOutOnce(id);
      expect((await readBackfill(id)).backfillRequestedAt?.toISOString()).toBe(
        EDITED_AT.toISOString(),
      );
    }

    test("while the first page of the run is worked out: its cursor is refused, and nothing is left behind", async () => {
      await insertRun({ count: 1200 });
      const id: string = await insertMeasurement();
      editOnRecompute(id, 1);

      await runTick();

      await expectLeftForTheEdit(id);
      expect(INCIDENTS.recomputed()).toHaveLength(PAGE_SIZE);

      await expectNextTickWalksTheEditFromTheBeginning(id);
    });

    test("while a page in the middle of the run is worked out: the cursor in the run written before is cleared for good", async () => {
      await insertRun({ count: 1200 });
      const id: string = await insertMeasurement();
      editOnRecompute(id, PAGE_SIZE + 10);

      await runTick();

      await expectLeftForTheEdit(id);
      expect(INCIDENTS.recomputed()).toHaveLength(2 * PAGE_SIZE);

      await expectNextTickWalksTheEditFromTheBeginning(id);
    });

    test("while the last page is worked out: the completion is refused", async () => {
      await insertRun({ count: 1200 });
      const id: string = await insertMeasurement();
      editOnRecompute(id, 2 * PAGE_SIZE + 1);

      await runTick();

      await expectLeftForTheEdit(id);

      await expectNextTickWalksTheEditFromTheBeginning(id);
    });

    test("between two ticks, the first stopped inside the run: the second walks the edit from the start", async () => {
      await insertRun({ count: MAX_PAGES_PER_RUN * PAGE_SIZE + 300 });
      const id: string = await insertMeasurement();

      await runTick();
      expect((await readBackfill(id)).backfillCursorId).not.toBeNull();

      await database.query(EDIT_SQL, [id, EDITED_AT]);
      jest.clearAllMocks();
      incidentValues.recomputeForIncident.mockResolvedValue(undefined);

      await runTick();

      const ordered: Array<string> = await orderedIds();
      expect(INCIDENTS.recomputed()).toEqual(
        ordered.slice(0, MAX_PAGES_PER_RUN * PAGE_SIZE),
      );

      await runTick();

      expect((await readBackfill(id)).backfillCompletedAt).toBeInstanceOf(Date);
    });

    test("an edit re-requested with the database's now() (FirstPagedAt) is walked to completion through the run", async () => {
      await insertRun({ count: 1200 });
      const id: string = await insertMeasurement();
      await database.query(
        `UPDATE "IncidentMeasurement" SET "backfillRequestedAt" = now(), "backfillCursorCreatedAt" = NULL, "backfillCursorId" = NULL, "backfillCompletedAt" = NULL WHERE "_id" = $1`,
        [id],
      );

      expect(await walkToCompletion(id)).toBe(1);
      await expectEachWorkedOutOnce(id);
    });
  });

  test.each([
    { name: "the millisecond", exactly: false },
    { name: "the microsecond", exactly: true },
  ])(
    "a page is read by the (projectId, createdAt) index, from a cursor to $name on, not by sorting the project",
    async (cursor: { name: string; exactly: boolean }) => {
      await insertRun({ count: 2000 });
      await database.query(`ANALYZE "Incident"`);
      const last: { _id: string; createdAt: Date } = await lastRecord();

      const statement: { sql: string; parameters: Array<unknown> } =
        MeasurementBackfillPage.getStatement({
          tableName: "Incident",
          projectId: new ObjectID(PROJECT_ID),
          after: {
            createdAt: last.createdAt,
            exactCreatedAt: cursor.exactly
              ? await createdAtExactly(last._id)
              : undefined,
            id: new ObjectID(last._id),
          },
          limit: PAGE_SIZE,
        });

      const runner: QueryRunner = database.createQueryRunner();
      await runner.connect();

      try {
        await runner.startTransaction();
        // A table this small would otherwise be read whole: ask what the index plan is.
        await runner.query(`SET LOCAL enable_seqscan = off`);
        const plan: Array<{ "QUERY PLAN": unknown }> = await runner.query(
          `EXPLAIN (FORMAT JSON) ${statement.sql}`,
          statement.parameters,
        );
        await runner.rollbackTransaction();

        const indexes: Array<{ indexname: string; indexdef: string }> =
          await database.query(
            `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = 'Incident'`,
            [schema],
          );
        const byProjectAndCreatedAt: Array<string> = indexes
          .filter((index: { indexdef: string }): boolean => {
            return index.indexdef.includes(`("projectId", "createdAt")`);
          })
          .map((index: { indexname: string }): string => {
            return index.indexname;
          });

        expect(byProjectAndCreatedAt.length).toBeGreaterThan(0);

        const text: string = JSON.stringify(plan);
        expect(
          byProjectAndCreatedAt.some((name: string): boolean => {
            return text.includes(`"Index Name":"${name}"`);
          }),
        ).toBe(true);
      } finally {
        await runner.release();
      }
    },
  );
});
