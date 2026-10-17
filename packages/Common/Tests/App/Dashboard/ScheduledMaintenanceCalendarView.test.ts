/** @timezone America/New_York */

import { describe, expect, test } from "@jest/globals";
import {
  MAINTENANCE_CALENDAR_FALLBACK_COLOR,
  MaintenanceCalendarEvent,
  getInitialMonthRange,
  getRangeQuery,
  getScheduleStartForDay,
  toCalendarEvents,
  toInstantRange,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/MaintenanceCalendarView";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import GreaterThanOrEqual from "../../../Types/BaseDatabase/GreaterThanOrEqual";
import LessThanOrEqual from "../../../Types/BaseDatabase/LessThanOrEqual";
import Query from "../../../Types/BaseDatabase/Query";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import StartAndEndTime from "../../../Types/Time/StartAndEndTime";

/*
 * Scheduled Maintenance > Events as a calendar, worked out without React.
 *
 * The browser runs in New York and the reader's User Settings zone is
 * Kolkata, ten and a half hours ahead: react-big-calendar draws a Date at
 * the browser's wall clock, so every event is shifted into the reader's zone
 * before the grid sees it, and every range the grid reports is shifted back
 * before it is asked for. A mistake in either direction moves an event by
 * most of a day, which these catch.
 */

const KOLKATA: string = "Asia/Kolkata";

const EVENT_ID: string = "79000000-0000-4000-8000-000000000001";

function state(name: string, color?: string): ScheduledMaintenanceState {
  const model: ScheduledMaintenanceState = new ScheduledMaintenanceState();
  model.name = name;

  if (color) {
    model.color = new Color(color);
  }

  return model;
}

function event(data: {
  id?: string | null;
  title?: string;
  startsAt?: Date | null;
  endsAt?: Date | null;
  state?: ScheduledMaintenanceState;
}): ScheduledMaintenance {
  const model: ScheduledMaintenance = new ScheduledMaintenance();

  if (data.id !== null) {
    model.id = new ObjectID(data.id || EVENT_ID);
  }

  if (data.title !== undefined) {
    model.title = data.title;
  }

  if (data.startsAt !== null) {
    model.startsAt = data.startsAt || new Date("2026-10-20T22:00:00.000Z");
  }

  if (data.endsAt !== null) {
    model.endsAt = data.endsAt || new Date("2026-10-21T01:00:00.000Z");
  }

  if (data.state) {
    model.currentScheduledMaintenanceState = data.state;
  }

  return model;
}

function describeWindow(startsAt: Date, endsAt: Date): string {
  return `${startsAt.toISOString()} to ${endsAt.toISOString()}`;
}

describe("getInitialMonthRange", () => {
  test("the month and the week either side of it, which a month grid shows", () => {
    const range: StartAndEndTime = getInitialMonthRange(
      new Date(2026, 9, 15, 10, 20),
    );

    expect(range.startTime).toEqual(new Date(2026, 8, 24));
    expect(range.endTime).toEqual(new Date(2026, 10, 8));
  });
});

describe("toInstantRange", () => {
  test("a range the grid reports is read as wall clock in the reader's zone", () => {
    const instants: StartAndEndTime = toInstantRange({
      range: {
        startTime: new Date(2026, 9, 1, 0, 0),
        endTime: new Date(2026, 9, 31, 23, 59, 59),
      },
      timezone: KOLKATA,
    });

    expect(instants.startTime.toISOString()).toBe("2026-09-30T18:30:00.000Z");
    expect(instants.endTime.toISOString()).toBe("2026-10-31T18:29:59.000Z");
  });
});

describe("getRangeQuery", () => {
  test("asks for the events whose window touches the range, on top of the page's own query", () => {
    const baseQuery: Query<ScheduledMaintenance> = {
      projectId: new ObjectID("79100000-0000-4000-8000-000000000001"),
      title: "upgrade",
    } as Query<ScheduledMaintenance>;

    const instants: StartAndEndTime = {
      startTime: new Date("2026-09-30T18:30:00.000Z"),
      endTime: new Date("2026-10-31T18:29:59.000Z"),
    };

    const query: Record<string, unknown> = getRangeQuery({
      baseQuery,
      instants,
    }) as Record<string, unknown>;

    expect(query["projectId"]).toEqual(baseQuery.projectId);
    expect(query["title"]).toBe("upgrade");

    // It starts before the range ends...
    expect(query["startsAt"]).toBeInstanceOf(LessThanOrEqual);
    expect((query["startsAt"] as LessThanOrEqual<Date>).value).toEqual(
      instants.endTime,
    );

    // ...and ends after it starts: an event across the range's start is in it.
    expect(query["endsAt"]).toBeInstanceOf(GreaterThanOrEqual);
    expect((query["endsAt"] as GreaterThanOrEqual<Date>).value).toEqual(
      instants.startTime,
    );
  });
});

describe("toCalendarEvents", () => {
  test("an event is drawn at the reader's wall clock, in its state's colour", () => {
    const drawn: Array<MaintenanceCalendarEvent> = toCalendarEvents({
      events: [
        event({
          title: "Database upgrade",
          state: state("Ongoing", "#ffbf53"),
        }),
      ],
      timezone: KOLKATA,
      describeWindow,
    });

    expect(drawn).toHaveLength(1);

    const only: MaintenanceCalendarEvent = drawn[0]!;

    // 22:00 UTC is 03:30 the next morning in Kolkata.
    expect(only.start).toEqual(new Date(2026, 9, 21, 3, 30));
    expect(only.end).toEqual(new Date(2026, 9, 21, 6, 30));
    expect(only.title).toBe("Database upgrade");
    expect(only.maintenanceId).toBe(EVENT_ID);
    expect(only.stateName).toBe("Ongoing");
    expect(only.color?.toString()).toBe("#ffbf53");
    expect(only.desc).toBe(
      "Database upgrade\nOngoing · 2026-10-20T22:00:00.000Z to 2026-10-21T01:00:00.000Z",
    );
  });

  test("a state without a colour is drawn grey, and an event without a state says only its window", () => {
    const drawn: Array<MaintenanceCalendarEvent> = toCalendarEvents({
      events: [event({ title: "Database upgrade" })],
      timezone: KOLKATA,
      describeWindow,
    });

    expect(drawn[0]!.color?.toString()).toBe(
      MAINTENANCE_CALENDAR_FALLBACK_COLOR,
    );
    expect(drawn[0]!.desc).toBe(
      "Database upgrade\n2026-10-20T22:00:00.000Z to 2026-10-21T01:00:00.000Z",
    );
  });

  test("an event with no end, or one before its start, lasts the form's default hour; one with no title is named for what it is", () => {
    const drawn: Array<MaintenanceCalendarEvent> = toCalendarEvents({
      events: [
        event({ title: "", endsAt: null }),
        event({
          id: "79000000-0000-4000-8000-000000000002",
          title: "Backwards",
          endsAt: new Date("2026-10-20T21:00:00.000Z"),
        }),
      ],
      timezone: KOLKATA,
      describeWindow,
    });

    for (const one of drawn) {
      expect(one.end.getTime() - one.start.getTime()).toBe(60 * 60 * 1000);
    }

    expect(drawn[0]!.title).toBe("Scheduled maintenance");
  });

  test("an event without an id or a start is left out rather than drawn wrong", () => {
    const drawn: Array<MaintenanceCalendarEvent> = toCalendarEvents({
      events: [event({ id: null }), event({ startsAt: null })],
      timezone: KOLKATA,
      describeWindow,
    });

    expect(drawn).toEqual([]);
  });
});

describe("getScheduleStartForDay", () => {
  // 10:20 UTC is 15:50 in Kolkata: the form would start a new event at 16:00.
  const NOW: Date = new Date("2026-10-15T10:20:00.000Z");

  test("a later day starts at the hour the form would start one today, on that day", () => {
    expect(
      getScheduleStartForDay({
        day: new Date(2026, 9, 20),
        timezone: KOLKATA,
        now: NOW,
      })?.toISOString(),
    ).toBe("2026-10-20T10:30:00.000Z");
  });

  test("today starts at the next full hour", () => {
    expect(
      getScheduleStartForDay({
        day: new Date(2026, 9, 15),
        timezone: KOLKATA,
        now: NOW,
      })?.toISOString(),
    ).toBe("2026-10-15T10:30:00.000Z");
  });

  test("nothing is scheduled on a day that is over", () => {
    expect(
      getScheduleStartForDay({
        day: new Date(2026, 9, 14),
        timezone: KOLKATA,
        now: NOW,
      }),
    ).toBeNull();
  });

  test("the days are the reader's: after their midnight, their yesterday is over though the browser's day is not", () => {
    // 20:00 UTC: 16:00 in New York, already 01:30 the next day in Kolkata.
    const lateEvening: Date = new Date("2026-10-15T20:00:00.000Z");

    expect(
      getScheduleStartForDay({
        day: new Date(2026, 9, 15),
        timezone: KOLKATA,
        now: lateEvening,
      }),
    ).toBeNull();
    expect(
      getScheduleStartForDay({
        day: new Date(2026, 9, 16),
        timezone: KOLKATA,
        now: lateEvening,
      })?.toISOString(),
    ).toBe("2026-10-15T20:30:00.000Z");
  });
});
