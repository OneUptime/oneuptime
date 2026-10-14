import { FASTEST_RUN_ATTEMPTS, FastestRun, fastestRun } from "./FastestRun";

/*
 * fastestRun, the timing of work on a long text: tried again while it
 * overruns its limit, up to three times, the fastest attempt counting.
 * A scripted clock stands in for performance.now, two readings an attempt.
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

    expect(timed).toEqual({ result: "written", inMs: 150, attempts: 1 });
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

    expect(timed).toEqual({ result: 2, inMs: 400, attempts: 2 });
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

    expect(timed).toEqual({
      result: 2,
      inMs: 2500,
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
