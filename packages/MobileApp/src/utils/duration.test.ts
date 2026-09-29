import { describe, expect, test } from "@jest/globals";
import {
  formatDuration,
  formatShiftTime,
  formatShiftWindow,
  formatTimeUntil,
  millisecondsUntil,
  toTimestamp,
} from "./duration";

/*
 * These formatters are what an on-call countdown is made of, so the cases
 * below are the ones where a wrong answer changes a decision: the boundary
 * where a shift is ending, a handoff the server has not recomputed yet, and a
 * roster field that is simply absent.
 *
 * Every date is built from LOCAL components (new Date(y, m, d, h, min)) so the
 * expectations hold in any timezone the suite happens to run in - the app
 * renders wall-clock times, and a test that only passes in UTC is a test that
 * fails for half the contributors.
 */

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

describe("formatDuration", () => {
  test("never shows more than two units", () => {
    expect(formatDuration(2 * DAY + 4 * HOUR + 33 * MINUTE)).toBe("2d 4h");
    expect(formatDuration(3 * HOUR + 12 * MINUTE + 45 * 1000)).toBe("3h 12m");
  });

  test("drops the smaller unit when it is zero", () => {
    expect(formatDuration(3 * HOUR)).toBe("3h");
    expect(formatDuration(2 * DAY)).toBe("2d");
  });

  test("renders minutes below an hour", () => {
    expect(formatDuration(45 * MINUTE)).toBe("45m");
    expect(formatDuration(MINUTE)).toBe("1m");
  });

  test("sub-minute spans are '<1m', not '0m'", () => {
    /*
     * At a handoff boundary these two say opposite things: "<1m" means you are
     * still holding the phone, "0m" reads as already off.
     */
    expect(formatDuration(59 * 1000)).toBe("<1m");
    expect(formatDuration(1)).toBe("<1m");
  });

  test("zero and negative spans collapse to 0m rather than counting backwards", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(-5 * HOUR)).toBe("0m");
  });

  test("a non-finite span does not leak NaN into the UI", () => {
    expect(formatDuration(Number.NaN)).toBe("0m");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("0m");
  });
});

describe("toTimestamp", () => {
  test("returns null for the nulls the roster fields actually carry", () => {
    expect(toTimestamp(null)).toBeNull();
    expect(toTimestamp(undefined)).toBeNull();
    expect(toTimestamp("")).toBeNull();
  });

  test("returns null for an unparseable string instead of NaN", () => {
    expect(toTimestamp("not a date")).toBeNull();
  });

  test("parses an ISO timestamp", () => {
    const date: Date = new Date(2026, 2, 3, 9, 0, 0, 0);
    expect(toTimestamp(date.toISOString())).toBe(date.getTime());
  });
});

describe("formatTimeUntil", () => {
  const now: number = new Date(2026, 2, 3, 12, 0, 0, 0).getTime();

  test("phrases the future with 'in'", () => {
    expect(formatTimeUntil(new Date(now + 3 * HOUR).toISOString(), now)).toBe(
      "in 3h",
    );
  });

  test("phrases the past with 'ago'", () => {
    expect(
      formatTimeUntil(new Date(now - 90 * MINUTE).toISOString(), now),
    ).toBe("1h 30m ago");
  });

  test("collapses the current minute to 'now' on both sides", () => {
    expect(formatTimeUntil(new Date(now + 20 * 1000).toISOString(), now)).toBe(
      "now",
    );
    expect(formatTimeUntil(new Date(now - 20 * 1000).toISOString(), now)).toBe(
      "now",
    );
  });

  test("returns null - not a placeholder - for a missing timestamp", () => {
    /*
     * The caller decides what an absent handoff should say. A formatter that
     * invented "unknown" here would put that string in three different screens
     * that each wanted to say something else.
     */
    expect(formatTimeUntil(null, now)).toBeNull();
  });
});

describe("millisecondsUntil", () => {
  const now: number = new Date(2026, 2, 3, 12, 0, 0, 0).getTime();

  test("measures forward to a future boundary", () => {
    expect(millisecondsUntil(new Date(now + 2 * HOUR).toISOString(), now)).toBe(
      2 * HOUR,
    );
  });

  test("clamps a passed handoff at zero rather than running negative", () => {
    /*
     * The roster is recomputed by a worker, so a handoff can be minutes in the
     * past while the schedule row still says the responder is on. A negative
     * countdown would render as a duration growing the wrong way.
     */
    expect(millisecondsUntil(new Date(now - HOUR).toISOString(), now)).toBe(0);
  });

  test("returns null for a schedule with no computed roster", () => {
    expect(millisecondsUntil(null, now)).toBeNull();
  });
});

describe("formatShiftTime", () => {
  const now: number = new Date(2026, 2, 3, 12, 0, 0, 0).getTime();

  test("anchors today, tomorrow and yesterday by name", () => {
    expect(
      formatShiftTime(new Date(2026, 2, 3, 18, 0).toISOString(), now),
    ).toBe("Today 6:00 PM");
    expect(formatShiftTime(new Date(2026, 2, 4, 9, 0).toISOString(), now)).toBe(
      "Tomorrow 9:00 AM",
    );
    expect(formatShiftTime(new Date(2026, 2, 2, 9, 0).toISOString(), now)).toBe(
      "Yesterday 9:00 AM",
    );
  });

  test("uses the weekday inside the coming week", () => {
    // 2026-03-06 is a Friday.
    expect(
      formatShiftTime(new Date(2026, 2, 6, 9, 30).toISOString(), now),
    ).toBe("Fri 9:30 AM");
  });

  test("falls back to a date beyond a week out", () => {
    /*
     * "Tue" a fortnight away is a trap - the reader assumes the nearer Tuesday.
     */
    expect(
      formatShiftTime(new Date(2026, 2, 20, 9, 0).toISOString(), now),
    ).toBe("20 Mar, 9:00 AM");
  });

  test("renders midnight and noon as 12, not 0", () => {
    expect(formatShiftTime(new Date(2026, 2, 3, 0, 5).toISOString(), now)).toBe(
      "Today 12:05 AM",
    );
    expect(
      formatShiftTime(new Date(2026, 2, 3, 12, 0).toISOString(), now),
    ).toBe("Today 12:00 PM");
  });

  test("returns null for a missing timestamp", () => {
    expect(formatShiftTime(undefined, now)).toBeNull();
  });
});

describe("formatShiftWindow", () => {
  const now: number = new Date(2026, 2, 3, 12, 0, 0, 0).getTime();

  test("renders both ends when both are known", () => {
    expect(
      formatShiftWindow(
        new Date(2026, 2, 3, 9, 0).toISOString(),
        new Date(2026, 2, 4, 9, 0).toISOString(),
        now,
      ),
    ).toBe("Today 9:00 AM → Tomorrow 9:00 AM");
  });

  test("renders the half it has when a rotation has no computed handoff", () => {
    expect(
      formatShiftWindow(new Date(2026, 2, 3, 9, 0).toISOString(), null, now),
    ).toBe("From Today 9:00 AM");

    expect(
      formatShiftWindow(null, new Date(2026, 2, 4, 9, 0).toISOString(), now),
    ).toBe("Until Tomorrow 9:00 AM");
  });

  test("returns null when neither end is known", () => {
    expect(formatShiftWindow(null, null, now)).toBeNull();
  });
});
