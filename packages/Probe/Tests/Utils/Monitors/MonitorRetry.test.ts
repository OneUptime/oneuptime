import MonitorRetry from "../../../Utils/Monitors/MonitorRetry";
import { describe, expect, test } from "@jest/globals";

/*
 * Counts how many attempts a check makes when every attempt fails, by driving
 * canRetry the way the monitor utils do: attempt 1 runs, then each failure
 * asks whether another attempt is allowed.
 */
function attemptsOnPersistentFailure(
  retries: number | undefined | null,
  defaultRetries: number,
): number {
  let attemptNumber: number = 1;

  while (
    MonitorRetry.canRetry({
      attemptNumber: attemptNumber,
      retries: retries,
      defaultRetries: defaultRetries,
    })
  ) {
    attemptNumber++;
  }

  return attemptNumber;
}

describe("MonitorRetry", () => {
  test("a retry value counts retries after the first attempt", () => {
    expect(attemptsOnPersistentFailure(0, 4)).toBe(1);
    expect(attemptsOnPersistentFailure(1, 4)).toBe(2);
    expect(attemptsOnPersistentFailure(2, 4)).toBe(3);
    expect(attemptsOnPersistentFailure(3, 4)).toBe(4);
  });

  test("zero retries means exactly one attempt, not the default", () => {
    expect(
      MonitorRetry.canRetry({
        attemptNumber: 1,
        retries: 0,
        defaultRetries: 4,
      }),
    ).toBe(false);
  });

  test("falls back to the default only when no usable value was given", () => {
    expect(attemptsOnPersistentFailure(undefined, 4)).toBe(5);
    expect(attemptsOnPersistentFailure(null, 2)).toBe(3);
    expect(attemptsOnPersistentFailure(NaN, 2)).toBe(3);
    expect(attemptsOnPersistentFailure(-1, 2)).toBe(3);
    expect(attemptsOnPersistentFailure(Infinity, 2)).toBe(3);
  });

  test("an attempt counter that starts at zero still gets no retry from zero", () => {
    /*
     * Every monitor util starts the counter at 1, but several carry a dead
     * "if (!currentRetryCount) currentRetryCount = 0" reset in their catch
     * block. If one of those ever fed 0 in here, a plain attemptNumber <=
     * retries comparison would hand out a second attempt to a check the user
     * asked never to retry.
     */
    expect(
      MonitorRetry.canRetry({
        attemptNumber: 0,
        retries: 0,
        defaultRetries: 4,
      }),
    ).toBe(false);

    expect(
      MonitorRetry.canRetry({
        attemptNumber: 0,
        retries: 1,
        defaultRetries: 4,
      }),
    ).toBe(true);
  });

  test("a fractional retry value is rounded down", () => {
    expect(
      MonitorRetry.resolveRetries({ retries: 2.7, defaultRetries: 4 }),
    ).toBe(2);
    expect(attemptsOnPersistentFailure(2.7, 4)).toBe(3);
  });
});
