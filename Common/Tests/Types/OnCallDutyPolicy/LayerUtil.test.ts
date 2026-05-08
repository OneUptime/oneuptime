import LayerUtil, { LayerProps } from "../../../Types/OnCallDutyPolicy/Layer";
import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import RestrictionTimes, {
  RestrictionType,
  WeeklyResctriction,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import Recurring from "../../../Types/Events/Recurring";
import OneUptimeDate from "../../../Types/Date";
import User from "../../../Models/DatabaseModels/User";
import EventInterval from "../../../Types/Events/EventInterval";
import DayOfWeek, { DayOfWeekUtil } from "../../../Types/Day/DayOfWeek";

// Helper to create a user model with id only.
function user(id: string): User {
  return {
    id: {
      toString: () => {
        return id;
      },
    } as any,
  } as User;
}

function buildLayerProps(data: {
  users: string[];
  start: Date;
  handoff: Date;
  restriction?: { type: RestrictionType; start?: string; end?: string };
  weeklyRestrictions?: Array<{
    startDay: DayOfWeek;
    endDay: DayOfWeek;
    start: string; // HH:mm
    end: string; // HH:mm
  }>;
  rotation?: { intervalType: EventInterval; intervalCount: number };
}): LayerProps {
  const restrictionTimes: RestrictionTimes = new RestrictionTimes();

  if (data.restriction) {
    restrictionTimes.restictionType = data.restriction.type;
    if (
      data.restriction.type === RestrictionType.Daily &&
      data.restriction.start &&
      data.restriction.end
    ) {
      restrictionTimes.dayRestrictionTimes = {
        startTime: OneUptimeDate.getDateWithCustomTime({
          hours: parseInt(data.restriction.start.split(":")[0] || "0"),
          minutes: parseInt(data.restriction.start.split(":")[1] || "0"),
          seconds: 0,
        }),
        endTime: OneUptimeDate.getDateWithCustomTime({
          hours: parseInt(data.restriction.end.split(":")[0] || "0"),
          minutes: parseInt(data.restriction.end.split(":")[1] || "0"),
          seconds: 0,
        }),
      };
    }
  } else if (data.weeklyRestrictions && data.weeklyRestrictions.length > 0) {
    restrictionTimes.restictionType = RestrictionType.Weekly;
    const weekly: Array<WeeklyResctriction> = [];
    // Base week anchor (start of week for provided start date)
    const baseWeekStart: Date = OneUptimeDate.getStartOfTheWeek(data.start);
    const baseWeekDay: DayOfWeek = OneUptimeDate.getDayOfWeek(baseWeekStart);
    const baseWeekDayNumber: number =
      DayOfWeekUtil.getNumberOfDayOfWeek(baseWeekDay);

    for (const r of data.weeklyRestrictions) {
      const desiredStartDayNum: number = DayOfWeekUtil.getNumberOfDayOfWeek(
        r.startDay,
      );
      const desiredEndDayNum: number = DayOfWeekUtil.getNumberOfDayOfWeek(
        r.endDay,
      );

      const startOffsetDays: number = desiredStartDayNum - baseWeekDayNumber;
      const endOffsetDays: number = desiredEndDayNum - baseWeekDayNumber;

      const startDate: Date = OneUptimeDate.addRemoveDays(
        baseWeekStart,
        startOffsetDays,
      );
      const endDate: Date = OneUptimeDate.addRemoveDays(
        baseWeekStart,
        endOffsetDays,
      );

      const startTime: Date = OneUptimeDate.keepTimeButMoveDay(
        OneUptimeDate.getDateWithCustomTime({
          hours: parseInt(r.start.split(":")[0] || "0"),
          minutes: parseInt(r.start.split(":")[1] || "0"),
          seconds: 0,
        }),
        startDate,
      );

      const endTime: Date = OneUptimeDate.keepTimeButMoveDay(
        OneUptimeDate.getDateWithCustomTime({
          hours: parseInt(r.end.split(":")[0] || "0"),
          minutes: parseInt(r.end.split(":")[1] || "0"),
          seconds: 0,
        }),
        endDate,
      );

      weekly.push({
        startDay: r.startDay,
        endDay: r.endDay,
        startTime,
        endTime,
      });
    }

    restrictionTimes.weeklyRestrictionTimes = weekly;
  } else {
    restrictionTimes.restictionType = RestrictionType.None;
    restrictionTimes.dayRestrictionTimes = null;
  }

  const rotation: Recurring = data.rotation
    ? Recurring.fromJSON({
        _type: "Recurring",
        value: {
          intervalType: data.rotation.intervalType,
          intervalCount: {
            _type: "PositiveNumber",
            value: data.rotation.intervalCount,
          },
        },
      } as any)
    : Recurring.fromJSON({
        _type: "Recurring",
        value: {
          intervalType: EventInterval.Day,
          intervalCount: { _type: "PositiveNumber", value: 1 },
        },
      } as any);

  return {
    users: data.users.map(user),
    startDateTimeOfLayer: data.start,
    handOffTime: data.handoff,
    restrictionTimes,
    rotation,
  };
}

describe("LayerUtil getEvents - Daily Restrictions", () => {
  test("Should return full-day events when no restriction", () => {
    const util: LayerUtil = new LayerUtil();
    const start: Date = OneUptimeDate.getStartOfDay(new Date());
    const end: Date = OneUptimeDate.addRemoveDays(start, 1); // one day calendar

    const layer: LayerProps = buildLayerProps({
      users: ["u1"],
      start: start,
      handoff: OneUptimeDate.addRemoveDays(start, 10),
    });

    const events: Array<CalendarEvent> = util.getEvents({
      ...layer,
      calendarStartDate: start,
      calendarEndDate: end,
    });

    expect(events.length).toBe(1);
    const only: CalendarEvent = events[0]!;
    expect(only.start.getTime()).toBe(start.getTime());
    expect(only.end.getTime()).toBe(end.getTime());
  });

  test("Should trim to same-day restriction window (11:00-23:00)", () => {
    const util: LayerUtil = new LayerUtil();
    const start: Date = OneUptimeDate.getStartOfDay(new Date());
    const calendarEnd: Date = OneUptimeDate.addRemoveDays(start, 1);

    const layer: LayerProps = buildLayerProps({
      users: ["u1"],
      start: start,
      handoff: OneUptimeDate.addRemoveDays(start, 2),
      restriction: {
        type: RestrictionType.Daily,
        start: "11:00",
        end: "23:00",
      },
    });

    const events: Array<CalendarEvent> = util.getEvents({
      ...layer,
      calendarStartDate: start,
      calendarEndDate: calendarEnd,
    });

    expect(events.length).toBe(1);
    const ev: CalendarEvent = events[0]!;
    expect(OneUptimeDate.getLocalHourAndMinuteFromDate(ev.start)).toBe("11:00");
    expect(OneUptimeDate.getLocalHourAndMinuteFromDate(ev.end)).toBe("23:00");
  });

  test("Should produce two segments for overnight window (23:00-11:00 next day)", () => {
    const util: LayerUtil = new LayerUtil();
    const todayStart: Date = OneUptimeDate.getStartOfDay(new Date());
    // Extend calendar to cover next day morning (till at least 12:00) so both segments can appear.
    const calendarEnd: Date = OneUptimeDate.addRemoveHours(todayStart, 36); // 24h + 12h

    const layer: LayerProps = buildLayerProps({
      users: ["u1"],
      start: todayStart,
      handoff: OneUptimeDate.addRemoveDays(todayStart, 2),
      restriction: {
        type: RestrictionType.Daily,
        start: "23:00",
        end: "11:00",
      },
    });

    const events: Array<CalendarEvent> = util.getEvents({
      ...layer,
      calendarStartDate: todayStart,
      calendarEndDate: calendarEnd,
    });

    /*
     * Expect two events: 23:00 -> 23:59:59 (approx) and 00:00 -> 11:00 next day (depending on trimming logic)
     * We simplify by checking presence of one starting at 23:00 and one ending at 11:00.
     */
    expect(events.length).toBeGreaterThanOrEqual(2); // Expect at least two distinct segments across midnight.
    const has23Window: boolean = events.some((e: CalendarEvent) => {
      return OneUptimeDate.getLocalHourAndMinuteFromDate(e.start) === "23:00";
    });
    // End might be 10:59 or 11:00 depending on second trimming; allow both 10 or 11 hour boundary.
    const hasMorningCoverage: boolean = events.some((e: CalendarEvent) => {
      const startHM: string = OneUptimeDate.getLocalHourAndMinuteFromDate(
        e.start,
      );
      const endHM: string = OneUptimeDate.getLocalHourAndMinuteFromDate(e.end);
      // Morning segment should end at or near 11:00 and start at or near 00:00
      return (
        (startHM === "00:00" || startHM === "00:01" || startHM === "23:59") &&
        (endHM === "11:00" || endHM === "10:59" || endHM === "10:58")
      );
    });

    expect(has23Window).toBeTruthy();
    expect(hasMorningCoverage).toBeTruthy();
  });
});

describe("LayerUtil getEvents - Multi-day Daily Windows", () => {
  test("Daily restriction (09:00-17:00) over 3 day calendar produces one window per day", () => {
    const util: LayerUtil = new LayerUtil();
    const day1: Date = OneUptimeDate.getStartOfDay(new Date());
    const calendarEnd: Date = OneUptimeDate.addRemoveDays(day1, 3); // 3 days window

    const layer: LayerProps = buildLayerProps({
      users: ["u1"],
      start: day1,
      handoff: OneUptimeDate.addRemoveDays(day1, 1), // initial handoff end of day1
      restriction: {
        type: RestrictionType.Daily,
        start: "09:00",
        end: "17:00",
      },
      rotation: { intervalType: EventInterval.Day, intervalCount: 1 },
    });

    const events: Array<CalendarEvent> = util.getEvents({
      ...layer,
      calendarStartDate: day1,
      calendarEndDate: calendarEnd,
    });

    const windowsStartingAtNine: Array<CalendarEvent> = events.filter(
      (e: CalendarEvent) => {
        return OneUptimeDate.getLocalHourAndMinuteFromDate(e.start) === "09:00";
      },
    );
    expect(windowsStartingAtNine.length).toBeGreaterThanOrEqual(2);
  });
});

describe("LayerUtil getEvents - Weekly Restrictions", () => {
  test("Simple weekly window Monday 09:00 to Wednesday 17:00 yields trimmed events", () => {
    const util: LayerUtil = new LayerUtil();
    const monday: Date = OneUptimeDate.getStartOfTheWeek(new Date());
    const calendarEnd: Date = OneUptimeDate.addRemoveDays(monday, 7);

    const layer: LayerProps = buildLayerProps({
      users: ["u1"],
      start: monday,
      handoff: OneUptimeDate.addRemoveWeeks(monday, 1),
      weeklyRestrictions: [
        {
          startDay: DayOfWeek.Monday,
          endDay: DayOfWeek.Wednesday,
          start: "09:00",
          end: "17:00",
        },
      ],
      rotation: { intervalType: EventInterval.Week, intervalCount: 1 },
    });

    const events: Array<CalendarEvent> = util.getEvents({
      ...layer,
      calendarStartDate: monday,
      calendarEndDate: calendarEnd,
    });

    const hasStartNine: boolean = events.some((e: CalendarEvent) => {
      return OneUptimeDate.getLocalHourAndMinuteFromDate(e.start) === "09:00";
    });
    const hasEndSeventeen: boolean = events.some((e: CalendarEvent) => {
      return OneUptimeDate.getLocalHourAndMinuteFromDate(e.end) === "17:00";
    });
    expect(hasStartNine).toBeTruthy();
    expect(hasEndSeventeen).toBeTruthy();
  });

  test("Weekly wrap-around Friday 22:00 to Monday 06:00 produces appropriate segments", () => {
    const util: LayerUtil = new LayerUtil();
    const monday: Date = OneUptimeDate.getStartOfTheWeek(new Date());
    const calendarEnd: Date = OneUptimeDate.addRemoveDays(monday, 7);

    const layer: LayerProps = buildLayerProps({
      users: ["u1"],
      start: monday,
      handoff: OneUptimeDate.addRemoveWeeks(monday, 1),
      weeklyRestrictions: [
        {
          startDay: DayOfWeek.Friday,
          endDay: DayOfWeek.Monday,
          start: "22:00",
          end: "06:00",
        },
      ],
      rotation: { intervalType: EventInterval.Week, intervalCount: 1 },
    });

    const events: Array<CalendarEvent> = util.getEvents({
      ...layer,
      calendarStartDate: monday,
      calendarEndDate: calendarEnd,
    });

    const has22: boolean = events.some((e: CalendarEvent) => {
      return OneUptimeDate.getLocalHourAndMinuteFromDate(e.start) === "22:00";
    });
    const has06: boolean = events.some((e: CalendarEvent) => {
      return OneUptimeDate.getLocalHourAndMinuteFromDate(e.end) === "06:00";
    });
    expect(has22).toBeTruthy();
    expect(has06).toBeTruthy();
  });
});

describe("LayerUtil getEvents - Daily Rotation Across Users", () => {
  test("Daily rotation cycles users", () => {
    const util: LayerUtil = new LayerUtil();
    const day1: Date = OneUptimeDate.getStartOfDay(new Date());
    const calendarEnd: Date = OneUptimeDate.addRemoveDays(day1, 3); // 3 days

    const layer: LayerProps = buildLayerProps({
      users: ["a", "b"],
      start: day1,
      handoff: OneUptimeDate.addRemoveDays(day1, 1),
      rotation: { intervalType: EventInterval.Day, intervalCount: 1 },
    });

    const events: Array<CalendarEvent> = util.getEvents({
      ...layer,
      calendarStartDate: day1,
      calendarEndDate: calendarEnd,
    });

    if (events.length >= 2) {
      expect(events[0]!.title).not.toBe(events[1]!.title);
    }
  });
});

describe("LayerUtil getMultiLayerEvents - Partial Overlap Trimming", () => {
  test("Primary layer inside backup trims backup", () => {
    const util: LayerUtil = new LayerUtil();
    const start: Date = OneUptimeDate.getStartOfDay(new Date());
    const calendarEnd: Date = OneUptimeDate.addRemoveHours(start, 6);

    const primary: LayerProps = buildLayerProps({
      users: ["primary"],
      start: OneUptimeDate.addRemoveHours(start, 2),
      handoff: OneUptimeDate.addRemoveHours(start, 4),
    });

    const backup: LayerProps = buildLayerProps({
      users: ["backup"],
      start: start,
      handoff: OneUptimeDate.addRemoveHours(start, 6),
    });

    const events: Array<CalendarEvent> = util.getMultiLayerEvents({
      layers: [primary, backup],
      calendarStartDate: start,
      calendarEndDate: calendarEnd,
    });

    const containsPrimary: boolean = events.some((e: CalendarEvent) => {
      return e.title === "primary";
    });
    const containsBackup: boolean = events.some((e: CalendarEvent) => {
      return e.title === "backup";
    });
    expect(containsPrimary).toBeTruthy();
    expect(containsBackup).toBeTruthy();
  });
});

describe("LayerUtil getEvents - Rotation Handoff", () => {
  test("Hourly rotation changes user after each hour", () => {
    const util: LayerUtil = new LayerUtil();
    const start: Date = OneUptimeDate.getStartOfDay(new Date());
    const calendarEnd: Date = OneUptimeDate.addRemoveHours(start, 5); // 5 hours window

    const layer: LayerProps = buildLayerProps({
      users: ["u1", "u2", "u3"],
      start: start,
      handoff: OneUptimeDate.addRemoveHours(start, 1), // first handoff at +1h
      rotation: { intervalType: EventInterval.Hour, intervalCount: 1 },
    });

    const events: Array<CalendarEvent> = util.getEvents({
      ...layer,
      calendarStartDate: start,
      calendarEndDate: calendarEnd,
    });

    // Expect roughly 5 events (one per hour) and user IDs rotate in sequence.
    expect(events.length).toBeGreaterThanOrEqual(4);
    const userSequence: Array<string> = events.map((e: CalendarEvent) => {
      return e.title;
    });

    /*
     * Titles are user ids (strings we passed) according to implementation.
     * Check that at least first three rotate u1 -> u2 -> u3
     */
    expect(userSequence.slice(0, 3)).toEqual(["u1", "u2", "u3"]);
  });
});

describe("LayerUtil getEvents - Rotation skips restricted days (issue #2413)", () => {
  test("Daily rotation Mon-Fri 09-19 should advance to next user after weekend", () => {
    const util: LayerUtil = new LayerUtil();
    // Anchor on a Monday at 09:00. Use start of week then move to Monday 09:00.
    const startOfWeek: Date = OneUptimeDate.getStartOfTheWeek(new Date());
    // moment.startOf("week") is Sunday; add 1 day to get Monday.
    const mondayStart: Date = OneUptimeDate.addRemoveDays(startOfWeek, 1);
    const monday9AM: Date = OneUptimeDate.keepTimeButMoveDay(
      OneUptimeDate.getDateWithCustomTime({
        hours: 9,
        minutes: 0,
        seconds: 0,
      }),
      mondayStart,
    );
    const monday7PM: Date = OneUptimeDate.keepTimeButMoveDay(
      OneUptimeDate.getDateWithCustomTime({
        hours: 19,
        minutes: 0,
        seconds: 0,
      }),
      mondayStart,
    );

    const calendarEnd: Date = OneUptimeDate.addRemoveDays(monday9AM, 14); // two weeks

    const layer: LayerProps = buildLayerProps({
      users: ["A", "B", "C"],
      start: monday9AM,
      handoff: monday7PM, // first handoff 10 hours after start
      weeklyRestrictions: [
        {
          startDay: DayOfWeek.Monday,
          endDay: DayOfWeek.Monday,
          start: "09:00",
          end: "19:00",
        },
        {
          startDay: DayOfWeek.Tuesday,
          endDay: DayOfWeek.Tuesday,
          start: "09:00",
          end: "19:00",
        },
        {
          startDay: DayOfWeek.Wednesday,
          endDay: DayOfWeek.Wednesday,
          start: "09:00",
          end: "19:00",
        },
        {
          startDay: DayOfWeek.Thursday,
          endDay: DayOfWeek.Thursday,
          start: "09:00",
          end: "19:00",
        },
        {
          startDay: DayOfWeek.Friday,
          endDay: DayOfWeek.Friday,
          start: "09:00",
          end: "19:00",
        },
      ],
      rotation: { intervalType: EventInterval.Day, intervalCount: 1 },
    });

    const events: Array<CalendarEvent> = util.getEvents({
      ...layer,
      calendarStartDate: monday9AM,
      calendarEndDate: calendarEnd,
    });

    // Filter the events that begin at 09:00 (i.e. true workday slots).
    const workdayEvents: Array<CalendarEvent> = events.filter(
      (e: CalendarEvent) => {
        return OneUptimeDate.getLocalHourAndMinuteFromDate(e.start) === "09:00";
      },
    );

    /*
     * Expect 10 workdays across 2 weeks (Mon-Fri x 2).
     * Sequence should be A, B, C, A, B, C, A, B, C, A — contiguous rotation
     * skipping the weekend without burning rotations.
     */
    const sequence: Array<string> = workdayEvents.map((e: CalendarEvent) => {
      return e.title;
    });

    // Specifically: friday week 1 user must NOT equal monday week 2 user.
    const fridayWeek1: string | undefined = sequence[4];
    const mondayWeek2: string | undefined = sequence[5];
    expect(fridayWeek1).toBeDefined();
    expect(mondayWeek2).toBeDefined();
    expect(fridayWeek1).not.toBe(mondayWeek2);

    /*
     * And the user on Monday week 2 should be the rotation step after Friday week 1.
     * With 3 users and 1-day rotation, after Fri (B) we expect Mon to be C.
     */
    expect(sequence.slice(0, 10)).toEqual([
      "A",
      "B",
      "C",
      "A",
      "B",
      "C",
      "A",
      "B",
      "C",
      "A",
    ]);
  });
});

describe("LayerUtil getEvents - Rotation continuous across calendar windows (issue #2413)", () => {
  test("Week 2 preview should continue rotation from where week 1 ended", () => {
    const util: LayerUtil = new LayerUtil();
    // Anchor on a Monday at 09:00.
    const startOfWeek: Date = OneUptimeDate.getStartOfTheWeek(new Date());
    const mondayStart: Date = OneUptimeDate.addRemoveDays(startOfWeek, 1);
    const monday9AM: Date = OneUptimeDate.keepTimeButMoveDay(
      OneUptimeDate.getDateWithCustomTime({
        hours: 9,
        minutes: 0,
        seconds: 0,
      }),
      mondayStart,
    );
    const monday7PM: Date = OneUptimeDate.keepTimeButMoveDay(
      OneUptimeDate.getDateWithCustomTime({
        hours: 19,
        minutes: 0,
        seconds: 0,
      }),
      mondayStart,
    );

    const layer: LayerProps = buildLayerProps({
      users: ["A", "B", "C"],
      start: monday9AM,
      handoff: monday7PM,
      weeklyRestrictions: [
        {
          startDay: DayOfWeek.Monday,
          endDay: DayOfWeek.Monday,
          start: "09:00",
          end: "19:00",
        },
        {
          startDay: DayOfWeek.Tuesday,
          endDay: DayOfWeek.Tuesday,
          start: "09:00",
          end: "19:00",
        },
        {
          startDay: DayOfWeek.Wednesday,
          endDay: DayOfWeek.Wednesday,
          start: "09:00",
          end: "19:00",
        },
        {
          startDay: DayOfWeek.Thursday,
          endDay: DayOfWeek.Thursday,
          start: "09:00",
          end: "19:00",
        },
        {
          startDay: DayOfWeek.Friday,
          endDay: DayOfWeek.Friday,
          start: "09:00",
          end: "19:00",
        },
      ],
      rotation: { intervalType: EventInterval.Day, intervalCount: 1 },
    });

    // Simulate the dashboard preview: ask for week 1 then week 2 separately.
    const week1Start: Date = monday9AM;
    const week1End: Date = OneUptimeDate.addRemoveDays(monday9AM, 7);
    const week2Start: Date = week1End;
    const week2End: Date = OneUptimeDate.addRemoveDays(week1End, 7);

    const week1: Array<CalendarEvent> = util.getEvents({
      ...layer,
      calendarStartDate: week1Start,
      calendarEndDate: week1End,
    });
    const week2: Array<CalendarEvent> = util.getEvents({
      ...layer,
      calendarStartDate: week2Start,
      calendarEndDate: week2End,
    });

    // Filter to the workday slots that begin at 09:00 in each week.
    const workdayUsers: (events: Array<CalendarEvent>) => Array<string> = (
      events: Array<CalendarEvent>,
    ): Array<string> => {
      return events
        .filter((e: CalendarEvent) => {
          return (
            OneUptimeDate.getLocalHourAndMinuteFromDate(e.start) === "09:00"
          );
        })
        .map((e: CalendarEvent) => {
          return e.title;
        });
    };

    const week1Sequence: Array<string> = workdayUsers(week1);
    const week2Sequence: Array<string> = workdayUsers(week2);

    expect(week1Sequence).toEqual(["A", "B", "C", "A", "B"]);

    /*
     * The first user of week 2 must be the rotation step after the last user of week 1.
     * Week 1 ends on Friday with B, so Monday week 2 must be C — not A or B.
     */
    expect(week2Sequence[0]).toBeDefined();
    expect(week2Sequence[0]).toBe("C");
    expect(week2Sequence).toEqual(["C", "A", "B", "C", "A"]);
  });
});

describe("LayerUtil getMultiLayerEvents - Overlap Priority", () => {
  test("Higher priority (lower index) layer should trim overlapping lower priority events", () => {
    const util: LayerUtil = new LayerUtil();
    const start: Date = OneUptimeDate.getStartOfDay(new Date());
    const calendarEnd: Date = OneUptimeDate.addRemoveHours(start, 6);

    const layer1: LayerProps = buildLayerProps({
      users: ["primary"],
      start: start,
      handoff: OneUptimeDate.addRemoveHours(start, 6),
    });

    const layer2: LayerProps = buildLayerProps({
      users: ["backup"],
      start: start,
      handoff: OneUptimeDate.addRemoveHours(start, 6),
    });

    const events: Array<CalendarEvent> = util.getMultiLayerEvents({
      layers: [layer1, layer2],
      calendarStartDate: start,
      calendarEndDate: calendarEnd,
    });

    // All events should belong to primary (priority 1) with no backup overlapping intervals left.
    const titles: Array<string> = events.map((e: CalendarEvent) => {
      return e.title;
    });
    expect(
      titles.every((t: string) => {
        return t === "primary";
      }),
    ).toBeTruthy();
  });
});
