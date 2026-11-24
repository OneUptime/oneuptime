import RollingHistogram, {
  EMPTY_ROLLING_SUMMARY,
  RollingCount,
  RollingSummary,
  readClock,
} from "../../../Server/Utils/RollingHistogram";
import { seededRandom, SeededRandom } from "../../Helpers/SeededRandom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The distribution of the last few seconds, in constant memory, that the
 * probe scheduling metrics report (issue #10819): what goes in each second,
 * what a read merges, what falls out of the window, and how close a
 * percentile read off the buckets comes to the real one.
 */

const BOUNDS: Array<number> = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000];

// A clock the test moves by hand.
function clockAt(startMs: number): {
  now: () => number;
  move: (ms: number) => void;
} {
  let current: number = startMs;
  return {
    now: (): number => {
      return current;
    },
    move: (ms: number): void => {
      current += ms;
    },
  };
}

describe("RollingHistogram", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test("an empty window says so", () => {
    const histogram: RollingHistogram = new RollingHistogram({
      bucketBounds: BOUNDS,
      windowSeconds: 60,
    });
    expect(histogram.summary()).toEqual(EMPTY_ROLLING_SUMMARY);
  });

  test("counts, means and the largest value are exact", () => {
    const clock: { now: () => number; move: (ms: number) => void } =
      clockAt(1_000_000);
    const histogram: RollingHistogram = new RollingHistogram({
      bucketBounds: BOUNDS,
      windowSeconds: 60,
      now: clock.now,
    });

    for (const value of [3, 7, 40, 400]) {
      histogram.record(value);
      clock.move(1000);
    }

    const summary: RollingSummary = histogram.summary();
    expect(summary.count).toBe(4);
    expect(summary.mean).toBe(112.5);
    expect(summary.max).toBe(400);
  });

  test("a percentile is the bound of the bucket its rank falls in, never past the largest value", () => {
    const clock: { now: () => number; move: (ms: number) => void } =
      clockAt(5_000_000);
    const histogram: RollingHistogram = new RollingHistogram({
      bucketBounds: BOUNDS,
      windowSeconds: 60,
      now: clock.now,
    });

    // 90 fast values and 10 slow ones.
    for (let index: number = 0; index < 90; index++) {
      histogram.record(4);
    }
    for (let index: number = 0; index < 10; index++) {
      histogram.record(300);
    }

    const summary: RollingSummary = histogram.summary();
    expect(summary.p50).toBe(5);
    // Rank 95 of 100 is a slow one: its bucket ends at 500, the largest is 300.
    expect(summary.p95).toBe(300);
    expect(summary.p99).toBe(300);
  });

  test("a value past the last bound is read as the largest value seen", () => {
    const histogram: RollingHistogram = new RollingHistogram({
      bucketBounds: [10, 20],
      windowSeconds: 60,
      now: clockAt(0).now,
    });
    histogram.record(5);
    histogram.record(75_000);
    expect(histogram.summary()).toMatchObject({
      p50: 10,
      p99: 75_000,
      max: 75_000,
    });
  });

  test("values older than the window fall out, second by second", () => {
    const clock: { now: () => number; move: (ms: number) => void } =
      clockAt(10_000_000);
    const histogram: RollingHistogram = new RollingHistogram({
      bucketBounds: BOUNDS,
      windowSeconds: 10,
      now: clock.now,
    });

    histogram.record(900);
    clock.move(5000);
    histogram.record(2);
    expect(histogram.summary()).toMatchObject({ count: 2, max: 900 });

    // The first value's second leaves the window; the second's is still in.
    clock.move(5000);
    expect(histogram.summary()).toMatchObject({ count: 1, max: 2 });

    clock.move(10_000);
    expect(histogram.summary()).toEqual(EMPTY_ROLLING_SUMMARY);
  });

  test("a second's slot is reused round the ring, never added to an old second's", () => {
    const clock: { now: () => number; move: (ms: number) => void } =
      clockAt(20_000_000);
    const histogram: RollingHistogram = new RollingHistogram({
      bucketBounds: BOUNDS,
      windowSeconds: 3,
      now: clock.now,
    });

    histogram.record(1000);
    // Exactly one ring later: the same slot, a new second.
    clock.move(3000);
    histogram.record(1);

    expect(histogram.summary()).toMatchObject({ count: 1, max: 1 });
  });

  test("ignores values that are not numbers, and reads a negative one as 0", () => {
    const histogram: RollingHistogram = new RollingHistogram({
      bucketBounds: BOUNDS,
      windowSeconds: 60,
      now: clockAt(0).now,
    });
    histogram.record(Number.NaN);
    histogram.record(Infinity);
    histogram.record(-5);
    expect(histogram.summary()).toMatchObject({ count: 1, max: 0, p50: 0 });
  });

  test("bounds given out of order are sorted", () => {
    const histogram: RollingHistogram = new RollingHistogram({
      bucketBounds: [100, 1, 10],
      windowSeconds: 60,
      now: clockAt(0).now,
    });
    histogram.record(7);
    expect(histogram.summary().p50).toBe(7);
  });

  test("its percentiles stay within a bucket of the real ones, over many values", () => {
    const random: SeededRandom = seededRandom(10819);
    const clock: { now: () => number; move: (ms: number) => void } =
      clockAt(30_000_000);
    const histogram: RollingHistogram = new RollingHistogram({
      bucketBounds: BOUNDS,
      windowSeconds: 60,
      now: clock.now,
    });
    const values: Array<number> = [];

    for (let index: number = 0; index < 20_000; index++) {
      // Mostly fast, with a long tail.
      const value: number = random() < 0.9 ? random() * 20 : random() * 900;
      values.push(value);
      histogram.record(value);

      if (index % 500 === 0) {
        clock.move(1000);
      }
    }

    values.sort((a: number, b: number): number => {
      return a - b;
    });
    const real: (fraction: number) => number = (fraction: number): number => {
      return values[Math.ceil(values.length * fraction) - 1]!;
    };
    const bucketBound: (value: number) => number = (value: number): number => {
      return BOUNDS.find((bound: number): boolean => {
        return value <= bound;
      })!;
    };
    const summary: RollingSummary = histogram.summary();

    for (const [fraction, read] of [
      [0.5, summary.p50],
      [0.95, summary.p95],
      [0.99, summary.p99],
    ] as Array<[number, number]>) {
      expect(read).toBeGreaterThanOrEqual(real(fraction));
      expect(read).toBeLessThanOrEqual(bucketBound(real(fraction)));
    }
  });

  test("the clock is read when it is called, so a fake clock installed later is the clock", () => {
    jest.useFakeTimers({ now: 42_000 });
    expect(readClock()).toBe(42_000);
    jest.setSystemTime(43_500);
    expect(readClock()).toBe(43_500);
  });
});

describe("RollingCount", () => {
  test("adds what happened in the window, and forgets what fell out of it", () => {
    const clock: { now: () => number; move: (ms: number) => void } =
      clockAt(40_000_000);
    const count: RollingCount = new RollingCount({
      windowSeconds: 60,
      now: clock.now,
    });

    count.add();
    count.add(4);
    clock.move(30_000);
    count.add(2);
    expect(count.total()).toBe(7);

    clock.move(30_000);
    expect(count.total()).toBe(2);

    clock.move(30_000);
    expect(count.total()).toBe(0);
  });

  test("ignores counts that are not above 0", () => {
    const count: RollingCount = new RollingCount({
      windowSeconds: 60,
      now: clockAt(0).now,
    });
    count.add(0);
    count.add(-3);
    count.add(Number.NaN);
    expect(count.total()).toBe(0);
  });
});
