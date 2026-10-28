import {
  CorrelationMatch,
  countStepTimes,
  findOrderedChain,
  findTogetherWindow,
} from "../../../Utils/SecurityEvent/Sigma/CorrelationTimeline";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * The time arithmetic of temporal correlations. Each function is pinned on
 * the cases a person would draw out - a burst, a chain, a chain too slow,
 * a chain in the wrong order, a chain the last run already reported - and
 * then checked against a brute-force answer on thousands of generated
 * timelines, so "the most recent match" and "none" mean exactly that.
 */

const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;

describe("countStepTimes", () => {
  test("a step that counts happens at each event that brings its window to the count", () => {
    // Failures at 0, 1, 2, 3 and 10 minutes; three within five minutes.
    const times: Array<number> = [0, 1, 2, 3, 10].map((minute: number) => {
      return minute * MINUTE;
    });

    expect(countStepTimes(times, 5 * MINUTE, 3)).toEqual([
      2 * MINUTE,
      3 * MINUTE,
    ]);
  });

  test("the window's far edge is not in it, its near edge is", () => {
    // 0 and 5 minutes are exactly five minutes apart: not in one window of five.
    expect(countStepTimes([0, 5 * MINUTE], 5 * MINUTE, 2)).toEqual([]);
    expect(countStepTimes([0, 5 * MINUTE - 1], 5 * MINUTE, 2)).toEqual([
      5 * MINUTE - 1,
    ]);
  });

  test("unsorted input, a count of one, and nothing to count", () => {
    expect(countStepTimes([3, 1, 2], 10, 1)).toEqual([1, 2, 3]);
    expect(countStepTimes([], MINUTE, 2)).toEqual([]);
    expect(countStepTimes([5, 5, 5], 1, 3)).toEqual([5]);
  });

  test("a window of nothing still holds its own event", () => {
    expect(countStepTimes([1, 2], 0, 1)).toEqual([1, 2]);
  });

  test("agrees with counting every window by hand", () => {
    const random: SeededRandom = seededRandom(1101);

    for (let round: number = 0; round < 2000; round++) {
      const times: Array<number> = Array.from(
        { length: random(30) },
        (): number => {
          return random(1000);
        },
      );
      const window: number = 1 + random(200);
      const needed: number = 1 + random(6);

      const sorted: Array<number> = [...times].sort((a: number, b: number) => {
        return a - b;
      });
      const expected: Array<number> = sorted.filter(
        (end: number, index: number): boolean => {
          const inWindow: number = sorted
            .slice(0, index + 1)
            .filter((time: number): boolean => {
              return time > end - window;
            }).length;
          return inWindow >= needed;
        },
      );

      expect(countStepTimes(times, window, needed)).toEqual(expected);
    }
  });
});

describe("findOrderedChain", () => {
  test("failures then a success within the timespan", () => {
    const match: CorrelationMatch | null = findOrderedChain(
      [[MINUTE, 2 * MINUTE], [5 * MINUTE]],
      10 * MINUTE,
      0,
    );

    expect(match).toEqual({
      start: 2 * MINUTE,
      end: 5 * MINUTE,
      stepTimes: [2 * MINUTE, 5 * MINUTE],
    });
  });

  test("the wrong order is no chain", () => {
    expect(
      findOrderedChain([[5 * MINUTE], [MINUTE]], 10 * MINUTE, 0),
    ).toBeNull();
  });

  test("a chain longer than the timespan is no chain", () => {
    expect(findOrderedChain([[0], [11 * MINUTE]], 10 * MINUTE, 0)).toBeNull();
    expect(
      findOrderedChain([[0], [10 * MINUTE]], 10 * MINUTE, 0),
    ).not.toBeNull();
  });

  test("a chain whose last step the previous run saw is not reported again", () => {
    expect(
      findOrderedChain([[MINUTE], [2 * MINUTE]], 10 * MINUTE, 3 * MINUTE),
    ).toBeNull();

    // A chain whose first step came before this run, finished in it, is.
    expect(
      findOrderedChain([[MINUTE], [4 * MINUTE]], 10 * MINUTE, 3 * MINUTE),
    ).not.toBeNull();
  });

  test("the latest earlier time of each step keeps a chain that an earlier one would break", () => {
    // Step 1 at 0 and 9; step 2 at 10; step 3 at 15. 0 -> 15 is too long, 9 -> 15 fits.
    const match: CorrelationMatch | null = findOrderedChain(
      [[0, 9 * MINUTE], [10 * MINUTE], [15 * MINUTE]],
      10 * MINUTE,
      0,
    );

    expect(match?.stepTimes).toEqual([9 * MINUTE, 10 * MINUTE, 15 * MINUTE]);
  });

  test("steps that happened at the same moment are in order", () => {
    expect(findOrderedChain([[5], [5]], 1, 0)).toEqual({
      start: 5,
      end: 5,
      stepTimes: [5, 5],
    });
  });

  test("the most recent chain is the one reported", () => {
    const match: CorrelationMatch | null = findOrderedChain(
      [
        [MINUTE, 20 * MINUTE],
        [2 * MINUTE, 21 * MINUTE],
      ],
      5 * MINUTE,
      0,
    );

    expect(match?.end).toBe(21 * MINUTE);
  });

  test("no steps, or a step with no times, is no chain", () => {
    expect(findOrderedChain([], MINUTE, 0)).toBeNull();
    expect(findOrderedChain([[1], []], MINUTE, 0)).toBeNull();
    expect(findOrderedChain([[], [1]], MINUTE, 0)).toBeNull();
  });

  test("agrees with trying every chain by hand", () => {
    const random: SeededRandom = seededRandom(2202);

    for (let round: number = 0; round < 3000; round++) {
      const stepCount: number = 2 + random(2);
      const steps: Array<Array<number>> = Array.from(
        { length: stepCount },
        (): Array<number> => {
          return Array.from({ length: random(5) }, (): number => {
            return random(60);
          });
        },
      );
      const window: number = random(30);
      const notBefore: number = random(60);

      // Every chain, by hand: the latest end that has one, if any.
      let best: number | null = null;

      const walk: (step: number, chain: Array<number>) => void = (
        step: number,
        chain: Array<number>,
      ): void => {
        if (step === stepCount) {
          const end: number = chain[chain.length - 1]!;

          if (end >= notBefore && end - chain[0]! <= window) {
            best = best === null ? end : Math.max(best, end);
          }

          return;
        }

        for (const time of steps[step]!) {
          if (chain.length === 0 || time >= chain[chain.length - 1]!) {
            walk(step + 1, [...chain, time]);
          }
        }
      };

      walk(0, []);

      const match: CorrelationMatch | null = findOrderedChain(
        steps,
        window,
        notBefore,
      );

      expect(match ? match.end : null).toBe(best);

      if (match) {
        // What it reports is a real chain.
        match.stepTimes.forEach((time: number, step: number): void => {
          expect(steps[step]).toContain(time);

          if (step > 0) {
            expect(time).toBeGreaterThanOrEqual(match.stepTimes[step - 1]!);
          }
        });
        expect(match.end - match.start).toBeLessThanOrEqual(window);
      }
    }
  });
});

describe("findTogetherWindow", () => {
  test("every step within the timespan, in any order", () => {
    const match: CorrelationMatch | null = findTogetherWindow(
      [[5 * MINUTE], [2 * MINUTE], [4 * MINUTE]],
      5 * MINUTE,
      3,
      0,
    );

    expect(match).toEqual({
      start: 2 * MINUTE,
      end: 5 * MINUTE,
      stepTimes: [5 * MINUTE, 2 * MINUTE, 4 * MINUTE],
    });
  });

  test("steps too far apart are not together", () => {
    expect(
      findTogetherWindow([[0], [6 * MINUTE]], 5 * MINUTE, 2, 0),
    ).toBeNull();
  });

  test("at least some of the steps, when that is all the rule asks", () => {
    const match: CorrelationMatch | null = findTogetherWindow(
      [[MINUTE], [2 * MINUTE], [30 * MINUTE]],
      5 * MINUTE,
      2,
      0,
    );

    expect(match?.stepTimes).toEqual([MINUTE, 2 * MINUTE, -1]);
  });

  test("a window the previous run saw whole is not reported again", () => {
    expect(findTogetherWindow([[1], [2]], 10, 2, 5)).toBeNull();
    expect(findTogetherWindow([[1], [6]], 10, 2, 5)).not.toBeNull();
  });

  test("asking for more steps than there are asks for all of them", () => {
    expect(findTogetherWindow([[1], [2]], 10, 9, 0)).not.toBeNull();
    expect(findTogetherWindow([[1], []], 10, 9, 0)).toBeNull();
    expect(findTogetherWindow([], 10, 1, 0)).toBeNull();
  });

  test("agrees with trying every window by hand", () => {
    const random: SeededRandom = seededRandom(3303);

    for (let round: number = 0; round < 3000; round++) {
      const stepCount: number = 2 + random(3);
      const steps: Array<Array<number>> = Array.from(
        { length: stepCount },
        (): Array<number> => {
          return Array.from({ length: random(5) }, (): number => {
            return random(60);
          });
        },
      );
      const window: number = random(30);
      const needed: number = 1 + random(stepCount);
      const notBefore: number = random(60);

      // Every window ending at an event: how many steps it holds.
      let bestEnd: number | null = null;

      for (const step of steps) {
        for (const end of step) {
          if (end < notBefore) {
            continue;
          }

          const held: number = steps.filter(
            (candidate: Array<number>): boolean => {
              return candidate.some((time: number): boolean => {
                return time <= end && time >= end - window;
              });
            },
          ).length;

          if (held >= needed) {
            bestEnd = bestEnd === null ? end : Math.max(bestEnd, end);
          }
        }
      }

      const match: CorrelationMatch | null = findTogetherWindow(
        steps,
        window,
        needed,
        notBefore,
      );

      expect(match ? match.end : null).toBe(bestEnd);

      if (match) {
        expect(match.end - match.start).toBeLessThanOrEqual(window);
        expect(
          match.stepTimes.filter((time: number): boolean => {
            return time >= 0;
          }).length,
        ).toBeGreaterThanOrEqual(needed);
      }
    }
  });

  test("a long timeline is read in one pass", () => {
    const steps: Array<Array<number>> = [
      Array.from({ length: 200000 }, (_value: unknown, index: number) => {
        return index * 10;
      }),
      Array.from({ length: 200000 }, (_value: unknown, index: number) => {
        return index * 10 + 3;
      }),
    ];
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        expect(findTogetherWindow(steps, 1, 2, 0)).toBeNull();
        expect(findOrderedChain(steps, 1, 0)).toBeNull();
      },
      limitInMs: 2000,
    });
    expect(timed.inMs).toBeLessThan(2000);
  });
});
