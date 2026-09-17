import { AggregateUtil } from "../../../../Server/Types/AnalyticsDatabase/AggregateBy";
import AggregationInterval from "../../../../Types/BaseDatabase/AggregationInterval";
import { describe, expect, it } from "@jest/globals";

/*
 * AggregateUtil is the server's single source of truth for turning a query
 * window into an aggregation bucket size and for compiling that bucket into a
 * ClickHouse timestamp expression. The tests below exercise the real branches:
 *
 *   - getAggregationInterval: window-derived tier ladder, its <=-inclusive
 *     boundaries, and the explicit-override precedence (including Total, which
 *     the window picker itself never returns, and invalid overrides that fall
 *     through to the window).
 *   - isTotalAggregation: the Total-vs-everything-else predicate.
 *   - buildBucketTimestampExpression: the sub-hour toStartOfInterval tiers vs
 *     the lowercased date_trunc default, plus raw expression interpolation.
 *   - buildBucketTimestampSelect: the Total min() shape vs the aliased bucket
 *     expression it delegates to.
 *
 * Everything is deterministic: getAggregationInterval only reads the numeric
 * millisecond diff between the two dates, so windows are built from a fixed
 * epoch anchor plus an exact millisecond span.
 */

/*
 * Fixed anchor for every window. getAggregationInterval depends only on
 * endDate - startDate, so the absolute instant is irrelevant; pinning it makes
 * the boundary arithmetic obvious.
 */
const ANCHOR_MS: number = 0;

/*
 * Tier upper bounds, copied from the implementation so a change in the ladder
 * is caught here rather than silently re-tiering every chart. Each value is the
 * largest diff (inclusive) that still resolves to the tier it labels.
 */
const THREE_HOURS_MS: number = 1000 * 60 * 60 * 3;
const TWELVE_HOURS_MS: number = 1000 * 60 * 60 * 12;
const TWENTY_FOUR_HOURS_MS: number = 1000 * 60 * 60 * 24;
const THREE_DAYS_MS: number = 1000 * 60 * 60 * 24 * 3;
const SEVEN_DAYS_MS: number = 1000 * 60 * 60 * 24 * 7;
const SIX_WEEKS_MS: number = 1000 * 60 * 60 * 24 * 7 * 6;
const SIX_MONTHS_MS: number = 1000 * 60 * 60 * 24 * 30 * 6;
const SIX_YEARS_MS: number = 1000 * 60 * 60 * 24 * 365 * 6;

function intervalForDiff(
  diffMs: number,
  aggregationInterval?: AggregationInterval,
): AggregationInterval {
  const startDate: Date = new Date(ANCHOR_MS);
  const endDate: Date = new Date(ANCHOR_MS + diffMs);
  return AggregateUtil.getAggregationInterval({
    startDate,
    endDate,
    aggregationInterval,
  });
}

describe("AggregateUtil.getAggregationInterval window-derived ladder", () => {
  it("returns Minute for a zero-length window", () => {
    const result: AggregationInterval = intervalForDiff(0);
    expect(result).toBe(AggregationInterval.Minute);
  });

  it("returns Minute for a negative (end-before-start) window", () => {
    /*
     * A malformed window makes the diff negative, which is still <= every
     * upper bound, so it collapses to the finest tier rather than throwing.
     */
    const result: AggregationInterval = intervalForDiff(-1000 * 60 * 60);
    expect(result).toBe(AggregationInterval.Minute);
  });

  it("never returns Total from the window derivation (huge window -> Year)", () => {
    const result: AggregationInterval = intervalForDiff(SIX_YEARS_MS + 1);
    expect(result).toBe(AggregationInterval.Year);
    expect(result).not.toBe(AggregationInterval.Total);
  });

  type LadderCase = {
    label: string;
    diffMs: number;
    expected: AggregationInterval;
  };

  /*
   * Each tier is probed at three points: comfortably inside the tier, exactly
   * on its inclusive upper bound (must stay in the tier), and one millisecond
   * past it (must roll to the next coarser tier). The last pair proves the
   * ladder uses <= and not <.
   */
  const ladderCases: Array<LadderCase> = [
    {
      label: "1 hour -> Minute",
      diffMs: 1000 * 60 * 60,
      expected: AggregationInterval.Minute,
    },
    {
      label: "exactly 3 hours -> Minute (inclusive bound)",
      diffMs: THREE_HOURS_MS,
      expected: AggregationInterval.Minute,
    },
    {
      label: "3 hours + 1ms -> FiveMinutes",
      diffMs: THREE_HOURS_MS + 1,
      expected: AggregationInterval.FiveMinutes,
    },
    {
      label: "exactly 12 hours -> FiveMinutes (inclusive bound)",
      diffMs: TWELVE_HOURS_MS,
      expected: AggregationInterval.FiveMinutes,
    },
    {
      label: "12 hours + 1ms -> FifteenMinutes",
      diffMs: TWELVE_HOURS_MS + 1,
      expected: AggregationInterval.FifteenMinutes,
    },
    {
      label: "exactly 24 hours -> FifteenMinutes (inclusive bound)",
      diffMs: TWENTY_FOUR_HOURS_MS,
      expected: AggregationInterval.FifteenMinutes,
    },
    {
      label: "24 hours + 1ms -> ThirtyMinutes",
      diffMs: TWENTY_FOUR_HOURS_MS + 1,
      expected: AggregationInterval.ThirtyMinutes,
    },
    {
      label: "exactly 3 days -> ThirtyMinutes (inclusive bound)",
      diffMs: THREE_DAYS_MS,
      expected: AggregationInterval.ThirtyMinutes,
    },
    {
      label: "3 days + 1ms -> Hour",
      diffMs: THREE_DAYS_MS + 1,
      expected: AggregationInterval.Hour,
    },
    {
      label: "exactly 7 days -> Hour (inclusive bound)",
      diffMs: SEVEN_DAYS_MS,
      expected: AggregationInterval.Hour,
    },
    {
      label: "7 days + 1ms -> Day",
      diffMs: SEVEN_DAYS_MS + 1,
      expected: AggregationInterval.Day,
    },
    {
      label: "exactly 6 weeks -> Day (inclusive bound)",
      diffMs: SIX_WEEKS_MS,
      expected: AggregationInterval.Day,
    },
    {
      label: "6 weeks + 1ms -> Week",
      diffMs: SIX_WEEKS_MS + 1,
      expected: AggregationInterval.Week,
    },
    {
      label: "exactly 6 months -> Week (inclusive bound)",
      diffMs: SIX_MONTHS_MS,
      expected: AggregationInterval.Week,
    },
    {
      label: "6 months + 1ms -> Month",
      diffMs: SIX_MONTHS_MS + 1,
      expected: AggregationInterval.Month,
    },
    {
      label: "exactly 6 years -> Month (inclusive bound)",
      diffMs: SIX_YEARS_MS,
      expected: AggregationInterval.Month,
    },
    {
      label: "6 years + 1ms -> Year",
      diffMs: SIX_YEARS_MS + 1,
      expected: AggregationInterval.Year,
    },
  ];

  it.each(ladderCases)(
    "resolves $label",
    ({ diffMs, expected }: LadderCase) => {
      const result: AggregationInterval = intervalForDiff(diffMs);
      expect(result).toBe(expected);
    },
  );
});

describe("AggregateUtil.getAggregationInterval explicit override precedence", () => {
  it("returns a valid override verbatim, ignoring the (finer) window tier", () => {
    /*
     * A 1-hour window would derive Minute, but the override pins Year, proving
     * the override short-circuits the window derivation entirely.
     */
    const result: AggregationInterval = intervalForDiff(
      1000 * 60 * 60,
      AggregationInterval.Year,
    );
    expect(result).toBe(AggregationInterval.Year);
  });

  it("returns a valid override verbatim, ignoring the (coarser) window tier", () => {
    const result: AggregationInterval = intervalForDiff(
      SIX_YEARS_MS + 1,
      AggregationInterval.Minute,
    );
    expect(result).toBe(AggregationInterval.Minute);
  });

  it("honours a Total override even though the window picker never yields Total", () => {
    const result: AggregationInterval = intervalForDiff(
      1000 * 60 * 60,
      AggregationInterval.Total,
    );
    expect(result).toBe(AggregationInterval.Total);
  });

  it("falls through to the window tier when the override is not a real enum value", () => {
    /*
     * Object.values(AggregationInterval).includes(...) rejects an unknown
     * string, so the derivation runs and a 1-hour window resolves to Minute.
     */
    const bogusOverride: AggregationInterval =
      "NotARealInterval" as AggregationInterval;
    const result: AggregationInterval = intervalForDiff(
      1000 * 60 * 60,
      bogusOverride,
    );
    expect(result).toBe(AggregationInterval.Minute);
  });

  it("preserves every enum value when passed as an explicit override", () => {
    const allIntervals: Array<AggregationInterval> =
      Object.values(AggregationInterval);
    for (const interval of allIntervals) {
      const result: AggregationInterval = intervalForDiff(
        1000 * 60 * 60,
        interval,
      );
      expect(result).toBe(interval);
    }
  });
});

describe("AggregateUtil.isTotalAggregation", () => {
  it("is true only for Total", () => {
    expect(AggregateUtil.isTotalAggregation(AggregationInterval.Total)).toBe(
      true,
    );
  });

  it("is false for every non-Total interval", () => {
    const nonTotalIntervals: Array<AggregationInterval> = Object.values(
      AggregationInterval,
    ).filter((interval: AggregationInterval) => {
      return interval !== AggregationInterval.Total;
    });

    for (const interval of nonTotalIntervals) {
      expect(AggregateUtil.isTotalAggregation(interval)).toBe(false);
    }
  });
});

describe("AggregateUtil.buildBucketTimestampExpression", () => {
  const COL: string = "createdAt";

  it("compiles FiveMinutes to a 5 MINUTE toStartOfInterval", () => {
    const result: string = AggregateUtil.buildBucketTimestampExpression(
      AggregationInterval.FiveMinutes,
      COL,
    );
    expect(result).toBe(`toStartOfInterval(${COL}, INTERVAL 5 MINUTE)`);
  });

  it("compiles FifteenMinutes to a 15 MINUTE toStartOfInterval", () => {
    const result: string = AggregateUtil.buildBucketTimestampExpression(
      AggregationInterval.FifteenMinutes,
      COL,
    );
    expect(result).toBe(`toStartOfInterval(${COL}, INTERVAL 15 MINUTE)`);
  });

  it("compiles ThirtyMinutes to a 30 MINUTE toStartOfInterval", () => {
    const result: string = AggregateUtil.buildBucketTimestampExpression(
      AggregationInterval.ThirtyMinutes,
      COL,
    );
    expect(result).toBe(`toStartOfInterval(${COL}, INTERVAL 30 MINUTE)`);
  });

  type DefaultCase = {
    interval: AggregationInterval;
    unit: string;
  };

  /*
   * The default branch lowercases the enum value into both the date_trunc unit
   * and the INTERVAL 1 <unit> guard. These calendar units happen to be valid
   * ClickHouse units, which is exactly why they route through the default arm.
   */
  const defaultCases: Array<DefaultCase> = [
    { interval: AggregationInterval.Minute, unit: "minute" },
    { interval: AggregationInterval.Hour, unit: "hour" },
    { interval: AggregationInterval.Day, unit: "day" },
    { interval: AggregationInterval.Week, unit: "week" },
    { interval: AggregationInterval.Month, unit: "month" },
    { interval: AggregationInterval.Year, unit: "year" },
  ];

  it.each(defaultCases)(
    "compiles $interval via the lowercased date_trunc default",
    ({ interval, unit }: DefaultCase) => {
      const result: string = AggregateUtil.buildBucketTimestampExpression(
        interval,
        COL,
      );
      expect(result).toBe(
        `date_trunc('${unit}', toStartOfInterval(${COL}, INTERVAL 1 ${unit}))`,
      );
    },
  );

  it("routes Total through the default branch as a lowercased unit in isolation", () => {
    /*
     * buildBucketTimestampSelect short-circuits Total before ever calling this
     * function, but called directly Total falls into the default arm and is
     * lowercased like any other value. This pins that isolated behavior so a
     * future refactor cannot change it unnoticed.
     */
    const result: string = AggregateUtil.buildBucketTimestampExpression(
      AggregationInterval.Total,
      COL,
    );
    expect(result).toBe(
      `date_trunc('total', toStartOfInterval(${COL}, INTERVAL 1 total))`,
    );
  });

  it("interpolates a compound builder expression verbatim in the sub-hour branch", () => {
    const expression: string = "toDateTime(t.created_at)";
    const result: string = AggregateUtil.buildBucketTimestampExpression(
      AggregationInterval.FiveMinutes,
      expression,
    );
    expect(result).toBe(`toStartOfInterval(${expression}, INTERVAL 5 MINUTE)`);
  });

  it("interpolates a compound builder expression verbatim in the default branch", () => {
    const expression: string = "toDateTime(t.created_at)";
    const result: string = AggregateUtil.buildBucketTimestampExpression(
      AggregationInterval.Hour,
      expression,
    );
    expect(result).toBe(
      `date_trunc('hour', toStartOfInterval(${expression}, INTERVAL 1 hour))`,
    );
  });
});

describe("AggregateUtil.buildBucketTimestampSelect", () => {
  const COL: string = "createdAt";

  it("emits a self-aliased min() for Total (whole-window bucket)", () => {
    const result: string = AggregateUtil.buildBucketTimestampSelect(
      AggregationInterval.Total,
      COL,
    );
    expect(result).toBe(`min(${COL}) as ${COL}`);
  });

  it("aliases the bucket expression for a sub-hour interval", () => {
    const result: string = AggregateUtil.buildBucketTimestampSelect(
      AggregationInterval.FiveMinutes,
      COL,
    );
    expect(result).toBe(
      `toStartOfInterval(${COL}, INTERVAL 5 MINUTE) as ${COL}`,
    );
  });

  it("aliases the date_trunc expression for a calendar interval", () => {
    const result: string = AggregateUtil.buildBucketTimestampSelect(
      AggregationInterval.Minute,
      COL,
    );
    expect(result).toBe(
      `date_trunc('minute', toStartOfInterval(${COL}, INTERVAL 1 minute)) as ${COL}`,
    );
  });

  it("delegates non-Total intervals to buildBucketTimestampExpression plus an alias", () => {
    /*
     * The select fragment for any non-Total interval must be exactly the
     * bucket expression suffixed with `as <col>`; anything else would mean the
     * two helpers had drifted apart.
     */
    const nonTotalIntervals: Array<AggregationInterval> = Object.values(
      AggregationInterval,
    ).filter((interval: AggregationInterval) => {
      return interval !== AggregationInterval.Total;
    });

    for (const interval of nonTotalIntervals) {
      const expression: string = AggregateUtil.buildBucketTimestampExpression(
        interval,
        COL,
      );
      const select: string = AggregateUtil.buildBucketTimestampSelect(
        interval,
        COL,
      );
      expect(select).toBe(`${expression} as ${COL}`);
    }
  });
});
