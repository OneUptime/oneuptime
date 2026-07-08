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
import StartAndEndTime from "../../../Types/Time/StartAndEndTime";
import moment from "moment-timezone";

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

function tzInstant(iso: string, tz: string): Date {
  return moment.tz(iso, tz).toDate();
}

function hhmm(d: Date, tz: string): string {
  return moment.tz(d, tz).format("ddd YYYY-MM-DD HH:mm");
}

const tz: string = "America/New_York";

describe("DST audit: weekly wrap-around restriction close (line 1045 addRemoveDays without tz)", () => {
  test("main segment close wall-clock across fall-back", () => {
    const util: LayerUtil = new LayerUtil();

    // Weekly weekend restriction: Fri 20:00 -> Mon 08:00 (wrap-around).
    const weekly: WeeklyResctriction = {
      startDay: DayOfWeek.Friday,
      endDay: DayOfWeek.Monday,
      startTime: tzInstant("2025-10-24 20:00", tz), // Friday 20:00 NY
      endTime: tzInstant("2025-10-27 08:00", tz), // Monday 08:00 NY
    };
    const restrictionTimes: RestrictionTimes = new RestrictionTimes();
    restrictionTimes.restictionType = RestrictionType.Weekly;
    restrictionTimes.weeklyRestrictionTimes = [weekly];

    // Event in the week that contains the fall-back weekend (Sun Nov 2 2025).
    // Friday of that week is Oct 31 2025.
    const eventStartTime: Date = tzInstant("2025-10-31 20:00", tz); // Fri 20:00
    const eventEndTime: Date = tzInstant("2025-11-07 20:00", tz);

    const segments: Array<StartAndEndTime> =
      util.getWeeklyRestrictionTimesForWeek({
        eventStartTime,
        eventEndTime,
        restrictionTimes,
      });

    // eslint-disable-next-line no-console
    console.log("TZ=" + process.env.TZ);
    for (const s of segments) {
      // eslint-disable-next-line no-console
      console.log(
        "segment start=" + hhmm(s.startTime, tz) + " end=" + hhmm(s.endTime, tz),
      );
    }

    // Find the main (wrap) segment: the one that starts Friday.
    const main: StartAndEndTime | undefined = segments.find(
      (s: StartAndEndTime) => {
        return moment.tz(s.startTime, tz).format("ddd") === "Fri";
      },
    );

    expect(main).toBeDefined();
    // The close should be the FOLLOWING Monday 08:00 NY wall-clock.
    // Fri Oct 31 20:00 -> Mon Nov 3 08:00 NY.
    expect(moment.tz(main!.endTime, tz).format("HH:mm")).toBe("08:00");
  });

  test("end-to-end: weekend-only on-call coverage close on Monday across fall-back", () => {
    const util: LayerUtil = new LayerUtil();

    const weekly: WeeklyResctriction = {
      startDay: DayOfWeek.Friday,
      endDay: DayOfWeek.Monday,
      startTime: tzInstant("2025-10-24 20:00", tz),
      endTime: tzInstant("2025-10-27 08:00", tz),
    };
    const restrictionTimes: RestrictionTimes = new RestrictionTimes();
    restrictionTimes.restictionType = RestrictionType.Weekly;
    restrictionTimes.weeklyRestrictionTimes = [weekly];

    const layerStart: Date = tzInstant("2025-10-27 00:00", tz); // a Monday
    const events: Array<CalendarEvent> = util.getEvents({
      users: [user("u1")],
      startDateTimeOfLayer: layerStart,
      handOffTime: layerStart,
      restrictionTimes,
      rotation: rotation(EventInterval.Week, 1),
      timezone: tz,
      calendarStartDate: layerStart,
      calendarEndDate: tzInstant("2025-11-10 00:00", tz),
    });

    const covered: (t: Date) => boolean = (t: Date): boolean => {
      return events.some((e: CalendarEvent) => {
        return t.getTime() >= e.start.getTime() && t.getTime() < e.end.getTime();
      });
    };

    // The weekend window of Fri Oct 31 -> Mon Nov 3 crosses the Nov 2 fall-back.
    // Authored close is Monday Nov 3 08:00 NY. Just BEFORE close should be covered;
    // AFTER close should NOT be covered.
    const monday0730: Date = tzInstant("2025-11-03 07:30", tz);
    const monday0830: Date = tzInstant("2025-11-03 08:30", tz);

    // eslint-disable-next-line no-console
    console.log(
      "TZ=" + process.env.TZ + " Mon 07:30 covered=" + covered(monday0730) +
        " Mon 08:30 covered=" + covered(monday0830),
    );

    expect(covered(monday0730)).toBe(true); // still on call at 07:30
    expect(covered(monday0830)).toBe(false); // off call at 08:30
  });

  test("end-to-end spring-forward: phantom over-coverage past the authored Monday close", () => {
    const util: LayerUtil = new LayerUtil();

    // Weekend restriction Fri 20:00 -> Mon 08:00.
    const weekly: WeeklyResctriction = {
      startDay: DayOfWeek.Friday,
      endDay: DayOfWeek.Monday,
      startTime: tzInstant("2026-02-27 20:00", tz),
      endTime: tzInstant("2026-03-02 08:00", tz),
    };
    const restrictionTimes: RestrictionTimes = new RestrictionTimes();
    restrictionTimes.restictionType = RestrictionType.Weekly;
    restrictionTimes.weeklyRestrictionTimes = [weekly];

    // MONTHLY rotation with a single user -> the whole month is ONE event that
    // spans the spring-forward weekend (Sun Mar 8 2026), so weekly tiling of the
    // restriction happens inside a single event (no per-week head segment to
    // mask the drift).
    const layerStart: Date = tzInstant("2026-03-01 00:00", tz);
    const events: Array<CalendarEvent> = util.getEvents({
      users: [user("u1")],
      startDateTimeOfLayer: layerStart,
      handOffTime: layerStart,
      restrictionTimes,
      rotation: rotation(EventInterval.Month, 1),
      timezone: tz,
      calendarStartDate: layerStart,
      calendarEndDate: tzInstant("2026-03-31 00:00", tz),
    });

    const covered: (t: Date) => boolean = (t: Date): boolean => {
      return events.some((e: CalendarEvent) => {
        return t.getTime() >= e.start.getTime() && t.getTime() < e.end.getTime();
      });
    };

    // Spring-forward weekend Fri Mar 6 20:00 -> Mon Mar 9 08:00.
    const monBefore: Date = tzInstant("2026-03-09 07:30", tz); // authored on
    const monAfter: Date = tzInstant("2026-03-09 08:30", tz); // authored OFF

    // eslint-disable-next-line no-console
    console.log(
      "TZ=" + process.env.TZ + " SPRINGFWD Mon 07:30 covered=" +
        covered(monBefore) + " Mon 08:30 covered=" + covered(monAfter),
    );

    expect(covered(monBefore)).toBe(true);
    // Authored coverage ends 08:00; 08:30 should NOT be covered.
    expect(covered(monAfter)).toBe(false);
  });
});
