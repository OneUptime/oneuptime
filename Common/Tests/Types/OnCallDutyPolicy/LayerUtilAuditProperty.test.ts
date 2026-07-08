/*
 * TEMPORARY AUDIT PROPERTY TEST — differential + invariant checks.
 * Delete after audit.
 */
import LayerUtil, { LayerProps } from "../../../Types/OnCallDutyPolicy/Layer";
import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import RestrictionTimes, {
  RestrictionType,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import Recurring from "../../../Types/Events/Recurring";
import OneUptimeDate from "../../../Types/Date";
import User from "../../../Models/DatabaseModels/User";
import EventInterval from "../../../Types/Events/EventInterval";
import PositiveNumber from "../../../Types/PositiveNumber";

function user(id: string): User {
  return { id: { toString: () => id } as any } as User;
}

function makeLayer(data: {
  users: string[];
  start: Date;
  handoff: Date;
  intervalType: EventInterval;
  intervalCount: number;
  timezone?: string;
}): LayerProps {
  const r: RestrictionTimes = new RestrictionTimes();
  r.restictionType = RestrictionType.None;
  const rotation: Recurring = new Recurring();
  rotation.intervalType = data.intervalType;
  rotation.intervalCount = new PositiveNumber(data.intervalCount);
  return {
    users: data.users.map(user),
    startDateTimeOfLayer: data.start,
    restrictionTimes: r,
    handOffTime: data.handoff,
    rotation,
    timezone: data.timezone,
  };
}

// Who is on call at instant `at`, per a FULL expansion from layer start.
function groundTruthUserAt(layer: LayerProps, at: Date): string | null {
  const util: LayerUtil = new LayerUtil();
  const events: Array<CalendarEvent> = util.getEvents({
    ...layer,
    calendarStartDate: layer.startDateTimeOfLayer,
    calendarEndDate: OneUptimeDate.addRemoveDays(at, 1),
  });
  for (const e of events) {
    if (
      OneUptimeDate.isOnOrAfter(at, e.start) &&
      OneUptimeDate.isBefore(at, e.end)
    ) {
      return e.title;
    }
  }
  return null;
}

// Who is on call at `at`, per a WINDOWED resolution (calendar starts at `at`).
// This exercises getCurrentUserIndexBasedOnHandoffTime (O(1) + simulation).
function windowedUserAt(layer: LayerProps, at: Date): string | null {
  const util: LayerUtil = new LayerUtil();
  const events: Array<CalendarEvent> = util.getEvents(
    {
      ...layer,
      calendarStartDate: at,
      calendarEndDate: OneUptimeDate.addRemoveDays(at, 2),
    },
    { getNumberOfEvents: 1 },
  );
  const first: CalendarEvent | undefined = events[0];
  if (!first) {
    return null;
  }
  return first.title;
}

describe("AUDIT differential: windowed resolution matches full expansion", () => {
  const configs: Array<{
    name: string;
    users: string[];
    intervalType: EventInterval;
    intervalCount: number;
    timezone?: string;
  }> = [
    { name: "hourly x1, 3 users", users: ["A", "B", "C"], intervalType: EventInterval.Hour, intervalCount: 1 },
    { name: "hourly x3, 4 users", users: ["A", "B", "C", "D"], intervalType: EventInterval.Hour, intervalCount: 3 },
    { name: "daily x1, 2 users", users: ["A", "B"], intervalType: EventInterval.Day, intervalCount: 1 },
    { name: "daily x2, 3 users", users: ["A", "B", "C"], intervalType: EventInterval.Day, intervalCount: 2 },
    { name: "weekly x1, 3 users", users: ["A", "B", "C"], intervalType: EventInterval.Week, intervalCount: 1 },
    { name: "monthly x1, 2 users", users: ["A", "B"], intervalType: EventInterval.Month, intervalCount: 1 },
    { name: "daily x1, 3 users, NY tz", users: ["A", "B", "C"], intervalType: EventInterval.Day, intervalCount: 1, timezone: "America/New_York" },
    { name: "weekly x1, 3 users, NY tz", users: ["A", "B", "C"], intervalType: EventInterval.Week, intervalCount: 1, timezone: "America/New_York" },
  ];

  const layerStart: Date = OneUptimeDate.getDateWithCustomTime({
    hours: 0,
    minutes: 0,
    seconds: 0,
  });
  // Move layer start to a fixed absolute date to make it deterministic.
  const baseStart: Date = OneUptimeDate.fromString("2025-01-01T00:00:00.000Z");

  for (const cfg of configs) {
    it(`${cfg.name}`, () => {
      const handoff: Date = Recurring.getNextDateInterval(baseStart, (() => {
        const rot: Recurring = new Recurring();
        rot.intervalType = cfg.intervalType;
        rot.intervalCount = new PositiveNumber(cfg.intervalCount);
        return rot;
      })());

      const layer: LayerProps = makeLayer({
        users: cfg.users,
        start: baseStart,
        handoff,
        intervalType: cfg.intervalType,
        intervalCount: cfg.intervalCount,
        timezone: cfg.timezone,
      });

      // Sample many offsets into the future (covers DST for tz configs).
      const offsetsHours: number[] = [
        0.5, 1, 2, 5, 13, 25, 49, 24 * 3 + 5, 24 * 10 + 7, 24 * 40 + 3,
        24 * 70 + 11, 24 * 100 + 1, 24 * 200 + 6, 24 * 300 + 9,
      ];

      for (const oh of offsetsHours) {
        const at: Date = OneUptimeDate.addRemoveHours(baseStart, oh);
        const truth: string | null = groundTruthUserAt(layer, at);
        const windowed: string | null = windowedUserAt(layer, at);
        expect(`${cfg.name}@+${oh}h => ${windowed}`).toBe(
          `${cfg.name}@+${oh}h => ${truth}`,
        );
      }
    });
  }
  // silence unused
  void layerStart;
});

describe("AUDIT invariant: 24/7 coverage is continuous & single (no gaps/overlaps)", () => {
  it("hourly 3-user rotation over 20 days has contiguous coverage", () => {
    const baseStart: Date = OneUptimeDate.fromString("2025-03-01T00:00:00.000Z");
    const rot: Recurring = new Recurring();
    rot.intervalType = EventInterval.Hour;
    rot.intervalCount = new PositiveNumber(1);
    const handoff: Date = Recurring.getNextDateInterval(baseStart, rot);
    const layer: LayerProps = makeLayer({
      users: ["A", "B", "C"],
      start: baseStart,
      handoff,
      intervalType: EventInterval.Hour,
      intervalCount: 1,
      timezone: "America/New_York",
    });
    const util: LayerUtil = new LayerUtil();
    const events: Array<CalendarEvent> = util
      .getEvents({
        ...layer,
        calendarStartDate: baseStart,
        calendarEndDate: OneUptimeDate.addRemoveDays(baseStart, 20),
      })
      .sort((a: CalendarEvent, b: CalendarEvent) => {
        return a.start.getTime() - b.start.getTime();
      });

    expect(events.length).toBeGreaterThan(0);
    // check contiguity: each event.start == prev.end + 1s (the code uses +1s stitching)
    let gaps: number = 0;
    let overlaps: number = 0;
    for (let i: number = 1; i < events.length; i++) {
      const prev: CalendarEvent = events[i - 1]!;
      const cur: CalendarEvent = events[i]!;
      const diffSec: number = OneUptimeDate.getSecondsBetweenTwoDates(
        prev.end,
        cur.start,
      );
      // Expected stitch is +1s. Anything much larger is a gap; negative is overlap.
      if (diffSec > 2) {
        gaps++;
      }
      if (diffSec < 0) {
        overlaps++;
      }
    }
    expect({ gaps, overlaps }).toEqual({ gaps: 0, overlaps: 0 });
  });
});

describe("AUDIT invariant: rotation fairness across DST", () => {
  it("daily rotation gives each of 3 users an equal number of shifts over 90 days (NY tz)", () => {
    const baseStart: Date = OneUptimeDate.fromString("2025-01-01T00:00:00.000Z");
    const rot: Recurring = new Recurring();
    rot.intervalType = EventInterval.Day;
    rot.intervalCount = new PositiveNumber(1);
    const handoff: Date = Recurring.getNextDateInterval(baseStart, rot);
    const layer: LayerProps = makeLayer({
      users: ["A", "B", "C"],
      start: baseStart,
      handoff,
      intervalType: EventInterval.Day,
      intervalCount: 1,
      timezone: "America/New_York",
    });
    const util: LayerUtil = new LayerUtil();
    const events: Array<CalendarEvent> = util.getEvents({
      ...layer,
      calendarStartDate: baseStart,
      calendarEndDate: OneUptimeDate.addRemoveDays(baseStart, 90),
    });
    const counts: Record<string, number> = { A: 0, B: 0, C: 0 };
    for (const e of events) {
      counts[e.title] = (counts[e.title] || 0) + 1;
    }
    // 90 daily shifts /3 = 30 each. Allow the boundary partials but they must be near-equal.
    const vals: number[] = [counts["A"]!, counts["B"]!, counts["C"]!];
    const max: number = Math.max(...vals);
    const min: number = Math.min(...vals);
    expect(max - min).toBeLessThanOrEqual(1);
  });
});
