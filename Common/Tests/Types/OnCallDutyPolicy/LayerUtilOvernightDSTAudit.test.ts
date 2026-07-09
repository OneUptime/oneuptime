import LayerUtil, { LayerProps } from "../../../Types/OnCallDutyPolicy/Layer";
import RestrictionTimes, {
  RestrictionType,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import Recurring from "../../../Types/Events/Recurring";
import EventInterval from "../../../Types/Events/EventInterval";
import PositiveNumber from "../../../Types/PositiveNumber";
import User from "../../../Models/DatabaseModels/User";
import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import { describe, expect, test } from "@jest/globals";

/*
 * Audit L1: getEventsByDailyRestriction's overnight (end < start) branch stepped
 * its day-by-day iterator with addRemoveDays(currentDayStart, 1) WITHOUT the
 * schedule timezone, i.e. a fixed 24h step. Every segment-shaping call
 * (getStartOfDay / keepTimeButMoveDay) IS timezone-aware, so on a fall-back DST
 * date (the schedule-zone day is 25h long) the 24h step landed the iterator back
 * inside the SAME schedule-zone calendar day and emitted that day's night +
 * morning segments a SECOND time — duplicate, identical on-call events for the
 * same user. Coverage stays continuous (no gap), so this is a duplicate-segment
 * defect. The fix passes this.timezone to both day-step calls.
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

function overnightRestriction(): RestrictionTimes {
  const rt: RestrictionTimes = new RestrictionTimes();
  rt.restictionType = RestrictionType.Daily;
  // 22:00 -> 06:00 (next day). end < start within a day => overnight branch.
  rt.dayRestrictionTimes = {
    startTime: new Date(Date.UTC(2025, 0, 1, 22, 0, 0)),
    endTime: new Date(Date.UTC(2025, 0, 1, 6, 0, 0)),
  };
  return rt;
}

function weeklyRotation(): Recurring {
  /*
   * One long period so a single rotation event spans the whole DST window and
   * the daily overnight restriction tiles nightly across it.
   */
  const r: Recurring = new Recurring();
  r.intervalType = EventInterval.Week;
  r.intervalCount = new PositiveNumber(1);
  return r;
}

function duplicateKeys(events: Array<CalendarEvent>): Array<string> {
  const seen: Set<string> = new Set<string>();
  const dupes: Array<string> = [];
  for (const e of events) {
    const key: string = `${e.title}|${new Date(e.start).toISOString()}|${new Date(
      e.end,
    ).toISOString()}`;
    if (seen.has(key)) {
      dupes.push(key);
    }
    seen.add(key);
  }
  return dupes;
}

describe("LayerUtil audit L1: overnight restriction across DST fall-back", () => {
  test("no duplicate segments across the 2025-11-02 fall-back (America/New_York)", () => {
    const anchor: Date = new Date(Date.UTC(2025, 9, 27, 0, 0, 0)); // Oct 27
    const layer: LayerProps = {
      users: [user("A")],
      startDateTimeOfLayer: anchor,
      handOffTime: anchor,
      restrictionTimes: overnightRestriction(),
      rotation: weeklyRotation(),
      timezone: "America/New_York",
    };

    const events: Array<CalendarEvent> = new LayerUtil().getEvents({
      ...layer,
      calendarStartDate: new Date(Date.UTC(2025, 10, 1, 0, 0, 0)), // Nov 1
      calendarEndDate: new Date(Date.UTC(2025, 10, 6, 0, 0, 0)), // Nov 6
    });

    expect(events.length).toBeGreaterThan(0); // coverage still exists (no gap)
    expect(duplicateKeys(events)).toEqual([]); // and no duplicate on-call blocks
  });

  test("no duplicate segments across the 2025-03-09 spring-forward (America/New_York)", () => {
    const anchor: Date = new Date(Date.UTC(2025, 2, 2, 0, 0, 0)); // Mar 2
    const layer: LayerProps = {
      users: [user("A")],
      startDateTimeOfLayer: anchor,
      handOffTime: anchor,
      restrictionTimes: overnightRestriction(),
      rotation: weeklyRotation(),
      timezone: "America/New_York",
    };

    const events: Array<CalendarEvent> = new LayerUtil().getEvents({
      ...layer,
      calendarStartDate: new Date(Date.UTC(2025, 2, 7, 0, 0, 0)), // Mar 7
      calendarEndDate: new Date(Date.UTC(2025, 2, 12, 0, 0, 0)), // Mar 12
    });

    expect(events.length).toBeGreaterThan(0);
    expect(duplicateKeys(events)).toEqual([]);
  });

  test("control: same overnight restriction on a non-DST week has no duplicates", () => {
    const anchor: Date = new Date(Date.UTC(2025, 6, 6, 0, 0, 0)); // Jul 6
    const layer: LayerProps = {
      users: [user("A")],
      startDateTimeOfLayer: anchor,
      handOffTime: anchor,
      restrictionTimes: overnightRestriction(),
      rotation: weeklyRotation(),
      timezone: "America/New_York",
    };

    const events: Array<CalendarEvent> = new LayerUtil().getEvents({
      ...layer,
      calendarStartDate: new Date(Date.UTC(2025, 6, 7, 0, 0, 0)),
      calendarEndDate: new Date(Date.UTC(2025, 6, 12, 0, 0, 0)),
    });

    expect(events.length).toBeGreaterThan(0);
    expect(duplicateKeys(events)).toEqual([]);
  });

  test("no event has zero or negative length (start < end) across DST", () => {
    const anchor: Date = new Date(Date.UTC(2025, 9, 27, 0, 0, 0));
    const layer: LayerProps = {
      users: [user("A")],
      startDateTimeOfLayer: anchor,
      handOffTime: anchor,
      restrictionTimes: overnightRestriction(),
      rotation: weeklyRotation(),
      timezone: "America/New_York",
    };

    const events: Array<CalendarEvent> = new LayerUtil().getEvents({
      ...layer,
      calendarStartDate: new Date(Date.UTC(2025, 10, 1, 0, 0, 0)),
      calendarEndDate: new Date(Date.UTC(2025, 10, 6, 0, 0, 0)),
    });

    for (const e of events) {
      expect(new Date(e.end).getTime()).toBeGreaterThan(
        new Date(e.start).getTime(),
      );
    }
  });
});
