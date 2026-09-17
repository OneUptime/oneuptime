import LayerUtil, {
  LayerEventsResult,
  PriorityCalendarEvents,
  ROTATION_PERIOD_START_KEY,
} from "../../../Types/OnCallDutyPolicy/Layer";
import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import RestrictionTimes, {
  RestrictionType,
  WeeklyResctriction,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import Recurring from "../../../Types/Events/Recurring";
import EventInterval from "../../../Types/Events/EventInterval";
import StartAndEndTime from "../../../Types/Time/StartAndEndTime";
import DayOfWeek from "../../../Types/Day/DayOfWeek";
import User from "../../../Models/DatabaseModels/User";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";
import moment from "moment-timezone";

/*
 * Core-path coverage for LayerUtil that the many audit/regression suites next
 * to this file do not pin directly: JSON / string input sanitisation, a
 * missing handoff, the plain round-robin order for several users, handoff
 * phase, daily and weekly restriction trimming (including overnight and
 * weekend wrap-around windows), DST behaviour of Day vs Hour rotations,
 * multi-layer priority metadata and the event-count cap.
 *
 * Every instant is built in an explicit IANA zone and every layer carries an
 * explicit `timezone`, so results do not depend on the process TZ.
 */

const UTC: string = "UTC";
const NY: string = "America/New_York";
const SECOND_MS: number = 1000;
const HOUR_MS: number = 60 * 60 * SECOND_MS;

function user(id: string): User {
  return {
    id: {
      toString: (): string => {
        return id;
      },
    },
  } as unknown as User;
}

function rotation(
  intervalType: EventInterval,
  intervalCount: number,
): Recurring {
  return Recurring.fromJSON({
    _type: "Recurring",
    value: {
      intervalType: intervalType,
      intervalCount: { _type: "PositiveNumber", value: intervalCount },
    },
  } as JSONObject);
}

function at(iso: string, tz: string = UTC): Date {
  return moment.tz(iso, tz).toDate();
}

function wall(d: Date, tz: string = UTC): string {
  return moment.tz(d, tz).format("YYYY-MM-DD HH:mm:ss");
}

function noRestriction(): RestrictionTimes {
  const rt: RestrictionTimes = new RestrictionTimes();
  rt.restictionType = RestrictionType.None;
  return rt;
}

function dailyRestriction(
  startIso: string,
  endIso: string,
  tz: string = UTC,
): RestrictionTimes {
  const rt: RestrictionTimes = new RestrictionTimes();
  rt.restictionType = RestrictionType.Daily;
  rt.dayRestrictionTimes = {
    startTime: at(startIso, tz),
    endTime: at(endIso, tz),
  };
  return rt;
}

function weeklyRestriction(
  windows: Array<WeeklyResctriction>,
): RestrictionTimes {
  const rt: RestrictionTimes = new RestrictionTimes();
  rt.restictionType = RestrictionType.Weekly;
  rt.weeklyRestrictionTimes = windows;
  return rt;
}

interface Summary {
  user: string;
  start: string;
  end: string;
}

function summarize(
  events: Array<CalendarEvent>,
  tz: string = UTC,
): Array<Summary> {
  return events.map((e: CalendarEvent): Summary => {
    return { user: e.title, start: wall(e.start, tz), end: wall(e.end, tz) };
  });
}

describe("LayerUtil.getEvents - input validation", () => {
  test("returns no events when the user list is empty", () => {
    const result: LayerEventsResult = new LayerUtil().getEventsWithMeta({
      users: [],
      startDateTimeOfLayer: at("2026-01-05 00:00"),
      handOffTime: at("2026-01-05 00:00"),
      restrictionTimes: noRestriction(),
      rotation: rotation(EventInterval.Day, 1),
      timezone: UTC,
      calendarStartDate: at("2026-01-05 00:00"),
      calendarEndDate: at("2026-01-10 00:00"),
    });

    expect(result).toEqual({ events: [], truncated: false });
  });

  test("returns no events when the calendar end is before the calendar start", () => {
    const events: Array<CalendarEvent> = new LayerUtil().getEvents({
      users: [user("a")],
      startDateTimeOfLayer: at("2026-01-01 00:00"),
      handOffTime: at("2026-01-01 00:00"),
      restrictionTimes: noRestriction(),
      rotation: rotation(EventInterval.Day, 1),
      timezone: UTC,
      calendarStartDate: at("2026-01-10 00:00"),
      calendarEndDate: at("2026-01-05 00:00"),
    });

    expect(events).toEqual([]);
  });

  test("returns no events when the layer starts after the calendar window ends", () => {
    const events: Array<CalendarEvent> = new LayerUtil().getEvents({
      users: [user("a")],
      startDateTimeOfLayer: at("2026-02-01 00:00"),
      handOffTime: at("2026-02-01 00:00"),
      restrictionTimes: noRestriction(),
      rotation: rotation(EventInterval.Day, 1),
      timezone: UTC,
      calendarStartDate: at("2026-01-01 00:00"),
      calendarEndDate: at("2026-01-10 00:00"),
    });

    expect(events).toEqual([]);
  });

  test("returns no events when the handoff time is missing", () => {
    const result: LayerEventsResult = new LayerUtil().getEventsWithMeta({
      users: [user("a")],
      startDateTimeOfLayer: at("2026-01-01 00:00"),
      handOffTime: null as unknown as Date,
      restrictionTimes: noRestriction(),
      rotation: rotation(EventInterval.Day, 1),
      timezone: UTC,
      calendarStartDate: at("2026-01-01 00:00"),
      calendarEndDate: at("2026-01-03 00:00"),
    });

    expect(result).toEqual({ events: [], truncated: false });
  });

  test("clamps the window start to the layer start when the layer starts inside the window", () => {
    const events: Array<CalendarEvent> = new LayerUtil().getEvents({
      users: [user("a")],
      startDateTimeOfLayer: at("2026-01-03 06:00"),
      handOffTime: at("2026-01-03 06:00"),
      restrictionTimes: noRestriction(),
      rotation: rotation(EventInterval.Day, 1),
      timezone: UTC,
      calendarStartDate: at("2026-01-01 00:00"),
      calendarEndDate: at("2026-01-04 00:00"),
    });

    expect(events.length).toBeGreaterThan(0);
    expect(wall(events[0]!.start)).toBe("2026-01-03 06:00:00");
    expect(wall(events[events.length - 1]!.end)).toBe("2026-01-04 00:00:00");
  });

  test("accepts JSON-serialised rotation / restriction and ISO string dates", () => {
    const util: LayerUtil = new LayerUtil();

    const typed: Array<CalendarEvent> = util.getEvents({
      users: [user("a"), user("b")],
      startDateTimeOfLayer: at("2026-01-05 00:00"),
      handOffTime: at("2026-01-05 00:00"),
      restrictionTimes: dailyRestriction(
        "2026-01-05 09:00",
        "2026-01-05 17:00",
      ),
      rotation: rotation(EventInterval.Day, 1),
      timezone: UTC,
      calendarStartDate: at("2026-01-05 00:00"),
      calendarEndDate: at("2026-01-08 00:00"),
    });

    const fromJson: Array<CalendarEvent> = new LayerUtil().getEvents({
      users: [user("a"), user("b")],
      startDateTimeOfLayer: "2026-01-05T00:00:00.000Z" as unknown as Date,
      handOffTime: "2026-01-05T00:00:00.000Z" as unknown as Date,
      restrictionTimes: dailyRestriction(
        "2026-01-05 09:00",
        "2026-01-05 17:00",
      ).toJSON() as unknown as RestrictionTimes,
      rotation: rotation(EventInterval.Day, 1).toJSON() as unknown as Recurring,
      timezone: UTC,
      calendarStartDate: "2026-01-05T00:00:00.000Z" as unknown as Date,
      calendarEndDate: "2026-01-08T00:00:00.000Z" as unknown as Date,
    });

    expect(typed.length).toBe(3);
    expect(summarize(fromJson)).toEqual(summarize(typed));
  });
});

describe("LayerUtil.getEvents - rotation order and handoff", () => {
  test("rotates three users round-robin on a daily handoff with 1 s seams", () => {
    const events: Array<CalendarEvent> = new LayerUtil().getEvents({
      users: [user("a"), user("b"), user("c")],
      startDateTimeOfLayer: at("2026-01-05 00:00"),
      handOffTime: at("2026-01-05 00:00"),
      restrictionTimes: noRestriction(),
      rotation: rotation(EventInterval.Day, 1),
      timezone: UTC,
      calendarStartDate: at("2026-01-05 00:00"),
      calendarEndDate: at("2026-01-10 00:00"),
    });

    expect(
      events.map((e: CalendarEvent): string => {
        return e.title;
      }),
    ).toEqual(["a", "b", "c", "a", "b"]);

    // Ids are unique and sequential.
    expect(
      events.map((e: CalendarEvent): number => {
        return e.id;
      }),
    ).toEqual([1, 2, 3, 4, 5]);

    for (let i: number = 1; i < events.length; i++) {
      expect(events[i]!.start.getTime() - events[i - 1]!.end.getTime()).toBe(
        SECOND_MS,
      );
    }

    expect(wall(events[0]!.start)).toBe("2026-01-05 00:00:00");
    expect(wall(events[0]!.end)).toBe("2026-01-06 00:00:00");
    expect(wall(events[4]!.end)).toBe("2026-01-10 00:00:00");
  });

  test("REGRESSION: a window ending exactly on a handoff emits no trailing inverted event", () => {
    for (const restrictionTimes of [
      noRestriction(),
      dailyRestriction("2026-01-01 00:00", "2026-01-01 23:00"),
    ]) {
      const result: LayerEventsResult = new LayerUtil().getEventsWithMeta({
        users: [user("a"), user("b")],
        startDateTimeOfLayer: at("2026-01-05 08:00"),
        handOffTime: at("2026-01-05 08:00"),
        restrictionTimes: restrictionTimes,
        rotation: rotation(EventInterval.Day, 1),
        timezone: UTC,
        calendarStartDate: at("2026-01-05 08:00"),
        calendarEndDate: at("2026-01-07 08:00"),
      });

      expect(result.truncated).toBe(false);
      for (const e of result.events) {
        expect(e.end.getTime()).toBeGreaterThan(e.start.getTime());
        expect(e.end.getTime()).toBeLessThanOrEqual(
          at("2026-01-07 08:00").getTime(),
        );
      }
      // The next user ("a" again) must not appear as a 1 s-inverted stub.
      expect(result.events[result.events.length - 1]!.title).toBe("b");
    }
  });

  test("a single user holds every period", () => {
    const events: Array<CalendarEvent> = new LayerUtil().getEvents({
      users: [user("solo")],
      startDateTimeOfLayer: at("2026-01-05 00:00"),
      handOffTime: at("2026-01-05 00:00"),
      restrictionTimes: noRestriction(),
      rotation: rotation(EventInterval.Day, 1),
      timezone: UTC,
      calendarStartDate: at("2026-01-05 00:00"),
      calendarEndDate: at("2026-01-08 00:00"),
    });

    expect(events.length).toBe(3);
    for (const e of events) {
      expect(e.title).toBe("solo");
    }
  });

  test("a mid-day handoff splits the first period at the handoff time", () => {
    const events: Array<CalendarEvent> = new LayerUtil().getEvents({
      users: [user("a"), user("b")],
      startDateTimeOfLayer: at("2026-01-05 00:00"),
      handOffTime: at("2026-01-05 09:30"),
      restrictionTimes: noRestriction(),
      rotation: rotation(EventInterval.Day, 1),
      timezone: UTC,
      calendarStartDate: at("2026-01-05 00:00"),
      calendarEndDate: at("2026-01-07 12:00"),
    });

    expect(summarize(events)).toEqual([
      { user: "a", start: "2026-01-05 00:00:00", end: "2026-01-05 09:30:00" },
      { user: "b", start: "2026-01-05 09:30:01", end: "2026-01-06 09:30:00" },
      { user: "a", start: "2026-01-06 09:30:01", end: "2026-01-07 09:30:00" },
      { user: "b", start: "2026-01-07 09:30:01", end: "2026-01-07 12:00:00" },
    ]);
  });

  test("a window starting weeks after the layer start resumes at the correct user", () => {
    const layer: {
      users: Array<User>;
      startDateTimeOfLayer: Date;
      handOffTime: Date;
    } = {
      users: [user("a"), user("b"), user("c")],
      startDateTimeOfLayer: at("2026-01-05 00:00"),
      handOffTime: at("2026-01-05 00:00"),
    };

    const full: Array<CalendarEvent> = new LayerUtil().getEvents({
      ...layer,
      restrictionTimes: noRestriction(),
      rotation: rotation(EventInterval.Day, 1),
      timezone: UTC,
      calendarStartDate: at("2026-01-05 00:00"),
      calendarEndDate: at("2026-01-25 00:00"),
    });

    const late: Array<CalendarEvent> = new LayerUtil().getEvents({
      ...layer,
      restrictionTimes: noRestriction(),
      rotation: rotation(EventInterval.Day, 1),
      timezone: UTC,
      calendarStartDate: at("2026-01-20 00:00"),
      calendarEndDate: at("2026-01-25 00:00"),
    });

    // Day 15 after the start: 15 % 3 === 0 -> user "a".
    expect(late[0]!.title).toBe("a");
    // The first event is clamped to the window start instead of the seam.
    expect(wall(late[0]!.start)).toBe("2026-01-20 00:00:00");
    expect(summarize(late.slice(1))).toEqual(summarize(full.slice(16)));
    expect(
      late.map((e: CalendarEvent): string => {
        return e.title;
      }),
    ).toEqual(
      full.slice(15).map((e: CalendarEvent): string => {
        return e.title;
      }),
    );
  });

  test("a multi-day rotation interval keeps a user on for the whole interval", () => {
    const events: Array<CalendarEvent> = new LayerUtil().getEvents({
      users: [user("a"), user("b")],
      startDateTimeOfLayer: at("2026-01-05 08:00"),
      handOffTime: at("2026-01-05 08:00"),
      restrictionTimes: noRestriction(),
      rotation: rotation(EventInterval.Day, 3),
      timezone: UTC,
      calendarStartDate: at("2026-01-05 08:00"),
      calendarEndDate: at("2026-01-14 08:00"),
    });

    expect(summarize(events)).toEqual([
      { user: "a", start: "2026-01-05 08:00:00", end: "2026-01-08 08:00:00" },
      { user: "b", start: "2026-01-08 08:00:01", end: "2026-01-11 08:00:00" },
      { user: "a", start: "2026-01-11 08:00:01", end: "2026-01-14 08:00:00" },
    ]);
  });

  test("a restricted layer stamps the true period start on a window-clamped first event", () => {
    const events: Array<CalendarEvent> = new LayerUtil().getEvents({
      users: [user("a"), user("b")],
      startDateTimeOfLayer: at("2026-01-05 00:00"),
      handOffTime: at("2026-01-05 00:00"),
      restrictionTimes: dailyRestriction(
        "2026-01-01 09:00",
        "2026-01-01 17:00",
      ),
      rotation: rotation(EventInterval.Day, 1),
      timezone: UTC,
      calendarStartDate: at("2026-01-06 15:00"),
      calendarEndDate: at("2026-01-08 00:00"),
    });

    const periodStart: (e: CalendarEvent) => number = (
      e: CalendarEvent,
    ): number => {
      return (e as unknown as Record<string, number>)[
        ROTATION_PERIOD_START_KEY
      ]!;
    };

    expect(summarize(events)).toEqual([
      { user: "b", start: "2026-01-06 15:00:00", end: "2026-01-06 17:00:00" },
      { user: "a", start: "2026-01-07 09:00:00", end: "2026-01-07 17:00:00" },
    ]);
    // The seam puts every period after the first one second past the handoff.
    expect(periodStart(events[0]!)).toBe(at("2026-01-06 00:00:01").getTime());
    expect(periodStart(events[1]!)).toBe(at("2026-01-07 00:00:01").getTime());
  });
});

describe("LayerUtil.getEvents - DST", () => {
  test("a daily rotation in New York keeps its 09:00 wall-clock handoff across spring-forward", () => {
    const events: Array<CalendarEvent> = new LayerUtil().getEvents({
      users: [user("a"), user("b")],
      startDateTimeOfLayer: at("2026-03-06 09:00", NY),
      handOffTime: at("2026-03-06 09:00", NY),
      restrictionTimes: noRestriction(),
      rotation: rotation(EventInterval.Day, 1),
      timezone: NY,
      calendarStartDate: at("2026-03-06 09:00", NY),
      calendarEndDate: at("2026-03-10 09:00", NY),
    });

    expect(summarize(events, NY)).toEqual([
      { user: "a", start: "2026-03-06 09:00:00", end: "2026-03-07 09:00:00" },
      { user: "b", start: "2026-03-07 09:00:01", end: "2026-03-08 09:00:00" },
      { user: "a", start: "2026-03-08 09:00:01", end: "2026-03-09 09:00:00" },
      { user: "b", start: "2026-03-09 09:00:01", end: "2026-03-10 09:00:00" },
    ]);

    // The day containing the transition (Mar 7 -> Mar 8) is only 23 real hours.
    expect(events[1]!.end.getTime() - events[1]!.start.getTime()).toBe(
      23 * HOUR_MS - SECOND_MS,
    );
  });

  test("a daily rotation in New York is 25 real hours across fall-back", () => {
    const events: Array<CalendarEvent> = new LayerUtil().getEvents({
      users: [user("a"), user("b")],
      startDateTimeOfLayer: at("2026-10-31 09:00", NY),
      handOffTime: at("2026-10-31 09:00", NY),
      restrictionTimes: noRestriction(),
      rotation: rotation(EventInterval.Day, 1),
      timezone: NY,
      calendarStartDate: at("2026-10-31 09:00", NY),
      calendarEndDate: at("2026-11-02 09:00", NY),
    });

    expect(summarize(events, NY)).toEqual([
      { user: "a", start: "2026-10-31 09:00:00", end: "2026-11-01 09:00:00" },
      { user: "b", start: "2026-11-01 09:00:01", end: "2026-11-02 09:00:00" },
    ]);
    expect(events[0]!.end.getTime() - events[0]!.start.getTime()).toBe(
      25 * HOUR_MS,
    );
  });

  test("an hourly rotation steps absolute hours across spring-forward", () => {
    const events: Array<CalendarEvent> = new LayerUtil().getEvents({
      users: [user("a"), user("b")],
      startDateTimeOfLayer: at("2026-03-08 00:00", NY),
      handOffTime: at("2026-03-08 00:00", NY),
      restrictionTimes: noRestriction(),
      rotation: rotation(EventInterval.Hour, 1),
      timezone: NY,
      calendarStartDate: at("2026-03-08 00:00", NY),
      calendarEndDate: at("2026-03-08 04:00", NY),
    });

    // 00:00 -> 04:00 NY on spring-forward day is only 3 real hours.
    expect(
      events.map((e: CalendarEvent): string => {
        return e.title;
      }),
    ).toEqual(["a", "b", "a"]);
    expect(
      events.map((e: CalendarEvent): string => {
        return moment.tz(e.start, NY).format("HH:mm:ss");
      }),
    ).toEqual(["00:00:00", "01:00:01", "03:00:01"]);
  });
});

describe("LayerUtil.getEvents - restrictions", () => {
  test("a daily 09:00-17:00 restriction yields one working-hours event per day, rotating users", () => {
    const events: Array<CalendarEvent> = new LayerUtil().getEvents({
      users: [user("a"), user("b")],
      startDateTimeOfLayer: at("2026-01-05 00:00"),
      handOffTime: at("2026-01-05 00:00"),
      restrictionTimes: dailyRestriction(
        "2026-01-01 09:00",
        "2026-01-01 17:00",
      ),
      rotation: rotation(EventInterval.Day, 1),
      timezone: UTC,
      calendarStartDate: at("2026-01-05 00:00"),
      calendarEndDate: at("2026-01-08 00:00"),
    });

    expect(summarize(events)).toEqual([
      { user: "a", start: "2026-01-05 09:00:00", end: "2026-01-05 17:00:00" },
      { user: "b", start: "2026-01-06 09:00:00", end: "2026-01-06 17:00:00" },
      { user: "a", start: "2026-01-07 09:00:00", end: "2026-01-07 17:00:00" },
    ]);
  });

  test("a daily restriction is resolved in the schedule zone (New York), not the process zone", () => {
    const events: Array<CalendarEvent> = new LayerUtil().getEvents({
      users: [user("a")],
      startDateTimeOfLayer: at("2026-07-06 00:00", NY),
      handOffTime: at("2026-07-06 00:00", NY),
      restrictionTimes: dailyRestriction(
        "2026-01-01 09:00",
        "2026-01-01 17:00",
        NY,
      ),
      rotation: rotation(EventInterval.Day, 1),
      timezone: NY,
      calendarStartDate: at("2026-07-06 00:00", NY),
      calendarEndDate: at("2026-07-08 00:00", NY),
    });

    // Authored in winter (EST) but applied in summer (EDT): wall-clock holds.
    expect(summarize(events, NY)).toEqual([
      { user: "a", start: "2026-07-06 09:00:00", end: "2026-07-06 17:00:00" },
      { user: "a", start: "2026-07-07 09:00:00", end: "2026-07-07 17:00:00" },
    ]);
  });

  test("an overnight daily restriction (22:00-06:00) covers the night across the day boundary", () => {
    const util: LayerUtil = new LayerUtil();
    const events: Array<CalendarEvent> = util.getEvents({
      users: [user("a")],
      startDateTimeOfLayer: at("2026-01-05 00:00"),
      handOffTime: at("2026-01-05 00:00"),
      restrictionTimes: dailyRestriction(
        "2026-01-01 22:00",
        "2026-01-01 06:00",
      ),
      rotation: rotation(EventInterval.Week, 1),
      timezone: UTC,
      calendarStartDate: at("2026-01-05 00:00"),
      calendarEndDate: at("2026-01-07 00:00"),
    });

    const covered: (iso: string) => boolean = (iso: string): boolean => {
      const t: number = at(iso).getTime();
      return events.some((e: CalendarEvent): boolean => {
        return e.start.getTime() <= t && t <= e.end.getTime();
      });
    };

    expect(covered("2026-01-05 00:30")).toBe(true);
    expect(covered("2026-01-05 05:59")).toBe(true);
    expect(covered("2026-01-05 06:30")).toBe(false);
    expect(covered("2026-01-05 12:00")).toBe(false);
    expect(covered("2026-01-05 21:59")).toBe(false);
    expect(covered("2026-01-05 22:30")).toBe(true);
    expect(covered("2026-01-06 03:00")).toBe(true);
    expect(covered("2026-01-06 12:00")).toBe(false);
    expect(covered("2026-01-06 23:00")).toBe(true);

    for (const e of events) {
      expect(e.end.getTime()).toBeGreaterThan(e.start.getTime());
    }
  });

  test("a period fully inside a restriction gap does not consume a user's turn", () => {
    // Weekdays 09:00-17:00 only; daily rotation. Sat/Sun produce no coverage.
    const windows: Array<WeeklyResctriction> = [];
    const mondayIso: Array<string> = [
      "2026-01-05",
      "2026-01-06",
      "2026-01-07",
      "2026-01-08",
      "2026-01-09",
    ];
    const days: Array<DayOfWeek> = [
      DayOfWeek.Monday,
      DayOfWeek.Tuesday,
      DayOfWeek.Wednesday,
      DayOfWeek.Thursday,
      DayOfWeek.Friday,
    ];
    for (let i: number = 0; i < days.length; i++) {
      windows.push({
        startDay: days[i]!,
        endDay: days[i]!,
        startTime: at(`${mondayIso[i]} 09:00`),
        endTime: at(`${mondayIso[i]} 17:00`),
      });
    }

    const events: Array<CalendarEvent> = new LayerUtil().getEvents({
      users: [user("a"), user("b"), user("c")],
      startDateTimeOfLayer: at("2026-01-05 00:00"),
      handOffTime: at("2026-01-05 00:00"),
      restrictionTimes: weeklyRestriction(windows),
      rotation: rotation(EventInterval.Day, 1),
      timezone: UTC,
      calendarStartDate: at("2026-01-05 00:00"),
      calendarEndDate: at("2026-01-14 00:00"),
    });

    expect(summarize(events)).toEqual([
      { user: "a", start: "2026-01-05 09:00:00", end: "2026-01-05 17:00:00" },
      { user: "b", start: "2026-01-06 09:00:00", end: "2026-01-06 17:00:00" },
      { user: "c", start: "2026-01-07 09:00:00", end: "2026-01-07 17:00:00" },
      { user: "a", start: "2026-01-08 09:00:00", end: "2026-01-08 17:00:00" },
      { user: "b", start: "2026-01-09 09:00:00", end: "2026-01-09 17:00:00" },
      // weekend skipped without advancing the rotation
      { user: "c", start: "2026-01-12 09:00:00", end: "2026-01-12 17:00:00" },
      { user: "a", start: "2026-01-13 09:00:00", end: "2026-01-13 17:00:00" },
    ]);
  });

  test("a weekend wrap-around weekly restriction (Fri 18:00 -> Mon 08:00) on a weekly rotation", () => {
    const events: Array<CalendarEvent> = new LayerUtil().getEvents({
      users: [user("a"), user("b")],
      startDateTimeOfLayer: at("2026-01-05 00:00"),
      handOffTime: at("2026-01-05 00:00"),
      restrictionTimes: weeklyRestriction([
        {
          startDay: DayOfWeek.Friday,
          endDay: DayOfWeek.Monday,
          startTime: at("2026-01-09 18:00"),
          endTime: at("2026-01-12 08:00"),
        },
      ]),
      rotation: rotation(EventInterval.Week, 1),
      timezone: UTC,
      calendarStartDate: at("2026-01-05 00:00"),
      calendarEndDate: at("2026-01-19 00:00"),
    });

    const covering: (iso: string) => string | null = (
      iso: string,
    ): string | null => {
      const t: number = at(iso).getTime();
      const hit: CalendarEvent | undefined = events.find(
        (e: CalendarEvent): boolean => {
          return e.start.getTime() <= t && t <= e.end.getTime();
        },
      );
      return hit ? hit.title : null;
    };

    // Week 1 (user a): early Monday tail of the previous weekend + Fri->Mon.
    expect(covering("2026-01-05 07:00")).toBe("a");
    expect(covering("2026-01-07 12:00")).toBeNull();
    expect(covering("2026-01-09 17:59")).toBeNull();
    expect(covering("2026-01-09 19:00")).toBe("a");
    expect(covering("2026-01-11 12:00")).toBe("a");
    // Week 2 (user b).
    expect(covering("2026-01-12 12:00")).toBeNull();
    expect(covering("2026-01-16 19:00")).toBe("b");
    expect(covering("2026-01-18 23:00")).toBe("b");

    // No two events overlap.
    const sorted: Array<CalendarEvent> = [...events].sort(
      (x: CalendarEvent, y: CalendarEvent): number => {
        return x.start.getTime() - y.start.getTime();
      },
    );
    for (let i: number = 1; i < sorted.length; i++) {
      expect(sorted[i]!.start.getTime()).toBeGreaterThan(
        sorted[i - 1]!.end.getTime(),
      );
    }
  });
});

describe("LayerUtil restriction helpers", () => {
  test("trimStartAndEndTimesBasedOnRestrictionTimes passes the event through with no restriction", () => {
    const start: Date = at("2026-01-05 03:00");
    const end: Date = at("2026-01-06 03:00");
    expect(
      new LayerUtil().trimStartAndEndTimesBasedOnRestrictionTimes({
        eventStartTime: start,
        eventEndTime: end,
        restrictionTimes: noRestriction(),
      }),
    ).toEqual([{ startTime: start, endTime: end }]);
  });

  test("a Daily restriction type with no day window yields nothing", () => {
    const rt: RestrictionTimes = new RestrictionTimes();
    rt.restictionType = RestrictionType.Daily;
    rt.dayRestrictionTimes = null;

    expect(
      new LayerUtil().trimStartAndEndTimesBasedOnRestrictionTimes({
        eventStartTime: at("2026-01-05 00:00"),
        eventEndTime: at("2026-01-06 00:00"),
        restrictionTimes: rt,
      }),
    ).toEqual([]);
  });

  test("trimming does not mutate the caller's RestrictionTimes", () => {
    const rt: RestrictionTimes = dailyRestriction(
      "2026-01-01 09:00",
      "2026-01-01 17:00",
    );
    const before: StartAndEndTime = { ...rt.dayRestrictionTimes! };

    const util: LayerUtil = new LayerUtil();
    util.trimStartAndEndTimesBasedOnRestrictionTimes({
      eventStartTime: at("2026-03-05 00:00"),
      eventEndTime: at("2026-03-06 00:00"),
      restrictionTimes: rt,
    });

    expect(rt.dayRestrictionTimes!.startTime.getTime()).toBe(
      before.startTime.getTime(),
    );
    expect(rt.dayRestrictionTimes!.endTime.getTime()).toBe(
      before.endTime.getTime(),
    );
  });

  test("getEventsByDailyRestriction with a null window returns the event unchanged", () => {
    const start: Date = at("2026-01-05 00:00");
    const end: Date = at("2026-01-05 12:00");
    expect(
      new LayerUtil().getEventsByDailyRestriction({
        eventStartTime: start,
        eventEndTime: end,
        restrictionStartAndEndTime: null as unknown as StartAndEndTime,
        props: { intervalType: EventInterval.Day },
      }),
    ).toEqual([{ startTime: start, endTime: end }]);
  });

  test("getEventsByDailyRestriction emits nothing when the event ends before the window opens", () => {
    expect(
      new LayerUtil().getEventsByDailyRestriction({
        eventStartTime: at("2026-01-05 01:00"),
        eventEndTime: at("2026-01-05 08:00"),
        restrictionStartAndEndTime: {
          startTime: at("2026-01-05 09:00"),
          endTime: at("2026-01-05 17:00"),
        },
        props: { intervalType: EventInterval.Day },
      }),
    ).toEqual([]);
  });

  test("getEventsByDailyRestriction tiles a multi-day event day by day", () => {
    const util: LayerUtil = new LayerUtil();
    (util as unknown as { timezone: string }).timezone = UTC;

    const out: Array<StartAndEndTime> = util.getEventsByDailyRestriction({
      eventStartTime: at("2026-01-05 12:00"),
      eventEndTime: at("2026-01-07 10:00"),
      restrictionStartAndEndTime: {
        startTime: at("2026-01-05 09:00"),
        endTime: at("2026-01-05 17:00"),
      },
      props: { intervalType: EventInterval.Day },
    });

    expect(
      out.map((s: StartAndEndTime): Array<string> => {
        return [wall(s.startTime), wall(s.endTime)];
      }),
    ).toEqual([
      ["2026-01-05 12:00:00", "2026-01-05 17:00:00"],
      ["2026-01-06 09:00:00", "2026-01-06 17:00:00"],
      ["2026-01-07 09:00:00", "2026-01-07 10:00:00"],
    ]);
  });

  test("getEventsByWeeklyRestriction with no weekly windows returns the event unchanged", () => {
    const start: Date = at("2026-01-05 00:00");
    const end: Date = at("2026-01-12 00:00");
    expect(
      new LayerUtil().getEventsByWeeklyRestriction({
        eventStartTime: start,
        eventEndTime: end,
        restrictionTimes: weeklyRestriction([]),
      }),
    ).toEqual([{ startTime: start, endTime: end }]);
  });

  test("getEventsByWeeklyRestriction merges overlapping windows that share a start", () => {
    const util: LayerUtil = new LayerUtil();
    (util as unknown as { timezone: string }).timezone = UTC;

    const out: Array<StartAndEndTime> = util.getEventsByWeeklyRestriction({
      eventStartTime: at("2026-01-05 00:00"),
      eventEndTime: at("2026-01-12 00:00"),
      restrictionTimes: weeklyRestriction([
        {
          startDay: DayOfWeek.Tuesday,
          endDay: DayOfWeek.Tuesday,
          startTime: at("2026-01-06 09:00"),
          endTime: at("2026-01-06 12:00"),
        },
        {
          startDay: DayOfWeek.Tuesday,
          endDay: DayOfWeek.Tuesday,
          startTime: at("2026-01-06 09:00"),
          endTime: at("2026-01-06 17:00"),
        },
        {
          startDay: DayOfWeek.Thursday,
          endDay: DayOfWeek.Thursday,
          startTime: at("2026-01-08 10:00"),
          endTime: at("2026-01-08 11:00"),
        },
      ]),
    });

    expect(
      out.map((s: StartAndEndTime): Array<string> => {
        return [wall(s.startTime), wall(s.endTime)];
      }),
    ).toEqual([
      ["2026-01-06 09:00:00", "2026-01-06 17:00:00"],
      ["2026-01-08 10:00:00", "2026-01-08 11:00:00"],
    ]);
  });

  test("getWeeklyRestrictionTimesForWeek splits a wrap-around window into head and main segments", () => {
    const util: LayerUtil = new LayerUtil();
    (util as unknown as { timezone: string }).timezone = UTC;

    const out: Array<StartAndEndTime> = util.getWeeklyRestrictionTimesForWeek({
      eventStartTime: at("2026-01-07 12:00"), // Wednesday
      eventEndTime: at("2026-01-14 12:00"),
      restrictionTimes: weeklyRestriction([
        {
          startDay: DayOfWeek.Saturday,
          endDay: DayOfWeek.Monday,
          startTime: at("2026-01-03 00:00"),
          endTime: at("2026-01-05 06:00"),
        },
      ]),
    });

    expect(out.length).toBe(2);
    // head: from the start of the (Sunday-based) week to Monday 06:00
    expect(wall(out[0]!.startTime)).toBe("2026-01-04 00:00:00");
    expect(wall(out[0]!.endTime)).toBe("2026-01-05 06:00:00");
    // main: Saturday 00:00 through the following Monday 06:00
    expect(wall(out[1]!.startTime)).toBe("2026-01-10 00:00:00");
    expect(wall(out[1]!.endTime)).toBe("2026-01-12 06:00:00");
  });
});

describe("LayerUtil.getMultiLayerEvents", () => {
  test("a higher priority layer wins and events are stamped with priority and layer identity", () => {
    const events: Array<CalendarEvent> = new LayerUtil().getMultiLayerEvents({
      calendarStartDate: at("2026-01-05 00:00"),
      calendarEndDate: at("2026-01-06 00:00"),
      layers: [
        {
          layerId: "primary",
          layerName: "Business hours",
          users: [user("day")],
          startDateTimeOfLayer: at("2026-01-01 00:00"),
          handOffTime: at("2026-01-01 00:00"),
          restrictionTimes: dailyRestriction(
            "2026-01-01 09:00",
            "2026-01-01 17:00",
          ),
          rotation: rotation(EventInterval.Day, 1),
          timezone: UTC,
        },
        {
          users: [user("fallback")],
          startDateTimeOfLayer: at("2026-01-01 00:00"),
          handOffTime: at("2026-01-01 00:00"),
          restrictionTimes: noRestriction(),
          rotation: rotation(EventInterval.Day, 1),
          timezone: UTC,
        },
      ],
    });

    const shaped: Array<{
      user: string;
      priority: number;
      layerId: string | undefined;
      layerName: string | undefined;
      start: string;
      end: string;
    }> = (events as Array<PriorityCalendarEvents>).map(
      (e: PriorityCalendarEvents) => {
        return {
          user: e.title,
          priority: e.priority,
          layerId: e.layerId,
          layerName: e.layerName,
          start: wall(e.start),
          end: wall(e.end),
        };
      },
    );

    expect(shaped).toEqual([
      {
        user: "fallback",
        priority: 2,
        layerId: undefined,
        layerName: undefined,
        start: "2026-01-05 00:00:00",
        end: "2026-01-05 08:59:59",
      },
      {
        user: "day",
        priority: 1,
        layerId: "primary",
        layerName: "Business hours",
        start: "2026-01-05 09:00:00",
        end: "2026-01-05 17:00:00",
      },
      {
        user: "fallback",
        priority: 2,
        layerId: undefined,
        layerName: undefined,
        start: "2026-01-05 17:00:01",
        end: "2026-01-06 00:00:00",
      },
    ]);

    // Fallback events carry no layer identity keys at all.
    expect(Object.keys(events[0]!)).not.toContain("layerId");
  });

  test("getNumberOfEvents caps the merged result, not each layer", () => {
    const events: Array<CalendarEvent> = new LayerUtil().getMultiLayerEvents(
      {
        calendarStartDate: at("2026-01-05 00:00"),
        calendarEndDate: at("2026-01-10 00:00"),
        layers: [
          {
            users: [user("a"), user("b")],
            startDateTimeOfLayer: at("2026-01-05 00:00"),
            handOffTime: at("2026-01-05 00:00"),
            restrictionTimes: noRestriction(),
            rotation: rotation(EventInterval.Day, 1),
            timezone: UTC,
          },
        ],
      },
      { getNumberOfEvents: 2 },
    );

    expect(
      events.map((e: CalendarEvent): string => {
        return e.title;
      }),
    ).toEqual(["a", "b"]);
  });

  test("a layer with no users contributes nothing while other layers still resolve", () => {
    const result: LayerEventsResult =
      new LayerUtil().getMultiLayerEventsWithMeta({
        calendarStartDate: at("2026-01-05 00:00"),
        calendarEndDate: at("2026-01-06 00:00"),
        layers: [
          {
            users: [],
            startDateTimeOfLayer: at("2026-01-01 00:00"),
            handOffTime: at("2026-01-01 00:00"),
            restrictionTimes: noRestriction(),
            rotation: rotation(EventInterval.Day, 1),
            timezone: UTC,
          },
          {
            users: [user("b")],
            startDateTimeOfLayer: at("2026-01-01 00:00"),
            handOffTime: at("2026-01-01 00:00"),
            restrictionTimes: noRestriction(),
            rotation: rotation(EventInterval.Day, 1),
            timezone: UTC,
          },
        ],
      });

    expect(result.truncated).toBe(false);
    expect(result.events.length).toBe(1);
    expect(result.events[0]!.title).toBe("b");
    expect((result.events[0] as PriorityCalendarEvents).priority).toBe(2);
  });

  test("an empty layer list yields no events", () => {
    expect(
      new LayerUtil().getMultiLayerEvents({
        calendarStartDate: at("2026-01-05 00:00"),
        calendarEndDate: at("2026-01-06 00:00"),
        layers: [],
      }),
    ).toEqual([]);
  });
});
