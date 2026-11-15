import ObjectID from "Common/Types/ObjectID";

/*
 * Regression tests for the Measurement:Backfill cron, which fills in
 * measurement values for entities that already existed when a measurement was
 * defined.
 *
 * The job reaches every service through `as unknown as` casts -- the model
 * graph is too deep to instantiate Partial<Model> over -- so the compiler
 * checks almost nothing about the values it writes. These tests stand in for
 * the types that cannot be applied:
 *
 *   1. THE COLUMN CONTRACT. The backfill timestamps are TIMESTAMPs and the
 *      cursor's id a uuid. The progress write must carry Dates into
 *      backfillCursorCreatedAt / backfillCompletedAt, the id of the entity a
 *      page ended on into backfillCursorId, and the measurement id as the
 *      row's id, never into a date column: an ObjectID landing in the cursor
 *      is a write error that takes down the whole backfill for that project.
 *   2. THE RESUME SEMANTICS. Completed-at-or-after-requested is what stops a
 *      finished backfill from being redone every five minutes, and the cursor
 *      is what stops a restart from starting the project over.
 *   3. EVERY ENTITY ONCE (#8171). The walk is in (createdAt, _id) order and
 *      its cursor is the last entity of a page, both columns of it
 *      (MeasurementBackfillPage), so a run of entities created at one moment
 *      - longer than a page, at the start, middle or end of a project, across
 *      the per-run page cap - is walked through, each entity once. The cursor
 *      was the createdAt alone, read from inclusively: a full page sharing
 *      one createdAt was read again on every tick, for ever. The entity
 *      table below (RecordTable) answers the real page statement as Postgres
 *      does, createdAt kept in microseconds and read to the millisecond.
 *   4. The per-run page cap, and the isolation that keeps one unreadable
 *      entity, or one broken domain, from stalling everything behind it.
 *   5. AN EDIT ALWAYS WINS (#8105). Every write of a walk is a compare-and-set
 *      held to the backfillRequestedAt the walk read
 *      (MeasurementBackfillProgress), so an edit of the measurement made
 *      while it is walked - a new stamp, the cursor and the completion
 *      cleared - is never written over, and the edit's walk starts from the
 *      beginning. The walk wrote with plain updates, which stamped completion
 *      over an edit (the new definition's history was never worked out) or
 *      saved the cursor over the cleared one (its walk resumed part way).
 *      The interleavings run against a table that keeps the guard as Postgres
 *      does (MeasurementTable below); MeasurementBackfillProgressPostgres in
 *      Common runs the statement against Postgres itself, and
 *      BackfillMeasurementsPostgres runs this job against it.
 *
 * The job registers itself via RunCron at import time and exports nothing, so
 * the Cron util is mocked to CAPTURE the handler (the same recorder the other
 * App/Tests/Workers/Jobs suites use) and each test drives one full tick. The
 * page read and the progress write are the real MeasurementBackfillPage and
 * MeasurementBackfillProgress, run on the mocked services' connections
 * (`query` below).
 */

type CronHandler = () => Promise<void>;

/*
 * Captured cron handlers, keyed by job name. Must be declared before the job
 * import below so the mock factory closure can see it.
 */
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
 * A service of a table the job reads with its own SQL: its table's name, and
 * its connection's `query`, where the statement goes. A measurement service
 * also has its reads and the plain update the job used to write progress
 * with; an entity service is read only through `query`.
 */
function mockTableService(tableName: string): {
  __esModule: true;
  default: {
    findBy: jest.Mock;
    updateOneById: jest.Mock;
    query: jest.Mock;
    getModel: () => { tableName: string };
    getRepository: () => { manager: { query: jest.Mock } };
  };
} {
  const query: jest.Mock = jest.fn();

  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      updateOneById: jest.fn(),
      query: query,
      getModel: (): { tableName: string } => {
        return { tableName: tableName };
      },
      getRepository: (): { manager: { query: jest.Mock } } => {
        return { manager: { query: query } };
      },
    },
  };
}

jest.mock("Common/Server/Services/IncidentMeasurementService", () => {
  return mockTableService("IncidentMeasurement");
});
jest.mock("Common/Server/Services/AlertMeasurementService", () => {
  return mockTableService("AlertMeasurement");
});
jest.mock(
  "Common/Server/Services/ScheduledMaintenanceMeasurementService",
  () => {
    return mockTableService("ScheduledMaintenanceMeasurement");
  },
);

jest.mock("Common/Server/Services/IncidentMeasurementValueService", () => {
  return {
    __esModule: true,
    default: { recomputeForIncident: jest.fn() },
  };
});
jest.mock("Common/Server/Services/AlertMeasurementValueService", () => {
  return {
    __esModule: true,
    default: { recomputeForAlert: jest.fn() },
  };
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

jest.mock("Common/Server/Services/IncidentService", () => {
  return mockTableService("Incident");
});
jest.mock("Common/Server/Services/AlertService", () => {
  return mockTableService("Alert");
});
jest.mock("Common/Server/Services/ScheduledMaintenanceService", () => {
  return mockTableService("ScheduledMaintenance");
});

import IncidentMeasurementService from "Common/Server/Services/IncidentMeasurementService";
import AlertMeasurementService from "Common/Server/Services/AlertMeasurementService";
import ScheduledMaintenanceMeasurementService from "Common/Server/Services/ScheduledMaintenanceMeasurementService";
import IncidentMeasurementValueService from "Common/Server/Services/IncidentMeasurementValueService";
import AlertMeasurementValueService from "Common/Server/Services/AlertMeasurementValueService";
import ScheduledMaintenanceMeasurementValueService from "Common/Server/Services/ScheduledMaintenanceMeasurementValueService";
import IncidentService from "Common/Server/Services/IncidentService";
import AlertService from "Common/Server/Services/AlertService";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import logger from "Common/Server/Utils/Logger";
import MeasurementBackfillPage from "Common/Server/Utils/Measurement/MeasurementBackfillPage";

// Imported for its side effect: RunCron (mocked above) records the handler.
import "../../../../FeatureSet/Workers/Jobs/Measurement/BackfillMeasurements";

interface MeasurementServiceMock {
  findBy: jest.Mock;
  updateOneById: jest.Mock;
  query: jest.Mock;
}

interface EntityServiceMock {
  findBy: jest.Mock;
  query: jest.Mock;
}

const incidentMeasurements: MeasurementServiceMock =
  IncidentMeasurementService as unknown as MeasurementServiceMock;
const alertMeasurements: MeasurementServiceMock =
  AlertMeasurementService as unknown as MeasurementServiceMock;
const maintenanceMeasurements: MeasurementServiceMock =
  ScheduledMaintenanceMeasurementService as unknown as MeasurementServiceMock;

const incidents: EntityServiceMock =
  IncidentService as unknown as EntityServiceMock;
const alerts: EntityServiceMock = AlertService as unknown as EntityServiceMock;
const maintenanceEvents: EntityServiceMock =
  ScheduledMaintenanceService as unknown as EntityServiceMock;

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
  logger as unknown as {
    error: jest.Mock;
    warn: jest.Mock;
    info: jest.Mock;
  };

// What QueryHelper.isNull() writes for a column.
const IS_NULL: RegExp = /IS NULL/i;

// Mirrors the constants in the job. A page shorter than this ends the run.
const PAGE_SIZE: number = 500;
const MAX_PAGES_PER_RUN: number = 10;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MEASUREMENT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const FIRST_CREATED_AT: Date = new Date("2026-06-01T09:00:00.000Z");

interface MeasurementRow {
  _id?: ObjectID | undefined;
  projectId?: ObjectID | undefined;
  backfillRequestedAt?: Date | undefined;
  backfillCompletedAt?: Date | undefined;
  backfillCursorCreatedAt?: Date | undefined;
  backfillCursorId?: ObjectID | undefined;
}

// A row of the page read, as node-postgres hands it back.
interface RawRecord {
  _id: string;
  createdAt: Date;
}

function measurementRow(input: {
  id?: ObjectID;
  projectId?: ObjectID | undefined;
  requestedAt?: Date | undefined;
  completedAt?: Date | undefined;
  cursorCreatedAt?: Date | undefined;
  cursorId?: ObjectID | undefined;
}): MeasurementRow {
  return {
    _id: input.id ?? MEASUREMENT_ID,
    projectId: input.projectId ?? PROJECT_ID,
    backfillRequestedAt:
      input.requestedAt ?? new Date("2026-07-01T00:00:00.000Z"),
    backfillCompletedAt: input.completedAt,
    backfillCursorCreatedAt: input.cursorCreatedAt,
    backfillCursorId: input.cursorId,
  };
}

// The id of the index-th record of a batch: ids sort as the indexes do.
function recordId(batch: number, index: number): string {
  return `${String(batch).padStart(8, "0")}-0000-4000-8000-${String(
    index,
  ).padStart(12, "0")}`;
}

// A page of records one second apart, oldest first, as the page read answers.
function recordPage(input: {
  count: number;
  firstCreatedAt: Date;
  batch?: number;
}): Array<RawRecord> {
  const rows: Array<RawRecord> = [];

  for (let index: number = 0; index < input.count; index++) {
    rows.push({
      _id: recordId(input.batch || 0, index),
      createdAt: new Date(input.firstCreatedAt.getTime() + index * 1000),
    });
  }

  return rows;
}

/*
 * One read of a page, read back out of the statement the job ran: the table,
 * the project, the cursor it reads after and the size of the page. Only the
 * statement MeasurementBackfillPage writes reads: any other throws here, so
 * no test below passes on another query.
 */
interface PageRead {
  table: string;
  projectId: string;
  after?: { createdAt: Date; id?: string | undefined } | undefined;
  limit: number;
}

const PAGE_TABLE: RegExp = /^SELECT "_id", "createdAt" FROM "([^"]+)" WHERE /;

function pageReadOf(sql: string, parameters: Array<unknown>): PageRead {
  const table: RegExpExecArray | null = PAGE_TABLE.exec(sql);

  if (!table) {
    throw new Error(`not a page of the backfill: ${sql}`);
  }

  // [project, limit], [project, createdAt, limit] or [project, createdAt, id, limit].
  const read: PageRead = {
    table: table[1]!,
    projectId: parameters[0] as string,
    after:
      parameters.length > 2
        ? {
            createdAt: parameters[1] as Date,
            id: parameters.length > 3 ? (parameters[2] as string) : undefined,
          }
        : undefined,
    limit: parameters[parameters.length - 1] as number,
  };

  const expected: { sql: string; parameters: Array<unknown> } =
    MeasurementBackfillPage.getStatement({
      tableName: read.table,
      projectId: new ObjectID(read.projectId),
      after: read.after
        ? {
            createdAt: read.after.createdAt,
            id: read.after.id ? new ObjectID(read.after.id) : undefined,
          }
        : undefined,
      limit: read.limit,
    });

  if (
    expected.sql !== sql ||
    JSON.stringify(expected.parameters) !== JSON.stringify(parameters)
  ) {
    throw new Error(`not the backfill's page read: ${sql}`);
  }

  return read;
}

// Every page the job read from an entity service, in order.
function pageReadsOf(service: EntityServiceMock): Array<PageRead> {
  return service.query.mock.calls.map((call: Array<unknown>): PageRead => {
    return pageReadOf(call[0] as string, call[1] as Array<unknown>);
  });
}

// Where each read of entities in a tick began: undefined is the beginning.
function walkStartsOf(
  service: EntityServiceMock,
): Array<{ createdAt: Date; id?: string | undefined } | undefined> {
  return pageReadsOf(service).map(
    (
      read: PageRead,
    ): { createdAt: Date; id?: string | undefined } | undefined => {
      return read.after;
    },
  );
}

// Answers the job's page reads with these pages, one per read, then empty ones.
function answerPages(
  service: EntityServiceMock,
  pages: Array<Array<RawRecord>>,
): void {
  let read: number = 0;

  service.query.mockImplementation(
    async (
      sql: string,
      parameters: Array<unknown>,
    ): Promise<Array<RawRecord>> => {
      pageReadOf(sql, parameters);
      return pages[read++] || [];
    },
  );
}

/*
 * One progress write, read back out of the statement the job ran: the table,
 * the columns it sets, the row it names and the request it is held to. Only
 * the guarded statement reads: a write without the guard throws here, so no
 * test below passes on a plain update.
 */
interface ProgressWrite {
  table: string;
  set: Record<string, unknown>;
  id: unknown;
  requestedAt: unknown;
}

const GUARDED_WRITE: RegExp =
  /^WITH "saved" AS \(UPDATE "([^"]+)" SET (.+) WHERE "_id" = \$(\d+) AND date_trunc\('milliseconds', "backfillRequestedAt"\) = \$(\d+) RETURNING "_id"\) SELECT "_id" FROM "saved"$/;

// One "column" = $n of its SET.
const COLUMN_ASSIGNMENT: RegExp = /^"([^"]+)" = \$(\d+)$/;

function progressWriteOf(
  sql: string,
  parameters: Array<unknown>,
): ProgressWrite {
  const statement: RegExpExecArray | null = GUARDED_WRITE.exec(sql);

  if (!statement) {
    throw new Error(`not a backfill write held to its request: ${sql}`);
  }

  const set: Record<string, unknown> = {};

  for (const assignment of statement[2]!.split(", ")) {
    const column: RegExpExecArray | null = COLUMN_ASSIGNMENT.exec(assignment);

    if (!column) {
      throw new Error(`not a column assignment: ${assignment}`);
    }

    set[column[1]!] = parameters[Number(column[2]) - 1];
  }

  return {
    table: statement[1]!,
    set: set,
    id: parameters[Number(statement[3]) - 1],
    requestedAt: parameters[Number(statement[4]) - 1],
  };
}

// Every progress write the job ran on a measurement service's connection.
function writesOf(service: MeasurementServiceMock): Array<ProgressWrite> {
  return service.query.mock.calls.map((call: Array<unknown>): ProgressWrite => {
    return progressWriteOf(call[0] as string, call[1] as Array<unknown>);
  });
}

// The ids of the incidents worked out, in the order they were.
function recomputedIncidents(): Array<string> {
  return incidentValues.recomputeForIncident.mock.calls.map(
    (call: Array<unknown>): string => {
      return (call[0] as { incidentId: ObjectID }).incidentId.toString();
    },
  );
}

async function runTick(): Promise<void> {
  const handler: CronHandler | undefined =
    mockCapturedJobs["Measurement:Backfill"];

  if (!handler) {
    throw new Error("Measurement:Backfill did not register a cron handler");
  }

  await handler();
}

/*
 * A measurement table that keeps the guard as Postgres does, for the tests
 * that land an edit in the middle of a walk. The request is kept in
 * microseconds, as Postgres keeps a timestamp, and read back to the
 * millisecond, as node-postgres reads one. A write lands only while the
 * stored request, to the millisecond, is the one it is held to.
 *
 * It also takes the plain update the job used to write with, unguarded, as
 * the database took it: run against the job as it was, the interleavings
 * below fail.
 */
interface StoredMeasurement {
  id: ObjectID;
  projectId: ObjectID;
  requestedAtInMicroseconds: number | null;
  cursorCreatedAt: Date | null;
  cursorId: string | null;
  completedAt: Date | null;
}

class MeasurementTable {
  private readonly rows: Map<string, StoredMeasurement> = new Map<
    string,
    StoredMeasurement
  >();

  private writeCount: number = 0;

  // Run before the write numbered `writeNumber` (from 1) is applied, once.
  private beforeWrites: Map<number, () => void> = new Map<number, () => void>();

  // Run after the next read of the measurements still to backfill, once.
  private afterNextRead: (() => void) | null = null;

  public constructor(service: MeasurementServiceMock) {
    service.findBy.mockImplementation(
      async (args: { limit: number }): Promise<Array<MeasurementRow>> => {
        const rows: Array<MeasurementRow> = this.readPending(args.limit);
        const afterRead: (() => void) | null = this.afterNextRead;

        this.afterNextRead = null;
        afterRead?.();

        return rows;
      },
    );

    service.query.mockImplementation(
      async (
        sql: string,
        parameters: Array<unknown>,
      ): Promise<Array<{ _id: string }>> => {
        return this.writeGuarded(progressWriteOf(sql, parameters));
      },
    );

    service.updateOneById.mockImplementation(
      async (args: {
        id: ObjectID;
        data: Record<string, unknown>;
      }): Promise<void> => {
        this.writeUnguarded(args);
      },
    );
  }

  public insert(input: {
    id?: ObjectID;
    projectId?: ObjectID;
    requestedAt: Date;
    // Past the millisecond, as a stamp made by the database's now() keeps them.
    extraMicroseconds?: number;
    cursorCreatedAt?: Date;
    cursorId?: string;
  }): ObjectID {
    const id: ObjectID = input.id || MEASUREMENT_ID;

    this.rows.set(id.toString(), {
      id: id,
      projectId: input.projectId || PROJECT_ID,
      requestedAtInMicroseconds:
        input.requestedAt.getTime() * 1000 + (input.extraMicroseconds || 0),
      cursorCreatedAt: input.cursorCreatedAt || null,
      cursorId: input.cursorId || null,
      completedAt: null,
    });

    return id;
  }

  // What an edit of the definition writes (the services' onUpdatePermitted).
  public edit(id: ObjectID, requestedAt: Date): void {
    const row: StoredMeasurement = this.get(id);

    row.requestedAtInMicroseconds = requestedAt.getTime() * 1000;
    row.cursorCreatedAt = null;
    row.cursorId = null;
    row.completedAt = null;
  }

  // The measurement deleted.
  public remove(id: ObjectID): void {
    this.rows.delete(id.toString());
  }

  /*
   * Another writer whose write commits just before the write numbered
   * `writeNumber` (counted from 1 over the whole test) is applied.
   */
  public beforeWrite(writeNumber: number, write: () => void): void {
    this.beforeWrites.set(writeNumber, write);
  }

  // Another writer whose write commits just after the tick's next read.
  public afterRead(write: () => void): void {
    this.afterNextRead = write;
  }

  public get(id: ObjectID = MEASUREMENT_ID): StoredMeasurement {
    const row: StoredMeasurement | undefined = this.rows.get(id.toString());

    if (!row) {
      throw new Error(`no measurement ${id.toString()}`);
    }

    return row;
  }

  // The request a row holds, read to the millisecond.
  public requestedAtOf(id: ObjectID = MEASUREMENT_ID): Date | null {
    const row: StoredMeasurement = this.get(id);

    return row.requestedAtInMicroseconds === null
      ? null
      : new Date(Math.floor(row.requestedAtInMicroseconds / 1000));
  }

  private readPending(limit: number): Array<MeasurementRow> {
    return [...this.rows.values()]
      .filter((row: StoredMeasurement) => {
        return row.requestedAtInMicroseconds !== null && !row.completedAt;
      })
      .sort((a: StoredMeasurement, b: StoredMeasurement) => {
        return (
          a.requestedAtInMicroseconds! - b.requestedAtInMicroseconds! ||
          a.id.toString().localeCompare(b.id.toString())
        );
      })
      .slice(0, limit)
      .map((row: StoredMeasurement): MeasurementRow => {
        return {
          _id: row.id,
          projectId: row.projectId,
          backfillRequestedAt: this.requestedAtOf(row.id) || undefined,
          backfillCompletedAt: row.completedAt || undefined,
          backfillCursorCreatedAt: row.cursorCreatedAt || undefined,
          // As the ObjectID transformer reads it.
          backfillCursorId: row.cursorId
            ? new ObjectID(row.cursorId)
            : undefined,
        };
      });
  }

  private beforeEachWrite(): void {
    this.writeCount++;

    const write: (() => void) | undefined = this.beforeWrites.get(
      this.writeCount,
    );

    this.beforeWrites.delete(this.writeCount);
    write?.();
  }

  private writeGuarded(write: ProgressWrite): Array<{ _id: string }> {
    this.beforeEachWrite();

    const row: StoredMeasurement | undefined = this.rows.get(String(write.id));

    if (
      !row ||
      row.requestedAtInMicroseconds === null ||
      !(write.requestedAt instanceof Date) ||
      Math.floor(row.requestedAtInMicroseconds / 1000) !==
        write.requestedAt.getTime()
    ) {
      return [];
    }

    this.apply(row, write.set);

    return [{ _id: row.id.toString() }];
  }

  private writeUnguarded(args: {
    id: ObjectID;
    data: Record<string, unknown>;
  }): void {
    this.beforeEachWrite();

    const row: StoredMeasurement | undefined = this.rows.get(
      args.id.toString(),
    );

    if (row) {
      this.apply(row, args.data);
    }
  }

  private apply(row: StoredMeasurement, set: Record<string, unknown>): void {
    if (set["backfillCursorCreatedAt"] !== undefined) {
      row.cursorCreatedAt = set["backfillCursorCreatedAt"] as Date;
    }

    if (set["backfillCursorId"] !== undefined) {
      row.cursorId = set["backfillCursorId"]
        ? String(set["backfillCursorId"])
        : null;
    }

    if (set["backfillCompletedAt"] !== undefined) {
      row.completedAt = set["backfillCompletedAt"] as Date;
    }
  }
}

/*
 * A table of records (incidents, alerts or maintenance events) that answers
 * the job's page read as Postgres answers MeasurementBackfillPage's
 * statement: a project's records not deleted, in (createdAt, _id) order,
 * after the cursor - compared with the cursor record's own createdAt, or
 * with the stored one when that record is gone - LIMIT the page. createdAt
 * is kept in microseconds and read back to the millisecond, as Postgres
 * keeps it and node-postgres reads it.
 */
interface StoredRecord {
  id: string;
  projectId: string;
  createdAtInMicroseconds: number;
  isDeleted: boolean;
}

class RecordTable {
  private rows: Array<StoredRecord> = [];

  private batch: number = 0;

  public constructor(service: EntityServiceMock) {
    service.query.mockImplementation(
      async (
        sql: string,
        parameters: Array<unknown>,
      ): Promise<Array<RawRecord>> => {
        return this.readPage(pageReadOf(sql, parameters));
      },
    );
  }

  /*
   * Adds `count` records from `createdAt` on, `apartInMicroseconds` apart (a
   * second unless said; 0 is a run created at one moment, as one
   * transaction's now() makes them), with ids in their order, or shuffled.
   */
  public add(input: {
    count: number;
    createdAt: Date;
    apartInMicroseconds?: number;
    extraMicroseconds?: number;
    shuffledIds?: boolean;
    projectId?: ObjectID;
  }): Array<string> {
    const batch: number = ++this.batch;
    const apart: number =
      input.apartInMicroseconds === undefined
        ? 1000000
        : input.apartInMicroseconds;
    const ids: Array<string> = [];

    for (let index: number = 0; index < input.count; index++) {
      ids.push(recordId(batch, index));
    }

    if (input.shuffledIds) {
      // A fixed shuffle: ids that do not sort as the records were added.
      for (let index: number = ids.length - 1; index > 0; index--) {
        const other: number = (index * 7919 + 13) % (index + 1);
        [ids[index], ids[other]] = [ids[other]!, ids[index]!];
      }
    }

    for (let index: number = 0; index < input.count; index++) {
      this.rows.push({
        id: ids[index]!,
        projectId: (input.projectId || PROJECT_ID).toString(),
        createdAtInMicroseconds:
          input.createdAt.getTime() * 1000 +
          (input.extraMicroseconds || 0) +
          index * apart,
        isDeleted: false,
      });
    }

    return ids;
  }

  // The project's records not deleted, in the order the walk visits them.
  public ordered(projectId: ObjectID = PROJECT_ID): Array<string> {
    return this.sorted(
      this.rows.filter((row: StoredRecord) => {
        return row.projectId === projectId.toString() && !row.isDeleted;
      }),
    ).map((row: StoredRecord): string => {
      return row.id;
    });
  }

  // A record as the page read hands it back.
  public read(id: string): { id: string; createdAt: Date } {
    const row: StoredRecord = this.find(id)!;

    return {
      id: row.id,
      createdAt: new Date(Math.floor(row.createdAtInMicroseconds / 1000)),
    };
  }

  // The last record the walk visits.
  public last(): { id: string; createdAt: Date } {
    const ids: Array<string> = this.ordered();

    return this.read(ids[ids.length - 1]!);
  }

  // The record deleted for good.
  public purge(id: string): void {
    this.rows = this.rows.filter((row: StoredRecord) => {
      return row.id !== id;
    });
  }

  // The record deleted with a deletedAt: it stays, and is not read.
  public softDelete(id: string): void {
    this.find(id)!.isDeleted = true;
  }

  private find(id: string): StoredRecord | undefined {
    return this.rows.find((row: StoredRecord) => {
      return row.id === id;
    });
  }

  private sorted(rows: Array<StoredRecord>): Array<StoredRecord> {
    // uuids compare byte by byte: as their lowercase text does.
    return [...rows].sort((a: StoredRecord, b: StoredRecord) => {
      return (
        a.createdAtInMicroseconds - b.createdAtInMicroseconds ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      );
    });
  }

  private readPage(read: PageRead): Array<RawRecord> {
    let rows: Array<StoredRecord> = this.rows.filter((row: StoredRecord) => {
      return row.projectId === read.projectId && !row.isDeleted;
    });

    if (read.after) {
      const from: number = read.after.createdAt.getTime() * 1000;

      rows = rows.filter((row: StoredRecord) => {
        return row.createdAtInMicroseconds >= from;
      });

      if (read.after.id) {
        const cursorId: string = read.after.id;
        // The cursor record's own createdAt, deleted or not; the stored one once it is gone.
        const cursorAt: number =
          this.find(cursorId)?.createdAtInMicroseconds ?? from;

        rows = rows.filter((row: StoredRecord) => {
          return (
            row.createdAtInMicroseconds > cursorAt ||
            (row.createdAtInMicroseconds === cursorAt && row.id > cursorId)
          );
        });
      }
    }

    return this.sorted(rows)
      .slice(0, read.limit)
      .map((row: StoredRecord): RawRecord => {
        return {
          _id: row.id,
          createdAt: new Date(Math.floor(row.createdAtInMicroseconds / 1000)),
        };
      });
  }
}

// How many times each id was worked out, for the ids worked out more than once.
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

describe("Measurement:Backfill", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Nothing to backfill in any domain unless a test says otherwise.
    for (const service of [
      incidentMeasurements,
      alertMeasurements,
      maintenanceMeasurements,
    ]) {
      service.findBy.mockResolvedValue([] as Array<MeasurementRow>);
      service.updateOneById.mockResolvedValue(undefined);
      // Every write lands unless a test says otherwise.
      service.query.mockImplementation(
        async (
          _sql: string,
          parameters: Array<unknown>,
        ): Promise<Array<{ _id: unknown }>> => {
          return [{ _id: parameters[parameters.length - 2] }];
        },
      );
    }

    // No records in any project unless a test says otherwise.
    for (const service of [incidents, alerts, maintenanceEvents]) {
      service.findBy.mockResolvedValue([]);
      answerPages(service, []);
    }

    incidentValues.recomputeForIncident.mockResolvedValue(undefined);
    alertValues.recomputeForAlert.mockResolvedValue(undefined);
    maintenanceValues.recomputeForScheduledMaintenance.mockResolvedValue(
      undefined,
    );
  });

  test("registers itself, so the tick under test is the one that ships", () => {
    expect(mockCapturedJobs["Measurement:Backfill"]).toBeDefined();
  });

  test("walks every domain on one tick, so a measurement is never left to a later run", async () => {
    await runTick();

    expect(incidentMeasurements.findBy).toHaveBeenCalledTimes(1);
    expect(alertMeasurements.findBy).toHaveBeenCalledTimes(1);
    expect(maintenanceMeasurements.findBy).toHaveBeenCalledTimes(1);
  });

  describe("reading the measurements still to backfill", () => {
    test("asks the database only for unfinished requests, oldest first, in every domain", async () => {
      await runTick();

      for (const service of [
        incidentMeasurements,
        alertMeasurements,
        maintenanceMeasurements,
      ]) {
        const read: {
          query: Record<string, unknown>;
          sort: Record<string, unknown>;
          limit: number;
          select: Record<string, unknown>;
        } = service.findBy.mock.calls[0]![0] as {
          query: Record<string, unknown>;
          sort: Record<string, unknown>;
          limit: number;
          select: Record<string, unknown>;
        };

        expect(Object.keys(read.query).sort()).toEqual([
          "backfillCompletedAt",
          "backfillRequestedAt",
        ]);
        expect(
          (
            read.query["backfillRequestedAt"] as {
              getSql: (a: string) => string;
            }
          ).getSql("c"),
        ).toMatch(/c IS NOT NULL/i);
        expect(
          (
            read.query["backfillCompletedAt"] as {
              getSql: (a: string) => string;
            }
          ).getSql("c"),
        ).toMatch(/c IS NULL/i);
        expect(read.sort).toEqual({
          backfillRequestedAt: "ASC",
          _id: "ASC",
        });
        expect(read.limit).toBe(PAGE_SIZE);
        // The request is read with the row: every write of the walk is held to it.
        expect(read.select["backfillRequestedAt"]).toBe(true);
        // And the cursor, both its columns: the walk resumes after its entity.
        expect(read.select["backfillCursorCreatedAt"]).toBe(true);
        expect(read.select["backfillCursorId"]).toBe(true);
      }
    });

    test("reaches a new request past 500 finished ones: a finished backfill never crowds one out", async () => {
      // What the table holds: 600 finished backfills, then one new request.
      const finished: Array<MeasurementRow> = Array.from(
        { length: 600 },
        (_value: unknown, index: number): MeasurementRow => {
          return measurementRow({
            id: new ObjectID(
              `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`,
            ),
            requestedAt: new Date("2026-07-01T00:00:00.000Z"),
            completedAt: new Date("2026-07-01T00:05:00.000Z"),
          });
        },
      );
      const fresh: MeasurementRow = measurementRow({
        requestedAt: new Date("2026-07-02T00:00:00.000Z"),
      });

      // A database that applies the read's filter and limit.
      incidentMeasurements.findBy.mockImplementation(
        async (args: {
          query: Record<string, { getSql: (a: string) => string }>;
          limit: number;
        }): Promise<Array<MeasurementRow>> => {
          const unfinishedPredicate: string =
            args.query["backfillCompletedAt"]?.getSql("c") || "";
          const onlyUnfinished: boolean = IS_NULL.test(unfinishedPredicate);

          return [...finished, fresh]
            .filter((row: MeasurementRow) => {
              return !onlyUnfinished || !row.backfillCompletedAt;
            })
            .slice(0, args.limit);
        },
      );

      await runTick();

      expect(incidents.query).toHaveBeenCalledTimes(1);
      expect(
        writesOf(incidentMeasurements).map((write: ProgressWrite): unknown => {
          return write.id;
        }),
      ).toEqual([MEASUREMENT_ID.toString()]);
    });
  });

  describe("deciding what still needs a backfill", () => {
    test("skips a measurement that finished after it was requested, so a done backfill is not redone every five minutes", async () => {
      incidentMeasurements.findBy.mockResolvedValue([
        measurementRow({
          requestedAt: new Date("2026-07-01T00:00:00.000Z"),
          completedAt: new Date("2026-07-01T00:05:00.000Z"),
        }),
      ]);

      await runTick();

      expect(incidents.query).not.toHaveBeenCalled();
      expect(incidentMeasurements.query).not.toHaveBeenCalled();
    });

    test("runs again when the definition was edited after the last completion, because its history has to be rewritten", async () => {
      incidentMeasurements.findBy.mockResolvedValue([
        measurementRow({
          completedAt: new Date("2026-07-01T00:05:00.000Z"),
          requestedAt: new Date("2026-07-02T00:00:00.000Z"),
        }),
      ]);

      await runTick();

      expect(incidents.query).toHaveBeenCalledTimes(1);
    });

    test("runs a measurement that has never completed", async () => {
      incidentMeasurements.findBy.mockResolvedValue([
        measurementRow({ completedAt: undefined }),
      ]);

      await runTick();

      expect(incidents.query).toHaveBeenCalledTimes(1);
    });

    test("skips a row with no id or no project, which has nothing to scope a walk to", async () => {
      const requestedAt: Date = new Date("2026-07-01T00:00:00.000Z");

      incidentMeasurements.findBy.mockResolvedValue([
        { projectId: PROJECT_ID, backfillRequestedAt: requestedAt },
        { _id: MEASUREMENT_ID, backfillRequestedAt: requestedAt },
      ] as Array<MeasurementRow>);

      await runTick();

      expect(incidents.query).not.toHaveBeenCalled();
    });

    test("skips a row read without its request, which has nothing to hold the walk's writes to", async () => {
      incidentMeasurements.findBy.mockResolvedValue([
        { _id: MEASUREMENT_ID, projectId: PROJECT_ID },
      ] as Array<MeasurementRow>);

      await runTick();

      expect(incidents.query).not.toHaveBeenCalled();
      expect(incidentMeasurements.query).not.toHaveBeenCalled();
      expect(incidentMeasurements.updateOneById).not.toHaveBeenCalled();
    });
  });

  describe("the progress write", () => {
    test("writes timestamps into the backfill columns, the last entity's id into the cursor's, and carries the measurement id as the row id", async () => {
      /*
       * THE regression this suite was written for. The timestamps are
       * TIMESTAMPs, and the measurement's ObjectID addresses the row -- it
       * must never be one of the values.
       */
      const page: Array<RawRecord> = recordPage({
        count: 3,
        firstCreatedAt: FIRST_CREATED_AT,
      });

      incidentMeasurements.findBy.mockResolvedValue([measurementRow({})]);
      answerPages(incidents, [page]);

      await runTick();

      const writes: Array<ProgressWrite> = writesOf(incidentMeasurements);

      expect(writes).toHaveLength(1);
      expect(writes[0]!.table).toBe("IncidentMeasurement");
      expect(writes[0]!.id).toBe(MEASUREMENT_ID.toString());

      const set: Record<string, unknown> = writes[0]!.set;

      expect(Object.keys(set).sort()).toEqual([
        "backfillCompletedAt",
        "backfillCursorCreatedAt",
        "backfillCursorId",
      ]);

      expect(set["backfillCompletedAt"]).toBeInstanceOf(Date);
      expect(set["backfillCursorCreatedAt"]).toBeInstanceOf(Date);
      expect(set["backfillCursorId"]).not.toBe(MEASUREMENT_ID.toString());

      // The cursor is the last row of the page, not the first and not "now".
      expect((set["backfillCursorCreatedAt"] as Date).toISOString()).toBe(
        page[2]!.createdAt.toISOString(),
      );
      expect(set["backfillCursorId"]).toBe(page[2]!._id);
    });

    test("holds every write to the request the walk read, never to now or to its own completion", async () => {
      const requestedAt: Date = new Date("2026-07-01T00:00:00.123Z");

      incidentMeasurements.findBy.mockResolvedValue([
        measurementRow({ requestedAt: requestedAt }),
      ]);
      answerPages(incidents, [
        recordPage({ count: PAGE_SIZE, firstCreatedAt: FIRST_CREATED_AT }),
        recordPage({
          count: PAGE_SIZE,
          firstCreatedAt: new Date(
            FIRST_CREATED_AT.getTime() + PAGE_SIZE * 1000,
          ),
          batch: 1,
        }),
      ]);

      await runTick();

      const writes: Array<ProgressWrite> = writesOf(incidentMeasurements);

      // Two pages' cursors, then the completion: all held to the same request.
      expect(writes).toHaveLength(3);
      for (const write of writes) {
        expect(write.requestedAt).toBeInstanceOf(Date);
        expect((write.requestedAt as Date).toISOString()).toBe(
          requestedAt.toISOString(),
        );
      }
      expect(writes[2]!.set["backfillCompletedAt"]).not.toEqual(requestedAt);
    });

    test("never writes progress with a plain update, which an edit could be lost under", async () => {
      incidentMeasurements.findBy.mockResolvedValue([measurementRow({})]);
      answerPages(incidents, [
        recordPage({ count: PAGE_SIZE, firstCreatedAt: FIRST_CREATED_AT }),
      ]);

      await runTick();

      expect(writesOf(incidentMeasurements)).toHaveLength(2);
      expect(incidentMeasurements.updateOneById).not.toHaveBeenCalled();
    });

    test("stamps completion on a short page, because a page under the limit is the end of the project", async () => {
      incidentMeasurements.findBy.mockResolvedValue([measurementRow({})]);
      answerPages(incidents, [
        recordPage({ count: PAGE_SIZE - 1, firstCreatedAt: FIRST_CREATED_AT }),
      ]);

      await runTick();

      expect(incidents.query).toHaveBeenCalledTimes(1);
      expect(
        writesOf(incidentMeasurements)[0]!.set["backfillCompletedAt"],
      ).toBeInstanceOf(Date);
    });

    test("stamps completion for a project with no entities at all, so an empty project stops being rescanned", async () => {
      incidentMeasurements.findBy.mockResolvedValue([measurementRow({})]);

      await runTick();

      const set: Record<string, unknown> =
        writesOf(incidentMeasurements)[0]!.set;

      expect(set["backfillCompletedAt"]).toBeInstanceOf(Date);
      // No rows, so there is no cursor to write -- and null would clear it.
      expect(set["backfillCursorCreatedAt"]).toBeUndefined();
      expect(set["backfillCursorId"]).toBeUndefined();
    });

    test("saves the cursor without a completion stamp mid-walk, so an interrupted run resumes instead of finishing early", async () => {
      const page: Array<RawRecord> = recordPage({
        count: PAGE_SIZE,
        firstCreatedAt: FIRST_CREATED_AT,
      });

      incidentMeasurements.findBy.mockResolvedValue([measurementRow({})]);
      answerPages(incidents, [page]);

      await runTick();

      const firstSet: Record<string, unknown> =
        writesOf(incidentMeasurements)[0]!.set;

      expect(firstSet["backfillCursorCreatedAt"]).toEqual(
        page[PAGE_SIZE - 1]!.createdAt,
      );
      expect(firstSet["backfillCursorId"]).toBe(page[PAGE_SIZE - 1]!._id);
      expect(firstSet["backfillCompletedAt"]).toBeUndefined();
    });

    test("writes both columns of the cursor in every write that moves it: never a createdAt without its entity", async () => {
      const table: RecordTable = new RecordTable(incidents);
      table.add({ count: 2 * PAGE_SIZE + 7, createdAt: FIRST_CREATED_AT });
      incidentMeasurements.findBy.mockResolvedValue([measurementRow({})]);

      await runTick();

      const writes: Array<ProgressWrite> = writesOf(incidentMeasurements);

      expect(writes).toHaveLength(3);
      for (const write of writes) {
        expect(write.set["backfillCursorCreatedAt"]).toBeInstanceOf(Date);
        expect(typeof write.set["backfillCursorId"]).toBe("string");

        // The pair names one entity: its createdAt and its id.
        expect(
          table.read(write.set["backfillCursorId"] as string).createdAt,
        ).toEqual(write.set["backfillCursorCreatedAt"]);
      }
    });
  });

  describe("paging", () => {
    test("scopes the first page to the project, from its first entity, a page at a time", async () => {
      incidentMeasurements.findBy.mockResolvedValue([
        measurementRow({ cursorCreatedAt: undefined }),
      ]);

      await runTick();

      const reads: Array<PageRead> = pageReadsOf(incidents);

      expect(reads).toHaveLength(1);
      expect(reads[0]).toEqual({
        table: "Incident",
        projectId: PROJECT_ID.toString(),
        after: undefined,
        limit: PAGE_SIZE,
      });
    });

    test("resumes after the stored cursor's entity rather than walking the project again", async () => {
      const cursorCreatedAt: Date = new Date("2026-06-15T12:00:00.000Z");
      const cursorId: ObjectID = new ObjectID(recordId(9, 41));

      incidentMeasurements.findBy.mockResolvedValue([
        measurementRow({
          cursorCreatedAt: cursorCreatedAt,
          cursorId: cursorId,
        }),
      ]);

      await runTick();

      expect(walkStartsOf(incidents)).toEqual([
        { createdAt: cursorCreatedAt, id: cursorId.toString() },
      ]);
    });

    test("resumes a cursor saved before the walk kept an id from its createdAt on, inclusive, and saves both after", async () => {
      // Written by the walk before #8171: the createdAt alone.
      const table: RecordTable = new RecordTable(incidents);
      table.add({ count: 300, createdAt: FIRST_CREATED_AT });
      const ordered: Array<string> = table.ordered();
      const cursor: { id: string; createdAt: Date } = table.read(ordered[99]!);

      incidentMeasurements.findBy.mockResolvedValue([
        measurementRow({ cursorCreatedAt: cursor.createdAt }),
      ]);

      await runTick();

      expect(walkStartsOf(incidents)).toEqual([
        { createdAt: cursor.createdAt, id: undefined },
      ]);
      // The boundary entity again, as the inclusive read did, and every one after it once.
      expect(recomputedIncidents()).toEqual(ordered.slice(99));
      expect(writesOf(incidentMeasurements)[0]!.set["backfillCursorId"]).toBe(
        ordered[299],
      );
    });

    test("an id left without its createdAt is no cursor: the walk starts from the beginning", async () => {
      incidentMeasurements.findBy.mockResolvedValue([
        measurementRow({ cursorId: new ObjectID(recordId(9, 41)) }),
      ]);

      await runTick();

      expect(walkStartsOf(incidents)).toEqual([undefined]);
    });

    test("advances the cursor page by page until a short page ends the walk", async () => {
      const first: Array<RawRecord> = recordPage({
        count: PAGE_SIZE,
        firstCreatedAt: FIRST_CREATED_AT,
      });

      incidentMeasurements.findBy.mockResolvedValue([measurementRow({})]);
      answerPages(incidents, [
        first,
        recordPage({
          count: 2,
          firstCreatedAt: new Date("2026-06-02T09:00:00.000Z"),
          batch: 1,
        }),
      ]);

      await runTick();

      // The second page starts after the last row of the first: its createdAt and its id.
      expect(walkStartsOf(incidents)).toEqual([
        undefined,
        {
          createdAt: first[PAGE_SIZE - 1]!.createdAt,
          id: first[PAGE_SIZE - 1]!._id,
        },
      ]);

      const writes: Array<ProgressWrite> = writesOf(incidentMeasurements);

      expect(writes).toHaveLength(2);
      expect(writes[1]!.set["backfillCompletedAt"]).toBeInstanceOf(Date);
    });

    test("stops after the per-run page cap, so one large project cannot starve the others", async () => {
      // Every page is full, so only the cap can end this walk.
      const table: RecordTable = new RecordTable(incidents);
      table.add({
        count: (MAX_PAGES_PER_RUN + 2) * PAGE_SIZE,
        createdAt: FIRST_CREATED_AT,
      });
      incidentMeasurements.findBy.mockResolvedValue([measurementRow({})]);

      await runTick();

      expect(incidents.query).toHaveBeenCalledTimes(MAX_PAGES_PER_RUN);
      // Nothing is marked complete: the next tick picks the walk back up.
      const writes: Array<ProgressWrite> = writesOf(incidentMeasurements);

      expect(writes).toHaveLength(MAX_PAGES_PER_RUN);
      for (const write of writes) {
        expect(write.set["backfillCompletedAt"]).toBeUndefined();
      }
    });

    test("walks on through a full page that shares one createdAt, never reading the same page again", async () => {
      /*
       * #8171. The walk used to stop here with "more than 500 rows share
       * one createdAt" and retry the same page on every tick, for ever.
       */
      const table: RecordTable = new RecordTable(incidents);
      table.add({
        count: PAGE_SIZE + 20,
        createdAt: FIRST_CREATED_AT,
        apartInMicroseconds: 0,
      });
      incidentMeasurements.findBy.mockResolvedValue([measurementRow({})]);

      await runTick();

      expect(incidents.query).toHaveBeenCalledTimes(2);
      expect(mockedLogger.warn).not.toHaveBeenCalled();
      expect(recomputedIncidents()).toEqual(table.ordered());

      const writes: Array<ProgressWrite> = writesOf(incidentMeasurements);
      // The first page's cursor sits in the run; the second page finishes it.
      expect(writes[0]!.set["backfillCursorCreatedAt"]).toEqual(
        FIRST_CREATED_AT,
      );
      expect(writes[0]!.set["backfillCursorId"]).toBe(
        table.ordered()[PAGE_SIZE - 1],
      );
      expect(writes[1]!.set["backfillCompletedAt"]).toBeInstanceOf(Date);
    });
  });

  /*
   * #8171. Every row one transaction inserts gets the same createdAt - its
   * now() - so a bulk import, or a migration that copies records, leaves a
   * run of entities with one createdAt, as long as the import. The walk has
   * to go through it whatever its length and wherever it is, visiting each
   * entity once, and a page has to be free to end anywhere in it.
   */
  describe("a run of entities created at one moment", () => {
    const RUN_AT: Date = new Date("2026-06-01T10:00:00.000Z");

    let table: MeasurementTable;
    let records: RecordTable;

    beforeEach(() => {
      table = new MeasurementTable(incidentMeasurements);
      records = new RecordTable(incidents);
      table.insert({ requestedAt: new Date("2026-07-01T00:00:00.000Z") });
    });

    // Ticks until the measurement completes, at most `ticks` of them.
    async function walkToCompletion(ticks: number = 5): Promise<number> {
      for (let tick: number = 1; tick <= ticks; tick++) {
        await runTick();

        if (table.get().completedAt) {
          return tick;
        }
      }

      throw new Error(`not completed after ${ticks} ticks`);
    }

    // Each entity worked out once, in the walk's order, and the cursor at the last.
    function expectEachWorkedOutOnce(): void {
      expect(repeatsOf(recomputedIncidents())).toEqual({});
      expect(recomputedIncidents()).toEqual(records.ordered());

      const row: StoredMeasurement = table.get();

      expect(row.completedAt).toBeInstanceOf(Date);
      expect(row.cursorId).toBe(records.last().id);
      expect(row.cursorCreatedAt).toEqual(records.last().createdAt);
      expect(mockedLogger.warn).not.toHaveBeenCalled();
      expect(mockedLogger.error).not.toHaveBeenCalled();
    }

    test("longer than a page, at the start of the project", async () => {
      records.add({ count: 1200, createdAt: RUN_AT, apartInMicroseconds: 0 });
      records.add({
        count: 300,
        createdAt: new Date(RUN_AT.getTime() + 1000),
      });

      expect(await walkToCompletion()).toBe(1);
      expectEachWorkedOutOnce();
      // 500, 500, 500 and an empty page, the first two ending inside the run.
      expect(incidents.query).toHaveBeenCalledTimes(4);
    });

    test("longer than a page, in the middle of the project", async () => {
      records.add({
        count: 300,
        createdAt: new Date(RUN_AT.getTime() - 300 * 1000),
      });
      records.add({ count: 1300, createdAt: RUN_AT, apartInMicroseconds: 0 });
      records.add({
        count: 300,
        createdAt: new Date(RUN_AT.getTime() + 1000),
      });

      expect(await walkToCompletion()).toBe(1);
      expectEachWorkedOutOnce();
    });

    test("longer than a page, at the end of the project, the last page ending in it", async () => {
      records.add({
        count: 300,
        createdAt: new Date(RUN_AT.getTime() - 300 * 1000),
      });
      records.add({ count: 1250, createdAt: RUN_AT, apartInMicroseconds: 0 });

      expect(await walkToCompletion()).toBe(1);
      expectEachWorkedOutOnce();
      expect(table.get().cursorCreatedAt).toEqual(RUN_AT);
    });

    test("the whole project, in one run", async () => {
      records.add({ count: 2000, createdAt: RUN_AT, apartInMicroseconds: 0 });

      expect(await walkToCompletion()).toBe(1);
      expectEachWorkedOutOnce();
    });

    test("exactly a page long, the page ending on the run's last entity", async () => {
      records.add({
        count: PAGE_SIZE,
        createdAt: RUN_AT,
        apartInMicroseconds: 0,
      });
      records.add({ count: 3, createdAt: new Date(RUN_AT.getTime() + 1000) });

      expect(await walkToCompletion()).toBe(1);
      expectEachWorkedOutOnce();
    });

    test("a page and one long, its last entity alone on the next page", async () => {
      records.add({
        count: PAGE_SIZE + 1,
        createdAt: RUN_AT,
        apartInMicroseconds: 0,
      });

      expect(await walkToCompletion()).toBe(1);
      expectEachWorkedOutOnce();
    });

    test("with ids that do not sort as the entities were added: the walk goes by the id", async () => {
      const ids: Array<string> = records.add({
        count: 1100,
        createdAt: RUN_AT,
        apartInMicroseconds: 0,
        shuffledIds: true,
      });

      expect(ids).not.toEqual([...ids].sort());
      expect(await walkToCompletion()).toBe(1);
      expectEachWorkedOutOnce();
    });

    test("longer than one tick's pages: the next tick resumes in the middle of the run, after the entity the last ended on", async () => {
      const runLength: number = MAX_PAGES_PER_RUN * PAGE_SIZE + 1200;
      records.add({
        count: runLength,
        createdAt: RUN_AT,
        apartInMicroseconds: 0,
      });
      records.add({ count: 10, createdAt: new Date(RUN_AT.getTime() + 1000) });

      await runTick();

      // The first tick stops at its cap, inside the run, and saves where.
      const afterFirstTick: StoredMeasurement = { ...table.get() };
      expect(afterFirstTick.completedAt).toBeNull();
      expect(afterFirstTick.cursorCreatedAt).toEqual(RUN_AT);
      expect(afterFirstTick.cursorId).toBe(
        records.ordered()[MAX_PAGES_PER_RUN * PAGE_SIZE - 1],
      );

      const firstTick: Array<string> = recomputedIncidents();
      incidentValues.recomputeForIncident.mockClear();
      incidents.query.mockClear();

      await runTick();

      // The second starts after that entity: the rest of the run, each once.
      expect(walkStartsOf(incidents)[0]).toEqual({
        createdAt: RUN_AT,
        id: afterFirstTick.cursorId,
      });
      expect([...firstTick, ...recomputedIncidents()]).toEqual(
        records.ordered(),
      );
      expect(table.get().completedAt).toBeInstanceOf(Date);
      expect(mockedLogger.warn).not.toHaveBeenCalled();
    });

    test("created within one millisecond, apart by microseconds: each entity once, though a read keeps only the millisecond", async () => {
      /*
       * node-postgres reads createdAt to the millisecond, so every entity of
       * this run reads as created at RUN_AT. Compared with that, the page
       * after a cursor in the run would hold the whole run again; it
       * compares with the cursor entity's own createdAt instead.
       */
      records.add({
        count: 800,
        createdAt: RUN_AT,
        apartInMicroseconds: 1,
        shuffledIds: true,
      });

      expect(await walkToCompletion()).toBe(1);
      expectEachWorkedOutOnce();
    });

    test("a cursor whose entity was deleted since: the walk goes on from its createdAt, passing over none of the run", async () => {
      records.add({
        count: MAX_PAGES_PER_RUN * PAGE_SIZE + 600,
        createdAt: RUN_AT,
        apartInMicroseconds: 0,
      });

      await runTick();

      const cursorId: string = table.get().cursorId!;
      const ordered: Array<string> = records.ordered();
      const rest: Array<string> = ordered.slice(ordered.indexOf(cursorId) + 1);

      // The entity the cursor names is deleted for good between the ticks.
      records.purge(cursorId);
      incidentValues.recomputeForIncident.mockClear();

      await runTick();

      expect(recomputedIncidents()).toEqual(rest);
      expect(table.get().completedAt).toBeInstanceOf(Date);
    });

    test("a cursor whose entity was deleted, in a run apart by microseconds: a few of its millisecond are read again, none passed over", async () => {
      records.add({
        count: MAX_PAGES_PER_RUN * PAGE_SIZE + 600,
        createdAt: RUN_AT,
        apartInMicroseconds: 1,
      });

      await runTick();

      const cursorId: string = table.get().cursorId!;
      const cursorCreatedAt: Date = table.get().cursorCreatedAt!;
      const ordered: Array<string> = records.ordered();
      const firstTick: Array<string> = recomputedIncidents();
      const rest: Array<string> = ordered.slice(ordered.indexOf(cursorId) + 1);

      records.purge(cursorId);
      incidentValues.recomputeForIncident.mockClear();

      await runTick();

      const secondTick: Array<string> = recomputedIncidents();
      const readAgain: Array<string> = secondTick.slice(
        0,
        secondTick.length - rest.length,
      );

      // Every entity after the cursor is worked out...
      expect(secondTick.slice(secondTick.length - rest.length)).toEqual(rest);
      // ...and what is read again was worked out by the first tick, within the cursor's millisecond.
      expect(readAgain.length).toBeGreaterThan(0);
      expect(readAgain.length).toBeLessThan(1000);
      for (const id of readAgain) {
        expect(firstTick).toContain(id);
        expect(records.read(id).createdAt).toEqual(cursorCreatedAt);
      }
      expect(table.get().completedAt).toBeInstanceOf(Date);
    });

    test("entities of the run deleted with a deletedAt are left out, the rest each once", async () => {
      const ids: Array<string> = records.add({
        count: 1100,
        createdAt: RUN_AT,
        apartInMicroseconds: 0,
      });

      for (const id of ids.slice(400, 700)) {
        records.softDelete(id);
      }

      expect(await walkToCompletion()).toBe(1);
      expectEachWorkedOutOnce();
      expect(recomputedIncidents()).toHaveLength(800);
    });

    test("another project's run is not walked", async () => {
      records.add({ count: 600, createdAt: RUN_AT, apartInMicroseconds: 0 });
      records.add({
        count: 700,
        createdAt: RUN_AT,
        apartInMicroseconds: 0,
        projectId: new ObjectID("99999999-9999-4999-8999-999999999999"),
      });

      expect(await walkToCompletion()).toBe(1);
      expectEachWorkedOutOnce();
      expect(recomputedIncidents()).toHaveLength(600);
    });
  });

  describe("recomputing", () => {
    test("recomputes every entity on the page, which is what actually fills the measurement in", async () => {
      const page: Array<RawRecord> = recordPage({
        count: 3,
        firstCreatedAt: FIRST_CREATED_AT,
      });

      incidentMeasurements.findBy.mockResolvedValue([measurementRow({})]);
      answerPages(incidents, [page]);

      await runTick();

      expect(incidentValues.recomputeForIncident).toHaveBeenCalledTimes(3);
      expect(incidentValues.recomputeForIncident).toHaveBeenCalledWith({
        incidentId: expect.any(ObjectID),
      });
      expect(recomputedIncidents()).toEqual(
        page.map((row: RawRecord): string => {
          return row._id;
        }),
      );
    });

    test("keeps going when one entity fails, so a single bad row cannot stall the cursor behind it", async () => {
      incidentMeasurements.findBy.mockResolvedValue([measurementRow({})]);
      answerPages(incidents, [
        recordPage({ count: 3, firstCreatedAt: FIRST_CREATED_AT }),
      ]);
      incidentValues.recomputeForIncident
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("unreadable incident"))
        .mockResolvedValueOnce(undefined);

      await runTick();

      expect(incidentValues.recomputeForIncident).toHaveBeenCalledTimes(3);
      expect(mockedLogger.error).toHaveBeenCalled();
      // The page still completes, so the walk moves past the bad row.
      expect(writesOf(incidentMeasurements)).toHaveLength(1);
    });

    test("routes each domain to its own value service, entity table and measurement table", async () => {
      alertMeasurements.findBy.mockResolvedValue([measurementRow({})]);
      answerPages(alerts, [
        recordPage({ count: 1, firstCreatedAt: FIRST_CREATED_AT }),
      ]);
      maintenanceMeasurements.findBy.mockResolvedValue([measurementRow({})]);
      answerPages(maintenanceEvents, [
        recordPage({ count: 1, firstCreatedAt: FIRST_CREATED_AT }),
      ]);

      await runTick();

      expect(alertValues.recomputeForAlert).toHaveBeenCalledWith({
        alertId: expect.any(ObjectID),
      });
      expect(
        maintenanceValues.recomputeForScheduledMaintenance,
      ).toHaveBeenCalledWith({
        scheduledMaintenanceId: expect.any(ObjectID),
      });

      expect(incidentValues.recomputeForIncident).not.toHaveBeenCalled();
      expect(incidents.query).not.toHaveBeenCalled();
      expect(incidentMeasurements.query).not.toHaveBeenCalled();
      expect(
        pageReadsOf(alerts).map((read: PageRead): string => {
          return read.table;
        }),
      ).toEqual(["Alert"]);
      expect(
        pageReadsOf(maintenanceEvents).map((read: PageRead): string => {
          return read.table;
        }),
      ).toEqual(["ScheduledMaintenance"]);
      expect(
        writesOf(alertMeasurements).map((write: ProgressWrite): string => {
          return write.table;
        }),
      ).toEqual(["AlertMeasurement"]);
      expect(
        writesOf(maintenanceMeasurements).map(
          (write: ProgressWrite): string => {
            return write.table;
          },
        ),
      ).toEqual(["ScheduledMaintenanceMeasurement"]);
    });

    test("never reads entities through findBy, which sorts by createdAt alone", async () => {
      incidentMeasurements.findBy.mockResolvedValue([measurementRow({})]);
      alertMeasurements.findBy.mockResolvedValue([measurementRow({})]);
      maintenanceMeasurements.findBy.mockResolvedValue([measurementRow({})]);

      await runTick();

      for (const service of [incidents, alerts, maintenanceEvents]) {
        expect(service.findBy).not.toHaveBeenCalled();
        expect(service.query).toHaveBeenCalledTimes(1);
      }
    });
  });

  test("logs and moves on when a whole domain fails, so one broken table does not block the rest", async () => {
    incidentMeasurements.findBy.mockRejectedValue(
      new Error("incident measurements unavailable"),
    );
    alertMeasurements.findBy.mockResolvedValue([measurementRow({})]);
    answerPages(alerts, [
      recordPage({ count: 1, firstCreatedAt: FIRST_CREATED_AT }),
    ]);

    await runTick();

    expect(mockedLogger.error).toHaveBeenCalled();
    expect(alertValues.recomputeForAlert).toHaveBeenCalledTimes(1);
    expect(maintenanceMeasurements.findBy).toHaveBeenCalledTimes(1);
  });

  test("logs and moves on when a page read fails, writing nothing for that walk", async () => {
    incidentMeasurements.findBy.mockResolvedValue([measurementRow({})]);
    incidents.query.mockRejectedValue(new Error("statement timeout"));
    alertMeasurements.findBy.mockResolvedValue([measurementRow({})]);

    await runTick();

    expect(mockedLogger.error).toHaveBeenCalled();
    expect(incidentMeasurements.query).not.toHaveBeenCalled();
    expect(writesOf(alertMeasurements)).toHaveLength(1);
  });

  test("logs and moves on when a progress write fails, so one broken write does not block the other domains", async () => {
    incidentMeasurements.findBy.mockResolvedValue([measurementRow({})]);
    incidentMeasurements.query.mockRejectedValue(new Error("connection reset"));
    alertMeasurements.findBy.mockResolvedValue([measurementRow({})]);

    await runTick();

    expect(mockedLogger.error).toHaveBeenCalled();
    expect(writesOf(alertMeasurements)).toHaveLength(1);
  });

  /*
   * #8105. A measurement's walk runs for minutes to hours on a big project,
   * and its definition can be edited at any point of it. The table below
   * keeps the guard as Postgres does; each test lands the edit at one point
   * of the walk and checks that the edit's request is what the table is left
   * with, and that the next tick walks it from the beginning.
   */
  describe("an edit made while a measurement is walked always wins", () => {
    // Three pages: 500, 500 and 200.
    const ENTITY_COUNT: number = 1200;

    const REQUESTED_AT: Date = new Date("2026-07-01T00:00:00.000Z");
    const EDITED_AT: Date = new Date("2026-07-01T00:02:00.000Z");
    const EDITED_AGAIN_AT: Date = new Date("2026-07-01T00:03:00.000Z");

    let table: MeasurementTable;
    let records: RecordTable;
    let entities: Array<string>;

    beforeEach(() => {
      table = new MeasurementTable(incidentMeasurements);
      records = new RecordTable(incidents);
      records.add({ count: ENTITY_COUNT, createdAt: FIRST_CREATED_AT });
      entities = records.ordered();
    });

    // Lands `edit` while the nth entity of the tick (from 1) is worked out.
    function onRecompute(nth: number, edit: () => void): void {
      let recomputed: number = 0;

      incidentValues.recomputeForIncident.mockImplementation(
        async (): Promise<void> => {
          recomputed++;

          if (recomputed === nth) {
            edit();
          }
        },
      );
    }

    // The tick's walk left nothing behind of the request it was walking.
    function expectLeftForTheEdit(requestedAt: Date): void {
      const row: StoredMeasurement = table.get();

      expect(table.requestedAtOf()?.toISOString()).toBe(
        requestedAt.toISOString(),
      );
      expect(row.cursorCreatedAt).toBeNull();
      expect(row.cursorId).toBeNull();
      expect(row.completedAt).toBeNull();
    }

    // The next tick works the edit out from the beginning, to the end, each entity once.
    async function expectNextTickWalksFromTheBeginning(
      requestedAt: Date,
      pages: number = 3,
    ): Promise<void> {
      jest.clearAllMocks();
      incidentValues.recomputeForIncident.mockResolvedValue(undefined);

      await runTick();

      const starts: Array<
        { createdAt: Date; id?: string | undefined } | undefined
      > = walkStartsOf(incidents);

      expect(starts[0]).toBeUndefined();
      expect(starts).toHaveLength(pages);
      expect(recomputedIncidents()).toEqual(records.ordered());

      const row: StoredMeasurement = table.get();

      expect(row.completedAt).toBeInstanceOf(Date);
      expect(row.cursorCreatedAt?.toISOString()).toBe(
        records.last().createdAt.toISOString(),
      );
      expect(row.cursorId).toBe(records.last().id);
      expect(table.requestedAtOf()?.toISOString()).toBe(
        requestedAt.toISOString(),
      );

      for (const write of writesOf(incidentMeasurements)) {
        expect((write.requestedAt as Date).toISOString()).toBe(
          requestedAt.toISOString(),
        );
      }
    }

    test("with no edit, the walk saves its cursor page by page and completes where it ends", async () => {
      table.insert({ requestedAt: REQUESTED_AT });

      await runTick();

      expect(walkStartsOf(incidents)).toEqual([
        undefined,
        records.read(entities[PAGE_SIZE - 1]!),
        records.read(entities[2 * PAGE_SIZE - 1]!),
      ]);
      expect(
        writesOf(incidentMeasurements).map(
          (write: ProgressWrite): Array<string> => {
            return Object.keys(write.set).sort();
          },
        ),
      ).toEqual([
        ["backfillCursorCreatedAt", "backfillCursorId"],
        ["backfillCursorCreatedAt", "backfillCursorId"],
        ["backfillCompletedAt", "backfillCursorCreatedAt", "backfillCursorId"],
      ]);

      const row: StoredMeasurement = table.get();

      expect(row.completedAt).toBeInstanceOf(Date);
      expect(row.cursorCreatedAt?.toISOString()).toBe(
        records.last().createdAt.toISOString(),
      );
      expect(row.cursorId).toBe(records.last().id);
      // Every entity once: the pages no longer overlap at their boundaries.
      expect(recomputedIncidents()).toEqual(entities);
      expect(mockedLogger.info).not.toHaveBeenCalled();
    });

    describe("an edit before the walk's first write", () => {
      test("while the first page is worked out: the first cursor is refused and the walk stops there", async () => {
        table.insert({ requestedAt: REQUESTED_AT });
        onRecompute(1, () => {
          table.edit(MEASUREMENT_ID, EDITED_AT);
        });

        await runTick();

        expectLeftForTheEdit(EDITED_AT);
        // One page read, its cursor refused, and no page after it.
        expect(incidents.query).toHaveBeenCalledTimes(1);
        expect(writesOf(incidentMeasurements)).toHaveLength(1);

        await expectNextTickWalksFromTheBeginning(EDITED_AT);
      });

      test("between the tick's read and the walk: a cursor read before the edit is never written back", async () => {
        // An earlier tick got part way, then the definition was edited.
        const cursor: { id: string; createdAt: Date } = records.read(
          entities[PAGE_SIZE - 1]!,
        );
        table.insert({
          requestedAt: REQUESTED_AT,
          cursorCreatedAt: cursor.createdAt,
          cursorId: cursor.id,
        });
        table.afterRead(() => {
          table.edit(MEASUREMENT_ID, EDITED_AT);
        });

        await runTick();

        // The cleared cursor stays cleared...
        expectLeftForTheEdit(EDITED_AT);
        // ...though the walk began where the read said, part way...
        expect(walkStartsOf(incidents)[0]).toEqual(cursor);
        // ...because it was stopped at its first write.
        expect(writesOf(incidentMeasurements)).toHaveLength(1);

        await expectNextTickWalksFromTheBeginning(EDITED_AT);
      });

      test("on a project with one page: the completion is refused, and the measurement is still asked for", async () => {
        records = new RecordTable(incidents);
        records.add({ count: 3, createdAt: FIRST_CREATED_AT });
        table.insert({ requestedAt: REQUESTED_AT });
        onRecompute(2, () => {
          table.edit(MEASUREMENT_ID, EDITED_AT);
        });

        await runTick();

        expectLeftForTheEdit(EDITED_AT);
        expect(writesOf(incidentMeasurements)).toHaveLength(1);

        await expectNextTickWalksFromTheBeginning(EDITED_AT, 1);
      });
    });

    describe("an edit between progress writes", () => {
      test("while the second page is worked out: its cursor is refused, and the first page's is not left behind", async () => {
        table.insert({ requestedAt: REQUESTED_AT });
        onRecompute(PAGE_SIZE + 1, () => {
          table.edit(MEASUREMENT_ID, EDITED_AT);
        });

        await runTick();

        expectLeftForTheEdit(EDITED_AT);
        // Two pages read: the first's cursor written, the second's refused.
        expect(incidents.query).toHaveBeenCalledTimes(2);
        expect(writesOf(incidentMeasurements)).toHaveLength(2);

        await expectNextTickWalksFromTheBeginning(EDITED_AT);
      });

      test("committed just before the second page's write", async () => {
        table.insert({ requestedAt: REQUESTED_AT });
        table.beforeWrite(2, () => {
          table.edit(MEASUREMENT_ID, EDITED_AT);
        });

        await runTick();

        expectLeftForTheEdit(EDITED_AT);
        expect(incidents.query).toHaveBeenCalledTimes(2);

        await expectNextTickWalksFromTheBeginning(EDITED_AT);
      });
    });

    describe("an edit just before the completion", () => {
      test("while the last page is worked out: the completion is refused, and the edit's walk is still to do", async () => {
        table.insert({ requestedAt: REQUESTED_AT });
        onRecompute(2 * PAGE_SIZE + 1, () => {
          table.edit(MEASUREMENT_ID, EDITED_AT);
        });

        await runTick();

        expectLeftForTheEdit(EDITED_AT);
        expect(incidents.query).toHaveBeenCalledTimes(3);
        expect(writesOf(incidentMeasurements)).toHaveLength(3);

        await expectNextTickWalksFromTheBeginning(EDITED_AT);
      });

      test("committed just before the completion is written", async () => {
        table.insert({ requestedAt: REQUESTED_AT });
        table.beforeWrite(3, () => {
          table.edit(MEASUREMENT_ID, EDITED_AT);
        });

        await runTick();

        expectLeftForTheEdit(EDITED_AT);
        expect(writesOf(incidentMeasurements)).toHaveLength(3);

        await expectNextTickWalksFromTheBeginning(EDITED_AT);
      });

      test("is logged as the walk stopping, not as an error", async () => {
        table.insert({ requestedAt: REQUESTED_AT });
        table.beforeWrite(3, () => {
          table.edit(MEASUREMENT_ID, EDITED_AT);
        });

        await runTick();

        expect(mockedLogger.error).not.toHaveBeenCalled();
        expect(mockedLogger.info).toHaveBeenCalledTimes(1);
        expect(String(mockedLogger.info.mock.calls[0]![0])).toContain(
          `Incident measurement ${MEASUREMENT_ID.toString()}`,
        );
      });
    });

    describe("an edit while a run of entities created at one moment is walked", () => {
      const RUN_AT: Date = new Date("2026-06-01T10:00:00.000Z");

      beforeEach(() => {
        // The whole project one run, longer than two pages.
        records = new RecordTable(incidents);
        records.add({
          count: ENTITY_COUNT,
          createdAt: RUN_AT,
          apartInMicroseconds: 0,
          shuffledIds: true,
        });
        entities = records.ordered();
      });

      test("while a page in the run is worked out: its cursor is refused, the cleared cursor stays cleared", async () => {
        table.insert({ requestedAt: REQUESTED_AT });
        onRecompute(PAGE_SIZE + 10, () => {
          table.edit(MEASUREMENT_ID, EDITED_AT);
        });

        await runTick();

        expectLeftForTheEdit(EDITED_AT);
        expect(incidents.query).toHaveBeenCalledTimes(2);

        await expectNextTickWalksFromTheBeginning(EDITED_AT);
      });

      test("committed just before the write of a cursor in the middle of the run", async () => {
        table.insert({ requestedAt: REQUESTED_AT });
        table.beforeWrite(2, () => {
          table.edit(MEASUREMENT_ID, EDITED_AT);
        });

        await runTick();

        expectLeftForTheEdit(EDITED_AT);

        await expectNextTickWalksFromTheBeginning(EDITED_AT);
      });

      test("between two ticks, the first stopped in the run: the second walks the edit from the start of the run", async () => {
        records.add({
          count: MAX_PAGES_PER_RUN * PAGE_SIZE,
          createdAt: RUN_AT,
          apartInMicroseconds: 0,
        });
        table.insert({ requestedAt: REQUESTED_AT });

        await runTick();

        // Stopped at the cap, with a cursor inside the run.
        expect(table.get().cursorId).not.toBeNull();
        expect(table.get().completedAt).toBeNull();

        table.edit(MEASUREMENT_ID, EDITED_AT);
        jest.clearAllMocks();
        incidentValues.recomputeForIncident.mockResolvedValue(undefined);

        await runTick();

        expect(walkStartsOf(incidents)[0]).toBeUndefined();
        expect(recomputedIncidents()).toEqual(
          records.ordered().slice(0, MAX_PAGES_PER_RUN * PAGE_SIZE),
        );
      });
    });

    describe("two edits in a row", () => {
      test("both during one walk: the walk is refused, and the next tick walks the second edit", async () => {
        table.insert({ requestedAt: REQUESTED_AT });
        let recomputed: number = 0;
        incidentValues.recomputeForIncident.mockImplementation(
          async (): Promise<void> => {
            recomputed++;
            if (recomputed === 1) {
              table.edit(MEASUREMENT_ID, EDITED_AT);
            }
            if (recomputed === 2) {
              table.edit(MEASUREMENT_ID, EDITED_AGAIN_AT);
            }
          },
        );

        await runTick();

        expectLeftForTheEdit(EDITED_AGAIN_AT);
        expect(writesOf(incidentMeasurements)).toHaveLength(1);

        await expectNextTickWalksFromTheBeginning(EDITED_AGAIN_AT);
      });

      test("one per walk: the walk of the first edit is refused too, once the second lands", async () => {
        table.insert({ requestedAt: REQUESTED_AT });

        // Tick 1 walks the request; the first edit lands on its second page.
        onRecompute(PAGE_SIZE + 1, () => {
          table.edit(MEASUREMENT_ID, EDITED_AT);
        });
        await runTick();
        expectLeftForTheEdit(EDITED_AT);

        // Tick 2 walks the first edit from the start; the second lands on its last page.
        jest.clearAllMocks();
        onRecompute(2 * PAGE_SIZE + 1, () => {
          table.edit(MEASUREMENT_ID, EDITED_AGAIN_AT);
        });
        await runTick();

        expectLeftForTheEdit(EDITED_AGAIN_AT);
        expect(walkStartsOf(incidents)[0]).toBeUndefined();
        for (const write of writesOf(incidentMeasurements)) {
          expect((write.requestedAt as Date).toISOString()).toBe(
            EDITED_AT.toISOString(),
          );
        }

        // Tick 3 walks the second edit, from the start to the end.
        await expectNextTickWalksFromTheBeginning(EDITED_AGAIN_AT);
      });
    });

    test("an edit after the walk completed asks for it again, and the next tick walks it from the beginning", async () => {
      table.insert({ requestedAt: REQUESTED_AT });

      await runTick();
      expect(table.get().completedAt).toBeInstanceOf(Date);

      table.edit(MEASUREMENT_ID, EDITED_AT);

      await expectNextTickWalksFromTheBeginning(EDITED_AT);
    });

    test("a request the database stamped with microseconds (FirstPagedAt's now()) is walked to completion", async () => {
      table.insert({ requestedAt: REQUESTED_AT, extraMicroseconds: 456 });

      await runTick();

      expect(table.get().completedAt).toBeInstanceOf(Date);
      expect(writesOf(incidentMeasurements)).toHaveLength(3);
      expect(mockedLogger.info).not.toHaveBeenCalled();
    });

    test("an edit of one measurement does not stop the walk of another", async () => {
      const otherId: ObjectID = new ObjectID(
        "44444444-4444-4444-8444-444444444444",
      );
      table.insert({ requestedAt: REQUESTED_AT });
      table.insert({
        id: otherId,
        requestedAt: new Date(REQUESTED_AT.getTime() + 1000),
      });
      onRecompute(1, () => {
        table.edit(MEASUREMENT_ID, EDITED_AT);
      });

      await runTick();

      expectLeftForTheEdit(EDITED_AT);
      expect(table.get(otherId).completedAt).toBeInstanceOf(Date);
      expect(table.get(otherId).cursorCreatedAt?.toISOString()).toBe(
        records.last().createdAt.toISOString(),
      );
      expect(table.get(otherId).cursorId).toBe(records.last().id);
    });

    test("a measurement removed while it is walked stops its walk, and the other domains still run", async () => {
      table.insert({ requestedAt: REQUESTED_AT });
      table.beforeWrite(1, () => {
        table.remove(MEASUREMENT_ID);
      });
      alertMeasurements.findBy.mockResolvedValue([measurementRow({})]);

      await runTick();

      expect(incidents.query).toHaveBeenCalledTimes(1);
      expect(mockedLogger.error).not.toHaveBeenCalled();
      expect(writesOf(alertMeasurements)).toHaveLength(1);
    });
  });
});
