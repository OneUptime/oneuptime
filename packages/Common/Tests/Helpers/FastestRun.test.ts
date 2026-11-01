import {
  COMPARED_RUN_ROUNDS,
  ComparedRuns,
  FASTEST_RUN_ATTEMPTS,
  FastestRun,
  fastestRun,
  fastestRunAsync,
  fastestRunsCompared,
  MAX_SLOWDOWN,
  measureSlowdown,
  REFERENCE_WORK_USUAL_MS,
  referenceWork,
} from "./FastestRun";

/*
 * fastestRun, the timing of work on a long text: tried again while it
 * overruns its limit, up to three times, the fastest attempt counting.
 * A scripted clock stands in for performance.now, two readings an attempt.
 * On a runner slower than usual - where every attempt of linear work
 * overruns - the fastest counts as it would have run on a usual runner,
 * never by more than MAX_SLOWDOWN.
 */

// A clock that reads out these times, one a call, and refuses a call more.
const scriptedClock: (times: Array<number>) => () => number = (
  times: Array<number>,
): (() => number) => {
  let index: number = 0;

  return (): number => {
    const time: number | undefined = times[index];
    index++;

    if (time === undefined) {
      throw new Error("The clock was read more often than scripted.");
    }

    return time;
  };
};

describe("fastestRun", () => {
  test("work within the limit runs once", () => {
    let runs: number = 0;

    const timed: FastestRun<string> = fastestRun({
      run: (): string => {
        runs++;
        return "written";
      },
      limitInMs: 2000,
      now: scriptedClock([0, 150]),
    });

    expect(timed).toEqual({
      result: "written",
      inMs: 150,
      measuredInMs: 150,
      slowdown: 1,
      attempts: 1,
    });
    expect(runs).toBe(1);
  });

  test("work over the limit is tried again, and the first attempt within it is the last", () => {
    let runs: number = 0;

    const timed: FastestRun<number> = fastestRun({
      run: (): number => {
        runs++;
        return runs;
      },
      limitInMs: 2000,
      // 2.5 seconds, then 0.4.
      now: scriptedClock([0, 2500, 3000, 3400]),
    });

    expect(timed).toEqual({
      result: 2,
      inMs: 400,
      measuredInMs: 400,
      slowdown: 1,
      attempts: 2,
    });
    expect(runs).toBe(2);
  });

  test("work over the limit every time is tried three times, and the fastest attempt counts", () => {
    let runs: number = 0;

    const timed: FastestRun<number> = fastestRun({
      run: (): number => {
        runs++;
        return runs;
      },
      limitInMs: 2000,
      // 9 seconds, 2.5, then 10.
      now: scriptedClock([0, 9000, 10000, 12500, 20000, 30000]),
    });

    // On a scripted clock nothing is adjusted: see "a slower runner" below.
    expect(timed).toEqual({
      result: 2,
      inMs: 2500,
      measuredInMs: 2500,
      slowdown: 1,
      attempts: FASTEST_RUN_ATTEMPTS,
    });
    expect(runs).toBe(3);
  });

  test("the number of attempts can be given: at least one, a whole number", () => {
    const runsWith: (attempts: number) => number = (
      attempts: number,
    ): number => {
      let runs: number = 0;

      fastestRun({
        run: (): void => {
          runs++;
        },
        limitInMs: 10,
        attempts: attempts,
        // Every attempt overruns.
        now: ((): (() => number) => {
          let time: number = 0;
          return (): number => {
            time += 100;
            return time;
          };
        })(),
      });

      return runs;
    };

    expect(runsWith(5)).toBe(5);
    expect(runsWith(2.7)).toBe(2);
    expect(runsWith(0)).toBe(1);
    expect(runsWith(-3)).toBe(1);
  });

  test("work that throws is not tried again", () => {
    let runs: number = 0;

    expect(() => {
      fastestRun({
        run: (): void => {
          runs++;
          throw new Error("Could not read the message.");
        },
        limitInMs: 2000,
      });
    }).toThrow("Could not read the message.");
    expect(runs).toBe(1);
  });

  test("without a clock, real work is timed with performance.now", () => {
    const timed: FastestRun<number> = fastestRun({
      run: (): number => {
        let sum: number = 0;

        for (let index: number = 0; index < 1000; index++) {
          sum += index;
        }

        return sum;
      },
      limitInMs: 60000,
    });

    expect(timed.result).toBe(499500);
    expect(timed.attempts).toBe(1);
    expect(timed.inMs).toBeGreaterThanOrEqual(0);
    expect(timed.inMs).toBeLessThan(60000);
  });
});

/*
 * A runner slower than usual stretches every attempt of linear work past
 * its limit. The slowdown is given here; measureSlowdown times the
 * reference work on the real clock.
 */
describe("fastestRun on a slower runner", () => {
  // A slowdown that counts how often it was asked.
  const slowdownOf: (value: number) => {
    slowdown: () => number;
    asked: () => number;
  } = (value: number): { slowdown: () => number; asked: () => number } => {
    let asked: number = 0;

    return {
      slowdown: (): number => {
        asked++;
        return value;
      },
      asked: (): number => {
        return asked;
      },
    };
  };

  test("REGRESSION: every attempt overran on a slow runner - the fastest counts as it would have run on a usual one", () => {
    /*
     * ChatMessageMarkdown's 200,000 one-character lines on 2026-10-18: 732 ms
     * on a usual runner, 2,661 ms at best on one about four times slower,
     * and Common Test failed on the 14.0.72 gate.
     */
    const machine: { slowdown: () => number; asked: () => number } =
      slowdownOf(3.6);

    const timed: FastestRun<number> = fastestRun({
      run: (): number => {
        return 1;
      },
      limitInMs: 2000,
      // 2.9 seconds, 2.661, then 2.8.
      now: scriptedClock([0, 2900, 3000, 5661, 6000, 8800]),
      slowdown: machine.slowdown,
    });

    expect(timed.attempts).toBe(FASTEST_RUN_ATTEMPTS);
    expect(timed.measuredInMs).toBe(2661);
    expect(timed.slowdown).toBe(3.6);
    expect(timed.inMs).toBeCloseTo(2661 / 3.6, 6);
    expect(timed.inMs).toBeLessThan(2000);
    expect(machine.asked()).toBe(1);
  });

  test("the slowdown is asked only when every attempt overran", () => {
    const machine: { slowdown: () => number; asked: () => number } =
      slowdownOf(3);

    const timed: FastestRun<number> = fastestRun({
      run: (): number => {
        return 1;
      },
      limitInMs: 2000,
      // 5 seconds, then 0.6.
      now: scriptedClock([0, 5000, 6000, 6600]),
      slowdown: machine.slowdown,
    });

    expect(timed).toEqual({
      result: 1,
      inMs: 600,
      measuredInMs: 600,
      slowdown: 1,
      attempts: 2,
    });
    expect(machine.asked()).toBe(0);
  });

  test("the leeway stops at MAX_SLOWDOWN: work whose time grows with the square still overruns", () => {
    const timed: FastestRun<number> = fastestRun({
      run: (): number => {
        return 1;
      },
      limitInMs: 2000,
      // Minutes, every attempt.
      now: scriptedClock([0, 180000, 180000, 355000, 355000, 545000]),
      slowdown: slowdownOf(50).slowdown,
    });

    expect(timed.slowdown).toBe(MAX_SLOWDOWN);
    expect(timed.measuredInMs).toBe(175000);
    expect(timed.inMs).toBe(175000 / MAX_SLOWDOWN);
    expect(timed.inMs).toBeGreaterThan(2000);
  });

  test("a machine faster than usual never tightens a timing", () => {
    const timed: FastestRun<number> = fastestRun({
      run: (): number => {
        return 1;
      },
      limitInMs: 2000,
      now: scriptedClock([0, 2500, 2500, 4900, 4900, 7500]),
      slowdown: slowdownOf(0.4).slowdown,
    });

    expect(timed.slowdown).toBe(1);
    expect(timed.inMs).toBe(2400);
    expect(timed.measuredInMs).toBe(2400);
  });

  test("two versions timed against each other (limit 0) are never adjusted", () => {
    const machine: { slowdown: () => number; asked: () => number } =
      slowdownOf(3);

    const timed: FastestRun<number> = fastestRun({
      run: (): number => {
        return 1;
      },
      limitInMs: 0,
      now: scriptedClock([0, 300, 300, 550, 550, 830]),
      slowdown: machine.slowdown,
    });

    expect(timed.inMs).toBe(250);
    expect(timed.slowdown).toBe(1);
    expect(machine.asked()).toBe(0);
  });

  test("on a scripted clock with no slowdown given nothing is adjusted: the reference work cannot be timed on it", () => {
    const timed: FastestRun<number> = fastestRun({
      run: (): number => {
        return 1;
      },
      limitInMs: 2000,
      // Read only six times: timing the reference would read it again.
      now: scriptedClock([0, 2500, 2500, 4900, 4900, 7500]),
    });

    expect(timed.inMs).toBe(2400);
    expect(timed.slowdown).toBe(1);
  });
});

describe("measureSlowdown", () => {
  test("the fastest of three runs of the reference work, against its usual time", () => {
    const usual: number = REFERENCE_WORK_USUAL_MS;

    expect(
      measureSlowdown(
        scriptedClock([
          0,
          usual * 5,
          usual * 5,
          usual * 7,
          usual * 7,
          usual * 10,
        ]),
      ),
    ).toBe(2);
  });

  test("on the real clock it measures this machine; the reference is the same work each time", () => {
    expect(referenceWork()).toBe(referenceWork());
    expect(referenceWork()).toBeGreaterThan(0);

    const slowdown: number = measureSlowdown((): number => {
      return performance.now();
    });

    expect(Number.isFinite(slowdown)).toBe(true);
    expect(slowdown).toBeGreaterThan(0);
  });
});

describe("fastestRunAsync", () => {
  test("work that awaits, within the limit, runs once", async () => {
    let runs: number = 0;

    const timed: FastestRun<string> = await fastestRunAsync({
      run: async (): Promise<string> => {
        runs++;
        await Promise.resolve();
        return "evaluated";
      },
      limitInMs: 2000,
      now: scriptedClock([0, 120]),
    });

    expect(timed).toEqual({
      result: "evaluated",
      inMs: 120,
      measuredInMs: 120,
      slowdown: 1,
      attempts: 1,
    });
    expect(runs).toBe(1);
  });

  test("work over the limit every time is tried three times, and the fastest attempt counts", async () => {
    const timed: FastestRun<number> = await fastestRunAsync({
      run: async (): Promise<number> => {
        return 7;
      },
      limitInMs: 100,
      now: scriptedClock([0, 400, 1000, 1300, 2000, 2500]),
    });

    expect(timed.attempts).toBe(FASTEST_RUN_ATTEMPTS);
    expect(timed.inMs).toBe(300);
    expect(timed.slowdown).toBe(1);
  });

  test("on a slow runner the fastest counts as it would have run on a usual one, never by more than MAX_SLOWDOWN", async () => {
    const timed: FastestRun<null> = await fastestRunAsync({
      run: async (): Promise<null> => {
        return null;
      },
      limitInMs: 1000,
      now: scriptedClock([0, 3000, 3000, 6500, 6500, 9800]),
      slowdown: (): number => {
        return 10;
      },
    });

    expect(timed.measuredInMs).toBe(3000);
    expect(timed.slowdown).toBe(MAX_SLOWDOWN);
    expect(timed.inMs).toBe(3000 / MAX_SLOWDOWN);
  });

  test("work that rejects is not tried again", async () => {
    let runs: number = 0;

    await expect(
      fastestRunAsync({
        run: async (): Promise<void> => {
          runs++;
          throw new Error("rejected");
        },
        limitInMs: 1,
      }),
    ).rejects.toThrow("rejected");
    expect(runs).toBe(1);
  });
});

/*
 * fastestRunsCompared, two versions of the same work timed against each
 * other: one untimed run of each, then rounds of one attempt each, the order
 * switched every round, so a stall slows both sides of the rounds it lands
 * in and the rounds it misses decide.
 */
describe("fastestRunsCompared", () => {
  test("one untimed run of each, then the two take turns, the order switched every round", () => {
    const order: Array<string> = [];
    let clockReads: number = 0;

    fastestRunsCompared({
      first: (): string => {
        order.push("first");
        return "first";
      },
      second: (): string => {
        order.push("second");
        return "second";
      },
      rounds: 3,
      now: (): number => {
        clockReads++;
        return clockReads;
      },
    });

    expect(order).toEqual([
      "first",
      "second",
      "first",
      "second",
      "second",
      "first",
      "first",
      "second",
    ]);
    // Two readings a timed attempt; the untimed runs read no clock.
    expect(clockReads).toBe(12);
  });

  test("each side's fastest attempt counts, with what it returned, out of one attempt a round", () => {
    let firstRuns: number = 0;
    let secondRuns: number = 0;

    const runs: ComparedRuns<number, number> = fastestRunsCompared({
      first: (): number => {
        firstRuns++;
        return firstRuns;
      },
      second: (): number => {
        secondRuns++;
        return secondRuns * 10;
      },
      rounds: 3,
      // Round 1: first 50, second 20; round 2: second 5, first 40; round 3: first 30, second 20.
      now: scriptedClock([0, 50, 50, 70, 70, 75, 75, 115, 115, 145, 145, 165]),
    });

    // The first side's fastest is round 3's: its fourth run, the untimed one included.
    expect(runs.first.inMs).toBe(30);
    expect(runs.first.measuredInMs).toBe(30);
    expect(runs.first.result).toBe(4);
    expect(runs.first.attempts).toBe(3);
    expect(runs.first.slowdown).toBe(1);
    // The second side's is round 2's: its third run.
    expect(runs.second.inMs).toBe(5);
    expect(runs.second.result).toBe(30);
    expect(runs.second.attempts).toBe(3);
  });

  test("the number of rounds can be given: at least one, a whole number", () => {
    const runsOf: (rounds: number | undefined) => number = (
      rounds: number | undefined,
    ): number => {
      let runs: number = 0;

      fastestRunsCompared({
        first: (): null => {
          runs++;
          return null;
        },
        second: (): null => {
          return null;
        },
        rounds: rounds,
      });

      return runs;
    };

    // Every count includes the untimed run.
    expect(runsOf(0)).toBe(2);
    expect(runsOf(2.7)).toBe(3);
    expect(runsOf(undefined)).toBe(COMPARED_RUN_ROUNDS + 1);
  });

  test("a side that throws stops the timing", () => {
    expect(() => {
      fastestRunsCompared({
        first: (): null => {
          return null;
        },
        second: (): null => {
          throw new Error("broken");
        },
      });
    }).toThrow("broken");
  });

  test("REGRESSION: a stall that outlasts one side's attempts hides a ratio when the sides are timed one after the other, never when they take turns", () => {
    /*
     * 14.0.99's gate (#5429): QueryPropertyNames' patched read is four times
     * faster than TypeORM's, but its attempts, all timed after TypeORM's,
     * ran 5.5 times slower than usual, and it read 1.56 times faster. A
     * virtual clock: TypeORM's read takes 13 ms and the patched one 3, and
     * a run that starts within the stall takes 5.5 times as long.
     */
    const timeline: (
      stallFromMs: number,
      stallUntilMs: number,
    ) => {
      now: () => number;
      typeOrm: () => number;
      patched: () => number;
    } = (
      stallFromMs: number,
      stallUntilMs: number,
    ): {
      now: () => number;
      typeOrm: () => number;
      patched: () => number;
    } => {
      let time: number = 0;
      const work: (usualMs: number) => () => number = (
        usualMs: number,
      ): (() => number) => {
        return (): number => {
          const stalled: boolean = time >= stallFromMs && time < stallUntilMs;
          time += stalled ? usualMs * 5.5 : usualMs;
          return usualMs;
        };
      };

      return {
        now: (): number => {
          return time;
        },
        typeOrm: work(13),
        patched: work(3),
      };
    };

    // One after the other, as two fastestRun calls time them: the stall starts with the patched read's attempts.
    const sequential: ReturnType<typeof timeline> = timeline(39, 100);
    const typeOrmAlone: FastestRun<number> = fastestRun({
      run: sequential.typeOrm,
      limitInMs: 0,
      now: sequential.now,
    });
    const patchedAlone: FastestRun<number> = fastestRun({
      run: sequential.patched,
      limitInMs: 0,
      now: sequential.now,
    });
    expect(typeOrmAlone.inMs).toBe(13);
    expect(patchedAlone.inMs).toBe(16.5);
    expect(patchedAlone.inMs * 2).toBeGreaterThan(typeOrmAlone.inMs);

    // Taking turns, through the same stall: the rounds it misses decide.
    const turns: ReturnType<typeof timeline> = timeline(39, 100);
    const runs: ComparedRuns<number, number> = fastestRunsCompared({
      first: turns.typeOrm,
      second: turns.patched,
      now: turns.now,
    });
    expect(runs.first.inMs).toBe(13);
    expect(runs.second.inMs).toBe(3);
    expect(runs.second.inMs * 2).toBeLessThan(runs.first.inMs);
  });

  test("without a clock, real work is timed with performance.now, each side returning its own result", () => {
    const runs: ComparedRuns<number, string> = fastestRunsCompared({
      first: (): number => {
        return referenceWork();
      },
      second: (): string => {
        return "done";
      },
      rounds: 2,
    });

    expect(runs.first.result).toBe(referenceWork());
    expect(runs.second.result).toBe("done");
    expect(runs.first.inMs).toBeGreaterThan(0);
    expect(runs.second.inMs).toBeGreaterThanOrEqual(0);
    expect(runs.first.attempts).toBe(2);
    expect(runs.second.attempts).toBe(2);
  });
});
