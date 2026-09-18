import LayerUtil, { LayerProps } from "../../../Types/OnCallDutyPolicy/Layer";
import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import RestrictionTimes, {
  RestrictionType,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import Recurring from "../../../Types/Events/Recurring";
import OneUptimeDate from "../../../Types/Date";
import User from "../../../Models/DatabaseModels/User";
import EventInterval from "../../../Types/Events/EventInterval";

/*
 * Additional edge-case coverage for the on-call engine fixes: multi-interval
 * rotations of every unit, degenerate restrictions, nested multi-layer merges,
 * and single/empty-user rotations.
 */

function user(id: string): User {
  return {
    id: {
      toString: () => {
        return id;
      },
    } as any,
  } as User;
}

function rotation(
  intervalType: EventInterval,
  intervalCount: number,
): Recurring {
  return Recurring.fromJSON({
    _type: "Recurring",
    value: {
      intervalType: intervalType,
      intervalCount: { _type: "PositiveNumber", value: intervalCount },
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

const JAN1: Date = OneUptimeDate.getStartOfDay(new Date(2026, 0, 1, 0, 0, 0));

function dayOf(from: Date, d: Date): number {
  return Math.round(OneUptimeDate.getSecondsBetweenTwoDates(from, d) / 86400);
}

describe("LayerUtil edge: multi-interval rotations of every unit stay on boundaries", () => {
  test("every-3-days rotation with 2 users", () => {
    const util: LayerUtil = new LayerUtil();
    const calStart: Date = OneUptimeDate.addRemoveHours(
      OneUptimeDate.addRemoveDays(JAN1, 4),
      6,
    ); // day 4.25, inside [3,6]
    const calEnd: Date = OneUptimeDate.addRemoveDays(JAN1, 18);

    const events: Array<CalendarEvent> = util.getEvents({
      users: [user("A"), user("B")],
      startDateTimeOfLayer: JAN1,
      handOffTime: JAN1,
      restrictionTimes: noRestriction(),
      rotation: rotation(EventInterval.Day, 3),
      calendarStartDate: calStart,
      calendarEndDate: calEnd,
    });

    // Boundaries at multiples of 3 days.
    for (const e of events) {
      expect(dayOf(JAN1, e.end) % 3).toBe(0);
    }
    // At day 4.25 (interval [3,6]) the user is B; first handoff is day 6.
    expect(events[0]!.title).toBe("B");
    expect(dayOf(JAN1, events[0]!.end)).toBe(6);
  });

  test("every-2-weeks rotation lands on 14-day boundaries", () => {
    const util: LayerUtil = new LayerUtil();
    const calStart: Date = OneUptimeDate.addRemoveDays(JAN1, 20); // inside [14,28]
    const calEnd: Date = OneUptimeDate.addRemoveDays(JAN1, 60);

    const events: Array<CalendarEvent> = util.getEvents({
      users: [user("A"), user("B")],
      startDateTimeOfLayer: JAN1,
      handOffTime: JAN1,
      restrictionTimes: noRestriction(),
      rotation: rotation(EventInterval.Week, 2),
      calendarStartDate: calStart,
      calendarEndDate: calEnd,
    });

    // All but the final (calendar-clamped) event land on 14-day boundaries.
    for (const e of events.slice(0, -1)) {
      expect(dayOf(JAN1, e.end) % 14).toBe(0);
    }
    // First handoff after day 20 is day 28.
    expect(dayOf(JAN1, events[0]!.end)).toBe(28);
  });

  test("monthly rotation produces month-aligned handoffs", () => {
    const util: LayerUtil = new LayerUtil();
    const calStart: Date = new Date(2026, 3, 10, 0, 0, 0); // Apr 10
    const calEnd: Date = new Date(2026, 9, 1, 0, 0, 0); // Oct 1

    const events: Array<CalendarEvent> = util.getEvents({
      users: [user("A"), user("B")],
      startDateTimeOfLayer: JAN1,
      handOffTime: JAN1,
      restrictionTimes: noRestriction(),
      rotation: rotation(EventInterval.Month, 1),
      calendarStartDate: calStart,
      calendarEndDate: calEnd,
    });

    // Each handoff falls on the 1st of a month (same day-of-month as the anchor).
    for (const e of events.slice(0, events.length - 1)) {
      expect(e.end.getDate()).toBe(1);
    }
  });
});

describe("LayerUtil edge: degenerate restrictions", () => {
  test("restriction window entirely outside the event yields no events", () => {
    const util: LayerUtil = new LayerUtil();
    // Event window is only 00:00-06:00 each day (short calendar), restriction 09:00-17:00.
    const calStart: Date = JAN1;
    const calEnd: Date = OneUptimeDate.addRemoveHours(JAN1, 6); // 00:00-06:00

    const events: Array<CalendarEvent> = util.getEvents({
      users: [user("A")],
      startDateTimeOfLayer: JAN1,
      handOffTime: JAN1,
      restrictionTimes: dailyRestriction(9, 17),
      rotation: rotation(EventInterval.Day, 1),
      calendarStartDate: calStart,
      calendarEndDate: calEnd,
    });

    expect(events.length).toBe(0);
  });

  test("empty weekly restriction array does not zero out coverage", () => {
    const util: LayerUtil = new LayerUtil();
    const r: RestrictionTimes = new RestrictionTimes();
    r.restictionType = RestrictionType.Weekly;
    r.weeklyRestrictionTimes = [];

    const events: Array<CalendarEvent> = util.getEvents({
      users: [user("A")],
      startDateTimeOfLayer: JAN1,
      handOffTime: JAN1,
      restrictionTimes: r,
      rotation: rotation(EventInterval.Day, 1),
      calendarStartDate: JAN1,
      calendarEndDate: OneUptimeDate.addRemoveDays(JAN1, 2),
    });

    expect(events.length).toBeGreaterThan(0);
  });
});

describe("LayerUtil edge: multi-layer nesting", () => {
  test("three layers with staggered starts: highest priority active wins", () => {
    const util: LayerUtil = new LayerUtil();
    const start: Date = JAN1;
    const calEnd: Date = OneUptimeDate.addRemoveHours(start, 12);

    /*
     * A layer covers everything from its start onward (its rotation repeats),
     * so the highest-priority layer whose start has been reached wins. Priority
     * is layer order (layer1 highest).
     */
    const layer1: LayerProps = {
      users: [user("P1")],
      startDateTimeOfLayer: OneUptimeDate.addRemoveHours(start, 4), // active hour 4+
      handOffTime: OneUptimeDate.addRemoveHours(start, 8),
      restrictionTimes: noRestriction(),
      rotation: rotation(EventInterval.Hour, 4),
    };
    const layer2: LayerProps = {
      users: [user("P2")],
      startDateTimeOfLayer: OneUptimeDate.addRemoveHours(start, 2), // active hour 2+
      handOffTime: OneUptimeDate.addRemoveHours(start, 10),
      restrictionTimes: noRestriction(),
      rotation: rotation(EventInterval.Hour, 8),
    };
    const layer3: LayerProps = {
      users: [user("P3")],
      startDateTimeOfLayer: start, // active hour 0+
      handOffTime: OneUptimeDate.addRemoveHours(start, 12),
      restrictionTimes: noRestriction(),
      rotation: rotation(EventInterval.Hour, 12),
    };

    const events: Array<CalendarEvent> = util.getMultiLayerEvents({
      layers: [layer1, layer2, layer3],
      calendarStartDate: start,
      calendarEndDate: calEnd,
    });

    const at: (h: number) => string | null = (h: number): string | null => {
      const t: Date = OneUptimeDate.addRemoveMinutes(
        OneUptimeDate.addRemoveHours(start, h),
        30,
      ); // h:30
      for (const e of events) {
        if (t.getTime() >= e.start.getTime() && t.getTime() < e.end.getTime()) {
          return e.title;
        }
      }
      return null;
    };

    expect(at(0)).toBe("P3"); // only layer 3 has started
    expect(at(1)).toBe("P3");
    expect(at(2)).toBe("P2"); // layer 2 starts, beats layer 3
    expect(at(3)).toBe("P2");
    expect(at(5)).toBe("P1"); // layer 1 starts, beats all
    expect(at(9)).toBe("P1");
    expect(at(11)).toBe("P1");
  });
});

describe("LayerUtil edge: single-user and empty-user rotations", () => {
  test("single-user rotation always resolves to that user", () => {
    const util: LayerUtil = new LayerUtil();
    const events: Array<CalendarEvent> = util.getEvents({
      users: [user("solo")],
      startDateTimeOfLayer: JAN1,
      handOffTime: JAN1,
      restrictionTimes: noRestriction(),
      rotation: rotation(EventInterval.Day, 1),
      calendarStartDate: OneUptimeDate.addRemoveDays(JAN1, 100),
      calendarEndDate: OneUptimeDate.addRemoveDays(JAN1, 103),
    });
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.title).toBe("solo");
    }
  });

  test("empty user list yields no events", () => {
    const util: LayerUtil = new LayerUtil();
    const events: Array<CalendarEvent> = util.getEvents({
      users: [],
      startDateTimeOfLayer: JAN1,
      handOffTime: JAN1,
      restrictionTimes: noRestriction(),
      rotation: rotation(EventInterval.Day, 1),
      calendarStartDate: JAN1,
      calendarEndDate: OneUptimeDate.addRemoveDays(JAN1, 3),
    });
    expect(events.length).toBe(0);
  });
});
