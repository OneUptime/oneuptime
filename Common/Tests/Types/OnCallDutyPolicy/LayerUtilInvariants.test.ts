/**
 * EMPIRICAL invariant fuzzing (audit lens).
 *
 * For unrestricted rotations over long horizons:
 *   (A) CONTIGUITY: sorted events cover [start, end] with no gap > 2s and no
 *       overlap (events are stitched with a +1s seam, so a 1s gap is expected).
 *   (B) FAIRNESS: over many periods each user's shift count is within 1.
 *   (C) ORDER: users cycle A,B,C,A,B,C... with no skip/repeat, including across
 *       DST transitions.
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
  return {
    id: {
      toString: (): string => {
        return id;
      },
    } as any,
  } as User;
}

function noRestriction(): RestrictionTimes {
  const r: RestrictionTimes = new RestrictionTimes();
  r.restictionType = RestrictionType.None;
  r.dayRestrictionTimes = null;
  return r;
}

interface Config {
  name: string;
  intervalType: EventInterval;
  intervalCount: number;
  userIds: string[];
  timezone?: string | undefined;
  start: Date;
}

function layerOf(c: Config): LayerProps {
  const rot: Recurring = new Recurring();
  rot.intervalType = c.intervalType;
  rot.intervalCount = new PositiveNumber(c.intervalCount);
  const handoff: Date = Recurring.getNextDateInterval(c.start, rot);
  return {
    users: c.userIds.map(user),
    startDateTimeOfLayer: c.start,
    restrictionTimes: noRestriction(),
    handOffTime: handoff,
    rotation: rot,
    timezone: c.timezone,
  };
}

function fullExpand(layer: LayerProps, to: Date): Array<CalendarEvent> {
  const util: LayerUtil = new LayerUtil();
  const events: Array<CalendarEvent> = util.getEvents({
    ...layer,
    calendarStartDate: layer.startDateTimeOfLayer,
    calendarEndDate: to,
  });
  events.sort((a: CalendarEvent, b: CalendarEvent) => {
    return a.start.getTime() - b.start.getTime();
  });
  return events;
}

const START: Date = OneUptimeDate.fromString("2025-01-06T00:00:00.000Z"); // Monday

describe("INVARIANT: 24/7 coverage contiguity (no gap > 2s, no overlap)", () => {
  const configs: Config[] = [];
  const intervals: EventInterval[] = [
    EventInterval.Hour,
    EventInterval.Day,
    EventInterval.Week,
  ];
  const counts: number[] = [1, 2, 3];
  const userSets: string[][] = [
    ["A", "B"],
    ["A", "B", "C"],
  ];
  const timezones: (string | undefined)[] = [
    undefined,
    "America/New_York",
    "Asia/Kolkata",
  ];
  for (const it of intervals) {
    for (const count of counts) {
      for (const users of userSets) {
        for (const tz of timezones) {
          configs.push({
            name: `${count}x${it} users=${users.length} tz=${tz ?? "local"}`,
            intervalType: it,
            intervalCount: count,
            userIds: users,
            timezone: tz,
            start: START,
          });
        }
      }
    }
  }

  const horizonMs: Record<string, number> = {
    [EventInterval.Hour]: 60 * 3600000, // 60 hours
    [EventInterval.Day]: 60 * 86400000, // 60 days (crosses spring DST)
    [EventInterval.Week]: 40 * 604800000, // 40 weeks (crosses DST both ways)
  };

  for (const c of configs) {
    it(`${c.name}`, () => {
      const layer: LayerProps = layerOf(c);
      const to: Date = new Date(
        START.getTime() + (horizonMs[c.intervalType] || 60 * 86400000),
      );
      const events: Array<CalendarEvent> = fullExpand(layer, to);

      const problems: string[] = [];
      for (let i: number = 1; i < events.length; i++) {
        const prev: CalendarEvent = events[i - 1]!;
        const cur: CalendarEvent = events[i]!;
        const gapMs: number = cur.start.getTime() - prev.end.getTime();
        // Expected seam is +1s. Flag gaps > 2s (coverage hole) or overlaps (<0).
        if (gapMs > 2000) {
          problems.push(
            `GAP ${gapMs}ms between ${prev.title}@${prev.end.toISOString()} and ${cur.title}@${cur.start.toISOString()}`,
          );
        }
        if (gapMs < 0) {
          problems.push(
            `OVERLAP ${gapMs}ms between ${prev.title}@${prev.end.toISOString()} and ${cur.title}@${cur.start.toISOString()}`,
          );
        }
      }

      expect({ config: c.name, problems }).toEqual({
        config: c.name,
        problems: [],
      });
    });
  }
});

describe("INVARIANT: rotation order + fairness over many periods", () => {
  const configs: Config[] = [];
  const intervals: EventInterval[] = [
    EventInterval.Hour,
    EventInterval.Day,
    EventInterval.Week,
  ];
  const counts: number[] = [1, 2, 3];
  const userSets: string[][] = [
    ["A", "B", "C"],
    ["A", "B", "C", "D", "E"],
  ];
  const timezones: (string | undefined)[] = [undefined, "America/New_York"];
  for (const it of intervals) {
    for (const count of counts) {
      for (const users of userSets) {
        for (const tz of timezones) {
          configs.push({
            name: `${count}x${it} users=${users.length} tz=${tz ?? "local"}`,
            intervalType: it,
            intervalCount: count,
            userIds: users,
            timezone: tz,
            start: START,
          });
        }
      }
    }
  }

  const horizonMs: Record<string, number> = {
    [EventInterval.Hour]: 120 * 3600000,
    [EventInterval.Day]: 120 * 86400000,
    [EventInterval.Week]: 60 * 604800000,
  };

  for (const c of configs) {
    it(`${c.name}`, () => {
      const layer: LayerProps = layerOf(c);
      const to: Date = new Date(
        START.getTime() + (horizonMs[c.intervalType] || 120 * 86400000),
      );
      const events: Array<CalendarEvent> = fullExpand(layer, to);

      // ORDER: consecutive events cycle in userIds order.
      const orderProblems: string[] = [];
      const n: number = c.userIds.length;
      for (let i: number = 0; i < events.length; i++) {
        const expected: string = c.userIds[i % n]!;
        if (events[i]!.title !== expected) {
          orderProblems.push(
            `event#${i} start=${events[i]!.start.toISOString()} expected=${expected} actual=${events[i]!.title}`,
          );
          break; // first divergence is enough
        }
      }

      // FAIRNESS: drop the final (possibly clipped) event, count shifts.
      const counts: Record<string, number> = {};
      const usable: Array<CalendarEvent> = events.slice(0, -1);
      for (const e of usable) {
        counts[e.title] = (counts[e.title] || 0) + 1;
      }
      const values: number[] = c.userIds.map((u: string) => {
        return counts[u] || 0;
      });
      const max: number = Math.max(...values);
      const min: number = Math.min(...values);

      expect({
        config: c.name,
        orderProblems,
        fairnessSpread: max - min,
      }).toEqual({
        config: c.name,
        orderProblems: [],
        fairnessSpread: max - min <= 1 ? max - min : "TOO_WIDE:" + (max - min),
      });
    });
  }
});
