/*
 * TEMPORARY AUDIT TEST — replicates OnCallDutyPolicyScheduleService roster
 * resolution (window sizing + getNumberOfEvents:2 + override split + future
 * check) against a full ground-truth expansion. Delete after audit.
 */
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
import PositiveNumber from "../../../Types/PositiveNumber";
import UserOverrideUtil, {
  UserOverrideRecord,
} from "../../../Types/OnCallDutyPolicy/UserOverrideUtil";
import DayOfWeek from "../../../Types/Day/DayOfWeek";

function user(id: string): User {
  return { id: { toString: () => id } as any } as User;
}

function makeLayer(data: {
  users: string[];
  start: Date;
  handoff: Date;
  intervalType: EventInterval;
  intervalCount: number;
  restriction?: RestrictionTimes | undefined;
  timezone?: string | undefined;
}): LayerProps {
  const r: RestrictionTimes =
    data.restriction ||
    (() => {
      const rr: RestrictionTimes = new RestrictionTimes();
      rr.restictionType = RestrictionType.None;
      return rr;
    })();
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

// Replicates Service.computeResolutionWindowEnd.
function computeResolutionWindowEnd(
  layerProps: Array<LayerProps>,
  from: Date,
  getNumberOfEvents: number,
): Date {
  let windowEnd: Date = OneUptimeDate.addRemoveYears(from, 1);
  const periodsNeeded: number = Math.max(2, getNumberOfEvents + 1);
  for (const layer of layerProps) {
    if (!layer.rotation) {
      continue;
    }
    const recurring: Recurring = layer.rotation;
    let candidate: Date = from;
    for (let i: number = 0; i < periodsNeeded; i++) {
      candidate = Recurring.getNextDateInterval(candidate, recurring);
    }
    if (OneUptimeDate.isAfter(candidate, windowEnd)) {
      windowEnd = candidate;
    }
  }
  return windowEnd;
}

// Replicates Service.getCurrrentUserIdAndHandoffTimeInSchedule (resolution part).
function serviceResolve(
  layers: Array<LayerProps>,
  now: Date,
  overrides: Array<UserOverrideRecord>,
): { current: string | null; next: string | null } {
  const util: LayerUtil = new LayerUtil();
  const windowEnd: Date = computeResolutionWindowEnd(layers, now, 2);
  let events: Array<CalendarEvent> = util.getMultiLayerEvents(
    {
      layers,
      calendarStartDate: now,
      calendarEndDate: windowEnd,
    },
    { getNumberOfEvents: 2 },
  );
  if (events.length > 0 && overrides.length > 0) {
    events = UserOverrideUtil.applyOverridesToEvents({ events, overrides });
  }
  let currentEvent: CalendarEvent | null = events[0] || null;
  let nextEvent: CalendarEvent | null = events[1] || null;
  if (currentEvent && OneUptimeDate.isInTheFuture(currentEvent.start)) {
    nextEvent = currentEvent;
    currentEvent = null;
  }
  return {
    current: currentEvent ? currentEvent.title : null,
    next: nextEvent ? nextEvent.title : null,
  };
}

// Ground truth: full expansion from layer start, apply overrides, find covering.
function groundTruth(
  layers: Array<LayerProps>,
  now: Date,
  overrides: Array<UserOverrideRecord>,
): { current: string | null } {
  const util: LayerUtil = new LayerUtil();
  const earliestStart: Date = layers
    .map((l: LayerProps) => {
      return l.startDateTimeOfLayer;
    })
    .reduce((a: Date, b: Date) => {
      return OneUptimeDate.isBefore(a, b) ? a : b;
    });
  let events: Array<CalendarEvent> = util.getMultiLayerEvents({
    layers,
    calendarStartDate: earliestStart,
    calendarEndDate: OneUptimeDate.addRemoveDays(now, 2),
  });
  if (events.length > 0 && overrides.length > 0) {
    events = UserOverrideUtil.applyOverridesToEvents({ events, overrides });
  }
  for (const e of events) {
    // half-open [start, end)
    if (OneUptimeDate.isOnOrBefore(e.start, now) && OneUptimeDate.isAfter(e.end, now)) {
      return { current: e.title };
    }
  }
  return { current: null };
}

const baseStart: Date = OneUptimeDate.fromString("2025-01-01T00:00:00.000Z");

function hourlyHandoff(start: Date, type: EventInterval, count: number): Date {
  const rot: Recurring = new Recurring();
  rot.intervalType = type;
  rot.intervalCount = new PositiveNumber(count);
  return Recurring.getNextDateInterval(start, rot);
}

describe("AUDIT roster resolution: current matches ground truth (single + multi layer, restrictions, overrides)", () => {
  const offsetsHours: number[] = [
    0.5, 1, 2, 3.5, 5, 8, 13, 20, 25, 30, 49, 24 * 3 + 5, 24 * 7 + 2,
    24 * 10 + 7, 24 * 14 + 1, 24 * 30 + 6,
  ];

  it("single layer daily, 3 users, no restriction", () => {
    const layer: LayerProps = makeLayer({
      users: ["A", "B", "C"],
      start: baseStart,
      handoff: hourlyHandoff(baseStart, EventInterval.Day, 1),
      intervalType: EventInterval.Day,
      intervalCount: 1,
    });
    for (const oh of offsetsHours) {
      const at: Date = OneUptimeDate.addRemoveHours(baseStart, oh);
      const svc = serviceResolve([layer], at, []);
      const gt = groundTruth([layer], at, []);
      expect(`@${oh}h current=${svc.current}`).toBe(`@${oh}h current=${gt.current}`);
    }
  });

  it("single layer hourly x1, 3 users, override in middle of current shift", () => {
    const layer: LayerProps = makeLayer({
      users: ["A", "B", "C"],
      start: baseStart,
      handoff: hourlyHandoff(baseStart, EventInterval.Hour, 1),
      intervalType: EventInterval.Hour,
      intervalCount: 1,
    });
    // Override covering a window; overrideUser is whoever; substitute X.
    const overrides: Array<UserOverrideRecord> = [
      {
        overrideUserId: "A",
        routeAlertsToUserId: "X",
        startsAt: OneUptimeDate.addRemoveHours(baseStart, 0),
        endsAt: OneUptimeDate.addRemoveHours(baseStart, 100),
        onCallDutyPolicyId: null,
      },
    ];
    for (const oh of offsetsHours) {
      const at: Date = OneUptimeDate.addRemoveHours(baseStart, oh);
      const svc = serviceResolve([layer], at, overrides);
      const gt = groundTruth([layer], at, overrides);
      expect(`@${oh}h current=${svc.current}`).toBe(`@${oh}h current=${gt.current}`);
    }
  });

  it("two layers: primary restricted Mon-Fri 09-17, fallback 24/7 (multi-layer merge)", () => {
    // primary: restricted to weekdays 09-17
    const restriction: RestrictionTimes = new RestrictionTimes();
    restriction.restictionType = RestrictionType.Weekly;
    const weekly: Array<WeeklyResctriction> = [
      {
        startDay: DayOfWeek.Monday,
        endDay: DayOfWeek.Friday,
        startTime: OneUptimeDate.getDateWithCustomTime({
          hours: 9,
          minutes: 0,
          seconds: 0,
        }),
        endTime: OneUptimeDate.getDateWithCustomTime({
          hours: 17,
          minutes: 0,
          seconds: 0,
        }),
      },
    ];
    restriction.weeklyRestrictionTimes = weekly;

    const primary: LayerProps = makeLayer({
      users: ["P1", "P2"],
      start: baseStart,
      handoff: hourlyHandoff(baseStart, EventInterval.Day, 1),
      intervalType: EventInterval.Day,
      intervalCount: 1,
      restriction,
    });
    const fallback: LayerProps = makeLayer({
      users: ["F1", "F2"],
      start: baseStart,
      handoff: hourlyHandoff(baseStart, EventInterval.Day, 1),
      intervalType: EventInterval.Day,
      intervalCount: 1,
    });
    const layers: Array<LayerProps> = [primary, fallback];

    const wideOffsets: number[] = [];
    for (let h = 0; h <= 24 * 10; h += 1) {
      wideOffsets.push(h);
    }
    let mismatches: string[] = [];
    for (const oh of wideOffsets) {
      const at: Date = OneUptimeDate.addRemoveHours(baseStart, oh);
      const svc = serviceResolve(layers, at, []);
      const gt = groundTruth(layers, at, []);
      if (svc.current !== gt.current) {
        mismatches.push(`@${oh}h svc=${svc.current} gt=${gt.current}`);
      }
    }
    expect(mismatches.slice(0, 20)).toEqual([]);
  });
});
