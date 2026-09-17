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
 * Regression tests for the on-call audit fixes (round 2): F0, F2, F3, F4, F5, F8.
 * Layer props set an explicit `timezone` so date math is independent of the
 * machine's local timezone.
 */

function u(id: string): User {
  return {
    id: {
      toString: () => {
        return id;
      },
    },
  } as unknown as User;
}

function d(iso: string): Date {
  return OneUptimeDate.fromString(iso);
}

function rot(intervalType: EventInterval, count: number): Recurring {
  return Recurring.fromJSON({
    _type: "Recurring",
    value: {
      intervalType: intervalType,
      intervalCount: { _type: "PositiveNumber", value: count },
    },
  } as any);
}

function noRestriction(): RestrictionTimes {
  const r: RestrictionTimes = new RestrictionTimes();
  r.restictionType = RestrictionType.None;
  r.dayRestrictionTimes = null;
  return r;
}

/*
 * Daily restriction whose From/To are given as absolute instants (so their
 * wall-clock is unambiguous under the layer's timezone).
 */
function dailyRestrictionFromInstants(
  startInstant: string,
  endInstant: string,
): RestrictionTimes {
  const r: RestrictionTimes = new RestrictionTimes();
  r.restictionType = RestrictionType.Daily;
  r.dayRestrictionTimes = {
    startTime: d(startInstant),
    endTime: d(endInstant),
  };
  return r;
}

function coveringEvent(
  events: Array<CalendarEvent>,
  at: Date,
): CalendarEvent | undefined {
  return events.find((e: CalendarEvent) => {
    return (
      OneUptimeDate.isOnOrBefore(e.start, at) &&
      OneUptimeDate.isOnOrAfter(e.end, at)
    );
  });
}

describe("LayerUtil audit fixes round 2", () => {
  describe("F0 - month/year rotation current-user near month-end", () => {
    test("monthly rotation anchored on Jan 31 pages the correct user on Mar 30", () => {
      const util: LayerUtil = new LayerUtil();
      const users: Array<User> = [u("A"), u("B"), u("C"), u("D"), u("E")];
      const base: LayerProps = {
        users,
        startDateTimeOfLayer: d("2024-01-01T10:00:00.000Z"),
        handOffTime: d("2024-01-31T10:00:00.000Z"),
        restrictionTimes: noRestriction(),
        rotation: rot(EventInterval.Month, 1),
        timezone: "UTC",
      };

      const target: Date = d("2024-03-30T12:00:00.000Z");

      // Ground truth: expand from the layer start and find who covers the target.
      const full: Array<CalendarEvent> = util.getEvents({
        ...base,
        calendarStartDate: d("2024-01-01T10:00:00.000Z"),
        calendarEndDate: d("2024-05-01T00:00:00.000Z"),
      });
      const groundTruth: CalendarEvent | undefined = coveringEvent(
        full,
        target,
      );
      // Jan31 -> Feb29 -> Mar29 -> Apr29 : on Mar 30, D (index 3) is on call.
      expect(groundTruth?.title).toBe("D");

      /*
       * The live "who is on call now" path resolves via a window that STARTS at
       * the target instant; it must agree with the full-expansion ground truth.
       */
      const nowWindow: Array<CalendarEvent> = util.getEvents({
        ...base,
        calendarStartDate: target,
        calendarEndDate: d("2024-03-30T13:00:00.000Z"),
      });
      expect(nowWindow[0]?.title).toBe("D");
    });

    test("yearly rotation anchored on Feb 29 stays consistent across leap boundary", () => {
      const util: LayerUtil = new LayerUtil();
      const users: Array<User> = [u("A"), u("B"), u("C")];
      const base: LayerProps = {
        users,
        startDateTimeOfLayer: d("2024-01-01T00:00:00.000Z"),
        handOffTime: d("2024-02-29T09:00:00.000Z"),
        restrictionTimes: noRestriction(),
        rotation: rot(EventInterval.Year, 1),
        timezone: "UTC",
      };

      const target: Date = d("2027-06-01T00:00:00.000Z");

      const full: Array<CalendarEvent> = util.getEvents({
        ...base,
        calendarStartDate: d("2024-01-01T00:00:00.000Z"),
        calendarEndDate: d("2028-01-01T00:00:00.000Z"),
      });
      const groundTruth: CalendarEvent | undefined = coveringEvent(
        full,
        target,
      );
      expect(groundTruth).toBeDefined();

      const nowWindow: Array<CalendarEvent> = util.getEvents({
        ...base,
        calendarStartDate: target,
        calendarEndDate: d("2027-06-01T01:00:00.000Z"),
      });
      expect(nowWindow[0]?.title).toBe(groundTruth?.title);
    });
  });

  describe("F2 - long rotation period + daily restriction keeps full coverage", () => {
    test("quarterly rotation with a business-hours daily restriction covers days past 50", () => {
      const util: LayerUtil = new LayerUtil();
      const layer: LayerProps = {
        users: [u("A")],
        startDateTimeOfLayer: d("2026-01-01T00:00:00.000Z"),
        handOffTime: d("2026-01-01T00:00:00.000Z"),
        // 09:00 -> 17:00 UTC daily restriction.
        restrictionTimes: dailyRestrictionFromInstants(
          "2026-01-01T09:00:00.000Z",
          "2026-01-01T17:00:00.000Z",
        ),
        rotation: rot(EventInterval.Month, 3), // quarterly -> one ~91-day event
        timezone: "UTC",
      };

      const events: Array<CalendarEvent> = util.getEvents({
        ...layer,
        calendarStartDate: d("2026-01-01T00:00:00.000Z"),
        calendarEndDate: d("2026-04-01T00:00:00.000Z"),
      });

      /*
       * There must be a real 09:00-17:00 coverage window in mid-March (well past
       * the old 50-day cap). Before the fix, coverage stopped around Feb 19.
       */
      const midMarch: Date = d("2026-03-16T12:00:00.000Z");
      const covering: CalendarEvent | undefined = coveringEvent(
        events,
        midMarch,
      );
      expect(covering).toBeDefined();
      expect(covering?.title).toBe("A");
    });
  });

  describe("F3 - weekly wrap-around does not double-cover", () => {
    test("Fri->Mon weekly restriction over a 2-week rotation has no overlapping events", () => {
      const util: LayerUtil = new LayerUtil();

      // Fri 20:00 -> Mon 08:00 UTC weekend window. 2026-01-09 is a Friday.
      const weekly: WeeklyResctriction = {
        startDay: DayOfWeek.Friday,
        endDay: DayOfWeek.Monday,
        startTime: d("2026-01-09T20:00:00.000Z"),
        endTime: d("2026-01-05T08:00:00.000Z"),
      };
      const restrictionTimes: RestrictionTimes = new RestrictionTimes();
      restrictionTimes.restictionType = RestrictionType.Weekly;
      restrictionTimes.weeklyRestrictionTimes = [weekly];

      const layer: LayerProps = {
        users: [u("A"), u("B")],
        startDateTimeOfLayer: d("2026-01-05T00:00:00.000Z"),
        handOffTime: d("2026-01-05T00:00:00.000Z"),
        restrictionTimes,
        rotation: rot(EventInterval.Week, 2),
        timezone: "UTC",
      };

      const events: Array<CalendarEvent> = util.getEvents({
        ...layer,
        calendarStartDate: d("2026-01-05T00:00:00.000Z"),
        calendarEndDate: d("2026-02-02T00:00:00.000Z"),
      });

      // No two events may overlap (the old head/main tiling duplicated Sun->Mon).
      for (let i: number = 0; i < events.length; i++) {
        for (let j: number = i + 1; j < events.length; j++) {
          const a: CalendarEvent = events[i]!;
          const b: CalendarEvent = events[j]!;
          const overlap: boolean =
            OneUptimeDate.isBefore(a.start, b.end) &&
            OneUptimeDate.isBefore(b.start, a.end);
          expect(overlap).toBe(false);
        }
      }
    });
  });

  describe("F8 - long restriction gap does not truncate to empty", () => {
    test("hourly rotation with a Monday-only weekly window still finds upcoming coverage >100h out", () => {
      const util: LayerUtil = new LayerUtil();

      // Active Mondays only: Mon 00:00 -> Tue 00:00 UTC. 2026-01-05 is a Monday.
      const weekly: WeeklyResctriction = {
        startDay: DayOfWeek.Monday,
        endDay: DayOfWeek.Tuesday,
        startTime: d("2026-01-05T00:00:00.000Z"),
        endTime: d("2026-01-06T00:00:00.000Z"),
      };
      const restrictionTimes: RestrictionTimes = new RestrictionTimes();
      restrictionTimes.restictionType = RestrictionType.Weekly;
      restrictionTimes.weeklyRestrictionTimes = [weekly];

      const layer: LayerProps = {
        users: [u("A"), u("B")],
        startDateTimeOfLayer: d("2026-01-01T00:00:00.000Z"),
        handOffTime: d("2026-01-01T00:00:00.000Z"),
        restrictionTimes,
        rotation: rot(EventInterval.Hour, 1),
        timezone: "UTC",
      };

      /*
       * "now" is Tuesday 01:00, just after the Monday window ended. The next
       * covered window is next Monday (~143h away) — more than the old 100-period
       * cap, which returned [] (schedule reporting nobody on-call).
       */
      const calendarStart: Date = d("2026-01-06T01:00:00.000Z");
      const events: Array<CalendarEvent> = util.getEvents({
        ...layer,
        calendarStartDate: calendarStart,
        calendarEndDate: d("2027-01-06T00:00:00.000Z"),
      });

      expect(events.length).toBeGreaterThan(0);
      // The first coverage is next Monday, > 100 hours after calendarStart.
      const hundredHoursOut: Date = OneUptimeDate.addRemoveHours(
        calendarStart,
        100,
      );
      expect(OneUptimeDate.isAfter(events[0]!.start, hundredHoursOut)).toBe(
        true,
      );
    });
  });

  describe("Follow-up - daily restriction covers later days when the event starts after the window", () => {
    test("weekly rotation with a 20:00 handoff and 09:00-17:00 daily restriction covers days 2..7", () => {
      const util: LayerUtil = new LayerUtil();

      /*
       * 2026-01-05 is a Monday. Handoff/start at 20:00 — AFTER that day's
       * 09:00-17:00 restriction window.
       */
      const layer: LayerProps = {
        users: [u("A")],
        startDateTimeOfLayer: d("2026-01-05T20:00:00.000Z"),
        handOffTime: d("2026-01-05T20:00:00.000Z"),
        restrictionTimes: dailyRestrictionFromInstants(
          "2026-01-05T09:00:00.000Z",
          "2026-01-05T17:00:00.000Z",
        ),
        rotation: rot(EventInterval.Week, 1),
        timezone: "UTC",
      };

      const events: Array<CalendarEvent> = util.getEvents({
        ...layer,
        calendarStartDate: d("2026-01-05T20:00:00.000Z"),
        calendarEndDate: d("2026-01-12T20:00:00.000Z"),
      });

      // Before the fix this returned ZERO events (the whole week uncovered).
      expect(events.length).toBeGreaterThan(0);

      // Tuesday (day 2) noon is covered by that day's 09:00-17:00 window.
      const tuesdayNoon: Date = d("2026-01-06T12:00:00.000Z");
      expect(coveringEvent(events, tuesdayNoon)?.title).toBe("A");

      /*
       * The first night (Monday 22:00, after the 20:00 start, outside the
       * restriction) is correctly NOT covered.
       */
      const mondayNight: Date = d("2026-01-05T22:00:00.000Z");
      expect(coveringEvent(events, mondayNight)).toBeUndefined();
    });
  });

  describe("F4 - rotation handoff preserves schedule wall-clock across DST", () => {
    test("daily 09:00 America/New_York handoff stays at 09:00 local after spring-forward", () => {
      const util: LayerUtil = new LayerUtil();
      const layer: LayerProps = {
        users: [u("A"), u("B")],
        // 2026-03-05 09:00 America/New_York (EST, UTC-5) = 14:00 UTC.
        startDateTimeOfLayer: d("2026-03-05T14:00:00.000Z"),
        handOffTime: d("2026-03-05T14:00:00.000Z"),
        restrictionTimes: noRestriction(),
        rotation: rot(EventInterval.Day, 1),
        timezone: "America/New_York",
      };

      const events: Array<CalendarEvent> = util.getEvents({
        ...layer,
        calendarStartDate: d("2026-03-05T14:00:00.000Z"),
        calendarEndDate: d("2026-03-12T00:00:00.000Z"),
      });

      /*
       * US spring-forward is 2026-03-08. On March 10 (EDT, UTC-4), 09:00 local is
       * 13:00 UTC. Before the fix, absolute +24h stepping drifted it to 14:00 UTC.
       */
      const march10Afternoon: Date = d("2026-03-10T18:00:00.000Z");
      const covering: CalendarEvent | undefined = coveringEvent(
        events,
        march10Afternoon,
      );
      expect(covering).toBeDefined();
      expect(new Date(covering!.start).getUTCHours()).toBe(13);
    });
  });

  describe("F5 - daily restriction preserves schedule wall-clock across DST", () => {
    test("09:00-17:00 America/New_York restriction stays 09:00-17:00 local after spring-forward", () => {
      const util: LayerUtil = new LayerUtil();

      const layer: LayerProps = {
        users: [u("A")],
        /*
         * 2026-03-05 00:00 America/New_York (EST) = 05:00 UTC — a NY-day-aligned
         * handoff, as real weekly schedules use.
         */
        startDateTimeOfLayer: d("2026-03-05T05:00:00.000Z"),
        handOffTime: d("2026-03-05T05:00:00.000Z"),
        // 09:00 EST and 17:00 EST reference instants -> 09:00/17:00 New York.
        restrictionTimes: dailyRestrictionFromInstants(
          "2026-03-05T14:00:00.000Z",
          "2026-03-05T22:00:00.000Z",
        ),
        rotation: rot(EventInterval.Week, 1), // one 7-day event spanning DST
        timezone: "America/New_York",
      };

      const events: Array<CalendarEvent> = util.getEvents({
        ...layer,
        calendarStartDate: d("2026-03-05T05:00:00.000Z"),
        calendarEndDate: d("2026-03-12T05:00:00.000Z"),
      });

      /*
       * The March 10 window (EDT) must be 09:00-17:00 local = 13:00-21:00 UTC.
       * A drifted window would be 10:00-18:00 local (14:00-22:00 UTC), leaving
       * 13:30 UTC uncovered.
       */
      const march10Morning: Date = d("2026-03-10T13:30:00.000Z"); // 09:30 EDT
      const covering: CalendarEvent | undefined = coveringEvent(
        events,
        march10Morning,
      );
      expect(covering).toBeDefined();
      expect(new Date(covering!.start).getUTCHours()).toBe(13);
    });
  });
});
