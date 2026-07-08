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

/*
 * These tests lock down the on-call rotation/restriction correctness fixes with
 * EXACT assertions (dates + user identities), covering the cases the previous
 * suite missed: intervalCount >= 2, long-lived rotations, wrap-around weekly
 * restrictions, overnight daily restrictions, and multi-layer "next" roster.
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

// Returns the Monday 00:00 (local) of the week containing `base`.
function mondayOf(base: Date): Date {
  const startOfWeek: Date = OneUptimeDate.getStartOfTheWeek(base); // Sunday
  return OneUptimeDate.addRemoveDays(startOfWeek, 1); // Monday
}

// Is time T covered by any event? (start <= T < end)
function coveringEvent(
  events: Array<CalendarEvent>,
  t: Date,
): CalendarEvent | null {
  for (const e of events) {
    if (
      OneUptimeDate.isOnOrAfter(t, e.start) &&
      OneUptimeDate.isBefore(t, e.end)
    ) {
      return e;
    }
  }
  return null;
}

describe("LayerUtil HIGH-1: intervalCount >= 2 rotation stays on boundaries", () => {
  test("every-2-days rotation keeps handoffs on even-day boundaries from a mid-interval preview", () => {
    const util: LayerUtil = new LayerUtil();
    // Fixed Jan 2026 (no DST transitions) local midnight anchor.
    const layerStart: Date = OneUptimeDate.getStartOfDay(
      new Date(2026, 0, 1, 0, 0, 0),
    );

    // Preview window starts 2.5 days in (mid second interval [day2,day4]).
    const calStart: Date = OneUptimeDate.addRemoveHours(
      OneUptimeDate.addRemoveDays(layerStart, 2),
      12,
    );
    const calEnd: Date = OneUptimeDate.addRemoveDays(layerStart, 12);

    const layer: LayerProps = {
      users: [user("A"), user("B")],
      startDateTimeOfLayer: layerStart,
      handOffTime: layerStart,
      restrictionTimes: noRestriction(),
      rotation: rotation(EventInterval.Day, 2),
    };

    const events: Array<CalendarEvent> = util.getEvents({
      ...layer,
      calendarStartDate: calStart,
      calendarEndDate: calEnd,
    });

    const dayOf: (d: Date) => number = (d: Date): number => {
      return Math.round(
        OneUptimeDate.getSecondsBetweenTwoDates(layerStart, d) / 86400,
      );
    };

    // First event must END at day 4 (the true next boundary), not day 5.
    expect(dayOf(events[0]!.end)).toBe(4);
    // The current user at day 2.5 is B (interval [day2,day4]).
    expect(events[0]!.title).toBe("B");

    // Every event boundary is an even number of days from the layer start.
    for (const e of events) {
      expect(dayOf(e.end) % 2).toBe(0);
    }

    // Users alternate B, A, B, A ...
    expect(events.slice(0, 4).map((e: CalendarEvent) => e.title)).toEqual([
      "B",
      "A",
      "B",
      "A",
    ]);
  });

  test("every-3-hours rotation lands on 3-hour boundaries", () => {
    const util: LayerUtil = new LayerUtil();
    const layerStart: Date = OneUptimeDate.getStartOfDay(
      new Date(2026, 0, 1, 0, 0, 0),
    );
    // Preview from 10:30 (inside interval [9:00,12:00]).
    const calStart: Date = OneUptimeDate.addRemoveHours(
      OneUptimeDate.addRemoveMinutes(layerStart, 30),
      10,
    );
    const calEnd: Date = OneUptimeDate.addRemoveHours(layerStart, 24);

    const events: Array<CalendarEvent> = util.getEvents({
      users: [user("A"), user("B"), user("C")],
      startDateTimeOfLayer: layerStart,
      handOffTime: layerStart,
      restrictionTimes: noRestriction(),
      rotation: rotation(EventInterval.Hour, 3),
      calendarStartDate: calStart,
      calendarEndDate: calEnd,
    });

    const hourOf: (d: Date) => number = (d: Date): number => {
      return Math.round(
        OneUptimeDate.getSecondsBetweenTwoDates(layerStart, d) / 3600,
      );
    };

    // First handoff must be at hour 12, not 14.
    expect(hourOf(events[0]!.end)).toBe(12);
    // Every boundary is a multiple of 3 hours.
    for (const e of events) {
      expect(hourOf(e.end) % 3).toBe(0);
    }
  });

  test("intervalCount = 1 daily rotation is unchanged (regression guard)", () => {
    const util: LayerUtil = new LayerUtil();
    const layerStart: Date = OneUptimeDate.getStartOfDay(
      new Date(2026, 0, 1, 0, 0, 0),
    );
    const calStart: Date = OneUptimeDate.addRemoveHours(
      OneUptimeDate.addRemoveDays(layerStart, 3),
      6,
    );
    const calEnd: Date = OneUptimeDate.addRemoveDays(layerStart, 8);

    const events: Array<CalendarEvent> = util.getEvents({
      users: [user("A"), user("B")],
      startDateTimeOfLayer: layerStart,
      handOffTime: layerStart,
      restrictionTimes: noRestriction(),
      rotation: rotation(EventInterval.Day, 1),
      calendarStartDate: calStart,
      calendarEndDate: calEnd,
    });

    const dayOf: (d: Date) => number = (d: Date): number => {
      return Math.round(
        OneUptimeDate.getSecondsBetweenTwoDates(layerStart, d) / 86400,
      );
    };
    // First handoff after day 3.25 is day 4.
    expect(dayOf(events[0]!.end)).toBe(4);
    // day 3 (index 3) -> user B (0-indexed: day0=A,1=B,2=A,3=B).
    expect(events[0]!.title).toBe("B");
  });
});

describe("LayerUtil M-7 defense: invalid rotation interval does not hang or crash", () => {
  test("intervalCount = 0 is clamped to a single unit (no infinite loop)", () => {
    const util: LayerUtil = new LayerUtil();
    const layerStart: Date = OneUptimeDate.getStartOfDay(
      new Date(2026, 0, 1, 0, 0, 0),
    );
    const calEnd: Date = OneUptimeDate.addRemoveDays(layerStart, 4);

    const events: Array<CalendarEvent> = util.getEvents({
      users: [user("A"), user("B")],
      startDateTimeOfLayer: layerStart,
      handOffTime: layerStart,
      restrictionTimes: noRestriction(),
      rotation: rotation(EventInterval.Day, 0), // invalid -> clamped to 1
      calendarStartDate: layerStart,
      calendarEndDate: calEnd,
    });

    // Should terminate and produce daily events (treated as intervalCount 1).
    expect(events.length).toBeGreaterThan(0);
    const dayOf: (d: Date) => number = (d: Date): number => {
      return Math.round(
        OneUptimeDate.getSecondsBetweenTwoDates(layerStart, d) / 86400,
      );
    };
    expect(dayOf(events[0]!.end)).toBe(1);
  });
});

describe("LayerUtil M-1: long-lived rotation resolves the correct current user (no 10000 cap)", () => {
  test("hourly rotation 12000 hours after start resolves the analytically-correct user", () => {
    const util: LayerUtil = new LayerUtil();
    const layerStart: Date = OneUptimeDate.getStartOfDay(
      new Date(2024, 0, 1, 0, 0, 0),
    );
    // 12000 hours later (well past the old 10000-iteration cap).
    const calStart: Date = OneUptimeDate.addRemoveHours(layerStart, 12000);
    const calEnd: Date = OneUptimeDate.addRemoveHours(calStart, 5);

    const events: Array<CalendarEvent> = util.getEvents({
      users: [user("A"), user("B"), user("C")],
      startDateTimeOfLayer: layerStart,
      handOffTime: layerStart,
      restrictionTimes: noRestriction(),
      rotation: rotation(EventInterval.Hour, 1),
      calendarStartDate: calStart,
      calendarEndDate: calEnd,
    });

    // 12000 boundaries elapsed -> index 12000 % 3 = 0 -> user A.
    // The old capped simulation returned 10000 % 3 = 1 -> user B (wrong).
    expect(events[0]!.title).toBe("A");
  });
});

describe("LayerUtil HIGH-2: weekly wrap-around restriction has no phantom nightly windows", () => {
  test("Fri 22:00 -> Mon 06:00 covers weekend only, not Tue/Wed/Thu nights", () => {
    const util: LayerUtil = new LayerUtil();
    const monday: Date = mondayOf(new Date(2026, 1, 15)); // February, no DST
    const calEnd: Date = OneUptimeDate.addRemoveDays(monday, 7);

    const friday22: Date = OneUptimeDate.addRemoveHours(
      OneUptimeDate.addRemoveDays(monday, 4),
      22,
    );
    const monday06: Date = OneUptimeDate.addRemoveHours(monday, 6);

    const weekly: WeeklyResctriction = {
      startDay: DayOfWeek.Friday,
      endDay: DayOfWeek.Monday,
      startTime: friday22,
      endTime: monday06,
    };
    const restrictionTimes: RestrictionTimes = new RestrictionTimes();
    restrictionTimes.restictionType = RestrictionType.Weekly;
    restrictionTimes.weeklyRestrictionTimes = [weekly];

    const events: Array<CalendarEvent> = util.getEvents({
      users: [user("u1")],
      startDateTimeOfLayer: monday,
      handOffTime: OneUptimeDate.addRemoveWeeks(monday, 1),
      restrictionTimes: restrictionTimes,
      rotation: rotation(EventInterval.Week, 1),
      calendarStartDate: monday,
      calendarEndDate: calEnd,
    });

    // Weekend nights ARE covered.
    const sat02: Date = OneUptimeDate.addRemoveHours(
      OneUptimeDate.addRemoveDays(monday, 5),
      2,
    );
    expect(coveringEvent(events, sat02)).not.toBeNull();

    // The Monday-morning tail (00:00-06:00) of the prior weekend IS covered.
    const mon03: Date = OneUptimeDate.addRemoveHours(monday, 3);
    expect(coveringEvent(events, mon03)).not.toBeNull();

    // Mid-week nights are NOT covered (these were the phantom windows).
    const tue02: Date = OneUptimeDate.addRemoveHours(
      OneUptimeDate.addRemoveDays(monday, 1),
      2,
    );
    const wed02: Date = OneUptimeDate.addRemoveHours(
      OneUptimeDate.addRemoveDays(monday, 2),
      2,
    );
    const thu02: Date = OneUptimeDate.addRemoveHours(
      OneUptimeDate.addRemoveDays(monday, 3),
      2,
    );
    expect(coveringEvent(events, tue02)).toBeNull();
    expect(coveringEvent(events, wed02)).toBeNull();
    expect(coveringEvent(events, thu02)).toBeNull();
  });
});

describe("LayerUtil HIGH-3: overnight daily restriction covers the first-day morning", () => {
  test("22:00 -> 06:00 with midnight daily rotation has no nightly coverage gap", () => {
    const util: LayerUtil = new LayerUtil();
    const monday: Date = mondayOf(new Date(2026, 1, 15));
    const calEnd: Date = OneUptimeDate.addRemoveDays(monday, 3);

    const restrictionTimes: RestrictionTimes = new RestrictionTimes();
    restrictionTimes.restictionType = RestrictionType.Daily;
    restrictionTimes.dayRestrictionTimes = {
      startTime: OneUptimeDate.getDateWithCustomTime({
        hours: 22,
        minutes: 0,
        seconds: 0,
      }),
      endTime: OneUptimeDate.getDateWithCustomTime({
        hours: 6,
        minutes: 0,
        seconds: 0,
      }),
    };

    const events: Array<CalendarEvent> = util.getEvents({
      users: [user("A"), user("B"), user("C")],
      startDateTimeOfLayer: monday,
      handOffTime: OneUptimeDate.addRemoveDays(monday, 1),
      restrictionTimes: restrictionTimes,
      rotation: rotation(EventInterval.Day, 1),
      calendarStartDate: monday,
      calendarEndDate: calEnd,
    });

    // Tue 03:00 must be covered (day-2 user B, via the tail of Mon 22:00 window).
    const tue03: Date = OneUptimeDate.addRemoveHours(
      OneUptimeDate.addRemoveDays(monday, 1),
      3,
    );
    const cover: CalendarEvent | null = coveringEvent(events, tue03);
    expect(cover).not.toBeNull();
    expect(cover!.title).toBe("B");
  });
});

describe("LayerUtil M-2: multi-layer 'next' roster keeps a fallback layer's post-block coverage", () => {
  test("restricted primary + unrestricted fallback yields fallback as the next event", () => {
    const util: LayerUtil = new LayerUtil();
    const monday: Date = mondayOf(new Date(2026, 1, 15));
    const calStart: Date = monday;
    const calEnd: Date = OneUptimeDate.addRemoveDays(monday, 14);

    // Primary: user A, weekly, active only Mon 00:00 -> Wed 00:00.
    const primaryRestriction: RestrictionTimes = new RestrictionTimes();
    primaryRestriction.restictionType = RestrictionType.Weekly;
    primaryRestriction.weeklyRestrictionTimes = [
      {
        startDay: DayOfWeek.Monday,
        endDay: DayOfWeek.Wednesday,
        startTime: monday, // Monday 00:00
        endTime: OneUptimeDate.addRemoveDays(monday, 2), // Wednesday 00:00
      },
    ];

    const primary: LayerProps = {
      users: [user("A")],
      startDateTimeOfLayer: monday,
      handOffTime: OneUptimeDate.addRemoveWeeks(monday, 1),
      restrictionTimes: primaryRestriction,
      rotation: rotation(EventInterval.Week, 1),
    };

    // Fallback: user B, daily, unrestricted.
    const fallback: LayerProps = {
      users: [user("B")],
      startDateTimeOfLayer: monday,
      handOffTime: OneUptimeDate.addRemoveDays(monday, 1),
      restrictionTimes: noRestriction(),
      rotation: rotation(EventInterval.Day, 1),
    };

    const events: Array<CalendarEvent> = util.getMultiLayerEvents(
      {
        layers: [primary, fallback],
        calendarStartDate: calStart,
        calendarEndDate: calEnd,
      },
      { getNumberOfEvents: 2 },
    );

    expect(events.length).toBe(2);
    // Current: A (Mon 00:00 -> Wed 00:00).
    expect(events[0]!.title).toBe("A");
    // Next: fallback B filling the Wed gap — NOT A's next week.
    expect(events[1]!.title).toBe("B");
    /*
     * And B's segment starts at the Wed 00:00 gap (end of A's block). The
     * overlap-removal separates adjacent events by 1 second, so allow a small
     * tolerance — the point is it starts at the gap, not A's next week.
     */
    const wed00: number = OneUptimeDate.addRemoveDays(monday, 2).getTime();
    expect(events[1]!.start.getTime()).toBeGreaterThanOrEqual(wed00);
    expect(events[1]!.start.getTime()).toBeLessThan(wed00 + 5000);
  });
});
