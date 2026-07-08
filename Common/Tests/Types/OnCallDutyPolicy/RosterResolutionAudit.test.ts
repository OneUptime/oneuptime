/*
 * TEMPORARY AUDIT TEST — replicates OnCallDutyPolicyScheduleService roster
 * resolution (getNumberOfEvents:2 + override split + future check) against a
 * full ground-truth expansion. Delete after audit.
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
import UserOverrideUtil, {
  UserOverrideRecord,
} from "../../../Types/OnCallDutyPolicy/UserOverrideUtil";

function user(id: string): User {
  return { id: { toString: () => id } as any } as User;
}

function makeLayer(data: {
  users: string[];
  start: Date;
  handoff: Date;
  intervalType: EventInterval;
  intervalCount: number;
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
    timezone: undefined,
  };
}

// Replicates Service.computeResolutionWindowEnd but capped small for test speed.
// (getNumberOfEvents:2 => needs 3 periods; window at least a few periods.)
function windowEnd(layer: LayerProps, from: Date): Date {
  let candidate: Date = from;
  for (let i: number = 0; i < 5; i++) {
    candidate = Recurring.getNextDateInterval(candidate, layer.rotation);
  }
  return candidate;
}

// Replicates Service.getCurrrentUserIdAndHandoffTimeInSchedule resolution part.
function serviceResolve(
  layer: LayerProps,
  now: Date,
  overrides: Array<UserOverrideRecord>,
): { current: string | null; next: string | null } {
  const util: LayerUtil = new LayerUtil();
  let events: Array<CalendarEvent> = util.getMultiLayerEvents(
    {
      layers: [layer],
      calendarStartDate: now,
      calendarEndDate: windowEnd(layer, now),
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

// Ground truth: full expansion from layer start (bounded), apply overrides.
function groundTruth(
  layer: LayerProps,
  now: Date,
  overrides: Array<UserOverrideRecord>,
): { current: string | null; next: string | null } {
  const util: LayerUtil = new LayerUtil();
  let events: Array<CalendarEvent> = util.getEvents({
    ...layer,
    calendarStartDate: layer.startDateTimeOfLayer,
    calendarEndDate: OneUptimeDate.addRemoveDays(now, 30),
  });
  if (events.length > 0 && overrides.length > 0) {
    events = UserOverrideUtil.applyOverridesToEvents({ events, overrides });
  }
  events = events.sort((a: CalendarEvent, b: CalendarEvent) => {
    return a.start.getTime() - b.start.getTime();
  });
  let current: string | null = null;
  let next: string | null = null;
  for (let i: number = 0; i < events.length; i++) {
    const e: CalendarEvent = events[i]!;
    // half-open [start, end)
    if (OneUptimeDate.isOnOrBefore(e.start, now) && OneUptimeDate.isAfter(e.end, now)) {
      current = e.title;
      next = events[i + 1] ? events[i + 1]!.title : null;
      break;
    }
    if (OneUptimeDate.isAfter(e.start, now)) {
      // now sits before this event (in a gap or before first) => current null, next is this
      next = e.title;
      break;
    }
  }
  return { current, next };
}

const baseStart: Date = OneUptimeDate.fromString("2025-01-01T00:00:00.000Z");

function firstHandoff(start: Date, type: EventInterval, count: number): Date {
  const rot: Recurring = new Recurring();
  rot.intervalType = type;
  rot.intervalCount = new PositiveNumber(count);
  return Recurring.getNextDateInterval(start, rot);
}

describe("AUDIT roster resolution current/next vs ground truth (no override)", () => {
  const offsetsHours: number[] = [0.5, 1, 2, 3.5, 5, 8, 13, 25, 49, 24 * 3 + 5, 24 * 7 + 2];
  const cases: Array<{ name: string; users: string[]; type: EventInterval; count: number }> = [
    { name: "hourly x1 / 3u", users: ["A", "B", "C"], type: EventInterval.Hour, count: 1 },
    { name: "hourly x3 / 4u", users: ["A", "B", "C", "D"], type: EventInterval.Hour, count: 3 },
    { name: "daily x1 / 2u", users: ["A", "B"], type: EventInterval.Day, count: 1 },
    { name: "daily x2 / 3u", users: ["A", "B", "C"], type: EventInterval.Day, count: 2 },
    { name: "single user daily", users: ["A"], type: EventInterval.Day, count: 1 },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const layer: LayerProps = makeLayer({
        users: c.users,
        start: baseStart,
        handoff: firstHandoff(baseStart, c.type, c.count),
        intervalType: c.type,
        intervalCount: c.count,
      });
      const mism: string[] = [];
      for (const oh of offsetsHours) {
        const at: Date = OneUptimeDate.addRemoveHours(baseStart, oh);
        const svc = serviceResolve(layer, at, []);
        const gt = groundTruth(layer, at, []);
        if (svc.current !== gt.current || svc.next !== gt.next) {
          mism.push(`@${oh}h svc(${svc.current},${svc.next}) gt(${gt.current},${gt.next})`);
        }
      }
      expect(mism).toEqual([]);
    });
  }
});

describe("AUDIT override split: current/next correct when override splits current shift", () => {
  it("hourly x1, override X in middle of A's shift", () => {
    const layer: LayerProps = makeLayer({
      users: ["A", "B", "C"],
      start: baseStart,
      handoff: firstHandoff(baseStart, EventInterval.Hour, 1),
      intervalType: EventInterval.Hour,
      intervalCount: 1,
    });
    // Long override on user A -> X, and also on B -> Y (overlapping), to probe split.
    const overrides: Array<UserOverrideRecord> = [
      {
        overrideUserId: "A",
        routeAlertsToUserId: "X",
        startsAt: baseStart,
        endsAt: OneUptimeDate.addRemoveHours(baseStart, 200),
        onCallDutyPolicyId: null,
      },
      {
        overrideUserId: "B",
        routeAlertsToUserId: "Y",
        startsAt: baseStart,
        endsAt: OneUptimeDate.addRemoveHours(baseStart, 200),
        onCallDutyPolicyId: null,
      },
    ];
    const offsetsHours: number[] = [0.5, 1, 1.5, 2, 2.5, 3, 5, 8, 13, 25];
    const mism: string[] = [];
    for (const oh of offsetsHours) {
      const at: Date = OneUptimeDate.addRemoveHours(baseStart, oh);
      const svc = serviceResolve(layer, at, overrides);
      const gt = groundTruth(layer, at, overrides);
      if (svc.current !== gt.current || svc.next !== gt.next) {
        mism.push(`@${oh}h svc(${svc.current},${svc.next}) gt(${gt.current},${gt.next})`);
      }
    }
    expect(mism).toEqual([]);
  });

  it("daily x1 2 users, short override covering only part of NEXT shift", () => {
    const layer: LayerProps = makeLayer({
      users: ["A", "B"],
      start: baseStart,
      handoff: firstHandoff(baseStart, EventInterval.Day, 1),
      intervalType: EventInterval.Day,
      intervalCount: 1,
    });
    // Override on B (who is on call day 2) for a 2h window mid-shift.
    const overrides: Array<UserOverrideRecord> = [
      {
        overrideUserId: "B",
        routeAlertsToUserId: "Z",
        startsAt: OneUptimeDate.addRemoveHours(baseStart, 24 + 10),
        endsAt: OneUptimeDate.addRemoveHours(baseStart, 24 + 12),
        onCallDutyPolicyId: null,
      },
    ];
    const offsetsHours: number[] = [1, 5, 12, 23, 24 + 1, 24 + 9, 24 + 11, 24 + 13, 48 + 2];
    const mism: string[] = [];
    for (const oh of offsetsHours) {
      const at: Date = OneUptimeDate.addRemoveHours(baseStart, oh);
      const svc = serviceResolve(layer, at, overrides);
      const gt = groundTruth(layer, at, overrides);
      if (svc.current !== gt.current || svc.next !== gt.next) {
        mism.push(`@${oh}h svc(${svc.current},${svc.next}) gt(${gt.current},${gt.next})`);
      }
    }
    expect(mism).toEqual([]);
  });
});
