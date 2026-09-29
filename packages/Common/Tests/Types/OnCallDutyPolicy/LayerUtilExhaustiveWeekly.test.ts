/**
 * EXHAUSTIVE coverage for the WEEKLY restriction expansion path of LayerUtil:
 *   - getWeeklyRestrictionTimesForWeek (segment construction, wrap split, week
 *     anchoring — audit F6)
 *   - getEventsByWeeklyRestriction (weekly tiling across a multi-week rotation
 *     event + merge of overlapping/duplicate segments — audit F3)
 *   - mergeOverlappingStartAndEndTimes (exercised through the above)
 *   - end-to-end getEvents: single non-wrapping window (Mon-Fri), wrap-around
 *     weekend (Fri 20:00 -> Mon 08:00), multiple windows in one week (disjoint
 *     AND overlapping), a window spanning (almost) the whole week, a rotation
 *     event spanning several ISO weeks tiled with no duplicate/overlap, DST weeks
 *     (America/New_York) whose wall-clock boundaries (incl. the weekend Monday
 *     close) do not drift, and resolving on the weekend gap returning the correct
 *     next-week user (audit F2 weekly).
 *
 * Every timezone-sensitive assertion is expressed in the SCHEDULE zone's
 * wall-clock via moment-timezone, so the file is correct under any process TZ
 * (run it a second time under TZ=UTC to exercise the exact server-vs-schedule
 * divergence the DST fixes target). "Plain" scenarios use an explicit "UTC"
 * schedule zone (no DST) so they are deterministic regardless of the process
 * zone; DST scenarios use America/New_York, which — against a UTC or London
 * process zone — reproduces the server-vs-schedule divergence.
 *
 * The core oracle: a wall-clock coverage model computed INDEPENDENTLY of the
 * production code (weekday + time-of-day in the schedule zone, with wrap-around
 * handling) is compared against the code's emitted events at hundreds of sampled
 * instants per config. Boundaries are guarded by a small epsilon so a +-1s edge
 * adjustment in the code is never a false positive.
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
import StartAndEndTime from "../../../Types/Time/StartAndEndTime";
import moment from "moment-timezone";

/*
 * ---------------------------------------------------------------------------
 * Fixtures / builders
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

const UTC: string = "UTC";
const NY: string = "America/New_York";

// An absolute instant that reads `iso` (YYYY-MM-DD HH:mm[:ss]) wall-clock in `zone`.
function at(iso: string, zone: string): Date {
  return moment.tz(iso, zone).toDate();
}

/*
 * A weekly restriction window authored by its wall-clock start/end in `zone`.
 * The production code derives the day-of-week from the Date itself (startDay /
 * endDay fields are informational), so the Date must fall on the intended day.
 */
function win(
  startISO: string,
  endISO: string,
  zone: string,
): WeeklyResctriction {
  const startTime: Date = at(startISO, zone);
  const endTime: Date = at(endISO, zone);
  return {
    startDay: OneUptimeDate.getDayOfWeek(startTime, zone),
    endDay: OneUptimeDate.getDayOfWeek(endTime, zone),
    startTime,
    endTime,
  };
}

function weeklyRestriction(
  windows: Array<WeeklyResctriction>,
): RestrictionTimes {
  const r: RestrictionTimes = new RestrictionTimes();
  r.restictionType = RestrictionType.Weekly;
  r.weeklyRestrictionTimes = windows;
  return r;
}

function weeklyLayer(opts: {
  users: Array<string>;
  zone: string | undefined;
  windows: Array<WeeklyResctriction>;
  layerStart: Date;
  handOffTime: Date;
  rotationType: EventInterval;
  rotationCount: number;
}): LayerProps {
  const rot: Recurring = new Recurring();
  rot.intervalType = opts.rotationType;
  rot.intervalCount = new PositiveNumber(opts.rotationCount);
  return {
    users: opts.users.map(user),
    startDateTimeOfLayer: opts.layerStart,
    restrictionTimes: weeklyRestriction(opts.windows),
    handOffTime: opts.handOffTime,
    rotation: rot,
    timezone: opts.zone,
  };
}

function expand(
  layer: LayerProps,
  start: Date,
  end: Date,
): Array<CalendarEvent> {
  return new LayerUtil().getEvents({
    ...layer,
    calendarStartDate: start,
    calendarEndDate: end,
  });
}

/*
 * A LayerUtil whose per-call schedule zone is pinned, so the *public* restriction
 * helpers can be unit-tested directly (getEvents normally sets this internally).
 */
function utilInZone(zone: string): LayerUtil {
  const u: LayerUtil = new LayerUtil();
  (u as unknown as { timezone: string | undefined }).timezone = zone;
  return u;
}

/*
 * ---------------------------------------------------------------------------
 * Independent wall-clock coverage ORACLE
 * ---------------------------------------------------------------------------
 */

const WEEK_SECONDS: number = 7 * 24 * 3600;

/*
 * Seconds elapsed from the start of the (Sunday-anchored) week, in `zone`
 * wall-clock. Sunday 00:00 => 0, Saturday 23:59:59 => 604799.
 */
function weekSecondOf(instant: Date, zone: string): number {
  const m: moment.Moment = moment.tz(instant, zone);
  const sundayIndex: number = m.isoWeekday() % 7; // Mon=1..Sun=7 -> Sun=0..Sat=6
  return sundayIndex * 86400 + m.hour() * 3600 + m.minute() * 60 + m.second();
}

interface OracleWindow {
  startWS: number;
  endWS: number;
}

function oracleWindow(w: WeeklyResctriction, zone: string): OracleWindow {
  return {
    startWS: weekSecondOf(w.startTime, zone),
    endWS: weekSecondOf(w.endTime, zone),
  };
}

function coveredByOracle(ws: number, windows: Array<OracleWindow>): boolean {
  for (const w of windows) {
    if (w.startWS <= w.endWS) {
      if (ws >= w.startWS && ws < w.endWS) {
        return true;
      }
    } else if (ws >= w.startWS || ws < w.endWS) {
      // wrap-around window (e.g. Fri 20:00 -> Mon 08:00)
      return true;
    }
  }
  return false;
}

function circularDistance(a: number, b: number): number {
  let d: number = Math.abs(a - b) % WEEK_SECONDS;
  if (d > WEEK_SECONDS / 2) {
    d = WEEK_SECONDS - d;
  }
  return d;
}

function nearAnyBoundary(
  ws: number,
  windows: Array<OracleWindow>,
  guardSeconds: number,
): boolean {
  for (const w of windows) {
    if (circularDistance(ws, w.startWS) < guardSeconds) {
      return true;
    }
    if (circularDistance(ws, w.endWS) < guardSeconds) {
      return true;
    }
  }
  return false;
}

function coveredByEvents(events: Array<CalendarEvent>, t: Date): boolean {
  const ms: number = t.getTime();
  return events.some((e: CalendarEvent) => {
    return ms >= e.start.getTime() && ms < e.end.getTime();
  });
}

function coveringEvent(
  events: Array<CalendarEvent>,
  t: Date,
): CalendarEvent | undefined {
  const ms: number = t.getTime();
  return events.find((e: CalendarEvent) => {
    return ms >= e.start.getTime() && ms < e.end.getTime();
  });
}

/*
 * Sample the calendar window at a fixed real-time step and compare code coverage
 * vs oracle coverage. Returns a list of human-readable mismatches (empty == pass).
 */
function coverageMismatches(opts: {
  events: Array<CalendarEvent>;
  windows: Array<WeeklyResctriction>;
  zone: string;
  start: Date;
  end: Date;
  stepSeconds: number;
  guardSeconds: number;
}): { samples: number; mismatches: Array<string> } {
  const oracle: Array<OracleWindow> = opts.windows.map(
    (w: WeeklyResctriction) => {
      return oracleWindow(w, opts.zone);
    },
  );
  const mismatches: Array<string> = [];
  let samples: number = 0;

  // Non-round phase offset so samples don't systematically land on :00 boundaries.
  let cursorMs: number = opts.start.getTime() + 613 * 1000;
  const endMs: number = opts.end.getTime();

  while (cursorMs < endMs) {
    const t: Date = new Date(cursorMs);
    const ws: number = weekSecondOf(t, opts.zone);
    if (!nearAnyBoundary(ws, oracle, opts.guardSeconds)) {
      const codeCovered: boolean = coveredByEvents(opts.events, t);
      const oracleCovered: boolean = coveredByOracle(ws, oracle);
      if (codeCovered !== oracleCovered) {
        mismatches.push(
          `t=${t.toISOString()} (${moment.tz(t, opts.zone).format("ddd HH:mm")} ${opts.zone}) code=${codeCovered} oracle=${oracleCovered}`,
        );
      }
      samples++;
    }
    cursorMs += opts.stepSeconds * 1000;
  }

  return { samples, mismatches };
}

// For single-user layers, events must never overlap and never duplicate.
function overlapProblems(events: Array<CalendarEvent>): Array<string> {
  const sorted: Array<CalendarEvent> = [...events].sort(
    (a: CalendarEvent, b: CalendarEvent) => {
      return a.start.getTime() - b.start.getTime();
    },
  );
  const problems: Array<string> = [];
  for (let i: number = 0; i < sorted.length; i++) {
    const cur: CalendarEvent | undefined = sorted[i];
    if (!cur) {
      continue;
    }
    if (cur.end.getTime() <= cur.start.getTime()) {
      problems.push(`zero/negative length @${cur.start.toISOString()}`);
    }
    if (i > 0) {
      const prev: CalendarEvent | undefined = sorted[i - 1];
      if (prev && cur.start.getTime() < prev.end.getTime()) {
        problems.push(
          `overlap: [${prev.start.toISOString()}->${prev.end.toISOString()}] & [${cur.start.toISOString()}->${cur.end.toISOString()}]`,
        );
      }
      if (
        prev &&
        prev.start.getTime() === cur.start.getTime() &&
        prev.end.getTime() === cur.end.getTime()
      ) {
        problems.push(`duplicate @${cur.start.toISOString()}`);
      }
    }
  }
  return problems;
}

// A clean anchor: layer starts on a Sunday 00:00 so the first ISO week is whole.
const UTC_SUN_JAN5: Date = at("2025-01-05 00:00", UTC);

/*
 * ===========================================================================
 * UNIT: getWeeklyRestrictionTimesForWeek — segment construction
 * ===========================================================================
 */

describe("getWeeklyRestrictionTimesForWeek: segment construction", () => {
  test("non-wrapping Mon-Fri window emits exactly ONE ordered segment (no phantom/inverted extra)", () => {
    const util: LayerUtil = utilInZone(UTC);
    // Mon 00:00 -> Sat 00:00 (covers Mon..Fri).
    const restriction: RestrictionTimes = weeklyRestriction([
      win("2025-01-06 00:00", "2025-01-11 00:00", UTC),
    ]);

    const segments: Array<StartAndEndTime> =
      util.getWeeklyRestrictionTimesForWeek({
        eventStartTime: at("2025-01-08 12:00", UTC), // a Wednesday
        eventEndTime: at("2025-01-08 23:59", UTC),
        restrictionTimes: restriction,
      });

    expect(segments.length).toBe(1);
    const seg: StartAndEndTime = segments[0]!;
    // Boundaries move to the event's own week, keeping wall-clock day+time.
    expect(moment.tz(seg.startTime, UTC).format("ddd HH:mm")).toBe("Mon 00:00");
    expect(moment.tz(seg.endTime, UTC).format("ddd HH:mm")).toBe("Sat 00:00");
    expect(seg.startTime.getTime()).toBeLessThan(seg.endTime.getTime());
  });

  test("wrap-around weekend (Fri 20:00 -> Mon 08:00) splits into head + main, both ordered", () => {
    const util: LayerUtil = utilInZone(UTC);
    const restriction: RestrictionTimes = weeklyRestriction([
      win("2025-01-03 20:00", "2025-01-06 08:00", UTC), // Fri 20:00 -> Mon 08:00
    ]);

    const segments: Array<StartAndEndTime> =
      util.getWeeklyRestrictionTimesForWeek({
        eventStartTime: at("2025-01-08 12:00", UTC), // Wednesday of the week
        eventEndTime: at("2025-01-08 23:59", UTC),
        restrictionTimes: restriction,
      });

    expect(segments.length).toBe(2);
    const sorted: Array<StartAndEndTime> = [...segments].sort(
      (a: StartAndEndTime, b: StartAndEndTime) => {
        return a.startTime.getTime() - b.startTime.getTime();
      },
    );
    const head: StartAndEndTime = sorted[0]!;
    const main: StartAndEndTime = sorted[1]!;

    // Head: the early-week tail (start of the Sunday-anchored week -> Mon 08:00).
    expect(moment.tz(head.startTime, UTC).format("ddd HH:mm")).toBe(
      "Sun 00:00",
    );
    expect(moment.tz(head.endTime, UTC).format("ddd HH:mm")).toBe("Mon 08:00");
    // The head start equals getStartOfTheWeek of the event (audit F6 anchoring).
    expect(head.startTime.getTime()).toBe(
      OneUptimeDate.getStartOfTheWeek(
        at("2025-01-08 12:00", UTC),
        UTC,
      ).getTime(),
    );

    // Main: Fri 20:00 -> the FOLLOWING Monday 08:00 (endTime + 7 days).
    expect(moment.tz(main.startTime, UTC).format("ddd HH:mm")).toBe(
      "Fri 20:00",
    );
    expect(moment.tz(main.endTime, UTC).format("ddd HH:mm")).toBe("Mon 08:00");
    // main.end is a full 7 days after the head's Monday close (wall-clock).
    expect(
      moment.tz(main.endTime, UTC).diff(moment.tz(head.endTime, UTC), "days"),
    ).toBe(7);

    // Neither segment is inverted.
    for (const s of segments) {
      expect(s.startTime.getTime()).toBeLessThan(s.endTime.getTime());
    }
  });

  test("resolving MID-WEEKEND does not invert the head segment (audit F6)", () => {
    const util: LayerUtil = utilInZone(UTC);
    const restriction: RestrictionTimes = weeklyRestriction([
      win("2025-01-03 20:00", "2025-01-06 08:00", UTC), // Fri 20:00 -> Mon 08:00
    ]);

    // "now" is Sunday 04:00 — already past the window's Monday-of-this-week end.
    const segments: Array<StartAndEndTime> =
      util.getWeeklyRestrictionTimesForWeek({
        eventStartTime: at("2025-01-12 04:00", UTC), // Sunday
        eventEndTime: at("2025-01-12 06:00", UTC),
        restrictionTimes: restriction,
      });

    // No segment may be inverted (the pre-fix bug produced start > end here).
    for (const s of segments) {
      expect(s.startTime.getTime()).toBeLessThanOrEqual(s.endTime.getTime());
    }
    // Head must still be anchored to the Sunday week-start, ordered before its end.
    const head: StartAndEndTime | undefined = segments.find(
      (s: StartAndEndTime) => {
        return moment.tz(s.startTime, UTC).format("ddd HH:mm") === "Sun 00:00";
      },
    );
    expect(head).toBeTruthy();
    expect(moment.tz(head!.endTime, UTC).format("ddd HH:mm")).toBe("Mon 08:00");
  });
});

/*
 * ===========================================================================
 * UNIT: getEventsByWeeklyRestriction — tiling + merge
 * ===========================================================================
 */

describe("getEventsByWeeklyRestriction: merge of overlapping / duplicate segments", () => {
  test("two OVERLAPPING same-week windows merge into one contiguous block (no overlap/dupe)", () => {
    const util: LayerUtil = utilInZone(UTC);
    const restriction: RestrictionTimes = weeklyRestriction([
      win("2025-01-06 00:00", "2025-01-08 12:00", UTC), // Mon 00:00 -> Wed 12:00
      win("2025-01-08 10:00", "2025-01-10 00:00", UTC), // Wed 10:00 -> Fri 00:00
    ]);

    const merged: Array<StartAndEndTime> = util.getEventsByWeeklyRestriction({
      eventStartTime: at("2025-01-06 00:00", UTC),
      eventEndTime: at("2025-01-10 00:00", UTC),
      restrictionTimes: restriction,
    });

    expect(merged.length).toBe(1);
    expect(moment.tz(merged[0]!.startTime, UTC).format("ddd HH:mm")).toBe(
      "Mon 00:00",
    );
    expect(moment.tz(merged[0]!.endTime, UTC).format("ddd HH:mm")).toBe(
      "Fri 00:00",
    );
  });

  test("two DISJOINT windows stay separate (the real Thursday gap is preserved)", () => {
    const util: LayerUtil = utilInZone(UTC);
    const restriction: RestrictionTimes = weeklyRestriction([
      win("2025-01-06 00:00", "2025-01-08 00:00", UTC), // Mon -> Wed
      win("2025-01-10 00:00", "2025-01-11 00:00", UTC), // Fri -> Sat
    ]);

    const segments: Array<StartAndEndTime> = util.getEventsByWeeklyRestriction({
      eventStartTime: at("2025-01-06 00:00", UTC),
      eventEndTime: at("2025-01-11 00:00", UTC),
      restrictionTimes: restriction,
    });

    expect(segments.length).toBe(2);
    const sorted: Array<StartAndEndTime> = [...segments].sort(
      (a: StartAndEndTime, b: StartAndEndTime) => {
        return a.startTime.getTime() - b.startTime.getTime();
      },
    );
    expect(moment.tz(sorted[0]!.endTime, UTC).format("ddd HH:mm")).toBe(
      "Wed 00:00",
    );
    expect(moment.tz(sorted[1]!.startTime, UTC).format("ddd HH:mm")).toBe(
      "Fri 00:00",
    );
    // There is a genuine (Thursday) gap between them.
    expect(sorted[1]!.startTime.getTime()).toBeGreaterThan(
      sorted[0]!.endTime.getTime(),
    );
  });

  test("empty weeklyRestrictionTimes returns the full event window unchanged", () => {
    const util: LayerUtil = utilInZone(UTC);
    const restriction: RestrictionTimes = weeklyRestriction([]);
    const eventStart: Date = at("2025-01-06 00:00", UTC);
    const eventEnd: Date = at("2025-01-08 00:00", UTC);

    const segments: Array<StartAndEndTime> = util.getEventsByWeeklyRestriction({
      eventStartTime: eventStart,
      eventEndTime: eventEnd,
      restrictionTimes: restriction,
    });

    expect(segments.length).toBe(1);
    expect(segments[0]!.startTime.getTime()).toBe(eventStart.getTime());
    expect(segments[0]!.endTime.getTime()).toBe(eventEnd.getTime());
  });

  test("multi-week wrap tiling produces NO duplicate/overlapping segment on the Sun->Mon seam (audit F3)", () => {
    const util: LayerUtil = utilInZone(UTC);
    const restriction: RestrictionTimes = weeklyRestriction([
      win("2025-01-03 20:00", "2025-01-06 08:00", UTC), // Fri 20:00 -> Mon 08:00
    ]);

    // One "event" (as a monthly rotation period would be) spanning ~4 ISO weeks.
    const segments: Array<StartAndEndTime> = util.getEventsByWeeklyRestriction({
      eventStartTime: UTC_SUN_JAN5,
      eventEndTime: at("2025-02-02 00:00", UTC),
      restrictionTimes: restriction,
    });

    // No two merged segments may overlap or duplicate.
    const asEvents: Array<CalendarEvent> = segments.map(
      (s: StartAndEndTime) => {
        return {
          id: 0,
          title: "x",
          allDay: false,
          start: s.startTime,
          end: s.endTime,
        };
      },
    );
    expect(overlapProblems(asEvents)).toEqual([]);

    // Each interior weekend must be a single contiguous Fri 20:00 -> Mon 08:00 block.
    const jan18: Date = at("2025-01-18 12:00", UTC); // a Saturday
    const cover: CalendarEvent | undefined = coveringEvent(asEvents, jan18);
    expect(cover).toBeTruthy();
    expect(moment.tz(cover!.start, UTC).format("ddd HH:mm")).toBe("Fri 20:00");
    expect(moment.tz(cover!.end, UTC).format("ddd HH:mm")).toBe("Mon 08:00");
  });
});

/*
 * ===========================================================================
 * END-TO-END getEvents: coverage oracle (single user, UTC schedule)
 * ===========================================================================
 */

describe("getEvents coverage matches the wall-clock oracle (UTC schedule, single user)", () => {
  interface OracleCase {
    name: string;
    windows: Array<WeeklyResctriction>;
  }

  const cases: Array<OracleCase> = [
    {
      name: "non-wrap Mon-Fri (Mon 00:00 -> Sat 00:00)",
      windows: [win("2025-01-06 00:00", "2025-01-11 00:00", UTC)],
    },
    {
      name: "wrap weekend (Fri 20:00 -> Mon 08:00)",
      windows: [win("2025-01-03 20:00", "2025-01-06 08:00", UTC)],
    },
    {
      name: "two multi-day weekday windows (Mon 09:00->Wed 17:00 & Fri 09:00->Sat 12:00)",
      windows: [
        win("2025-01-06 09:00", "2025-01-08 17:00", UTC), // Mon 09:00 -> Wed 17:00
        win("2025-01-10 09:00", "2025-01-11 12:00", UTC), // Fri 09:00 -> Sat 12:00
      ],
    },
    {
      name: "two overlapping windows collapse (Mon 00:00->Wed 12:00 & Wed 10:00->Fri 00:00)",
      windows: [
        win("2025-01-06 00:00", "2025-01-08 12:00", UTC),
        win("2025-01-08 10:00", "2025-01-10 00:00", UTC),
      ],
    },
    {
      name: "near-whole-week wrap (Mon 00:01 -> Mon 00:00) covers every day",
      windows: [win("2025-01-06 00:01", "2025-01-13 00:00", UTC)],
    },
    {
      name: "wrap weekend + a disjoint Wed daytime window (mixed wrap & non-wrap)",
      windows: [
        win("2025-01-03 20:00", "2025-01-06 08:00", UTC), // Fri 20:00 -> Mon 08:00
        win("2025-01-08 09:00", "2025-01-08 17:00", UTC), // Wed 09:00 -> Wed 17:00
      ],
    },
  ];

  for (const c of cases) {
    test(`${c.name}`, () => {
      const layer: LayerProps = weeklyLayer({
        users: ["solo"],
        zone: UTC,
        windows: c.windows,
        layerStart: UTC_SUN_JAN5,
        handOffTime: at("2025-02-09 00:00", UTC), // > 1 month => single period
        rotationType: EventInterval.Month,
        rotationCount: 1,
      });
      const calendarEnd: Date = at("2025-02-02 00:00", UTC);
      const events: Array<CalendarEvent> = expand(
        layer,
        UTC_SUN_JAN5,
        calendarEnd,
      );

      // Single user => coverage must be strictly non-overlapping & de-duplicated.
      expect(overlapProblems(events)).toEqual([]);
      // Every event is the single user.
      for (const e of events) {
        expect(e.title).toBe("solo");
      }

      const result: { samples: number; mismatches: Array<string> } =
        coverageMismatches({
          events,
          windows: c.windows,
          zone: UTC,
          start: UTC_SUN_JAN5,
          end: calendarEnd,
          stepSeconds: 41 * 60,
          guardSeconds: 120,
        });
      expect(result.samples).toBeGreaterThan(500);
      expect(result.mismatches).toEqual([]);
    });
  }

  test("near-whole-week window actually covers a sample on all 7 weekdays", () => {
    const windows: Array<WeeklyResctriction> = [
      win("2025-01-06 00:01", "2025-01-13 00:00", UTC),
    ];
    const layer: LayerProps = weeklyLayer({
      users: ["solo"],
      zone: UTC,
      windows,
      layerStart: UTC_SUN_JAN5,
      handOffTime: at("2025-02-09 00:00", UTC),
      rotationType: EventInterval.Month,
      rotationCount: 1,
    });
    const events: Array<CalendarEvent> = expand(
      layer,
      UTC_SUN_JAN5,
      at("2025-02-02 00:00", UTC),
    );
    // Sun..Sat of the second week (all inside range), sampled at noon.
    const days: Array<string> = [
      "2025-01-12",
      "2025-01-13",
      "2025-01-14",
      "2025-01-15",
      "2025-01-16",
      "2025-01-17",
      "2025-01-18",
    ];
    for (const d of days) {
      expect(coveredByEvents(events, at(`${d} 12:00`, UTC))).toBe(true);
    }
  });
});

/*
 * ===========================================================================
 * END-TO-END getEvents: concrete wrap boundary (UTC)
 * ===========================================================================
 */

describe("getEvents: wrap-around weekend boundaries are exact (UTC schedule)", () => {
  test("a Saturday instant resolves to a Fri 20:00 -> Mon 08:00 block", () => {
    const windows: Array<WeeklyResctriction> = [
      win("2025-01-03 20:00", "2025-01-06 08:00", UTC),
    ];
    const layer: LayerProps = weeklyLayer({
      users: ["solo"],
      zone: UTC,
      windows,
      layerStart: UTC_SUN_JAN5,
      handOffTime: at("2025-02-09 00:00", UTC),
      rotationType: EventInterval.Month,
      rotationCount: 1,
    });
    const events: Array<CalendarEvent> = expand(
      layer,
      UTC_SUN_JAN5,
      at("2025-02-02 00:00", UTC),
    );

    const cover: CalendarEvent | undefined = coveringEvent(
      events,
      at("2025-01-18 12:00", UTC), // Saturday of the 3rd week
    );
    expect(cover).toBeTruthy();
    expect(moment.tz(cover!.start, UTC).format("YYYY-MM-DD HH:mm")).toBe(
      "2025-01-17 20:00",
    );
    expect(moment.tz(cover!.end, UTC).format("YYYY-MM-DD HH:mm")).toBe(
      "2025-01-20 08:00",
    );

    // Fri 19:30 is NOT covered; Fri 20:30 IS; Mon 08:30 is NOT.
    expect(coveredByEvents(events, at("2025-01-17 19:30", UTC))).toBe(false);
    expect(coveredByEvents(events, at("2025-01-17 20:30", UTC))).toBe(true);
    expect(coveredByEvents(events, at("2025-01-20 08:30", UTC))).toBe(false);
  });
});

/*
 * ===========================================================================
 * F2 (weekly): resolving on the weekend gap returns the correct next-week user
 * ===========================================================================
 */

describe("F2 weekly: weekend-gap query resolves the calendar's next-week user", () => {
  test("weekly rotation [A,B,C] + Mon-Fri restriction: every weekend gap -> next week's user (UTC)", () => {
    const layerStart: Date = at("2025-01-06 00:00", UTC); // Monday
    const layer: LayerProps = weeklyLayer({
      users: ["A", "B", "C"],
      zone: UTC,
      windows: [win("2025-01-06 00:00", "2025-01-11 00:00", UTC)], // Mon 00:00 -> Sat 00:00
      layerStart,
      handOffTime: Recurring.getNextDateInterval(
        layerStart,
        (() => {
          const r: Recurring = new Recurring();
          r.intervalType = EventInterval.Week;
          r.intervalCount = new PositiveNumber(1);
          return r;
        })(),
      ),
      rotationType: EventInterval.Week,
      rotationCount: 1,
    });

    const full: Array<CalendarEvent> = expand(
      layer,
      layerStart,
      at("2025-02-24 00:00", UTC),
    );

    // Rotation stays continuous across the dead weekends: A,B,C,A,B,...
    const weekMondays: Array<string> = [
      "2025-01-06",
      "2025-01-13",
      "2025-01-20",
      "2025-01-27",
      "2025-02-03",
    ];
    const expectedUsers: Array<string> = ["A", "B", "C", "A", "B"];
    weekMondays.forEach((mon: string, idx: number) => {
      const cover: CalendarEvent | undefined = coveringEvent(
        full,
        at(`${mon} 12:00`, UTC),
      );
      expect(cover?.title).toBe(expectedUsers[idx]);
    });

    /*
     * A weekend query (Saturday or Sunday) must resolve the NEXT week's user,
     * matching what the full calendar assigns — never carrying THIS week's user.
     */
    const weekendInstants: Array<string> = [
      "2025-01-11 12:00", // Sat, week0 gap
      "2025-01-12 09:00", // Sun, week0 gap
      "2025-01-18 20:00", // Sat, week1 gap
      "2025-01-25 06:00", // Sat, week2 gap
      "2025-02-01 15:00", // Sat, week3 gap
    ];
    for (const iso of weekendInstants) {
      const askAt: Date = at(iso, UTC);
      const nextCovered: CalendarEvent | undefined = full.find(
        (e: CalendarEvent) => {
          return OneUptimeDate.isAfter(e.start, askAt);
        },
      );
      const windowed: Array<CalendarEvent> = new LayerUtil().getEvents(
        {
          ...layer,
          calendarStartDate: askAt,
          calendarEndDate: OneUptimeDate.addRemoveDays(askAt, 21),
        },
        { getNumberOfEvents: 1 },
      );
      expect(nextCovered).toBeTruthy();
      expect(windowed[0]?.title).toBe(nextCovered?.title);
    }
  });

  test("weekly rotation [A,B] + Mon-Fri restriction across the March DST week (NY)", () => {
    const layerStart: Date = at("2026-03-02 00:00", NY); // Monday
    const layer: LayerProps = weeklyLayer({
      users: ["A", "B"],
      zone: NY,
      windows: [win("2026-03-02 00:00", "2026-03-07 00:00", NY)], // Mon 00:00 -> Sat 00:00 NY
      layerStart,
      handOffTime: at("2026-03-09 00:00", NY), // first handoff Monday 00:00 NY
      rotationType: EventInterval.Week,
      rotationCount: 1,
    });

    const full: Array<CalendarEvent> = expand(
      layer,
      layerStart,
      at("2026-04-06 00:00", NY),
    );

    // Week0 (Mar2-6) = A, week1 (Mar9-13, post-DST) = B, week2 (Mar16-20) = A.
    expect(coveringEvent(full, at("2026-03-04 12:00", NY))?.title).toBe("A");
    expect(coveringEvent(full, at("2026-03-11 12:00", NY))?.title).toBe("B");
    expect(coveringEvent(full, at("2026-03-18 12:00", NY))?.title).toBe("A");

    // Weekend gap over the spring-forward Sunday (Mar 8) resolves next week = B.
    const askAt: Date = at("2026-03-07 12:00", NY); // Saturday
    const nextCovered: CalendarEvent | undefined = full.find(
      (e: CalendarEvent) => {
        return OneUptimeDate.isAfter(e.start, askAt);
      },
    );
    const windowed: Array<CalendarEvent> = new LayerUtil().getEvents(
      {
        ...layer,
        calendarStartDate: askAt,
        calendarEndDate: OneUptimeDate.addRemoveDays(askAt, 21),
      },
      { getNumberOfEvents: 1 },
    );
    expect(nextCovered?.title).toBe("B");
    expect(windowed[0]?.title).toBe(nextCovered?.title);
  });
});

/*
 * ===========================================================================
 * DST (America/New_York): wall-clock boundaries do not drift
 * ===========================================================================
 */

describe("DST (NY): weekend wrap coverage & boundaries hold wall-clock across transitions", () => {
  // Single-user monthly rotation, Fri 20:00 -> Mon 08:00 NY, over an entire month.
  function monthlyWrapEvents(
    layerStartISO: string,
    handOffISO: string,
    calendarEndISO: string,
  ): { events: Array<CalendarEvent>; windows: Array<WeeklyResctriction> } {
    const windows: Array<WeeklyResctriction> = [
      win("2026-01-02 20:00", "2026-01-05 08:00", NY), // a Fri 20:00 -> Mon 08:00 NY
    ];
    const layer: LayerProps = weeklyLayer({
      users: ["solo"],
      zone: NY,
      windows,
      layerStart: at(layerStartISO, NY),
      handOffTime: at(handOffISO, NY),
      rotationType: EventInterval.Month,
      rotationCount: 1,
    });
    return {
      events: expand(layer, at(layerStartISO, NY), at(calendarEndISO, NY)),
      windows,
    };
  }

  test("spring-forward month (March 2026): every weekend closes Mon 08:00 NY (no drift) & oracle matches", () => {
    const built: {
      events: Array<CalendarEvent>;
      windows: Array<WeeklyResctriction>;
    } = monthlyWrapEvents(
      "2026-03-01 00:00",
      "2026-04-05 00:00",
      "2026-04-01 00:00",
    );
    const events: Array<CalendarEvent> = built.events;

    expect(overlapProblems(events)).toEqual([]);

    /*
     * Weekend spanning the spring-forward (Sun Mar 8): open Fri Mar 6 20:00,
     * close Mon Mar 9 08:00 NY. Wall-clock must not drift by the DST hour.
     */
    expect(coveredByEvents(events, at("2026-03-06 20:30", NY))).toBe(true);
    expect(coveredByEvents(events, at("2026-03-08 12:00", NY))).toBe(true); // DST Sunday
    expect(coveredByEvents(events, at("2026-03-09 07:30", NY))).toBe(true);
    expect(coveredByEvents(events, at("2026-03-09 08:30", NY))).toBe(false);

    /*
     * The Monday close stays exactly 08:00 NY for EVERY weekend of the month
     * (locks that the DST drift never propagates forward — audit F8).
     */
    const mondayCloses: Array<string> = [
      "2026-03-09",
      "2026-03-16",
      "2026-03-23",
      "2026-03-30",
    ];
    for (const mon of mondayCloses) {
      expect(coveredByEvents(events, at(`${mon} 07:30`, NY))).toBe(true);
      expect(coveredByEvents(events, at(`${mon} 08:30`, NY))).toBe(false);
    }
    // Friday opens stay exactly 20:00 NY.
    const fridayOpens: Array<string> = [
      "2026-03-06",
      "2026-03-13",
      "2026-03-20",
      "2026-03-27",
    ];
    for (const fri of fridayOpens) {
      expect(coveredByEvents(events, at(`${fri} 19:30`, NY))).toBe(false);
      expect(coveredByEvents(events, at(`${fri} 20:30`, NY))).toBe(true);
    }

    const result: { samples: number; mismatches: Array<string> } =
      coverageMismatches({
        events,
        windows: built.windows,
        zone: NY,
        start: at("2026-03-01 00:00", NY),
        end: at("2026-04-01 00:00", NY),
        stepSeconds: 41 * 60,
        guardSeconds: 180,
      });
    expect(result.samples).toBeGreaterThan(500);
    expect(result.mismatches).toEqual([]);
  });

  test("fall-back month (November 2026): weekend Monday close holds 08:00 NY & oracle matches", () => {
    const built: {
      events: Array<CalendarEvent>;
      windows: Array<WeeklyResctriction>;
    } = monthlyWrapEvents(
      "2026-11-01 00:00",
      "2026-12-06 00:00",
      "2026-12-01 00:00",
    );
    const events: Array<CalendarEvent> = built.events;

    expect(overlapProblems(events)).toEqual([]);

    /*
     * Fall-back Sunday is Nov 1 2026 (25-hour day). Layer starts Sun Nov 1 00:00;
     * that Sunday is inside the (previous Friday's) weekend window -> covered,
     * and the Monday close is Nov 2 08:00 NY.
     */
    expect(coveredByEvents(events, at("2026-11-01 12:00", NY))).toBe(true);
    expect(coveredByEvents(events, at("2026-11-02 07:30", NY))).toBe(true);
    expect(coveredByEvents(events, at("2026-11-02 08:30", NY))).toBe(false);

    // Subsequent weekends unaffected by the fall-back: close stays 08:00 NY.
    const mondayCloses: Array<string> = [
      "2026-11-09",
      "2026-11-16",
      "2026-11-23",
    ];
    for (const mon of mondayCloses) {
      expect(coveredByEvents(events, at(`${mon} 07:30`, NY))).toBe(true);
      expect(coveredByEvents(events, at(`${mon} 08:30`, NY))).toBe(false);
    }

    const result: { samples: number; mismatches: Array<string> } =
      coverageMismatches({
        events,
        windows: built.windows,
        zone: NY,
        start: at("2026-11-01 00:00", NY),
        end: at("2026-12-01 00:00", NY),
        stepSeconds: 41 * 60,
        guardSeconds: 180,
      });
    expect(result.samples).toBeGreaterThan(500);
    expect(result.mismatches).toEqual([]);
  });

  test("non-wrap Mon-Fri window keeps its Saturday-00:00 close wall-clock across the DST week (NY)", () => {
    const windows: Array<WeeklyResctriction> = [
      win("2026-03-02 00:00", "2026-03-07 00:00", NY), // Mon 00:00 -> Sat 00:00 NY
    ];
    const layer: LayerProps = weeklyLayer({
      users: ["solo"],
      zone: NY,
      windows,
      layerStart: at("2026-03-01 00:00", NY), // Sunday
      handOffTime: at("2026-04-05 00:00", NY),
      rotationType: EventInterval.Month,
      rotationCount: 1,
    });
    const events: Array<CalendarEvent> = expand(
      layer,
      at("2026-03-01 00:00", NY),
      at("2026-04-01 00:00", NY),
    );

    expect(overlapProblems(events)).toEqual([]);

    /*
     * The DST-week Wednesday is covered; the weekend is not; the Saturday 00:00
     * boundary does not drift by the spring-forward hour.
     */
    expect(coveredByEvents(events, at("2026-03-11 12:00", NY))).toBe(true); // Wed (DST week)
    expect(coveredByEvents(events, at("2026-03-13 23:30", NY))).toBe(true); // Fri night, before Sat 00:00
    expect(coveredByEvents(events, at("2026-03-14 00:30", NY))).toBe(false); // Sat, after close
    expect(coveredByEvents(events, at("2026-03-14 12:00", NY))).toBe(false); // Sat
    expect(coveredByEvents(events, at("2026-03-15 12:00", NY))).toBe(false); // Sun

    const result: { samples: number; mismatches: Array<string> } =
      coverageMismatches({
        events,
        windows,
        zone: NY,
        start: at("2026-03-01 00:00", NY),
        end: at("2026-04-01 00:00", NY),
        stepSeconds: 41 * 60,
        guardSeconds: 180,
      });
    expect(result.samples).toBeGreaterThan(500);
    expect(result.mismatches).toEqual([]);
  });
});

/*
 * ===========================================================================
 * Multi-week tiling via a 4-week (weekly x4) rotation period, coverage oracle
 * ===========================================================================
 */

describe("multi-ISO-week rotation period is tiled with no duplicate/overlap (weekly x4, UTC)", () => {
  test("wrap weekend over a 4-week single period matches oracle", () => {
    const windows: Array<WeeklyResctriction> = [
      win("2025-01-03 20:00", "2025-01-06 08:00", UTC),
    ];
    const rot: Recurring = new Recurring();
    rot.intervalType = EventInterval.Week;
    rot.intervalCount = new PositiveNumber(4);
    const layer: LayerProps = {
      users: [user("solo")],
      startDateTimeOfLayer: UTC_SUN_JAN5,
      restrictionTimes: weeklyRestriction(windows),
      handOffTime: Recurring.getNextDateInterval(UTC_SUN_JAN5, rot), // +28 days
      rotation: rot,
      timezone: UTC,
    };
    const calendarEnd: Date = at("2025-01-31 00:00", UTC); // inside the first 4-week period
    const events: Array<CalendarEvent> = expand(
      layer,
      UTC_SUN_JAN5,
      calendarEnd,
    );

    expect(overlapProblems(events)).toEqual([]);
    for (const e of events) {
      expect(e.title).toBe("solo");
    }

    const result: { samples: number; mismatches: Array<string> } =
      coverageMismatches({
        events,
        windows,
        zone: UTC,
        start: UTC_SUN_JAN5,
        end: calendarEnd,
        stepSeconds: 37 * 60,
        guardSeconds: 120,
      });
    expect(result.samples).toBeGreaterThan(500);
    expect(result.mismatches).toEqual([]);
  });
});

/*
 * ===========================================================================
 * Weekly restriction with an EMPTY window array behaves as unrestricted
 * ===========================================================================
 */

describe("Weekly restriction type with empty windows => full (unrestricted) coverage", () => {
  test("getEvents returns continuous coverage for RestrictionType.Weekly with []", () => {
    const layer: LayerProps = weeklyLayer({
      users: ["solo"],
      zone: UTC,
      windows: [],
      layerStart: UTC_SUN_JAN5,
      handOffTime: at("2025-02-09 00:00", UTC),
      rotationType: EventInterval.Month,
      rotationCount: 1,
    });
    const calendarEnd: Date = at("2025-01-12 00:00", UTC);
    const events: Array<CalendarEvent> = expand(
      layer,
      UTC_SUN_JAN5,
      calendarEnd,
    );

    // No gaps: sample the whole window, every instant covered.
    let cursorMs: number = UTC_SUN_JAN5.getTime() + 613 * 1000;
    let samples: number = 0;
    const gaps: Array<string> = [];
    while (cursorMs < calendarEnd.getTime()) {
      const t: Date = new Date(cursorMs);
      if (!coveredByEvents(events, t)) {
        gaps.push(t.toISOString());
      }
      samples++;
      cursorMs += 37 * 60 * 1000;
    }
    expect(samples).toBeGreaterThan(50);
    expect(gaps).toEqual([]);
  });
});
