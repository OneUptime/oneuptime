/**
 * EXHAUSTIVE coverage for DAILY-restriction trimming (getEventsByDailyRestriction)
 * and its integration through LayerUtil.getEvents / getMultiLayerEvents.
 *
 * These tests lock in the CORRECT (post-audit-fix) behavior of the daily
 * restriction path across every window shape and rotation combination:
 *   - normal same-day windows (09-17, and a matrix of placements)
 *   - early-morning windows (00-06)
 *   - late windows (18:00-23:59)
 *   - windows touching midnight (18:00-00:00)
 *   - overnight wrap-around windows (22-06) incl. the FIRST-DAY morning tail
 *   - multi-day rotation events (weekly & monthly rotation + a daily restriction)
 *     covering every day of the period
 *   - rotation periods that start inside / at / after the daily window
 *   - the F2 post-window evening-gap resolution returning the correct NEXT user
 *   - DST spring-forward & fall-back weeks (America/New_York) where the
 *     wall-clock window must stay stable
 *   - server-vs-schedule timezone divergence (schedule authored in another zone)
 *
 * Restriction boundaries authored via getDateWithCustomTime carry the run's
 * millisecond component (e.g. 09:00:00.147), so coverage is probed at instants
 * offset a full second from minute boundaries (":01"/":59"), never exactly at
 * HH:MM:00.000. Timezone assertions are expressed in wall-clock via
 * moment-timezone so they hold regardless of the process TZ the suite runs
 * under (run this file additionally with TZ=UTC to exercise the divergence).
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
import StartAndEndTime from "../../../Types/Time/StartAndEndTime";
import moment from "moment-timezone";

/*
 * ---------------------------------------------------------------------------
 * Builders / helpers (mirroring the sibling LayerUtil test files).
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

// Local (server-zone) daily restriction authored via wall-clock H:M.
function dailyLocal(
  sh: number,
  sm: number,
  eh: number,
  em: number,
): RestrictionTimes {
  const r: RestrictionTimes = new RestrictionTimes();
  r.restictionType = RestrictionType.Daily;
  r.dayRestrictionTimes = {
    startTime: OneUptimeDate.getDateWithCustomTime({
      hours: sh,
      minutes: sm,
      seconds: 0,
    }),
    endTime: OneUptimeDate.getDateWithCustomTime({
      hours: eh,
      minutes: em,
      seconds: 0,
    }),
  };
  return r;
}

// Timezone-aware daily restriction whose wall-clock is authored IN `tz`.
function dailyTz(
  startIso: string,
  endIso: string,
  tz: string,
): RestrictionTimes {
  const r: RestrictionTimes = new RestrictionTimes();
  r.restictionType = RestrictionType.Daily;
  r.dayRestrictionTimes = {
    startTime: moment.tz(startIso, tz).toDate(),
    endTime: moment.tz(endIso, tz).toDate(),
  };
  return r;
}

function rotationOf(t: EventInterval, c: number): Recurring {
  const r: Recurring = new Recurring();
  r.intervalType = t;
  r.intervalCount = new PositiveNumber(c);
  return r;
}

interface LayerCfg {
  users: string[];
  intervalType: EventInterval;
  intervalCount: number;
  restriction: RestrictionTimes;
  start: Date;
  timezone?: string | undefined;
}

function makeLayer(cfg: LayerCfg): LayerProps {
  const rot: Recurring = rotationOf(cfg.intervalType, cfg.intervalCount);
  return {
    users: cfg.users.map(user),
    startDateTimeOfLayer: cfg.start,
    restrictionTimes: cfg.restriction,
    handOffTime: Recurring.getNextDateInterval(cfg.start, rot),
    rotation: rot,
    timezone: cfg.timezone,
  };
}

function expand(layer: LayerProps, from: Date, to: Date): Array<CalendarEvent> {
  const util: LayerUtil = new LayerUtil();
  return util.getEvents({
    ...layer,
    calendarStartDate: from,
    calendarEndDate: to,
  });
}

// The LIVE "who is on call now / next" path: windowed, getNumberOfEvents:1.
function windowedNext(layer: LayerProps, at: Date): CalendarEvent | undefined {
  const util: LayerUtil = new LayerUtil();
  return util.getMultiLayerEvents(
    {
      layers: [layer],
      calendarStartDate: at,
      calendarEndDate: OneUptimeDate.addRemoveDays(at, 25),
    },
    { getNumberOfEvents: 1 },
  )[0];
}

// Which user covers instant `t` (start <= t < end). Millisecond-precise.
function coveringTitle(events: Array<CalendarEvent>, t: Date): string | null {
  for (const e of events) {
    if (e.start.getTime() <= t.getTime() && e.end.getTime() > t.getTime()) {
      return e.title;
    }
  }
  return null;
}

// First event that starts strictly after `t` (ground-truth "next" shift).
function nextAfter(
  events: Array<CalendarEvent>,
  t: Date,
): CalendarEvent | undefined {
  let best: CalendarEvent | undefined = undefined;
  for (const e of events) {
    if (e.start.getTime() > t.getTime()) {
      if (best === undefined || e.start.getTime() < best.start.getTime()) {
        best = e;
      }
    }
  }
  return best;
}

// Local instant Jan (2025) day/H/M/S in the process zone.
function jan(day: number, h: number, m: number, s: number): Date {
  return new Date(2025, 0, day, h, m, s);
}

const NY: string = "America/New_York";
const KOLKATA: string = "Asia/Kolkata";

function tzInstant(iso: string, tz: string): Date {
  return moment.tz(iso, tz).toDate();
}

function hhmm(d: Date, tz: string): string {
  return moment.tz(d, tz).format("HH:mm");
}

// A Monday, no DST anywhere in early January.
const MON_JAN6: Date = jan(6, 0, 0, 0);

/*
 * ===========================================================================
 * GROUP A - normal same-day window 09:00-17:00 (server-local)
 * ===========================================================================
 */

describe("Daily same-day window 09:00-17:00 (local)", () => {
  test("direct trim emits exactly one 09:00-17:00 segment per day over a multi-day event", () => {
    const util: LayerUtil = new LayerUtil();
    const segs: Array<StartAndEndTime> =
      util.trimStartAndEndTimesBasedOnRestrictionTimes({
        eventStartTime: jan(6, 0, 0, 0),
        eventEndTime: jan(9, 0, 0, 0), // 3 full days
        restrictionTimes: dailyLocal(9, 0, 17, 0),
      });
    expect(segs.length).toBe(3);
    for (const s of segs) {
      expect(s.startTime.getHours()).toBe(9);
      expect(s.startTime.getMinutes()).toBe(0);
      expect(s.endTime.getHours()).toBe(17);
      expect(s.endTime.getMinutes()).toBe(0);
      // each segment is strictly inside one calendar day
      expect(s.startTime.getDate()).toBe(s.endTime.getDate());
    }
  });

  test("daily rotation single user: covered midday, uncovered outside the window each day", () => {
    const layer: LayerProps = makeLayer({
      users: ["A"],
      intervalType: EventInterval.Day,
      intervalCount: 1,
      restriction: dailyLocal(9, 0, 17, 0),
      start: MON_JAN6,
    });
    const ev: Array<CalendarEvent> = expand(layer, MON_JAN6, jan(11, 0, 0, 0));
    for (let d: number = 6; d <= 10; d++) {
      expect(coveringTitle(ev, jan(d, 12, 0, 0))).toBe("A"); // noon covered
      expect(coveringTitle(ev, jan(d, 8, 30, 0))).toBeNull(); // before
      expect(coveringTitle(ev, jan(d, 17, 30, 0))).toBeNull(); // after
      expect(coveringTitle(ev, jan(d, 0, 30, 0))).toBeNull(); // deep night
    }
  });

  test("boundary instants (second-precise, robust to ms authoring noise)", () => {
    const layer: LayerProps = makeLayer({
      users: ["A"],
      intervalType: EventInterval.Day,
      intervalCount: 1,
      restriction: dailyLocal(9, 0, 17, 0),
      start: MON_JAN6,
    });
    const ev: Array<CalendarEvent> = expand(layer, MON_JAN6, jan(8, 0, 0, 0));
    expect(coveringTitle(ev, jan(6, 8, 59, 59))).toBeNull(); // just before open
    expect(coveringTitle(ev, jan(6, 9, 0, 1))).toBe("A"); // just after open
    expect(coveringTitle(ev, jan(6, 16, 59, 59))).toBe("A"); // just before close
    expect(coveringTitle(ev, jan(6, 17, 0, 1))).toBeNull(); // just after close
  });

  for (const users of [
    ["A", "B"],
    ["A", "B", "C"],
  ] as string[][]) {
    test(`daily rotation ${users.length} users: correct on-call user at noon each day`, () => {
      const layer: LayerProps = makeLayer({
        users,
        intervalType: EventInterval.Day,
        intervalCount: 1,
        restriction: dailyLocal(9, 0, 17, 0),
        start: MON_JAN6,
      });
      const ev: Array<CalendarEvent> = expand(
        layer,
        MON_JAN6,
        jan(6 + users.length * 2, 0, 0, 0),
      );
      for (let i: number = 0; i < users.length * 2; i++) {
        const expected: string = users[i % users.length] as string;
        expect(coveringTitle(ev, jan(6 + i, 12, 0, 0))).toBe(expected);
      }
    });
  }
});

/*
 * ===========================================================================
 * GROUP B - early-morning same-day window 00:00-06:00
 * ===========================================================================
 */

describe("Daily early-morning window 00:00-06:00 (local)", () => {
  test("direct trim emits one 00:00-06:00 segment per day", () => {
    const util: LayerUtil = new LayerUtil();
    const segs: Array<StartAndEndTime> =
      util.trimStartAndEndTimesBasedOnRestrictionTimes({
        eventStartTime: jan(6, 0, 0, 0),
        eventEndTime: jan(9, 0, 0, 0),
        restrictionTimes: dailyLocal(0, 0, 6, 0),
      });
    expect(segs.length).toBe(3);
    for (const s of segs) {
      expect(s.startTime.getHours()).toBe(0);
      expect(s.endTime.getHours()).toBe(6);
    }
  });

  test("covered in the small hours, uncovered the rest of the day", () => {
    const layer: LayerProps = makeLayer({
      users: ["A"],
      intervalType: EventInterval.Day,
      intervalCount: 1,
      restriction: dailyLocal(0, 0, 6, 0),
      start: MON_JAN6,
    });
    const ev: Array<CalendarEvent> = expand(layer, MON_JAN6, jan(9, 0, 0, 0));
    for (let d: number = 6; d <= 8; d++) {
      expect(coveringTitle(ev, jan(d, 0, 30, 0))).toBe("A");
      expect(coveringTitle(ev, jan(d, 3, 0, 0))).toBe("A");
      expect(coveringTitle(ev, jan(d, 5, 59, 0))).toBe("A");
      expect(coveringTitle(ev, jan(d, 6, 0, 1))).toBeNull();
      expect(coveringTitle(ev, jan(d, 12, 0, 0))).toBeNull();
      expect(coveringTitle(ev, jan(d, 22, 0, 0))).toBeNull();
    }
  });
});

/*
 * ===========================================================================
 * GROUP C - late same-day window 18:00-23:59
 * ===========================================================================
 */

describe("Daily late window 18:00-23:59 (local)", () => {
  test("direct trim emits one 18:00-23:59 segment per day", () => {
    const util: LayerUtil = new LayerUtil();
    const segs: Array<StartAndEndTime> =
      util.trimStartAndEndTimesBasedOnRestrictionTimes({
        eventStartTime: jan(6, 0, 0, 0),
        eventEndTime: jan(8, 0, 0, 0),
        restrictionTimes: dailyLocal(18, 0, 23, 59),
      });
    expect(segs.length).toBe(2);
    for (const s of segs) {
      expect(s.startTime.getHours()).toBe(18);
      expect(s.endTime.getHours()).toBe(23);
      expect(s.endTime.getMinutes()).toBe(59);
    }
  });

  test("covered in the evening, uncovered before 18:00 and after 23:59", () => {
    const layer: LayerProps = makeLayer({
      users: ["A"],
      intervalType: EventInterval.Day,
      intervalCount: 1,
      restriction: dailyLocal(18, 0, 23, 59),
      start: MON_JAN6,
    });
    const ev: Array<CalendarEvent> = expand(layer, MON_JAN6, jan(9, 0, 0, 0));
    for (let d: number = 6; d <= 8; d++) {
      expect(coveringTitle(ev, jan(d, 18, 0, 1))).toBe("A");
      expect(coveringTitle(ev, jan(d, 20, 0, 0))).toBe("A");
      expect(coveringTitle(ev, jan(d, 23, 58, 0))).toBe("A");
      expect(coveringTitle(ev, jan(d, 17, 59, 0))).toBeNull();
      expect(coveringTitle(ev, jan(d, 12, 0, 0))).toBeNull();
      expect(coveringTitle(ev, jan(d, 0, 30, 0))).toBeNull();
    }
  });
});

/*
 * ===========================================================================
 * GROUP D - overnight wrap-around window 22:00-06:00 (incl. first-day morning)
 * ===========================================================================
 */

describe("Daily overnight wrap-around window 22:00-06:00 (local)", () => {
  test("first period emits a leading start-of-day morning segment (first-day morning covered)", () => {
    // Period starting at midnight must have its 00:00-06:00 morning tail covered.
    const util: LayerUtil = new LayerUtil();
    const segs: Array<StartAndEndTime> =
      util.trimStartAndEndTimesBasedOnRestrictionTimes({
        eventStartTime: jan(6, 0, 0, 0),
        eventEndTime: jan(7, 0, 0, 0),
        restrictionTimes: dailyLocal(22, 0, 6, 0),
      });
    // Exactly: [Jan6 00:00, Jan6 06:00] morning + [Jan6 22:00, Jan6 23:59:59] night.
    const morning: StartAndEndTime | undefined = segs.find(
      (s: StartAndEndTime) => {
        return s.startTime.getHours() === 0;
      },
    );
    expect(morning).toBeTruthy();
    expect(morning?.startTime.getDate()).toBe(6);
    expect(morning?.endTime.getHours()).toBe(6);
    const night: StartAndEndTime | undefined = segs.find(
      (s: StartAndEndTime) => {
        return s.startTime.getHours() === 22;
      },
    );
    expect(night).toBeTruthy();
  });

  test("coverage completeness across several days for a midnight-anchored rotation", () => {
    const layer: LayerProps = makeLayer({
      users: ["A"],
      intervalType: EventInterval.Day,
      intervalCount: 1,
      restriction: dailyLocal(22, 0, 6, 0),
      start: MON_JAN6,
    });
    const ev: Array<CalendarEvent> = expand(layer, MON_JAN6, jan(9, 0, 0, 0));

    // First-day morning (the fix: loop starts one day before the event).
    expect(coveringTitle(ev, jan(6, 0, 0, 1))).toBe("A");
    expect(coveringTitle(ev, jan(6, 3, 0, 0))).toBe("A");
    expect(coveringTitle(ev, jan(6, 5, 59, 0))).toBe("A");

    // Nights across days.
    for (const d of [6, 7, 8]) {
      expect(coveringTitle(ev, jan(d, 22, 0, 1))).toBe("A");
      expect(coveringTitle(ev, jan(d, 23, 30, 0))).toBe("A");
    }
    // Following mornings.
    for (const d of [7, 8]) {
      expect(coveringTitle(ev, jan(d, 3, 0, 0))).toBe("A");
    }

    // Daytime gap is uncovered.
    for (const d of [6, 7, 8]) {
      expect(coveringTitle(ev, jan(d, 6, 0, 1))).toBeNull();
      expect(coveringTitle(ev, jan(d, 12, 0, 0))).toBeNull();
      expect(coveringTitle(ev, jan(d, 21, 59, 0))).toBeNull();
    }
  });

  test("weekly rotation with an overnight restriction covers every night of the week", () => {
    const layer: LayerProps = makeLayer({
      users: ["A"],
      intervalType: EventInterval.Week,
      intervalCount: 1,
      restriction: dailyLocal(22, 0, 6, 0),
      start: MON_JAN6,
    });
    const ev: Array<CalendarEvent> = expand(layer, MON_JAN6, jan(12, 0, 0, 0));
    for (let d: number = 6; d <= 10; d++) {
      expect(coveringTitle(ev, jan(d, 0, 30, 0))).toBe("A"); // morning
      expect(coveringTitle(ev, jan(d, 23, 0, 0))).toBe("A"); // night
      expect(coveringTitle(ev, jan(d, 12, 0, 0))).toBeNull(); // daytime
    }
  });

  for (const [sh, eh] of [
    [23, 5],
    [20, 8],
    [21, 7],
  ] as Array<[number, number]>) {
    test(`overnight ${sh}:00-${eh}:00 covers the wrap band and excludes the daytime`, () => {
      const layer: LayerProps = makeLayer({
        users: ["A"],
        intervalType: EventInterval.Day,
        intervalCount: 1,
        restriction: dailyLocal(sh, 0, eh, 0),
        start: MON_JAN6,
      });
      const ev: Array<CalendarEvent> = expand(layer, MON_JAN6, jan(9, 0, 0, 0));
      // Deep night and deep early-morning covered; solar midday uncovered.
      expect(coveringTitle(ev, jan(7, 3, 0, 0))).toBe("A");
      expect(coveringTitle(ev, jan(7, sh, 30, 0))).toBe("A");
      expect(coveringTitle(ev, jan(7, 12, 0, 0))).toBeNull();
      // A point strictly between eh and sh (mid-afternoon) is uncovered.
      const mid: number = Math.floor((eh + sh) / 2);
      expect(coveringTitle(ev, jan(7, mid, 30, 0))).toBeNull();
    });
  }
});

/*
 * ===========================================================================
 * GROUP E - window touching midnight (18:00-00:00 == overnight ending at 00:00)
 * ===========================================================================
 */

describe("Daily window touching midnight 18:00-00:00 (local)", () => {
  test("covers 18:00 to end-of-day with no phantom morning segment", () => {
    const layer: LayerProps = makeLayer({
      users: ["A"],
      intervalType: EventInterval.Day,
      intervalCount: 1,
      restriction: dailyLocal(18, 0, 0, 0),
      start: MON_JAN6,
    });
    const ev: Array<CalendarEvent> = expand(layer, MON_JAN6, jan(9, 0, 0, 0));
    for (const d of [6, 7, 8]) {
      expect(coveringTitle(ev, jan(d, 18, 0, 1))).toBe("A");
      expect(coveringTitle(ev, jan(d, 23, 59, 30))).toBe("A");
      // No coverage in the morning/day: the wrap "morning" is zero-length.
      expect(coveringTitle(ev, jan(d, 0, 30, 0))).toBeNull();
      expect(coveringTitle(ev, jan(d, 3, 0, 0))).toBeNull();
      expect(coveringTitle(ev, jan(d, 12, 0, 0))).toBeNull();
      expect(coveringTitle(ev, jan(d, 17, 59, 0))).toBeNull();
    }
  });
});

/*
 * ===========================================================================
 * GROUP F - multi-day rotation events (weekly & monthly) with a daily restriction
 * ===========================================================================
 */

describe("Multi-day rotation events with a daily 09:00-17:00 restriction", () => {
  test("weekly rotation, 2 users: every day of week 1 is A, every day of week 2 is B", () => {
    const layer: LayerProps = makeLayer({
      users: ["A", "B"],
      intervalType: EventInterval.Week,
      intervalCount: 1,
      restriction: dailyLocal(9, 0, 17, 0),
      start: MON_JAN6,
    });
    const ev: Array<CalendarEvent> = expand(layer, MON_JAN6, jan(20, 0, 0, 0));
    for (let d: number = 0; d < 7; d++) {
      expect(coveringTitle(ev, jan(6 + d, 12, 0, 0))).toBe("A");
      expect(coveringTitle(ev, jan(13 + d, 12, 0, 0))).toBe("B");
      // Off-hours still uncovered even mid-period.
      expect(coveringTitle(ev, jan(6 + d, 8, 30, 0))).toBeNull();
      expect(coveringTitle(ev, jan(6 + d, 18, 0, 0))).toBeNull();
    }
  });

  test("weekly rotation, 3 users: consecutive weeks are A, B, C", () => {
    const layer: LayerProps = makeLayer({
      users: ["A", "B", "C"],
      intervalType: EventInterval.Week,
      intervalCount: 1,
      restriction: dailyLocal(9, 0, 17, 0),
      start: MON_JAN6,
    });
    const ev: Array<CalendarEvent> = expand(layer, MON_JAN6, jan(27, 0, 0, 0));
    expect(coveringTitle(ev, jan(8, 12, 0, 0))).toBe("A"); // week 1
    expect(coveringTitle(ev, jan(15, 12, 0, 0))).toBe("B"); // week 2
    expect(coveringTitle(ev, jan(22, 12, 0, 0))).toBe("C"); // week 3
  });

  test("weekly rotation x2 (fortnightly): first two weeks A, next two weeks B", () => {
    const layer: LayerProps = makeLayer({
      users: ["A", "B"],
      intervalType: EventInterval.Week,
      intervalCount: 2,
      restriction: dailyLocal(9, 0, 17, 0),
      start: MON_JAN6,
    });
    const ev: Array<CalendarEvent> = expand(layer, MON_JAN6, jan(34, 0, 0, 0));
    expect(coveringTitle(ev, jan(8, 12, 0, 0))).toBe("A"); // wk1
    expect(coveringTitle(ev, jan(15, 12, 0, 0))).toBe("A"); // wk2
    expect(coveringTitle(ev, jan(22, 12, 0, 0))).toBe("B"); // wk3
    expect(coveringTitle(ev, jan(29, 12, 0, 0))).toBe("B"); // wk4
  });

  test("monthly rotation, 2 users: Jan is A, Feb is B, Mar is A (mid-month sampling)", () => {
    const layer: LayerProps = makeLayer({
      users: ["A", "B"],
      intervalType: EventInterval.Month,
      intervalCount: 1,
      restriction: dailyLocal(9, 0, 17, 0),
      start: new Date(2026, 0, 1, 0, 0, 0),
    });
    const ev: Array<CalendarEvent> = expand(
      layer,
      new Date(2026, 0, 1, 0, 0, 0),
      new Date(2026, 3, 1, 0, 0, 0),
    );
    expect(coveringTitle(ev, new Date(2026, 0, 15, 12, 0, 0))).toBe("A");
    expect(coveringTitle(ev, new Date(2026, 0, 3, 12, 0, 0))).toBe("A");
    expect(coveringTitle(ev, new Date(2026, 1, 15, 12, 0, 0))).toBe("B");
    expect(coveringTitle(ev, new Date(2026, 2, 15, 12, 0, 0))).toBe("A");
    // Off-hours uncovered inside each month.
    expect(coveringTitle(ev, new Date(2026, 1, 15, 8, 30, 0))).toBeNull();
    expect(coveringTitle(ev, new Date(2026, 1, 15, 18, 0, 0))).toBeNull();
  });
});

/*
 * ===========================================================================
 * GROUP G - rotation periods that start inside / at / after the daily window
 * ===========================================================================
 */

describe("Rotation period start relative to the daily window", () => {
  test("start INSIDE the window (12:00): first day trims to [12:00,17:00], last day [09:00,12:00]", () => {
    const layer: LayerProps = makeLayer({
      users: ["A", "B"],
      intervalType: EventInterval.Day,
      intervalCount: 1,
      restriction: dailyLocal(9, 0, 17, 0),
      start: jan(6, 12, 0, 0),
    });
    const ev: Array<CalendarEvent> = expand(
      layer,
      jan(6, 12, 0, 0),
      jan(9, 0, 0, 0),
    );
    // Period 1 (A): partial first afternoon + partial last morning.
    expect(coveringTitle(ev, jan(6, 15, 0, 0))).toBe("A");
    expect(coveringTitle(ev, jan(7, 10, 0, 0))).toBe("A");
    // Period 2 (B) begins at Jan7 12:00.
    expect(coveringTitle(ev, jan(7, 13, 0, 0))).toBe("B");
    // Gaps.
    expect(coveringTitle(ev, jan(6, 18, 0, 0))).toBeNull();
    expect(coveringTitle(ev, jan(7, 8, 0, 0))).toBeNull();
  });

  test("start AT the window open (09:00): first day covered from 09:00", () => {
    const layer: LayerProps = makeLayer({
      users: ["A", "B"],
      intervalType: EventInterval.Day,
      intervalCount: 1,
      restriction: dailyLocal(9, 0, 17, 0),
      start: jan(6, 9, 0, 0),
    });
    const ev: Array<CalendarEvent> = expand(
      layer,
      jan(6, 9, 0, 0),
      jan(8, 0, 0, 0),
    );
    expect(coveringTitle(ev, jan(6, 9, 0, 30))).toBe("A");
    expect(coveringTitle(ev, jan(6, 16, 59, 0))).toBe("A");
    expect(coveringTitle(ev, jan(6, 17, 0, 1))).toBeNull();
    expect(coveringTitle(ev, jan(7, 12, 0, 0))).toBe("B");
  });

  test("start AFTER the window close (20:00): first calendar day has no coverage, next day is still this user's turn", () => {
    const layer: LayerProps = makeLayer({
      users: ["A", "B"],
      intervalType: EventInterval.Day,
      intervalCount: 1,
      restriction: dailyLocal(9, 0, 17, 0),
      start: jan(6, 20, 0, 0),
    });
    const ev: Array<CalendarEvent> = expand(
      layer,
      jan(6, 20, 0, 0),
      jan(9, 0, 0, 0),
    );
    // Nothing on Jan6 evening (window already closed).
    expect(coveringTitle(ev, jan(6, 22, 0, 0))).toBeNull();
    // Period 1 (A) still covers its next day (Jan7); period 2 (B) covers Jan8.
    expect(coveringTitle(ev, jan(7, 12, 0, 0))).toBe("A");
    expect(coveringTitle(ev, jan(8, 12, 0, 0))).toBe("B");
  });
});

/*
 * ===========================================================================
 * GROUP H - F2: post-window evening gap resolves the correct NEXT covered user
 * ===========================================================================
 */

describe("F2 post-window gap: windowed 'next' matches the full-expansion next shift", () => {
  const counts: number[] = [1, 2, 3];
  const userSets: string[][] = [
    ["A", "B"],
    ["A", "B", "C"],
  ];

  for (const count of counts) {
    for (const users of userSets) {
      test(`x${count} daily, ${users.length} users, 09-17: evening gaps never go off-by-one over 10 days`, () => {
        const layer: LayerProps = makeLayer({
          users,
          intervalType: EventInterval.Day,
          intervalCount: count,
          restriction: dailyLocal(9, 0, 17, 0),
          start: MON_JAN6,
        });
        const full: Array<CalendarEvent> = expand(
          layer,
          MON_JAN6,
          jan(6 + 14, 0, 0, 0),
        );
        const mismatches: string[] = [];
        for (let d: number = 0; d < 10; d++) {
          const gap: Date = jan(6 + d, 20, 0, 0); // evening, window closed
          const expected: CalendarEvent | undefined = nextAfter(full, gap);
          const got: CalendarEvent | undefined = windowedNext(layer, gap);
          if ((got?.title ?? null) !== (expected?.title ?? null)) {
            mismatches.push(
              `day ${6 + d}: windowed=${got?.title ?? null} expectedNext=${expected?.title ?? null}`,
            );
          }
        }
        expect(mismatches).toEqual([]);
      });
    }
  }

  test("x1 daily [A,B]: evening gaps resolve to next day's user (B,A,B,A...)", () => {
    const layer: LayerProps = makeLayer({
      users: ["A", "B"],
      intervalType: EventInterval.Day,
      intervalCount: 1,
      restriction: dailyLocal(9, 0, 17, 0),
      start: MON_JAN6,
    });
    expect(windowedNext(layer, jan(6, 20, 0, 0))?.title).toBe("B");
    expect(windowedNext(layer, jan(7, 20, 0, 0))?.title).toBe("A");
    expect(windowedNext(layer, jan(8, 20, 0, 0))?.title).toBe("B");
    expect(windowedNext(layer, jan(9, 20, 0, 0))?.title).toBe("A");
    // And the resolved next event starts the following morning.
    const n: CalendarEvent | undefined = windowedNext(layer, jan(6, 20, 0, 0));
    expect(n?.start.getDate()).toBe(7);
  });

  test("x2 daily [A,B]: last covered day evening advances, earlier day stays in the period", () => {
    const layer: LayerProps = makeLayer({
      users: ["A", "B"],
      intervalType: EventInterval.Day,
      intervalCount: 2,
      restriction: dailyLocal(9, 0, 17, 0),
      start: MON_JAN6,
    });
    /*
     * Period 1 = Jan6..Jan7 = A; period 2 = Jan8..Jan9 = B.
     * Jan6 evening: still A's period, next covered shift is Jan7 (A).
     */
    expect(windowedNext(layer, jan(6, 20, 0, 0))?.title).toBe("A");
    // Jan7 evening: A's period is over, next covered shift is Jan8 (B).
    expect(windowedNext(layer, jan(7, 20, 0, 0))?.title).toBe("B");
  });

  test("non-gap resolution: during/before the window returns the CURRENT day's user", () => {
    const layer: LayerProps = makeLayer({
      users: ["A", "B"],
      intervalType: EventInterval.Day,
      intervalCount: 1,
      restriction: dailyLocal(9, 0, 17, 0),
      start: MON_JAN6,
    });
    expect(windowedNext(layer, jan(6, 8, 0, 0))?.title).toBe("A"); // before open
    expect(windowedNext(layer, jan(6, 12, 0, 0))?.title).toBe("A"); // inside
    expect(windowedNext(layer, jan(7, 12, 0, 0))?.title).toBe("B"); // inside next day
  });
});

/*
 * ===========================================================================
 * GROUP I - DST spring-forward & fall-back + server-vs-schedule divergence
 * ===========================================================================
 */

describe("DST wall-clock stability (America/New_York, schedule zone)", () => {
  test("09:00-17:00 stays 09:00-17:00 across the spring-forward week (Sun 2026-03-08)", () => {
    const start: Date = tzInstant("2026-03-06 00:00", NY); // Fri
    const layer: LayerProps = {
      users: [user("A")],
      startDateTimeOfLayer: start,
      handOffTime: start,
      restrictionTimes: dailyTz("2026-03-06 09:00", "2026-03-06 17:00", NY),
      rotation: rotationOf(EventInterval.Day, 1),
      timezone: NY,
    };
    const ev: Array<CalendarEvent> = expand(
      layer,
      start,
      tzInstant("2026-03-12 00:00", NY),
    );
    const opens: Array<CalendarEvent> = ev.filter((e: CalendarEvent) => {
      return hhmm(e.start, NY) === "09:00";
    });
    expect(opens.length).toBeGreaterThanOrEqual(5); // Fri..Wed
    for (const w of opens) {
      expect(hhmm(w.start, NY)).toBe("09:00");
      expect(hhmm(w.end, NY)).toBe("17:00");
    }
    // Concrete coverage on the DST-transition Sunday.
    expect(coveringTitle(ev, tzInstant("2026-03-08 12:00", NY))).toBe("A");
    expect(coveringTitle(ev, tzInstant("2026-03-08 08:00", NY))).toBeNull();
    expect(coveringTitle(ev, tzInstant("2026-03-08 18:00", NY))).toBeNull();
  });

  test("09:00-17:00 stays 09:00-17:00 across the fall-back week (Sun 2026-11-01)", () => {
    const start: Date = tzInstant("2026-10-30 00:00", NY); // Fri
    const layer: LayerProps = {
      users: [user("A")],
      startDateTimeOfLayer: start,
      handOffTime: start,
      restrictionTimes: dailyTz("2026-10-30 09:00", "2026-10-30 17:00", NY),
      rotation: rotationOf(EventInterval.Day, 1),
      timezone: NY,
    };
    const ev: Array<CalendarEvent> = expand(
      layer,
      start,
      tzInstant("2026-11-04 00:00", NY),
    );
    const opens: Array<CalendarEvent> = ev.filter((e: CalendarEvent) => {
      return hhmm(e.start, NY) === "09:00";
    });
    expect(opens.length).toBeGreaterThanOrEqual(5);
    for (const w of opens) {
      expect(hhmm(w.end, NY)).toBe("17:00");
    }
    expect(coveringTitle(ev, tzInstant("2026-11-01 12:00", NY))).toBe("A");
    expect(coveringTitle(ev, tzInstant("2026-11-01 08:00", NY))).toBeNull();
  });

  test("overnight 22:00-06:00 keeps its wall-clock band across spring-forward", () => {
    const start: Date = tzInstant("2026-03-06 00:00", NY);
    const layer: LayerProps = {
      users: [user("A")],
      startDateTimeOfLayer: start,
      handOffTime: start,
      restrictionTimes: dailyTz("2026-03-06 22:00", "2026-03-06 06:00", NY),
      rotation: rotationOf(EventInterval.Day, 1),
      timezone: NY,
    };
    const ev: Array<CalendarEvent> = expand(
      layer,
      start,
      tzInstant("2026-03-10 00:00", NY),
    );
    // Morning tails close at 06:00 NY, nights open at 22:00 NY.
    const mornings: Array<CalendarEvent> = ev.filter((e: CalendarEvent) => {
      return hhmm(e.start, NY) === "00:00";
    });
    const nights: Array<CalendarEvent> = ev.filter((e: CalendarEvent) => {
      return hhmm(e.start, NY) === "22:00";
    });
    expect(mornings.length).toBeGreaterThanOrEqual(3);
    expect(nights.length).toBeGreaterThanOrEqual(3);
    for (const m of mornings) {
      expect(hhmm(m.end, NY)).toBe("06:00");
    }
    // Coverage on the DST Sunday: 03:00 NY (morning) covered, midday uncovered.
    expect(coveringTitle(ev, tzInstant("2026-03-08 03:00", NY))).toBe("A");
    expect(coveringTitle(ev, tzInstant("2026-03-07 23:00", NY))).toBe("A");
    expect(coveringTitle(ev, tzInstant("2026-03-08 12:00", NY))).toBeNull();
  });

  test("server-vs-schedule divergence: a Kolkata schedule resolves to its own wall-clock", () => {
    // Authored + resolved in Asia/Kolkata (UTC+5:30, no DST); process zone differs.
    const start: Date = tzInstant("2026-02-16 00:00", KOLKATA);
    const layer: LayerProps = {
      users: [user("A")],
      startDateTimeOfLayer: start,
      handOffTime: start,
      restrictionTimes: dailyTz(
        "2026-02-16 09:30",
        "2026-02-16 18:30",
        KOLKATA,
      ),
      rotation: rotationOf(EventInterval.Day, 1),
      timezone: KOLKATA,
    };
    const ev: Array<CalendarEvent> = expand(
      layer,
      start,
      tzInstant("2026-02-19 00:00", KOLKATA),
    );
    const opens: Array<CalendarEvent> = ev.filter((e: CalendarEvent) => {
      return hhmm(e.start, KOLKATA) === "09:30";
    });
    expect(opens.length).toBeGreaterThanOrEqual(2);
    for (const w of opens) {
      expect(hhmm(w.end, KOLKATA)).toBe("18:30");
    }
    expect(coveringTitle(ev, tzInstant("2026-02-17 12:00", KOLKATA))).toBe("A");
    expect(
      coveringTitle(ev, tzInstant("2026-02-17 08:00", KOLKATA)),
    ).toBeNull();
    expect(
      coveringTitle(ev, tzInstant("2026-02-17 20:00", KOLKATA)),
    ).toBeNull();
  });
});

/*
 * ===========================================================================
 * GROUP J - exhaustive matrix of same-day window placements
 * ===========================================================================
 */

describe("Exhaustive same-day window placements (local, daily rotation)", () => {
  const windows: Array<[number, number]> = [
    [1, 5],
    [6, 10],
    [8, 12],
    [9, 17],
    [10, 14],
    [13, 20],
    [19, 23],
  ];

  for (const [sh, eh] of windows) {
    test(`${sh}:00-${eh}:00 covers its band and excludes the shoulders`, () => {
      const layer: LayerProps = makeLayer({
        users: ["A"],
        intervalType: EventInterval.Day,
        intervalCount: 1,
        restriction: dailyLocal(sh, 0, eh, 0),
        start: MON_JAN6,
      });
      const ev: Array<CalendarEvent> = expand(layer, MON_JAN6, jan(9, 0, 0, 0));
      for (const d of [6, 7, 8]) {
        const mid: number = Math.floor((sh + eh) / 2);
        expect(coveringTitle(ev, jan(d, mid, 30, 0))).toBe("A"); // inside
        expect(coveringTitle(ev, jan(d, sh, 0, 1))).toBe("A"); // just after open
        expect(coveringTitle(ev, jan(d, eh, 0, 1))).toBeNull(); // just after close
        expect(coveringTitle(ev, jan(d, sh - 1, 30, 0))).toBeNull(); // before open
      }
    });
  }
});
