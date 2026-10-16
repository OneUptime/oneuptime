import WindowCoverage, {
  WindowCoverageResult,
  WindowCoverageShortfall,
} from "../../../../../Server/Utils/Monitor/Criteria/WindowCoverage";
import { SeededRandom, seededRandom } from "../../../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * WindowCoverage is the one rule behind "All Values over the last N
 * minutes": the readings must reach from the window's start to its end.
 * Probe monitors (EvaluateOverTime) judge its two edges; metric monitors
 * (MetricWindowCoverage) judge holes between readings as well. Everything
 * here is plain numbers on a fixed clock - the rule never reads the time.
 */

const MINUTE: number = 60_000;
const SECOND: number = 1000;

// A 15-minute window ending at 12:15:00.
const WINDOW_END: number = Date.UTC(2026, 9, 16, 12, 15, 0);
const WINDOW_START: number = WINDOW_END - 15 * MINUTE;

// Minute marks from `fromMinute` to `toMinute` (inclusive) after the start.
function minutes(fromMinute: number, toMinute: number): Array<number> {
  const times: Array<number> = [];
  for (let minute: number = fromMinute; minute <= toMinute; minute++) {
    times.push(WINDOW_START + minute * MINUTE);
  }
  return times;
}

// A metric series: one-minute data points, holes counting.
function judgeBuckets(readingTimesMs: Array<number>): WindowCoverageResult {
  return WindowCoverage.judge({
    windowStartMs: WINDOW_START,
    windowEndMs: WINDOW_END,
    readingTimesMs: readingTimesMs,
    intervalMs: MINUTE,
    readingSpanMs: MINUTE,
    holesBreakCoverage: true,
  });
}

// A probe monitor checked every minute: instants, only the edges count.
function judgeChecks(readingTimesMs: Array<number>): WindowCoverageResult {
  return WindowCoverage.judge({
    windowStartMs: WINDOW_START,
    windowEndMs: WINDOW_END,
    readingTimesMs: readingTimesMs,
    intervalMs: MINUTE,
  });
}

describe("WindowCoverage.judge", () => {
  describe("a window that is covered", () => {
    test("one data point a minute from the start to the end", () => {
      const result: WindowCoverageResult = judgeBuckets(minutes(0, 14));

      expect(result.isCovered).toBe(true);
      expect(result.shortfall).toBeNull();
      expect(result.allowedGapMs).toBe(1.5 * MINUTE);
      expect(result.runStartMs).toBe(WINDOW_START);
      expect(result.runEndMs).toBe(WINDOW_END);
      expect(result.holeBeforeRunMs).toBeNull();
      expect(result.sinceNewestReadingMs).toBe(0);
    });

    test("data points from before the window count from its start", () => {
      const result: WindowCoverageResult = judgeBuckets(minutes(-5, 14));

      expect(result.isCovered).toBe(true);
      expect(result.runStartMs).toBe(WINDOW_START);
    });

    test("a newest data point that lags one bucket is still fresh", () => {
      // The 12:14 bucket ends at 12:15; the 12:13 one ends a minute before.
      expect(judgeBuckets(minutes(0, 13)).isCovered).toBe(true);
    });

    test("a data point dated slightly in the future is fresh, not a gap", () => {
      expect(
        judgeBuckets([...minutes(0, 14), WINDOW_END + 5 * SECOND]),
      ).toEqual(
        expect.objectContaining({ isCovered: true, sinceNewestReadingMs: 0 }),
      );
    });

    test("order and duplicates do not matter; unreadable times are dropped", () => {
      const times: Array<number> = minutes(0, 14);
      const shuffled: Array<number> = [
        ...times.slice(7),
        NaN,
        ...times.slice(0, 7),
        times[3]!,
        Number.POSITIVE_INFINITY,
      ];

      expect(judgeBuckets(shuffled).isCovered).toBe(true);
    });
  });

  describe("a window that starts late - a new series", () => {
    test("one data point never covers a 15-minute window", () => {
      const result: WindowCoverageResult = judgeBuckets(minutes(14, 14));

      expect(result.isCovered).toBe(false);
      expect(result.shortfall).toBe(WindowCoverageShortfall.StartsLate);
      expect(result.runStartMs).toBe(WINDOW_START + 14 * MINUTE);
      expect(result.runEndMs).toBe(WINDOW_END);
    });

    test("2, 5, 10 and 13 minutes of data do not cover it either", () => {
      for (const firstMinute of [13, 10, 5, 2]) {
        expect({
          firstMinute,
          shortfall: judgeBuckets(minutes(firstMinute, 14)).shortfall,
        }).toEqual({
          firstMinute,
          shortfall: WindowCoverageShortfall.StartsLate,
        });
      }
    });

    /*
     * The resolution of the rule is the data's own: a first data point up
     * to one and a half intervals after the start still counts, so a
     * window that starts mid-cycle - or a point a few seconds late - never
     * flips a long-standing series to "not covered".
     */
    test("the leading allowance is exactly one and a half intervals", () => {
      expect(
        judgeBuckets([WINDOW_START + 90 * SECOND, ...minutes(2, 14)]).isCovered,
      ).toBe(true);
      expect(
        judgeBuckets([WINDOW_START + 91 * SECOND, ...minutes(2, 14)]).shortfall,
      ).toBe(WindowCoverageShortfall.StartsLate);
    });
  });

  describe("a window with a hole", () => {
    test("one missing data point is bridged", () => {
      const times: Array<number> = minutes(0, 14).filter((time: number) => {
        return time !== WINDOW_START + 7 * MINUTE;
      });

      expect(judgeBuckets(times).isCovered).toBe(true);
    });

    test("two missing data points in a row break it, and the run starts after them", () => {
      const times: Array<number> = minutes(0, 14).filter((time: number) => {
        return (
          time !== WINDOW_START + 7 * MINUTE &&
          time !== WINDOW_START + 8 * MINUTE
        );
      });

      const result: WindowCoverageResult = judgeBuckets(times);

      expect(result.isCovered).toBe(false);
      expect(result.shortfall).toBe(WindowCoverageShortfall.Hole);
      expect(result.holeBeforeRunMs).toBe(2 * MINUTE);
      expect(result.runStartMs).toBe(WINDOW_START + 9 * MINUTE);
      expect(result.runEndMs).toBe(WINDOW_END);
    });

    test("the newest hole is the one that cuts the run", () => {
      const times: Array<number> = [
        ...minutes(0, 2),
        // a 3-minute hole
        ...minutes(6, 8),
        // a 4-minute hole
        ...minutes(13, 14),
      ];

      const result: WindowCoverageResult = judgeBuckets(times);

      expect(result.shortfall).toBe(WindowCoverageShortfall.Hole);
      expect(result.holeBeforeRunMs).toBe(4 * MINUTE);
      expect(result.runStartMs).toBe(WINDOW_START + 13 * MINUTE);
    });

    test("a hole before the window's start says nothing about the window", () => {
      const result: WindowCoverageResult = judgeBuckets([
        ...minutes(-9, -6),
        // a 4-minute hole, all of it before the window
        ...minutes(-1, 14),
      ]);

      expect(result.isCovered).toBe(true);
      expect(result.holeBeforeRunMs).toBeNull();
      expect(result.runStartMs).toBe(WINDOW_START);
    });

    test("but a hole that reaches into the window does", () => {
      const result: WindowCoverageResult = judgeBuckets([
        ...minutes(-9, -3),
        ...minutes(1, 14),
      ]);

      expect(result.shortfall).toBe(WindowCoverageShortfall.Hole);
      expect(result.holeBeforeRunMs).toBe(3 * MINUTE);
    });

    test("probe checks judge only the edges: a hole between two checks is not looked at", () => {
      const result: WindowCoverageResult = judgeChecks([
        ...minutes(0, 2),
        ...minutes(10, 15),
      ]);

      expect(result.isCovered).toBe(true);
      expect(result.holeBeforeRunMs).toBeNull();
    });
  });

  describe("a stale window", () => {
    test("data that stopped part way through does not cover the window", () => {
      const result: WindowCoverageResult = judgeBuckets(minutes(0, 10));

      expect(result.isCovered).toBe(false);
      expect(result.shortfall).toBe(WindowCoverageShortfall.Stale);
      expect(result.sinceNewestReadingMs).toBe(4 * MINUTE);
    });

    test("the trailing allowance is exactly one and a half intervals", () => {
      // The newest bucket ends 90 s before the window does: still fresh.
      expect(
        judgeBuckets([...minutes(0, 12), WINDOW_END - 150 * SECOND]).isCovered,
      ).toBe(true);
      expect(
        judgeBuckets([...minutes(0, 12), WINDOW_END - 151 * SECOND]).shortfall,
      ).toBe(WindowCoverageShortfall.Stale);
    });

    test("a stale window is called stale before it is called anything else", () => {
      const result: WindowCoverageResult = judgeBuckets([
        ...minutes(5, 6),
        ...minutes(9, 10),
      ]);

      expect(result.shortfall).toBe(WindowCoverageShortfall.Stale);
    });

    test("a hole is called before a late start", () => {
      const result: WindowCoverageResult = judgeBuckets([
        ...minutes(5, 6),
        ...minutes(9, 14),
      ]);

      expect(result.shortfall).toBe(WindowCoverageShortfall.Hole);
    });
  });

  describe("no readings", () => {
    test("is never covered", () => {
      expect(judgeBuckets([])).toEqual({
        isCovered: false,
        shortfall: WindowCoverageShortfall.NoReadings,
        allowedGapMs: 1.5 * MINUTE,
        runStartMs: null,
        runEndMs: null,
        holeBeforeRunMs: null,
        sinceNewestReadingMs: null,
      });
    });

    test("nor are readings none of which can be read", () => {
      expect(judgeBuckets([NaN, Number.NaN]).shortfall).toBe(
        WindowCoverageShortfall.NoReadings,
      );
    });
  });

  describe("the cadence it is measured against", () => {
    test("a series reporting every 5 minutes covers 15 minutes with three points", () => {
      const result: WindowCoverageResult = WindowCoverage.judge({
        windowStartMs: WINDOW_START,
        windowEndMs: WINDOW_END,
        readingTimesMs: [
          WINDOW_START + 2 * MINUTE,
          WINDOW_START + 7 * MINUTE,
          WINDOW_START + 12 * MINUTE,
        ],
        intervalMs: 5 * MINUTE,
        readingSpanMs: MINUTE,
        holesBreakCoverage: true,
      });

      expect(result.isCovered).toBe(true);
      expect(result.allowedGapMs).toBe(7.5 * MINUTE);
    });

    test("a negative interval counts as none: every gap is too wide", () => {
      expect(
        WindowCoverage.judge({
          windowStartMs: WINDOW_START,
          windowEndMs: WINDOW_END,
          readingTimesMs: [WINDOW_START + SECOND, WINDOW_END - SECOND],
          intervalMs: -MINUTE,
        }).isCovered,
      ).toBe(false);
    });
  });

  /*
   * EvaluateOverTime used to carry this rule inline: covered when the
   * oldest sample is at most 1.5 intervals after the start and the newest
   * at most 1.5 intervals before the end. WindowCoverage took it over; for
   * instants with no holes counting it must answer exactly the same, for
   * any samples at all.
   */
  test("for probe checks it answers exactly as EvaluateOverTime's own rule did", () => {
    const random: SeededRandom = seededRandom(4793);

    for (let round: number = 0; round < 2000; round++) {
      const intervalMs: number = (1 + random(10)) * MINUTE;
      const windowMs: number = (1 + random(60)) * MINUTE;
      const startMs: number = WINDOW_END - windowMs;
      const count: number = 1 + random(12);
      const times: Array<number> = [];

      for (let index: number = 0; index < count; index++) {
        // Anywhere from a little before the window to a little after it.
        times.push(
          startMs - 2 * intervalMs + random() * (windowMs + 4 * intervalMs),
        );
      }

      const sorted: Array<number> = [...times].sort((a: number, b: number) => {
        return a - b;
      });
      const allowedMs: number = intervalMs * 1.5;
      const before: boolean =
        sorted[0]! - startMs <= allowedMs &&
        WINDOW_END - sorted[sorted.length - 1]! <= allowedMs;

      expect({
        round,
        covered: WindowCoverage.judge({
          windowStartMs: startMs,
          windowEndMs: WINDOW_END,
          readingTimesMs: times,
          intervalMs: intervalMs,
        }).isCovered,
      }).toEqual({ round, covered: before });
    }
  });
});

describe("WindowCoverage.getTypicalIntervalMs", () => {
  test("is the gap between readings most of the time", () => {
    expect(WindowCoverage.getTypicalIntervalMs(minutes(0, 14))).toBe(MINUTE);
  });

  test("is not moved by one wide hole", () => {
    expect(
      WindowCoverage.getTypicalIntervalMs([
        ...minutes(0, 5),
        ...minutes(12, 14),
      ]),
    ).toBe(MINUTE);
  });

  test("is the lower median, so a hole and a beat cannot tie it upwards", () => {
    // Gaps: 1, 1, 5, 5 minutes.
    expect(
      WindowCoverage.getTypicalIntervalMs([
        WINDOW_START,
        WINDOW_START + MINUTE,
        WINDOW_START + 2 * MINUTE,
        WINDOW_START + 7 * MINUTE,
        WINDOW_START + 12 * MINUTE,
      ]),
    ).toBe(MINUTE);
  });

  test("leaves out readings taken at the same moment, in any order", () => {
    expect(
      WindowCoverage.getTypicalIntervalMs([
        WINDOW_START + 10 * MINUTE,
        WINDOW_START,
        WINDOW_START,
        WINDOW_START + 5 * MINUTE,
        WINDOW_START + 5 * MINUTE,
      ]),
    ).toBe(5 * MINUTE);
  });

  test("is null without two readings apart", () => {
    expect(WindowCoverage.getTypicalIntervalMs([])).toBeNull();
    expect(WindowCoverage.getTypicalIntervalMs([WINDOW_START])).toBeNull();
    expect(
      WindowCoverage.getTypicalIntervalMs([WINDOW_START, WINDOW_START, NaN]),
    ).toBeNull();
  });
});
