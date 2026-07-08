/*
 * TEMP audit test for the current-user-index lens.
 * Compares windowed resolution (getCurrentUserIndexBasedOnHandoffTime fast path
 * + simulation) against a FULL expansion from layer start, sampling MID-PERIOD
 * instants (away from boundaries) so we isolate real divergences from the known
 * 1-second boundary-stitch artifact.
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
  timezone?: string | undefined;
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

// Full expansion, end-INCLUSIVE reading (so exact boundaries resolve to the
// event that ENDS at `at`, i.e. the outgoing user). We use a mid-period sample
// so this ambiguity does not arise.
function groundTruthUserAt(layer: LayerProps, at: Date): string | null {
  const util: LayerUtil = new LayerUtil();
  const events: Array<CalendarEvent> = util.getEvents({
    ...layer,
    calendarStartDate: layer.startDateTimeOfLayer,
    calendarEndDate: OneUptimeDate.addRemoveDays(at, 2),
  });
  for (const e of events) {
    if (
      OneUptimeDate.isOnOrAfter(at, e.start) &&
      OneUptimeDate.isOnOrBefore(at, e.end)
    ) {
      return e.title;
    }
  }
  return null;
}

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

interface Cfg {
  name: string;
  users: string[];
  intervalType: EventInterval;
  intervalCount: number;
  timezone?: string | undefined;
  start: Date;
  // handoff offset in the interval units from start; default = 1 period
  handoff?: Date;
}

describe("FASTPATH differential mid-period", () => {
  const configs: Array<Cfg> = [
    {
      name: "hourly x1, 3u",
      users: ["A", "B", "C"],
      intervalType: EventInterval.Hour,
      intervalCount: 1,
      start: OneUptimeDate.fromString("2025-01-01T00:00:00.000Z"),
    },
    {
      name: "hourly x5, 4u, non-aligned start",
      users: ["A", "B", "C", "D"],
      intervalType: EventInterval.Hour,
      intervalCount: 5,
      start: OneUptimeDate.fromString("2025-01-01T03:17:00.000Z"),
    },
    {
      name: "daily x1, 2u, NY tz (crosses spring & fall DST)",
      users: ["A", "B"],
      intervalType: EventInterval.Day,
      intervalCount: 1,
      timezone: "America/New_York",
      start: OneUptimeDate.fromString("2025-01-01T12:00:00.000Z"),
    },
    {
      name: "daily x3, 3u, NY tz, non-midnight",
      users: ["A", "B", "C"],
      intervalType: EventInterval.Day,
      intervalCount: 3,
      timezone: "America/New_York",
      start: OneUptimeDate.fromString("2025-02-27T09:30:00.000Z"),
    },
    {
      name: "weekly x1, 3u, NY tz",
      users: ["A", "B", "C"],
      intervalType: EventInterval.Week,
      intervalCount: 1,
      timezone: "America/New_York",
      start: OneUptimeDate.fromString("2025-01-01T08:00:00.000Z"),
    },
    {
      name: "weekly x2, 4u, Kolkata tz (no DST but +5:30 offset)",
      users: ["A", "B", "C", "D"],
      intervalType: EventInterval.Week,
      intervalCount: 2,
      timezone: "Asia/Kolkata",
      start: OneUptimeDate.fromString("2025-01-01T00:00:00.000Z"),
    },
    {
      name: "monthly x1, 2u, Jan-31 start (clamping)",
      users: ["A", "B"],
      intervalType: EventInterval.Month,
      intervalCount: 1,
      start: OneUptimeDate.fromString("2025-01-31T10:00:00.000Z"),
    },
    {
      name: "monthly x2, 3u, NY tz",
      users: ["A", "B", "C"],
      intervalType: EventInterval.Month,
      intervalCount: 2,
      timezone: "America/New_York",
      start: OneUptimeDate.fromString("2025-01-15T00:00:00.000Z"),
    },
    {
      name: "yearly x1, 2u",
      users: ["A", "B"],
      intervalType: EventInterval.Year,
      intervalCount: 1,
      start: OneUptimeDate.fromString("2024-02-29T00:00:00.000Z"),
    },
  ];

  function rotationOf(cfg: Cfg): Recurring {
    const rot: Recurring = new Recurring();
    rot.intervalType = cfg.intervalType;
    rot.intervalCount = new PositiveNumber(cfg.intervalCount);
    return rot;
  }

  for (const cfg of configs) {
    it(`${cfg.name}`, () => {
      const rot: Recurring = rotationOf(cfg);
      const handoff: Date =
        cfg.handoff || Recurring.getNextDateInterval(cfg.start, rot);
      const layer: LayerProps = makeLayer({
        users: cfg.users,
        start: cfg.start,
        handoff,
        intervalType: cfg.intervalType,
        intervalCount: cfg.intervalCount,
        timezone: cfg.timezone,
      });

      // Walk period boundaries from handoff forward, sampling the MIDPOINT of
      // each period. Midpoints are unambiguously interior => full expansion and
      // windowed resolution MUST agree.
      let prevBoundary: Date = handoff;
      const mismatches: string[] = [];
      for (let k: number = 0; k < 60; k++) {
        const nextBoundary: Date = Recurring.getNextDateInterval(
          prevBoundary,
          rot,
        );
        // midpoint (absolute) between prevBoundary and nextBoundary
        const midMs: number =
          (prevBoundary.getTime() + nextBoundary.getTime()) / 2;
        const at: Date = new Date(midMs);
        const truth: string | null = groundTruthUserAt(layer, at);
        const windowed: string | null = windowedUserAt(layer, at);
        if (truth !== windowed) {
          mismatches.push(
            `k=${k} at=${at.toISOString()} truth=${truth} windowed=${windowed}`,
          );
        }
        prevBoundary = nextBoundary;
      }
      expect(mismatches).toEqual([]);
    });
  }
});
