/**
 * RESTRICTION-TIMES MUTATION HYGIENE & CROSS-CALL INVARIANTS (hardening lock-in).
 *
 * The audit flagged an in-place mutation defect: the Daily branch of
 * LayerUtil.trimStartAndEndTimesBasedOnRestrictionTimes used to write the
 * day-moved start/end back into the SHARED RestrictionTimes.dayRestrictionTimes,
 * corrupting the caller's object across events / layers / calls and making
 * resolution order-dependent. The fix computes a LOCAL moved copy
 * (keepTimeButMoveDay) and never touches the shared object.
 *
 * This suite locks that fix in three ways:
 *   (1) NON-MUTATION: after any number of getEvents calls over different
 *       calendar windows/days, the ORIGINAL RestrictionTimes' dayRestrictionTimes
 *       (Daily) / weeklyRestrictionTimes (Weekly) are byte-for-byte unchanged —
 *       same millisecond values AND the same Date/object instances (no reassign).
 *   (2) INDEPENDENCE / NO CROSS-CALL CORRUPTION: two getEvents calls that share
 *       one RestrictionTimes instance are idempotent (re-running an earlier
 *       window after an intervening different window reproduces the earlier
 *       result exactly) AND agree with a pristine deep-clone that was never
 *       passed through getEvents (correctness, not just stability).
 *   (3) LAYER INDEPENDENCE: an unrestricted layer and a restricted layer that
 *       share nothing resolve independently, including when expanded through the
 *       same LayerUtil instance (its per-call `timezone` never leaks across
 *       calls) and when merged via getMultiLayerEvents.
 *
 * All assertions compare a run against itself or an independent identical clone,
 * so they hold regardless of the process TZ the suite runs under.
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
import DayOfWeek from "../../../Types/Day/DayOfWeek";
import StartAndEndTime from "../../../Types/Time/StartAndEndTime";

/*
 * ---------------------------------------------------------------------------
 * Builders / helpers (mirrors sibling LayerUtil test style).
 * ---------------------------------------------------------------------------
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

function noRestriction(): RestrictionTimes {
  const r: RestrictionTimes = new RestrictionTimes();
  r.restictionType = RestrictionType.None;
  r.dayRestrictionTimes = null;
  r.weeklyRestrictionTimes = [];
  return r;
}

function dailyRestriction(
  startHour: number,
  startMinute: number,
  endHour: number,
  endMinute: number,
): RestrictionTimes {
  const r: RestrictionTimes = new RestrictionTimes();
  r.restictionType = RestrictionType.Daily;
  r.dayRestrictionTimes = {
    startTime: OneUptimeDate.getDateWithCustomTime({
      hours: startHour,
      minutes: startMinute,
      seconds: 0,
    }),
    endTime: OneUptimeDate.getDateWithCustomTime({
      hours: endHour,
      minutes: endMinute,
      seconds: 0,
    }),
  };
  return r;
}

interface WeeklyEntrySpec {
  startDay: DayOfWeek;
  endDay: DayOfWeek;
  startTimeIso: string;
  endTimeIso: string;
}

function weeklyRestriction(entries: WeeklyEntrySpec[]): RestrictionTimes {
  const r: RestrictionTimes = new RestrictionTimes();
  r.restictionType = RestrictionType.Weekly;
  r.dayRestrictionTimes = null;
  r.weeklyRestrictionTimes = entries.map(
    (e: WeeklyEntrySpec): WeeklyResctriction => {
      return {
        startDay: e.startDay,
        endDay: e.endDay,
        startTime: OneUptimeDate.fromString(e.startTimeIso),
        endTime: OneUptimeDate.fromString(e.endTimeIso),
      };
    },
  );
  return r;
}

interface LayerConfig {
  users: string[];
  intervalType: EventInterval;
  intervalCount: number;
  restriction: RestrictionTimes;
  timezone?: string | undefined;
  start: Date;
}

function buildLayer(c: LayerConfig): LayerProps {
  const rot: Recurring = new Recurring();
  rot.intervalType = c.intervalType;
  rot.intervalCount = new PositiveNumber(c.intervalCount);
  return {
    users: c.users.map(user),
    startDateTimeOfLayer: c.start,
    restrictionTimes: c.restriction,
    handOffTime: Recurring.getNextDateInterval(c.start, rot),
    rotation: rot,
    timezone: c.timezone,
  };
}

function expand(
  layer: LayerProps,
  start: Date,
  end: Date,
  util?: LayerUtil,
  options?: { getNumberOfEvents?: number } | undefined,
): Array<CalendarEvent> {
  const u: LayerUtil = util ?? new LayerUtil();
  return u.getEvents(
    {
      ...layer,
      calendarStartDate: start,
      calendarEndDate: end,
    },
    options,
  );
}

// Stable, comparable serialization of an event list.
function eventKey(events: Array<CalendarEvent>): string {
  return events
    .map((e: CalendarEvent): string => {
      return `${e.title}@${OneUptimeDate.toString(e.start)}->${OneUptimeDate.toString(e.end)}`;
    })
    .join("|");
}

// Deep clone with identical millisecond values but fully independent objects.
function cloneRestriction(r: RestrictionTimes): RestrictionTimes {
  const c: RestrictionTimes = new RestrictionTimes();
  c.restictionType = r.restictionType;
  c.dayRestrictionTimes = r.dayRestrictionTimes
    ? {
        startTime: new Date(r.dayRestrictionTimes.startTime.getTime()),
        endTime: new Date(r.dayRestrictionTimes.endTime.getTime()),
      }
    : null;
  c.weeklyRestrictionTimes = r.weeklyRestrictionTimes.map(
    (w: WeeklyResctriction): WeeklyResctriction => {
      return {
        startDay: w.startDay,
        endDay: w.endDay,
        startTime: new Date(w.startTime.getTime()),
        endTime: new Date(w.endTime.getTime()),
      };
    },
  );
  return c;
}

// ---- Daily snapshot / assertion --------------------------------------------

interface DailySnapshot {
  startMs: number;
  endMs: number;
  startRef: Date;
  endRef: Date;
  objRef: StartAndEndTime;
}

function snapshotDaily(r: RestrictionTimes): DailySnapshot {
  const d: StartAndEndTime | null = r.dayRestrictionTimes;
  if (!d) {
    throw new Error("expected a Daily restriction with dayRestrictionTimes");
  }
  return {
    startMs: d.startTime.getTime(),
    endMs: d.endTime.getTime(),
    startRef: d.startTime,
    endRef: d.endTime,
    objRef: d,
  };
}

function assertDailyUnchanged(r: RestrictionTimes, snap: DailySnapshot): void {
  const now: DailySnapshot = snapshotDaily(r);
  // values (millisecond precision) must be identical.
  expect(now.startMs).toBe(snap.startMs);
  expect(now.endMs).toBe(snap.endMs);
  // instances must be identical (no in-place mutation, no reassignment).
  expect(now.startRef).toBe(snap.startRef);
  expect(now.endRef).toBe(snap.endRef);
  expect(now.objRef).toBe(snap.objRef);
  // type preserved.
  expect(r.restictionType).toBe(RestrictionType.Daily);
}

// ---- Weekly snapshot / assertion -------------------------------------------

interface WeeklyEntrySnapshot {
  startMs: number;
  endMs: number;
  startDay: DayOfWeek;
  endDay: DayOfWeek;
  startRef: Date;
  endRef: Date;
  ref: WeeklyResctriction;
}

interface WeeklySnapshot {
  length: number;
  arrRef: Array<WeeklyResctriction>;
  entries: WeeklyEntrySnapshot[];
}

function snapshotWeekly(r: RestrictionTimes): WeeklySnapshot {
  const arr: Array<WeeklyResctriction> = r.weeklyRestrictionTimes;
  return {
    length: arr.length,
    arrRef: arr,
    entries: arr.map((w: WeeklyResctriction): WeeklyEntrySnapshot => {
      return {
        startMs: w.startTime.getTime(),
        endMs: w.endTime.getTime(),
        startDay: w.startDay,
        endDay: w.endDay,
        startRef: w.startTime,
        endRef: w.endTime,
        ref: w,
      };
    }),
  };
}

function assertWeeklyUnchanged(
  r: RestrictionTimes,
  snap: WeeklySnapshot,
): void {
  const now: WeeklySnapshot = snapshotWeekly(r);
  expect(now.length).toBe(snap.length);
  // the array instance itself must be unchanged.
  expect(now.arrRef).toBe(snap.arrRef);
  for (let i: number = 0; i < snap.entries.length; i++) {
    const a: WeeklyEntrySnapshot = snap.entries[i]!;
    const b: WeeklyEntrySnapshot = now.entries[i]!;
    expect(b.startMs).toBe(a.startMs);
    expect(b.endMs).toBe(a.endMs);
    expect(b.startDay).toBe(a.startDay);
    expect(b.endDay).toBe(a.endDay);
    // instance identity of both the entry object and its Date fields.
    expect(b.ref).toBe(a.ref);
    expect(b.startRef).toBe(a.startRef);
    expect(b.endRef).toBe(a.endRef);
  }
  expect(r.restictionType).toBe(RestrictionType.Weekly);
}

/*
 * ---------------------------------------------------------------------------
 * Shared fixtures.
 * ---------------------------------------------------------------------------
 */

const MON_JAN6: Date = OneUptimeDate.fromString("2025-01-06T00:00:00.000Z");
const NY: string = "America/New_York";
const KOLKATA: string = "Asia/Kolkata";

function addDays(base: Date, n: number): Date {
  return OneUptimeDate.addRemoveDays(base, n);
}
function addHours(base: Date, n: number): Date {
  return OneUptimeDate.addRemoveHours(base, n);
}

interface Window {
  name: string;
  start: Date;
  end: Date;
}

/*
 * A spread of windows on DIFFERENT calendar days / seasons so that any in-place
 * day-moving mutation would be exposed by a later window seeing a corrupted base.
 */
const WINDOWS: Window[] = [
  { name: "jan-10d", start: MON_JAN6, end: addDays(MON_JAN6, 10) },
  {
    name: "spring-10d",
    start: addDays(MON_JAN6, 90),
    end: addDays(MON_JAN6, 100),
  },
  {
    name: "summer-10d",
    start: addDays(MON_JAN6, 180),
    end: addDays(MON_JAN6, 190),
  },
  {
    name: "midday-start",
    start: addHours(addDays(MON_JAN6, 1), 14),
    end: addDays(MON_JAN6, 6),
  },
  {
    name: "single-day",
    start: addDays(MON_JAN6, 3),
    end: addDays(MON_JAN6, 4),
  },
];

interface IntervalSpec {
  name: string;
  type: EventInterval;
  count: number;
}

interface DailySpec {
  name: string;
  sh: number;
  sm: number;
  eh: number;
  em: number;
}
const DAILY_SPECS: DailySpec[] = [
  { name: "09:00-17:00", sh: 9, sm: 0, eh: 17, em: 0 },
  { name: "22:00-06:00(overnight)", sh: 22, sm: 0, eh: 6, em: 0 },
  { name: "00:00-01:00", sh: 0, sm: 0, eh: 1, em: 0 },
  { name: "08:30-17:45", sh: 8, sm: 30, eh: 17, em: 45 },
];

const TIMEZONES: (string | undefined)[] = [undefined, NY, KOLKATA];

/*
 * ---------------------------------------------------------------------------
 * (1) DAILY non-mutation across many windows.
 * ---------------------------------------------------------------------------
 */

describe("(1) Daily: getEvents never mutates the shared RestrictionTimes", () => {
  /*
   * day-x1 (same-day-period trim) and week-x1 (multi-day-period trim) cover both
   * shapes of the daily-restriction trim path; block (2) exercises day-x2.
   */
  const dailyHammerIntervals: IntervalSpec[] = [
    { name: "day-x1", type: EventInterval.Day, count: 1 },
    { name: "week-x1", type: EventInterval.Week, count: 1 },
  ];
  for (const spec of DAILY_SPECS) {
    for (const tz of TIMEZONES) {
      for (const iv of dailyHammerIntervals) {
        const label: string = `daily ${spec.name} tz=${tz ?? "local"} ${iv.name}`;
        it(`${label}: dayRestrictionTimes intact after hammering all windows`, () => {
          // Build ONE restriction and share it across every getEvents call.
          const restriction: RestrictionTimes = dailyRestriction(
            spec.sh,
            spec.sm,
            spec.eh,
            spec.em,
          );
          const snap: DailySnapshot = snapshotDaily(restriction);

          for (const w of WINDOWS) {
            const layer: LayerProps = buildLayer({
              users: ["A", "B", "C"],
              intervalType: iv.type,
              intervalCount: iv.count,
              restriction,
              timezone: tz,
              start: MON_JAN6,
            });

            // full expansion.
            expand(layer, w.start, w.end);
            // live "who is on call now/next" windowed resolution.
            expand(layer, w.start, addDays(w.start, 20), new LayerUtil(), {
              getNumberOfEvents: 1,
            });
            // assert intact after EACH window (localizes any leak).
            assertDailyUnchanged(restriction, snap);
          }

          // final belt-and-braces check.
          assertDailyUnchanged(restriction, snap);
        });
      }
    }
  }

  it("reusing ONE LayerUtil instance across many daily-window calls leaves the restriction intact", () => {
    const restriction: RestrictionTimes = dailyRestriction(9, 0, 17, 0);
    const snap: DailySnapshot = snapshotDaily(restriction);
    const util: LayerUtil = new LayerUtil();
    const layer: LayerProps = buildLayer({
      users: ["A", "B"],
      intervalType: EventInterval.Day,
      intervalCount: 1,
      restriction,
      timezone: NY,
      start: MON_JAN6,
    });
    for (const w of WINDOWS) {
      expand(layer, w.start, w.end, util);
      assertDailyUnchanged(restriction, snap);
    }
  });
});

/*
 * ---------------------------------------------------------------------------
 * (2) DAILY independence: idempotency + agreement with a pristine clone.
 * ---------------------------------------------------------------------------
 */

describe("(2) Daily: shared instance across calls is idempotent and correct", () => {
  const idempotencySpecs: DailySpec[] = [
    { name: "09:00-17:00", sh: 9, sm: 0, eh: 17, em: 0 },
    { name: "22:00-06:00(overnight)", sh: 22, sm: 0, eh: 6, em: 0 },
  ];
  const idempotencyIntervals: IntervalSpec[] = [
    { name: "day-x1", type: EventInterval.Day, count: 1 },
    { name: "day-x2", type: EventInterval.Day, count: 2 },
  ];

  const windowA: Window = {
    name: "A",
    start: MON_JAN6,
    end: addDays(MON_JAN6, 12),
  };
  const windowB: Window = {
    name: "B",
    start: addDays(MON_JAN6, 120),
    end: addDays(MON_JAN6, 160),
  };

  for (const spec of idempotencySpecs) {
    for (const tz of [undefined, NY]) {
      for (const iv of idempotencyIntervals) {
        const label: string = `daily ${spec.name} tz=${tz ?? "local"} ${iv.name}`;

        it(`${label}: window A -> B -> A reproduces A exactly (no cross-call corruption)`, () => {
          const restriction: RestrictionTimes = dailyRestriction(
            spec.sh,
            spec.sm,
            spec.eh,
            spec.em,
          );
          const layer: LayerProps = buildLayer({
            users: ["A", "B", "C"],
            intervalType: iv.type,
            intervalCount: iv.count,
            restriction,
            timezone: tz,
            start: MON_JAN6,
          });

          const a1: string = eventKey(
            expand(layer, windowA.start, windowA.end),
          );
          const b1: string = eventKey(
            expand(layer, windowB.start, windowB.end),
          );
          const a2: string = eventKey(
            expand(layer, windowA.start, windowA.end),
          );
          const b2: string = eventKey(
            expand(layer, windowB.start, windowB.end),
          );

          // A is unaffected by the intervening B call, and vice-versa.
          expect(a2).toBe(a1);
          expect(b2).toBe(b1);
          // A and B are genuinely different windows (sanity: the fixture bites).
          expect(a1).not.toBe(b1);
        });

        it(`${label}: shared instance agrees with a pristine independent clone`, () => {
          const restriction: RestrictionTimes = dailyRestriction(
            spec.sh,
            spec.sm,
            spec.eh,
            spec.em,
          );
          const layer: LayerProps = buildLayer({
            users: ["A", "B", "C"],
            intervalType: iv.type,
            intervalCount: iv.count,
            restriction,
            timezone: tz,
            start: MON_JAN6,
          });

          // Hammer the shared instance with an unrelated window first.
          expand(layer, windowB.start, windowB.end);
          const shared: string = eventKey(
            expand(layer, windowA.start, windowA.end),
          );

          // A clone with identical values that was NEVER passed through getEvents.
          const cloneLayer: LayerProps = buildLayer({
            users: ["A", "B", "C"],
            intervalType: iv.type,
            intervalCount: iv.count,
            restriction: cloneRestriction(restriction),
            timezone: tz,
            start: MON_JAN6,
          });
          const pristine: string = eventKey(
            expand(cloneLayer, windowA.start, windowA.end),
          );

          expect(shared).toBe(pristine);
        });

        it(`${label}: same result whether expanded on a fresh or a reused LayerUtil`, () => {
          const restriction: RestrictionTimes = dailyRestriction(
            spec.sh,
            spec.sm,
            spec.eh,
            spec.em,
          );
          const layer: LayerProps = buildLayer({
            users: ["A", "B", "C"],
            intervalType: iv.type,
            intervalCount: iv.count,
            restriction,
            timezone: tz,
            start: MON_JAN6,
          });

          const freshUtil: string = eventKey(
            expand(layer, windowA.start, windowA.end, new LayerUtil()),
          );

          const reused: LayerUtil = new LayerUtil();
          // prime the instance with a different window/mode first.
          expand(layer, windowB.start, windowB.end, reused, {
            getNumberOfEvents: 1,
          });
          const reusedUtil: string = eventKey(
            expand(layer, windowA.start, windowA.end, reused),
          );

          expect(reusedUtil).toBe(freshUtil);
        });
      }
    }
  }
});

/*
 * ---------------------------------------------------------------------------
 * (3) WEEKLY non-mutation + independence.
 * ---------------------------------------------------------------------------
 */

interface WeeklyConfig {
  name: string;
  entries: WeeklyEntrySpec[];
}

// Concrete anchors in Jan 2025 (UTC): Fri=Jan3/Jan10, Mon=Jan6, Wed=Jan8.
const WEEKLY_CONFIGS: WeeklyConfig[] = [
  {
    name: "mon-fri-working-hours(non-wrap)",
    entries: [
      {
        startDay: DayOfWeek.Monday,
        endDay: DayOfWeek.Friday,
        startTimeIso: "2025-01-06T09:00:00.000Z",
        endTimeIso: "2025-01-10T17:00:00.000Z",
      },
    ],
  },
  {
    name: "weekend-wrap(fri-20-to-mon-08)",
    entries: [
      {
        startDay: DayOfWeek.Friday,
        endDay: DayOfWeek.Monday,
        startTimeIso: "2025-01-03T20:00:00.000Z",
        endTimeIso: "2025-01-06T08:00:00.000Z",
      },
    ],
  },
  {
    name: "two-entry(mon-wed + thu-fri)",
    entries: [
      {
        startDay: DayOfWeek.Monday,
        endDay: DayOfWeek.Wednesday,
        startTimeIso: "2025-01-06T08:00:00.000Z",
        endTimeIso: "2025-01-08T18:00:00.000Z",
      },
      {
        startDay: DayOfWeek.Thursday,
        endDay: DayOfWeek.Friday,
        startTimeIso: "2025-01-09T08:00:00.000Z",
        endTimeIso: "2025-01-10T18:00:00.000Z",
      },
    ],
  },
];

describe("(3) Weekly: getEvents never mutates the shared RestrictionTimes", () => {
  for (const cfg of WEEKLY_CONFIGS) {
    for (const tz of [undefined, NY]) {
      const label: string = `weekly ${cfg.name} tz=${tz ?? "local"}`;
      it(`${label}: weeklyRestrictionTimes intact after hammering all windows`, () => {
        const restriction: RestrictionTimes = weeklyRestriction(cfg.entries);
        const snap: WeeklySnapshot = snapshotWeekly(restriction);

        /*
         * Day and Week rotations exercise both the daily-tiling and weekly-span
         * trim paths; that is enough to expose any weekly-restriction mutation.
         */
        const weeklyIntervals: IntervalSpec[] = [
          { name: "day-x1", type: EventInterval.Day, count: 1 },
          { name: "week-x1", type: EventInterval.Week, count: 1 },
        ];
        for (const iv of weeklyIntervals) {
          const layer: LayerProps = buildLayer({
            users: ["A", "B"],
            intervalType: iv.type,
            intervalCount: iv.count,
            restriction,
            timezone: tz,
            start: MON_JAN6,
          });
          for (const w of WINDOWS) {
            expand(layer, w.start, w.end);
            expand(layer, w.start, addDays(w.start, 20), new LayerUtil(), {
              getNumberOfEvents: 1,
            });
            assertWeeklyUnchanged(restriction, snap);
          }
        }

        assertWeeklyUnchanged(restriction, snap);
      });
    }
  }
});

describe("(3) Weekly: shared instance across calls is idempotent and correct", () => {
  const windowA: Window = {
    name: "A",
    start: MON_JAN6,
    end: addDays(MON_JAN6, 21),
  };
  const windowB: Window = {
    name: "B",
    start: addDays(MON_JAN6, 140),
    end: addDays(MON_JAN6, 175),
  };

  for (const cfg of WEEKLY_CONFIGS) {
    for (const tz of [undefined, NY]) {
      const label: string = `weekly ${cfg.name} tz=${tz ?? "local"}`;

      it(`${label}: window A -> B -> A reproduces A exactly`, () => {
        const restriction: RestrictionTimes = weeklyRestriction(cfg.entries);
        const layer: LayerProps = buildLayer({
          users: ["A", "B", "C"],
          intervalType: EventInterval.Week,
          intervalCount: 1,
          restriction,
          timezone: tz,
          start: MON_JAN6,
        });

        const a1: string = eventKey(expand(layer, windowA.start, windowA.end));
        expand(layer, windowB.start, windowB.end);
        const a2: string = eventKey(expand(layer, windowA.start, windowA.end));
        expect(a2).toBe(a1);
      });

      it(`${label}: shared instance agrees with a pristine independent clone`, () => {
        const restriction: RestrictionTimes = weeklyRestriction(cfg.entries);
        const layer: LayerProps = buildLayer({
          users: ["A", "B", "C"],
          intervalType: EventInterval.Day,
          intervalCount: 1,
          restriction,
          timezone: tz,
          start: MON_JAN6,
        });

        expand(layer, windowB.start, windowB.end);
        const shared: string = eventKey(
          expand(layer, windowA.start, windowA.end),
        );

        const cloneLayer: LayerProps = buildLayer({
          users: ["A", "B", "C"],
          intervalType: EventInterval.Day,
          intervalCount: 1,
          restriction: cloneRestriction(restriction),
          timezone: tz,
          start: MON_JAN6,
        });
        const pristine: string = eventKey(
          expand(cloneLayer, windowA.start, windowA.end),
        );

        expect(shared).toBe(pristine);
      });
    }
  }
});

/*
 * ---------------------------------------------------------------------------
 * (4) LAYER INDEPENDENCE: unrestricted vs restricted, sharing nothing.
 * ---------------------------------------------------------------------------
 */

describe("(4) Independence: unrestricted and restricted layers resolve independently", () => {
  const window: Window = {
    name: "indep",
    start: MON_JAN6,
    end: addDays(MON_JAN6, 14),
  };

  it("interleaving restricted (tz) and unrestricted (no tz) calls on ONE LayerUtil never leaks", () => {
    const unrestricted: RestrictionTimes = noRestriction();
    const restricted: RestrictionTimes = dailyRestriction(9, 0, 17, 0);
    const restrictedSnap: DailySnapshot = snapshotDaily(restricted);

    const uLayer: LayerProps = buildLayer({
      users: ["U1", "U2"],
      intervalType: EventInterval.Day,
      intervalCount: 1,
      restriction: unrestricted,
      timezone: undefined,
      start: MON_JAN6,
    });
    const rLayer: LayerProps = buildLayer({
      users: ["R1", "R2"],
      intervalType: EventInterval.Day,
      intervalCount: 1,
      restriction: restricted,
      timezone: NY,
      start: MON_JAN6,
    });

    const util: LayerUtil = new LayerUtil();

    // Baselines on fresh utils.
    const uBaseline: string = eventKey(
      expand(uLayer, window.start, window.end, new LayerUtil()),
    );
    const rBaseline: string = eventKey(
      expand(rLayer, window.start, window.end, new LayerUtil()),
    );

    // Interleave on the SHARED util: R(tz) then U(no-tz) then R then U ...
    const uAfterR: string = ((): string => {
      expand(rLayer, window.start, window.end, util); // sets util.timezone = NY
      return eventKey(expand(uLayer, window.start, window.end, util)); // must reset to undefined
    })();
    const rAfterU: string = ((): string => {
      expand(uLayer, window.start, window.end, util); // sets util.timezone = undefined
      return eventKey(expand(rLayer, window.start, window.end, util)); // must reset to NY
    })();

    // No cross-call timezone leak: each layer matches its own fresh-util baseline.
    expect(uAfterR).toBe(uBaseline);
    expect(rAfterU).toBe(rBaseline);

    // The two layers are genuinely different rosters.
    expect(uBaseline).not.toBe(rBaseline);

    // The unrestricted restriction is still None with null day times.
    expect(unrestricted.restictionType).toBe(RestrictionType.None);
    expect(unrestricted.dayRestrictionTimes).toBeNull();

    // The restricted restriction is byte-for-byte intact.
    assertDailyUnchanged(restricted, restrictedSnap);
  });

  it("getMultiLayerEvents([restricted, unrestricted]) is idempotent and mutates neither restriction", () => {
    const restricted: RestrictionTimes = dailyRestriction(9, 0, 17, 0);
    const unrestricted: RestrictionTimes = noRestriction();
    const restrictedSnap: DailySnapshot = snapshotDaily(restricted);

    const rLayer: LayerProps = buildLayer({
      users: ["R1", "R2"],
      intervalType: EventInterval.Day,
      intervalCount: 1,
      restriction: restricted,
      timezone: undefined,
      start: MON_JAN6,
    });
    const uLayer: LayerProps = buildLayer({
      users: ["U1", "U2"],
      intervalType: EventInterval.Week,
      intervalCount: 1,
      restriction: unrestricted,
      timezone: undefined,
      start: MON_JAN6,
    });

    const util: LayerUtil = new LayerUtil();
    const merged1: Array<CalendarEvent> = util.getMultiLayerEvents({
      layers: [rLayer, uLayer],
      calendarStartDate: window.start,
      calendarEndDate: window.end,
    });
    const merged2: Array<CalendarEvent> = util.getMultiLayerEvents({
      layers: [rLayer, uLayer],
      calendarStartDate: window.start,
      calendarEndDate: window.end,
    });

    // Merged output is stable across calls (no corruption of either restriction).
    expect(eventKey(merged2)).toBe(eventKey(merged1));
    // The higher-priority restricted layer produced at least some coverage.
    expect(merged1.length).toBeGreaterThan(0);

    // Neither restriction object was touched.
    assertDailyUnchanged(restricted, restrictedSnap);
    expect(unrestricted.restictionType).toBe(RestrictionType.None);
    expect(unrestricted.dayRestrictionTimes).toBeNull();
    expect(unrestricted.weeklyRestrictionTimes).toEqual([]);
  });

  it("resolving a restricted layer does not perturb an unrelated unrestricted layer's roster", () => {
    const restricted: RestrictionTimes = dailyRestriction(22, 0, 6, 0);
    const unrestricted: RestrictionTimes = noRestriction();

    const uLayer: LayerProps = buildLayer({
      users: ["U1", "U2", "U3"],
      intervalType: EventInterval.Day,
      intervalCount: 1,
      restriction: unrestricted,
      timezone: undefined,
      start: MON_JAN6,
    });
    const rLayer: LayerProps = buildLayer({
      users: ["R1", "R2", "R3"],
      intervalType: EventInterval.Hour,
      intervalCount: 6,
      restriction: restricted,
      timezone: KOLKATA,
      start: MON_JAN6,
    });

    const uBefore: string = eventKey(expand(uLayer, window.start, window.end));
    // Do a bunch of restricted resolutions in between.
    for (const w of WINDOWS.slice(0, 3)) {
      expand(rLayer, w.start, w.end);
      expand(rLayer, w.start, addDays(w.start, 12), new LayerUtil(), {
        getNumberOfEvents: 1,
      });
    }
    const uAfter: string = eventKey(expand(uLayer, window.start, window.end));

    expect(uAfter).toBe(uBefore);
    // unrestricted 24/7 rotation must have full coverage (non-empty).
    expect(uAfter.length).toBeGreaterThan(0);
  });
});
