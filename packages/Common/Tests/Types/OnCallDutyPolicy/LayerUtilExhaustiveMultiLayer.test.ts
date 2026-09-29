/**
 * EXHAUSTIVE multi-layer priority-merge coverage
 * (lens: getMultiLayerEvents + removeOverlappingEvents).
 *
 * The on-call roster stacks layers by priority: the LOWEST layer index wins
 * every instant it covers, and lower-priority layers fill only the instants no
 * higher-priority layer occupies. getMultiLayerEvents expands each layer with
 * getEvents, tags it with a 1-based priority (layer index 0 => priority 1 =
 * highest), then removeOverlappingEvents carves overlaps so the higher-priority
 * window always survives and the lower-priority coverage is split (its trailing
 * tail after a higher window preserved).
 *
 * This suite exhaustively cross-checks the merged output against an independent
 * per-layer PRIORITY ORACLE at a dense grid of instants, for 2/3/4-layer stacks
 * with mixed rotations/intervals/restrictions/start-offsets/timezones, and
 * asserts the three core invariants:
 *   (1) highest-priority layer wins each instant,
 *   (2) NO coverage the union of layers provides is dropped,
 *   (3) contiguous single coverage where a 24/7 fallback exists (no gap > 2s,
 *       no real overlaps / double paging).
 *
 * Boundary seams: the trimming uses +/-1s at carve points, so the merged output
 * and the oracle can legitimately disagree only within ~1-2s of a layer-event
 * boundary. Instant comparisons treat a disagreement as a real mismatch ONLY
 * when the sampled instant is farther than a small tolerance from every
 * layer/merged boundary; the whole-timeline gap scan independently bounds every
 * hole to <= 2s so no genuine coverage hole can hide between grid samples.
 *
 * All restriction windows are authored identically for the oracle and the merge
 * (both go through getEvents), so the equality checks are self-consistent under
 * ANY server process timezone — the file is run under the developer zone AND
 * under TZ=UTC to exercise server-vs-schedule divergence.
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

// Documented User mock pattern.
function user(id: string): User {
  return {
    id: {
      toString: (): string => {
        return id;
      },
    } as any,
  } as User;
}

function rotation(t: EventInterval, c: number): Recurring {
  return Recurring.fromJSON({
    _type: "Recurring",
    value: {
      intervalType: t,
      intervalCount: { _type: "PositiveNumber", value: c },
    },
  } as any);
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

/*
 * Weekly restriction authored from explicit boundary Dates so the weekday of
 * each window is unambiguous (the expansion reads the day-of-week off the
 * Date itself), letting us build a genuinely "weekday only" window.
 */
function weeklyRestrictionByDates(
  windows: Array<{ start: Date; end: Date }>,
): RestrictionTimes {
  const r: RestrictionTimes = new RestrictionTimes();
  r.restictionType = RestrictionType.Weekly;
  r.dayRestrictionTimes = null;
  r.weeklyRestrictionTimes = windows.map(
    (w: { start: Date; end: Date }): WeeklyResctriction => {
      return {
        startDay: OneUptimeDate.getDayOfWeek(w.start),
        endDay: OneUptimeDate.getDayOfWeek(w.end),
        startTime: w.start,
        endTime: w.end,
      };
    },
  );
  return r;
}

interface LayerSpec {
  users: string[];
  start: Date;
  restriction: RestrictionTimes;
  handOff: Date;
  rot: Recurring;
  timezone?: string | undefined;
}

function buildLayer(s: LayerSpec): LayerProps {
  return {
    users: s.users.map(user),
    startDateTimeOfLayer: s.start,
    restrictionTimes: s.restriction,
    handOffTime: s.handOff,
    rotation: s.rot,
    timezone: s.timezone,
  };
}

// Which user covers instant t in a single event list? half-open [start, end).
function coveringUser(events: Array<CalendarEvent>, t: Date): string | null {
  const tm: number = t.getTime();
  for (const e of events) {
    if (e.start.getTime() <= tm && e.end.getTime() > tm) {
      return e.title;
    }
  }
  return null;
}

/*
 * Oracle: expected on-call user at instant t across layers, resolved by priority
 * (lowest layer index that covers t wins). Uses each layer's own getEvents.
 */
function oracleUser(
  perLayerEvents: Array<Array<CalendarEvent>>,
  t: Date,
): string | null {
  for (const layerEvents of perLayerEvents) {
    const u: string | null = coveringUser(layerEvents, t);
    if (u !== null) {
      return u;
    }
  }
  return null;
}

// Real (positive-length) overlap between two merged events => double coverage.
function overlappingPairs(
  events: Array<CalendarEvent>,
): Array<[CalendarEvent, CalendarEvent]> {
  const pairs: Array<[CalendarEvent, CalendarEvent]> = [];
  for (let i: number = 0; i < events.length; i++) {
    for (let j: number = i + 1; j < events.length; j++) {
      const a: CalendarEvent = events[i]!;
      const b: CalendarEvent = events[j]!;
      const start: number = Math.max(a.start.getTime(), b.start.getTime());
      const end: number = Math.min(a.end.getTime(), b.end.getTime());
      if (end - start > 0) {
        pairs.push([a, b]);
      }
    }
  }
  return pairs;
}

// Sorted array of every start/end boundary across a set of event lists.
function collectBoundaries(lists: Array<Array<CalendarEvent>>): number[] {
  const set: Set<number> = new Set<number>();
  for (const list of lists) {
    for (const e of list) {
      set.add(e.start.getTime());
      set.add(e.end.getTime());
    }
  }
  return Array.from(set).sort((a: number, b: number) => {
    return a - b;
  });
}

function minDistanceToBoundary(sorted: number[], t: number): number {
  if (sorted.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  let lo: number = 0;
  let hi: number = sorted.length - 1;
  let best: number = Number.POSITIVE_INFINITY;
  while (lo <= hi) {
    const mid: number = (lo + hi) >> 1;
    const v: number = sorted[mid]!;
    best = Math.min(best, Math.abs(v - t));
    if (v < t) {
      lo = mid + 1;
    } else if (v > t) {
      hi = mid - 1;
    } else {
      return 0;
    }
  }
  return best;
}

// Largest uncovered stretch inside [from, to] treating merged events as a union.
function maxCoverageGapMs(
  merged: Array<CalendarEvent>,
  from: Date,
  to: Date,
): number {
  const sorted: Array<CalendarEvent> = [...merged].sort(
    (a: CalendarEvent, b: CalendarEvent) => {
      return a.start.getTime() - b.start.getTime();
    },
  );
  let cursor: number = from.getTime();
  let maxGap: number = 0;
  for (const e of sorted) {
    const s: number = e.start.getTime();
    const en: number = e.end.getTime();
    if (s > cursor) {
      maxGap = Math.max(maxGap, s - cursor);
    }
    if (en > cursor) {
      cursor = en;
    }
  }
  if (to.getTime() > cursor) {
    maxGap = Math.max(maxGap, to.getTime() - cursor);
  }
  return maxGap;
}

const util: LayerUtil = new LayerUtil();

function merge(
  layers: Array<LayerProps>,
  calStart: Date,
  calEnd: Date,
): Array<CalendarEvent> {
  return util.getMultiLayerEvents({
    layers: layers,
    calendarStartDate: calStart,
    calendarEndDate: calEnd,
  });
}

function expandPerLayer(
  layers: Array<LayerProps>,
  calStart: Date,
  calEnd: Date,
): Array<Array<CalendarEvent>> {
  return layers.map((layer: LayerProps): Array<CalendarEvent> => {
    return util.getEvents({
      ...layer,
      calendarStartDate: calStart,
      calendarEndDate: calEnd,
    });
  });
}

interface AnalyzeResult {
  merged: Array<CalendarEvent>;
  perLayer: Array<Array<CalendarEvent>>;
  mismatches: string[];
  overlaps: number;
  samples: number;
}

// Dense-instant priority-oracle cross check with boundary-seam tolerance.
function analyze(
  layers: Array<LayerProps>,
  calStart: Date,
  calEnd: Date,
  stepSeconds: number,
  seamToleranceMs: number = 2000,
): AnalyzeResult {
  const merged: Array<CalendarEvent> = merge(layers, calStart, calEnd);
  const perLayer: Array<Array<CalendarEvent>> = expandPerLayer(
    layers,
    calStart,
    calEnd,
  );
  const boundaries: number[] = collectBoundaries([merged, ...perLayer]);

  const mismatches: string[] = [];
  const stepMs: number = stepSeconds * 1000;
  const endMs: number = calEnd.getTime();
  let samples: number = 0;

  // Offset 17s off the window start so grid samples avoid clean boundaries.
  for (let ms: number = calStart.getTime() + 17000; ms < endMs; ms += stepMs) {
    samples++;
    const t: Date = new Date(ms);
    const expected: string | null = oracleUser(perLayer, t);
    const actual: string | null = coveringUser(merged, t);
    if (expected === actual) {
      continue;
    }
    /*
     * Disagreement is acceptable ONLY as a boundary seam (<= tolerance from a
     * real boundary). Anything else is a dropped-coverage / wrong-winner bug.
     */
    if (minDistanceToBoundary(boundaries, ms) <= seamToleranceMs) {
      continue;
    }
    mismatches.push(
      `${OneUptimeDate.toString(t)} expected=${expected} actual=${actual}`,
    );
  }

  return {
    merged: merged,
    perLayer: perLayer,
    mismatches: mismatches,
    overlaps: overlappingPairs(merged).length,
    samples: samples,
  };
}

/*
 * ---- Fixed reference dates (local-time constructor; interpreted in process
 * zone, so behavior is exercised under both the developer zone and TZ=UTC). ----
 */
const MON_JAN5: Date = new Date(2026, 0, 5, 0, 0, 0); // Monday Jan 5 2026

function d(
  year: number,
  monthIndex: number,
  day: number,
  hour: number = 0,
  minute: number = 0,
): Date {
  return new Date(year, monthIndex, day, hour, minute, 0);
}

interface Scenario {
  name: string;
  layers: Array<LayerProps>;
  calStart: Date;
  calEnd: Date;
  stepSeconds: number;
  fullCoverage: boolean; // union is 24/7 across [calStart, calEnd]
}

function scenarios(): Scenario[] {
  const list: Scenario[] = [];

  // S1: business-hours daily primary over 24/7 weekly fallback (2 weeks).
  list.push({
    name: "S1 2-layer: daily 09-17 primary (2 users) over 24/7 weekly fallback",
    layers: [
      buildLayer({
        users: ["P1", "P2"],
        start: MON_JAN5,
        restriction: dailyRestriction(9, 17),
        handOff: d(2026, 0, 5, 12),
        rot: rotation(EventInterval.Day, 1),
      }),
      buildLayer({
        users: ["F1", "F2"],
        start: MON_JAN5,
        restriction: noRestriction(),
        handOff: MON_JAN5,
        rot: rotation(EventInterval.Week, 1),
      }),
    ],
    calStart: MON_JAN5,
    calEnd: d(2026, 0, 19),
    stepSeconds: 300,
    fullCoverage: true,
  });

  /*
   * S2: fast hourly restricted primary => back-to-back windows over ONE long
   * 24/7 weekly fallback event (exercises the trailing-tail reconstruction).
   */
  list.push({
    name: "S2 2-layer: hourly daily-09-17 primary (3 users) over 24/7 weekly fallback",
    layers: [
      buildLayer({
        users: ["A", "B", "C"],
        start: MON_JAN5,
        restriction: dailyRestriction(9, 17),
        handOff: d(2026, 0, 5, 9),
        rot: rotation(EventInterval.Hour, 1),
      }),
      buildLayer({
        users: ["Z"],
        start: MON_JAN5,
        restriction: noRestriction(),
        handOff: MON_JAN5,
        rot: rotation(EventInterval.Week, 1),
      }),
    ],
    calStart: MON_JAN5,
    calEnd: d(2026, 0, 9),
    stepSeconds: 60,
    fullCoverage: true,
  });

  // S3: two disjoint restricted primaries over 24/7 fallback (3 layers).
  list.push({
    name: "S3 3-layer: mornings 06-10 + afternoons 14-18 over 24/7 fallback",
    layers: [
      buildLayer({
        users: ["M1", "M2"],
        start: MON_JAN5,
        restriction: dailyRestriction(6, 10),
        handOff: d(2026, 0, 5, 8),
        rot: rotation(EventInterval.Day, 1),
      }),
      buildLayer({
        users: ["N1", "N2"],
        start: MON_JAN5,
        restriction: dailyRestriction(14, 18),
        handOff: d(2026, 0, 5, 16),
        rot: rotation(EventInterval.Day, 1),
      }),
      buildLayer({
        users: ["Z1"],
        start: MON_JAN5,
        restriction: noRestriction(),
        handOff: MON_JAN5,
        rot: rotation(EventInterval.Week, 1),
      }),
    ],
    calStart: MON_JAN5,
    calEnd: d(2026, 0, 19),
    stepSeconds: 180,
    fullCoverage: true,
  });

  // S4: weekly rotation primary + daily secondary + 24/7 fallback (3 layers).
  list.push({
    name: "S4 3-layer: weekly-rot daily-09-17 + daily-20-23 secondary over 24/7 fallback",
    layers: [
      buildLayer({
        users: ["W1", "W2"],
        start: MON_JAN5,
        restriction: dailyRestriction(9, 17),
        handOff: d(2026, 0, 5, 12),
        rot: rotation(EventInterval.Week, 1),
      }),
      buildLayer({
        users: ["S1u", "S2u"],
        start: MON_JAN5,
        restriction: dailyRestriction(20, 23),
        handOff: d(2026, 0, 5, 21),
        rot: rotation(EventInterval.Day, 2),
      }),
      buildLayer({
        users: ["Z1"],
        start: MON_JAN5,
        restriction: noRestriction(),
        handOff: MON_JAN5,
        rot: rotation(EventInterval.Week, 1),
      }),
    ],
    calStart: MON_JAN5,
    calEnd: d(2026, 0, 26),
    stepSeconds: 300,
    fullCoverage: true,
  });

  // S5: FOUR layers, three back-to-back daily windows over a 24/7 fallback.
  list.push({
    name: "S5 4-layer: 06-09 + 09-15 + 15-21 daily over 24/7 fallback",
    layers: [
      buildLayer({
        users: ["E1", "E2"],
        start: MON_JAN5,
        restriction: dailyRestriction(6, 9),
        handOff: d(2026, 0, 5, 7),
        rot: rotation(EventInterval.Day, 1),
      }),
      buildLayer({
        users: ["D1", "D2", "D3"],
        start: MON_JAN5,
        restriction: dailyRestriction(9, 15),
        handOff: d(2026, 0, 5, 12),
        rot: rotation(EventInterval.Day, 1),
      }),
      buildLayer({
        users: ["V1", "V2"],
        start: MON_JAN5,
        restriction: dailyRestriction(15, 21),
        handOff: d(2026, 0, 5, 18),
        rot: rotation(EventInterval.Day, 1),
      }),
      buildLayer({
        users: ["Z1"],
        start: MON_JAN5,
        restriction: noRestriction(),
        handOff: MON_JAN5,
        rot: rotation(EventInterval.Week, 1),
      }),
    ],
    calStart: MON_JAN5,
    calEnd: d(2026, 0, 15),
    stepSeconds: 120,
    fullCoverage: true,
  });

  // S6: three 24/7 layers, equal starts, different rotations -> layer0 wins.
  list.push({
    name: "S6 3-layer: equal-start 24/7 layers, mixed rotations -> highest wins",
    layers: [
      buildLayer({
        users: ["A1", "A2"],
        start: MON_JAN5,
        restriction: noRestriction(),
        handOff: MON_JAN5,
        rot: rotation(EventInterval.Week, 1),
      }),
      buildLayer({
        users: ["B1", "B2", "B3"],
        start: MON_JAN5,
        restriction: noRestriction(),
        handOff: MON_JAN5,
        rot: rotation(EventInterval.Day, 2),
      }),
      buildLayer({
        users: ["C1"],
        start: MON_JAN5,
        restriction: noRestriction(),
        handOff: MON_JAN5,
        rot: rotation(EventInterval.Hour, 3),
      }),
    ],
    calStart: MON_JAN5,
    calEnd: d(2026, 0, 19),
    stepSeconds: 240,
    fullCoverage: true,
  });

  // S7: higher-priority layer fully covers the lower one (both 24/7).
  list.push({
    name: "S7 2-layer: 24/7 primary fully shadows 24/7 secondary",
    layers: [
      buildLayer({
        users: ["A"],
        start: MON_JAN5,
        restriction: noRestriction(),
        handOff: MON_JAN5,
        rot: rotation(EventInterval.Week, 1),
      }),
      buildLayer({
        users: ["B1", "B2"],
        start: MON_JAN5,
        restriction: noRestriction(),
        handOff: MON_JAN5,
        rot: rotation(EventInterval.Day, 1),
      }),
    ],
    calStart: MON_JAN5,
    calEnd: d(2026, 0, 19),
    stepSeconds: 300,
    fullCoverage: true,
  });

  // S8: nested three-way overlap (11-15 in 10-16 in 09-17) over 24/7 fallback.
  list.push({
    name: "S8 4-layer: nested 11-15 / 10-16 / 09-17 three-way overlap over 24/7 fallback",
    layers: [
      buildLayer({
        users: ["A"],
        start: MON_JAN5,
        restriction: dailyRestriction(11, 15),
        handOff: d(2026, 0, 5, 12),
        rot: rotation(EventInterval.Day, 1),
      }),
      buildLayer({
        users: ["B"],
        start: MON_JAN5,
        restriction: dailyRestriction(10, 16),
        handOff: d(2026, 0, 5, 12),
        rot: rotation(EventInterval.Day, 1),
      }),
      buildLayer({
        users: ["C"],
        start: MON_JAN5,
        restriction: dailyRestriction(9, 17),
        handOff: d(2026, 0, 5, 12),
        rot: rotation(EventInterval.Day, 1),
      }),
      buildLayer({
        users: ["Z"],
        start: MON_JAN5,
        restriction: noRestriction(),
        handOff: MON_JAN5,
        rot: rotation(EventInterval.Week, 1),
      }),
    ],
    calStart: MON_JAN5,
    calEnd: d(2026, 0, 12),
    stepSeconds: 90,
    fullCoverage: true,
  });

  /*
   * S9: fully-restricted (weekday-only) primary over a WEEKEND window => the
   * primary contributes zero coverage and the 24/7 fallback fills 100%.
   */
  list.push({
    name: "S9 2-layer: weekday-only primary over WEEKEND window -> fallback fills fully",
    layers: [
      buildLayer({
        users: ["P1", "P2"],
        start: MON_JAN5,
        restriction: weeklyRestrictionByDates([
          { start: d(2026, 0, 5, 0), end: d(2026, 0, 10, 0) }, // Mon 00:00 -> Sat 00:00
        ]),
        handOff: d(2026, 0, 5, 12),
        rot: rotation(EventInterval.Day, 1),
      }),
      buildLayer({
        users: ["Z"],
        start: MON_JAN5,
        restriction: noRestriction(),
        handOff: MON_JAN5,
        rot: rotation(EventInterval.Week, 1),
      }),
    ],
    calStart: d(2026, 0, 10, 12), // Sat 12:00 (fully inside the weekend gap)
    calEnd: d(2026, 0, 11, 12), // Sun 12:00
    stepSeconds: 60,
    fullCoverage: true,
  });

  /*
   * S10: schedule authored in America/New_York over a 24/7 fallback; run under
   * a possibly-different server zone (TZ=UTC in CI) to exercise divergence.
   */
  list.push({
    name: "S10 2-layer(tz): America/New_York daily 09-17 primary over 24/7 fallback",
    layers: [
      buildLayer({
        users: ["NY1", "NY2"],
        start: MON_JAN5,
        restriction: dailyRestriction(9, 17),
        handOff: d(2026, 0, 5, 12),
        rot: rotation(EventInterval.Day, 1),
        timezone: "America/New_York",
      }),
      buildLayer({
        users: ["Z"],
        start: MON_JAN5,
        restriction: noRestriction(),
        handOff: MON_JAN5,
        rot: rotation(EventInterval.Week, 1),
        timezone: "America/New_York",
      }),
    ],
    calStart: MON_JAN5,
    calEnd: d(2026, 0, 19),
    stepSeconds: 300,
    fullCoverage: true,
  });

  /*
   * S11: higher-priority layer starts 2 days into the window; fallback fills
   * the head, then primary takes over (equal-start NOT required).
   */
  list.push({
    name: "S11 2-layer: primary starts 2 days in, 24/7 fallback fills the head",
    layers: [
      buildLayer({
        users: ["P1", "P2"],
        start: d(2026, 0, 7, 0),
        restriction: noRestriction(),
        handOff: d(2026, 0, 7, 0),
        rot: rotation(EventInterval.Day, 1),
      }),
      buildLayer({
        users: ["F1"],
        start: MON_JAN5,
        restriction: noRestriction(),
        handOff: MON_JAN5,
        rot: rotation(EventInterval.Week, 1),
      }),
    ],
    calStart: MON_JAN5,
    calEnd: d(2026, 0, 12),
    stepSeconds: 120,
    fullCoverage: true,
  });

  /*
   * S12: TWO restricted layers, NO fallback => genuine uncovered gaps
   * (oracle null == merged null). Only priority-agreement + no-overlap hold.
   */
  list.push({
    name: "S12 2-layer: overlapping restricted primaries, no fallback (genuine gaps)",
    layers: [
      buildLayer({
        users: ["A"],
        start: MON_JAN5,
        restriction: dailyRestriction(9, 12),
        handOff: MON_JAN5,
        rot: rotation(EventInterval.Week, 1),
      }),
      buildLayer({
        users: ["B"],
        start: MON_JAN5,
        restriction: dailyRestriction(10, 17),
        handOff: MON_JAN5,
        rot: rotation(EventInterval.Week, 1),
      }),
    ],
    calStart: MON_JAN5,
    calEnd: d(2026, 0, 9),
    stepSeconds: 60,
    fullCoverage: false,
  });

  /*
   * S13: FOUR mixed-interval layers - hourly, daily, weekly restricted primaries
   * over a 24/7 monthly fallback.
   */
  list.push({
    name: "S13 4-layer: hourly + daily + weekly restricted over 24/7 monthly fallback",
    layers: [
      buildLayer({
        users: ["H1", "H2"],
        start: MON_JAN5,
        restriction: dailyRestriction(8, 12),
        handOff: d(2026, 0, 5, 8),
        rot: rotation(EventInterval.Hour, 2),
      }),
      buildLayer({
        users: ["G1", "G2"],
        start: MON_JAN5,
        restriction: dailyRestriction(12, 18),
        handOff: d(2026, 0, 5, 15),
        rot: rotation(EventInterval.Day, 1),
      }),
      buildLayer({
        users: ["K1"],
        start: MON_JAN5,
        restriction: dailyRestriction(18, 23),
        handOff: d(2026, 0, 5, 20),
        rot: rotation(EventInterval.Week, 1),
      }),
      buildLayer({
        users: ["Z1"],
        start: MON_JAN5,
        restriction: noRestriction(),
        handOff: MON_JAN5,
        rot: rotation(EventInterval.Month, 1),
      }),
    ],
    calStart: MON_JAN5,
    calEnd: d(2026, 0, 12),
    stepSeconds: 60,
    fullCoverage: true,
  });

  // S14: back-to-back DIFFERENT-priority windows (09-13 then 13-17) over 24/7.
  list.push({
    name: "S14 3-layer: back-to-back 09-13 + 13-17 different-priority over 24/7 fallback",
    layers: [
      buildLayer({
        users: ["AM"],
        start: MON_JAN5,
        restriction: dailyRestriction(9, 13),
        handOff: d(2026, 0, 5, 11),
        rot: rotation(EventInterval.Week, 1),
      }),
      buildLayer({
        users: ["PM"],
        start: MON_JAN5,
        restriction: dailyRestriction(13, 17),
        handOff: d(2026, 0, 5, 15),
        rot: rotation(EventInterval.Week, 1),
      }),
      buildLayer({
        users: ["Z"],
        start: MON_JAN5,
        restriction: noRestriction(),
        handOff: MON_JAN5,
        rot: rotation(EventInterval.Week, 1),
      }),
    ],
    calStart: MON_JAN5,
    calEnd: d(2026, 0, 12),
    stepSeconds: 90,
    fullCoverage: true,
  });

  return list;
}

describe("Exhaustive multi-layer merge == per-layer priority oracle", () => {
  for (const sc of scenarios()) {
    test(sc.name, () => {
      const res: AnalyzeResult = analyze(
        sc.layers,
        sc.calStart,
        sc.calEnd,
        sc.stepSeconds,
      );

      /*
       * Invariant (1)+(2): highest priority wins each instant and no covered
       * instant is dropped (mismatches would include both wrong-winner and
       * null-where-oracle-covers).
       */
      expect({ name: sc.name, mismatches: res.mismatches }).toEqual({
        name: sc.name,
        mismatches: [],
      });

      // Invariant (3a): never double-cover (no double paging).
      expect(res.overlaps).toBe(0);

      // Sanity: the grid actually sampled a meaningful number of instants.
      expect(res.samples).toBeGreaterThan(10);

      /*
       * Invariant (3b): where a 24/7 fallback exists, coverage is contiguous
       * across the entire window with only sub-2s carve seams.
       */
      if (sc.fullCoverage) {
        const gap: number = maxCoverageGapMs(
          res.merged,
          sc.calStart,
          sc.calEnd,
        );
        expect(gap).toBeLessThanOrEqual(2000);
      }
    });
  }
});

describe("Targeted invariants: winner, tail-preservation, fallback-fill", () => {
  test("S7: higher-priority 24/7 layer fully shadows the lower one (B never appears)", () => {
    const sc: Scenario = scenarios().find((s: Scenario) => {
      return s.name.startsWith("S7");
    })!;
    const merged: Array<CalendarEvent> = merge(
      sc.layers,
      sc.calStart,
      sc.calEnd,
    );
    expect(merged.length).toBeGreaterThan(0);
    for (const e of merged) {
      expect(e.title).toBe("A");
      expect(e.title).not.toBe("B1");
      expect(e.title).not.toBe("B2");
    }
    // Full single coverage across the window.
    expect(
      maxCoverageGapMs(merged, sc.calStart, sc.calEnd),
    ).toBeLessThanOrEqual(2000);
  });

  test("S9: weekday-only primary over a weekend window => fallback Z fills 100%, primary absent", () => {
    const sc: Scenario = scenarios().find((s: Scenario) => {
      return s.name.startsWith("S9");
    })!;
    const merged: Array<CalendarEvent> = merge(
      sc.layers,
      sc.calStart,
      sc.calEnd,
    );
    expect(merged.length).toBeGreaterThan(0);
    for (const e of merged) {
      expect(e.title).toBe("Z");
    }
    // The primary users must never surface anywhere in the weekend window.
    const titles: string[] = merged.map((e: CalendarEvent) => {
      return e.title;
    });
    expect(titles).not.toContain("P1");
    expect(titles).not.toContain("P2");
    // No hole: fallback covers the entire weekend window.
    expect(
      maxCoverageGapMs(merged, sc.calStart, sc.calEnd),
    ).toBeLessThanOrEqual(2000);
  });

  test("S2: hourly primary => fallback tail after 17:00 survives every day (no lost tail)", () => {
    const sc: Scenario = scenarios().find((s: Scenario) => {
      return s.name.startsWith("S2");
    })!;
    const merged: Array<CalendarEvent> = merge(
      sc.layers,
      sc.calStart,
      sc.calEnd,
    );

    /*
     * For each of the 4 days, the post-window evening (20:00) must be the
     * fallback user Z — proving the fallback's trailing coverage after the
     * back-to-back hourly windows was preserved, not deleted by the carve.
     */
    for (let day: number = 0; day < 4; day++) {
      const evening: Date = d(2026, 0, 5 + day, 20, 0);
      const early: Date = d(2026, 0, 5 + day, 3, 0);
      expect(coveringUser(merged, evening)).toBe("Z");
      expect(coveringUser(merged, early)).toBe("Z");
    }
    // A mid-window hour (e.g. 12:30) must be one of the primary hourly users.
    const midday: string | null = coveringUser(merged, d(2026, 0, 5, 12, 30));
    expect(["A", "B", "C"]).toContain(midday);

    // And at least one merged event with a primary title exists (windows kept).
    const hasPrimary: boolean = merged.some((e: CalendarEvent) => {
      return e.title === "A" || e.title === "B" || e.title === "C";
    });
    expect(hasPrimary).toBe(true);
  });

  test("S8: nested three-way overlap resolves highest-priority winner at each band", () => {
    const sc: Scenario = scenarios().find((s: Scenario) => {
      return s.name.startsWith("S8");
    })!;
    const merged: Array<CalendarEvent> = merge(
      sc.layers,
      sc.calStart,
      sc.calEnd,
    );
    /*
     * Monday Jan 5 bands: 09-10 C, 10-11 B, 11-15 A, 15-16 B, 16-17 C, else Z.
     * (12:00 is a rotation-handoff seam for all three primaries, so probe 12:30.)
     */
    expect(coveringUser(merged, d(2026, 0, 5, 3, 0))).toBe("Z");
    expect(coveringUser(merged, d(2026, 0, 5, 9, 30))).toBe("C");
    expect(coveringUser(merged, d(2026, 0, 5, 10, 30))).toBe("B");
    expect(coveringUser(merged, d(2026, 0, 5, 12, 30))).toBe("A");
    expect(coveringUser(merged, d(2026, 0, 5, 14, 59))).toBe("A");
    expect(coveringUser(merged, d(2026, 0, 5, 15, 30))).toBe("B");
    expect(coveringUser(merged, d(2026, 0, 5, 16, 30))).toBe("C");
    expect(coveringUser(merged, d(2026, 0, 5, 20, 0))).toBe("Z");
  });

  test("S14: back-to-back different-priority windows both present with fallback around", () => {
    const sc: Scenario = scenarios().find((s: Scenario) => {
      return s.name.startsWith("S14");
    })!;
    const merged: Array<CalendarEvent> = merge(
      sc.layers,
      sc.calStart,
      sc.calEnd,
    );
    /*
     * Monday: 03:00 Z, AM owns 09-13, PM owns 13-17, 20:00 Z. Probe interiors
     * that avoid the weekly handoff seams (AM @11:00, PM @15:00).
     */
    expect(coveringUser(merged, d(2026, 0, 5, 3, 0))).toBe("Z");
    expect(coveringUser(merged, d(2026, 0, 5, 10, 0))).toBe("AM");
    expect(coveringUser(merged, d(2026, 0, 5, 12, 0))).toBe("AM");
    expect(coveringUser(merged, d(2026, 0, 5, 14, 0))).toBe("PM");
    expect(coveringUser(merged, d(2026, 0, 5, 16, 0))).toBe("PM");
    expect(coveringUser(merged, d(2026, 0, 5, 20, 0))).toBe("Z");
    // Contiguous, no overlap.
    expect(overlappingPairs(merged).length).toBe(0);
    expect(
      maxCoverageGapMs(merged, sc.calStart, sc.calEnd),
    ).toBeLessThanOrEqual(2000);
  });

  test("S11: fallback fills head before the delayed primary, primary owns the tail", () => {
    const sc: Scenario = scenarios().find((s: Scenario) => {
      return s.name.startsWith("S11");
    })!;
    const merged: Array<CalendarEvent> = merge(
      sc.layers,
      sc.calStart,
      sc.calEnd,
    );
    // Day 0 (Jan 5) noon: only the fallback F1 exists yet.
    expect(coveringUser(merged, d(2026, 0, 5, 12, 0))).toBe("F1");
    expect(coveringUser(merged, d(2026, 0, 6, 12, 0))).toBe("F1");
    // Day 2 (Jan 7) onward: primary P1/P2 daily rotation takes over.
    expect(["P1", "P2"]).toContain(coveringUser(merged, d(2026, 0, 7, 12, 0)));
    expect(["P1", "P2"]).toContain(coveringUser(merged, d(2026, 0, 8, 12, 0)));
    expect(
      maxCoverageGapMs(merged, sc.calStart, sc.calEnd),
    ).toBeLessThanOrEqual(2000);
  });
});

describe("Structural guarantees over the merged output", () => {
  test("merged events are individually well-formed (start < end) for every scenario", () => {
    for (const sc of scenarios()) {
      const merged: Array<CalendarEvent> = merge(
        sc.layers,
        sc.calStart,
        sc.calEnd,
      );
      for (const e of merged) {
        expect(e.end.getTime()).toBeGreaterThan(e.start.getTime());
        // Events stay within the calendar window (allowing the 1s carve seam).
        expect(e.start.getTime()).toBeGreaterThanOrEqual(
          sc.calStart.getTime() - 1000,
        );
        expect(e.end.getTime()).toBeLessThanOrEqual(sc.calEnd.getTime() + 1000);
      }
      // Unique ids assigned by the merge.
      const ids: number[] = merged.map((e: CalendarEvent) => {
        return e.id;
      });
      expect(new Set<number>(ids).size).toBe(ids.length);
    }
  });

  test("layer order matters: swapping priority flips the winner in an overlap", () => {
    // Two 24/7 layers over the same window: whichever is index 0 wins entirely.
    const layerA: LayerProps = buildLayer({
      users: ["A"],
      start: MON_JAN5,
      restriction: noRestriction(),
      handOff: MON_JAN5,
      rot: rotation(EventInterval.Week, 1),
    });
    const layerB: LayerProps = buildLayer({
      users: ["B"],
      start: MON_JAN5,
      restriction: noRestriction(),
      handOff: MON_JAN5,
      rot: rotation(EventInterval.Week, 1),
    });
    const end: Date = d(2026, 0, 12);

    const abMerged: Array<CalendarEvent> = merge(
      [layerA, layerB],
      MON_JAN5,
      end,
    );
    for (const e of abMerged) {
      expect(e.title).toBe("A");
    }

    const baMerged: Array<CalendarEvent> = merge(
      [layerB, layerA],
      MON_JAN5,
      end,
    );
    for (const e of baMerged) {
      expect(e.title).toBe("B");
    }
  });

  test("getNumberOfEvents cap is applied only after the merge, not per-layer", () => {
    /*
     * Daily 09-17 primary over 24/7 weekly fallback. The first merged event is
     * the fallback night; capping must still surface later events correctly.
     */
    const layers: Array<LayerProps> = [
      buildLayer({
        users: ["P"],
        start: MON_JAN5,
        restriction: dailyRestriction(9, 17),
        handOff: d(2026, 0, 5, 12),
        rot: rotation(EventInterval.Day, 1),
      }),
      buildLayer({
        users: ["Z"],
        start: MON_JAN5,
        restriction: noRestriction(),
        handOff: MON_JAN5,
        rot: rotation(EventInterval.Week, 1),
      }),
    ];
    const full: Array<CalendarEvent> = util.getMultiLayerEvents({
      layers: layers,
      calendarStartDate: MON_JAN5,
      calendarEndDate: d(2026, 0, 12),
    });
    const capped: Array<CalendarEvent> = util.getMultiLayerEvents(
      {
        layers: layers,
        calendarStartDate: MON_JAN5,
        calendarEndDate: d(2026, 0, 12),
      },
      { getNumberOfEvents: 3 },
    );
    expect(capped.length).toBe(3);
    // The capped list is exactly the prefix of the full merged timeline.
    for (let i: number = 0; i < capped.length; i++) {
      expect(capped[i]!.title).toBe(full[i]!.title);
      expect(capped[i]!.start.getTime()).toBe(full[i]!.start.getTime());
      expect(capped[i]!.end.getTime()).toBe(full[i]!.end.getTime());
    }
  });
});
