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
import DayOfWeek from "../../../Types/Day/DayOfWeek";

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

function weeklyRestriction(
  windows: Array<{
    startDay: DayOfWeek;
    endDay: DayOfWeek;
    startHour: number;
    endHour: number;
  }>,
): RestrictionTimes {
  const r: RestrictionTimes = new RestrictionTimes();
  r.restictionType = RestrictionType.Weekly;
  r.dayRestrictionTimes = null;
  r.weeklyRestrictionTimes = windows.map(
    (w: {
      startDay: DayOfWeek;
      endDay: DayOfWeek;
      startHour: number;
      endHour: number;
    }): WeeklyResctriction => {
      return {
        startDay: w.startDay,
        endDay: w.endDay,
        startTime: OneUptimeDate.getDateWithCustomTime({
          hours: w.startHour,
          minutes: 0,
          seconds: 0,
        }),
        endTime: OneUptimeDate.getDateWithCustomTime({
          hours: w.endHour,
          minutes: 0,
          seconds: 0,
        }),
      };
    },
  );
  return r;
}

// Which user covers instant t in a single event list? half-open [start, end).
function coveringUser(events: Array<CalendarEvent>, t: Date): string | null {
  for (const e of events) {
    if (e.start.getTime() <= t.getTime() && e.end.getTime() > t.getTime()) {
      return e.title;
    }
  }
  return null;
}

/*
 * Oracle: expected on-call user at instant t across layers, resolved by priority
 * (lowest layer index that covers t wins). Uses each layer's own getEvents.
 */
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

// Returns overlapping pairs (real double-coverage, more than the 1s seam).
function overlappingPairs(
  events: Array<CalendarEvent>,
): Array<[CalendarEvent, CalendarEvent]> {
  const pairs: Array<[CalendarEvent, CalendarEvent]> = [];
  for (let i: number = 0; i < events.length; i++) {
    for (let j: number = i + 1; j < events.length; j++) {
      const a: CalendarEvent = events[i]!;
      const b: CalendarEvent = events[j]!;
      // overlap in seconds of [a.start,a.end) ∩ [b.start,b.end)
      const start: number = Math.max(a.start.getTime(), b.start.getTime());
      const end: number = Math.min(a.end.getTime(), b.end.getTime());
      if (end - start > 0) {
        pairs.push([a, b]);
      }
    }
  }
  return pairs;
}

describe("Multi-layer priority merge audit (lens: getMultiLayerEvents / removeOverlappingEvents)", () => {
  const util: LayerUtil = new LayerUtil();

  /*
   * Runs the merge and compares against the per-layer priority oracle at many
   * instants. Also asserts no real overlap (no double paging).
   */
  function checkMerge(
    layers: Array<LayerProps>,
    calStart: Date,
    calEnd: Date,
    sampleStepMinutes: number = 30,
  ): { mismatches: Array<string>; overlaps: number } {
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

    // Sample instants offset by 17s from clean boundaries to avoid 1s seams.
    for (
      let ms: number = calStart.getTime() + 17000;
      ms < calEnd.getTime();
      ms += sampleStepMinutes * 60 * 1000
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

    const overlaps: Array<[CalendarEvent, CalendarEvent]> =
      overlappingPairs(merged);

    return { mismatches: mismatches, overlaps: overlaps.length };
  }

  test("Scenario A: three 24/7 layers, different rotations -> highest priority always wins, no gaps/overlaps", () => {
    const calStart: Date = new Date(2026, 0, 5, 0, 0, 0); // Mon Jan 5 2026
    const calEnd: Date = new Date(2026, 0, 26, 0, 0, 0); // 3 weeks

    const layers: Array<LayerProps> = [
      {
        users: [user("A1"), user("A2")],
        startDateTimeOfLayer: calStart,
        restrictionTimes: noRestriction(),
        handOffTime: calStart,
        rotation: rotation(EventInterval.Week, 1),
      },
      {
        users: [user("B1"), user("B2"), user("B3")],
        startDateTimeOfLayer: calStart,
        restrictionTimes: noRestriction(),
        handOffTime: calStart,
        rotation: rotation(EventInterval.Day, 2),
      },
      {
        users: [user("C1")],
        startDateTimeOfLayer: calStart,
        restrictionTimes: noRestriction(),
        handOffTime: calStart,
        rotation: rotation(EventInterval.Week, 1),
      },
    ];

    const { mismatches, overlaps } = checkMerge(layers, calStart, calEnd);
    // Layer 0 is 24/7, so it always wins; every instant should be A1/A2.
    expect(mismatches).toEqual([]);
    expect(overlaps).toBe(0);
  });

  test("Scenario B: business-hours primary (Daily 09-17) over 24/7 fallback", () => {
    const calStart: Date = new Date(2026, 0, 5, 0, 0, 0);
    const calEnd: Date = new Date(2026, 0, 19, 0, 0, 0); // 2 weeks

    const layers: Array<LayerProps> = [
      {
        users: [user("P1"), user("P2")],
        startDateTimeOfLayer: calStart,
        restrictionTimes: dailyRestriction(9, 17),
        handOffTime: new Date(2026, 0, 5, 12, 0, 0),
        rotation: rotation(EventInterval.Day, 1),
      },
      {
        users: [user("F1"), user("F2")],
        startDateTimeOfLayer: calStart,
        restrictionTimes: noRestriction(),
        handOffTime: calStart,
        rotation: rotation(EventInterval.Week, 1),
      },
    ];

    const { mismatches, overlaps } = checkMerge(layers, calStart, calEnd);
    expect(mismatches).toEqual([]);
    expect(overlaps).toBe(0);
  });

  test("Scenario C: TWO restricted primaries over a 24/7 fallback (3 layers)", () => {
    const calStart: Date = new Date(2026, 0, 5, 0, 0, 0);
    const calEnd: Date = new Date(2026, 0, 19, 0, 0, 0);

    const layers: Array<LayerProps> = [
      // Highest: mornings 06-10
      {
        users: [user("M1"), user("M2")],
        startDateTimeOfLayer: calStart,
        restrictionTimes: dailyRestriction(6, 10),
        handOffTime: new Date(2026, 0, 5, 8, 0, 0),
        rotation: rotation(EventInterval.Day, 1),
      },
      // Middle: afternoons 14-18
      {
        users: [user("N1"), user("N2")],
        startDateTimeOfLayer: calStart,
        restrictionTimes: dailyRestriction(14, 18),
        handOffTime: new Date(2026, 0, 5, 16, 0, 0),
        rotation: rotation(EventInterval.Day, 1),
      },
      // Fallback: 24/7
      {
        users: [user("Z1")],
        startDateTimeOfLayer: calStart,
        restrictionTimes: noRestriction(),
        handOffTime: calStart,
        rotation: rotation(EventInterval.Week, 1),
      },
    ];

    const { mismatches, overlaps } = checkMerge(layers, calStart, calEnd);
    expect(mismatches).toEqual([]);
    expect(overlaps).toBe(0);
  });

  test("Scenario D: overlapping restricted primaries (both high priority) over fallback", () => {
    const calStart: Date = new Date(2026, 0, 5, 0, 0, 0);
    const calEnd: Date = new Date(2026, 0, 12, 0, 0, 0);

    const layers: Array<LayerProps> = [
      // Highest: 08-14
      {
        users: [user("H1")],
        startDateTimeOfLayer: calStart,
        restrictionTimes: dailyRestriction(8, 14),
        handOffTime: calStart,
        rotation: rotation(EventInterval.Week, 1),
      },
      // Second: 10-18 (OVERLAPS the first at 10-14)
      {
        users: [user("K1")],
        startDateTimeOfLayer: calStart,
        restrictionTimes: dailyRestriction(10, 18),
        handOffTime: calStart,
        rotation: rotation(EventInterval.Week, 1),
      },
      // Fallback 24/7
      {
        users: [user("Z1")],
        startDateTimeOfLayer: calStart,
        restrictionTimes: noRestriction(),
        handOffTime: calStart,
        rotation: rotation(EventInterval.Week, 1),
      },
    ];

    const { mismatches, overlaps } = checkMerge(layers, calStart, calEnd);
    expect(mismatches).toEqual([]);
    expect(overlaps).toBe(0);
  });

  test("Scenario E: weekly-restricted primary (weekdays only) over 24/7 fallback", () => {
    const calStart: Date = new Date(2026, 0, 5, 0, 0, 0); // Mon
    const calEnd: Date = new Date(2026, 0, 26, 0, 0, 0);

    const layers: Array<LayerProps> = [
      {
        users: [user("W1"), user("W2")],
        startDateTimeOfLayer: calStart,
        restrictionTimes: weeklyRestriction([
          {
            startDay: DayOfWeek.Monday,
            endDay: DayOfWeek.Friday,
            startHour: 9,
            endHour: 17,
          },
        ]),
        handOffTime: new Date(2026, 0, 5, 12, 0, 0),
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
    expect(mismatches).toEqual([]);
    expect(overlaps).toBe(0);
  });

  test("Scenario F: fast rotation primary (hourly) restricted over fallback", () => {
    const calStart: Date = new Date(2026, 0, 5, 0, 0, 0);
    const calEnd: Date = new Date(2026, 0, 8, 0, 0, 0);

    const layers: Array<LayerProps> = [
      {
        users: [user("A"), user("B"), user("C")],
        startDateTimeOfLayer: calStart,
        restrictionTimes: dailyRestriction(9, 17),
        handOffTime: new Date(2026, 0, 5, 9, 0, 0),
        rotation: rotation(EventInterval.Hour, 1),
      },
      {
        users: [user("Z")],
        startDateTimeOfLayer: calStart,
        restrictionTimes: noRestriction(),
        handOffTime: calStart,
        rotation: rotation(EventInterval.Week, 1),
      },
    ];

    const { mismatches, overlaps } = checkMerge(layers, calStart, calEnd, 7);
    expect(mismatches).toEqual([]);
    expect(overlaps).toBe(0);
  });
});
