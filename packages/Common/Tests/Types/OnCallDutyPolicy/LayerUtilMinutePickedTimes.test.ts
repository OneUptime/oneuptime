import LayerUtil from "../../../Types/OnCallDutyPolicy/Layer";
import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import RestrictionTimes from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import Recurring from "../../../Types/Events/Recurring";
import User from "../../../Models/DatabaseModels/User";
import EventInterval from "../../../Types/Events/EventInterval";
import { describe, expect, test } from "@jest/globals";
import moment from "moment-timezone";

/*
 * A LAYER'S TURNS, WITH AND WITHOUT SECONDS IN ITS TIMES (issue #7593).
 *
 * Rotation starts at and First hand-off time are now picked to the minute,
 * and a new layer starts at the minute it is added in. Layers saved before
 * keep the seconds they were saved with (11/11/2026 08:00:17): nothing
 * rewrites a stored time, and a field left alone saves what it was given.
 * So the engine sees both kinds, side by side, and these pin that it pages
 * the same people either way:
 *
 *   - a layer saved with seconds hands off at those seconds, as it always
 *     has - its turns do not move;
 *   - a layer picked to the minute hands off on the minute;
 *   - the same people are on call on the same days either way;
 *   - a hand-off picked to the minute a layer saved with seconds starts in
 *     (08:00 against 08:00:17) - which the layer form lets through, since
 *     both read 08:00 - hands off as one at the start itself does.
 *
 * Every instant is built and read in the schedule's zone (New York), so it
 * holds whatever zone the suite runs in.
 */

const TZ: string = "America/New_York";

function user(id: string): User {
  return {
    id: {
      toString: () => {
        return id;
      },
    } as any,
  } as User;
}

function rotation(intervalType: EventInterval, count: number): Recurring {
  return Recurring.fromJSON({
    _type: "Recurring",
    value: {
      intervalType: intervalType,
      intervalCount: { _type: "PositiveNumber", value: count },
    },
  } as any);
}

// An instant that is `wallClock` ("2026-11-11 08:00:17") in the schedule's zone.
function at(wallClock: string): Date {
  return moment.tz(wallClock, "YYYY-MM-DD HH:mm:ss", TZ).toDate();
}

// Each turn as "who start -> end", read in the schedule's zone to the second.
function turns(events: Array<CalendarEvent>): Array<string> {
  return events.map((event: CalendarEvent): string => {
    return `${event.title} ${moment.tz(event.start, TZ).format("MM-DD HH:mm:ss")} -> ${moment.tz(event.end, TZ).format("MM-DD HH:mm:ss")}`;
  });
}

// Each turn as "who on day", which no second can change.
function whoOnWhichDay(events: Array<CalendarEvent>): Array<string> {
  return events.map((event: CalendarEvent): string => {
    return `${event.title} ${moment.tz(event.start, TZ).format("MM-DD HH:mm")}`;
  });
}

function dailyLayer(data: {
  startsAt: string;
  handOffAt: string;
  intervalType?: EventInterval;
  calendarEnd?: string;
}): Array<CalendarEvent> {
  return new LayerUtil().getEvents({
    users: [user("u1"), user("u2"), user("u3")],
    startDateTimeOfLayer: at(data.startsAt),
    handOffTime: at(data.handOffAt),
    restrictionTimes: RestrictionTimes.getDefault(),
    rotation: rotation(data.intervalType || EventInterval.Day, 1),
    timezone: TZ,
    calendarStartDate: at("2026-11-11 00:00:00"),
    calendarEndDate: at(data.calendarEnd || "2026-11-15 00:00:00"),
  });
}

describe("a layer's turns, with and without seconds", () => {
  test("a layer saved with seconds keeps handing off at them: its turns do not move", () => {
    expect(
      turns(
        dailyLayer({
          startsAt: "2026-11-11 08:00:17",
          handOffAt: "2026-11-12 08:00:17",
        }),
      ),
    ).toEqual([
      "u1 11-11 08:00:17 -> 11-12 08:00:17",
      "u2 11-12 08:00:18 -> 11-13 08:00:17",
      "u3 11-13 08:00:18 -> 11-14 08:00:17",
      "u1 11-14 08:00:18 -> 11-15 00:00:00",
    ]);
  });

  test("a layer picked to the minute hands off on the minute", () => {
    expect(
      turns(
        dailyLayer({
          startsAt: "2026-11-11 08:00:00",
          handOffAt: "2026-11-12 08:00:00",
        }),
      ),
    ).toEqual([
      "u1 11-11 08:00:00 -> 11-12 08:00:00",
      "u2 11-12 08:00:01 -> 11-13 08:00:00",
      "u3 11-13 08:00:01 -> 11-14 08:00:00",
      "u1 11-14 08:00:01 -> 11-15 00:00:00",
    ]);
  });

  test("either way, the same people are on call on the same days", () => {
    const withSeconds: Array<string> = whoOnWhichDay(
      dailyLayer({
        startsAt: "2026-11-11 08:00:17",
        handOffAt: "2026-11-12 08:00:17",
      }),
    );
    const toTheMinute: Array<string> = whoOnWhichDay(
      dailyLayer({
        startsAt: "2026-11-11 08:00:00",
        handOffAt: "2026-11-12 08:00:00",
      }),
    );

    expect(withSeconds).toEqual(toTheMinute);
    expect(withSeconds).toEqual([
      "u1 11-11 08:00",
      "u2 11-12 08:00",
      "u3 11-13 08:00",
      "u1 11-14 08:00",
    ]);
  });

  test("a hand-off picked to the minute a start with seconds is in hands off as one at the start does", () => {
    const atTheStart: Array<CalendarEvent> = dailyLayer({
      startsAt: "2026-11-11 08:00:17",
      handOffAt: "2026-11-11 08:00:17",
    });
    // 08:00 picked against a start saved at 08:00:17: 17 seconds before it.
    const pickedToTheMinute: Array<CalendarEvent> = dailyLayer({
      startsAt: "2026-11-11 08:00:17",
      handOffAt: "2026-11-11 08:00:00",
    });

    expect(whoOnWhichDay(pickedToTheMinute)).toEqual(whoOnWhichDay(atTheStart));
    expect(turns(pickedToTheMinute)).toEqual([
      "u1 11-11 08:00:17 -> 11-12 08:00:00",
      "u2 11-12 08:00:01 -> 11-13 08:00:00",
      "u3 11-13 08:00:01 -> 11-14 08:00:00",
      "u1 11-14 08:00:01 -> 11-15 00:00:00",
    ]);
  });

  test("a weekly layer saved with seconds keeps its wall clock, seconds and all, across a clock change", () => {
    // New York leaves daylight saving on 2026-11-01.
    const events: Array<CalendarEvent> = new LayerUtil().getEvents({
      users: [user("u1"), user("u2")],
      startDateTimeOfLayer: at("2026-10-26 08:00:17"),
      handOffTime: at("2026-10-26 08:00:17"),
      restrictionTimes: RestrictionTimes.getDefault(),
      rotation: rotation(EventInterval.Week, 1),
      timezone: TZ,
      calendarStartDate: at("2026-10-26 00:00:00"),
      calendarEndDate: at("2026-11-10 00:00:00"),
    });

    expect(turns(events)).toEqual([
      "u1 10-26 08:00:17 -> 11-02 08:00:17",
      "u2 11-02 08:00:18 -> 11-09 08:00:17",
      "u1 11-09 08:00:18 -> 11-10 00:00:00",
    ]);
  });
});
