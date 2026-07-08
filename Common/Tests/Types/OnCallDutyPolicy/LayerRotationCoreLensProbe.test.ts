/*
 * LENS PROBE (rotation core loop & handoff alignment). Temporary.
 * Compares windowed "who is on call now" resolution against a full expansion
 * from layer start, sampling at MID-PERIOD instants (away from boundaries) to
 * avoid the known +1s stitching gap artifact. Any mismatch here is a real bug.
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
      OneUptimeDate.isBefore(at, e.end)
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
      calendarEndDate: OneUptimeDate.addRemoveDays(at, 3),
    },
    { getNumberOfEvents: 1 },
  );
  const first: CalendarEvent | undefined = events[0];
  if (!first) {
    return null;
  }
  return first.title;
}

describe("ROTATION LENS: windowed == full at mid-period instants", () => {
  const base: Date = OneUptimeDate.fromString("2025-01-01T00:00:00.000Z");

  const configs: Array<{
    name: string;
    users: string[];
    intervalType: EventInterval;
    intervalCount: number;
    timezone?: string | undefined;
    // seconds of a single period (approx) to compute mid-period samples
    periodSeconds: number;
  }> = [
    { name: "hourly x1", users: ["A", "B", "C"], intervalType: EventInterval.Hour, intervalCount: 1, periodSeconds: 3600 },
    { name: "hourly x3", users: ["A", "B", "C", "D"], intervalType: EventInterval.Hour, intervalCount: 3, periodSeconds: 3 * 3600 },
    { name: "hourly x5", users: ["A", "B", "C"], intervalType: EventInterval.Hour, intervalCount: 5, periodSeconds: 5 * 3600 },
    { name: "daily x1", users: ["A", "B"], intervalType: EventInterval.Day, intervalCount: 1, periodSeconds: 86400 },
    { name: "daily x2", users: ["A", "B", "C"], intervalType: EventInterval.Day, intervalCount: 2, periodSeconds: 2 * 86400 },
    { name: "daily x3", users: ["A", "B", "C", "D"], intervalType: EventInterval.Day, intervalCount: 3, periodSeconds: 3 * 86400 },
    { name: "weekly x1", users: ["A", "B", "C"], intervalType: EventInterval.Week, intervalCount: 1, periodSeconds: 7 * 86400 },
    { name: "weekly x2", users: ["A", "B"], intervalType: EventInterval.Week, intervalCount: 2, periodSeconds: 14 * 86400 },
    { name: "hourly x1 NY", users: ["A", "B", "C"], intervalType: EventInterval.Hour, intervalCount: 1, periodSeconds: 3600, timezone: "America/New_York" },
    { name: "hourly x2 NY", users: ["A", "B", "C"], intervalType: EventInterval.Hour, intervalCount: 2, periodSeconds: 2 * 3600, timezone: "America/New_York" },
    { name: "daily x1 NY", users: ["A", "B", "C"], intervalType: EventInterval.Day, intervalCount: 1, periodSeconds: 86400, timezone: "America/New_York" },
    { name: "daily x2 NY", users: ["A", "B", "C"], intervalType: EventInterval.Day, intervalCount: 2, periodSeconds: 2 * 86400, timezone: "America/New_York" },
    { name: "weekly x1 NY", users: ["A", "B", "C"], intervalType: EventInterval.Week, intervalCount: 1, periodSeconds: 7 * 86400, timezone: "America/New_York" },
  ];

  for (const cfg of configs) {
    it(`${cfg.name}`, () => {
      const rot: Recurring = new Recurring();
      rot.intervalType = cfg.intervalType;
      rot.intervalCount = new PositiveNumber(cfg.intervalCount);
      const handoff: Date = Recurring.getNextDateInterval(base, rot);

      const layer: LayerProps = makeLayer({
        users: cfg.users,
        start: base,
        handoff,
        intervalType: cfg.intervalType,
        intervalCount: cfg.intervalCount,
        timezone: cfg.timezone,
      });

      const mismatches: string[] = [];
      // sample at period k + half period (mid-period), for many k including across DST.
      const ks: number[] = [0, 1, 2, 3, 5, 8, 13, 30, 60, 90, 120, 200, 300, 400];
      for (const k of ks) {
        // mid-period instant = base + (k + 0.5) periods, using absolute seconds.
        const offsetSec: number = Math.floor((k + 0.5) * cfg.periodSeconds);
        const at: Date = OneUptimeDate.addRemoveSeconds(base, offsetSec);
        const truth: string | null = groundTruthUserAt(layer, at);
        const windowed: string | null = windowedUserAt(layer, at);
        if (truth !== windowed) {
          mismatches.push(
            `k=${k} at=${OneUptimeDate.toString(at)} full=${truth} windowed=${windowed}`,
          );
        }
      }
      expect(mismatches).toEqual([]);
    });
  }
});

describe("ROTATION LENS: handoff BEFORE layer start", () => {
  it("daily handoff at prev-day 22:00, layer starts 00:00", () => {
    const layerStart: Date = OneUptimeDate.fromString("2025-01-01T00:00:00.000Z");
    const handoff: Date = OneUptimeDate.fromString("2024-12-31T22:00:00.000Z");
    const layer: LayerProps = makeLayer({
      users: ["A", "B"],
      start: layerStart,
      handoff,
      intervalType: EventInterval.Day,
      intervalCount: 1,
    });
    const mismatches: string[] = [];
    for (let h = 1; h <= 24 * 6; h += 3) {
      const at: Date = OneUptimeDate.addRemoveHours(layerStart, h);
      const truth: string | null = groundTruthUserAt(layer, at);
      const windowed: string | null = windowedUserAt(layer, at);
      if (truth !== windowed) {
        mismatches.push(`h=${h} full=${truth} windowed=${windowed}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});
