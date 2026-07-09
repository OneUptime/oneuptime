/**
 * REPRO (weekly granularity of the post-window-gap off-by-one):
 * weekly rotation [A,B] with a Mon-Fri weekly restriction, resolved on the
 * WEEKEND, attributes next week to the WRONG user.
 *
 * Layer start Mon 2025-01-06 00:00 UTC, weekly rotation, restriction active
 * Mon 00:00 -> Sat 00:00 (i.e. Mon-Fri).
 *   Full expansion (calendar): week0 (Jan6-10)=A, week1 (Jan13-17)=B ...
 *   Windowed asked on Sat 2025-01-11 12:00 : next week=A (WRONG, should be B).
 */
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
import PositiveNumber from "../../../Types/PositiveNumber";
import DayOfWeek from "../../../Types/Day/DayOfWeek";

function user(id: string): User {
  return {
    id: {
      toString: (): string => {
        return id;
      },
    } as any,
  } as User;
}

function makeLayer(): LayerProps {
  const rot: Recurring = new Recurring();
  rot.intervalType = EventInterval.Week;
  rot.intervalCount = new PositiveNumber(1);
  const start: Date = OneUptimeDate.fromString("2025-01-06T00:00:00.000Z"); // Monday

  // Active Mon 00:00 -> Sat 00:00 (Mon-Fri coverage). Non-wrapping window.
  const weekly: WeeklyResctriction = {
    startDay: DayOfWeek.Monday,
    endDay: DayOfWeek.Saturday,
    startTime: OneUptimeDate.fromString("2025-01-06T00:00:00.000Z"), // Monday
    endTime: OneUptimeDate.fromString("2025-01-11T00:00:00.000Z"), // Saturday
  };
  const r: RestrictionTimes = new RestrictionTimes();
  r.restictionType = RestrictionType.Weekly;
  r.weeklyRestrictionTimes = [weekly];

  return {
    users: [user("A"), user("B")],
    startDateTimeOfLayer: start,
    restrictionTimes: r,
    handOffTime: Recurring.getNextDateInterval(start, rot),
    rotation: rot,
    timezone: undefined,
  };
}

function fmt(e: CalendarEvent): string {
  return `${e.title} [${e.start.toISOString()} -> ${e.end.toISOString()}]`;
}

describe("Weekly rotation + Mon-Fri restriction: weekend query off-by-one", () => {
  test("week1 is B in calendar but a Saturday query says next week=A", () => {
    const layer: LayerProps = makeLayer();
    const util: LayerUtil = new LayerUtil();

    const full: Array<CalendarEvent> = util.getEvents({
      ...layer,
      calendarStartDate: layer.startDateTimeOfLayer,
      calendarEndDate: OneUptimeDate.fromString("2025-01-25T00:00:00.000Z"),
    });

    // Who covers Wed Jan 15 (inside week1 Mon-Fri) in the calendar?
    const jan15: Date = OneUptimeDate.fromString("2025-01-15T12:00:00.000Z");
    const week1Cover: CalendarEvent | undefined = full.find(
      (e: CalendarEvent) => {
        return (
          OneUptimeDate.isOnOrAfter(jan15, e.start) &&
          OneUptimeDate.isBefore(jan15, e.end)
        );
      },
    );

    // Ask on Saturday Jan 11 12:00 (weekend gap of week0).
    const askAt: Date = OneUptimeDate.fromString("2025-01-11T12:00:00.000Z");
    const windowed: Array<CalendarEvent> = util.getEvents(
      {
        ...layer,
        calendarStartDate: askAt,
        calendarEndDate: OneUptimeDate.addRemoveDays(askAt, 14),
      },
      { getNumberOfEvents: 1 },
    );

    // eslint-disable-next-line no-console
    console.log("FULL:", full.map(fmt));
    // eslint-disable-next-line no-console
    console.log("week1 covered by (full):", week1Cover && fmt(week1Cover));
    // eslint-disable-next-line no-console
    console.log(
      "WINDOWED next @Sat Jan11 12:00:",
      windowed[0] && fmt(windowed[0]),
    );

    expect(week1Cover?.title).toBe("B");
    // Windowed next on-call should be week1 = B; it is A -> BUG.
    expect(windowed[0]?.title).toBe("B");
  });
});
