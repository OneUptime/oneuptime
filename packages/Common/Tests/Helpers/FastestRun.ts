/*
 * HOW LONG WORK ON A LONG TEXT TAKES, FOR A TEST OF TIME THAT GROWS WITH IT.
 *
 * Code that reads text somebody outside wrote - a chat message, an email,
 * HTML - must take time in line with the text: 400,000 characters of its
 * worst case within two seconds. One timing in a busy test run is noisy:
 * the other workers, a garbage collection or a slower machine can stall one
 * attempt for longer than the work itself takes. So the work runs up to
 * three times, stopping at the first attempt within the limit, and the
 * fastest attempt is the one that counts. Work whose time grows with the
 * square of the text takes minutes at these lengths, on every attempt.
 *
 * A whole run can also land on a runner several times slower than usual,
 * where every attempt of linear work overruns: ChatMessageMarkdown's
 * 200,000 one-character lines took 732 ms on a usual runner and 2,661 ms at
 * best on a slow one (2026-10-18). So when every attempt overran its limit,
 * a fixed piece of work (referenceWork) is timed the same way, and the
 * fastest attempt counts as it would have run on a usual runner: divided by
 * how much slower than usual the reference ran - by at most MAX_SLOWDOWN.
 * Linear work then fits its limit on a slow runner, while work whose time
 * grows with the square still takes far longer than any slowdown explains.
 * Timings of two versions of the same work against each other (limitInMs 0)
 * and runs on a test's own clock are never adjusted.
 *
 * Every attempt must do the whole work again. Make what the work changes
 * inside run() - a new parser, stream or framer each attempt - and never
 * repeat an input the work remembers: a search box typed the same text
 * again does not search (React fires no change), so a second attempt would
 * time nothing and pass work that took minutes the first time (RolePicker's
 * book-length search types a text of its own each attempt).
 *
 *   const written: FastestRun<string> = fastestRun({
 *     run: (): string => {
 *       return ChatMessageMarkdown.toMarkdown(content).toString();
 *     },
 *     limitInMs: 2000,
 *   });
 *
 *   expect(written.inMs).toBeLessThan(2000);
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

// How many times work that overruns its limit is tried, the first included.
export const FASTEST_RUN_ATTEMPTS: number = 3;

/*
 * How long referenceWork takes, fastest of three, on a usual CI runner. It
 * took about 60 ms on a 32-core development machine, and the runners took
 * two to four times as long as that machine for the same work on
 * 2026-10-18: so about three times as long.
 */
export const REFERENCE_WORK_USUAL_MS: number = 180;

/*
 * The most a slow runner can stretch a timing. Linear work on a runner
 * twice to four times slower than usual fits its limit again; work whose
 * time grows with the square of the text takes minutes, which stays far
 * past any limit divided by this.
 */
export const MAX_SLOWDOWN: number = 4;

export interface FastestRun<T> {
  // What the fastest attempt returned.
  result: T;
  /*
   * How long the fastest attempt took - as it would have on a usual runner
   * when every attempt overran and the reference work ran slower than
   * usual (see `slowdown`).
   */
  inMs: number;
  // How long the fastest attempt took on this machine, as measured.
  measuredInMs: number;
  // How much slower than usual this machine ran: 1 when not measured.
  slowdown: number;
  // How many attempts ran.
  attempts: number;
}

export interface FastestRunOptions<T> {
  run: () => T;
  limitInMs: number;
  // At least one; FASTEST_RUN_ATTEMPTS when left out.
  attempts?: number | undefined;
  // The clock, in milliseconds: performance.now when left out.
  now?: (() => number) | undefined;
  /*
   * How much slower than usual this machine runs right now: measureSlowdown
   * when left out. Asked only when every attempt overran a limit above zero,
   * and never with a clock of the test's own unless given too.
   */
  slowdown?: (() => number) | undefined;
}

/*
 * A fixed piece of the kind of work these tests time: short strings, one
 * long join, a split and a scan.
 */
export const referenceWork: () => number = (): number => {
  const pieces: Array<string> = [];

  for (let index: number = 0; index < 500000; index++) {
    pieces.push(`a${index % 10}\n`);
  }

  let total: number = 0;

  for (const line of pieces.join("").split("\n")) {
    total += line.length;
  }

  return total;
};

export type MeasureSlowdownFunction = (now: () => number) => number;

/*
 * How much slower than usual this machine runs right now: the fastest of
 * three runs of referenceWork against REFERENCE_WORK_USUAL_MS. The first
 * run also warms the work up. Not limited here; fastestRun limits it.
 */
export const measureSlowdown: MeasureSlowdownFunction = (
  now: () => number,
): number => {
  let fastestInMs: number = Infinity;

  for (let attempt: number = 0; attempt < FASTEST_RUN_ATTEMPTS; attempt++) {
    const started: number = now();
    referenceWork();
    fastestInMs = Math.min(fastestInMs, now() - started);
  }

  return fastestInMs / REFERENCE_WORK_USUAL_MS;
};

export type FastestRunFunction = <T>(
  options: FastestRunOptions<T>,
) => FastestRun<T>;

export const fastestRun: FastestRunFunction = <T>(
  options: FastestRunOptions<T>,
): FastestRun<T> => {
  const attempts: number =
    options.attempts === undefined
      ? FASTEST_RUN_ATTEMPTS
      : Math.max(1, Math.floor(options.attempts));
  const now: () => number =
    options.now ||
    ((): number => {
      return performance.now();
    });

  let fastest: FastestRun<T> | null = null;

  for (let attempt: number = 1; attempt <= attempts; attempt++) {
    const started: number = now();
    const result: T = options.run();
    const inMs: number = now() - started;

    if (fastest === null || inMs < fastest.inMs) {
      fastest = {
        result: result,
        inMs: inMs,
        measuredInMs: inMs,
        slowdown: 1,
        attempts: attempt,
      };
    }

    fastest.attempts = attempt;

    if (inMs < options.limitInMs) {
      break;
    }
  }

  return adjustedForSlowRunner(fastest as FastestRun<T>, options, now);
};

/*
 * TWO VERSIONS OF THE SAME WORK, TIMED AGAINST EACH OTHER. Two fastestRun
 * calls, one after the other, run all of the first version's attempts before
 * any of the second's: a stall on a busy runner - another worker, a garbage
 * collection - that outlasts one side's few short attempts slows every one
 * of them, and the ratio says nothing. QueryPropertyNames' patched read is
 * four times faster than TypeORM's on a quiet machine; in 14.0.99's gate it
 * came out 1.56 times faster, its attempts 5.5 times slower than usual and
 * TypeORM's twice. So the two take turns: one untimed run of each first, so
 * neither is timed cold, then COMPARED_RUN_ROUNDS rounds of one attempt
 * each, the order switched every round, and each side's fastest attempt
 * counts. A stall slows both sides of the rounds it lands in; the rounds it
 * misses decide. Never adjusted for a slow runner: a ratio needs no leeway.
 * As with fastestRun, every attempt must do the whole work again.
 *   const runs: ComparedRuns<number, number> = fastestRunsCompared({
 *     first: (): number => {
 *       return before(text);
 *     },
 *     second: (): number => {
 *       return after(text);
 *     },
 *   });
 *   expect(runs.second.inMs * 2).toBeLessThan(runs.first.inMs);
 */
export const COMPARED_RUN_ROUNDS: number = 7;

export interface ComparedRuns<A, B> {
  first: FastestRun<A>;
  second: FastestRun<B>;
}

export interface ComparedRunsOptions<A, B> {
  first: () => A;
  second: () => B;
  // At least one; COMPARED_RUN_ROUNDS when left out.
  rounds?: number | undefined;
  // The clock, in milliseconds: performance.now when left out.
  now?: (() => number) | undefined;
}

export type FastestRunsComparedFunction = <A, B>(
  options: ComparedRunsOptions<A, B>,
) => ComparedRuns<A, B>;

export const fastestRunsCompared: FastestRunsComparedFunction = <A, B>(
  options: ComparedRunsOptions<A, B>,
): ComparedRuns<A, B> => {
  const rounds: number =
    options.rounds === undefined
      ? COMPARED_RUN_ROUNDS
      : Math.max(1, Math.floor(options.rounds));
  const now: () => number =
    options.now ||
    ((): number => {
      return performance.now();
    });

  // One untimed run of each, so neither side is timed cold.
  options.first();
  options.second();

  let first: FastestRun<A> | null = null;
  let second: FastestRun<B> | null = null;

  for (let round: number = 1; round <= rounds; round++) {
    if (round % 2 === 1) {
      first = timedAttempt(options.first, first, round, now);
      second = timedAttempt(options.second, second, round, now);
    } else {
      second = timedAttempt(options.second, second, round, now);
      first = timedAttempt(options.first, first, round, now);
    }
  }

  return {
    first: first as FastestRun<A>,
    second: second as FastestRun<B>,
  };
};

// One timed attempt of a side, kept if it is that side's fastest so far.
function timedAttempt<T>(
  run: () => T,
  fastest: FastestRun<T> | null,
  attempt: number,
  now: () => number,
): FastestRun<T> {
  const started: number = now();
  const result: T = run();
  const inMs: number = now() - started;

  if (fastest === null || inMs < fastest.inMs) {
    return {
      result: result,
      inMs: inMs,
      measuredInMs: inMs,
      slowdown: 1,
      attempts: attempt,
    };
  }

  fastest.attempts = attempt;

  return fastest;
}

/*
 * Every attempt overran: on a slow runner, linear work does. Count the
 * fastest as it would have run on a usual runner. Not for timings of two
 * versions against each other (limit 0), nor on a test's own clock, where
 * the reference work cannot be timed.
 */
function adjustedForSlowRunner<T>(
  run: FastestRun<T>,
  options: {
    limitInMs: number;
    now?: (() => number) | undefined;
    slowdown?: (() => number) | undefined;
  },
  now: () => number,
): FastestRun<T> {
  const asksSlowdown: boolean = Boolean(options.slowdown) || !options.now;

  if (options.limitInMs > 0 && run.inMs >= options.limitInMs && asksSlowdown) {
    const slowdown: number = Math.min(
      MAX_SLOWDOWN,
      Math.max(1, options.slowdown ? options.slowdown() : measureSlowdown(now)),
    );

    run.slowdown = slowdown;
    run.inMs = run.measuredInMs / slowdown;
  }

  return run;
}

export interface FastestRunAsyncOptions<T> {
  run: () => Promise<T>;
  limitInMs: number;
  attempts?: number | undefined;
  now?: (() => number) | undefined;
  slowdown?: (() => number) | undefined;
}

export type FastestRunAsyncFunction = <T>(
  options: FastestRunAsyncOptions<T>,
) => Promise<FastestRun<T>>;

/*
 * fastestRun for work that awaits - a rule engine's evaluation, which reads
 * its resource before it matches: the same attempts, the same leeway on a
 * slow runner.
 */
export const fastestRunAsync: FastestRunAsyncFunction = async <T>(
  options: FastestRunAsyncOptions<T>,
): Promise<FastestRun<T>> => {
  const attempts: number =
    options.attempts === undefined
      ? FASTEST_RUN_ATTEMPTS
      : Math.max(1, Math.floor(options.attempts));
  const now: () => number =
    options.now ||
    ((): number => {
      return performance.now();
    });

  let fastest: FastestRun<T> | null = null;

  for (let attempt: number = 1; attempt <= attempts; attempt++) {
    const started: number = now();
    const result: T = await options.run();
    const inMs: number = now() - started;

    if (fastest === null || inMs < fastest.inMs) {
      fastest = {
        result: result,
        inMs: inMs,
        measuredInMs: inMs,
        slowdown: 1,
        attempts: attempt,
      };
    }

    fastest.attempts = attempt;

    if (inMs < options.limitInMs) {
      break;
    }
  }

  return adjustedForSlowRunner(fastest as FastestRun<T>, options, now);
};
