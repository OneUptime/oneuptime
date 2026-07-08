import LayerUtil from "../../../Types/OnCallDutyPolicy/Layer";
import RestrictionTimes, {
  RestrictionType,
  WeeklyResctriction,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import OneUptimeDate from "../../../Types/Date";
import DayOfWeek from "../../../Types/Day/DayOfWeek";
import StartAndEndTime from "../../../Types/Time/StartAndEndTime";

// Is instant t covered by any trimmed window? (start <= t < end)
function covered(times: Array<StartAndEndTime>, t: Date): boolean {
  for (const w of times) {
    if (OneUptimeDate.isOnOrAfter(t, w.startTime) && OneUptimeDate.isBefore(t, w.endTime)) {
      return true;
    }
  }
  return false;
}

function fri22ToMon06(sunday: Date): RestrictionTimes {
  // sunday is a Sunday 00:00 (start of week per moment).
  const friday22: Date = OneUptimeDate.addRemoveHours(
    OneUptimeDate.addRemoveDays(sunday, 5), // Sun+5 = Friday
    22,
  );
  const monday06: Date = OneUptimeDate.addRemoveHours(
    OneUptimeDate.addRemoveDays(sunday, 1), // Sun+1 = Monday
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
  return r;
}

describe("Weekly wrap-around restriction: coverage must not leak into mid-week", () => {
  // getStartOfTheWeek returns a Sunday 00:00 (moment locale week).
  const sunday: Date = OneUptimeDate.getStartOfTheWeek(new Date(2026, 1, 18));

  test("CONTROL: event window starting on MONDAY covers only weekend", () => {
    const util: LayerUtil = new LayerUtil();
    const monday: Date = OneUptimeDate.addRemoveDays(sunday, 1);
    const eventStart: Date = OneUptimeDate.addRemoveHours(monday, 12); // Mon 12:00
    const eventEnd: Date = OneUptimeDate.addRemoveDays(monday, 6); // next Sunday

    const trimmed: Array<StartAndEndTime> =
      util.trimStartAndEndTimesBasedOnRestrictionTimes({
        eventStartTime: eventStart,
        eventEndTime: eventEnd,
        restrictionTimes: fri22ToMon06(sunday),
      });

    const tue02: Date = OneUptimeDate.addRemoveHours(OneUptimeDate.addRemoveDays(monday, 1), 2);
    const wed12: Date = OneUptimeDate.addRemoveHours(OneUptimeDate.addRemoveDays(monday, 2), 12);
    const thu12: Date = OneUptimeDate.addRemoveHours(OneUptimeDate.addRemoveDays(monday, 3), 12);

    expect(covered(trimmed, tue02)).toBe(false);
    expect(covered(trimmed, wed12)).toBe(false);
    expect(covered(trimmed, thu12)).toBe(false);
  });

  test("BUG: event window starting on SUNDAY must NOT cover Tue/Wed/Thu", () => {
    const util: LayerUtil = new LayerUtil();
    const eventStart: Date = OneUptimeDate.addRemoveHours(sunday, 12); // Sun 12:00
    const eventEnd: Date = OneUptimeDate.addRemoveHours(
      OneUptimeDate.addRemoveDays(sunday, 6),
      12,
    ); // Saturday 12:00

    const trimmed: Array<StartAndEndTime> =
      util.trimStartAndEndTimesBasedOnRestrictionTimes({
        eventStartTime: eventStart,
        eventEndTime: eventEnd,
        restrictionTimes: fri22ToMon06(sunday),
      });

    // Sanity: Sunday afternoon IS in the weekend window -> covered.
    const sun18: Date = OneUptimeDate.addRemoveHours(sunday, 18);
    expect(covered(trimmed, sun18)).toBe(true);

    // Mid-week nights/days must NOT be covered by a Fri22->Mon06 restriction.
    const tue02: Date = OneUptimeDate.addRemoveHours(OneUptimeDate.addRemoveDays(sunday, 2), 2);
    const wed12: Date = OneUptimeDate.addRemoveHours(OneUptimeDate.addRemoveDays(sunday, 3), 12);
    const thu12: Date = OneUptimeDate.addRemoveHours(OneUptimeDate.addRemoveDays(sunday, 4), 12);

    // Dump for diagnosis.
    // eslint-disable-next-line no-console
    console.log(
      "SUNDAY trimmed:",
      trimmed.map((w: StartAndEndTime) => {
        return (
          OneUptimeDate.getDayOfWeek(w.startTime) +
          " " +
          w.startTime.toISOString() +
          " -> " +
          OneUptimeDate.getDayOfWeek(w.endTime) +
          " " +
          w.endTime.toISOString()
        );
      }),
    );

    expect(covered(trimmed, tue02)).toBe(false);
    expect(covered(trimmed, wed12)).toBe(false);
    expect(covered(trimmed, thu12)).toBe(false);
  });
});
