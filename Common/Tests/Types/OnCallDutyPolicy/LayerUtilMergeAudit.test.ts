import LayerUtil, { LayerProps } from "../../../Types/OnCallDutyPolicy/Layer";
import RestrictionTimes, {
  RestrictionType,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import Recurring from "../../../Types/Events/Recurring";
import EventInterval from "../../../Types/Events/EventInterval";
import PositiveNumber from "../../../Types/PositiveNumber";
import OneUptimeDate from "../../../Types/Date";
import User from "../../../Models/DatabaseModels/User";
import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import { describe, expect, test } from "@jest/globals";

/*
 * Audit H2: removeOverlappingEvents ran a full Array.sort() INSIDE its per-event
 * loop (O(n^2 log n)); getEvents rebuilt its array with [...events, ...] each
 * period (O(n^2)). The fix hoists the sort to a single post-loop sort and pushes
 * per-period segments, and makes the lower-priority "trim current event" step a
 * monotonic max so it is independent of finalEvents ordering (which is what made
 * hoisting the sort safe). These tests lock in the merge INVARIANTS the
 * optimization must preserve: no overlaps, sorted, positive length, and correct
 * priority/fallback coverage with no gaps under a 24/7 fallback.
 */

function user(id: string): User {
  return {
    id: {
      toString: (): string => {
        return id;
      },
    } as any,
  } as User;
}

function rotation(type: EventInterval, count: number): Recurring {
  const r: Recurring = new Recurring();
  r.intervalType = type;
  r.intervalCount = new PositiveNumber(count);
  return r;
}

function businessHoursRestriction(): RestrictionTimes {
  const rt: RestrictionTimes = new RestrictionTimes();
  rt.restictionType = RestrictionType.Daily;
  rt.dayRestrictionTimes = {
    startTime: new Date(Date.UTC(2025, 0, 1, 9, 0, 0)),
    endTime: new Date(Date.UTC(2025, 0, 1, 17, 0, 0)),
  };
  return rt;
}

function assertSortedNonOverlappingPositive(
  events: Array<CalendarEvent>,
): void {
  for (let i: number = 0; i < events.length; i++) {
    // positive length
    expect(new Date(events[i]!.end).getTime()).toBeGreaterThan(
      new Date(events[i]!.start).getTime(),
    );
    if (i > 0) {
      // sorted by start
      expect(new Date(events[i]!.start).getTime()).toBeGreaterThanOrEqual(
        new Date(events[i - 1]!.start).getTime(),
      );
      // non-overlapping (previous end is at/before this start)
      expect(new Date(events[i - 1]!.end).getTime()).toBeLessThanOrEqual(
        new Date(events[i]!.start).getTime(),
      );
    }
  }
}

describe("LayerUtil audit H2: multi-layer merge invariants preserved", () => {
  const windowStart: Date = new Date(Date.UTC(2025, 5, 2, 0, 0, 0));
  const windowEnd: Date = new Date(Date.UTC(2025, 5, 6, 0, 0, 0));

  test("high-priority business-hours layer over a 24/7 fallback: no overlaps, no gaps, both users present", () => {
    const layers: Array<LayerProps> = [
      {
        // priority 1 (higher): business-hours coverage by X
        users: [user("X")],
        startDateTimeOfLayer: new Date(Date.UTC(2025, 5, 1, 0, 0, 0)),
        handOffTime: new Date(Date.UTC(2025, 5, 1, 0, 0, 0)),
        restrictionTimes: businessHoursRestriction(),
        rotation: rotation(EventInterval.Day, 1),
        timezone: "UTC",
      },
      {
        // priority 2 (fallback): 24/7 coverage by Y
        users: [user("Y")],
        startDateTimeOfLayer: new Date(Date.UTC(2025, 5, 1, 0, 0, 0)),
        handOffTime: new Date(Date.UTC(2025, 5, 1, 0, 0, 0)),
        restrictionTimes: RestrictionTimes.getDefault(),
        rotation: rotation(EventInterval.Week, 1),
        timezone: "UTC",
      },
    ];

    const events: Array<CalendarEvent> = new LayerUtil().getMultiLayerEvents({
      layers,
      calendarStartDate: windowStart,
      calendarEndDate: windowEnd,
    });

    assertSortedNonOverlappingPositive(events);

    const titles: Set<string> = new Set(
      events.map((e: CalendarEvent) => {
        return e.title;
      }),
    );
    expect(titles.has("X")).toBe(true); // higher priority appears
    expect(titles.has("Y")).toBe(true); // fallback fills the gaps

    /*
     * With a 24/7 fallback the merged coverage must be CONTIGUOUS across the
     * window (no uncovered gap). Allow the ~1s boundary seam the engine leaves
     * between adjacent events.
     */
    for (let i: number = 1; i < events.length; i++) {
      const gapSeconds: number =
        (new Date(events[i]!.start).getTime() -
          new Date(events[i - 1]!.end).getTime()) /
        1000;
      expect(gapSeconds).toBeLessThanOrEqual(2);
    }
  });

  test("two back-to-back higher-priority windows over a fallback preserve the fallback's trailing tail (max-trim path)", () => {
    /*
     * Higher-priority daily rotation with two users creates adjacent daily
     * windows; the fallback must survive as gaps/tail with no overlap.
     */
    const layers: Array<LayerProps> = [
      {
        users: [user("P"), user("Q")],
        startDateTimeOfLayer: new Date(Date.UTC(2025, 5, 1, 0, 0, 0)),
        handOffTime: new Date(Date.UTC(2025, 5, 1, 0, 0, 0)),
        restrictionTimes: businessHoursRestriction(),
        rotation: rotation(EventInterval.Day, 1),
        timezone: "UTC",
      },
      {
        users: [user("F")],
        startDateTimeOfLayer: new Date(Date.UTC(2025, 5, 1, 0, 0, 0)),
        handOffTime: new Date(Date.UTC(2025, 5, 1, 0, 0, 0)),
        restrictionTimes: RestrictionTimes.getDefault(),
        rotation: rotation(EventInterval.Week, 1),
        timezone: "UTC",
      },
    ];

    const events: Array<CalendarEvent> = new LayerUtil().getMultiLayerEvents({
      layers,
      calendarStartDate: windowStart,
      calendarEndDate: windowEnd,
    });

    assertSortedNonOverlappingPositive(events);

    /*
     * The fallback F must appear (it owns the nights/weekends the higher layer
     * does not cover) — the trailing-tail reconstruction must not delete it.
     */
    const titles: Set<string> = new Set(
      events.map((e: CalendarEvent) => {
        return e.title;
      }),
    );
    expect(titles.has("F")).toBe(true);
  });

  test("single unrestricted layer: getNumberOfEvents returns exactly the requested current+next", () => {
    const layer: LayerProps = {
      users: [user("A"), user("B")],
      startDateTimeOfLayer: new Date(Date.UTC(2025, 5, 1, 0, 0, 0)),
      handOffTime: new Date(Date.UTC(2025, 5, 1, 0, 0, 0)),
      restrictionTimes: RestrictionTimes.getDefault(),
      rotation: rotation(EventInterval.Day, 1),
      timezone: "UTC",
    };

    const events: Array<CalendarEvent> = new LayerUtil().getMultiLayerEvents(
      {
        layers: [layer],
        calendarStartDate: new Date(Date.UTC(2025, 5, 3, 12, 0, 0)),
        calendarEndDate: new Date(Date.UTC(2025, 5, 10, 0, 0, 0)),
      },
      { getNumberOfEvents: 2 },
    );

    expect(events.length).toBe(2);
    assertSortedNonOverlappingPositive(events);
    // current and next are different users in a 2-user daily rotation.
    expect(events[0]!.title).not.toBe(events[1]!.title);
  });

  test("hourly layer over a multi-day window resolves quickly (push not O(n^2) spread)", () => {
    const layer: LayerProps = {
      users: [user("A"), user("B")],
      startDateTimeOfLayer: new Date(Date.UTC(2025, 5, 1, 0, 0, 0)),
      handOffTime: new Date(Date.UTC(2025, 5, 1, 0, 0, 0)),
      restrictionTimes: RestrictionTimes.getDefault(),
      rotation: rotation(EventInterval.Hour, 1),
      timezone: "UTC",
    };

    const start: number = OneUptimeDate.getCurrentDate().getTime();
    const events: Array<CalendarEvent> = new LayerUtil().getMultiLayerEvents({
      layers: [layer],
      /*
       * ~20 days of hourly events (~480) — the merge must stay well under any
       * pathological quadratic blowup.
       */
      calendarStartDate: new Date(Date.UTC(2025, 5, 1, 0, 0, 0)),
      calendarEndDate: new Date(Date.UTC(2025, 5, 21, 0, 0, 0)),
    });
    const elapsedMs: number = OneUptimeDate.getCurrentDate().getTime() - start;

    expect(events.length).toBeGreaterThan(0);
    assertSortedNonOverlappingPositive(events);
    /*
     * Generous ceiling — the pre-fix quadratic path took tens of seconds for far
     * fewer events; this must complete in a small fraction of that.
     */
    expect(elapsedMs).toBeLessThan(15000);
  });
});
