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

export interface FastestRun<T> {
  // What the fastest attempt returned.
  result: T;
  // How long the fastest attempt took.
  inMs: number;
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
}

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
      fastest = { result: result, inMs: inMs, attempts: attempt };
    }

    fastest.attempts = attempt;

    if (inMs < options.limitInMs) {
      break;
    }
  }

  return fastest as FastestRun<T>;
};
