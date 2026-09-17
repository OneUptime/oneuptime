/**
 * REGRESSION (audit F9): OneUptimeDate.moveDateToTheDayOfWeek must keep its
 * timezone on the final day-shift, so a weekly restriction's day-of-week
 * boundary keeps its authored wall-clock across a DST transition.
 *
 * The first two steps (keepTimeButMoveDay, getDayOfWeek) are timezone-aware; the
 * final addRemoveDays shift must be too, otherwise a shift that straddles a DST
 * instant in the schedule zone (but not the process zone) drifts the resolved
 * boundary by the DST offset.
 *
 * Assertions are in schedule-zone wall-clock (moment-timezone) so they hold
 * regardless of the process TZ (run under TZ=UTC to model a UTC server).
 */
import LayerUtil from "../../../Types/OnCallDutyPolicy/Layer";
import RestrictionTimes, {
  RestrictionType,
  WeeklyResctriction,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import OneUptimeDate from "../../../Types/Date";
import DayOfWeek from "../../../Types/Day/DayOfWeek";
import moment from "moment-timezone";

function hhmm(d: Date, tz: string): string {
  return moment.tz(d, tz).format("HH:mm");
}

const NY: string = "America/New_York";

describe("F9: moveDateToTheDayOfWeek preserves wall-clock across DST", () => {
  it("moves a Sunday 01:00 NY restriction into a spring-forward week keeping 01:00", () => {
    /*
     * Authored Sunday 01:00 NY, moved into the week containing the 2026-03-08
     * spring-forward. The day-shift crosses the DST instant; wall-clock must hold.
     */
    const restriction: Date = moment.tz("2026-01-04 01:00", NY).toDate(); // a Sunday 01:00
    const eventStartTime: Date = moment.tz("2026-03-11 12:00", NY).toDate(); // Wednesday of DST week

    const moved: Date = OneUptimeDate.moveDateToTheDayOfWeek(
      restriction,
      eventStartTime,
      OneUptimeDate.getDayOfWeek(restriction, NY), // Sunday
      NY,
    );

    expect(hhmm(moved, NY)).toBe("01:00");
  });

  it("END-TO-END: Sunday 01:00-05:00 weekly restriction keeps its wall-clock in a DST week", () => {
    const util: LayerUtil = new LayerUtil();
    (util as any).timezone = NY;

    const wr: WeeklyResctriction = {
      startTime: moment.tz("2026-01-04 01:00", NY).toDate(), // Sunday 01:00 NY
      startDay: DayOfWeek.Sunday,
      endTime: moment.tz("2026-01-04 05:00", NY).toDate(), // Sunday 05:00 NY
      endDay: DayOfWeek.Sunday,
    } as any;

    const rt: RestrictionTimes = new RestrictionTimes();
    rt.restictionType = RestrictionType.Weekly;
    rt.weeklyRestrictionTimes = [wr];

    // Resolve on Wednesday of the week containing the 2026-03-08 spring-forward.
    const windows: Array<{ startTime: Date; endTime: Date }> =
      util.getWeeklyRestrictionTimesForWeek({
        eventStartTime: moment.tz("2026-03-11 12:00", NY).toDate(),
        eventEndTime: moment.tz("2026-03-14 23:59", NY).toDate(),
        restrictionTimes: rt,
      });

    expect(windows.length).toBeGreaterThan(0);
    const w0: { startTime: Date; endTime: Date } = windows[0]!;
    expect(hhmm(w0.startTime, NY)).toBe("01:00");
    expect(hhmm(w0.endTime, NY)).toBe("05:00");
  });
});
