import {
  DATA_SOURCE_MAX_STEP_IN_SECONDS,
  DATA_SOURCE_MIN_STEP_IN_SECONDS,
  DATA_SOURCE_TARGET_BUCKETS,
  DataSourceLimitsUtil,
} from "../../../Types/DataSource/DataSourceLimits";

describe("DataSourceLimitsUtil.getStepInSeconds", () => {
  const stepFor: (seconds: number) => number = (seconds: number): number => {
    const start: Date = new Date("2026-01-01T00:00:00.000Z");
    const end: Date = new Date(start.getTime() + seconds * 1000);
    return DataSourceLimitsUtil.getStepInSeconds(start, end);
  };

  test("aims for ~TARGET_BUCKETS buckets across the window", () => {
    // A one-hour window / 250 buckets = 14.4s, ceil -> 15s.
    expect(stepFor(60 * 60)).toBe(15);

    // A 24-hour window / 250 = 345.6s, ceil -> 346s.
    expect(stepFor(24 * 60 * 60)).toBe(346);
  });

  test("never returns a step below MIN_STEP for short windows", () => {
    // A tiny window would compute a sub-second step; it is clamped up.
    expect(stepFor(60)).toBe(DATA_SOURCE_MIN_STEP_IN_SECONDS);
    expect(stepFor(1)).toBe(DATA_SOURCE_MIN_STEP_IN_SECONDS);
  });

  test("the MIN_STEP boundary is exact, not off-by-one", () => {
    /*
     * rawStep = ceil(range / TARGET_BUCKETS). The largest range whose rawStep
     * still equals MIN_STEP is MIN_STEP * TARGET_BUCKETS seconds. One second
     * more must tip rawStep to MIN_STEP + 1.
     */
    const atBoundary: number =
      DATA_SOURCE_MIN_STEP_IN_SECONDS * DATA_SOURCE_TARGET_BUCKETS;
    expect(stepFor(atBoundary)).toBe(DATA_SOURCE_MIN_STEP_IN_SECONDS);
    expect(stepFor(atBoundary + 1)).toBe(DATA_SOURCE_MIN_STEP_IN_SECONDS + 1);
  });

  test("never returns a step above MAX_STEP for huge windows", () => {
    // A one-year window would compute a far larger step; it is clamped down.
    expect(stepFor(365 * 24 * 60 * 60)).toBe(DATA_SOURCE_MAX_STEP_IN_SECONDS);
  });

  test("a zero-length window is treated as at least one second", () => {
    const instant: Date = new Date("2026-01-01T00:00:00.000Z");
    // range floors to >=1s, so the step is the clamped minimum, never 0.
    expect(DataSourceLimitsUtil.getStepInSeconds(instant, instant)).toBe(
      DATA_SOURCE_MIN_STEP_IN_SECONDS,
    );
  });

  test("an inverted range (end before start) still yields a sane minimum", () => {
    // Guards against a negative step reaching a downstream range query.
    const start: Date = new Date("2026-01-01T12:00:00.000Z");
    const end: Date = new Date("2026-01-01T00:00:00.000Z");
    expect(DataSourceLimitsUtil.getStepInSeconds(start, end)).toBe(
      DATA_SOURCE_MIN_STEP_IN_SECONDS,
    );
  });

  test("the returned step is always a whole number within bounds", () => {
    for (const seconds of [1, 90, 3600, 86400, 7 * 86400, 400 * 86400]) {
      const step: number = stepFor(seconds);
      expect(Number.isInteger(step)).toBe(true);
      expect(step).toBeGreaterThanOrEqual(DATA_SOURCE_MIN_STEP_IN_SECONDS);
      expect(step).toBeLessThanOrEqual(DATA_SOURCE_MAX_STEP_IN_SECONDS);
    }
  });
});
