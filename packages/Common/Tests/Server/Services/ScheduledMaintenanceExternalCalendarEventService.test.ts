import ScheduledMaintenanceExternalCalendarEventService, {
  DELETE_EVENTS_OF_CALENDAR_SQL,
  EXTERNAL_CALENDAR_EVENT_INSERT_CHUNK_SIZE,
  ExternalCalendarEventRow,
  INSERT_EVENTS_SQL,
} from "../../../Server/Services/ScheduledMaintenanceExternalCalendarEventService";
import ObjectID from "../../../Types/ObjectID";
import { EXTERNAL_CALENDAR_MAX_TITLE_LENGTH } from "../../../Types/ScheduledMaintenance/ExternalCalendar";
import { getJestSpyOn } from "../../Spy";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * A read of a calendar replaces all of its events at once
 * (ScheduledMaintenanceExternalCalendarEventService): one transaction that
 * deletes the calendar's events and writes the new ones in multi-row
 * INSERTs, so the maintenance calendar never shows half of an old read and
 * half of a new one, and nothing but that calendar's events is touched.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5f000000-0000-4000-8000-000000000001",
);
const CALENDAR_ID: ObjectID = new ObjectID(
  "5f000000-0000-4000-8000-000000000002",
);

interface Statement {
  sql: string;
  parameters: Array<unknown>;
}

function events(count: number): Array<ExternalCalendarEventRow> {
  return Array.from({ length: count }).map(
    (_value: unknown, index: number): ExternalCalendarEventRow => {
      return {
        title: `Event ${index + 1}`,
        startsAt: new Date(Date.UTC(2026, 10, 1, 0, index)),
        endsAt: new Date(Date.UTC(2026, 10, 1, 1, index)),
        isAllDay: index % 2 === 0,
      };
    },
  );
}

// Runs replaceEventsOfCalendar with a transaction whose statements are recorded.
async function replace(
  rows: Array<ExternalCalendarEventRow>,
): Promise<{ statements: Array<Statement>; transactions: number }> {
  const statements: Array<Statement> = [];
  let transactions: number = 0;

  getJestSpyOn(
    ScheduledMaintenanceExternalCalendarEventService,
    "executeTransaction",
  ).mockImplementation(async (run: unknown): Promise<unknown> => {
    transactions++;

    return await (
      run as (manager: {
        query: (sql: string, parameters: Array<unknown>) => Promise<unknown>;
      }) => Promise<unknown>
    )({
      query: async (sql: string, parameters: Array<unknown>) => {
        statements.push({ sql: sql, parameters: parameters });
        return [];
      },
    });
  });

  await ScheduledMaintenanceExternalCalendarEventService.replaceEventsOfCalendar(
    {
      projectId: PROJECT_ID,
      calendarId: CALENDAR_ID,
      events: rows,
    },
  );

  return { statements: statements, transactions: transactions };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("replacing a calendar's events", () => {
  test("deletes that calendar's events and writes the new ones, in one transaction", async () => {
    const { statements, transactions } = await replace(events(3));

    expect(transactions).toBe(1);
    expect(statements).toHaveLength(2);

    expect(statements[0]).toEqual({
      sql: DELETE_EVENTS_OF_CALENDAR_SQL,
      parameters: [CALENDAR_ID.toString()],
    });

    expect(statements[1]!.sql).toBe(INSERT_EVENTS_SQL);
    expect(statements[1]!.parameters).toEqual([
      PROJECT_ID.toString(),
      CALENDAR_ID.toString(),
      ["Event 1", "Event 2", "Event 3"],
      [
        new Date("2026-11-01T00:00:00.000Z"),
        new Date("2026-11-01T00:01:00.000Z"),
        new Date("2026-11-01T00:02:00.000Z"),
      ],
      [
        new Date("2026-11-01T01:00:00.000Z"),
        new Date("2026-11-01T01:01:00.000Z"),
        new Date("2026-11-01T01:02:00.000Z"),
      ],
      [true, false, true],
    ]);
  });

  test(`writes ${EXTERNAL_CALENDAR_EVENT_INSERT_CHUNK_SIZE} rows an INSERT`, async () => {
    const { statements } = await replace(events(1203));

    const inserts: Array<Statement> = statements.slice(1);

    expect(EXTERNAL_CALENDAR_EVENT_INSERT_CHUNK_SIZE).toBe(500);
    expect(
      inserts.map((statement: Statement): number => {
        return (statement.parameters[2] as Array<string>).length;
      }),
    ).toEqual([500, 500, 203]);
    expect((inserts[2]!.parameters[2] as Array<string>)[202]).toBe(
      "Event 1203",
    );
  });

  test("a calendar with no events left keeps none", async () => {
    const { statements } = await replace([]);

    expect(statements).toEqual([
      {
        sql: DELETE_EVENTS_OF_CALENDAR_SQL,
        parameters: [CALENDAR_ID.toString()],
      },
    ]);
  });

  test("a title too long for its column is cut, so it never fails the rows written with it", async () => {
    const { statements } = await replace([
      {
        title: "x".repeat(EXTERNAL_CALENDAR_MAX_TITLE_LENGTH + 50),
        startsAt: new Date("2026-11-01T00:00:00.000Z"),
        endsAt: new Date("2026-11-01T01:00:00.000Z"),
        isAllDay: false,
      },
    ]);

    expect((statements[1]!.parameters[2] as Array<string>)[0]).toHaveLength(
      EXTERNAL_CALENDAR_MAX_TITLE_LENGTH,
    );
  });
});

describe("the statements", () => {
  test("the DELETE touches one calendar's events and nothing else", () => {
    expect(DELETE_EVENTS_OF_CALENDAR_SQL).toBe(
      'DELETE FROM "ScheduledMaintenanceExternalCalendarEvent" WHERE "scheduledMaintenanceExternalCalendarId" = $1',
    );
  });

  test("the INSERT writes the event's columns from parallel arrays, the project and calendar bound once", () => {
    expect(INSERT_EVENTS_SQL).toContain(
      'INSERT INTO "ScheduledMaintenanceExternalCalendarEvent" ("projectId", "scheduledMaintenanceExternalCalendarId", "title", "startsAt", "endsAt", "isAllDay", "version")',
    );
    expect(INSERT_EVENTS_SQL).toContain("SELECT $1::uuid, $2::uuid");
    expect(INSERT_EVENTS_SQL).toContain(
      "FROM unnest($3::text[], $4::timestamptz[], $5::timestamptz[], $6::boolean[])",
    );
  });

  test("forgetting a calendar's events runs the same DELETE", async () => {
    const queries: Array<Statement> = [];

    getJestSpyOn(
      ScheduledMaintenanceExternalCalendarEventService,
      "getRepository",
    ).mockReturnValue({
      manager: {
        query: async (sql: string, parameters: Array<unknown>) => {
          queries.push({ sql: sql, parameters: parameters });
          return [];
        },
      },
    } as never);

    await ScheduledMaintenanceExternalCalendarEventService.deleteEventsOfCalendar(
      CALENDAR_ID,
    );

    expect(queries).toEqual([
      {
        sql: DELETE_EVENTS_OF_CALENDAR_SQL,
        parameters: [CALENDAR_ID.toString()],
      },
    ]);
  });
});
