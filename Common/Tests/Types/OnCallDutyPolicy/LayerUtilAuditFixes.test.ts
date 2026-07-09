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
import DayOfWeek from "../../../Types/Day/DayOfWeek";

/*
 * Regression tests for the on-call audit fixes:
 *   1. Daily/weekly restriction dropped coverage for every day after the first
 *      in a multi-day rotation period (getEventsByDailyRestriction case 2 used
 *      to terminate instead of advancing).
 *   2. Weekly wrap-around restriction emitted phantom all-day windows when the
 *      resolution window did not start on the ISO-week boundary.
 *   3. Multi-layer merge silently deleted a lower-priority (fallback) layer's
 *      coverage after two adjacent higher-priority windows.
 *
 * These assert observable on-call coverage (who is on call at a given instant),
 * which is what actually matters operationally.
 */

function user(id: string): User {
  return {
    id: {
      toString: () => {
        return id;
      },
    } as any,
  } as User;
}

function rotation(t: EventInterval, c: number): Recurring {
  return Recurring.fromJSON({
    _type: "Recurring",
    value: {
      intervalType: t,
      intervalCount: { _type: "PositiveNumber", value: c },
    },
  } as any);
}

function noRestriction(): RestrictionTimes {
  const r: RestrictionTimes = new RestrictionTimes();
  r.restictionType = RestrictionType.None;
  r.dayRestrictionTimes = null;
  return r;
}

function dailyRestriction(
  startHour: number,
  endHour: number,
): RestrictionTimes {
  const r: RestrictionTimes = new RestrictionTimes();
  r.restictionType = RestrictionType.Daily;
  r.dayRestrictionTimes = {
    startTime: OneUptimeDate.getDateWithCustomTime({
      hours: startHour,
      minutes: 0,
      seconds: 0,
    }),
    endTime: OneUptimeDate.getDateWithCustomTime({
      hours: endHour,
      minutes: 0,
      seconds: 0,
    }),
  };
  return r;
}

// Which user (event title) covers instant t? (start <= t < end). null if none.
function coveringUser(events: Array<CalendarEvent>, t: Date): string | null {
  for (const e of events) {
    if (e.start.getTime() <= t.getTime() && e.end.getTime() > t.getTime()) {
      return e.title;
    }
  }
  return null;
}

// Seconds in [rangeStart, rangeEnd] not covered by any event (tolerating 1s seams).
function uncoveredSeconds(
  events: Array<CalendarEvent>,
  rangeStart: Date,
  rangeEnd: Date,
): number {
  const sorted: Array<CalendarEvent> = [...events].sort(
    (a: CalendarEvent, b: CalendarEvent) => {
      return a.start.getTime() - b.start.getTime();
    },
  );
  let uncovered: number = 0;
  let cursor: number = rangeStart.getTime();
  for (const e of sorted) {
    if (e.start.getTime() > cursor + 1000) {
      uncovered += e.start.getTime() - cursor;
    }
    cursor = Math.max(cursor, e.end.getTime());
  }
  if (rangeEnd.getTime() > cursor + 1000) {
    uncovered += rangeEnd.getTime() - cursor;
  }
  return Math.round(uncovered / 1000);
}

describe("LayerUtil audit fixes", () => {
  describe("Fix 1: daily restriction keeps coverage every day of a multi-day rotation", () => {
    test("weekly rotation + daily 09:00-17:00 + handoff at/after 09:00", () => {
      const layerUtil: LayerUtil = new LayerUtil();
      const layerStart: Date = new Date(2026, 0, 5, 0, 0, 0); // Mon Jan 5 2026
      const events: Array<CalendarEvent> = layerUtil.getEvents({
        users: [user("A"), user("B")],
        startDateTimeOfLayer: layerStart,
        restrictionTimes: dailyRestriction(9, 17),
        handOffTime: new Date(2026, 0, 5, 10, 0, 0), // 10:00 (after restriction start)
        rotation: rotation(EventInterval.Week, 1),
        calendarStartDate: layerStart,
        calendarEndDate: new Date(2026, 0, 19, 0, 0, 0),
      });

      /*
       * Week 1 (B is on call after the 10:00 handoff on Jan 5): every day Jan 6-11
       * must be covered by B during the 09-17 window (the bug left these empty).
       */
      for (let day: number = 6; day <= 11; day++) {
        expect(coveringUser(events, new Date(2026, 0, day, 11, 0, 0))).toBe(
          "B",
        );
      }
      // Week 2 (A): every day Jan 13-18 covered by A during the window.
      for (let day: number = 13; day <= 18; day++) {
        expect(coveringUser(events, new Date(2026, 0, day, 11, 0, 0))).toBe(
          "A",
        );
      }
      // Outside the restriction window: nobody on call.
      expect(coveringUser(events, new Date(2026, 0, 7, 3, 0, 0))).toBeNull();
      expect(coveringUser(events, new Date(2026, 0, 7, 20, 0, 0))).toBeNull();
    });

    test("Day x2 rotation + daily 09:00-17:00 + noon handoff covers in-between days", () => {
      const layerUtil: LayerUtil = new LayerUtil();
      const layerStart: Date = new Date(2026, 0, 5, 0, 0, 0);
      const events: Array<CalendarEvent> = layerUtil.getEvents({
        users: [user("A"), user("B")],
        startDateTimeOfLayer: layerStart,
        restrictionTimes: dailyRestriction(9, 17),
        handOffTime: new Date(2026, 0, 5, 12, 0, 0),
        rotation: rotation(EventInterval.Day, 2),
        calendarStartDate: layerStart,
        calendarEndDate: new Date(2026, 0, 13, 0, 0, 0),
      });
      // Jan 6 is the "second day" of B's 2-day period and used to be uncovered.
      expect(coveringUser(events, new Date(2026, 0, 6, 11, 0, 0))).toBe("B");
      // Jan 8 is the second day of A's next 2-day period.
      expect(coveringUser(events, new Date(2026, 0, 8, 11, 0, 0))).toBe("A");
    });
  });

  describe("Fix 2: weekly wrap-around restriction has no phantom coverage", () => {
    const weekend: WeeklyResctriction = {
      startDay: DayOfWeek.Friday,
      endDay: DayOfWeek.Monday,
      startTime: new Date(2026, 0, 2, 20, 0, 0), // Fri 20:00
      endTime: new Date(2026, 0, 5, 8, 0, 0), // Mon 08:00
    };

    function weekendRestriction(): RestrictionTimes {
      const r: RestrictionTimes = new RestrictionTimes();
      r.restictionType = RestrictionType.Weekly;
      r.weeklyRestrictionTimes = [weekend];
      return r;
    }

    test("resolved mid-week (Wed): excluded weekdays have NO coverage", () => {
      const layerUtil: LayerUtil = new LayerUtil();
      const events: Array<CalendarEvent> = layerUtil.getEvents({
        users: [user("A")],
        startDateTimeOfLayer: new Date(2026, 0, 1, 0, 0, 0),
        restrictionTimes: weekendRestriction(),
        handOffTime: new Date(2026, 0, 1, 0, 0, 0),
        rotation: rotation(EventInterval.Week, 1),
        calendarStartDate: new Date(2026, 0, 7, 0, 0, 0), // Wed Jan 7 (NOT week-aligned)
        calendarEndDate: new Date(2026, 0, 13, 0, 0, 0),
      });
      // Weekday daytime is OUTSIDE the Fri20:00->Mon08:00 window: nobody on call.
      expect(coveringUser(events, new Date(2026, 0, 7, 14, 30, 0))).toBeNull(); // Wed
      expect(coveringUser(events, new Date(2026, 0, 8, 10, 0, 0))).toBeNull(); // Thu
      expect(coveringUser(events, new Date(2026, 0, 9, 12, 0, 0))).toBeNull(); // Fri noon
      // Inside the weekend window: A is on call.
      expect(coveringUser(events, new Date(2026, 0, 9, 22, 0, 0))).toBe("A"); // Fri 22:00
      expect(coveringUser(events, new Date(2026, 0, 10, 12, 0, 0))).toBe("A"); // Sat
      expect(coveringUser(events, new Date(2026, 0, 11, 12, 0, 0))).toBe("A"); // Sun
      expect(coveringUser(events, new Date(2026, 0, 12, 7, 0, 0))).toBe("A"); // Mon 07:00
      expect(coveringUser(events, new Date(2026, 0, 12, 9, 0, 0))).toBeNull(); // Mon 09:00 (after handoff)
    });

    test("live 1-second window mid-week returns nobody during excluded hours", () => {
      const layerUtil: LayerUtil = new LayerUtil();
      const resolveAt: (now: Date) => string | null = (
        now: Date,
      ): string | null => {
        const events: Array<CalendarEvent> = layerUtil.getMultiLayerEvents(
          {
            layers: [
              {
                users: [user("A")],
                startDateTimeOfLayer: new Date(2026, 0, 1, 0, 0, 0),
                restrictionTimes: weekendRestriction(),
                handOffTime: new Date(2026, 0, 1, 0, 0, 0),
                rotation: rotation(EventInterval.Week, 1),
              },
            ],
            calendarStartDate: now,
            calendarEndDate: OneUptimeDate.addRemoveSeconds(now, 1),
          },
          { getNumberOfEvents: 1 },
        );
        return events[0]?.title ?? null;
      };
      expect(resolveAt(new Date(2026, 0, 7, 14, 30, 0))).toBeNull(); // Wed excluded
      expect(resolveAt(new Date(2026, 0, 8, 10, 0, 0))).toBeNull(); // Thu excluded
      expect(resolveAt(new Date(2026, 0, 10, 22, 0, 0))).toBe("A"); // Sat included
    });

    test("resolved on the week boundary (Mon) still correct (no regression)", () => {
      const layerUtil: LayerUtil = new LayerUtil();
      const events: Array<CalendarEvent> = layerUtil.getEvents({
        users: [user("A")],
        startDateTimeOfLayer: new Date(2026, 0, 1, 0, 0, 0),
        restrictionTimes: weekendRestriction(),
        handOffTime: new Date(2026, 0, 1, 0, 0, 0),
        rotation: rotation(EventInterval.Week, 1),
        calendarStartDate: new Date(2026, 0, 5, 0, 0, 0), // Mon Jan 5
        calendarEndDate: new Date(2026, 0, 13, 0, 0, 0),
      });
      expect(coveringUser(events, new Date(2026, 0, 5, 7, 0, 0))).toBe("A"); // Mon 07:00 (tail of prior weekend)
      expect(coveringUser(events, new Date(2026, 0, 7, 12, 0, 0))).toBeNull(); // Wed excluded
      expect(coveringUser(events, new Date(2026, 0, 10, 12, 0, 0))).toBe("A"); // Sat included
    });
  });

  describe("Fix 3: multi-layer fallback coverage survives adjacent higher-priority windows", () => {
    test("24/7 fallback under a primary that emits two back-to-back windows", () => {
      const layerUtil: LayerUtil = new LayerUtil();
      const calStart: Date = new Date(2026, 2, 2, 0, 0, 0);
      const calEnd: Date = new Date(2026, 2, 4, 0, 0, 0);

      /*
       * Primary: A/B hourly rotation restricted to 10:00-12:00, handoff at 11:00
       * -> emits two adjacent windows per day: A[10:00-11:00], B[11:00:01-12:00].
       */
      const primary: LayerProps = {
        users: [user("A"), user("B")],
        startDateTimeOfLayer: calStart,
        restrictionTimes: dailyRestriction(10, 12),
        handOffTime: new Date(2026, 2, 2, 11, 0, 0),
        rotation: rotation(EventInterval.Hour, 1),
      };
      // Fallback: C on call 24/7.
      const fallback: LayerProps = {
        users: [user("C")],
        startDateTimeOfLayer: calStart,
        restrictionTimes: noRestriction(),
        handOffTime: new Date(2026, 2, 2, 0, 0, 0),
        rotation: rotation(EventInterval.Week, 1),
      };

      const events: Array<CalendarEvent> = layerUtil.getMultiLayerEvents({
        layers: [primary, fallback],
        calendarStartDate: calStart,
        calendarEndDate: calEnd,
      });

      // No uncovered time anywhere in the window (fallback fills every gap).
      expect(uncoveredSeconds(events, calStart, calEnd)).toBe(0);

      // Primary owns 10:00-12:00; fallback C owns everything else.
      expect(coveringUser(events, new Date(2026, 2, 2, 10, 30, 0))).toBe("A");
      expect(coveringUser(events, new Date(2026, 2, 2, 11, 30, 0))).toBe("B");
      expect(coveringUser(events, new Date(2026, 2, 2, 15, 0, 0))).toBe("C"); // afternoon
      expect(coveringUser(events, new Date(2026, 2, 3, 3, 0, 0))).toBe("C"); // overnight
      expect(coveringUser(events, new Date(2026, 2, 3, 8, 0, 0))).toBe("C"); // next morning
      expect(coveringUser(events, new Date(2026, 2, 3, 10, 30, 0))).toBe("A"); // next day primary
    });
  });
});
