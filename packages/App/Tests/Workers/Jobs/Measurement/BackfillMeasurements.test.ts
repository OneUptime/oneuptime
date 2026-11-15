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
 *   1. THE COLUMN CONTRACT. All three backfill columns are TIMESTAMPs. The
 *      progress write must carry Dates into backfillCursorCreatedAt /
 *      backfillCompletedAt and the measurement id must travel as the row's
 *      id, never into a date column: an ObjectID landing in the cursor is a
 *      write error that takes down the whole backfill for that project.
 *   2. THE RESUME SEMANTICS. Completed-at-or-after-requested is what stops a
 *      finished backfill from being redone every five minutes, and the cursor
 *      is what stops a restart from starting the project over.
 *   3. THE TWO NON-TERMINATION GUARDS: the same-timestamp stall bail-out and
 *      the per-run page cap, plus the isolation that keeps one unreadable
 *      entity, or one broken domain, from stalling everything behind it.
 *   4. AN EDIT ALWAYS WINS (#8105). Every write of a walk is a compare-and-set
 *      held to the backfillRequestedAt the walk read
 *      (MeasurementBackfillProgress), so an edit of the measurement made
 *      while it is walked - a new stamp, the cursor and the completion
 *      cleared - is never written over, and the edit's walk starts from the
 *      beginning. The walk wrote with plain updates, which stamped completion
 *      over an edit (the new definition's history was never worked out) or
 *      saved the cursor over the cleared one (its walk resumed part way).
 *      The interleavings run against a table that keeps the guard as Postgres
 *      does (MeasurementTable below); MeasurementBackfillProgressPostgres in
 *      Common runs the statement against Postgres itself.
 *
 * The job registers itself via RunCron at import time and exports nothing, so
 * the Cron util is mocked to CAPTURE the handler (the same recorder the other
 * App/Tests/Workers/Jobs suites use) and each test drives one full tick. The
 * progress write is the real MeasurementBackfillProgress, run on the mocked
 * services' connection (`query` below).
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
 * A measurement service: its reads, the plain update the job used to write
 * progress with, and its connection's `query`, where the guarded write goes.
 */
function mockMeasurementService(tableName: string): {
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
  return mockMeasurementService("IncidentMeasurement");
});
jest.mock("Common/Server/Services/AlertMeasurementService", () => {
  return mockMeasurementService("AlertMeasurement");
});
jest.mock(
  "Common/Server/Services/ScheduledMaintenanceMeasurementService",
  () => {
    return mockMeasurementService("ScheduledMaintenanceMeasurement");
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
  return { __esModule: true, default: { findBy: jest.fn() } };
});
jest.mock("Common/Server/Services/AlertService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});
jest.mock("Common/Server/Services/ScheduledMaintenanceService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
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

// Imported for its side effect: RunCron (mocked above) records the handler.
import "../../../../FeatureSet/Workers/Jobs/Measurement/BackfillMeasurements";

interface MeasurementServiceMock {
  findBy: jest.Mock;
  updateOneById: jest.Mock;
  query: jest.Mock;
}

interface EntityServiceMock {
  findBy: jest.Mock;
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

interface MeasurementRow {
  _id?: ObjectID | undefined;
  projectId?: ObjectID | undefined;
  backfillRequestedAt?: Date | undefined;
  backfillCompletedAt?: Date | undefined;
  backfillCursorCreatedAt?: Date | undefined;
}

interface EntityRow {
  _id?: ObjectID | undefined;
  createdAt?: Date | undefined;
}

function measurementRow(input: {
  id?: ObjectID;
  projectId?: ObjectID | undefined;
  requestedAt?: Date | undefined;
  completedAt?: Date | undefined;
  cursorCreatedAt?: Date | undefined;
}): MeasurementRow {
  return {
    _id: input.id ?? MEASUREMENT_ID,
    projectId: input.projectId ?? PROJECT_ID,
    backfillRequestedAt:
      input.requestedAt ?? new Date("2026-07-01T00:00:00.000Z"),
    backfillCompletedAt: input.completedAt,
    backfillCursorCreatedAt: input.cursorCreatedAt,
  };
}

// A page of entities one second apart, oldest first, as the job sorts them.
function entityPage(input: {
  count: number;
  firstCreatedAt: Date;
  prefix?: string;
  sameTimestamp?: boolean;
}): Array<EntityRow> {
  const rows: Array<EntityRow> = [];

  for (let index: number = 0; index < input.count; index++) {
    rows.push({
      _id: new ObjectID(`${input.prefix || "entity"}-${index}`),
      createdAt: input.sameTimestamp
        ? input.firstCreatedAt
        : new Date(input.firstCreatedAt.getTime() + index * 1000),
    });
  }

  return rows;
}

/*
 * Reads the single value bound into one of QueryHelper's Raw predicates
 * (typeorm keeps the bound parameters on the FindOperator).
 */
function boundValueOf(predicate: unknown): unknown {
  if (!predicate) {
    return undefined;
  }

  const parameters: Record<string, unknown> | undefined = (
    predicate as {
      objectLiteralParameters?: Record<string, unknown> | undefined;
    }
  ).objectLiteralParameters;

  return Object.values(parameters || {})[0];
}

function entityQueryOf(call: Array<unknown>): Record<string, unknown> {
  return (call[0] as { query: Record<string, unknown> }).query;
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
  }): ObjectID {
    const id: ObjectID = input.id || MEASUREMENT_ID;

    this.rows.set(id.toString(), {
      id: id,
      projectId: input.projectId || PROJECT_ID,
      requestedAtInMicroseconds:
        input.requestedAt.getTime() * 1000 + (input.extraMicroseconds || 0),
      cursorCreatedAt: input.cursorCreatedAt || null,
      completedAt: null,
    });

    return id;
  }

  // What an edit of the definition writes (the services' onUpdatePermitted).
  public edit(id: ObjectID, requestedAt: Date): void {
    const row: StoredMeasurement = this.get(id);

    row.requestedAtInMicroseconds = requestedAt.getTime() * 1000;
    row.cursorCreatedAt = null;
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

    if (set["backfillCompletedAt"] !== undefined) {
      row.completedAt = set["backfillCompletedAt"] as Date;
    }
  }
}

/*
 * A project's entities, one second apart: each read answers the page from
 * the cursor on (inclusive), as the job's query asks.
 */
class EntityTable {
  public readonly rows: Array<EntityRow>;

  public constructor(input: {
    service: EntityServiceMock;
    count: number;
    firstCreatedAt?: Date;
  }) {
    this.rows = entityPage({
      count: input.count,
      firstCreatedAt:
        input.firstCreatedAt || new Date("2026-06-01T09:00:00.000Z"),
    });

    input.service.findBy.mockImplementation(
      async (args: {
        query: Record<string, unknown>;
        limit: number;
      }): Promise<Array<EntityRow>> => {
        const after: Date | undefined = boundValueOf(
          args.query["createdAt"],
        ) as Date | undefined;

        return this.rows
          .filter((row: EntityRow) => {
            return !after || row.createdAt!.getTime() >= after.getTime();
          })
          .slice(0, args.limit);
      },
    );
  }

  public last(): EntityRow {
    return this.rows[this.rows.length - 1]!;
  }
}

// Where each read of entities in a tick began: undefined is the beginning.
function walkStartsOf(service: EntityServiceMock): Array<Date | undefined> {
  return service.findBy.mock.calls.map(
    (call: Array<unknown>): Date | undefined => {
      return boundValueOf(entityQueryOf(call)["createdAt"]) as Date | undefined;
    },
  );
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

    for (const service of [incidents, alerts, maintenanceEvents]) {
      service.findBy.mockResolvedValue([] as Array<EntityRow>);
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

      expect(incidents.findBy).toHaveBeenCalledTimes(1);
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

      expect(incidents.findBy).not.toHaveBeenCalled();
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

      expect(incidents.findBy).toHaveBeenCalledTimes(1);
    });

    test("runs a measurement that has never completed", async () => {
      incidentMeasurements.findBy.mockResolvedValue([
        measurementRow({ completedAt: undefined }),
      ]);

      await runTick();

      expect(incidents.findBy).toHaveBeenCalledTimes(1);
    });

    test("skips a row with no id or no project, which has nothing to scope a walk to", async () => {
      const requestedAt: Date = new Date("2026-07-01T00:00:00.000Z");

      incidentMeasurements.findBy.mockResolvedValue([
        { projectId: PROJECT_ID, backfillRequestedAt: requestedAt },
        { _id: MEASUREMENT_ID, backfillRequestedAt: requestedAt },
      ] as Array<MeasurementRow>);

      await runTick();

      expect(incidents.findBy).not.toHaveBeenCalled();
    });

    test("skips a row read without its request, which has nothing to hold the walk's writes to", async () => {
      incidentMeasurements.findBy.mockResolvedValue([
        { _id: MEASUREMENT_ID, projectId: PROJECT_ID },
      ] as Array<MeasurementRow>);

      await runTick();

      expect(incidents.findBy).not.toHaveBeenCalled();
      expect(incidentMeasurements.query).not.toHaveBeenCalled();
      expect(incidentMeasurements.updateOneById).not.toHaveBeenCalled();
    });
  });

  describe("the progress write", () => {
    test("writes timestamps into the backfill columns and carries the measurement id as the row id", async () => {
      /*
       * THE regression this suite was written for. Both columns are
       * TIMESTAMPs, and the only ObjectID in play addresses the row -- it
       * must never be one of the values.
       */
      const created: Date = new Date("2026-06-01T09:00:00.000Z");

      incidentMeasurements.findBy.mockResolvedValue([measurementRow({})]);
      incidents.findBy.mockResolvedValue(
        entityPage({ count: 3, firstCreatedAt: created }),
      );

      await runTick();

      const writes: Array<ProgressWrite> = writesOf(incidentMeasurements);

      expect(writes).toHaveLength(1);
      expect(writes[0]!.table).toBe("IncidentMeasurement");
      expect(writes[0]!.id).toBe(MEASUREMENT_ID.toString());

      const set: Record<string, unknown> = writes[0]!.set;

      expect(Object.keys(set).sort()).toEqual([
        "backfillCompletedAt",
        "backfillCursorCreatedAt",
      ]);

      for (const column of Object.keys(set)) {
        expect(set[column]).toBeInstanceOf(Date);
        expect(set[column]).not.toBeInstanceOf(ObjectID);
      }

      // The cursor is the last row of the page, not the first and not "now".
      expect((set["backfillCursorCreatedAt"] as Date).toISOString()).toBe(
        new Date(created.getTime() + 2000).toISOString(),
      );
    });

    test("holds every write to the request the walk read, never to now or to its own completion", async () => {
      const requestedAt: Date = new Date("2026-07-01T00:00:00.123Z");
      const created: Date = new Date("2026-06-01T09:00:00.000Z");

      incidentMeasurements.findBy.mockResolvedValue([
        measurementRow({ requestedAt: requestedAt }),
      ]);
      incidents.findBy
        .mockResolvedValueOnce(
          entityPage({ count: PAGE_SIZE, firstCreatedAt: created }),
        )
        .mockResolvedValueOnce(
          entityPage({
            count: PAGE_SIZE,
            firstCreatedAt: new Date(created.getTime() + PAGE_SIZE * 1000),
          }),
        )
        .mockResolvedValue([]);

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
      incidents.findBy
        .mockResolvedValueOnce(
          entityPage({
            count: PAGE_SIZE,
            firstCreatedAt: new Date("2026-06-01T09:00:00.000Z"),
          }),
        )
        .mockResolvedValue([]);

      await runTick();

      expect(writesOf(incidentMeasurements)).toHaveLength(2);
      expect(incidentMeasurements.updateOneById).not.toHaveBeenCalled();
    });

    test("stamps completion on a short page, because a page under the limit is the end of the project", async () => {
      incidentMeasurements.findBy.mockResolvedValue([measurementRow({})]);
      incidents.findBy.mockResolvedValue(
        entityPage({
          count: PAGE_SIZE - 1,
          firstCreatedAt: new Date("2026-06-01T09:00:00.000Z"),
        }),
      );

      await runTick();

      expect(incidents.findBy).toHaveBeenCalledTimes(1);
      expect(
        writesOf(incidentMeasurements)[0]!.set["backfillCompletedAt"],
      ).toBeInstanceOf(Date);
    });

    test("stamps completion for a project with no entities at all, so an empty project stops being rescanned", async () => {
      incidentMeasurements.findBy.mockResolvedValue([measurementRow({})]);
      incidents.findBy.mockResolvedValue([]);

      await runTick();

      const set: Record<string, unknown> =
        writesOf(incidentMeasurements)[0]!.set;

      expect(set["backfillCompletedAt"]).toBeInstanceOf(Date);
      // No rows, so there is no cursor to write -- and null would clear it.
      expect(set["backfillCursorCreatedAt"]).toBeUndefined();
    });

    test("saves the cursor without a completion stamp mid-walk, so an interrupted run resumes instead of finishing early", async () => {
      const created: Date = new Date("2026-06-01T09:00:00.000Z");

      incidentMeasurements.findBy.mockResolvedValue([measurementRow({})]);
      incidents.findBy
        .mockResolvedValueOnce(
          entityPage({ count: PAGE_SIZE, firstCreatedAt: created }),
        )
        .mockResolvedValue([]);

      await runTick();

      const firstSet: Record<string, unknown> =
        writesOf(incidentMeasurements)[0]!.set;

      expect(firstSet["backfillCursorCreatedAt"]).toBeInstanceOf(Date);
      expect(firstSet["backfillCompletedAt"]).toBeUndefined();
    });
  });

  describe("paging", () => {
    test("scopes the first page to the project with no cursor predicate", async () => {
      incidentMeasurements.findBy.mockResolvedValue([
        measurementRow({ cursorCreatedAt: undefined }),
      ]);

      await runTick();

      const query: Record<string, unknown> = entityQueryOf(
        incidents.findBy.mock.calls[0]!,
      );

      expect((query["projectId"] as ObjectID).toString()).toBe(
        PROJECT_ID.toString(),
      );
      expect(query["createdAt"]).toBeUndefined();
    });

    test("resumes from the stored cursor rather than walking the project again", async () => {
      const cursor: Date = new Date("2026-06-15T12:00:00.000Z");

      incidentMeasurements.findBy.mockResolvedValue([
        measurementRow({ cursorCreatedAt: cursor }),
      ]);

      await runTick();

      const query: Record<string, unknown> = entityQueryOf(
        incidents.findBy.mock.calls[0]!,
      );

      /*
       * Inclusive on purpose: rows sharing the boundary timestamp are
       * recomputed again rather than risking a skip, and the recompute is a
       * total function of current data.
       */
      expect(boundValueOf(query["createdAt"])).toEqual(cursor);
    });

    test("advances the cursor page by page until a short page ends the walk", async () => {
      const created: Date = new Date("2026-06-01T09:00:00.000Z");
      const secondPageStart: Date = new Date("2026-06-02T09:00:00.000Z");

      incidentMeasurements.findBy.mockResolvedValue([measurementRow({})]);
      incidents.findBy
        .mockResolvedValueOnce(
          entityPage({ count: PAGE_SIZE, firstCreatedAt: created }),
        )
        .mockResolvedValueOnce(
          entityPage({ count: 2, firstCreatedAt: secondPageStart }),
        );

      await runTick();

      expect(incidents.findBy).toHaveBeenCalledTimes(2);

      // The second page starts at the last row of the first.
      expect(
        boundValueOf(
          entityQueryOf(incidents.findBy.mock.calls[1]!)["createdAt"],
        ),
      ).toEqual(new Date(created.getTime() + (PAGE_SIZE - 1) * 1000));

      const writes: Array<ProgressWrite> = writesOf(incidentMeasurements);

      expect(writes).toHaveLength(2);
      expect(writes[1]!.set["backfillCompletedAt"]).toBeInstanceOf(Date);
    });

    test("stops after the per-run page cap, so one large project cannot starve the others", async () => {
      incidentMeasurements.findBy.mockResolvedValue([measurementRow({})]);
      incidents.findBy.mockImplementation(
        (data: unknown): Promise<Array<EntityRow>> => {
          /*
           * Every page is full and strictly newer than the last, so only the
           * cap can end this walk.
           */
          const after: Date =
            (boundValueOf(
              (data as { query: Record<string, unknown> }).query["createdAt"],
            ) as Date) || new Date("2026-06-01T09:00:00.000Z");

          return Promise.resolve(
            entityPage({
              count: PAGE_SIZE,
              firstCreatedAt: new Date(after.getTime() + 1000),
            }),
          );
        },
      );

      await runTick();

      expect(incidents.findBy).toHaveBeenCalledTimes(MAX_PAGES_PER_RUN);
      // Nothing is marked complete: the next tick picks the walk back up.
      const writes: Array<ProgressWrite> = writesOf(incidentMeasurements);

      expect(writes).toHaveLength(MAX_PAGES_PER_RUN);
      for (const write of writes) {
        expect(write.set["backfillCompletedAt"]).toBeUndefined();
      }
    });

    test("bails out with a warning when a full page shares one timestamp, instead of paging the same rows for ever", async () => {
      const stuck: Date = new Date("2026-06-01T09:00:00.000Z");

      incidentMeasurements.findBy.mockResolvedValue([
        measurementRow({ cursorCreatedAt: stuck }),
      ]);
      incidents.findBy.mockResolvedValue(
        entityPage({
          count: PAGE_SIZE,
          firstCreatedAt: stuck,
          sameTimestamp: true,
        }),
      );

      await runTick();

      expect(incidents.findBy).toHaveBeenCalledTimes(1);
      expect(mockedLogger.warn).toHaveBeenCalledTimes(1);
      expect(String(mockedLogger.warn.mock.calls[0]![0])).toContain(
        MEASUREMENT_ID.toString(),
      );
      // Neither the cursor nor completion moves, so the next tick can retry.
      expect(incidentMeasurements.query).not.toHaveBeenCalled();
    });
  });

  describe("recomputing", () => {
    test("recomputes every entity on the page, which is what actually fills the measurement in", async () => {
      incidentMeasurements.findBy.mockResolvedValue([measurementRow({})]);
      incidents.findBy.mockResolvedValue(
        entityPage({
          count: 3,
          firstCreatedAt: new Date("2026-06-01T09:00:00.000Z"),
        }),
      );

      await runTick();

      expect(incidentValues.recomputeForIncident).toHaveBeenCalledTimes(3);
      expect(incidentValues.recomputeForIncident).toHaveBeenCalledWith({
        incidentId: expect.any(ObjectID),
      });
    });

    test("keeps going when one entity fails, so a single bad row cannot stall the cursor behind it", async () => {
      incidentMeasurements.findBy.mockResolvedValue([measurementRow({})]);
      incidents.findBy.mockResolvedValue(
        entityPage({
          count: 3,
          firstCreatedAt: new Date("2026-06-01T09:00:00.000Z"),
        }),
      );
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
      const created: Date = new Date("2026-06-01T09:00:00.000Z");

      alertMeasurements.findBy.mockResolvedValue([measurementRow({})]);
      alerts.findBy.mockResolvedValue(
        entityPage({ count: 1, firstCreatedAt: created }),
      );
      maintenanceMeasurements.findBy.mockResolvedValue([measurementRow({})]);
      maintenanceEvents.findBy.mockResolvedValue(
        entityPage({ count: 1, firstCreatedAt: created }),
      );

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
      expect(incidentMeasurements.query).not.toHaveBeenCalled();
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
  });

  test("logs and moves on when a whole domain fails, so one broken table does not block the rest", async () => {
    incidentMeasurements.findBy.mockRejectedValue(
      new Error("incident measurements unavailable"),
    );
    alertMeasurements.findBy.mockResolvedValue([measurementRow({})]);
    alerts.findBy.mockResolvedValue(
      entityPage({
        count: 1,
        firstCreatedAt: new Date("2026-06-01T09:00:00.000Z"),
      }),
    );

    await runTick();

    expect(mockedLogger.error).toHaveBeenCalled();
    expect(alertValues.recomputeForAlert).toHaveBeenCalledTimes(1);
    expect(maintenanceMeasurements.findBy).toHaveBeenCalledTimes(1);
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
    // Three pages: 500, 500 (from the first page's last row, inclusive) and 202.
    const ENTITY_COUNT: number = 1200;

    const REQUESTED_AT: Date = new Date("2026-07-01T00:00:00.000Z");
    const EDITED_AT: Date = new Date("2026-07-01T00:02:00.000Z");
    const EDITED_AGAIN_AT: Date = new Date("2026-07-01T00:03:00.000Z");

    let table: MeasurementTable;
    let entities: EntityTable;

    beforeEach(() => {
      table = new MeasurementTable(incidentMeasurements);
      entities = new EntityTable({ service: incidents, count: ENTITY_COUNT });
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
      expect(row.completedAt).toBeNull();
    }

    // The next tick works the edit out from the beginning, to the end.
    async function expectNextTickWalksFromTheBeginning(
      requestedAt: Date,
    ): Promise<void> {
      jest.clearAllMocks();
      incidentValues.recomputeForIncident.mockResolvedValue(undefined);

      await runTick();

      const starts: Array<Date | undefined> = walkStartsOf(incidents);

      expect(starts[0]).toBeUndefined();
      expect(starts).toHaveLength(3);
      expect(incidentValues.recomputeForIncident).toHaveBeenCalledWith({
        incidentId: entities.rows[0]!._id,
      });

      const row: StoredMeasurement = table.get();

      expect(row.completedAt).toBeInstanceOf(Date);
      expect(row.cursorCreatedAt?.toISOString()).toBe(
        entities.last().createdAt!.toISOString(),
      );
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
        entities.rows[PAGE_SIZE - 1]!.createdAt,
        entities.rows[2 * PAGE_SIZE - 2]!.createdAt,
      ]);
      expect(
        writesOf(incidentMeasurements).map(
          (write: ProgressWrite): Array<string> => {
            return Object.keys(write.set).sort();
          },
        ),
      ).toEqual([
        ["backfillCursorCreatedAt"],
        ["backfillCursorCreatedAt"],
        ["backfillCompletedAt", "backfillCursorCreatedAt"],
      ]);

      const row: StoredMeasurement = table.get();

      expect(row.completedAt).toBeInstanceOf(Date);
      expect(row.cursorCreatedAt?.toISOString()).toBe(
        entities.last().createdAt!.toISOString(),
      );
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
        expect(incidents.findBy).toHaveBeenCalledTimes(1);
        expect(writesOf(incidentMeasurements)).toHaveLength(1);

        await expectNextTickWalksFromTheBeginning(EDITED_AT);
      });

      test("between the tick's read and the walk: a cursor read before the edit is never written back", async () => {
        // An earlier tick got part way, then the definition was edited.
        table.insert({
          requestedAt: REQUESTED_AT,
          cursorCreatedAt: entities.rows[PAGE_SIZE - 1]!.createdAt!,
        });
        table.afterRead(() => {
          table.edit(MEASUREMENT_ID, EDITED_AT);
        });

        await runTick();

        // The cleared cursor stays cleared...
        expectLeftForTheEdit(EDITED_AT);
        // ...though the walk began where the read said, part way...
        expect(walkStartsOf(incidents)[0]).toEqual(
          entities.rows[PAGE_SIZE - 1]!.createdAt,
        );
        // ...because it was stopped at its first write.
        expect(writesOf(incidentMeasurements)).toHaveLength(1);

        await expectNextTickWalksFromTheBeginning(EDITED_AT);
      });

      test("on a project with one page: the completion is refused, and the measurement is still asked for", async () => {
        entities = new EntityTable({ service: incidents, count: 3 });
        table.insert({ requestedAt: REQUESTED_AT });
        onRecompute(2, () => {
          table.edit(MEASUREMENT_ID, EDITED_AT);
        });

        await runTick();

        expectLeftForTheEdit(EDITED_AT);
        expect(writesOf(incidentMeasurements)).toHaveLength(1);

        jest.clearAllMocks();
        incidentValues.recomputeForIncident.mockResolvedValue(undefined);
        await runTick();

        expect(walkStartsOf(incidents)).toEqual([undefined]);
        expect(table.get().completedAt).toBeInstanceOf(Date);
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
        expect(incidents.findBy).toHaveBeenCalledTimes(2);
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
        expect(incidents.findBy).toHaveBeenCalledTimes(2);

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
        expect(incidents.findBy).toHaveBeenCalledTimes(3);
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
        entities.last().createdAt!.toISOString(),
      );
    });

    test("a measurement removed while it is walked stops its walk, and the other domains still run", async () => {
      table.insert({ requestedAt: REQUESTED_AT });
      table.beforeWrite(1, () => {
        table.remove(MEASUREMENT_ID);
      });
      alertMeasurements.findBy.mockResolvedValue([measurementRow({})]);

      await runTick();

      expect(incidents.findBy).toHaveBeenCalledTimes(1);
      expect(mockedLogger.error).not.toHaveBeenCalled();
      expect(writesOf(alertMeasurements)).toHaveLength(1);
    });
  });
});
