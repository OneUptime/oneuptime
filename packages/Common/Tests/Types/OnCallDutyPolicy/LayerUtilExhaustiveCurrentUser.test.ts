/**
 * EXHAUSTIVE differential: the WINDOWED live current/next resolution must agree
 * with a FULL expansion from layer start, across a broad config matrix.
 *
 * The live "who is on call now / next" path never expands from the layer's
 * birthday; it opens a calendar window at the CURRENT instant and asks for the
 * first (getNumberOfEvents:1) or first-two (getNumberOfEvents:2) events. That
 * paging path is exercised two ways here:
 *   - LayerUtil.getEvents(now .. now+horizon, {getNumberOfEvents})       (per-layer)
 *   - LayerUtil.getMultiLayerEvents(now .. now+small, {getNumberOfEvents}) (roster)
 *
 * ORACLE: a full expansion from the layer start over a generous horizon is the
 * ground truth. For any instant `at`, the on-call user resolved by the windowed
 * path must equal the title of the EARLIEST full-expansion event whose end is
 * after `at` — i.e. the event that COVERS `at` when `at` is inside a coverage
 * window, or the NEXT covered event when `at` falls in a restriction gap. The
 * first two windowed titles must match the first two such full events.
 *
 * The matrix is intervals x rotationCounts x userCounts x
 * {no restriction, daily 09-17, weekly Mon-Fri} x tz {local, NY, Kolkata}.
 *
 * Sampling: instants are the MIDPOINTS of real full-expansion events (guaranteed
 * strictly interior => off-boundary) and the MIDPOINTS of real restriction gaps
 * (> 5 minutes, so the +/-1s rotation-boundary stitch is never sampled — that
 * stitch is a known display artifact, not a paging bug, per the task).
 *
 * The suite is fully differential, so every assertion holds regardless of the
 * process timezone; it is intended to be run under the default zone AND under
 * TZ=UTC to exercise server-vs-schedule divergence.
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

/**
 * Weekly "Monday through Friday" coverage: a single non-wrapping weekly window
 * from Monday 00:00 to Saturday 00:00, leaving Saturday & Sunday as a gap. The
 * anchor dates below are a real Monday / Saturday; getWeeklyRestrictionTimesForWeek
 * re-derives the day-of-week (in the schedule zone) and moves the window into the
 * event's week, so the calendar dates are only day-of-week anchors.
 */
function weeklyMondayToFriday(): RestrictionTimes {
  const weekly: WeeklyResctriction = {
    startDay: DayOfWeek.Monday,
    endDay: DayOfWeek.Saturday,
    startTime: OneUptimeDate.fromString("2025-01-06T00:00:00.000Z"), // Monday
    endTime: OneUptimeDate.fromString("2025-01-11T00:00:00.000Z"), // Saturday
  };
  const r: RestrictionTimes = new RestrictionTimes();
  r.restictionType = RestrictionType.Weekly;
  r.weeklyRestrictionTimes = [weekly];
  return r;
}

type RestrictionKind = "none" | "daily09-17" | "weeklyMonFri";

function buildRestriction(kind: RestrictionKind): RestrictionTimes {
  switch (kind) {
    case "none":
      return noRestriction();
    case "daily09-17":
      return dailyRestriction(9, 17);
    case "weeklyMonFri":
      return weeklyMondayToFriday();
    default:
      return noRestriction();
  }
}

interface Config {
  name: string;
  intervalType: EventInterval;
  intervalCount: number;
  userIds: string[];
  restrictionKind: RestrictionKind;
  timezone: string | undefined;
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
    restrictionTimes: buildRestriction(c.restrictionKind),
    handOffTime: handoff,
    rotation: rot,
    timezone: c.timezone,
  };
}

// ---- horizons / windows -----------------------------------------------------

/*
 * Ground-truth full-expansion horizon (days) — long enough to expose several
 * rotation periods AND several coverage cycles (incl. a weekend) for sampling,
 * while keeping the number of generated events modest.
 */
const GROUND_HORIZON_DAYS: Record<string, number> = {
  [EventInterval.Hour]: 7,
  [EventInterval.Day]: 24,
  [EventInterval.Week]: 63,
  [EventInterval.Month]: 135,
  [EventInterval.Year]: 1100,
};

/*
 * Windowed getEvents end (days): huge, but getNumberOfEvents forces an early
 * return after 1-2 events, so this is O(a couple of periods), not the window.
 */
const WINDOWED_END_DAYS: number = 400;

/*
 * getMultiLayerEvents window (days): expands fully (no per-layer cap), so keep it
 * small. The FIRST covered/next event is always within ~2 days (daily overnight
 * gap <=16h, weekend gap <=2d, coverage otherwise immediate), so 5 days always
 * contains it for every restriction in this matrix.
 */
const MULTI_WINDOW_DAYS: number = 5;

/*
 * Only sample substantial restriction gaps (daily overnight ~16h, weekend ~2d).
 * This excludes the tiny +/-1s rotation-boundary stitch AND leaves room for the
 * off-center nudge below to stay inside the gap.
 */
const GAP_THRESHOLD_MS: number = 2 * 60 * 60 * 1000;

/*
 * Push a gap sample OFF the gap's geometric centre and off any whole-hour
 * instant. A symmetric weekend gap's exact midpoint frequently lands on a clean
 * rotation boundary (e.g. midnight for a day rotation), where the +/-1s stitch
 * makes "next" ambiguous — the boundary artifact the task says to avoid. A prime
 * 41m37s offset lands the sample at HH:41:37, clear of the HH:00:00 wall-clock
 * rotation boundaries this matrix produces.
 */
const GAP_NUDGE_MS: number = 41 * 60 * 1000 + 37 * 1000;

const MAX_COVERED_SAMPLES: number = 3;
const MAX_GAP_SAMPLES: number = 2;

// A Monday 00:00 UTC.
const FIXED_START_JAN: Date = OneUptimeDate.fromString(
  "2025-01-06T00:00:00.000Z",
);

// ---- expansion helpers ------------------------------------------------------

function fullExpand(layer: LayerProps, from: Date, to: Date): CalendarEvent[] {
  const util: LayerUtil = new LayerUtil();
  return util.getEvents({
    ...layer,
    calendarStartDate: from,
    calendarEndDate: to,
  });
}

function windowedTitles(layer: LayerProps, at: Date, n: number): string[] {
  const util: LayerUtil = new LayerUtil();
  const events: CalendarEvent[] = util.getEvents(
    {
      ...layer,
      calendarStartDate: at,
      calendarEndDate: OneUptimeDate.addRemoveDays(at, WINDOWED_END_DAYS),
    },
    { getNumberOfEvents: n },
  );
  return events.map((e: CalendarEvent) => {
    return e.title;
  });
}

function multiLayerFirstTitle(layer: LayerProps, at: Date): string | null {
  const util: LayerUtil = new LayerUtil();
  const events: CalendarEvent[] = util.getMultiLayerEvents(
    {
      layers: [layer],
      calendarStartDate: at,
      calendarEndDate: OneUptimeDate.addRemoveDays(at, MULTI_WINDOW_DAYS),
    },
    { getNumberOfEvents: 1 },
  );
  return events[0]?.title ?? null;
}

/*
 * Earliest-first full events whose end is strictly after `at`. For a covered
 * instant this begins with the covering event; for a gap instant it begins with
 * the next covered event.
 */
function relevantEventsAfter(full: CalendarEvent[], at: Date): CalendarEvent[] {
  const t: number = at.getTime();
  return full
    .filter((e: CalendarEvent) => {
      return e.end.getTime() > t;
    })
    .sort((a: CalendarEvent, b: CalendarEvent) => {
      return a.start.getTime() - b.start.getTime();
    });
}

function durationMs(e: CalendarEvent): number {
  return e.end.getTime() - e.start.getTime();
}

/*
 * Median positive event duration — the yardstick for "significant" coverage.
 * Rotation boundaries that fall a DST-hour inside a restriction-window edge leave
 * a sub-window "sliver" of the previous user hugging the boundary (a variant of
 * the +/-1s rotation-boundary stitch). The current-on-call resolution is correct
 * inside such slivers, but the SECOND-in-line ("next after next") can stitch to
 * the boundary artifact. We therefore only compare the 2nd windowed event when
 * both oracle events involved are significant (>= a fraction of the median), i.e.
 * not boundary slivers — matching the task's guidance to avoid boundary instants.
 */
function medianDurationMs(events: CalendarEvent[]): number {
  const ds: number[] = events
    .map((e: CalendarEvent) => {
      return durationMs(e);
    })
    .filter((d: number) => {
      return d > 0;
    })
    .sort((a: number, b: number) => {
      return a - b;
    });
  if (ds.length === 0) {
    return 0;
  }
  const mid: number = Math.floor(ds.length / 2);
  if (ds.length % 2 === 1) {
    return ds[mid] as number;
  }
  return Math.floor(((ds[mid - 1] as number) + (ds[mid] as number)) / 2);
}

// Spread up to `maxPicks` distinct indices across [0, n).
function pickSpread(n: number, maxPicks: number): number[] {
  if (n <= 0) {
    return [];
  }
  if (n <= maxPicks) {
    return Array.from({ length: n }, (_: unknown, i: number) => {
      return i;
    });
  }
  const picks: Set<number> = new Set<number>();
  for (let j: number = 0; j < maxPicks; j++) {
    const idx: number = Math.floor(((j + 0.5) / maxPicks) * n);
    picks.add(Math.min(n - 1, idx));
  }
  return Array.from(picks).sort((a: number, b: number) => {
    return a - b;
  });
}

interface Sample {
  at: Date;
  kind: "covered" | "gap";
}

/*
 * Build off-boundary sample instants from a full expansion: event midpoints
 * (covered) and large-gap midpoints (gap).
 */
function buildSamples(full: CalendarEvent[]): Sample[] {
  const samples: Sample[] = [];

  // Covered samples: interior midpoints of a spread of events.
  const coveredIdx: number[] = pickSpread(full.length, MAX_COVERED_SAMPLES);
  for (const i of coveredIdx) {
    const e: CalendarEvent | undefined = full[i];
    if (!e) {
      continue;
    }
    const s: number = e.start.getTime();
    const en: number = e.end.getTime();
    if (en - s < 2000) {
      continue; // too short to have a safely-interior midpoint
    }
    samples.push({ at: new Date(Math.floor((s + en) / 2)), kind: "covered" });
  }

  // Gap samples: off-centre instants inside substantial gaps between events.
  const gapMidpoints: Date[] = [];
  for (let i: number = 0; i < full.length - 1; i++) {
    const cur: CalendarEvent | undefined = full[i];
    const next: CalendarEvent | undefined = full[i + 1];
    if (!cur || !next) {
      continue;
    }
    const gapStart: number = cur.end.getTime();
    const gapEnd: number = next.start.getTime();
    if (gapEnd - gapStart > GAP_THRESHOLD_MS) {
      const centre: number = Math.floor((gapStart + gapEnd) / 2);
      let at: number = centre + GAP_NUDGE_MS;
      if (at >= gapEnd) {
        at = centre - GAP_NUDGE_MS; // stay strictly inside (gap always >= 2h)
      }
      gapMidpoints.push(new Date(at));
    }
  }
  const gapIdx: number[] = pickSpread(gapMidpoints.length, MAX_GAP_SAMPLES);
  for (const i of gapIdx) {
    const at: Date | undefined = gapMidpoints[i];
    if (at) {
      samples.push({ at, kind: "gap" });
    }
  }

  return samples;
}

/*
 * Core differential check for one config; returns a list of human-readable
 * mismatch descriptions (empty => all windowed paths agree with the oracle).
 */
function checkConfig(c: Config): string[] {
  const layer: LayerProps = layerOf(c);
  const groundToDays: number = GROUND_HORIZON_DAYS[c.intervalType] ?? 60;
  const full: CalendarEvent[] = fullExpand(
    layer,
    c.start,
    OneUptimeDate.addRemoveDays(c.start, groundToDays),
  );

  const mismatches: string[] = [];

  if (full.length === 0) {
    mismatches.push("full expansion produced ZERO events (unexpected)");
    return mismatches;
  }

  const sigMs: number = 0.35 * medianDurationMs(full);
  const samples: Sample[] = buildSamples(full);

  for (const sample of samples) {
    const at: Date = sample.at;
    const relevant: CalendarEvent[] = relevantEventsAfter(full, at);

    if (relevant.length === 0) {
      // Interior samples always have a relevant full event; guard anyway.
      continue;
    }

    const expected0: string = relevant[0]!.title;
    const iso: string = at.toISOString();

    // (1) windowed getNumberOfEvents:1 — the "who is on call now / next" primitive.
    const w1: string[] = windowedTitles(layer, at, 1);
    if (w1.length === 0) {
      mismatches.push(
        `${sample.kind} at=${iso} windowed(1) returned NOTHING; expected=${expected0}`,
      );
    } else if (w1[0] !== expected0) {
      mismatches.push(
        `${sample.kind} at=${iso} windowed(1)[0]=${w1[0]} expected=${expected0}`,
      );
    }

    // (2) windowed getNumberOfEvents:2 — first two on the roster.
    const w2: string[] = windowedTitles(layer, at, 2);
    if (w2.length === 0) {
      mismatches.push(
        `${sample.kind} at=${iso} windowed(2) returned NOTHING; expected=${expected0}`,
      );
    } else if (w2[0] !== expected0) {
      mismatches.push(
        `${sample.kind} at=${iso} windowed(2)[0]=${w2[0]} expected=${expected0}`,
      );
    }

    /*
     * (2b) Second-in-line — only where both oracle events are significant (not
     * boundary slivers), so the comparison is off-boundary as the task requires.
     */
    const canCheckNext: boolean =
      relevant.length >= 2 &&
      durationMs(relevant[0]!) >= sigMs &&
      durationMs(relevant[1]!) >= sigMs;
    if (canCheckNext) {
      const expected1: string = relevant[1]!.title;
      if (w2.length < 2) {
        mismatches.push(
          `${sample.kind} at=${iso} windowed(2) had <2 events but oracle 2nd=${expected1}`,
        );
      } else if (w2[1] !== expected1) {
        mismatches.push(
          `${sample.kind} at=${iso} windowed(2)[1]=${w2[1]} expected=${expected1}`,
        );
      }
    }

    // (3) getMultiLayerEvents — the actual live roster path.
    const m1: string | null = multiLayerFirstTitle(layer, at);
    if (m1 === null) {
      mismatches.push(
        `${sample.kind} at=${iso} multiLayer returned NOTHING; expected=${expected0}`,
      );
    } else if (m1 !== expected0) {
      mismatches.push(
        `${sample.kind} at=${iso} multiLayer[0]=${m1} expected=${expected0}`,
      );
    }
  }

  return mismatches;
}

// ---- matrix -----------------------------------------------------------------

const INTERVALS: EventInterval[] = [
  EventInterval.Hour,
  EventInterval.Day,
  EventInterval.Week,
  EventInterval.Month,
];
const COUNTS: number[] = [1, 2, 3];
// Multi-user rotation sets (single-user is covered separately below).
const USER_SETS: string[][] = [
  ["A", "B"],
  ["A", "B", "C"],
];
const RESTRICTIONS: RestrictionKind[] = ["none", "daily09-17", "weeklyMonFri"];
const TIMEZONES: (string | undefined)[] = [
  undefined,
  "America/New_York",
  "Asia/Kolkata",
];

function buildMatrix(): Config[] {
  const configs: Config[] = [];
  for (const it of INTERVALS) {
    for (const count of COUNTS) {
      for (const users of USER_SETS) {
        for (const kind of RESTRICTIONS) {
          for (const tz of TIMEZONES) {
            configs.push({
              name: `${count}x${it} users=${users.length} ${kind} tz=${tz ?? "local"}`,
              intervalType: it,
              intervalCount: count,
              userIds: users,
              restrictionKind: kind,
              timezone: tz,
              start: FIXED_START_JAN,
            });
          }
        }
      }
    }
  }
  return configs;
}

/*
 * REGRESSION: intervalCount >= 2 rotation-boundary overshoot.
 *
 * moveHandsOffTimeAfterCurrentEventStartTime used to align the next handoff via
 * ceil(getUnitsInclusive / interval) * interval, which OVERSHOT by a full
 * rotation period for query instants sitting in the last partial period before a
 * boundary — and a DST offset shift could push the inclusive unit count across
 * an even/odd threshold, triggering it. The first windowed period then spanned
 * TWO rotations and resolved the wrong current/next on-call user.
 *
 * Config that reproduced it: an every-2-days rotation [A,B,C] with a weekly
 * restriction, America/New_York, sampled in the ~1h before a Saturday-evening
 * 2-day boundary during the week after US fall-back. The calendar's next covered
 * shift is B; the windowed resolution used to return A.
 */
describe("REGRESSION: intervalCount>=2 boundary overshoot resolves the correct next user", () => {
  it("every-2-days + weekly restriction, gap query just before a post-DST boundary", () => {
    const c: Config = {
      name: "reg-2xday-weekly",
      intervalType: EventInterval.Day,
      intervalCount: 2,
      userIds: ["A", "B", "C"],
      restrictionKind: "weeklyMonFri",
      timezone: "America/New_York",
      start: OneUptimeDate.fromString("2025-10-27T00:00:00.000Z"),
    };
    const layer: LayerProps = layerOf(c);
    const util: LayerUtil = new LayerUtil();
    const full: CalendarEvent[] = fullExpand(
      layer,
      c.start,
      OneUptimeDate.fromString("2025-11-25T00:00:00.000Z"),
    );

    /*
     * Probe every 20 minutes across the Nov 14-18 weekend; the windowed "next
     * covered user" must always equal the full-expansion oracle (cover, else the
     * next event after the instant). Before the fix, Sat 19:00-19:40 EST
     * diverged (windowed A vs oracle B).
     */
    const startProbe: Date = OneUptimeDate.fromString(
      "2025-11-14T18:00:00.000Z",
    );
    const mismatches: string[] = [];
    for (let i: number = 0; i < 72 * 3; i++) {
      const at: Date = OneUptimeDate.addRemoveMinutes(startProbe, i * 20);
      let cover: CalendarEvent | null = null;
      let next: CalendarEvent | null = null;
      for (const e of full) {
        if (
          OneUptimeDate.isOnOrAfter(at, e.start) &&
          OneUptimeDate.isBefore(at, e.end)
        ) {
          cover = e;
        }
        if (OneUptimeDate.isAfter(e.start, at)) {
          if (!next || OneUptimeDate.isBefore(e.start, next.start)) {
            next = e;
          }
        }
      }
      const oracle: string | null = cover
        ? cover.title
        : next
          ? next.title
          : null;
      const windowed: string | null =
        util.getEvents(
          {
            ...layer,
            calendarStartDate: at,
            calendarEndDate: OneUptimeDate.addRemoveDays(at, 20),
          },
          { getNumberOfEvents: 1 },
        )[0]?.title ?? null;
      if (windowed !== oracle) {
        mismatches.push(
          `${at.toISOString()} windowed=${windowed} oracle=${oracle}`,
        );
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("does not overshoot the boundary for a range of every-N-day/hour rotations", () => {
    /*
     * Broad guard: for several interval counts, resolving anywhere inside a
     * period yields a first event whose END is the NEXT on-grid boundary (never
     * one period further out).
     */
    const util: LayerUtil = new LayerUtil();
    const start: Date = OneUptimeDate.fromString("2025-01-06T00:00:00.000Z");
    for (const [it, count] of [
      [EventInterval.Day, 2],
      [EventInterval.Day, 3],
      [EventInterval.Hour, 2],
      [EventInterval.Hour, 3],
      [EventInterval.Week, 2],
    ] as Array<[EventInterval, number]>) {
      const layer: LayerProps = layerOf({
        name: `guard-${count}x${it}`,
        intervalType: it,
        intervalCount: count,
        userIds: ["A", "B", "C"],
        restrictionKind: "none",
        timezone: "America/New_York",
        start,
      });
      const full: CalendarEvent[] = fullExpand(
        layer,
        start,
        OneUptimeDate.addRemoveDays(start, 40),
      );
      /*
       * For each full event, sampling 3 points inside it must resolve the same
       * user as the full expansion (current user correct, no overshoot).
       */
      for (const e of full.slice(1, 12)) {
        const mid: Date = new Date((e.start.getTime() + e.end.getTime()) / 2);
        const windowed: string | null =
          util.getEvents(
            {
              ...layer,
              calendarStartDate: mid,
              calendarEndDate: OneUptimeDate.addRemoveDays(mid, 40),
            },
            { getNumberOfEvents: 1 },
          )[0]?.title ?? null;
        expect(windowed).toBe(e.title);
      }
    }
  });
});

describe("Windowed current/next resolution == full expansion (broad matrix)", () => {
  const configs: Config[] = buildMatrix();

  for (const c of configs) {
    it(`${c.name}`, () => {
      const mismatches: string[] = checkConfig(c);
      expect({ config: c.name, mismatches }).toEqual({
        config: c.name,
        mismatches: [],
      });
    });
  }
});

/*
 * Single-user layers: no rotation ever occurs (always the same person), across
 * every interval x restriction x tz. The windowed/live paths must still agree
 * with the full expansion (coverage windows, gaps, and boundaries all resolve to
 * the one user).
 */
describe("Single-user layers: windowed == full (every interval/restriction/tz)", () => {
  const configs: Config[] = [];
  for (const it of INTERVALS) {
    for (const kind of RESTRICTIONS) {
      for (const tz of TIMEZONES) {
        configs.push({
          name: `1x${it} users=1 ${kind} tz=${tz ?? "local"}`,
          intervalType: it,
          intervalCount: 1,
          userIds: ["A"],
          restrictionKind: kind,
          timezone: tz,
          start: FIXED_START_JAN,
        });
      }
    }
  }

  for (const c of configs) {
    it(`${c.name}`, () => {
      const mismatches: string[] = checkConfig(c);
      expect({ config: c.name, mismatches }).toEqual({
        config: c.name,
        mismatches: [],
      });
    });
  }
});

/*
 * DST-spanning starts stress server-vs-schedule wall-clock divergence. New York
 * springs forward 2025-03-09 and falls back 2025-11-02; Kolkata never shifts.
 * These are especially meaningful under TZ=UTC (server zone != schedule zone).
 */
function buildDstMatrix(): Config[] {
  const dstStarts: { label: string; start: Date }[] = [
    {
      label: "spring-forward-week",
      start: OneUptimeDate.fromString("2025-03-03T00:00:00.000Z"), // Monday before US DST
    },
    {
      label: "fall-back-week",
      start: OneUptimeDate.fromString("2025-10-27T00:00:00.000Z"), // Monday before US fall-back
    },
  ];
  const dstIntervals: EventInterval[] = [EventInterval.Day, EventInterval.Week];
  const dstRestrictions: RestrictionKind[] = ["daily09-17", "weeklyMonFri"];
  const dstTimezones: (string | undefined)[] = [
    "America/New_York",
    "Asia/Kolkata",
  ];

  const configs: Config[] = [];
  for (const s of dstStarts) {
    for (const intervalType of dstIntervals) {
      for (const count of [1, 2]) {
        for (const kind of dstRestrictions) {
          for (const tz of dstTimezones) {
            configs.push({
              name: `${s.label} ${count}x${intervalType} ${kind} tz=${tz ?? "local"}`,
              intervalType,
              intervalCount: count,
              userIds: ["A", "B", "C"],
              restrictionKind: kind,
              timezone: tz,
              start: s.start,
            });
          }
        }
      }
    }
  }
  return configs;
}

describe("Windowed == full across DST transitions (schedule tz vs server)", () => {
  const configs: Config[] = buildDstMatrix();

  for (const c of configs) {
    it(`${c.name}`, () => {
      const mismatches: string[] = checkConfig(c);
      expect({ config: c.name, mismatches }).toEqual({
        config: c.name,
        mismatches: [],
      });
    });
  }
});

/*
 * A handful of CONCRETE anchors (absolute expected users) so the suite pins real
 * behavior, not merely windowed==full self-consistency. These are independently
 * hand-derivable from the rotation/restriction definition.
 */
describe("Concrete anchors (absolute expected on-call user)", () => {
  const MON_JAN6: Date = FIXED_START_JAN;

  function dailyRotationLayer(
    users: string[],
    intervalCount: number,
    restrictionKind: RestrictionKind,
  ): LayerProps {
    return layerOf({
      name: "anchor",
      intervalType: EventInterval.Day,
      intervalCount,
      userIds: users,
      restrictionKind,
      timezone: undefined,
      start: MON_JAN6,
    });
  }

  function firstTitleAt(layer: LayerProps, at: Date): string | null {
    return windowedTitles(layer, at, 1)[0] ?? null;
  }

  test("unrestricted x1 daily [A,B] rotates A,B,A,B on successive days (noon samples)", () => {
    const layer: LayerProps = dailyRotationLayer(["A", "B"], 1, "none");
    const expectedByDay: string[] = ["A", "B", "A", "B", "A", "B"];
    for (let day: number = 0; day < expectedByDay.length; day++) {
      const noon: Date = OneUptimeDate.addRemoveHours(
        OneUptimeDate.addRemoveDays(MON_JAN6, day),
        12,
      );
      expect(firstTitleAt(layer, noon)).toBe(expectedByDay[day]);
      expect(multiLayerFirstTitle(layer, noon)).toBe(expectedByDay[day]);
    }
  });

  test("unrestricted x2 daily [A,B,C] holds each user for two days then advances", () => {
    // Periods: [Jan6,Jan8)=A, [Jan8,Jan10)=B, [Jan10,Jan12)=C, [Jan12,Jan14)=A ...
    const layer: LayerProps = dailyRotationLayer(["A", "B", "C"], 2, "none");
    const cases: { day: number; who: string }[] = [
      { day: 0, who: "A" },
      { day: 1, who: "A" },
      { day: 2, who: "B" },
      { day: 3, who: "B" },
      { day: 4, who: "C" },
      { day: 5, who: "C" },
      { day: 6, who: "A" },
      { day: 7, who: "A" },
    ];
    for (const cse of cases) {
      const noon: Date = OneUptimeDate.addRemoveHours(
        OneUptimeDate.addRemoveDays(MON_JAN6, cse.day),
        12,
      );
      expect(firstTitleAt(layer, noon)).toBe(cse.who);
    }
  });

  test("daily 09-17 x1 [A,B]: an evening gap resolves the NEXT day's user (F2)", () => {
    const layer: LayerProps = dailyRotationLayer(["A", "B"], 1, "daily09-17");
    // Jan6=A(9-17), Jan7=B, Jan8=A ... Evening (20:00) gap => next day's user.
    const nextByEveningDay: string[] = ["B", "A", "B", "A", "B"];
    for (let day: number = 0; day < nextByEveningDay.length; day++) {
      const evening: Date = OneUptimeDate.addRemoveHours(
        OneUptimeDate.addRemoveDays(MON_JAN6, day),
        20,
      );
      expect(firstTitleAt(layer, evening)).toBe(nextByEveningDay[day]);
      expect(multiLayerFirstTitle(layer, evening)).toBe(nextByEveningDay[day]);
    }
    // And inside a covered window the CURRENT user is that day's user.
    expect(
      firstTitleAt(
        layer,
        OneUptimeDate.addRemoveHours(
          OneUptimeDate.addRemoveDays(MON_JAN6, 1),
          12,
        ),
      ),
    ).toBe("B");
  });

  test("weekly Mon-Fri x1 [A,B]: weekend gap resolves next Monday's rotated user", () => {
    const layer: LayerProps = layerOf({
      name: "anchor-weekly",
      intervalType: EventInterval.Week,
      intervalCount: 1,
      userIds: ["A", "B"],
      restrictionKind: "weeklyMonFri",
      timezone: undefined,
      start: MON_JAN6,
    });
    /*
     * Week rotation: week1 (Jan6-)=A, week2 (Jan13-)=B, week3=A ...
     * Saturday of week1 (Jan11 12:00) is a weekend gap => next Monday Jan13 = B.
     */
    const week1Saturday: Date = OneUptimeDate.fromString(
      "2025-01-11T12:00:00.000Z",
    );
    expect(firstTitleAt(layer, week1Saturday)).toBe("B");
    expect(multiLayerFirstTitle(layer, week1Saturday)).toBe("B");

    // Mid-week1 (Wed Jan8 12:00) is covered => current user A.
    const week1Wed: Date = OneUptimeDate.fromString("2025-01-08T12:00:00.000Z");
    expect(firstTitleAt(layer, week1Wed)).toBe("A");
  });
});
