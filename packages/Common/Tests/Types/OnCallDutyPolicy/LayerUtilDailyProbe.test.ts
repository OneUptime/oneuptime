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

function dailyRestrictionHM(
  sH: number,
  sM: number,
  eH: number,
  eM: number,
): RestrictionTimes {
  const r: RestrictionTimes = new RestrictionTimes();
  r.restictionType = RestrictionType.Daily;
  r.dayRestrictionTimes = {
    startTime: OneUptimeDate.getDateWithCustomTime({
      hours: sH,
      minutes: sM,
      seconds: 0,
    }),
    endTime: OneUptimeDate.getDateWithCustomTime({
      hours: eH,
      minutes: eM,
      seconds: 0,
    }),
  };
  return r;
}

function fmt(d: Date): string {
  return OneUptimeDate.toString(d);
}

function dump(label: string, events: Array<CalendarEvent>): void {
  // eslint-disable-next-line no-console
  console.log(`\n=== ${label} (${events.length} events) ===`);
  for (const e of events) {
    // eslint-disable-next-line no-console
    console.log(`  ${e.title}: ${fmt(e.start)}  ->  ${fmt(e.end)}`);
  }
}

function coveringUser(events: Array<CalendarEvent>, t: Date): string | null {
  for (const e of events) {
    if (e.start.getTime() <= t.getTime() && e.end.getTime() > t.getTime()) {
      return e.title;
    }
  }
  return null;
}

describe("Daily restriction probe", () => {
  test("A) full-day 00:00 -> 23:59 daily restriction, daily rotation midnight handoff", () => {
    const layerUtil: LayerUtil = new LayerUtil();
    const layerStart: Date = new Date(2026, 0, 5, 0, 0, 0);
    const events: Array<CalendarEvent> = layerUtil.getEvents({
      users: [user("A"), user("B")],
      startDateTimeOfLayer: layerStart,
      restrictionTimes: dailyRestrictionHM(0, 0, 23, 59),
      handOffTime: new Date(2026, 0, 5, 0, 0, 0),
      rotation: rotation(EventInterval.Day, 1),
      calendarStartDate: layerStart,
      calendarEndDate: new Date(2026, 0, 8, 0, 0, 0),
    });
    dump("A full-day 00:00-23:59", events);
    // check coverage at various instants
    // eslint-disable-next-line no-console
    console.log(
      "cover Jan6 23:59:30 =",
      coveringUser(events, new Date(2026, 0, 6, 23, 59, 30)),
    );
    // eslint-disable-next-line no-console
    console.log(
      "cover Jan6 12:00 =",
      coveringUser(events, new Date(2026, 0, 6, 12, 0, 0)),
    );
  });

  test("B) 00:00 -> 00:00 daily restriction (user may intend all-day)", () => {
    const layerUtil: LayerUtil = new LayerUtil();
    const layerStart: Date = new Date(2026, 0, 5, 0, 0, 0);
    const events: Array<CalendarEvent> = layerUtil.getEvents({
      users: [user("A")],
      startDateTimeOfLayer: layerStart,
      restrictionTimes: dailyRestrictionHM(0, 0, 0, 0),
      handOffTime: new Date(2026, 0, 5, 0, 0, 0),
      rotation: rotation(EventInterval.Day, 1),
      calendarStartDate: layerStart,
      calendarEndDate: new Date(2026, 0, 8, 0, 0, 0),
    });
    dump("B 00:00-00:00", events);
  });

  test("C) in-place mutation of dayRestrictionTimes", () => {
    const layerUtil: LayerUtil = new LayerUtil();
    const layerStart: Date = new Date(2026, 0, 5, 0, 0, 0);
    const r: RestrictionTimes = dailyRestrictionHM(9, 0, 17, 0);
    const beforeStart: Date = r.dayRestrictionTimes!.startTime;
    const beforeEnd: Date = r.dayRestrictionTimes!.endTime;
    // eslint-disable-next-line no-console
    console.log("BEFORE start:", fmt(beforeStart), "end:", fmt(beforeEnd));
    layerUtil.getEvents({
      users: [user("A"), user("B")],
      startDateTimeOfLayer: layerStart,
      restrictionTimes: r,
      handOffTime: new Date(2026, 0, 5, 12, 0, 0),
      rotation: rotation(EventInterval.Day, 1),
      calendarStartDate: layerStart,
      calendarEndDate: new Date(2026, 0, 15, 0, 0, 0),
    });
    // eslint-disable-next-line no-console
    console.log(
      "AFTER  start:",
      fmt(r.dayRestrictionTimes!.startTime),
      "end:",
      fmt(r.dayRestrictionTimes!.endTime),
    );
  });

  test("D) overnight 22:00 -> 06:00, daily rotation 09:00 handoff, coverage completeness", () => {
    const layerUtil: LayerUtil = new LayerUtil();
    const layerStart: Date = new Date(2026, 0, 5, 9, 0, 0);
    const events: Array<CalendarEvent> = layerUtil.getEvents({
      users: [user("A"), user("B")],
      startDateTimeOfLayer: layerStart,
      restrictionTimes: dailyRestrictionHM(22, 0, 6, 0),
      handOffTime: new Date(2026, 0, 5, 9, 0, 0),
      rotation: rotation(EventInterval.Day, 1),
      calendarStartDate: layerStart,
      calendarEndDate: new Date(2026, 0, 9, 0, 0, 0),
    });
    dump("D overnight 22-06", events);
    for (const [label, t] of [
      ["Jan5 23:00", new Date(2026, 0, 5, 23, 0, 0)],
      ["Jan6 03:00", new Date(2026, 0, 6, 3, 0, 0)],
      ["Jan6 06:00", new Date(2026, 0, 6, 6, 0, 0)],
      ["Jan6 12:00", new Date(2026, 0, 6, 12, 0, 0)],
      ["Jan6 22:00", new Date(2026, 0, 6, 22, 0, 0)],
    ] as Array<[string, Date]>) {
      // eslint-disable-next-line no-console
      console.log(`cover ${label} =`, coveringUser(events, t));
    }
  });

  test("E) live 1-second window at overnight boundary instants", () => {
    const layerUtil: LayerUtil = new LayerUtil();
    const resolveAt: (now: Date) => string | null = (
      now: Date,
    ): string | null => {
      const events: Array<CalendarEvent> = layerUtil.getMultiLayerEvents(
        {
          layers: [
            {
              users: [user("A"), user("B")],
              startDateTimeOfLayer: new Date(2026, 0, 5, 9, 0, 0),
              restrictionTimes: dailyRestrictionHM(22, 0, 6, 0),
              handOffTime: new Date(2026, 0, 5, 9, 0, 0),
              rotation: rotation(EventInterval.Day, 1),
            },
          ],
          calendarStartDate: now,
          calendarEndDate: OneUptimeDate.addRemoveSeconds(now, 1),
        },
        { getNumberOfEvents: 1 },
      );
      return events[0]?.title ?? null;
    };
    for (const [label, t] of [
      ["Jan6 05:59:59", new Date(2026, 0, 6, 5, 59, 59)],
      ["Jan6 06:00:00", new Date(2026, 0, 6, 6, 0, 0)],
      ["Jan6 21:59:59", new Date(2026, 0, 6, 21, 59, 59)],
      ["Jan6 22:00:00", new Date(2026, 0, 6, 22, 0, 0)],
      ["Jan6 00:00:00", new Date(2026, 0, 6, 0, 0, 0)],
    ] as Array<[string, Date]>) {
      // eslint-disable-next-line no-console
      console.log(`live ${label} =`, resolveAt(t));
    }
  });
});
