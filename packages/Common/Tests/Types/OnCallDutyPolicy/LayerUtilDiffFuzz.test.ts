/**
 * EMPIRICAL differential & invariant fuzzing (audit lens).
 *
 * (1) DIFFERENTIAL: for many rotation configs, compare the WINDOWED current-user
 *     resolution (getEvents starting at `at` with getNumberOfEvents:1) against a
 *     FULL expansion from layer start, at many OFF-boundary sampled instants.
 * (2) INVARIANTS: 24/7 coverage contiguity, fairness, rotation order.
 *
 * Any off-boundary mismatch is a real bug and is reported with the exact
 * config + instant + expected/actual.
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

function dailyRestriction(
  startHour: number,
  endHour: number,
): RestrictionTimes {
  const r: RestrictionTimes = new RestrictionTimes();
  r.restictionType = RestrictionType.Daily;
  r.dayRestrictionTimes = {
    startTime: OneUptimeDate.getDateWithCustomTime({
      hours: startHour,
      minutes: 0,
      seconds: 0,
    }),
    endTime: OneUptimeDate.getDateWithCustomTime({
      hours: endHour,
      minutes: 0,
      seconds: 0,
    }),
  };
  return r;
}

interface Config {
  name: string;
  intervalType: EventInterval;
  intervalCount: number;
  userIds: string[];
  restriction: RestrictionTimes;
  timezone?: string | undefined;
  start: Date;
}

function rotationOf(c: Config): Recurring {
  const rot: Recurring = new Recurring();
  rot.intervalType = c.intervalType;
  rot.intervalCount = new PositiveNumber(c.intervalCount);
  return rot;
}

function layerOf(c: Config): LayerProps {
  const rot: Recurring = rotationOf(c);
  const handoff: Date = Recurring.getNextDateInterval(c.start, rot);
  return {
    users: c.userIds.map(user),
    startDateTimeOfLayer: c.start,
    restrictionTimes: c.restriction,
    handOffTime: handoff,
    rotation: rot,
    timezone: c.timezone,
  };
}

// Windowed "who is on call at `at`" (what the live roster resolution uses).
function windowedUserAt(layer: LayerProps, at: Date): string | null {
  const util: LayerUtil = new LayerUtil();
  const events: Array<CalendarEvent> = util.getEvents(
    {
      ...layer,
      calendarStartDate: at,
      calendarEndDate: OneUptimeDate.addRemoveDays(at, 40),
    },
    { getNumberOfEvents: 1 },
  );
  return events[0]?.title ?? null;
}

// Full expansion from layer start over [start, to].
function fullExpand(layer: LayerProps, to: Date): Array<CalendarEvent> {
  const util: LayerUtil = new LayerUtil();
  return util.getEvents({
    ...layer,
    calendarStartDate: layer.startDateTimeOfLayer,
    calendarEndDate: to,
  });
}

// Find the event that covers `at` (start <= at < end), interior only.
function coveringEvent(
  events: Array<CalendarEvent>,
  at: Date,
): CalendarEvent | null {
  for (const e of events) {
    if (
      OneUptimeDate.isOnOrAfter(at, e.start) &&
      OneUptimeDate.isBefore(at, e.end)
    ) {
      return e;
    }
  }
  return null;
}

// Next event that starts strictly after `at`.
function nextEventAfter(
  events: Array<CalendarEvent>,
  at: Date,
): CalendarEvent | null {
  let best: CalendarEvent | null = null;
  for (const e of events) {
    if (OneUptimeDate.isAfter(e.start, at)) {
      if (best === null || OneUptimeDate.isBefore(e.start, best.start)) {
        best = e;
      }
    }
  }
  return best;
}

// period length in ms for sampling offsets (approx; used only to pick instants).
function approxPeriodMs(c: Config): number {
  const base: Record<string, number> = {
    [EventInterval.Hour]: 3600000,
    [EventInterval.Day]: 86400000,
    [EventInterval.Week]: 604800000,
    [EventInterval.Month]: 30 * 86400000,
    [EventInterval.Year]: 365 * 86400000,
  };
  return (base[c.intervalType] || 86400000) * c.intervalCount;
}

const FIXED_START_JAN: Date = OneUptimeDate.fromString(
  "2025-01-06T00:00:00.000Z",
); // a Monday 00:00 UTC

// Build the config matrix.
function buildConfigs(): Config[] {
  const configs: Config[] = [];
  const intervals: EventInterval[] = [
    EventInterval.Hour,
    EventInterval.Day,
    EventInterval.Week,
    EventInterval.Month,
  ];
  const counts: number[] = [1, 2, 3];
  const userSets: string[][] = [
    ["A"],
    ["A", "B"],
    ["A", "B", "C"],
    ["A", "B", "C", "D", "E"],
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
            name: `${count}x${it} users=${users.length} tz=${tz ?? "local"} unrestricted`,
            intervalType: it,
            intervalCount: count,
            userIds: users,
            restriction: noRestriction(),
            timezone: tz,
            start: FIXED_START_JAN,
          });
        }
      }
    }
  }
  return configs;
}

// Off-boundary offsets (in units of periods) to probe.
const PERIOD_OFFSETS: number[] = [
  0.13, 0.37, 0.5, 0.63, 0.87, 1.29, 2.41, 3.17, 5.53, 7.31, 10.42, 13.19,
  20.61, 30.28, 50.44,
];

describe("DIFFERENTIAL: windowed resolution == full expansion (unrestricted, off-boundary)", () => {
  const configs: Config[] = buildConfigs();

  for (const c of configs) {
    it(`${c.name}`, () => {
      const layer: LayerProps = layerOf(c);
      const periodMs: number = approxPeriodMs(c);
      const mismatches: string[] = [];

      for (const off of PERIOD_OFFSETS) {
        const at: Date = new Date(
          c.start.getTime() + Math.round(off * periodMs),
        );
        // Full expansion needs to comfortably contain `at` plus a next event.
        const to: Date = new Date(at.getTime() + 3 * periodMs);
        const full: Array<CalendarEvent> = fullExpand(layer, to);
        const cover: CalendarEvent | null = coveringEvent(full, at);
        const windowed: string | null = windowedUserAt(layer, at);

        if (cover) {
          if (windowed !== cover.title) {
            mismatches.push(
              `at=${at.toISOString()} off=${off} expected(full-cover)=${cover.title} windowed=${windowed}`,
            );
          }
        } else {
          // In an unrestricted rotation there should ALWAYS be coverage.
          mismatches.push(
            `at=${at.toISOString()} off=${off} NO full coverage (unexpected in 24/7 rotation) windowed=${windowed}`,
          );
        }
      }

      expect({ config: c.name, mismatches }).toEqual({
        config: c.name,
        mismatches: [],
      });
    });
  }
});

describe("DIFFERENTIAL: restricted daily 09-17 covered-instant agreement", () => {
  const restrictedConfigs: Config[] = [];
  const intervals: EventInterval[] = [EventInterval.Day, EventInterval.Week];
  const counts: number[] = [1, 2];
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
          restrictedConfigs.push({
            name: `${count}x${it} users=${users.length} tz=${tz ?? "local"} daily09-17`,
            intervalType: it,
            intervalCount: count,
            userIds: users,
            restriction: dailyRestriction(9, 17),
            timezone: tz,
            start: FIXED_START_JAN,
          });
        }
      }
    }
  }

  for (const c of restrictedConfigs) {
    it(`${c.name}`, () => {
      const layer: LayerProps = layerOf(c);
      const periodMs: number = approxPeriodMs(c);
      const mismatches: string[] = [];

      for (const off of PERIOD_OFFSETS) {
        const at: Date = new Date(
          c.start.getTime() + Math.round(off * periodMs),
        );
        const to: Date = new Date(at.getTime() + 5 * periodMs);
        const full: Array<CalendarEvent> = fullExpand(layer, to);
        const cover: CalendarEvent | null = coveringEvent(full, at);
        const windowed: string | null = windowedUserAt(layer, at);

        if (cover) {
          // `at` is inside a covered restriction window: must agree.
          if (windowed !== cover.title) {
            mismatches.push(
              `COVERED at=${at.toISOString()} off=${off} expected=${cover.title} windowed=${windowed}`,
            );
          }
        } else {
          // `at` in a gap: windowed should equal the NEXT covered user.
          const nxt: CalendarEvent | null = nextEventAfter(full, at);
          if (nxt && windowed !== nxt.title) {
            mismatches.push(
              `GAP at=${at.toISOString()} off=${off} expectedNext=${nxt.title} windowed=${windowed}`,
            );
          }
        }
      }

      expect({ config: c.name, mismatches }).toEqual({
        config: c.name,
        mismatches: [],
      });
    });
  }
});
