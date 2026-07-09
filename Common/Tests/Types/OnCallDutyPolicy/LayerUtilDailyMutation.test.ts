import LayerUtil from "../../../Types/OnCallDutyPolicy/Layer";
import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import RestrictionTimes, {
  RestrictionType,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import Recurring from "../../../Types/Events/Recurring";
import OneUptimeDate from "../../../Types/Date";
import User from "../../../Models/DatabaseModels/User";
import EventInterval from "../../../Types/Events/EventInterval";

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

/*
 * Build a daily restriction whose start/end are specific wall-clock times in a
 * given IANA timezone on an arbitrary reference date.
 */
function dailyRestrictionTz(
  startHour: number,
  startMin: number,
  endHour: number,
  endMin: number,
): RestrictionTimes {
  const r: RestrictionTimes = new RestrictionTimes();
  r.restictionType = RestrictionType.Daily;
  r.dayRestrictionTimes = {
    startTime: OneUptimeDate.getDateWithCustomTime({
      hours: startHour,
      minutes: startMin,
      seconds: 0,
    }),
    endTime: OneUptimeDate.getDateWithCustomTime({
      hours: endHour,
      minutes: endMin,
      seconds: 0,
    }),
  };
  return r;
}

describe("Daily restriction in-place mutation / DST drift", () => {
  test("restriction start in the DST spring-forward gap drifts permanently after the transition", () => {
    const tz: string = "America/New_York";
    const layerUtil: LayerUtil = new LayerUtil();
    // 2026 US DST spring-forward: Sun Mar 8, 02:00 -> 03:00. So 02:30 is invalid.
    const r: RestrictionTimes = dailyRestrictionTz(2, 30, 10, 0); // 02:30 -> 10:00 daily

    // Daily rotation, one user, handoff at 12:00 local. Events span Mar 6 -> Mar 12.
    const layerStart: Date = new Date(Date.UTC(2026, 2, 6, 5, 0, 0)); // Mar 6 00:00 ET-ish
    const events: Array<CalendarEvent> = layerUtil.getEvents({
      users: [user("A")],
      startDateTimeOfLayer: layerStart,
      restrictionTimes: r,
      handOffTime: new Date(Date.UTC(2026, 2, 6, 17, 0, 0)), // arbitrary
      rotation: rotation(EventInterval.Day, 1),
      timezone: tz,
      calendarStartDate: layerStart,
      calendarEndDate: new Date(Date.UTC(2026, 2, 13, 5, 0, 0)),
    });

    // eslint-disable-next-line no-console
    console.log("\n=== DST spring-forward restriction 02:30->10:00 ET ===");
    for (const e of events) {
      // eslint-disable-next-line no-console
      console.log(
        `  start(ET local h:m)=${startHourET(e.start, tz)}  end=${startHourET(
          e.end,
          tz,
        )}   [${e.start.toISOString()} -> ${e.end.toISOString()}]`,
      );
    }

    /*
     * Gather, per day AFTER the transition (Mar 9, 10, 11), the local start-hour of
     * the first event that day. If the mutation drifted it, it will be 03:30 not 02:30.
     */
    const startHoursAfter: Array<string> = [];
    for (const e of events) {
      const localStart: string = startHourET(e.start, tz);
      const day: number = etDay(e.start, tz);
      if (day >= 9 && day <= 11 && localStart.endsWith(":30")) {
        // pick the segment starting near the restriction start
        startHoursAfter.push(`${day}:${localStart}`);
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      "after-transition :30 starts =",
      JSON.stringify(startHoursAfter),
    );
  });
});

function startHourET(d: Date, tz: string): string {
  // format hour:minute as seen in tz
  const s: string = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return s;
}

function etDay(d: Date, tz: string): number {
  const s: string = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    day: "2-digit",
  }).format(d);
  return parseInt(s, 10);
}
