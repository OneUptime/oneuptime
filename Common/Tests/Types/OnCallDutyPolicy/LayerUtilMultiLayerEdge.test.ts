import LayerUtil, { LayerProps } from "../../../Types/OnCallDutyPolicy/Layer";
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

function noRestriction(): RestrictionTimes {
  const r: RestrictionTimes = new RestrictionTimes();
  r.restictionType = RestrictionType.None;
  r.dayRestrictionTimes = null;
  return r;
}

function dailyRestriction(
  startHour: number,
  endHour: number,
): RestrictionTimes {
  const r: RestrictionTimes = new RestrictionTimes();
  r.restictionType = RestrictionType.Daily;
  r.dayRestrictionTimes = {
    startTime: OneUptimeDate.getDateWithCustomTime({
      hours: startHour,
      minutes: 0,
      seconds: 0,
    }),
    endTime: OneUptimeDate.getDateWithCustomTime({
      hours: endHour,
      minutes: 0,
      seconds: 0,
    }),
  };
  return r;
}

function coveringUser(events: Array<CalendarEvent>, t: Date): string | null {
  for (const e of events) {
    if (e.start.getTime() <= t.getTime() && e.end.getTime() > t.getTime()) {
      return e.title;
    }
  }
  return null;
}

function oracleUser(
  perLayerEvents: Array<Array<CalendarEvent>>,
  t: Date,
): string | null {
  for (const layerEvents of perLayerEvents) {
    const u: string | null = coveringUser(layerEvents, t);
    if (u !== null) {
      return u;
    }
  }
  return null;
}

function overlappingPairs(
  events: Array<CalendarEvent>,
): Array<[CalendarEvent, CalendarEvent]> {
  const pairs: Array<[CalendarEvent, CalendarEvent]> = [];
  for (let i: number = 0; i < events.length; i++) {
    for (let j: number = i + 1; j < events.length; j++) {
      const a: CalendarEvent = events[i]!;
      const b: CalendarEvent = events[j]!;
      const start: number = Math.max(a.start.getTime(), b.start.getTime());
      const end: number = Math.min(a.end.getTime(), b.end.getTime());
      if (end - start > 0) {
        pairs.push([a, b]);
      }
    }
  }
  return pairs;
}

describe("Multi-layer edge cases", () => {
  const util: LayerUtil = new LayerUtil();

  function checkMerge(
    layers: Array<LayerProps>,
    calStart: Date,
    calEnd: Date,
    stepMin: number = 15,
  ): { mismatches: Array<string>; overlaps: number; merged: Array<CalendarEvent> } {
    const merged: Array<CalendarEvent> = util.getMultiLayerEvents({
      layers: layers,
      calendarStartDate: calStart,
      calendarEndDate: calEnd,
    });
    const perLayerEvents: Array<Array<CalendarEvent>> = layers.map(
      (layer: LayerProps): Array<CalendarEvent> => {
        return util.getEvents({
          ...layer,
          calendarStartDate: calStart,
          calendarEndDate: calEnd,
        });
      },
    );
    const mismatches: Array<string> = [];
    for (
      let ms: number = calStart.getTime() + 17000;
      ms < calEnd.getTime();
      ms += stepMin * 60 * 1000
    ) {
      const t: Date = new Date(ms);
      const expected: string | null = oracleUser(perLayerEvents, t);
      const actual: string | null = coveringUser(merged, t);
      if (expected !== actual) {
        mismatches.push(
          `${OneUptimeDate.toString(t)} expected=${expected} actual=${actual}`,
        );
      }
    }
    return {
      mismatches: mismatches,
      overlaps: overlappingPairs(merged).length,
      merged: merged,
    };
  }

  test("G: high-priority layer starts 2 days into a 5-day window; fallback fills the head", () => {
    const calStart: Date = new Date(2026, 0, 5, 0, 0, 0);
    const primaryStart: Date = new Date(2026, 0, 7, 0, 0, 0); // 2 days later
    const calEnd: Date = new Date(2026, 0, 10, 0, 0, 0);

    const layers: Array<LayerProps> = [
      {
        users: [user("P1"), user("P2")],
        startDateTimeOfLayer: primaryStart,
        restrictionTimes: noRestriction(),
        handOffTime: primaryStart,
        rotation: rotation(EventInterval.Day, 1),
      },
      {
        users: [user("F1")],
        startDateTimeOfLayer: calStart,
        restrictionTimes: noRestriction(),
        handOffTime: calStart,
        rotation: rotation(EventInterval.Week, 1),
      },
    ];

    const { mismatches, overlaps } = checkMerge(layers, calStart, calEnd);
    // First 2 days: fallback F1. After primaryStart: P1/P2 daily.
    expect(mismatches).toEqual([]);
    expect(overlaps).toBe(0);
  });

  test("H: three layers with different start offsets and rotations", () => {
    const calStart: Date = new Date(2026, 0, 5, 0, 0, 0);
    const calEnd: Date = new Date(2026, 0, 9, 0, 0, 0);

    const layers: Array<LayerProps> = [
      {
        users: [user("A")],
        startDateTimeOfLayer: new Date(2026, 0, 6, 12, 0, 0),
        restrictionTimes: dailyRestriction(0, 6),
        handOffTime: new Date(2026, 0, 6, 12, 0, 0),
        rotation: rotation(EventInterval.Day, 1),
      },
      {
        users: [user("B1"), user("B2")],
        startDateTimeOfLayer: new Date(2026, 0, 5, 6, 0, 0),
        restrictionTimes: dailyRestriction(8, 20),
        handOffTime: new Date(2026, 0, 5, 12, 0, 0),
        rotation: rotation(EventInterval.Hour, 6),
      },
      {
        users: [user("Z")],
        startDateTimeOfLayer: calStart,
        restrictionTimes: noRestriction(),
        handOffTime: calStart,
        rotation: rotation(EventInterval.Week, 1),
      },
    ];

    const { mismatches, overlaps } = checkMerge(layers, calStart, calEnd, 10);
    expect(mismatches).toEqual([]);
    expect(overlaps).toBe(0);
  });

  test("I: three layers all starting at window start (equal starts) -> priority order", () => {
    const calStart: Date = new Date(2026, 0, 5, 0, 0, 0);
    const calEnd: Date = new Date(2026, 0, 12, 0, 0, 0);

    const layers: Array<LayerProps> = [
      {
        users: [user("A")],
        startDateTimeOfLayer: calStart,
        restrictionTimes: noRestriction(),
        handOffTime: calStart,
        rotation: rotation(EventInterval.Week, 1),
      },
      {
        users: [user("B")],
        startDateTimeOfLayer: calStart,
        restrictionTimes: noRestriction(),
        handOffTime: calStart,
        rotation: rotation(EventInterval.Day, 1),
      },
      {
        users: [user("C")],
        startDateTimeOfLayer: calStart,
        restrictionTimes: noRestriction(),
        handOffTime: calStart,
        rotation: rotation(EventInterval.Hour, 1),
      },
    ];

    const { mismatches, overlaps } = checkMerge(layers, calStart, calEnd, 13);
    // Layer 0 (A) is 24/7 highest priority -> A everywhere.
    expect(mismatches).toEqual([]);
    expect(overlaps).toBe(0);
  });

  test("J: high-priority restricted layer over a RESTRICTED (non-24/7) fallback leaving true gaps", () => {
    // Both layers restricted; there are genuine uncovered periods (oracle=null).
    const calStart: Date = new Date(2026, 0, 5, 0, 0, 0);
    const calEnd: Date = new Date(2026, 0, 9, 0, 0, 0);

    const layers: Array<LayerProps> = [
      {
        users: [user("A")],
        startDateTimeOfLayer: calStart,
        restrictionTimes: dailyRestriction(9, 12),
        handOffTime: calStart,
        rotation: rotation(EventInterval.Week, 1),
      },
      {
        users: [user("B")],
        startDateTimeOfLayer: calStart,
        restrictionTimes: dailyRestriction(10, 17), // overlaps A at 10-12
        handOffTime: calStart,
        rotation: rotation(EventInterval.Week, 1),
      },
    ];

    const { mismatches, overlaps } = checkMerge(layers, calStart, calEnd, 11);
    // Expect: A owns 9-12, B owns 12:00:01-17, nobody owns nights.
    expect(mismatches).toEqual([]);
    expect(overlaps).toBe(0);
  });

  test("K: primary rotation window exactly abuts fallback stitch boundary", () => {
    // Primary hourly restricted 10-14; fallback 24/7. Check the exact 10:00 and
    // 14:00 boundaries via the merged output shape (no overlaps, contiguous).
    const calStart: Date = new Date(2026, 0, 5, 0, 0, 0);
    const calEnd: Date = new Date(2026, 0, 7, 0, 0, 0);

    const layers: Array<LayerProps> = [
      {
        users: [user("A"), user("B")],
        startDateTimeOfLayer: calStart,
        restrictionTimes: dailyRestriction(10, 14),
        handOffTime: new Date(2026, 0, 5, 12, 0, 0),
        rotation: rotation(EventInterval.Hour, 2),
      },
      {
        users: [user("Z")],
        startDateTimeOfLayer: calStart,
        restrictionTimes: noRestriction(),
        handOffTime: calStart,
        rotation: rotation(EventInterval.Week, 1),
      },
    ];

    const { mismatches, overlaps } = checkMerge(layers, calStart, calEnd, 5);
    expect(mismatches).toEqual([]);
    expect(overlaps).toBe(0);
  });
});
