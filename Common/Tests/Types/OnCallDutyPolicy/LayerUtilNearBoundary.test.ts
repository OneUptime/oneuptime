/*
 * TEMP audit: near-boundary differential for the O(1) fast-path count.
 * Samples INTERIOR instants within the ~1h DST-drift zone around each rotation
 * boundary (but never within 2s of a boundary, to avoid the 1s-gap artifact)
 * and requires windowed resolution to match a single precomputed full
 * expansion. Targets a possible analytic-count overshoot when getUnitsBetweenDates
 * (server-local moment diff) disagrees with schedule-tz wall-clock stepping.
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

function windowedUserAt(layer: LayerProps, at: Date): string | null {
  const util: LayerUtil = new LayerUtil();
  const events: Array<CalendarEvent> = util.getEvents(
    {
      ...layer,
      calendarStartDate: at,
      calendarEndDate: OneUptimeDate.addRemoveDays(at, 3),
    },
    { getNumberOfEvents: 1 },
  );
  return events[0]?.title ?? null;
}

describe("NEAR-BOUNDARY fast-path differential (interior only)", () => {
  const configs: Array<{
    name: string;
    users: string[];
    intervalType: EventInterval;
    intervalCount: number;
    timezone: string;
    start: Date;
    horizonDays: number;
  }> = [
    {
      name: "daily x1, 2u, NY",
      users: ["A", "B"],
      intervalType: EventInterval.Day,
      intervalCount: 1,
      timezone: "America/New_York",
      start: OneUptimeDate.fromString("2025-01-01T12:00:00.000Z"),
      horizonDays: 400,
    },
    {
      name: "daily x1, 3u, NY, evening handoff",
      users: ["A", "B", "C"],
      intervalType: EventInterval.Day,
      intervalCount: 1,
      timezone: "America/New_York",
      start: OneUptimeDate.fromString("2025-01-01T01:30:00.000Z"),
      horizonDays: 400,
    },
    {
      name: "daily x2, 3u, NY",
      users: ["A", "B", "C"],
      intervalType: EventInterval.Day,
      intervalCount: 2,
      timezone: "America/New_York",
      start: OneUptimeDate.fromString("2025-01-01T06:45:00.000Z"),
      horizonDays: 400,
    },
    {
      name: "weekly x1, 3u, NY",
      users: ["A", "B", "C"],
      intervalType: EventInterval.Week,
      intervalCount: 1,
      timezone: "America/New_York",
      start: OneUptimeDate.fromString("2025-01-01T13:00:00.000Z"),
      horizonDays: 420,
    },
  ];

  for (const cfg of configs) {
    it(`${cfg.name}`, () => {
      const rot: Recurring = new Recurring();
      rot.intervalType = cfg.intervalType;
      rot.intervalCount = new PositiveNumber(cfg.intervalCount);
      const handoff: Date = Recurring.getNextDateInterval(cfg.start, rot);
      const layer: LayerProps = makeLayer({
        users: cfg.users,
        start: cfg.start,
        handoff,
        intervalType: cfg.intervalType,
        intervalCount: cfg.intervalCount,
        timezone: cfg.timezone,
      });

      // Precompute one full expansion for the whole horizon.
      const util: LayerUtil = new LayerUtil();
      const fullEvents: Array<CalendarEvent> = util.getEvents({
        ...layer,
        calendarStartDate: cfg.start,
        calendarEndDate: OneUptimeDate.addRemoveDays(cfg.start, cfg.horizonDays),
      });

      const truthAt = (at: Date): string | null => {
        // end-inclusive lookup
        for (const e of fullEvents) {
          if (
            OneUptimeDate.isOnOrAfter(at, e.start) &&
            OneUptimeDate.isOnOrBefore(at, e.end)
          ) {
            return e.title;
          }
        }
        return null;
      };

      // Walk boundaries; sample interior offsets around each (in minutes).
      const offsetsMin: number[] = [
        -75, -61, -60, -59, -31, -2, 2, 31, 59, 60, 61, 75,
      ];
      const mismatches: string[] = [];
      let boundary: Date = handoff;
      const end: Date = OneUptimeDate.addRemoveDays(cfg.start, cfg.horizonDays);
      let guard: number = 0;
      while (OneUptimeDate.isBefore(boundary, end) && guard < 5000) {
        guard++;
        for (const m of offsetsMin) {
          const at: Date = OneUptimeDate.addRemoveMinutes(boundary, m);
          if (
            OneUptimeDate.isOnOrBefore(at, cfg.start) ||
            OneUptimeDate.isAfter(at, end)
          ) {
            continue;
          }
          // skip if within 2s of ANY boundary (avoid the 1s-gap artifact)
          const secToThis: number = Math.abs(
            OneUptimeDate.getSecondsBetweenTwoDates(boundary, at),
          );
          if (secToThis <= 2) {
            continue;
          }
          const truth: string | null = truthAt(at);
          const windowed: string | null = windowedUserAt(layer, at);
          if (truth !== windowed) {
            mismatches.push(
              `at=${at.toISOString()} (boundary=${boundary.toISOString()}, off=${m}m) truth=${truth} windowed=${windowed}`,
            );
          }
        }
        boundary = Recurring.getNextDateInterval(boundary, rot);
      }
      // Report at most a handful.
      expect(mismatches.slice(0, 10)).toEqual([]);
    });
  }
});
