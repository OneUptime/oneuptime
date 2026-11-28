import { describe, expect, test } from "@jest/globals";
import ProbeFetchMoments from "../../../Utils/Probe/ProbeFetchMoments";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * WHEN A PROBE'S WORKERS ASK FOR THEIR MONITORS (issue #11333).
 *
 * Each worker asks at its own moment of the minute, the same moment every
 * minute, so a monitor checked every minute is checked a minute apart; a
 * probe's workers are spread evenly over the first 45 s, its first at a
 * moment drawn once as it starts. Before, each worker drew a new random
 * second every minute: a one-minute monitor's checks were 15 to 105 s apart.
 */

const SPREAD_MS: number = 45 * 1000;
const MINUTE_MS: number = 60 * 1000;

describe("ProbeFetchMoments.getWorkerOffsetsMs", () => {
  test("one worker asks at the moment drawn for the probe, within the spread", () => {
    expect(
      ProbeFetchMoments.getWorkerOffsetsMs({
        workers: 1,
        spreadMs: SPREAD_MS,
        random: 0,
      }),
    ).toEqual([0]);
    expect(
      ProbeFetchMoments.getWorkerOffsetsMs({
        workers: 1,
        spreadMs: SPREAD_MS,
        random: 0.5,
      }),
    ).toEqual([22500]);
    expect(
      ProbeFetchMoments.getWorkerOffsetsMs({
        workers: 1,
        spreadMs: SPREAD_MS,
        random: 0.9999999,
      })[0],
    ).toBeLessThan(SPREAD_MS);
  });

  test("Docker Compose's five workers: 9 s apart, the first in the first 9 s", () => {
    expect(
      ProbeFetchMoments.getWorkerOffsetsMs({
        workers: 5,
        spreadMs: SPREAD_MS,
        random: 0,
      }),
    ).toEqual([0, 9000, 18000, 27000, 36000]);
    expect(
      ProbeFetchMoments.getWorkerOffsetsMs({
        workers: 5,
        spreadMs: SPREAD_MS,
        random: 0.5,
      }),
    ).toEqual([4500, 13500, 22500, 31500, 40500]);
  });

  test("the Helm chart's three workers: 15 s apart", () => {
    expect(
      ProbeFetchMoments.getWorkerOffsetsMs({
        workers: 3,
        spreadMs: SPREAD_MS,
        random: 0.2,
      }),
    ).toEqual([3000, 18000, 33000]);
  });

  test("for any number of workers and any draw: one moment each, in order, evenly apart, all within the spread", () => {
    const random: SeededRandom = seededRandom(11333);

    for (let workers: number = 1; workers <= 64; workers++) {
      for (let draw: number = 0; draw < 25; draw++) {
        const offsets: Array<number> = ProbeFetchMoments.getWorkerOffsetsMs({
          workers,
          spreadMs: SPREAD_MS,
          random: random(1000000) / 1000000,
        });

        expect(offsets).toHaveLength(workers);

        for (let index: number = 0; index < workers; index++) {
          expect(offsets[index]).toBeGreaterThanOrEqual(0);
          expect(offsets[index]).toBeLessThan(SPREAD_MS);
          expect(Number.isInteger(offsets[index])).toBe(true);

          if (index > 0) {
            // A whole step apart, give or take the millisecond rounded off.
            const apart: number = offsets[index]! - offsets[index - 1]!;
            expect(Math.abs(apart - SPREAD_MS / workers)).toBeLessThanOrEqual(
              1,
            );
          }
        }
      }
    }
  });

  test("the same draw, the same moments: they never change while the probe runs", () => {
    const first: Array<number> = ProbeFetchMoments.getWorkerOffsetsMs({
      workers: 5,
      spreadMs: SPREAD_MS,
      random: 0.37,
    });

    for (let minute: number = 0; minute < 10; minute++) {
      expect(
        ProbeFetchMoments.getWorkerOffsetsMs({
          workers: 5,
          spreadMs: SPREAD_MS,
          random: 0.37,
        }),
      ).toEqual(first);
    }
  });

  test("two probes, or two replicas of one, each draw their own moments", () => {
    const one: Array<number> = ProbeFetchMoments.getWorkerOffsetsMs({
      workers: 3,
      spreadMs: SPREAD_MS,
      random: 0.1,
    });
    const other: Array<number> = ProbeFetchMoments.getWorkerOffsetsMs({
      workers: 3,
      spreadMs: SPREAD_MS,
      random: 0.6,
    });

    for (let index: number = 0; index < 3; index++) {
      expect(one[index]).not.toBe(other[index]);
    }
  });

  test("a setting it cannot read is one worker, and a draw outside [0, 1) the first moment", () => {
    for (const workers of [0, -3, Number.NaN]) {
      expect(
        ProbeFetchMoments.getWorkerOffsetsMs({
          workers,
          spreadMs: SPREAD_MS,
          random: 0.5,
        }),
      ).toEqual([22500]);
    }

    for (const random of [-0.1, 1, 2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        ProbeFetchMoments.getWorkerOffsetsMs({
          workers: 2,
          spreadMs: SPREAD_MS,
          random,
        }),
      ).toEqual([0, 22500]);
    }

    expect(
      ProbeFetchMoments.getWorkerOffsetsMs({
        workers: 2,
        spreadMs: -1,
        random: 0.5,
      }),
    ).toEqual([0, 0]);
  });
});

describe("ProbeFetchMoments.getWaitMs", () => {
  const minuteStart: number = Date.UTC(2026, 10, 27, 10, 1, 0);

  test("a tick at the minute's start waits until the worker's moment", () => {
    expect(
      ProbeFetchMoments.getWaitMs({ offsetMs: 13500, nowMs: minuteStart }),
    ).toBe(13500);
  });

  test("a tick that fired late waits the rest, so the worker still asks at its moment", () => {
    expect(
      ProbeFetchMoments.getWaitMs({
        offsetMs: 13500,
        nowMs: minuteStart + 850,
      }),
    ).toBe(12650);
    expect(
      minuteStart +
        850 +
        ProbeFetchMoments.getWaitMs({
          offsetMs: 13500,
          nowMs: minuteStart + 850,
        }),
    ).toBe(minuteStart + 13500);
  });

  test("every minute, the same moment of it", () => {
    for (let minute: number = 0; minute < 60; minute++) {
      const tickAt: number = minuteStart + minute * MINUTE_MS + (minute % 7);
      const asksAt: number =
        tickAt +
        ProbeFetchMoments.getWaitMs({ offsetMs: 31500, nowMs: tickAt });

      expect(asksAt).toBe(minuteStart + minute * MINUTE_MS + 31500);
    }
  });

  test("a worker whose moment has passed - a probe that just started - asks at once", () => {
    expect(
      ProbeFetchMoments.getWaitMs({
        offsetMs: 13500,
        nowMs: minuteStart + 50000,
      }),
    ).toBe(0);
    expect(
      ProbeFetchMoments.getWaitMs({
        offsetMs: 13500,
        nowMs: minuteStart + 13500,
      }),
    ).toBe(0);
  });

  test("a worker at the very start of the minute asks at once", () => {
    expect(
      ProbeFetchMoments.getWaitMs({ offsetMs: 0, nowMs: minuteStart + 3 }),
    ).toBe(0);
    expect(
      ProbeFetchMoments.getWaitMs({ offsetMs: 0, nowMs: minuteStart }),
    ).toBe(0);
  });

  test("never more than its moment, and never less than nothing", () => {
    const random: SeededRandom = seededRandom(11334);

    for (let draw: number = 0; draw < 2000; draw++) {
      const offsetMs: number = random(SPREAD_MS);
      const nowMs: number = minuteStart + random(MINUTE_MS);
      const waitMs: number = ProbeFetchMoments.getWaitMs({ offsetMs, nowMs });

      expect(waitMs).toBeGreaterThanOrEqual(0);
      expect(waitMs).toBeLessThanOrEqual(offsetMs);
    }
  });
});

/*
 * What the two ways put between a one-minute monitor's checks, one worker
 * each, checked as soon as it asks: a moment drawn once versus one drawn
 * every minute (the probe before #11333).
 */
describe("the time between a one-minute monitor's checks", () => {
  function gapsOf(asksAt: Array<number>): Array<number> {
    return asksAt.slice(1).map((at: number, index: number): number => {
      return at - asksAt[index]!;
    });
  }

  test("a moment drawn once: a minute, every time", () => {
    const random: SeededRandom = seededRandom(11333);
    const offsetMs: number = ProbeFetchMoments.getWorkerOffsetsMs({
      workers: 1,
      spreadMs: SPREAD_MS,
      random: random(1000000) / 1000000,
    })[0]!;

    const asksAt: Array<number> = [];

    for (let minute: number = 0; minute < 120; minute++) {
      const tickAt: number = minute * MINUTE_MS + random(900);
      asksAt.push(
        tickAt + ProbeFetchMoments.getWaitMs({ offsetMs, nowMs: tickAt }),
      );
    }

    for (const gap of gapsOf(asksAt)) {
      expect(gap).toBe(MINUTE_MS);
    }
  });

  test("before: a new moment every minute put them 15 to 105 s apart", () => {
    const random: SeededRandom = seededRandom(11333);
    const asksAt: Array<number> = [];

    for (let minute: number = 0; minute < 120; minute++) {
      asksAt.push(minute * MINUTE_MS + random(SPREAD_MS));
    }

    const gaps: Array<number> = gapsOf(asksAt);

    expect(Math.min(...gaps)).toBeLessThan(25 * 1000);
    expect(Math.max(...gaps)).toBeGreaterThan(95 * 1000);
    expect(
      gaps.filter((gap: number): boolean => {
        return Math.abs(gap - MINUTE_MS) > 5000;
      }).length,
    ).toBeGreaterThan(gaps.length / 2);
  });
});
