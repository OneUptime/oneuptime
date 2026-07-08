import LayerUtil, { LayerProps } from "../../../Types/OnCallDutyPolicy/Layer";
import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import RestrictionTimes, {
  RestrictionType,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import Recurring from "../../../Types/Events/Recurring";
import OneUptimeDate from "../../../Types/Date";
import User from "../../../Models/DatabaseModels/User";
import EventInterval from "../../../Types/Events/EventInterval";
import DayOfWeek from "../../../Types/Day/DayOfWeek";

function user(id: string): User {
  return { id: { toString: () => id } as any } as User;
}
function rotation(it: EventInterval, ic: number): Recurring {
  return Recurring.fromJSON({
    _type: "Recurring",
    value: {
      intervalType: it,
      intervalCount: { _type: "PositiveNumber", value: ic },
    },
  } as any);
}
function coveringTitle(events: Array<CalendarEvent>, t: Date): string | null {
  for (const e of events) {
    if (OneUptimeDate.isOnOrAfter(t, e.start) && OneUptimeDate.isBefore(t, e.end)) {
      return e.title;
    }
  }
  return null;
}

describe("ZZProbe restricted: simulation path vs full expansion", () => {
  const u3 = [user("A"), user("B"), user("C")];

  function dailyRestriction(startH: number, endH: number): RestrictionTimes {
    const r = new RestrictionTimes();
    r.restictionType = RestrictionType.Daily;
    r.dayRestrictionTimes = {
      startTime: OneUptimeDate.getDateWithCustomTime({ hours: startH, minutes: 0, seconds: 0 }),
      endTime: OneUptimeDate.getDateWithCustomTime({ hours: endH, minutes: 0, seconds: 0 }),
    };
    return r;
  }

  const cases = [
    { name: "daily 9-17, day rotation x1", it: EventInterval.Day, ic: 1, restr: () => dailyRestriction(9, 17) },
    { name: "daily 9-17, day rotation x2", it: EventInterval.Day, ic: 2, restr: () => dailyRestriction(9, 17) },
    { name: "daily 22-6 overnight, day rotation x1", it: EventInterval.Day, ic: 1, restr: () => dailyRestriction(22, 6) },
    { name: "daily 9-17, week rotation x1", it: EventInterval.Week, ic: 1, restr: () => dailyRestriction(9, 17) },
  ];

  for (const c of cases) {
    for (const anchorH of [0, 9]) {
      test(`${c.name} anchor+${anchorH}h`, () => {
        const util = new LayerUtil();
        const layerStart = new Date(2026, 0, 5, 0, 0, 0); // Monday Jan 5 2026
        const handOff = OneUptimeDate.addRemoveHours(layerStart, anchorH);
        const layer: Omit<LayerProps, "timezone"> = {
          users: u3,
          startDateTimeOfLayer: layerStart,
          handOffTime: handOff,
          restrictionTimes: c.restr(),
          rotation: rotation(c.it, c.ic),
        };
        // full expansion (~90 events)
        const bigEnd = OneUptimeDate.addRemoveDays(layerStart, 120);
        const full = util.getEvents({
          ...layer,
          calendarStartDate: layerStart,
          calendarEndDate: bigEnd,
        });
        // Sample every 30 minutes for 60 days; for each instant, compare
        // full-expansion coverage vs direct 1-second resolution.
        const totalHalfHours = 60 * 48;
        let mismatches = 0;
        let firstMsg = "";
        for (let i = 0; i < totalHalfHours; i++) {
          const t = OneUptimeDate.addRemoveMinutes(layerStart, i * 30 + 7); // +7min off boundaries
          const fullTitle = coveringTitle(full, t);
          const direct = util.getEvents(
            {
              ...layer,
              calendarStartDate: t,
              calendarEndDate: OneUptimeDate.addRemoveSeconds(t, 1),
            },
            { getNumberOfEvents: 1 },
          );
          const directTitle = direct[0]?.title ?? null;
          if (directTitle !== fullTitle) {
            mismatches++;
            if (!firstMsg) {
              firstMsg = `t=${t.toISOString()} direct=${directTitle} full=${fullTitle}`;
            }
          }
        }
        if (mismatches > 0) {
          throw new Error(`${c.name} anchor+${anchorH}h: ${mismatches} mismatches, first: ${firstMsg}`);
        }
      });
    }
  }

  test("weekly restriction Mon-Fri 9-17, day rotation x1", () => {
    const util = new LayerUtil();
    const layerStart = new Date(2026, 0, 5, 0, 0, 0);
    const r = new RestrictionTimes();
    r.restictionType = RestrictionType.Weekly;
    const mkTime = (h: number) =>
      OneUptimeDate.getDateWithCustomTime({ hours: h, minutes: 0, seconds: 0 });
    r.weeklyRestrictionTimes = [
      { startDay: DayOfWeek.Monday, endDay: DayOfWeek.Monday, startTime: mkTime(9), endTime: mkTime(17) } as any,
      { startDay: DayOfWeek.Tuesday, endDay: DayOfWeek.Tuesday, startTime: mkTime(9), endTime: mkTime(17) } as any,
      { startDay: DayOfWeek.Wednesday, endDay: DayOfWeek.Wednesday, startTime: mkTime(9), endTime: mkTime(17) } as any,
      { startDay: DayOfWeek.Thursday, endDay: DayOfWeek.Thursday, startTime: mkTime(9), endTime: mkTime(17) } as any,
      { startDay: DayOfWeek.Friday, endDay: DayOfWeek.Friday, startTime: mkTime(9), endTime: mkTime(17) } as any,
    ];
    const layer: Omit<LayerProps, "timezone"> = {
      users: u3,
      startDateTimeOfLayer: layerStart,
      handOffTime: layerStart,
      restrictionTimes: r,
      rotation: rotation(EventInterval.Day, 1),
    };
    const bigEnd = OneUptimeDate.addRemoveDays(layerStart, 90);
    const full = util.getEvents({ ...layer, calendarStartDate: layerStart, calendarEndDate: bigEnd });
    let mismatches = 0;
    let firstMsg = "";
    for (let i = 0; i < 40 * 48; i++) {
      const t = OneUptimeDate.addRemoveMinutes(layerStart, i * 30 + 7);
      const fullTitle = coveringTitle(full, t);
      const direct = util.getEvents(
        { ...layer, calendarStartDate: t, calendarEndDate: OneUptimeDate.addRemoveSeconds(t, 1) },
        { getNumberOfEvents: 1 },
      );
      const directTitle = direct[0]?.title ?? null;
      if (directTitle !== fullTitle) {
        mismatches++;
        if (!firstMsg) firstMsg = `t=${t.toISOString()} direct=${directTitle} full=${fullTitle}`;
      }
    }
    if (mismatches > 0) throw new Error(`weekly: ${mismatches} mismatches, first: ${firstMsg}`);
  });
});
