import Entities from "../../../Models/DatabaseModels/Index";
import ScheduledMaintenanceExternalCalendarEvent from "../../../Models/DatabaseModels/ScheduledMaintenanceExternalCalendarEvent";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import ScheduledMaintenanceExternalCalendarEventService, {
  ExternalCalendarEventRow,
} from "../../../Server/Services/ScheduledMaintenanceExternalCalendarEventService";
import ScheduledMaintenanceExternalCalendarService from "../../../Server/Services/ScheduledMaintenanceExternalCalendarService";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import logger from "../../../Server/Utils/Logger";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import { DataSource } from "typeorm";

/*
 * The external calendars' own SQL against a real Postgres migrated to the
 * current head (the Postgres Schema Drift workflow's database right after
 * its drift check):
 *
 *   - a read's events replace the old ones in one statement pair: the
 *     multi-row INSERT from parallel arrays (unnest) writes what the
 *     calendar page then reads for a period through the ordinary CRUD
 *     query, and a second replace leaves only its own rows;
 *   - two readers claiming one calendar with the same expectation: one
 *     wins (the compare-and-set the Workers' job and Read now share);
 *   - a calendar's deletion takes its events with it (ON DELETE CASCADE).
 *
 * Opt in with RUN_POSTGRES_EXTERNAL_CALENDAR_TESTS=true. Both tables'
 * STRUCTURE is cloned into a unique schema (search_path holds only that
 * schema) that is dropped afterwards, with the events' foreign key to their
 * calendar recreated there. Credentials from DATABASE_USERNAME /
 * DATABASE_PASSWORD, database from EXTERNAL_CALENDAR_TEST_DATABASE_NAME or
 * DATABASE_NAME, endpoint from EXTERNAL_CALENDAR_TEST_DATABASE_HOST / _PORT
 * (default localhost:5400).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_EXTERNAL_CALENDAR_TESTS"] === "true"
    ? describe
    : describe.skip;

const PROJECT_ID: ObjectID = new ObjectID(
  "63000000-0000-4000-8000-000000000001",
);

describePostgres("external calendars against Postgres", () => {
  const schema: string = `external_calendar_${ObjectID.generate()
    .toString()
    .split("-")
    .join("")}`;
  let database: DataSource;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["EXTERNAL_CALENDAR_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["EXTERNAL_CALENDAR_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["EXTERNAL_CALENDAR_TEST_DATABASE_NAME"] ||
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
      "ScheduledMaintenanceExternalCalendar",
      "ScheduledMaintenanceExternalCalendarEvent",
    ]) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    await database.query(
      `ALTER TABLE "${schema}"."ScheduledMaintenanceExternalCalendarEvent" ADD FOREIGN KEY ("scheduledMaintenanceExternalCalendarId") REFERENCES "${schema}"."ScheduledMaintenanceExternalCalendar"("_id") ON DELETE CASCADE`,
    );

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

  beforeEach(() => {
    for (const level of ["debug", "info", "warn"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function addCalendar(): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();

    await database.query(
      `INSERT INTO "ScheduledMaintenanceExternalCalendar" ("_id", "version", "projectId", "name", "calendarUrl", "color", "nextReadAt") VALUES ($1, 1, $2, 'Public holidays', 'encrypted', '#0d9488', $3)`,
      [id.toString(), PROJECT_ID.toString(), new Date("2026-10-15T10:00:00.000Z")],
    );

    return id;
  }

  function rows(
    titles: Array<string>,
    day: number,
  ): Array<ExternalCalendarEventRow> {
    return titles.map((title: string, index: number) => {
      return {
        title: title,
        startsAt: new Date(Date.UTC(2026, 11, day + index)),
        endsAt: new Date(Date.UTC(2026, 11, day + index + 1)),
        isAllDay: true,
      };
    });
  }

  test("a read's events are written, then replaced whole by the next read", async () => {
    const calendarId: ObjectID = await addCalendar();

    await ScheduledMaintenanceExternalCalendarEventService.replaceEventsOfCalendar(
      {
        projectId: PROJECT_ID,
        calendarId: calendarId,
        events: rows(["Christmas Day", "Boxing Day"], 25),
      },
    );

    // Another calendar's events are never touched by this one's replace.
    const otherId: ObjectID = await addCalendar();

    await ScheduledMaintenanceExternalCalendarEventService.replaceEventsOfCalendar(
      {
        projectId: PROJECT_ID,
        calendarId: otherId,
        events: rows(["Other calendar's day"], 1),
      },
    );

    await ScheduledMaintenanceExternalCalendarEventService.replaceEventsOfCalendar(
      {
        projectId: PROJECT_ID,
        calendarId: calendarId,
        events: rows(["Christmas Day", "Boxing Day", "Company shutdown"], 25),
      },
    );

    const stored: Array<{
      title: string;
      startsAt: Date;
      isAllDay: boolean;
      version: number;
    }> = await database.query(
      `SELECT "title", "startsAt", "isAllDay", "version" FROM "ScheduledMaintenanceExternalCalendarEvent" WHERE "scheduledMaintenanceExternalCalendarId" = $1 ORDER BY "startsAt"`,
      [calendarId.toString()],
    );

    expect(
      stored.map((row: { title: string; startsAt: Date }) => {
        return [row.title, new Date(row.startsAt).toISOString()];
      }),
    ).toEqual([
      ["Christmas Day", "2026-12-25T00:00:00.000Z"],
      ["Boxing Day", "2026-12-26T00:00:00.000Z"],
      ["Company shutdown", "2026-12-27T00:00:00.000Z"],
    ]);
    expect(
      stored.every((row: { isAllDay: boolean; version: number }) => {
        return row.isAllDay === true && row.version === 1;
      }),
    ).toBe(true);

    const other: Array<{ count: string }> = await database.query(
      `SELECT count(*) AS "count" FROM "ScheduledMaintenanceExternalCalendarEvent" WHERE "scheduledMaintenanceExternalCalendarId" = $1`,
      [otherId.toString()],
    );
    expect(Number(other[0]!.count)).toBe(1);

    // The calendar page's read of a period, as the CRUD query asks it.
    const period: Array<ScheduledMaintenanceExternalCalendarEvent> =
      await ScheduledMaintenanceExternalCalendarEventService.findBy({
        query: {
          projectId: PROJECT_ID,
          scheduledMaintenanceExternalCalendarId: QueryHelper.any([
            calendarId,
          ]),
          startsAt: QueryHelper.lessThanEqualTo(
            new Date("2026-12-26T12:00:00.000Z"),
          ),
          endsAt: QueryHelper.greaterThanEqualTo(
            new Date("2026-12-25T12:00:00.000Z"),
          ),
        },
        select: { title: true, startsAt: true, isAllDay: true },
        sort: { startsAt: SortOrder.Ascending },
        skip: 0,
        limit: 500,
        props: { isRoot: true },
      });

    expect(
      period.map((event: ScheduledMaintenanceExternalCalendarEvent) => {
        return event.title;
      }),
    ).toEqual(["Christmas Day", "Boxing Day"]);
  });

  test("a thousand events and more are written in chunks, titles cut to their column", async () => {
    const calendarId: ObjectID = await addCalendar();

    const many: Array<ExternalCalendarEventRow> = Array.from({
      length: 1203,
    }).map((_value: unknown, index: number) => {
      return {
        title: index === 0 ? "x".repeat(800) : `Event ${index}`,
        startsAt: new Date(Date.UTC(2026, 10, 1, 0, index)),
        endsAt: new Date(Date.UTC(2026, 10, 1, 1, index)),
        isAllDay: false,
      };
    });

    await ScheduledMaintenanceExternalCalendarEventService.replaceEventsOfCalendar(
      { projectId: PROJECT_ID, calendarId: calendarId, events: many },
    );

    const counted: Array<{ count: string; longest: number }> =
      await database.query(
        `SELECT count(*) AS "count", max(length("title")) AS "longest" FROM "ScheduledMaintenanceExternalCalendarEvent" WHERE "scheduledMaintenanceExternalCalendarId" = $1`,
        [calendarId.toString()],
      );

    expect(Number(counted[0]!.count)).toBe(1203);
    expect(Number(counted[0]!.longest)).toBe(500);
  });

  test("of two readers claiming one calendar with the same expectation, one wins", async () => {
    const calendarId: ObjectID = await addCalendar();
    const expected: Date = new Date("2026-10-15T10:00:00.000Z");

    const claims: Array<boolean> = await Promise.all([
      ScheduledMaintenanceExternalCalendarService.claimForRead({
        id: calendarId,
        expectedNextReadAt: expected,
        leaseUntil: new Date("2026-10-15T10:05:00.000Z"),
      }),
      ScheduledMaintenanceExternalCalendarService.claimForRead({
        id: calendarId,
        expectedNextReadAt: expected,
        leaseUntil: new Date("2026-10-15T10:06:00.000Z"),
      }),
    ]);

    expect(
      claims.filter((claimed: boolean) => {
        return claimed;
      }),
    ).toHaveLength(1);

    // A claim on a calendar never read (no next read yet) matches its null.
    await database.query(
      `UPDATE "ScheduledMaintenanceExternalCalendar" SET "nextReadAt" = NULL WHERE "_id" = $1`,
      [calendarId.toString()],
    );

    expect(
      await ScheduledMaintenanceExternalCalendarService.claimForRead({
        id: calendarId,
        expectedNextReadAt: null,
        leaseUntil: new Date("2026-10-15T10:07:00.000Z"),
      }),
    ).toBe(true);
  });

  test("a read's status is written with its nulls, and a deleted calendar takes its events with it", async () => {
    const calendarId: ObjectID = await addCalendar();

    await ScheduledMaintenanceExternalCalendarService.updateColumnsByIdWithoutHooks(
      {
        id: calendarId,
        data: {
          lastReadError: "NotFound",
          lastReadHttpStatus: 404,
        },
      },
    );

    await ScheduledMaintenanceExternalCalendarService.updateColumnsByIdWithoutHooks(
      {
        id: calendarId,
        data: {
          lastReadAt: new Date("2026-10-15T10:20:00.000Z"),
          lastReadError: null as unknown as string,
          lastReadHttpStatus: null as unknown as number,
          eventCount: 2,
          hasMoreEvents: false,
        },
      },
    );

    const status: Array<{
      lastReadError: string | null;
      lastReadHttpStatus: number | null;
      eventCount: number;
    }> = await database.query(
      `SELECT "lastReadError", "lastReadHttpStatus", "eventCount" FROM "ScheduledMaintenanceExternalCalendar" WHERE "_id" = $1`,
      [calendarId.toString()],
    );

    expect(status[0]).toEqual({
      lastReadError: null,
      lastReadHttpStatus: null,
      eventCount: 2,
    });

    await ScheduledMaintenanceExternalCalendarEventService.replaceEventsOfCalendar(
      {
        projectId: PROJECT_ID,
        calendarId: calendarId,
        events: rows(["Christmas Day"], 25),
      },
    );

    await database.query(
      `DELETE FROM "ScheduledMaintenanceExternalCalendar" WHERE "_id" = $1`,
      [calendarId.toString()],
    );

    const left: Array<{ count: string }> = await database.query(
      `SELECT count(*) AS "count" FROM "ScheduledMaintenanceExternalCalendarEvent" WHERE "scheduledMaintenanceExternalCalendarId" = $1`,
      [calendarId.toString()],
    );

    expect(Number(left[0]!.count)).toBe(0);
  });
});
