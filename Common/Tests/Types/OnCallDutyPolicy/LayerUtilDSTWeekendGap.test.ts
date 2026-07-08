/**
 * REGRESSION (audit F8): weekly wrap-around (weekend) restriction close must not
 * drift across a DST transition.
 *
 * getWeeklyRestrictionTimesForWeek builds the wrap-around "main" segment end as
 * a +7-day step. If that step is taken in the process zone instead of the
 * schedule zone, then when the server/process zone (e.g. UTC) differs from the
 * schedule zone across a DST transition, the weekend window's Monday-morning
 * close drifts by the DST offset — over-covering (extra-hour paging of the
 * weekend user) or, on fall-back, opening a coverage gap.
 *
 * These assertions are expressed in schedule-zone wall-clock via moment-timezone
 * so they hold regardless of the process TZ the test runs under (run under
 * TZ=UTC to exercise the exact server-vs-schedule divergence the bug needs).
 */
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

function user(id: string): User {
  return {
    id: {
      toString: (): string => {
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

const NY: string = "America/New_York";

function weekendLayerEvents(): Array<CalendarEvent> {
  const util: LayerUtil = new LayerUtil();

  // Layer starts Sun Mar 1 2026 00:00 NY; monthly single-user rotation.
  const layerStart: Date = tzInstant("2026-03-01 00:00", NY);

  // Weekend wrap-around restriction: Fri 20:00 -> Mon 08:00 (NY wall-clock).
  const weekly: WeeklyResctriction = {
    startDay: DayOfWeek.Friday,
    endDay: DayOfWeek.Monday,
    startTime: tzInstant("2026-01-02 20:00", NY), // a Friday 20:00 NY
    endTime: tzInstant("2026-01-05 08:00", NY), // a Monday 08:00 NY
  };
  const restrictionTimes: RestrictionTimes = new RestrictionTimes();
  restrictionTimes.restictionType = RestrictionType.Weekly;
  restrictionTimes.weeklyRestrictionTimes = [weekly];

  return util.getEvents({
    users: [user("weekend-user")],
    startDateTimeOfLayer: layerStart,
    handOffTime: tzInstant("2026-04-01 00:00", NY),
    restrictionTimes: restrictionTimes,
    rotation: rotation(EventInterval.Month, 1),
    timezone: NY,
    calendarStartDate: layerStart,
    calendarEndDate: tzInstant("2026-04-01 00:00", NY),
  });
}

describe("F8: weekend wrap-around restriction close is stable across DST", () => {
  const events: Array<CalendarEvent> = weekendLayerEvents();

  const covered: (t: Date) => boolean = (t: Date): boolean => {
    return events.some((e: CalendarEvent) => {
      return t.getTime() >= e.start.getTime() && t.getTime() < e.end.getTime();
    });
  };

  /*
   * US spring-forward 2026 is Sunday March 8; the weekend that opens Fri Mar 6
   * 20:00 closes Mon Mar 9 08:00 NY.
   */
  test("inside the weekend window is covered (Fri 20:30 and Mon 07:30 NY)", () => {
    expect(covered(tzInstant("2026-03-06 20:30", NY))).toBe(true);
    expect(covered(tzInstant("2026-03-09 07:30", NY))).toBe(true);
  });

  test("Mon 2026-03-09 08:30 NY is NOT covered (authored close is 08:00, no DST drift)", () => {
    expect(covered(tzInstant("2026-03-09 08:30", NY))).toBe(false);
  });

  test("a non-DST weekend closes at the same 08:00 NY wall-clock", () => {
    // Weekend opening Fri Mar 20 20:00 closes Mon Mar 23 08:00 NY (no DST that week).
    expect(covered(tzInstant("2026-03-23 07:30", NY))).toBe(true);
    expect(covered(tzInstant("2026-03-23 08:30", NY))).toBe(false);
  });
});
