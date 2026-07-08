import LayerUtil from "../../../Types/OnCallDutyPolicy/Layer";
import RestrictionTimes, {
  RestrictionType,
  WeeklyResctriction,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import OneUptimeDate from "../../../Types/Date";
import DayOfWeek from "../../../Types/Day/DayOfWeek";
import StartAndEndTime from "../../../Types/Time/StartAndEndTime";
import EventInterval from "../../../Types/Events/EventInterval";

function fmt(w: StartAndEndTime): string {
  return (
    OneUptimeDate.getDayOfWeek(w.startTime) +
    " " +
    w.startTime.toISOString() +
    " -> " +
    OneUptimeDate.getDayOfWeek(w.endTime) +
    " " +
    w.endTime.toISOString()
  );
}

describe("diag weekly wrap segments", () => {
  const sunday: Date = OneUptimeDate.getStartOfTheWeek(new Date(2026, 1, 18));

  test("dump segments for Sunday event start", () => {
    const util: LayerUtil = new LayerUtil();
    const friday22: Date = OneUptimeDate.addRemoveHours(
      OneUptimeDate.addRemoveDays(sunday, 5),
      22,
    );
    const monday06: Date = OneUptimeDate.addRemoveHours(
      OneUptimeDate.addRemoveDays(sunday, 1),
      6,
    );
    const weekly: WeeklyResctriction = {
      startDay: DayOfWeek.Friday,
      endDay: DayOfWeek.Monday,
      startTime: friday22,
      endTime: monday06,
    };
    const r: RestrictionTimes = new RestrictionTimes();
    r.restictionType = RestrictionType.Weekly;
    r.weeklyRestrictionTimes = [weekly];

    const eventStart: Date = OneUptimeDate.addRemoveHours(sunday, 12);
    const eventEnd: Date = OneUptimeDate.addRemoveHours(
      OneUptimeDate.addRemoveDays(sunday, 6),
      12,
    );

    const segments: Array<StartAndEndTime> =
      util.getWeeklyRestrictionTimesForWeek({
        eventStartTime: eventStart,
        eventEndTime: eventEnd,
        restrictionTimes: r,
      });

    // eslint-disable-next-line no-console
    console.log("EVENT:", eventStart.toISOString(), "->", eventEnd.toISOString());
    // eslint-disable-next-line no-console
    console.log("SEGMENTS:");
    for (const s of segments) {
      // eslint-disable-next-line no-console
      console.log("  ", fmt(s), "inverted?", OneUptimeDate.isBefore(s.endTime, s.startTime));
    }

    // Now expand each segment via daily restriction (weekly interval), like the code does.
    for (const s of segments) {
      const exp: Array<StartAndEndTime> = util.getEventsByDailyRestriction({
        eventStartTime: eventStart,
        eventEndTime: eventEnd,
        restrictionStartAndEndTime: s,
        props: { intervalType: EventInterval.Week },
      });
      // eslint-disable-next-line no-console
      console.log("  expand of", fmt(s), "=>", exp.map(fmt));
    }

    expect(true).toBe(true);
  });
});
