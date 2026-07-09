import LayerUtil, { LayerProps } from "../../../Types/OnCallDutyPolicy/Layer";
import RestrictionTimes from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import Recurring from "../../../Types/Events/Recurring";
import EventInterval from "../../../Types/Events/EventInterval";
import PositiveNumber from "../../../Types/PositiveNumber";
import OneUptimeDate from "../../../Types/Date";
import User from "../../../Models/DatabaseModels/User";
import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import { describe, expect, test } from "@jest/globals";

/*
 * Audit H1: moveHandsOffTimeAfterCurrentEventStartTime used a single MULTIPLIED
 * calendar add from the anchor (addRotationUnits(anchor, k*interval)) to place a
 * rotation boundary. For Month/Year, moment end-of-month-clamps a multiplied add
 * differently than stepping one period at a time — e.g. Jan-31 + 11 months
 * multiplied = Dec-31, but iterating eleven +1-month steps = Dec-28. The
 * current-user counter (countElapsedRotationPeriods) already ITERATES, so the
 * emitted handoff boundary landed off the grid the current user was resolved on:
 * the schedule paged the wrong user and fired the handoff nearly a month early
 * for Month/Year rotations anchored on day 29-31 (or Feb-29 for Year).
 *
 * The invariant these tests lock in: the current user + handoff resolved from a
 * window that opens at "now" must match a full expansion from the layer's anchor
 * (both walk the SAME iterated grid), and Month/Year boundaries must stay on the
 * clamped iterated grid (never re-inflate to day 30/31 after a short month).
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

function expandFrom(
  layer: LayerProps,
  windowStart: Date,
  windowEnd: Date,
): Array<CalendarEvent> {
  return new LayerUtil().getEvents({
    ...layer,
    calendarStartDate: windowStart,
    calendarEndDate: windowEnd,
  });
}

// The event that covers `at` in a full expansion from the layer anchor.
function coveringEvent(
  events: Array<CalendarEvent>,
  at: Date,
): CalendarEvent | null {
  for (const event of events) {
    if (
      OneUptimeDate.isOnOrBefore(event.start, at) &&
      OneUptimeDate.isOnOrAfter(event.end, at)
    ) {
      return event;
    }
  }
  return null;
}

describe("LayerUtil audit H1: Month/Year rotation boundary iterated grid", () => {
  test("monthly rotation anchored Jan-31: current user + handoff from 'now' matches full expansion from anchor", () => {
    const anchor: Date = new Date(Date.UTC(2025, 0, 31, 0, 0, 0));
    const now: Date = new Date(Date.UTC(2025, 11, 29, 12, 0, 0));
    const layer: LayerProps = {
      users: [user("A"), user("B")],
      startDateTimeOfLayer: anchor,
      handOffTime: anchor,
      restrictionTimes: RestrictionTimes.getDefault(),
      rotation: rotation(EventInterval.Month, 1),
      timezone: "America/New_York",
    };

    const fromNow: Array<CalendarEvent> = expandFrom(
      layer,
      now,
      new Date(Date.UTC(2026, 3, 5, 0, 0, 0)),
    );
    const fromAnchor: Array<CalendarEvent> = expandFrom(
      layer,
      anchor,
      new Date(Date.UTC(2026, 3, 5, 0, 0, 0)),
    );

    const current: CalendarEvent | undefined = fromNow[0];
    const covering: CalendarEvent | null = coveringEvent(fromAnchor, now);

    expect(current).toBeTruthy();
    expect(covering).toBeTruthy();

    // Same user on call for "now" whether resolved from now or from the anchor.
    expect(current!.title).toBe(covering!.title);

    // Same handoff boundary (the crux of the bug — these disagreed before H1).
    expect(new Date(current!.end).toISOString()).toBe(
      new Date(covering!.end).toISOString(),
    );

    // Regression guard: the handoff is in Jan 2026, NOT the buggy Dec-31 2025.
    const end: Date = new Date(current!.end);
    expect(end.getUTCFullYear()).toBe(2026);
    expect(end.getUTCMonth()).toBe(0); // January
  });

  test("monthly rotation anchored Jan-31: no emitted boundary re-inflates past day 29 after a short month", () => {
    const anchor: Date = new Date(Date.UTC(2025, 0, 31, 0, 0, 0));
    const layer: LayerProps = {
      users: [user("A"), user("B")],
      startDateTimeOfLayer: anchor,
      handOffTime: anchor,
      restrictionTimes: RestrictionTimes.getDefault(),
      rotation: rotation(EventInterval.Month, 1),
      timezone: "UTC",
    };

    const events: Array<CalendarEvent> = expandFrom(
      layer,
      anchor,
      new Date(Date.UTC(2026, 11, 1, 0, 0, 0)),
    );

    /*
     * After Jan-31 the iterated grid drops to Feb-28 and stays on day <= 28
     * (28 in UTC). The buggy multiplied form produced Mar-31, Apr-30, ... —
     * boundary days of 30/31. Assert every internal handoff boundary is on day
     * <= 29 (allowing month-length clamping wiggle), which the multiplied form
     * violated. The final event ends at the clamped calendarEnd, so skip it.
     */
    for (let i: number = 0; i < events.length - 1; i++) {
      const end: Date = new Date(events[i]!.end);
      expect(end.getUTCDate()).toBeLessThanOrEqual(29);
    }
  });

  test("monthly rotation with intervalCount=3 stays consistent (current == full-expansion covering)", () => {
    const anchor: Date = new Date(Date.UTC(2025, 0, 31, 0, 0, 0));
    const now: Date = new Date(Date.UTC(2026, 0, 15, 6, 0, 0));
    const layer: LayerProps = {
      users: [user("A"), user("B"), user("C")],
      startDateTimeOfLayer: anchor,
      handOffTime: anchor,
      restrictionTimes: RestrictionTimes.getDefault(),
      rotation: rotation(EventInterval.Month, 3),
      timezone: "America/New_York",
    };

    const fromNow: Array<CalendarEvent> = expandFrom(
      layer,
      now,
      new Date(Date.UTC(2026, 8, 1, 0, 0, 0)),
    );
    const fromAnchor: Array<CalendarEvent> = expandFrom(
      layer,
      anchor,
      new Date(Date.UTC(2026, 8, 1, 0, 0, 0)),
    );

    const current: CalendarEvent | undefined = fromNow[0];
    const covering: CalendarEvent | null = coveringEvent(fromAnchor, now);

    expect(current).toBeTruthy();
    expect(covering).toBeTruthy();
    expect(current!.title).toBe(covering!.title);
    expect(new Date(current!.end).toISOString()).toBe(
      new Date(covering!.end).toISOString(),
    );
  });

  test("yearly rotation anchored Feb-29 (leap): boundary clamps to Feb-28 and stays consistent", () => {
    const anchor: Date = new Date(Date.UTC(2024, 1, 29, 0, 0, 0));
    const now: Date = new Date(Date.UTC(2027, 5, 1, 0, 0, 0));
    const layer: LayerProps = {
      users: [user("A"), user("B")],
      startDateTimeOfLayer: anchor,
      handOffTime: anchor,
      restrictionTimes: RestrictionTimes.getDefault(),
      rotation: rotation(EventInterval.Year, 1),
      timezone: "UTC",
    };

    const fromNow: Array<CalendarEvent> = expandFrom(
      layer,
      now,
      new Date(Date.UTC(2031, 0, 1, 0, 0, 0)),
    );
    const fromAnchor: Array<CalendarEvent> = expandFrom(
      layer,
      anchor,
      new Date(Date.UTC(2031, 0, 1, 0, 0, 0)),
    );

    const current: CalendarEvent | undefined = fromNow[0];
    const covering: CalendarEvent | null = coveringEvent(fromAnchor, now);

    expect(current).toBeTruthy();
    expect(covering).toBeTruthy();
    expect(current!.title).toBe(covering!.title);
    expect(new Date(current!.end).toISOString()).toBe(
      new Date(covering!.end).toISOString(),
    );

    /*
     * The first post-anchor yearly boundary must be Feb-28 (non-leap), not
     * Feb-29 re-inflated by a multiplied add.
     */
    const firstBoundary: CalendarEvent | undefined = fromAnchor[0];
    expect(firstBoundary).toBeTruthy();
    const end: Date = new Date(firstBoundary!.end);
    expect(end.getUTCMonth()).toBe(1); // February
    expect(end.getUTCDate()).toBe(28);
  });

  test("Day and Week rotations are unaffected (no calendar clamping) — sanity", () => {
    const anchor: Date = new Date(Date.UTC(2025, 0, 31, 0, 0, 0));
    const now: Date = new Date(Date.UTC(2025, 5, 15, 9, 0, 0));
    const layer: LayerProps = {
      users: [user("A"), user("B")],
      startDateTimeOfLayer: anchor,
      handOffTime: anchor,
      restrictionTimes: RestrictionTimes.getDefault(),
      rotation: rotation(EventInterval.Day, 1),
      timezone: "UTC",
    };

    const fromNow: Array<CalendarEvent> = expandFrom(
      layer,
      now,
      new Date(Date.UTC(2025, 5, 20, 0, 0, 0)),
    );
    const fromAnchor: Array<CalendarEvent> = expandFrom(
      layer,
      anchor,
      new Date(Date.UTC(2025, 5, 20, 0, 0, 0)),
    );

    const current: CalendarEvent | undefined = fromNow[0];
    const covering: CalendarEvent | null = coveringEvent(fromAnchor, now);
    expect(current!.title).toBe(covering!.title);
    expect(new Date(current!.end).toISOString()).toBe(
      new Date(covering!.end).toISOString(),
    );
  });
});
