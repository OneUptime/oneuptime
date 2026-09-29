import LayerUtil from "../../../Types/OnCallDutyPolicy/Layer";
import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import RestrictionTimes, {
  RestrictionType,
  WeeklyResctriction,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import Recurring from "../../../Types/Events/Recurring";
import User from "../../../Models/DatabaseModels/User";
import EventInterval from "../../../Types/Events/EventInterval";
import DayOfWeek from "../../../Types/Day/DayOfWeek";
import moment from "moment-timezone";

/*
 * HIGH-5 (timezone) + LOW-2 (DST). These tests construct restriction times and
 * verify results entirely in an explicit IANA zone via moment.tz, so they hold
 * regardless of the machine/CI local timezone — which is exactly the bug:
 * restriction wall-clock must resolve in the SCHEDULE's zone, not the server's.
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
  } as any);
}

// An absolute instant that is `iso` wall-clock in `tz`.
function tzInstant(iso: string, tz: string): Date {
  return moment.tz(iso, tz).toDate();
}

// Wall-clock "HH:mm" of an instant AS SEEN IN `tz`.
function hhmm(d: Date, tz: string): string {
  return moment.tz(d, tz).format("HH:mm");
}

describe("LayerUtil HIGH-5: daily restriction resolves in the schedule timezone", () => {
  const tz: string = "America/New_York";

  test("09:00-17:00 restriction resolves to 09:00-17:00 in the schedule zone", () => {
    const util: LayerUtil = new LayerUtil();

    const layerStart: Date = tzInstant("2026-02-16 00:00", tz); // Mon (no DST)
    const calStart: Date = layerStart;
    const calEnd: Date = tzInstant("2026-02-19 00:00", tz); // +3 days

    const restrictionTimes: RestrictionTimes = new RestrictionTimes();
    restrictionTimes.restictionType = RestrictionType.Daily;
    restrictionTimes.dayRestrictionTimes = {
      startTime: tzInstant("2026-02-16 09:00", tz),
      endTime: tzInstant("2026-02-16 17:00", tz),
    };

    const events: Array<CalendarEvent> = util.getEvents({
      users: [user("u1")],
      startDateTimeOfLayer: layerStart,
      handOffTime: layerStart,
      restrictionTimes: restrictionTimes,
      rotation: rotation(EventInterval.Day, 1),
      timezone: tz,
      calendarStartDate: calStart,
      calendarEndDate: calEnd,
    });

    // One 09:00-17:00 window per day, in New York wall-clock.
    const windows: Array<CalendarEvent> = events.filter((e: CalendarEvent) => {
      return hhmm(e.start, tz) === "09:00";
    });
    expect(windows.length).toBeGreaterThanOrEqual(3);
    for (const w of windows) {
      expect(hhmm(w.start, tz)).toBe("09:00");
      expect(hhmm(w.end, tz)).toBe("17:00");
    }
  });

  test("a schedule authored + resolved in Kolkata resolves to its own wall-clock", () => {
    const util: LayerUtil = new LayerUtil();
    const tzIST: string = "Asia/Kolkata"; // UTC+5:30, no DST

    /*
     * Author and resolve entirely in Kolkata, with the layer start aligned to
     * local midnight (as a real schedule created in that zone would be).
     */
    const layerStart: Date = tzInstant("2026-02-16 00:00", tzIST);
    const restrictionTimes: RestrictionTimes = new RestrictionTimes();
    restrictionTimes.restictionType = RestrictionType.Daily;
    restrictionTimes.dayRestrictionTimes = {
      startTime: tzInstant("2026-02-16 09:30", tzIST),
      endTime: tzInstant("2026-02-16 18:30", tzIST),
    };

    const events: Array<CalendarEvent> = util.getEvents({
      users: [user("u1")],
      startDateTimeOfLayer: layerStart,
      handOffTime: layerStart,
      restrictionTimes: restrictionTimes,
      rotation: rotation(EventInterval.Day, 1),
      timezone: tzIST,
      calendarStartDate: layerStart,
      calendarEndDate: tzInstant("2026-02-19 00:00", tzIST),
    });

    const windows: Array<CalendarEvent> = events.filter((e: CalendarEvent) => {
      return hhmm(e.start, tzIST) === "09:30";
    });
    expect(windows.length).toBeGreaterThanOrEqual(2);
    for (const w of windows) {
      expect(hhmm(w.end, tzIST)).toBe("18:30");
    }
  });
});

describe("LayerUtil LOW-2: DST correctness across spring-forward", () => {
  const tz: string = "America/New_York";

  test("09:00-17:00 restriction stays 09:00-17:00 local across the DST spring-forward day", () => {
    const util: LayerUtil = new LayerUtil();

    // US spring-forward 2026 is Sun Mar 8. Cover Sat Mar 7 -> Tue Mar 10.
    const layerStart: Date = tzInstant("2026-03-07 00:00", tz);
    const restrictionTimes: RestrictionTimes = new RestrictionTimes();
    restrictionTimes.restictionType = RestrictionType.Daily;
    restrictionTimes.dayRestrictionTimes = {
      startTime: tzInstant("2026-03-07 09:00", tz),
      endTime: tzInstant("2026-03-07 17:00", tz),
    };

    const events: Array<CalendarEvent> = util.getEvents({
      users: [user("u1")],
      startDateTimeOfLayer: layerStart,
      handOffTime: layerStart,
      restrictionTimes: restrictionTimes,
      rotation: rotation(EventInterval.Day, 1),
      timezone: tz,
      calendarStartDate: layerStart,
      calendarEndDate: tzInstant("2026-03-10 00:00", tz),
    });

    const windows: Array<CalendarEvent> = events.filter((e: CalendarEvent) => {
      return hhmm(e.start, tz) === "09:00";
    });
    // Sat, Sun (DST day), Mon — all keep 09:00-17:00 local despite the lost hour.
    expect(windows.length).toBeGreaterThanOrEqual(3);
    for (const w of windows) {
      expect(hhmm(w.start, tz)).toBe("09:00");
      expect(hhmm(w.end, tz)).toBe("17:00");
    }
  });
});

describe("LayerUtil HIGH-5: weekly restriction resolves day-of-week in the schedule zone", () => {
  const tz: string = "America/New_York";

  test("Mon 09:00 -> Wed 17:00 weekly restriction covers Tue midday, not Sat", () => {
    const util: LayerUtil = new LayerUtil();

    const monday: Date = tzInstant("2026-02-16 00:00", tz); // Monday
    const weekly: WeeklyResctriction = {
      startDay: DayOfWeek.Monday,
      endDay: DayOfWeek.Wednesday,
      startTime: tzInstant("2026-02-16 09:00", tz), // Monday 09:00 NY
      endTime: tzInstant("2026-02-18 17:00", tz), // Wednesday 17:00 NY
    };
    const restrictionTimes: RestrictionTimes = new RestrictionTimes();
    restrictionTimes.restictionType = RestrictionType.Weekly;
    restrictionTimes.weeklyRestrictionTimes = [weekly];

    const events: Array<CalendarEvent> = util.getEvents({
      users: [user("u1")],
      startDateTimeOfLayer: monday,
      handOffTime: tzInstant("2026-02-23 00:00", tz),
      restrictionTimes: restrictionTimes,
      rotation: rotation(EventInterval.Week, 1),
      timezone: tz,
      calendarStartDate: monday,
      calendarEndDate: tzInstant("2026-02-23 00:00", tz),
    });

    const covered: (t: Date) => boolean = (t: Date): boolean => {
      return events.some((e: CalendarEvent) => {
        return (
          t.getTime() >= e.start.getTime() && t.getTime() < e.end.getTime()
        );
      });
    };

    // Tue 12:00 NY is inside Mon 09:00 -> Wed 17:00.
    expect(covered(tzInstant("2026-02-17 12:00", tz))).toBe(true);
    // Sat 12:00 NY is not.
    expect(covered(tzInstant("2026-02-21 12:00", tz))).toBe(false);
  });
});

describe("LayerUtil HIGH-5 backward compatibility: no timezone == legacy local behavior", () => {
  test("omitting timezone yields identical results to before (local reconstruction)", () => {
    const util: LayerUtil = new LayerUtil();
    // Author restriction in machine-local time via native Date.
    const layerStart: Date = new Date(2026, 1, 16, 0, 0, 0); // local midnight
    const restrictionTimes: RestrictionTimes = new RestrictionTimes();
    restrictionTimes.restictionType = RestrictionType.Daily;
    restrictionTimes.dayRestrictionTimes = {
      startTime: new Date(2026, 1, 16, 9, 0, 0),
      endTime: new Date(2026, 1, 16, 17, 0, 0),
    };

    const events: Array<CalendarEvent> = util.getEvents({
      users: [user("u1")],
      startDateTimeOfLayer: layerStart,
      handOffTime: layerStart,
      restrictionTimes: restrictionTimes,
      rotation: rotation(EventInterval.Day, 1),
      // timezone intentionally omitted
      calendarStartDate: layerStart,
      calendarEndDate: new Date(2026, 1, 19, 0, 0, 0),
    });

    const windows: Array<CalendarEvent> = events.filter((e: CalendarEvent) => {
      return e.start.getHours() === 9;
    });
    expect(windows.length).toBeGreaterThanOrEqual(2);
    for (const w of windows) {
      // Local wall-clock hours preserved exactly as legacy behavior.
      expect(w.start.getHours()).toBe(9);
      expect(w.end.getHours()).toBe(17);
    }
  });
});
